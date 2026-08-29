# 开发者文档

面向想从源码运行、构建知档，或基于导出归档开发其他工具的开发者。普通用户请看[图文教程](GETTING_STARTED.md)。

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
npm test        # 后端单元测试
npx tauri dev    # 启动完整桌面应用
npx tauri build  # 打包独立 .app / .dmg
```

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

`index.json` 是供其他工具直接读取的索引。`export-report.json` 记录发现、成功、失败数量，以及文章和图片失败详情。收藏数在接口没有返回时保存为 `null`，不会伪装成零。

归档格式被视为项目的长期数据层，目标是让归档满足这些要求：

- 作者可以完整保存自己的回答、文章和图片；
- 内容使用 Markdown、JSON 和普通图片等开放格式；
- 归档可以在没有知乎、没有任何服务端的情况下继续读取；
- 数据结构清晰、可验证，能够被其他软件重新使用；
- 平台只是内容来源之一，而不是作品唯一的长期存放地点。

因此 `index.json` 和导出的 Markdown 都按长期数据格式对待，破坏兼容性的修改必须经过明确的 schema 版本设计。任何读取归档的工具都应直接使用已导出的本地数据，而不是要求用户重新访问知乎。

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
- 本版本只执行完整导出，不会覆盖非空目录，也不把覆盖旧目录冒充成增量更新；导出中途只能等待完成，暂停/继续导出正在规划中。
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
