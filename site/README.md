# site/ — 知档落地页

`yingfeng.ca` 上「知档」介绍页的静态源文件。**不是知档应用的一部分**，也不参与
`npm test` / `npm run build`。ROADMAP 的「范围控制」明确把网站托管、域名、DNS
划在知档之外——这里只是暂居，最终应搬到个人站自己的仓库。

## 内容

| 文件 | 说明 |
|---|---|
| `index.html` | 单页，内联 CSS + 一小段 JS，无构建步骤，无第三方脚本，无统计代码 |
| `assets/app-icon.png` | 从 `../assets/app-icon.png` 复制 |
| `assets/0*.jpg` | 从 `../docs/images/` 复制并压缩的界面截图（04/05/12） |
| `wrangler.jsonc` | Cloudflare Workers 静态资源托管配置（assets-only，无 Worker 脚本） |
| `.assetsignore` | 把配置文件本身排除在上传的静态资源之外 |

`index.html` 里的一段 JS 只做一件事：调用 GitHub 公开 API 取最新 release 的版本号和
`.dmg` 下载地址。失败时页面里的静态链接（指向 `releases/latest`）已经是对的。

## 本地预览

```bash
python3 -m http.server -d site 8000
```

打开 <http://localhost:8000>。

## 部署（Cloudflare Workers 静态资源 + 子域名）

Cloudflare Dashboard → Workers & Pages → **Create application** → **Import a repository**
→ 选 `zhangyingfeng/zhi-dang`：

| 设置 | 值 |
|---|---|
| 路径 / Root directory | `site` |
| 构建命令 / Build command | 留空 |
| 部署命令 / Deploy command | `npx wrangler deploy` |
| 非生产分支部署命令 | `npx wrangler versions upload`（默认，保留） |

首次部署后，进这个 Worker → **Settings → Domains & Routes → Add → Custom domain**
→ `zhi-dang.yingfeng.ca`。DNS 在 Cloudflare，会自动建 CNAME 并签证书。

之后每次 push 到 `main` 自动重新部署。本地用 `npx wrangler dev` 或下面的
`http.server` 预览。

### 可选：让 `yingfeng.ca/zhi-dang` 也能进

`yingfeng.ca` zone → Rules → Redirect Rules → Create：

- 匹配：`(http.host eq "yingfeng.ca" and starts_with(http.request.uri.path, "/zhi-dang"))`
- 动态重定向到：`concat("https://zhi-dang.yingfeng.ca", substring(http.request.uri.path, 9))`
- 301，保留查询字符串

## 更新截图 / 图标

```bash
cp assets/app-icon.png site/assets/app-icon.png
for f in 04-login-required 05-zhihu-signin 12-export-done; do
  sips -Z 1400 -s formatOptions 70 "docs/images/$f.jpg" --out "site/assets/$f.jpg"
done
```

文案改动时，与 `README.md` / `docs/PRIVACY.md` / `docs/ROADMAP.md` 保持一致。
