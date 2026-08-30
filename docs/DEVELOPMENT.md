# 开发者文档

面向想从源码运行、构建「知档」，或基于导出归档开发其他工具的开发者。普通用户请看[图文教程](GETTING_STARTED.md)。

## 从源码运行

```bash
git clone https://github.com/zhangyingfeng/zhi-dang.git
cd zhi-dang
git checkout v1-tauri
npm install
npx tauri dev
```

`tauri dev` 会自动启动内置的 Node 后端并打开桌面窗口，不需要单独起服务。

打包成独立 `.app`/`.dmg`：

```bash
npx tauri build
```

额外需要安装 Rust 工具链（`cargo`）和 [Bun](https://bun.sh)，打包时会用它们把后端编译成独立可执行文件（sidecar），最终产物不依赖用户机器上是否装有 Node.js。

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

归档格式被视为项目的长期数据层，目标是让归档满足这些要求：

- 作者可以完整保存自己的回答、文章和图片；
- 内容使用 Markdown、JSON 和普通图片等开放格式；
- 归档可以在没有知乎、没有任何服务端的情况下继续读取；
- 数据结构清晰、可验证，能够被其他软件重新使用；
- 平台只是内容来源之一，而不是作品唯一的长期存放地点。

因此 `index.json` 和导出的 Markdown 都按长期数据格式对待，破坏兼容性的修改必须经过明确的 schema 版本设计。任何读取归档的工具都应直接使用已导出的本地数据，而不是要求用户重新访问知乎。

## 导出任务列表与控制接口

前端展示的不是单一进度条，而是一份任务列表——`GET /api/status` 返回的 `progress.tasks` 数组，每一项对应一个 `ExportTask`（`src/types.ts`）：状态（`pending`/`active`/`done`/`error`/`skipped`）、`images`/`write` 两个子任务各自的状态，以及可选的 `duplicate` 字段。

**重复检测**：`src/server.ts` 在拿到完整列表后，对每一项正文做 `contentHash`（`src/util.ts`，先用 `normalizePlainText` 去标签、合并空白，再取 SHA-256）分组，哈希相同的项互相标记为 `duplicate`。这是精确匹配，不做任何相似度/语义判断，纯粹是给用户看的提示——本身不会跳过或合并任何内容。

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

- 知乎没有为本项目提供正式 API；网页接口字段或安全策略变化时可能需要更新。
- 已删除、仅自己可见或受平台限制的内容取决于当前账号实际可访问的数据。
- 暂停/继续导出限于当前这次运行的进程内；退出应用后再打开，只能靠指向同一个输出目录来续传，不是真正的"后台持续下载"。
- 首次大量导出可能触发正常的安全验证；项目不会尝试绕过验证。
- 目前只在 macOS（Apple Silicon）上完整测试过；Windows、Linux 和 Intel Mac 尚未验证。
- 尚未完成 Apple 开发者签名，首次打开需要在系统设置里手动允许一次。

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
