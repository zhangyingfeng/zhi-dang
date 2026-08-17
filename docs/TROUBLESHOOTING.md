# 故障排查手册

按照“现象—检查—处理”的顺序排查。命令应在项目根目录运行。

## 登录按钮提示目标页面、上下文或浏览器已关闭

错误示例：

```text
page.goto: Target page, context or browser has been closed
```

### 先确认是否运行旧进程

macOS或Linux：

```bash
lsof -nP -iTCP:4317 -sTCP:LISTEN
```

如果有输出，记录PID并正常停止对应进程：

```bash
kill <PID>
```

重新确认端口已经释放，然后运行：

```bash
npm run dev
```

### 确认运行的是新代码

```bash
grep -n 'context.once' src/zhihu.ts
grep -n 'context.once' dist/src/zhihu.js
```

如果源码中存在、`dist`中不存在：

```bash
npm run build
npm start
```

开发排查时优先使用`npm run dev`，它直接运行源码，避免旧`dist`造成混淆。

### 专用浏览器Profile异常

完全停止服务并关闭工具打开的Chrome窗口，然后把Profile改名保留：

```bash
mv .data/browser-profile .data/browser-profile-backup
```

重新运行后需要重新登录。确认新Profile正常后再自行处理备份目录。

## 端口已被占用

错误可能包含：

```text
EADDRINUSE: address already in use 127.0.0.1:4317
```

检查端口：

```bash
lsof -nP -iTCP:4317 -sTCP:LISTEN
```

停止旧项目进程后再启动。不要同时运行`npm start`和`npm run dev`。

## 没有弹出Chrome窗口

确认已安装Google Chrome，并检查终端中的完整错误。当前配置使用Playwright的`chrome`通道，而不是任意浏览器窗口。

如果依赖未完整安装：

```bash
npm ci
npm run dev
```

不要只根据网页弹窗判断；终端错误通常包含Chrome启动失败的具体原因。

## Chrome出现后立即关闭

常见原因：

- 旧服务仍在运行；
- 工具专用Profile被另一个进程占用；
- Chrome启动失败；
- 启动服务的终端进程已经退出。

先释放4317端口，再按前述方法备份`.data/browser-profile`，随后使用`npm run dev`观察终端。

## 显示登录失效或要求安全验证

工具不会绕过验证。切换到工具打开的Chrome窗口，正常完成登录或安全验证，然后回到本地页面点击“我已登录”。

如果一直失败：

1. 确认Chrome窗口没有被关闭；
2. 确认网络能够正常访问知乎；
3. 降低重复测试和导出频率；
4. 停止服务后重新打开；
5. 必要时备份并重建工具专用Profile。

不要提供Cookie、密码或验证码给Issue、维护者或编码工具。

## 显示“返回的不是内容JSON”

可能原因：

- 当前响应是登录页面；
- 当前响应是安全验证页面；
- 接口字段或响应结构发生变化；
- 请求被平台拒绝。

先在Chrome中完成正常验证。如果验证已经完成仍重复出现，应创建Issue并只提供：

- 工具版本；
- HTTP状态码；
- Content-Type；
- 已脱敏的字段名称结构。

不要提交完整响应、Cookie、账号ID或真实文章。

## 接口总数和导出数量不同

查看：

```text
exports/export-report.json
```

其中`listingReports`会包含：

```json
{
  "reportedTotal": 120,
  "received": 120,
  "unique": 119,
  "duplicates": 1,
  "warning": null
}
```

解释：

- `received`等于`reportedTotal`，但`unique`较少：分页中存在重复记录，通常不是漏下载；
- `received`小于`reportedTotal`：接口没有返回全部记录，报告会保留警告；
- `received`大于`reportedTotal`：接口总数在导出过程中可能变化，或存在分页重叠；
- `duplicates`大于零：重复ID已经去重，不会生成两篇相同内容。

对重要归档，应把唯一回答和文章数量与账号页面可见数量人工核对。

## 导出目录被拒绝

工具只写入不存在或为空的目录。请使用新目录，例如：

```text
exports-test-2
```

不要选择：

- 已有归档目录；
- 项目根目录；
- 用户主目录；
- 磁盘根目录；
- `.data`、`node_modules`或`dist`。

完整导出不会覆盖旧归档。当前版本也不提供增量合并。

## 部分图片没有下载

查看`export-report.json`中的`imageFailures`。工具已经对每张图片尝试三次；仍失败时保留远程地址并记录错误。

常见原因：

- 原图已经删除；
- 图片CDN暂时拒绝请求；
- URL过期；
- 网络中断；
- 返回的内容类型不是支持的图片格式。

不要只看导出任务是否完成，应同时检查`imageFailures`数量。

## 图片重复

最新版本会清理`noscript`备用图片，并按文件内容哈希去重。如果仍重复：

1. 确认运行的是最新版本；
2. 使用新的空目录重新导出；
3. 检查Markdown是否真的包含两条图片引用；
4. 区分“正文中作者确实重复使用同一图片”和“转换器生成重复节点”。

报告问题时使用虚构或脱敏HTML片段。

## 封面缺失

工具依次尝试：

1. 接口返回的`image_url`；
2. 接口返回的`thumbnail`；
3. 正文第一张有效图片。

三者都不存在时，`cover`为空属于正常情况。不要自动把无关占位图片当作封面。

## 收藏数为null

收藏字段不是稳定公开接口的一部分。接口没有返回时工具保存：

```json
"favoriteCount": null
```

这表示“未知”，不是零。网站和排序逻辑必须区分`null`与`0`。

## 测试或构建失败

确认Node版本：

```bash
node --version
nvm use
```

重新安装锁定依赖：

```bash
npm ci
npm test
npm run build
```

不要在没有更新`package-lock.json`的情况下手工修改依赖版本。

## 提交Issue前

请提供：

- 工具版本；
- 操作系统、Node和Chrome版本；
- 可重复步骤；
- 终端错误；
- 已脱敏的`export-report.json`相关小段。

请删除：

- Cookie、Token和密码；
- 账号标识；
- 真实文章和图片；
- `.data/browser-profile`；
- 本地绝对路径；
- 其他人的个人信息。
