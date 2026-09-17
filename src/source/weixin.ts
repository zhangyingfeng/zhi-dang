import { sleep } from "../util.js";
import type { ContentSource } from "./types.js";
import type { ZhihuItem } from "../types.js";

// ContentSource 的第三个实现草案（对应"路线 B"）：作者本人登录自己的公众号
// 后台，只拉取"本账号自己发布过的图文"列表——不搜索、不抓取任何其他公众
// 号，与知档"只导出你自己的内容"的边界保持一致（见 README 设计原则）。
//
// 这是一个骨架：整体结构和数据流是确定的（照抄 login.ts 的形状），但接口
// 路径、参数名、响应字段这些细节全部标了 TODO——它们来自公众号后台网页
// 自己用的私有接口，未公开、没有文档，必须挂上真实登录态抓包核实之后才能
// 定下来，现在写的都是"大概率是这样"的占位实现，不能直接当真实代码跑。
//
// 和 login.ts 的关键差异：
// 1) 知乎的会员列表接口一次性返回完整正文 HTML，login.ts 的 fetchBody 直接
//    回传 item.html 就行；公众号后台的"内容管理"列表接口大概率只给标题、
//    摘要、封面、文章链接，正文必须另外请求文章公开页面解析。
// 2) 好消息是文章公开页面（mp.weixin.qq.com/s/xxx）本身不需要登录态，
//    fetchBody 可以在 Node 侧直接 fetch，不必像列表接口那样经登录窗口中转
//    ——这也是本文件里唯一不依赖 WeixinPageFetcher 的部分。

// 公众号后台的接口挂在 mp.weixin.qq.com 域下，需要同源 cookie（登录态）+
// URL 上的 token 参数两者都对才会认；Node 进程没有这个 cookie，必须复用
// 登录窗口自己的页面上下文发请求，和 login.ts 依赖 src/frontendBridge.ts
// 的 fetchViaFrontend 是同一套道理。这里对应的中转函数先叫
// fetchViaWeixinWindow，Tauri 一侧要新增一个指向 mp.weixin.qq.com 的登录
// 窗口 + 一个 do_weixin_fetch command（对应 src-tauri/src/lib.rs 里
// do_zhihu_fetch 那一套），目前都还没写。
export type WeixinPageFetcher = (url: string) => Promise<{ status: number; body: string }>;

// 登录成功后地址栏会带上 token=xxxxxxxx——这不是哪个接口返回的字段，是要
// 从登录窗口跳转后的当前 URL 里解析出来的（类似 zhihu.ts 里 url_token 的
// 拿法，但知乎那边是调 /api/v4/me 拿到的字段，这里是纯前端 URL 解析）。
// 会话本身没有独立的 fakeid：后台列表接口按 cookie+token 天然限定在当前
// 登录账号自己名下，不需要（也不应该）额外指定要看哪个公众号。
export interface WeixinSession { token: string }

// ---- 下面这一段是列表接口的形状，全部待确认 ----
// 公众号后台"内容管理"页面用的接口，大致猜测（源自网上第三方工具的逆向
// 记录，未经本项目实测验证，字段名和 URL 随时可能已经变化）：
//
//   GET https://mp.weixin.qq.com/cgi-bin/appmsgpublish
//       ?sub=list&search_field=null&begin=<offset>&count=<pageSize>
//       &type=9&token=<token>&lang=zh_CN&f=json&ajax=1
//
// 响应大致形如 { base_resp: { ret, err_msg }, publish_page: "<JSON字符串>" }
// ——publish_page 字段本身还是一段被转义过的 JSON 字符串，要再 parse 一次；
// 里面每条记录的 publish_info 字段又是一层 JSON 字符串。这种"字符串套字符
// 串"的形状在这类后台管理接口里很常见，实测前无法保证这里写的层数是对的。
interface RawPublishPage { base_resp?: { ret: number; err_msg: string }; publish_page?: string }
interface RawPublishInfo { appmsgex?: RawAppMsg[] }
interface RawAppMsg { title: string; link: string; create_time: number; update_time: number; cover_img: string; digest: string }

function buildListUrl(offset: number, pageSize: number, token: string) {
  const url = new URL("https://mp.weixin.qq.com/cgi-bin/appmsgpublish");
  url.searchParams.set("sub", "list");
  url.searchParams.set("search_field", "null");
  url.searchParams.set("begin", String(offset));
  url.searchParams.set("count", String(pageSize));
  url.searchParams.set("type", "9");
  url.searchParams.set("token", token);
  url.searchParams.set("lang", "zh_CN");
  url.searchParams.set("f", "json");
  url.searchParams.set("ajax", "1");
  return url.toString();
}

// TODO: 用真实响应核实这里的两层 JSON.parse 是否对，以及 base_resp.ret 非 0
// 时该怎么分类——公众号后台常见的几种非 0 返回：token 过期需要重新登录、
// 请求太快被限流、以及弹验证码（这种情况响应体往往根本不是 JSON，而是一段
// HTML 验证页面，下面这个实现目前完全没处理，是最大的一个待补洞）。
function parsePublishPage(body: string): { items: RawAppMsg[]; isEnd: boolean; totalCount: number } {
  let page: RawPublishPage;
  try { page = JSON.parse(body); }
  catch { throw new Error("公众号后台返回的不是预期的 JSON——可能是登录态过期，或者触发了验证码/风控页面，需要重新登录。"); }
  if (page.base_resp && page.base_resp.ret !== 0) throw new Error(`公众号后台接口返回错误 ${page.base_resp.ret}：${page.base_resp.err_msg}`);
  if (!page.publish_page) throw new Error("公众号后台返回的数据格式已经变化，无法继续解析；请检查应用更新。");
  const parsed = JSON.parse(page.publish_page) as { publish_list?: { publish_info?: string }[]; total_count?: string };
  const items = (parsed.publish_list ?? []).flatMap((entry) => {
    if (!entry.publish_info) return [];
    const info = JSON.parse(entry.publish_info) as RawPublishInfo;
    return info.appmsgex ?? [];
  });
  const totalCount = Number(parsed.total_count ?? 0);
  // TODO: 翻页何时结束同样待确认——是拿 total_count 和已收集数量比较，还是
  // 某一页 publish_list 为空即视为结束，需要拿真实账号（尤其是文章数刚好
  // 卡在整数页边界的账号）测过才能确定，不能只测一两页就下结论。
  return { items, isEnd: items.length === 0, totalCount };
}

