# 发布与维护指南

用户问题先按 [TROUBLESHOOTING.md](TROUBLESHOOTING.md) 排查。确认是代码缺陷后，在 [BUGFIXES.md](BUGFIXES.md) 记录现象、根因、修复和防回归要求。

## 版本规则

使用语义化版本：

- PATCH：修复且不改变导出格式；
- MINOR：向后兼容的新字段或功能；
- MAJOR：破坏现有命令、行为或导出结构。

破坏`index.json`兼容性的变更必须提升`schemaVersion`。

发布时在`package.json`确定的版本号上打 Git tag（如`v0.3.2`）并推送，再在GitHub上创建对应的Release，附上CHANGELOG中该版本的条目。

### 两个 edition 一起发布

两版共用一个版本号、一个 tag、一个 Release，各自的 `.app`/`.dmg` 作为两个附件挂在同一个 Release 上——不要开两个 tag 或两个 Release。

两个 edition 的 `tauri build` 都输出到同一个 `src-tauri/target/release/bundle/`（`-f key`/`--config` 只切 Cargo feature 和 bundle 配置，不切 target 目录），产出的 `.dmg` 默认文件名也相同（productName 里的中文字符会被去掉，只剩版本号和架构）——所以必须**建完一个就立刻搬走**，不能等两个都建完再搬，否则第二次构建会直接覆盖第一次的产物：

```bash
npm run build:sidecar:login && npx tauri build
mv src-tauri/target/release/bundle/dmg/*.dmg zhidang-login_<version>_aarch64.dmg

npm run build:sidecar:key && npm run tauri:key
mv src-tauri/target/release/bundle/dmg/*.dmg zhidang-key_<version>_aarch64.dmg

gh release create vX.Y.Z zhidang-login_*.dmg zhidang-key_*.dmg --title "vX.Y.Z" --notes-file <(sed -n '/## X.Y.Z/,/## /p' docs/CHANGELOG.md | sed '1d;$d')
```

`site/index.html` 的下载按钮靠文件名里有没有 `key` 来区分两个 `.dmg`——改名字时不要偏离这个约定，否则官网的自动识别会失效（退化成两个按钮都指向 `releases/latest`，不是报错，但用户体验变差）。

## 每次维护

1. 从`main`创建短分支；
2. 让修改保持单一目的；
3. 添加或更新合成测试；
4. 运行测试和构建；
5. 更新CHANGELOG；
6. 如果修复用户可见Bug，同时更新故障排查和Bug修复记录；
7. 通过PR合并，不直接在公共`main`上试验；
8. 不把真实接口响应和账号数据放入Issue或PR。

## 使用Codex维护

在仓库根目录启动Codex，使其自动读取`AGENTS.md`。建议按任务给出明确指令，例如：

```text
检查当前Issue，修复图片下载失败报告。不要改变导出schema；运行测试和构建，但不要提交或推送。
```

审查结果后，再要求：

```text
为已经验证的修改更新CHANGELOG，创建提交，但不要推送。
```

最后确认分支和提交内容，再明确要求推送或创建PR。不要把登录会话、真实导出目录或凭证提供给Codex。

## 第三方接口变化

当接口字段变化时：

1. 先用经过脱敏的最小结构复现；
2. 保留旧字段的降级处理；
3. 缺失统计值使用`null`，不要伪造零；
4. 接口形状无法确认时停止导出并报告错误；
5. 不通过规避安全验证来恢复功能。
