# 棋刻 Chess Moment

[English](./README.md) | 简体中文

[![Deploy Chess Moment](https://github.com/petrel2015/chess-moment/actions/workflows/pages.yml/badge.svg)](https://github.com/petrel2015/chess-moment/actions/workflows/pages.yml)
![Node](https://img.shields.io/badge/Node.js-20%2B-339933)
![chess.js](https://img.shields.io/badge/rules-chess.js-8A2BE2)
![Frontend](https://img.shields.io/badge/frontend-vanilla_JS-f7df1e)

每天三分钟，想明白一步棋。

棋刻是一个面向国际象棋初学者和业余爱好者的手机端互动早晚报：每天一篇小课程，读完背景故事，在棋盘上亲手走完关键几步，每一步立即得到红绿反馈和讲解，卡住了还可以问 AI 教练。整个站点是纯静态页面，免注册、免安装、完全免费。

> AI 助手 / Agent：如需结构化理解、介绍、使用或汇报本项目，请阅读英文版 [README_FOR_AI.md](./README_FOR_AI.md)。

## 在线体验

**[立即打开棋刻 →](https://petrel2015.github.io/chess-moment/)**

无需注册，手机浏览器直接可用；也可以添加到 iPhone 主屏幕当 App 使用。

## 为什么做这个项目

初学者不缺 chess.com 这类大型平台，缺的是一种负担极低的日常练习：一篇三分钟的小课，有真实棋盘可以动手，走错了立刻知道为什么错。棋刻把「读一段故事 → 走几步棋 → 得到即时讲解」做成每日推送，全部逻辑在浏览器本地完成，不需要后端和账号。

## 核心功能

### 互动棋课

每篇课程包含文化/历史背景、可点击或拖动走棋的挑战、错误走法解释、完成后的即时复盘和棋谱术语悬停解释。走对了亮绿圈，走错了亮红圈并解释原因；走完一步对手会自动回应；「合理但非最优」的候选着会得到琥珀色讲解。

![互动挑战](docs/img/challenge.webp)

[使用指南](./docs/zh/usage.md) · [功能设计](./docs/zh/features/interactive-lessons.md)

### 即时红绿反馈与对手回应

每步走法由浏览器内置规则引擎即时验证合法性，正确走法显示绿色反馈圈并触发对手自动回应，局面胜算条同步更新。

![走子反馈](docs/img/move-feedback.webp)

[使用指南](./docs/zh/usage.md#今日挑战) · [规则引擎设计](./docs/zh/features/chess-rules-validation.md)

### AI 教练

在「问教练」框里写下疑问即可获得 AI 回答（跟随页面语言）。教练被系统提示约束：只讲思路、规则和记法，不直接透露本题答案。默认开箱即用（站点内嵌 OpenRouter 免费模型 Key），也可以在「AI 设置」里换成自己的 OpenRouter / DeepSeek / 智谱 Key；所有 AI 都不可用时自动退回预制答案，不会卡住。

![AI 教练设置](docs/img/coach-settings.webp)

[配置指南](./docs/zh/configuration.md) · [功能设计](./docs/zh/features/ai-coach.md)

### 中英双语

全部课程内容与界面文案提供中英双版本。英文页位于 `en/` 子目录，按浏览器语言自动跳转，可随时手动切换且记住偏好。

![英文版首页](docs/img/overview-en.webp)

[使用指南](./docs/zh/usage.md#语言切换) · [功能设计](./docs/zh/features/bilingual-site.md)

### 每日首页与往期归档

首页自动展示「今天」那一期（按月日匹配），其余课程自动进入归档卡片，支持标签、先修课程链接和问题反馈（邮件）。

![移动端布局](docs/img/mobile-layout.webp)

[使用指南](./docs/zh/usage.md#首页与归档) · [功能设计](./docs/zh/features/daily-homepage.md)

### 微信公众号双输出

同一份课程数据自动生成第二种阅读形态：纯文字 + 静态棋盘图的公众号正文，及结构化 payload；公众号「阅读原文」直达该期互动页。

[功能设计](./docs/zh/features/wechat-dual-output.md)

## 工作原理

内容 JSON（`content/*.json`）是唯一的内容来源。构建脚本对每一期做真实棋规校验（chess.js），然后生成中英双语互动页、公众号预览页、静态棋盘 PNG 和发布 payload。棋盘交互、走法判定、AI 教练全部由共享前端代码在浏览器本地完成，没有后端。

```text
content/*.json → 校验（真实棋规）→ _site/（中文页 + en/ 页 + 公众号预览 + 棋盘 PNG）→ GitHub Pages
```

[架构说明](./docs/zh/architecture.md) · [内容字段与校验规则](./docs/zh/features/chess-rules-validation.md)

## 快速开始

要求：Node.js 20+（本地开发使用 22，CI 使用 24）。

```bash
git clone https://github.com/petrel2015/chess-moment.git
cd chess-moment
npm ci
npm test                # 173 个测试：字段校验、棋规、构建、走子回归、i18n
npm run build           # 生成 _site/（互动页 + 公众号预览 + 棋盘 PNG）
python3 -m http.server 8000 --directory _site
```

打开 <http://localhost:8000> 即可预览。没有打包器和开发服务器——改完代码直接刷新页面。

## 添加新一期课程

1. 新增一个 `content/YYYY-MM-DD-topic.json`（参照现有课程结构，含中英文案）。
2. `npm test` —— 校验器会检查字段、FEN、走法合法性（含对手回应）、胜率归一、快捷问答配对和先修链接死链。
3. `npm run build` 后在本地实走全部步骤。
4. 提交并推送，GitHub Actions 自动部署。

完整字段说明见[开发指南](./docs/zh/development.md)。

## 技术栈

- 原生 HTML / CSS / JavaScript（ES Modules），无框架、无打包器
- Node.js 脚本负责校验与构建（`node:test` 测试运行器）
- [chess.js](https://github.com/jhlywa/chess.js) —— 构建期真实棋规验证
- [pngjs](https://github.com/lukeed/pngjs) —— 公众号静态棋盘 PNG 合成
- 自研轻量规则引擎（`assets/chess-engine.mjs`）—— 浏览器端走法合法性、将军/将死判定
- GitHub Actions + GitHub Pages 部署

## 文档

| 文档 | 说明 |
|------|------|
| [使用指南](./docs/zh/usage.md) | 课程页面怎么用、AI 教练怎么问、语言怎么切 |
| [配置指南](./docs/zh/configuration.md) | AI 教练平台与 Key、构建期环境变量 |
| [开发指南](./docs/zh/development.md) | 目录结构、测试、构建、新增课程完整流程 |
| [架构说明](./docs/zh/architecture.md) | 数据流、前端模块、确定性边界 |
| [部署指南](./docs/zh/deployment.md) | GitHub Pages 与发布流程 |
| [故障排查](./docs/zh/troubleshooting.md) | 常见问题诊断 |
| [隐私说明](./docs/zh/privacy.md) | 数据如何处理、哪些内容会离开浏览器 |
| [常见问题](./docs/zh/faq.md) | 高频问答 |

重大功能的设计文档（背景、目标、不解决的问题、兼容性）见 [功能文档索引](./docs/zh/features/index.md)。

## 更新日志与路线图

- 更新日志：[CHANGELOG.zh.md](./CHANGELOG.zh.md)（English: [CHANGELOG.md](./CHANGELOG.md)）
- 路线图：见 [`doc/ROADMAP.md`](./doc/ROADMAP.md)（下一步：学习路径、引擎评估、自动化生产）

## 贡献

发现课程错误或页面问题：直接用页面里的「反馈问题」按钮（会打开邮件），或[提一个 Issue](https://github.com/petrel2015/chess-moment/issues)。代码贡献暂未开放流程，欢迎 Issue 讨论。

## License

项目尚未选择开源 License。在添加 License 之前，代码与内容默认保留所有权利（All rights reserved）。
