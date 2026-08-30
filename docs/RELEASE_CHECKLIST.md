# 发布前检查清单

这份清单存在的原因：1.1 系列开发过程中，"断点续传到底测没测过中断场景"这类问题来回确认了好几轮，靠记忆判断"应该测过了"不可靠。下面这些是自动化测试覆盖不到、必须在真机上手动确认的项目——`npm test` 能拦住的问题不在这里重复列。

只在**发布正式版（去掉 preview 后缀）**前完整走一遍；preview 版本按需酌情跳过明显不相关的项。

## 每次发布都要过的

- [ ] `npm test` 全绿（后端测试 + 前端 jsdom 测试 + DOM 引用检查）
- [ ] `cargo check --locked`（`src-tauri/`）通过
- [ ] 登录 → 导出 → 查看结果完整走一遍，全程用真机上的 `tauri dev` 或者打包后的 `.app`，不能只看浏览器预览（`AccentColor` 这类系统色、真实通知中心、Gatekeeper 都是浏览器测不出来的，见 `docs/BUGFIXES.md` 里已经吃过的亏）
- [ ] 退出登录：任务列表、状态卡片、保存位置都要恢复成未登录前的样子，且不能有任何报错弹出

## 涉及任务管理功能时（暂停/跳过/续传相关改动）

- [ ] 暂停/继续：暂停后确认没有新条目开始处理，继续后能接着跑
- [ ] 单项跳过 / 图片跳过：跳过的项在 `export-report.json` 的 `skippedItems` 里，且没有被下载
- [ ] **断点续传，真实中断场景**——导出到一半，直接强制退出应用（不是正常退出），重新打开，保存位置指向同一个目录，点"开始导出"：
  - 已完成的项不能重新下载（对比文件的修改时间，或看任务列表里这些项是不是直接显示"完成"）
  - 没完成的项能继续处理
  - `index.json`/`export-report.json` 内容完整，不是半截的

## 涉及打包分发时

- [ ] `npm run tauri build` 产出的 `.dmg`，当成陌生用户下载测试——不能只用本地 `open` 打开，必须模拟真实下载：
  ```bash
  xattr -w com.apple.quarantine "0083;$(date +%s);Safari;" 知档.app
  ```
  然后双击打开，确认走的是预期的"系统设置 → 隐私与安全性 → 仍要打开"两步流程，不是"已损坏，无法打开"（`docs/BUGFIXES.md` 的 preview.6 那次教训）
- [ ] `codesign --verify --deep --strict 知档.app` 通过，且 `codesign -dv` 显示的 `Sealed Resources` 不是 `none`

## 涉及系统通知时

- [ ] 首次导出触发通知权限请求，允许后，导出完成确实收到系统通知
- [ ] 通知内容和状态卡片汇总信息一致，不包含正文内容

## 发布动作本身

- [ ] 版本号五处同步（`package.json`、`package-lock.json`、`src-tauri/Cargo.toml`、`src-tauri/Cargo.lock`、`src-tauri/tauri.conf.json`）
- [ ] `docs/CHANGELOG.md` 更新
- [ ] 正式版（非 preview）额外检查：`docs/ROADMAP.md`、`site/index.html` 落地页里的版本/状态描述是否需要同步更新
- [ ] `gh release create` 之后确认 `isPrerelease` 状态符合预期（正式版不能带 `--prerelease`），`gh api repos/.../releases/latest` 返回的确实是这次发布的 tag
