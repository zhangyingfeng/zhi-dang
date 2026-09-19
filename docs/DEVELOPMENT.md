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

## 两个 Edition：login / key

「知档」有两个可独立构建的版本（edition），共享同一份归档引擎、UI 骨架和版本号，区别是验证身份的方式——登录知乎账号，还是粘贴一个密钥：

- **login**（默认，GitHub / Developer ID 分发）：内嵌 Zhihu 登录窗口，复用登录会话直连知乎网页版接口。`npx tauri dev` / `npx tauri build` 不带任何参数就是这个版本——日常开发流程完全不变。
- **key**（App Store 分发）：不含任何登录窗口或会话中继代码，改用知乎官方数据开放平台（[developer.zhihu.com](https://developer.zhihu.com)）的 Access Secret 鉴权，只有纯 HTTP 请求。构建方式：

  ```bash
  npm run build:sidecar   # 同上一节：这个文件不存在的话 tauri dev/build 都会在编译期直接失败
  npm run tauri:key        # 打包 .app/.dmg（等价于 tauri build --config src-tauri/tauri.key.conf.json -f key）
  npm run tauri:key:dev    # 本地跑起来调试
  ```

  Access Secret 在知乎开放平台个人中心（`https://developer.zhihu.com/profile`）生成，粘贴进应用即可。key 版每天的"我的创作全文"配额有限（实名 100 次/天，未实名 10 次/天，一次一篇），配额用完时会停在当前进度、提示第二天继续——这是 `Progress.phase === "quota"`（`src/types.ts`）对应的状态，不是失败。

### 两版功能上的区别

不只是接口不同，用户实际能感觉到的差异：

| | <img src="../assets/icon-login.png" width="32" alt="登录版图标"><br>login（近白背景） | <img src="../assets/icon-key.png" width="32" alt="密钥版图标"><br>key（蓝色背景） |
|---|---|---|
| 验证身份的方式 | 内嵌 Zhihu 登录窗口，正常账号密码/扫码登录 | 粘贴在知乎开放平台个人中心生成的 Access Secret，按钮文案是"验证并登录"——点击时会先拿这个 Secret 试调一次配额接口，验证通过才真正保存、进入登录态，避免把明显无效的凭证放进钥匙串 |
| 每日次数限制 | 无 | 有：`创作能力`配额每天 100 次（未实名 10 次），一篇内容的全文对应一次；配额为 0 时"开始导出"按钮直接禁用，登录时若已经是 0 会额外弹提示，不用等点了才发现 |
| 中途配额用完怎样 | 不会发生 | 停在当前进度，`export-report.json`/`index.json` 里已成功的项目保持不变（不会因为断在中间就被冲掉——这曾经是个真实 bug，见下方说明），第二天配额刷新后点"开始导出"自动从断点继续 |
| 欢迎语 / 文件夹默认名 | 真实知乎昵称 / `url_token`，来自登录会话 | 官方接口不返回账号昵称（查过所有相关接口，确认是知乎故意不给，不是漏掉）——可以在登录前手动贴一次知乎主页链接，本地解析出 `url_token` 用于欢迎语和文件夹命名；不贴的话默认文件夹名是 `exports`，欢迎语退化成显示当日剩余配额 |
| 精确重复检测（`task.duplicate`，见下方"重复检测"） | 有——列表接口本身就带全文，导出前能算哈希 | **没有**——官方列表接口只有摘要，要等真正 `fetchBody` 才有全文，而这一步受配额限制，不能为了去重就先把全部内容都拉一遍；key 版目前不产出 `duplicate` 标记 |
| 配额说明 | 无对应概念 | 登录后的额度文字旁有"额度说明"链接，弹窗解释配额规则，附官方文档和用量统计入口 |
| 本地服务端口 | `4317` | `4318`——两个 edition 的 `.app` 可以同时打开，图标和端口都不会撞（两版图标现在是各自独立的设计稿，不是同一张图反色派生的——具体怎么生成见下面"改图标要同步的三个地方"） |

这个接缝具体落在哪：

| 层 | login | key | 共享 |
|---|---|---|---|
| 数据源 | `src/source/login.ts`（`LoginContentSource`，包一层 `src/zhihu.ts` 的分页逻辑，`fetchBody` 是空操作） | `src/source/key.ts`（`KeyContentSource`，`listAll` 走 `/api/v1/user/contents`，`fetchBody` 走 `/api/v1/user/content_detail`，配额耗尽抛 `QuotaExhaustedError`） | `src/source/types.ts` 的 `ContentSource` 接口 |
| 后端入口 | `src/index.login.ts`（挂 `/api/frontend-fetch-request`\|`result` relay 路由） | `src/index.key.ts`（挂 `/api/key/quota`） | `src/server.ts` 的 `createServer(opts)` |
| 登录/凭证 | Tauri 登录窗口 + `zhihu_fetch` IPC 中继（`src-tauri/src/lib.rs` 的 `mod login`） | `save_access_secret`/`has_access_secret`/`get_access_secret`/`clear_access_secret` 四个命令，读写 macOS 系统钥匙串（`src-tauri/src/lib.rs` 的 `mod key`，靠 `keyring` crate） | `resize_main_window`、菜单、about 面板等 |
| Rust feature | `#[cfg(not(feature = "key"))]`（不是一个叫 `login` 的正向 feature——Tauri CLI 的 `-f/--features` 只会累加、无法关掉默认 feature，所以两个 edition 的互斥关系表达成"是不是 key"，而不是两个正向 feature 互斥，避免两边命令混进同一个二进制） | `key`（`src-tauri/Cargo.toml`） | — |
| 前端 | `public/app.js` 启动时读 `/api/about` 的 `edition` 字段，运行时分支（登录按钮 vs. Access Secret 输入框），任务列表/进度条/暂停跳过等渲染代码完全不区分 edition | | |

### 改图标要同步的三个地方

两个 edition 的图标源图（`assets/app-icon-source.png`、`assets/app-icon-login-source.png`）改了之后，下游有三处用法，各自的约束不一样，容易漏改：

1. **macOS 应用图标**（`src-tauri/icons/`、`src-tauri/icons-login/`，靠 `npx tauri icon` 从源图生成）：必须遵守苹果官方模板的边距/圆角规格（`scripts/apply-apple-icon-spec.py`），不能随便调圆角曲率或去掉边距——见 `docs/BUGFIXES.md` 1.2.0 的两条教训（改圆角没配边距，被 macOS 自动套灰框；手绘描边在圆角处变细）。
2. **网站**（`site/assets/icon-*.png`）：用 `scripts/export-web-icons.py` 从源图裁掉苹果模板的透明边距再导出，不然网页上会看到图标周围一圈空白；视觉强调（阴影等）走 CSS（`--icon-shadow`），不要烘焙进图片，否则会跟 CSS 阴影叠两层。
3. **文档**（`assets/icon-*.png`，被 `README.md`/`docs/DEVELOPMENT.md` 引用）：跟网站共用同一份裁边图，但 GitHub 渲染 markdown 里的 HTML 会剥离 `style`/`class` 属性，CSS 阴影/边框在这里永远不会生效——要强调图标，只能靠把它放进表格的表头行（`<th>` 默认加粗），或者真的把效果烘焙进图片本身。

改完源图后，三处都要重新跑一遍对应脚本，不能只生成其中一个就以为完事。网站引用图标的 `<img>` 记得把 `?v=N` 版本号加一，否则浏览器可能继续用缓存的旧图（尤其是本地反复测试同一个文件名时）。

**两版图标各自换成独立设计稿时**（不是"改同一份图再自动派生另一版"），用 `scripts/apply-icon-artwork.py <原始方图.png> <输出master.png>` 而不是 `apply-apple-icon-spec.py`/`generate-login-icon.py`——后两者是历史遗留脚本：`apply-apple-icon-spec.py` 是一次性迁移脚本，假设的是"把旧的、已经改坏边距的方形图还原"这个特定场景；`generate-login-icon.py` 靠采样 `app-icon-source.png` 每个像素跟纯蓝/纯白两色的混合比例来推算登录版配色，只在两版图标其实是同一份纯色平面设计、仅背景色不同时才成立——换成两份各自独立画的写实/渐变风格设计稿（比如 1.4 版的文件夹图标）后这个假设不再满足，误跑会得到错误的重新上色结果。`apply-icon-artwork.py` 只做 Apple 官方模板要求的居中缩放到 824×824 + 100px 透明边距 + 185.4px 圆角，不对颜色做任何假设，两版各自喂一张全出血的原始方图即可。跑完之后，`npx tauri icon`/`export-web-icons.py` 这两步不变。

### 密钥版的 App Sandbox（ROADMAP.md 1.4）

提交 Mac App Store 强制要求开 App Sandbox，密钥版用了两份不同的 entitlements 文件，不是一份：

- `src-tauri/entitlements.key.plist`：主程序的真实权限——`app-sandbox`、`network.client`（访问知乎开放平台接口）、`network.server`（sidecar 自己的 `127.0.0.1:4318` 本地 HTTP 服务要监听端口，哪怕只是本机回环地址，沙盒也算作"网络访问"，需要这个权限，不是想当然可以省略）、`files.user-selected.read-write`（保存位置的读写）。
- `src-tauri/entitlements.key.child.plist`：sidecar（`zhidang-server`）自己的，**只有** `app-sandbox` + `inherit` 两项。按苹果官方文档，子进程要继承父进程的沙盒，entitlements 里只能有这两项，多写别的（哪怕跟父进程一样）系统会直接判定成"这个子进程要自己单独起一个沙盒容器"，而一个裸编译出来的可执行文件（不是标准 `.app` 结构）撑不住这个独立初始化，会在 `libsecinit_appsandbox` 直接崩溃退出——这是真实测过、复现过的问题，不是文档抄来的猜测。

Tauri 的 `bundle.macOS.entitlements` 配置只支持一份文件、统一套用给 bundle 里所有可执行文件，没法原生表达"主程序一份、sidecar 另一份"。所以正常的 `npm run tauri:key` 打包+公证流程对密钥版的沙盒版本不够用——sidecar 会被套上主程序的完整权限，触发上面那个崩溃。`scripts/build-key-sandboxed.sh` 是专门写的构建脚本：先用 `--bundles app` 只打包 `.app`（不带公证，因为这时候 sidecar 权限还是错的），手动把 sidecar 重新签成精简版 entitlements、重新封装整个 bundle，验证权限都对了之后才真正提交公证——保证公证凭证对应的是权限已经修好的版本，不是错误版本走了个过场。这个脚本只产出经 Developer ID 签名+公证的 `.app`，不是 App Store 要提交的产物。

已经在真实沙盒里验证过：sidecar 能正常启动、绑定端口、响应本地 API 请求、发起真实的出站请求到知乎开放平台，系统日志里没有任何沙盒拒绝记录。

### 密钥版的 MAS 打包（ROADMAP.md 1.4）

App Store 用的是 `.pkg`，不是 `.dmg`，而且签名证书、签名身份和公证方式都跟 Developer ID 分发完全不同——不是在 `build-key-sandboxed.sh` 上改几行就行，所以另写了 `scripts/build-key-mas.sh`：

- 签名身份换成 **Mac App Distribution**（Keychain 里显示为 `3rd Party Mac Developer Application: ...` 或新账号统一签发的 `Apple Distribution: ...`），不是 Developer ID Application；sidecar 仍然只签 `app-sandbox` + `inherit` 两项（原因同上）。
- **不做公证**——MAS 构建从不公证，App Review 本身就是对应的关卡；脚本运行时会主动 unset `APPLE_ID`/`APPLE_PASSWORD`/`APPLE_TEAM_ID`，避免 Tauri 看到这几个变量就尝试（用错误的证书）公证。
- 需要在 `.app` 的 `Contents/embedded.provisionprofile` 里嵌入为 `com.zhangyingfeng.zhidang.key` 这个 Bundle ID 申请的 **Mac App Store provisioning profile**（去 Apple Developer 后台的 Certificates, Identifiers & Profiles 申请下载），脚本默认从 `src-tauri/embedded.mas.provisionprofile` 读取，可用 `MAS_PROVISIONING_PROFILE` 环境变量指到别处。
- 签完的 `.app` 最后用 **Mac Installer Distribution** 身份（`3rd Party Mac Developer Installer: ...` 或 `Mac Installer Distribution: ...`）通过 `productbuild` 打包成 `.pkg`。

两个签名身份脚本会自动从 Keychain 按名称模式匹配，匹配到 0 个或多于 1 个都会明确报错退出（分别提示"先去装证书"或"用 `MAS_APP_IDENTITY`/`MAS_INSTALLER_IDENTITY` 环境变量消歧"），不会猜。

脚本只负责本地签名打包，产出一个签好名的 `.pkg`；上传和提交审核不在脚本范围内——Apple 已经废弃 `altool` 这条命令行路径，官方现在推的是 Transporter（Mac App Store 上的图形界面应用），需要交互式登录，不适合脚本化，也涉及维护者自己的 Apple 账号操作。剩下要做的：

1. 用 `scripts/build-key-mas.sh` 产出 `.pkg`（需要先装好两张证书、放好 provisioning profile）；
2. 去 App Store Connect 建 App 记录（Bundle ID 要先在 Apple Developer 后台的 Identifiers 里注册）；
3. 用 Transporter 上传 `.pkg`；
4. 在 App Store Connect 里把上传的 build 关联到 App 记录，正式提交审核。

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
├── images/*
└── word/*.docx
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

### Word（.docx）导出

`Exporter.writeWordDoc`（`src/exporter.ts`）把同一份已经写入 `.md` 的 Markdown 正文再转换成 `.docx`，存进独立的 `word/` 目录——是同一份内容的另一种呈现，不是替代 Markdown 归档；Word 转换失败只记进 `export-report.json` 的 `wordFailures`，不会影响该项目的整体成功状态（`.md` 本身照样算成功）。

**为什么依赖是一个 fork，不是 npm 上的原始 `markdown-docx`**：比较过 Pandoc（原生/WASM）和几个纯 JS 的 Markdown→docx 库之后选了 [vace/markdown-docx](https://github.com/vace/markdown-docx)（MIT 协议，纯 JS、无原生依赖、体积小），但实测发现两个真实问题：图片按原始像素直接换算成 Word 单位，不会自动适配页面宽度（一张 1600px 宽的截图会变成 16 英寸+，严重溢出页面）；YAML frontmatter 没有被识别，会原样渲染成正文里的一段乱码文字。这两个问题都提了 PR 到 [zhangyingfeng/markdown-docx](https://github.com/zhangyingfeng/markdown-docx)（保留 git 历史的正式 fork，不是拷贝代码）修掉——`imageMaxWidth`/`imageMaxHeight`（默认 600×800px，等比缩放，不放大）和 `stripFrontmatter`（默认开启）都是新增的可选项，默认行为之外原有功能不受影响。`package.json` 里 `markdown-docx` 依赖固定在这个 fork 的某个 commit（`github:zhangyingfeng/markdown-docx#<sha>`），不是 npm 官方源；以后 upstream 修 bug，走 `git fetch upstream && git merge` 正常同步，不需要重新对比整份代码。

**为什么 sidecar 体积没有大幅增加**：`markdown-docx` 依赖 `katex`（数学公式渲染），但知乎内容里的公式在抓取时已经被知乎自己渲染成图片，导出的 Markdown 里从来不会出现真正的 LaTeX 源码——`katex.renderToString` 这条调用路径对知档来说是可以证明永远不会被执行到的死代码，但因为是模块顶层的静态 `import`，普通打包器还是会把整个 katex 老老实实打进最终产物。`scripts/build-sidecar-compile.mjs` 用 Bun 的 `onResolve` 插件（[Bun 插件文档](https://bun.com/docs/bundler/plugins.md)）在打包这一步把 `import "katex"` 重定向到 `scripts/katex-stub.mjs`（一个几行的空壳模块，真被调用到会直接抛错而不是默默返回错误数据）——这个替换只发生在知档自己的构建脚本里，`markdown-docx` 本身完全没改。`bun build ... --compile` 这个 CLI 命令不支持传插件，所以 `build-sidecar.sh` 改成调用 `build-sidecar-compile.mjs`，用 `Bun.build()` 的编程式 API（同时支持 `compile` 和 `plugins`）代替直接跑 CLI。

## 导出任务列表与控制接口

前端展示的不是单一进度条，而是一份任务列表——`GET /api/status` 返回的 `progress.tasks` 数组，每一项对应一个 `ExportTask`（`src/types.ts`）：状态（`pending`/`active`/`done`/`error`/`skipped`）、`images`/`write`/`word` 三个子任务各自的状态，以及可选的 `duplicate` 字段。

**重复检测**：`src/server.ts` 在拿到完整列表后，对每一项正文做 `contentHash`（`src/util.ts`，先用 `normalizePlainText` 去标签、合并空白，再取 SHA-256）分组，哈希相同的项互相标记为 `duplicate`。这是精确匹配，不做任何相似度/语义判断，纯粹是给用户看的提示——本身不会跳过或合并任何内容。这一步依赖列表阶段就拿到全文——key edition 的列表接口只有摘要，`html` 要等 `fetchBody`（受配额限制）才有，所以这一步对 key edition 目前是静默跳过（每一项 `normalizePlainText("").length` 恒为 0，直接被 `MIN_DEDUP_TEXT_LENGTH` 过滤掉），不会产出任何 `duplicate` 标记，也不会报错。

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

以下针对 login edition（见上一节）；key edition 使用知乎官方开放平台，不受"网页接口变化"和"验证码"这两条限制，但受官方每日配额约束。

- 知乎没有为 login edition 提供正式 API；网页接口字段或安全策略变化时可能需要更新。
- 已删除、仅自己可见或受平台限制的内容取决于当前账号实际可访问的数据。
- 暂停/继续导出限于当前这次运行的进程内；退出应用后再打开，只能靠指向同一个输出目录来续传，不是真正的"后台持续下载"。
- 首次大量导出可能触发正常的安全验证；项目不会尝试绕过验证。
- 目前只在 macOS（Apple Silicon）上完整测试过；Windows、Linux 和 Intel Mac 尚未验证。

以下针对 key edition：

- 不产出精确重复检测的 `duplicate` 标记（原因见"导出任务列表与控制接口"一节的"重复检测"）。
- 没有账号昵称——用户不手动填知乎主页地址的话，欢迎语和文件夹默认名都用不了真实身份，参见"两版功能上的区别"表。
- 每天"创作能力"配额有限（100 次，未实名 10 次），大账号一次导出不完，需要跨天多次点击"开始导出"续传。
- Mac App Store 相关的签名、entitlements、公证、提交流程尚未开始，`tauri:key` 目前只能本地打包验证。

## 遇到问题

先查看[故障排查手册](TROUBLESHOOTING.md)。其中包括：

- 登录窗口无法打开或打开后关闭；
- 旧进程占用 4317（login）/ 4318（key）端口；
- 源码已更新但仍在运行旧版本；
- 安全验证页被返回而不是 JSON；
- 接口总数与去重后数量不同；
- 图片、封面或收藏数缺失；
- 导出目录被拒绝；
- 第三方接口字段变化。

历史问题及其修复方式见 [Bug 修复记录](BUGFIXES.md)。提交新问题前请使用仓库 Issue 模板，并删除凭证、账号标识和真实内容。
