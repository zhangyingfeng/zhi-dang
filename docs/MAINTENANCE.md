# 发布与维护指南

用户问题先按 [TROUBLESHOOTING.md](TROUBLESHOOTING.md) 排查。确认是代码缺陷后，在 [BUGFIXES.md](BUGFIXES.md) 记录现象、根因、修复和防回归要求。

## 首次发布

1. 将README和Issue模板中的`USERNAME`替换为GitHub用户名。
2. 在本机运行`npm ci`、`npm test`和`npm run build`。
3. 使用一个新的测试账号环境执行完整导出，确认数量、图片、封面和`export-report.json`。
4. 运行隐私检查，确认没有`.data`、导出内容、Cookie、Token、姓名、网站、邮箱或本地绝对路径。
5. 创建空的公开GitHub仓库`zhi-dang`，不要自动生成README或许可证。
6. 初始化仓库、提交、设置远程地址并推送`main`。
7. 在仓库设置中启用Private vulnerability reporting。
8. 等待GitHub Actions通过后，按`package.json`中的当前版本创建Release。

## 版本规则

使用语义化版本：

- PATCH：修复且不改变导出格式；
- MINOR：向后兼容的新字段或功能；
- MAJOR：破坏现有命令、行为或导出结构。

破坏`index.json`兼容性的变更必须提升`schemaVersion`。

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