function normalizeItem(raw: RawAppMsg): ZhihuItem {
  const id = /\/s\/([\w-]+)/.exec(raw.link)?.[1] ?? raw.link;
  return {
    id,
    // 复用现有 ContentKind，不新增 "weixin" 这个值——公众号图文在语义上更
    //接近"文章"，这样 Exporter 现有的按 kind 分文件夹逻辑不用改。真要多
    // 平台通用，ZhihuItem/ContentKind 这套以知乎命名的类型迟早要重构成
    // 平台无关的形状，但那是另一次改动，不在这个骨架里做。
    kind: "article",
    questionId: null,
    title: raw.title,
    url: raw.link,
    // 列表接口不给正文，交给 fetchBody 单独请求文章公开页面填充。
    html: "",
    excerpt: raw.digest ?? "",
    created: raw.create_time,
    updated: raw.update_time ?? raw.create_time,
    // 阅读数/点赞数/在看数这几项，公众号后台的列表接口大概率不直接给，
    // 通常要另外调统计类接口（例如 getappmsgext）才能拿到，且未必对所有
    // 文章都开放。先如实填 0/null，不编造数据；voteupCount/favoriteCount/
    // commentCount 这几个字段名是知乎的说法，硬套在公众号语境上（比如拿
    // favoriteCount 装阅读数）会让归档里的字段名和实际含义对不上，同样留
    // 给以后的类型重构解决。
    voteupCount: 0,
    favoriteCount: null,
    commentCount: 0,
    coverUrl: raw.cover_img || null,
  };
}

// TODO: 桌面端常见 UA 占位，抓包核实公众号文章公开页面是否会根据 UA 返回
// 不同结构（例如移动端 UA 才会给出可解析的 HTML，PC UA 直接跳提示页）。
const DESKTOP_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

export class WeixinContentSource implements ContentSource {
  constructor(private session: WeixinSession, private fetchPage: WeixinPageFetcher, private delayMs = 1200) {}

  async listAll(onCount?: (n: number) => void) {
    const items: ZhihuItem[] = [];
    const seen = new Set<string>();
    let offset = 0;
    // 分页大小刻意保守：公众号后台前端自己翻页时一页请求 5~20 条，一次拉
    // 太大或请求太密都更容易撞上限流/验证码，这里先按小页 + 较长 delayMs
    // 起步，等实测过风控阈值之后再考虑调大。
    const pageSize = 20;
    let completed = false;
    const maxPages = 1000;
    for (let guard = 0; guard < maxPages; guard++) {
      const { status, body } = await this.fetchPage(buildListUrl(offset, pageSize, this.session.token));
      if (status !== 200) throw new Error(`公众号后台接口返回 HTTP ${status}，登录态可能已失效，请重新登录。`);
      const page = parsePublishPage(body);
      for (const raw of page.items) {
        const item = normalizeItem(raw);
        if (seen.has(item.id)) continue;
        seen.add(item.id);
        items.push(item);
      }
      onCount?.(items.length);
      if (page.isEnd) { completed = true; break; }
      offset += pageSize;
      await sleep(this.delayMs);
    }
    if (!completed) throw new Error("公众号分页超过安全上限，导出已停止以避免生成不完整归档。");
    return { items, reports: [{ kind: "article" as const, reportedTotal: null, received: items.length, unique: items.length, duplicates: 0, warning: null }] };
  }

  // 正文走公开文章页面，不需要登录态、也不经登录窗口中转，直接在 Node 侧
  // fetch——这一点比知乎（正文必须在登录窗口里连着 cookie 一起拿）简单。
  async fetchBody(item: ZhihuItem) {
    const response = await fetch(item.url, { headers: { "User-Agent": DESKTOP_UA } });
    if (!response.ok) throw new Error(`公众号文章页面请求失败 ${response.status}`);
    const html = await response.text();
    // TODO: 公众号正文包裹在 <div id="js_content">...</div> 里，但这个正则
    // 只是估计写法，没有拿真实页面验证过闭合边界是否总能被这样简单地截
    // 到——正文里如果本身还嵌着别的 </div>，这种非结构化的字符串匹配就会
    // 提前截断，正式实现应该用一个真正的 HTML 解析器（比如现有依赖里已经
    // 有 turndown，可以配 linkedom/happy-dom 之类的轻量 DOM 实现）去定位
    // 这个节点，而不是拿正则赌。另外，文章被删除、仅粉丝可见、或者环境判
    // 定为"非正常访问"时，这个页面会返回一个提示页而不是正文，也需要专门
    // 识别并给出明确错误，而不是把提示页当正文导出。
    const match = /<div[^>]*id="js_content"[^>]*>([\s\S]*?)<\/div>\s*(?:<script|<\/div>\s*<div id="js_sg_bar")/i.exec(html);
    if (!match) throw new Error("未能在文章页面中找到正文（可能页面结构已变化，或文章已被删除/仅限特定读者可见）。");
    return match[1];
  }
}
