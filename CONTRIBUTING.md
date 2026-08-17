# 贡献指南

## 开始之前

```bash
npm ci
npm test
npm run build
```

## Pull Request要求

- 一次PR解决一个清晰问题；
- 说明行为变化和验证方法；
- 修改导出字段时同步更新类型、README、测试和`schemaVersion`；
- 不提交真实账号、文章、图片、Cookie、Token、浏览器Profile或本地绝对路径；
- 测试数据必须是虚构或自行创建的；
- 不增加验证码绕过、代理池、账号池或访问控制规避功能；
- 不把失败静默吞掉；失败应进入可读日志或导出报告；
- 保持本地运行，不引入遥测和远程数据上传。

## 提交信息

建议使用简短的命令式描述，例如：

```text
fix: report failed image downloads
test: cover pagination edge cases
docs: clarify local session cleanup
```
