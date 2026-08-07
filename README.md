# 棋刻 Chess Moment

每天三分钟，想明白一步棋。

这是一个面向国际象棋初学者和业余爱好者的手机端互动早晚报。

每篇内容包含：

- 文化或历史背景
- 可点击走棋的互动挑战
- 错误走法解释
- 完成后的即时复盘
- 历史文章跳转

## 双版本输出

一份课程数据（`content/*.json`）生成两种阅读形态：

1. **互动版**：保留点击/拖动走棋、即时红绿反馈、复盘与术语解释。
2. **公众号版**：纯文字 + 静态棋盘图 + 完整答案与讲解，适合微信正文。

公众号的"阅读原文"指向同一期的互动版页面，而非首页。

## 内容结构

- `content/*.json`：唯一课程内容源
- `doc/`：框架设计、公众号流水线设计、Hermes 运行手册
- `scripts/`：校验、构建器、公众号渲染器、PNG 生成器、微信发布适配器
- `_site/`：自动生成的发布目录，不提交
- `_artifacts/wechat/`：公众号 payload 和发布状态，不提交
- `assets/styles.css`：全站样式
- `assets/app.js`：共享棋盘交互
- `assets/pieces/`：透明贴纸棋子素材

## 本地命令

```bash
npm run validate              # 校验内容（含真实棋规验证）
npm test                      # 运行全部测试（串行执行，避免共享 _site 竞态）
npm run build                 # 构建双版本站点（互动 + 公众号 + PNG + payload）
npm run publish:root          # 构建并同步 HTML 到仓库根目录

# 微信发布适配器
npm run wechat:prepare -- --slug <slug> [--check-url]
npm run wechat:publish  -- --slug <slug> --mode dry-run
npm run wechat:status   -- --slug <slug>
npm run wechat:retry    -- --slug <slug> --mode <mode>
npm run wechat:list
```

## Hermes 更新流程

1. 只新增一个 `content/YYYY-MM-DD-topic.json`。
2. 运行 `npm test`，查看字段、步骤、胜率、棋规合法性和链接检查。
3. 运行 `npm run build` 生成 `_site/`（含互动页 + 公众号预览 + 棋盘 PNG + payload）。
4. 在本地服务器中预览，并在手机宽度下实走全部步骤。
5. 提交 JSON 并推送到 `main`。

详细字段与失败诊断见 [`doc/DESIGN.md`](doc/DESIGN.md)，
公众号流水线设计见 [`doc/WECHAT_PIPELINE_DESIGN.md`](doc/WECHAT_PIPELINE_DESIGN.md)，
Hermes 运行手册见 [`doc/HERMES_OPS_HANDBOOK.md`](doc/HERMES_OPS_HANDBOOK.md)。

## 依赖

| 依赖 | 版本 | 用途 |
|------|------|------|
| chess.js | ^1.4.0 | 真实国际象棋规则校验：FEN 解析、走法合法性验证 |
| pngjs | ^7.0.0 | 静态棋盘 PNG 合成：将 assets/pieces 棋子素材合成到棋盘上 |

HTTP 使用内置 fetch（含可配置超时和 AbortController），不依赖外部 HTTP 库。
