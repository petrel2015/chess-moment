# 架构说明

棋刻是一个纯静态站点：没有自有后端、没有数据库、没有运行时服务端逻辑。本文说明数据流与模块边界。

## 总体数据流

```text
                    ┌────────────────────────┐
                    │  content/*.json        │  唯一内容源（中英文案同文件）
                    └───────────┬────────────┘
                                │ npm run build
              ┌─────────────────┼──────────────────┐
              ▼                 ▼                  ▼
   scripts/validate-content.mjs  chess.js 实走校验   assets/pieces 压缩
              │                 │
              ▼                 ▼
        scripts/build-site.mjs（渲染器，Node 端）
              │
              ├── _site/index.html + <slug>.html        中文互动页
              ├── _site/en/…                            英文互动页
              ├── _site/wechat/<slug>.html              公众号预览页
              ├── _site/wechat/assets/boards/*.png      静态棋盘 PNG（pngjs）
              └── _artifacts/wechat/*.payload.json      公众号 payload（不提交）
              │
              ▼
        GitHub Actions（npm test → npm run build）
              │
              ▼
        GitHub Pages（部署 _site/）
```

校验失败会直接让构建失败：任何一步正解或对手回应在真实棋规下不合法，站点都不会被发布。

## 前端模块

| 模块 | 职责 |
|------|------|
| `assets/app.js` | 页面唯一入口脚本。棋盘渲染（点击/拖动两条路径）、合法格高亮、红绿反馈圈、对手回应窗口、进度、胜算/子力面板、棋谱 tooltip、教练问答 UI、AI 设置面板、语言切换、赞赏弹层、反馈邮件构造 |
| `assets/chess-engine.mjs` | 浏览器端规则引擎：FEN 解析、走法生成与合法性（含王车易位、兵升变、吃过路兵）、将军/将死判定。纯函数，无 DOM，Node 测试直接覆盖 |
| `assets/coach-ai.mjs` | 教练纯逻辑层：系统提示词构造（禁止泄露答案）、三家平台请求构造（OpenRouter/DeepSeek/GLM，OpenAI 兼容格式）、OpenRouter 免费模型链、内嵌 Key 的 XOR+Base64 混淆/还原。纯函数，无网络访问 |
| `assets/i18n.mjs` | UI 文案字典（构建脚本与前端共用，避免两处维护）+ `resolveLanguage`/`siblingPath` 语言解析纯函数 |

课程数据在构建期被内嵌为每页的 `window.CHESS_LESSON`，页面自包含——分享某期的 URL 即可完整重现该课，不依赖额外请求。

## 语言路由

- 中文页在根目录、英文页在 `en/` 子目录，文件名一一对应。
- 每页 `<head>` 内嵌一段非 module 检测脚本（尽早执行）：手动选择（localStorage `chessMomentLang`）优先，其次 `navigator.language`（zh*/en*），默认中文；目标语言与当前页不符时 `location.replace` 到兄弟页。
- 页头切换按钮直接指向兄弟页并带 `hreflang`；点击时写入 localStorage。

## AI 教练调用链

全部 AI 请求由浏览器直发（所选平台 API 均返回 CORS 头），超时 15 秒：

```text
用户点「问教练」
  → 用户配置了平台 + Key？（localStorage）
      是 → 用所选平台（OpenRouter / DeepSeek / GLM）
      否 → 内嵌 OpenRouter Key（免费模型链：主模型失败重试 → 备用模型降级）
          → （历史路径）Cloudflare Worker 代理（构建期注入 CHESS_COACH_WORKER_URL 时）
          → （实验）免 Key 第三方中转（Pollinations）
          → 全部失败 → 预制答案（defaultAnswer / quick）
```

系统提示词硬约束：只讲思路、规则、记法，不得给出当前题目的标准走法序列；回答不超过 150 字；语言跟随页面。详见 [AI 教练功能文档](./features/ai-coach.md)与[配置指南](./configuration.md)。

## 确定性边界

设计原则：**模型可以起草文案，代码决定一切与棋规相关的事**。

- 字段完整性、FEN 格式、UCI 走法格式、正解与对手回应的合法性、胜率归一、问答配对、先修死链：全部由 `scripts/validate-content.mjs`（借助 chess.js）在构建期判定，失败即拒绝发布。
- 浏览器内的走法合法性、将军/将死：由自研规则引擎判定，测试覆盖。
- 测试共 173 个（`node:test`），含逐课程走子回归（防数据把棋盘带进非法局面）。
- 首页「今天」选择在构建期由系统时钟决定；测试/CI 可用 `CHESS_HOME_DATE` 注入固定日期保证可复现。

## 后端与第三方依赖

- 常态运行（阅读、走棋、预制答案）：只依赖 GitHub Pages 静态托管。
- AI 教练：依赖所选第三方 AI 平台（OpenRouter / DeepSeek / 智谱）或实验性免费中转；这是站点唯一的外部运行时依赖，且全部有预制答案兜底。
- Cloudflare Worker（`worker/chess-coach-worker.mjs`）是可选的历史路径，仅当构建时注入 Worker URL 才会启用。

## 与历史文档的关系

`doc/DESIGN.md`（内容框架）、`doc/WECHAT_PIPELINE_DESIGN.md`（公众号流水线）等是本架构的早期设计记录，内容仍然有效但表述以本文与各功能文档为准。
