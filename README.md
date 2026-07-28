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

- `content/*.json`：唯一课程内容源
- `doc/`：框架设计与 roadmap
- `scripts/`：校验和静态站生成器
- `_site/`：自动生成的发布目录，不提交
- `assets/styles.css`：全站样式
- `assets/app.js`：共享棋盘交互
- `assets/pieces/`：透明贴纸棋子素材

## Hermes 更新流程

1. 只新增一个 `content/YYYY-MM-DD-topic.json`。
2. 运行 `npm test`，查看字段、步骤、胜率和生成链接检查。
3. 运行 `npm run publish:root` 生成 `_site/`，并把生成的 HTML 同步到仓库根目录。
4. 在本地服务器中预览，并在手机宽度下实走全部步骤。
5. 提交 JSON 并推送到 `main`。

GitHub Actions 会自动校验并构建 `_site/`。当前 GitHub Pages 使用 `main` 根目录发布，所以新增课程不再手工编辑 HTML，但提交前需运行 `npm run publish:root`。

## 本地命令

```bash
npm run validate
npm test
npm run build
npm run publish:root
```

详细字段与失败诊断见 [`doc/DESIGN.md`](doc/DESIGN.md)，迭代计划见 [`doc/ROADMAP.md`](doc/ROADMAP.md)。
