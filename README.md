<p align="center"><img src="assets/app-icon.png" width="96" alt="知档图标"></p>

# 知档

「知档」，即知乎作者归档。一个安全、开源的内容导出工具，方便作者把知乎上自己的内容归档导出为 Markdown、JSON 和本地图片。

「知档」从一个很具体的问题开始：作者在内容平台上长期创作之后，如何把自己的作品完整、安全地保存下来，并继续由自己控制。

「知档」的回答是：**把作者自己的知乎创作，转换成开放、可读、可迁移、由作者自己保管的本地归档。**

## 设计原则

无论「知档」发展到什么程度，都保持以下原则：

- **平台独立**：知乎是当前的内容来源，但数据模型不应永远绑定于某个平台的页面结构。
- **本地优先**：作者应能取得自己的完整数据，并能在没有任何云服务的情况下继续使用。
- **安全隐私**：登录信息、Cookie 和导出内容默认只保存在本机，由作者控制，不自动上传；不加入遥测、远程日志或用户内容上传。
- **开放格式**：内容和元数据优先采用公开、可迁移的格式，不制造新的平台锁定。

## 使用边界

- 只用于导出本人创作或已经获得授权的内容。
- 不提供验证码绕过、访问控制规避、代理池或账号池。
- 不下载评论正文、粉丝列表、关注关系或其他用户资料。
- 遇到登录失效或安全验证时停止，由用户在登录窗口中正常完成验证。
- 这是独立开发的非官方项目，与知乎不存在隶属、合作、授权或认可关系。

使用者有责任遵守适用法律、著作权规则和平台条款。详见 [DISCLAIMER.md](docs/DISCLAIMER.md) 和 [ACCEPTABLE_USE.md](docs/ACCEPTABLE_USE.md)。
开发计划见 [ROADMAP.md](docs/ROADMAP.md)。

## 如何安装使用？

「知档」是独立桌面应用，不需要安装 Node.js、Chrome 或任何开发工具（当前只提供 macOS，Apple Silicon）。

下载、安装和每一步操作见[图文教程](docs/GETTING_STARTED.md)。


## 开发者如何使用？

从源码运行、构建、导出格式、隐私实现和故障排查见[开发者文档](docs/DEVELOPMENT.md)。贡献前请阅读 [CONTRIBUTING.md](docs/CONTRIBUTING.md)。

## 参考与致谢

开发过程中参考过以下开源项目的设计和实现思路：

- [youngfish42/zhihuhelp_with_node](https://github.com/youngfish42/zhihuhelp_with_node)：分页任务、内容归档和电子书生成思路；
- [zhangolve/zhihu-answer-convert-to-md-by-node](https://github.com/zhangolve/zhihu-answer-convert-to-md-by-node)：知乎回答数据转换为 Markdown 的思路；
- [qtqz/zhihu-backup-collect](https://github.com/qtqz/zhihu-backup-collect)：图片本地化和 Markdown 元数据组织思路。

本项目为独立实现，不包含或派生自上述项目的源代码。上述项目各自适用其原有许可证。

本项目同时直接使用 Tauri、Express、Turndown、Zod 等开源依赖，桌面端打包使用 Bun 把后端编译为独立可执行文件。
具体版本见 `package.json`、`package-lock.json` 和 `src-tauri/Cargo.toml`。

## 许可证

本项目使用 [MIT 协议](LICENSE)，允许任何人免费复制、修改、发布、使用或销售，需保留版权声明和许可声明。软件按现状提供，不附带担保。
