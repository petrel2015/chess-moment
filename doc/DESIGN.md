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
- 互动挑战：FEN、目标、用户步骤、对手自动回应、逐步讲解、胜率、错误解释和快捷问答。
- 复盘：关键步骤与可迁移原则。
- 可选标签：`tags`（字符串数组，用于展示与未来的路径浏览）、`prerequisites`（slug 数组，指向先修课程，校验器会检查死链）。

### 走法与特殊规则

走法用 UCI 字符串：普通走法 4 字符（如 `e2e4`），兵升变 5 字符（末位 `q`/`r`/`b`/`n` 指定升变棋子，如 `e7e8q` 升后、`a2a1r` 升车）。王车易位用王的 from→to 表示：`e1g1`（白短易位）、`e1c1`（白长易位）、`e8g8`/`e8c8`（黑）。

FEN 第 3 段（易位权 `KQkq`）与第 4 段（吃过路兵目标格）由规则引擎解析并维护。

### 步骤的字段

每个 `challenge.steps[i]` 至少含 `move`（正解走法）、`opponent`（可选，对手自动回应）、`note`（讲解）。可选 `alternatives` 数组表示「合理但非最优」的候选着：`[{ move, note }]`，命中时给出讲解（琥珀色反馈）但不推进进度，用户可继续寻找正解。

页面会把 `challenge` 内嵌为 `window.CHESS_LESSON`，共享的 `assets/app.js` 负责棋盘、拖动、合法格、红绿圈、胜率、将军动画、tooltip 和教练问答。规则引擎抽取在 `assets/chess-engine.mjs`，覆盖王车易位、兵升变、吃过路兵与将军/将死判定，由 `tests/engine.test.mjs` 守护。

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
- `invalid move`：走法不是 `e2e4` 或 `e7e8q`（升变）形式。
- `odds ... do not sum to 100`：某一步胜率未归一。
- `suggestion ... has no answer`：快捷问题没有对应答案。

构建先删除 `_site/` 再完整生成，因此重复执行幂等，不会残留已经删除的文章。
