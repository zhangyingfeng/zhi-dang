# 开发者文档

面向想从源码运行、构建「知档」，或基于导出归档开发其他工具的开发者。普通用户请看[图文教程](GETTING_STARTED.md)。

## 从源码运行

```bash
git clone https://github.com/zhangyingfeng/zhi-dang.git
cd zhi-dang
npm install
npm run build:sidecar   # 只需跑一次；见下面的说明
npx tauri dev
```

`tauri dev` 会自动启动内置的 Node 后端并打开桌面窗口，不需要单独起服务。

`npm run build:sidecar` 这一步容易被忽略但不能少：Tauri 的构建脚本（`src-tauri/build.rs`）在编译时会校验 `tauri.conf.json` 里 `externalBin` 声明的 sidecar 二进制（`src-tauri/binaries/zhidang-server-<target-triple>`）确实存在于磁盘上——即使是 `tauri dev`、即使 dev 模式实际用的是 `beforeDevCommand` 直接跑的 `tsx`、根本不会去执行这个二进制，这个存在性检查依然会跑，文件不存在就直接编译失败（`resource path ... doesn't exist`）。这个文件不受版本控制（见 `src-tauri/.gitignore`），所以全新 clone 之后、或者本地清过 `src-tauri/binaries/` 之后，必须先手动跑一次 `npm run build:sidecar` 补上它，之后就可以正常反复 `tauri dev`。

打包成独立 `.app`/`.dmg`：

```bash
npx tauri build
```

