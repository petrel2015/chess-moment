# Chess Moment JSON 内容框架设计

## 目标

内容作者或 Hermes 以后只新增 `content/*.json`。页面结构、棋盘、历史列表、移动反馈、快捷问答和部署流程均由确定性代码处理。

## 数据流

```text
content/*.json
  -> scripts/validate-content.mjs
  -> scripts/build-site.mjs
  -> _site/index.html + _site/<slug>.html
  -> GitHub Pages
```

`publishedAt` 最新且通过校验的课程自动成为首页；其余课程自动进入历史列表。

## JSON 分区

- 基本信息：`slug`、发布时间、早晚报、分类、标题、摘要、难度和预计时长。
- 叙事内容：`introduction` 与 `culture`。
- 互动挑战：FEN、目标、五个用户步骤、对手自动回应、逐步讲解、胜率、错误解释和快捷问答。
- 复盘：关键步骤与可迁移原则。

页面会把 `challenge` 内嵌为 `window.CHESS_LESSON`，共享的 `assets/app.js` 继续负责棋盘、拖动、合法格、红绿圈、胜率、将军动画、tooltip 和教练问答。

## 确定性边界

- 构建、字段检查、FEN 基本格式、走法格式、胜率和链接由代码完成。
- 模型只负责草拟叙事、错误解释和文化背景。
- 不在静态页面中放模型 API Key。
- 所有模型生成内容必须经过 `npm test` 和浏览器实走。

## 新增一期

1. 复制一份 JSON，改名为 `YYYY-MM-DD-topic.json`。
2. 设置唯一 `slug` 和 `publishedAt`。
3. 填写至少三个、建议五个用户步骤；对手回应写入 `opponent`。
4. 为每一步填写 `note`，为常见错误填写 `errors` 或 `genericError`。
5. 运行 `npm test && npm run build`。
6. 本地用 `npm run preview` 实走所有步骤。
7. 推送 `main`，GitHub Actions 自动部署。

## 失败诊断

校验器输出 `文件名: 原因`。常见问题：

- `duplicate slug`：文章 URL 重复。
- `invalid FEN`：FEN 不包含八行棋盘或行棋方。
- `invalid move`：走法不是 `e2e4` 形式。
- `odds ... do not sum to 100`：某一步胜率未归一。
- `suggestion ... has no answer`：快捷问题没有对应答案。

构建先删除 `_site/` 再完整生成，因此重复执行幂等，不会残留已经删除的文章。
