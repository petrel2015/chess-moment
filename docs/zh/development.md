# 开发指南

本文面向想本地运行、修改内容或参与开发的开发者。

## 环境要求

- Node.js 20 或更高（本地开发常用 22；CI 使用 Node 24）。构建与测试只依赖 Node 内置 API（`node:test`、`fs/promises`、fetch），无全局工具。
- 任一静态文件服务器用于本地预览（如 `python3 -m http.server`）。

## 常用命令

```bash
npm ci                # 安装依赖（以 package-lock.json 为准）
npm run validate      # 只跑内容校验（真实棋规 + 字段 + 链接）
npm test              # 全部测试（173 个，串行执行避免共享 _site 竞态）
npm run build         # 压缩棋子图片 + 生成 _site/（幂等，先删后建）
npm run publish:root  # 构建并把互动页 HTML 同步到仓库根目录（Pages 兼容旧直出模式）
```

没有 dev server 和打包器：改完代码刷新页面即可。公众号发布适配器命令见[功能文档](./features/wechat-dual-output.md)。

## 目录结构

```text
content/            课程 JSON（唯一内容源，每期一个文件）
scripts/            校验、构建、公众号渲染/发布、棋盘 PNG、图片压缩
assets/
  app.js            棋盘交互、反馈、tooltip、教练问答、语言切换、赞赏
  chess-engine.mjs  浏览器端规则引擎（易位/升变/吃过路兵/将军/将死）
  coach-ai.mjs      AI 教练纯逻辑层（请求构造、平台定义、Key 混淆）
  i18n.mjs          UI 文案字典 + 语言解析（构建与前端共用）
  styles.css        全站样式
  pieces/           透明棋子素材（originals/ 为压缩前原图）
worker/             Cloudflare Worker 代理源码（可选 AI 路径）
tests/              node:test 测试（校验、引擎、构建、走子回归、i18n、教练）
doc/                历史设计/运维文档（DESIGN、AI_SETUP、ROADMAP 等）
_site/              构建产物（不提交）
_artifacts/wechat/  公众号 payload 与发布状态（不提交）
docs/               本文档体系；docs/img/ 为 README 与文档共用截图
```

## 课程 JSON 结构

文件名 `content/YYYY-MM-DD-topic.json`，顶层字段：

| 字段 | 说明 |
|------|------|
| `slug` | 唯一 ID，即页面文件名（如 `rook-ladder`） |
| `publishedAt` | ISO 日期时间，决定首页选择与排序 |
| `edition` / `category` | 「早报/晚报」与分类（残局、开局……） |
| `title` / `summary` / `topic` / `difficulty` / `duration` | 展示元信息，difficulty 为 1–5 |
| `tags` / `prerequisites` | 可选标签数组与先修 slug 数组（校验器检查死链） |
| `introduction` | 背景故事段落数组 |
| `culture` | `{ title, content }` 文化/历史旁注 |
| `challenge` | 互动挑战（见下） |
| `review` | `{ title, steps[], principle }` 复盘 |
| `*_en` | 上述文案字段的英文版（`title_en`、`challenge_en`……），双语站点的翻译来源 |

`challenge` 关键字段：

| 字段 | 说明 |
|------|------|
| `fen` | 初始局面 FEN |
| `goal` / `instruction` | 目标与操作说明 |
| `steps[]` | 每步 `{ move, opponent?, note, alternatives? }`；`move` 为 UCI（普通 4 字符 `e2e4`，升变 5 字符 `e7e8q`，易位写王 `e1g1`）；`opponent` 为对手自动回应（必须在该局面合法）；`alternatives` 为合理候选着 `[{ move, note }]` |
| `odds[]` | 每步对应的教学胜算 `{ white, draw, black }`，三项之和必须为 100 |
| `errors` / `genericError` | 特定错误走法解释与通用错误解释 |
| `success` | 完成后的祝贺语 |
| `quick` / `suggestions` | 快捷问答（`suggestions` 的 `key` 必须能在 `quick` 里找到答案） |
| `defaultAnswer` | AI 全部不可用时的预制答案 |

校验器（`scripts/validate-content.mjs`）会检查所有字段、FEN 格式、每步正解与对手回应的真实棋规合法性（经 chess.js）、胜率归一、问答配对与先修死链，输出 `文件名: 原因`。设计细节见[规则引擎与内容校验](./features/chess-rules-validation.md)。

## 测试

`npm test` 串行运行 `tests/*.test.mjs`：

- **content.test.mjs**：字段与链接校验
- **engine.test.mjs**：规则引擎单元测试（易位、升变、吃过路兵、将军/将死）
- **lessons-walkthrough.test.mjs**：逐课程把每步正解与对手回应实走一遍（防数据腐蚀棋盘）
- **build.test.mjs**：构建产物、双语页、语言路由
- **i18n.test.mjs**：本地化与语言切换
- **coach-ai.test.mjs**：教练请求构造与平台链（不访问网络）
- **board-png / optimize-pieces / publisher / worker**：图片合成、压缩与公众号适配

新增行为请补对应测试；构建期可用 `CHESS_HOME_DATE=YYYY-MM-DD` 注入固定日期，让首页选择可复现。

## 构建与预览

```bash
npm run build
python3 -m http.server 8000 --directory _site
```

`build-site.mjs` 每次先删除 `_site/` 再完整重建，因此幂等。生成内容：

- 中文互动页（根目录）与英文互动页（`en/` 子目录），语言检测脚本内嵌在 `<head>`
- `_site/wechat/`：公众号预览页与静态棋盘 PNG
- `_artifacts/wechat/`：结构化 payload（发布适配器输入，含凭据泄漏审计）

本地验证清单：手机宽度下实走全部步骤、中英切换、问教练（含断网降级）、往期归档链接。

## 发布

推送到受部署分支会触发 GitHub Actions：`npm ci → npm test → npm run build → 部署 _site/`。详见[部署指南](./deployment.md)。

## 文档维护约定

用户可见的行为变化需要同步更新：`README.md` / `README.zh.md`（定位与功能）、`docs/{zh,en}/usage.md`（用法）、对应 `features/` 文档（设计）、`CHANGELOG*.md`（变化记录）。重大功能新增时按 [features/ 索引](./features/index.md)的格式补设计文档。
