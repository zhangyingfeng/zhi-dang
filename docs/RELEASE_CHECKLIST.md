# 发布前检查清单

这份清单存在的原因：1.1 系列开发过程中，"断点续传到底测没测过中断场景"这类问题来回确认了好几轮，靠记忆判断"应该测过了"不可靠。下面这些是自动化测试覆盖不到、必须在真机上手动确认的项目——`npm test` 能拦住的问题不在这里重复列。

只在**发布正式版（去掉 preview 后缀）**前完整走一遍；preview 版本按需酌情跳过明显不相关的项。

## 每次发布都要过的

两个 edition 都要各跑一遍下面这些项目——不是共用一次结果，`login`/`key` 走的是完全不同的登录和数据获取代码路径。

- [ ] `npm test` 全绿（后端测试 + 前端 jsdom 测试 + DOM 引用检查）
- [ ] `cargo check --locked` 和 `cargo check --locked --features key`（`src-tauri/`）都通过
- [ ] **login**：登录 → 导出 → 查看结果完整走一遍，全程用真机上的 `tauri dev` 或者打包后的 `.app`，不能只看浏览器预览（`AccentColor` 这类系统色、真实通知中心、Gatekeeper 都是浏览器测不出来的，见 `docs/BUGFIXES.md` 里已经吃过的亏）
- [ ] **key**：用一个真实的 Access Secret（`developer.zhihu.com/profile` 生成）走一遍"验证并登录 → 导出 → 查看结果"，全程用 `npm run tauri:key:dev` 或打包后的 `.app`——这是唯一能验证"真的连得上知乎官方接口"的方式，自动化测试全部是 mock 过的
- [ ] 两个 edition 分别退出登录：任务列表、状态卡片、保存位置都要恢复成未登录前的样子，且不能有任何报错弹出

## 涉及任务管理功能时（暂停/跳过/续传相关改动）

- [ ] 暂停/继续：暂停后确认没有新条目开始处理，继续后能接着跑
- [ ] 单项跳过 / 图片跳过：跳过的项在 `export-report.json` 的 `skippedItems` 里，且没有被下载
- [ ] **断点续传，真实中断场景**——导出到一半，直接强制退出应用（不是正常退出），重新打开，保存位置指向同一个目录，点"开始导出"：
  - 已完成的项不能重新下载（对比文件的修改时间，或看任务列表里这些项是不是直接显示"完成"）
  - 没完成的项能继续处理
  - `index.json`/`export-report.json` 内容完整，不是半截的

## 涉及密钥版配额逻辑时（quota 相关改动）

- [ ] 登录时额度已经是 0：立刻弹 toast 提示，"开始导出"按钮直接不可点，不需要先点一下才知道
- [ ] 导出中途额度用完：跳出弹窗提醒，不是只改一行文字；已经成功的项目在 `index.json` 里原样保留（对比文件修改时间——不应该被重新下载），没做的项目保持 `pending`
- [ ] 额度用完后关掉应用重开，"保存位置"指向同一目录再次点"开始导出"：已完成的项目不重新消耗额度

## 涉及打包分发时

两个 edition 各自打包、各自测——`.app` 内部代码完全不同（key 版没有登录窗口/会话中继）。

- [ ] `npx tauri build`（login）和 `npm run tauri:key`（key）产出的 `.dmg`，都当成陌生用户下载测试——不能只用本地 `open` 打开，必须模拟真实下载：
  ```bash
  xattr -w com.apple.quarantine "0083;$(date +%s);Safari;" 知档.app
  ```
  然后双击打开，确认走的是预期的"系统设置 → 隐私与安全性 → 仍要打开"两步流程，不是"已损坏，无法打开"（`docs/BUGFIXES.md` 的 preview.6 那次教训）
- [ ] 两个 `.app` 分别 `codesign --verify --deep --strict` 通过，且 `codesign -dv` 显示的 `Sealed Resources` 不是 `none`
- [ ] 两个 `.dmg` 按 `docs/MAINTENANCE.md`"两个 edition 一起发布"里的约定改好文件名（`zhidang-login_*`/`zhidang-key_*`）再上传——文件名不对会互相覆盖，网站的下载按钮也认不出来

## 涉及系统通知时

- [ ] 首次导出触发通知权限请求，允许后，导出完成确实收到系统通知
- [ ] 通知内容和状态卡片汇总信息一致，不包含正文内容

## 发布动作本身

- [ ] 版本号五处同步（`package.json`、`package-lock.json`、`src-tauri/Cargo.toml`、`src-tauri/Cargo.lock`、`src-tauri/tauri.conf.json`）
- [ ] `docs/CHANGELOG.md` 更新
- [ ] 正式版（非 preview）额外检查：`docs/ROADMAP.md`、`site/index.html` 落地页里的版本/状态描述是否需要同步更新
- [ ] 两个 `.dmg` 都挂在同一个 Release 上（一个 tag，见 `docs/MAINTENANCE.md`），不要开两个 Release
- [ ] `gh release create` 之后确认 `isPrerelease` 状态符合预期（正式版不能带 `--prerelease`），`gh api repos/.../releases/latest` 返回的确实是这次发布的 tag，且 assets 里能看到两个 `.dmg`
