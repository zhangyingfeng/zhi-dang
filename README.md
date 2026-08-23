<p align="center"><img src="assets/app-icon.png" width="96" alt="知档图标"></p>

# 知档

知档，即知乎作者归档。一个非官方、仅在本机运行的个人内容导出工具。应用内置一个登录窗口，用户在其中正常登录知乎后，即可将当前账号本人发布的回答和文章导出为 Markdown、JSON 和本地图片。

当前项目首先专注于一件事：**完整、安全、可靠地保存作者自己的知乎创作。**

未来可能在稳定归档的基础上继续发展个人网站生成、内容编辑、版本管理和个人写作模型等能力，但这些方向不会取代当前对归档可靠性的优先投入。近期计划见 [ROADMAP.md](ROADMAP.md)，长期方向见 [VISION.md](VISION.md)。

## 使用边界

- 只用于导出本人创作或已经获得授权的内容。
- 不提供验证码绕过、访问控制规避、代理池或账号池。
- 不下载评论正文、粉丝列表、关注关系或其他用户资料。
- 遇到登录失效或安全验证时停止，由用户在登录窗口中正常完成验证。
- 这是独立开发的非官方项目，与知乎不存在隶属、合作、授权或认可关系。

使用者有责任遵守适用法律、著作权规则和平台条款。详见 [DISCLAIMER.md](DISCLAIMER.md) 和 [ACCEPTABLE_USE.md](ACCEPTABLE_USE.md)。

## 使用

知档是一个独立的桌面应用，不需要安装 Node.js、Chrome 或任何开发工具：

1. 从 [Releases](https://github.com/zhangyingfeng/zhi-dang/releases) 下载安装包（当前只提供 macOS，Apple Silicon）。
2. 首次打开：因为应用尚未完成 Apple 开发者签名，macOS 会提示"无法验证开发者"；在"系统设置 → 隐私与安全性"里选择"仍要打开"即可，只需要做一次。
3. 打开后直接就是导出设置界面；未登录时下方的选项都是禁用状态，点右上角的"开始登录"。
4. 在弹出的窗口中正常登录知乎；登录成功后窗口会自动关闭，界面标题会变成"欢迎 [昵称]，可以下载"，各项设置随之可用。
5. 确认保存位置——默认按当前知乎账号自动命名，不同账号登录时会使用不同的默认目录，避免混在一起；需要的话点"浏览…"改成其他位置。
6. 点击"开始导出"。

只要没有点过"退出登录"，下次重新打开应用会记住登录状态，直接进入可用界面，不需要再登录一次。要退出当前账号、换成另一个知乎账号导出，点右上角的"退出登录"，再重新登录即可。

每一步的实际界面截图见[图文教程](docs/GETTING_STARTED.md)。

## 从源码运行（开发者）

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

`index.json` 是网站或其他工具可直接读取的索引。`export-report.json` 记录发现、成功、失败数量，以及文章和图片失败详情。收藏数在接口没有返回时保存为 `null`，不会伪装成零。

归档格式被视为项目的长期数据层。未来即使增加网站生成或其他输出形式，也应优先直接读取已有归档，而不是要求用户重新访问知乎。

## 隐私和安全

- 应用不接收、记录或上传密码。
- 登录在应用内置的登录窗口中完成，密码不经过本应用的后端；登录会话由系统自带的 WebView 管理和持久化（macOS 上是 WKWebView），保存路径在 `~/Library/WebKit/` 下，与浏览器/其他应用相互隔离。
- 想清除登录状态，点应用里的"退出登录"即可；这会清空该会话在系统 WebView 中的全部数据。
- 导出索引不保存账号姓名、简介或账号标识。
- 本地服务只监听 `127.0.0.1`，不对外暴露端口。

完整说明见 [PRIVACY.md](PRIVACY.md) 和 [SECURITY.md](SECURITY.md)。

## 遇到问题

先查看 [故障排查手册](docs/TROUBLESHOOTING.md)。其中包括：

- 登录窗口无法打开或打开后关闭；
- 旧进程占用 4317 端口；
- 源码已更新但仍在运行旧版本；
- 安全验证页被返回而不是 JSON；
- 接口总数与去重后数量不同；
- 图片、封面或收藏数缺失；
- 导出目录被拒绝；
- 第三方接口字段变化。

历史问题及其修复方式见 [Bug 修复记录](docs/BUGFIXES.md)。提交新问题前请使用仓库 Issue 模板，并删除凭证、账号标识和真实内容。

## 图片处理

- 优先使用 `data-original` 和 `data-actualsrc` 中的真实图片地址。
- 清理 `noscript` 备用图片，避免同一图片重复显示。
- 图片按完整内容的 SHA-256 哈希命名，相同内容自动去重。
- 下载失败自动重试三次，之后写入 `export-report.json`。
- 下载失败时保留远程图片地址，不静默伪装成本地成功。

## 已知限制

- 知乎没有为本项目提供正式 API；网页接口字段或安全策略变化时可能需要更新。
- 已删除、仅自己可见或受平台限制的内容取决于当前账号实际可访问的数据。
- 本版本只执行完整导出，不会覆盖非空目录，也不把覆盖旧目录冒充成增量更新；导出中途只能等待完成，暂停/继续导出正在规划中。
- 首次大量导出可能触发正常的安全验证；项目不会尝试绕过验证。
- 目前只在 macOS（Apple Silicon）上完整测试过；Windows、Linux 和 Intel Mac 尚未验证。
- 尚未完成 Apple 开发者签名，首次打开需要在系统设置里手动允许一次。

## 开发

```bash
npm test        # 后端单元测试
npx tauri dev    # 启动完整桌面应用
npx tauri build  # 打包独立 .app / .dmg
```

贡献前请阅读 [CONTRIBUTING.md](CONTRIBUTING.md)。使用 Codex 等编码工具维护时，请同时遵守 [AGENTS.md](AGENTS.md) 中的仓库约束。

项目当前优先级和未来阶段见 [ROADMAP.md](ROADMAP.md)。更长期的产品方向见 [VISION.md](VISION.md)。

## 参考与致谢

开发过程中参考过以下开源项目的设计和实现思路：

- [youngfish42/zhihuhelp_with_node](https://github.com/youngfish42/zhihuhelp_with_node)：分页任务、内容归档和电子书生成思路；
- [zhangolve/zhihu-answer-convert-to-md-by-node](https://github.com/zhangolve/zhihu-answer-convert-to-md-by-node)：知乎回答数据转换为 Markdown 的思路；
- [qtqz/zhihu-backup-collect](https://github.com/qtqz/zhihu-backup-collect)：图片本地化和 Markdown 元数据组织思路。

本项目为独立实现，不包含或派生自上述项目的源代码。上述项目各自适用其原有许可证。

本项目同时直接使用 Tauri、Express、Turndown、Zod 等开源依赖，桌面端打包使用 Bun 把后端编译为独立可执行文件。具体版本见 `package.json`、`package-lock.json` 和 `src-tauri/Cargo.toml`。

## 许可证

本项目使用 [Unlicense](UNLICENSE)，在法律允许的范围内贡献给公共领域，允许任何人复制、修改、发布、使用或销售，不要求署名。软件按现状提供，不附带担保。
