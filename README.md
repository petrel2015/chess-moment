# 棋刻 Chess Moment

每天三分钟，想明白一步棋。

这是一个面向国际象棋初学者和业余爱好者的手机端互动早晚报。

每篇内容包含：

- 文化或历史背景
- 可点击走棋的互动挑战
- 错误走法解释
- 完成后的即时复盘
- 历史文章跳转

## 内容结构

- `index.html`：最新一期，也是 GitHub Pages 首页
- `*.html`：历史推送
- `assets/styles.css`：全站样式
- `assets/app.js`：棋盘交互与题目配置
- `assets/pieces/`：透明贴纸棋子素材

## Hermes 更新流程

1. 新增或更新文章 HTML。
2. 在 `assets/app.js` 中添加对应棋局配置。
3. 确认首页和历史文章链接正确。
4. 本地打开页面完成走棋检查。
5. 提交并推送到 `main` 分支。

GitHub Pages 会从 `main` 分支根目录自动更新，无需单独构建。