额外需要安装 Rust 工具链（`cargo`）和 [Bun](https://bun.sh)，打包时会用它们把后端编译成独立可执行文件（sidecar），最终产物不依赖用户机器上是否装有 Node.js。

正式发布前的完整验证步骤（真机测试、签名/Gatekeeper 检查、断点续传等自动化测不到的项目）见 [发布前检查清单](RELEASE_CHECKLIST.md)。

## 两个 Edition：direct / official

「知档」有两个可独立构建的版本（edition），共享同一份归档引擎、UI 骨架和版本号，只有"内容从哪来、怎么登录"不同：

- **direct**（默认，GitHub / Developer ID 分发）：内嵌 Zhihu 登录窗口，复用登录会话直连知乎网页版接口。`npx tauri dev` / `npx tauri build` 不带任何参数就是这个版本——日常开发流程完全不变。
- **official**（App Store 分发）：不含任何登录窗口或会话中继代码，改用知乎官方数据开放平台（[developer.zhihu.com](https://developer.zhihu.com)）的 Access Secret 鉴权，只有纯 HTTP 请求。构建方式：

  ```bash
  npm run build:sidecar   # 同上一节：这个文件不存在的话 tauri dev/build 都会在编译期直接失败
  npm run tauri:appstore        # 打包 .app（等价于 tauri build --config src-tauri/tauri.appstore.conf.json -f appstore）
  npm run tauri:appstore:dev    # 本地跑起来调试
  ```

  Access Secret 在知乎开放平台个人中心（`https://developer.zhihu.com/profile`）生成，粘贴进应用即可，不需要等知乎审批 OAuth。official 版每天的"我的创作全文"配额有限（实名 100 次/天，未实名 10 次/天，一次一篇），配额用完时会停在当前进度、提示第二天继续——这是 `Progress.phase === "quota"`（`src/types.ts`）对应的状态，不是失败。

**Zhihu OAuth 已评估并明确放弃**，不是"以后再看"：知乎这套 OAuth 把 `app_key` 当传统机密客户端密钥用（换 token 时明文传输），文档完全没提 PKCE 或任何面向原生/开源客户端的处理方式。知档是开源桌面应用，`app_key` 一旦写进代码就等于公开——而唯一能绕开这个问题的办法（自建一个只做 token 中转的常驻服务器）又正好是知档一直刻意不背的运营责任。所以 Access Secret 不是过渡方案，是 official edition 唯一、长期的接入方式。

### 两版功能上的区别

不只是接口不同，用户实际能感觉到的差异：

| | direct | official |
|---|---|---|
| 登录方式 | 内嵌 Zhihu 登录窗口，正常账号密码/扫码登录 | 粘贴在知乎开放平台个人中心生成的 Access Secret，按钮文案是"验证并登录"——点击时会先拿这个 Secret 试调一次配额接口，验证通过才真正保存、进入登录态，避免把明显无效的凭证放进钥匙串 |
| 每日次数限制 | 无 | 有：`创作能力`配额每天 100 次（未实名 10 次），一篇内容的全文对应一次；配额为 0 时"开始导出"按钮直接禁用，登录时若已经是 0 会额外弹提示，不用等点了才发现 |
| 中途配额用完怎样 | 不会发生 | 停在当前进度，`export-report.json`/`index.json` 里已成功的项目保持不变（不会因为断在中间就被冲掉——这曾经是个真实 bug，见下方说明），第二天配额刷新后点"开始导出"自动从断点继续 |
| 欢迎语 / 文件夹默认名 | 真实知乎昵称 / `url_token`，来自登录会话 | 官方接口不返回账号昵称（查过所有相关接口，确认是知乎故意不给，不是漏掉）——可以在登录前手动贴一次知乎主页链接，本地解析出 `url_token` 用于欢迎语和文件夹命名；不贴的话默认文件夹名是 `exports`，欢迎语退化成显示当日剩余配额 |
| 精确重复检测（`task.duplicate`，见下方"重复检测"） | 有——列表接口本身就带全文，导出前能算哈希 | **没有**——官方列表接口只有摘要，要等真正 `fetchBody` 才有全文，而这一步受配额限制，不能为了去重就先把全部内容都拉一遍；开放平台版目前不产出 `duplicate` 标记 |
| 配额说明 | 无对应概念 | 登录后的额度文字旁有"额度说明"链接，弹窗解释配额规则，附官方文档和用量统计入口 |
| 能否上架 App Store | 不行（Guideline 5.2.2：未经知乎允许访问其网页服务） | 可以——访问方式是知乎官方授权的 |

这个接缝具体落在哪：

| 层 | direct | official | 共享 |
|---|---|---|---|
| 数据源 | `src/source/direct.ts`（`DirectContentSource`，包一层 `src/zhihu.ts` 的分页逻辑，`fetchBody` 是空操作） | `src/source/official.ts`（`OfficialApiContentSource`，`listAll` 走 `/api/v1/user/contents`，`fetchBody` 走 `/api/v1/user/content_detail`，配额耗尽抛 `QuotaExhaustedError`） | `src/source/types.ts` 的 `ContentSource` 接口 |
| 后端入口 | `src/index.direct.ts`（挂 `/api/frontend-fetch-request`\|`result` relay 路由） | `src/index.official.ts`（挂 `/api/official/quota`） | `src/server.ts` 的 `createServer(opts)` |
| 登录/凭证 | Tauri 登录窗口 + `zhihu_fetch` IPC 中继（`src-tauri/src/lib.rs` 的 `mod direct`） | `save_access_secret`/`has_access_secret`/`get_access_secret`/`clear_access_secret` 四个命令，读写 macOS 系统钥匙串（`src-tauri/src/lib.rs` 的 `mod appstore`，靠 `keyring` crate） | `resize_main_window`、菜单、about 面板等 |
| Rust feature | `#[cfg(not(feature = "appstore"))]`（不是一个叫 `direct` 的正向 feature——Tauri CLI 的 `-f/--features` 只会累加、无法关掉默认 feature，所以两个 edition 的互斥关系表达成"是不是 appstore"，而不是两个正向 feature 互斥，避免两边命令混进同一个二进制） | `appstore`（`src-tauri/Cargo.toml`） | — |
| 前端 | `public/app.js` 启动时读 `/api/about` 的 `edition` 字段，运行时分支（登录按钮 vs. Access Secret 输入框），任务列表/进度条/暂停跳过等渲染代码完全不区分 edition | | |

Apple Developer 账号相关的部分（Mac App Store 签名身份、App Sandbox entitlements、公证、App Store Connect 提交）不在这个仓库里，需要维护者用自己的 Apple 开发者账号手动配置；`src-tauri/tauri.appstore.conf.json` 目前只是一个可以继续填的壳。

## 构建与测试

```bash
npm test        # 静态引用检查 + 后端单元测试 + 前端特征测试
npx tauri dev    # 启动完整桌面应用
npx tauri build  # 打包独立 .app / .dmg
```

`npm test` 依次跑三层：

1. `scripts/check-dom-refs.mjs`——静态比对 `public/app.js` 里所有 `$("id")` 引用和 `public/index.html` 里实际存在的 `id`，元素被删掉但引用没清干净时（1.1.0 那次退出登录崩溃就是这个原因）直接报错，不需要跑测试就能拦住。
2. `test/*.test.ts` 里后端部分（`zhihu.ts`/`exporter.ts`/`util.ts`）——分页、去重、图片处理、暂停/跳过/续传的集成测试，用合成数据，不碰网络。
3. `test/app.test.ts`——`public/app.js` 从来没有过自动化测试，这个文件用 jsdom 把真实的 `index.html`+`app.js` 加载起来跑，`window.__TAURI__`/`fetch`/`Notification`/`setInterval` 全部换成测试可控的假实现（具体怎么假的见文件顶部的 `createHarness`），覆盖登录/退出登录状态切换、任务列表渲染、暂停/跳过、"开始导出"↔"在访达中显示"这几条关键路径。这些测试是照着两个真实发生过的退出登录 bug（`docs/BUGFIXES.md`）反向写的特征测试，用来验证：如果这两个 bug 现在重新引入，测试会不会红——已经手动验证过会。

贡献前请阅读 [CONTRIBUTING.md](CONTRIBUTING.md)。使用 Codex 等编码工具维护时，请同时遵守 [AGENTS.md](../AGENTS.md) 中的仓库约束。

## 导出结构

```text
exports/
├── index.json
├── export-report.json
├── README.md
├── answers/*.md
├── articles/*.md
└── images/*
```

每篇 Markdown 包含内容 ID 和类型、问题 ID、标题、原文链接、时间、公开互动数量、可用封面、Markdown 正文和本地图片引用。

`index.json` 是供其他工具直接读取的索引。`export-report.json` 记录发现、成功、失败、跳过数量，以及文章、图片失败和用户跳过项的详情。收藏数在接口没有返回时保存为 `null`，不会伪装成零。

`index.json`/`export-report.json`/`README.md` 这三个文件在每一项处理完（成功、失败或跳过）之后都会重写一次，不是等整个导出跑完才写——这样即使应用中途被关闭或崩溃，目录里也会留下当时已完成的进度，而不是什么都没有。写入方式是先写临时文件再原子性地 rename 到目标路径（`writeFileAtomic`），确保中途被打断时不会把半截内容误当成完整文件。

**恢复导出**：把保存位置重新指向一个已经包含 `export-report.json` 的目录（无论是上次跑完的，还是中途被打断的），知档会把这个文件当作"这是我自己创建的归档"的信任标记，允许继续写入而不要求目录为空。开始导出时会读回上次的 `index.json`，把其中已成功的项直接标记为完成、不重新下载；上次被跳过的项也会保持跳过状态。真正需要重新处理的只有上次失败的项，以及知乎这次新返回的项。空目录仍然按老规则处理——不含这个标记文件的非空目录会被拒绝，避免误写进用户的其他文件。

> **配额中断不会丢已完成的记录**：`Exporter.export`（`src/exporter.ts`）在 `QuotaExhaustedError` 之后是 `continue` 而不是 `break`——循环会继续往后扫描剩余项目，只是不再真的发请求；已经在 `resumedRecords`/`skippedItemIds` 里的项目照常被重新确认写回 `records`。早期版本用的是 `break`，配额排在数组中间用完时，后面那些"其实早就成功过"的项目当次就没机会被再次确认，写出的 `index.json` 会把它们静默丢掉——文件本身完好，只是账本变短了，多点几次"开始导出"（配额一直是 0）会越丢越多。见 `test/exporter-quota.test.ts` 里"排在配额断点之后的已完成项目不能丢"这个回归测试。

归档格式被视为项目的长期数据层，目标是让归档满足这些要求：

- 作者可以完整保存自己的回答、文章和图片；
- 内容使用 Markdown、JSON 和普通图片等开放格式；
- 归档可以在没有知乎、没有任何服务端的情况下继续读取；
- 数据结构清晰、可验证，能够被其他软件重新使用；
- 平台只是内容来源之一，而不是作品唯一的长期存放地点。

因此 `index.json` 和导出的 Markdown 都按长期数据格式对待，破坏兼容性的修改必须经过明确的 schema 版本设计。任何读取归档的工具都应直接使用已导出的本地数据，而不是要求用户重新访问知乎。

## 导出任务列表与控制接口

前端展示的不是单一进度条，而是一份任务列表——`GET /api/status` 返回的 `progress.tasks` 数组，每一项对应一个 `ExportTask`（`src/types.ts`）：状态（`pending`/`active`/`done`/`error`/`skipped`）、`images`/`write` 两个子任务各自的状态，以及可选的 `duplicate` 字段。

**重复检测**：`src/server.ts` 在拿到完整列表后，对每一项正文做 `contentHash`（`src/util.ts`，先用 `normalizePlainText` 去标签、合并空白，再取 SHA-256）分组，哈希相同的项互相标记为 `duplicate`。这是精确匹配，不做任何相似度/语义判断，纯粹是给用户看的提示——本身不会跳过或合并任何内容。这一步依赖列表阶段就拿到全文——official edition 的列表接口只有摘要，`html` 要等 `fetchBody`（受配额限制）才有，所以这一步对 official edition 目前是静默跳过（每一项 `normalizePlainText("").length` 恒为 0，直接被 `MIN_DEDUP_TEXT_LENGTH` 过滤掉），不会产出任何 `duplicate` 标记，也不会报错。

**控制接口**：

- `POST /api/export/pause` / `/resume`：切换 `progress.paused`，`Exporter.export`（`src/exporter.ts`）的循环会在每一项开始前、以及图片/写入两个子任务之间检查这个标记并等待，不是真正的多进程暂停，只在当前这次运行的进程内有效。
- `POST /api/export/skip`，body 为 `{id, scope:"item"|"images"}`：只在目标项（或图片子任务）还是 `pending` 时才生效，返回 409 表示已经开始处理或已完成，不能通过这个接口撤销。跳过的项记入 `export-report.json` 的 `skippedItems`，不计入失败。
- `POST /api/reset`：把 `progress` 清回 `{phase:"idle",...}`，导出进行中时拒绝（409）。前端退出登录时会调用这个接口——登出本身是 Tauri 侧清理登录会话，不经过 HTTP，如果不主动清一次，`GET /api/status` 还会继续吐出上一次导出的任务列表。

这一整套状态都在内存里（`ExportControl`，`src/types.ts`），不写盘、不跨进程——真正跨重启生效的只有上一节说的"恢复导出"机制（靠读回 `index.json`/`export-report.json`）。

## 图片处理

- 优先使用 `data-original` 和 `data-actualsrc` 中的真实图片地址。
- 清理 `noscript` 备用图片，避免同一图片重复显示。
- 图片按完整内容的 SHA-256 哈希命名，相同内容自动去重。
- 下载失败自动重试三次，之后写入 `export-report.json`。
- 下载失败时保留远程图片地址，不静默伪装成本地成功。

## 隐私和安全

- 应用不接收、记录或上传密码。
- 登录在应用内置的登录窗口中完成，密码不经过本应用的后端；登录会话由系统自带的 WebView 管理和持久化（macOS 上是 WKWebView），保存路径在 `~/Library/WebKit/` 下，与浏览器/其他应用相互隔离。
- 想清除登录状态，点应用里的"退出登录"即可；这会清空该会话在系统 WebView 中的全部数据。
- 导出索引不保存账号姓名、简介或账号标识。
- 本地服务只监听 `127.0.0.1`，不对外暴露端口。

完整说明见 [PRIVACY.md](PRIVACY.md) 和 [SECURITY.md](SECURITY.md)。

## 已知限制

以下针对 direct edition（见上一节）；official edition 使用知乎官方开放平台，不受"网页接口变化"和"验证码"这两条限制，但受官方每日配额约束。

- 知乎没有为 direct edition 提供正式 API；网页接口字段或安全策略变化时可能需要更新。
- 已删除、仅自己可见或受平台限制的内容取决于当前账号实际可访问的数据。
- 暂停/继续导出限于当前这次运行的进程内；退出应用后再打开，只能靠指向同一个输出目录来续传，不是真正的"后台持续下载"。
- 首次大量导出可能触发正常的安全验证；项目不会尝试绕过验证。
- 目前只在 macOS（Apple Silicon）上完整测试过；Windows、Linux 和 Intel Mac 尚未验证。
- 尚未完成 Apple 开发者签名，首次打开需要在系统设置里手动允许一次。

以下针对 official edition：

- 不产出精确重复检测的 `duplicate` 标记（原因见"导出任务列表与控制接口"一节的"重复检测"）。
- 没有账号昵称——用户不手动填知乎主页地址的话，欢迎语和文件夹默认名都用不了真实身份，参见"两版功能上的区别"表。
- 每天"创作能力"配额有限（100 次，未实名 10 次），大账号一次导出不完，需要跨天多次点击"开始导出"续传。
- Mac App Store 相关的签名、entitlements、公证、提交流程尚未开始，`tauri:appstore` 目前只能本地打包验证。

## 遇到问题

先查看[故障排查手册](TROUBLESHOOTING.md)。其中包括：

- 登录窗口无法打开或打开后关闭；
- 旧进程占用 4317 端口；
- 源码已更新但仍在运行旧版本；
- 安全验证页被返回而不是 JSON；
- 接口总数与去重后数量不同；
- 图片、封面或收藏数缺失；
- 导出目录被拒绝；
- 第三方接口字段变化。

历史问题及其修复方式见 [Bug 修复记录](BUGFIXES.md)。提交新问题前请使用仓库 Issue 模板，并删除凭证、账号标识和真实内容。
