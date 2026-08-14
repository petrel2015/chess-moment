# AI 教练接入指南

本网站的"问教练"功能有四档，按配置程度从低到高：

1. **OpenRouter 自带 Key（零部署，推荐新手）**：去 openrouter.ai 免费注册拿一个 Key，
   在页面右下角「AI 设置」里粘贴保存。OpenRouter 的 API 允许浏览器直连（带 CORS 头），
   并提供大量免费模型，**不需要 Worker、不需要智谱**。Key 只存在你自己的浏览器里。
2. **免 Key 免费中转（零配置，默认）**：什么都不配，浏览器直连一个第三方免费
   转发（Pollinations 匿名层）拿真 AI 回答。**实验性**——第三方免费转发无 SLA，
   可能停用/限流/中文质量一般；失败时自动退回预制答案，不会卡住用户。
3. **预制答案（确定性兜底）**：每道题预先写好的解答。上面两档都不可用时的兜底。
4. **智谱 GLM-4-Flash（稳定）**：配一个 Cloudflare Worker 代理，走智谱官方
   免费模型。需要约 5–10 分钟、两次免费注册，之后访客零配置即用真 AI。

按本指南接入第 1 档（OpenRouter）最快：约 2 分钟、一次免费注册，且不需要部署任何东西。

## 方式 0（最快）：OpenRouter 自带 Key，浏览器直连

OpenRouter 是一个 AI 模型聚合平台，API 返回 `Access-Control-Allow-Origin: *`，
所以网页可以直接从浏览器调用它（大多数 API 会因 CORS 被浏览器拦截，OpenRouter 不会）。
它还提供大量 `:free` 结尾的免费模型（如 Gemma、Nemotron、Liquid 等）。

1. 打开 https://openrouter.ai/ ，用邮箱或 Google/GitHub 账号免费注册（不用绑卡）。
2. 登录后点右上角头像 → **Keys** → **Create Key**，复制那串 `sk-or-...` 的 Key。
3. 打开本站任一挑战页，点右下角「AI 设置」，在 **OpenRouter API Key** 一栏粘贴并保存。
4. 回到「问教练」框输入问题，点发送——就会直接拿到真 AI 回答（默认用免费模型）。

- 免费模型有每日用量限制，偶尔会提示限流；失败时自动降级为预制答案，不会卡住。
- Key 只存在你自己浏览器的 localStorage，不会上传到任何服务器，也不会进网站源码。
- 想换模型？源码里 `assets/coach-ai.mjs` 的 `buildOpenRouterRequest` 默认模型
  `google/gemma-4-31b-it:free` 可以改成任意 OpenRouter 免费模型 id。

整个流程约 5–10 分钟，需要：一个浏览器、两次免费注册。不需要信用卡、不需要服务器。

## 为什么需要一个 Worker（不能直接调 API）

智谱（以及 DeepSeek、Kimi）的官方 API **不允许网页直接调用**（不返回 CORS 头，浏览器会拦截）。
所以我们在 Cloudflare Worker 上放一个十几行的小代理，它做两件事：

1. 给请求加上 CORS 头，让网页能调通；
2. 把你的 API Key 注入请求头（Key 只存在 Worker 里，不会出现在网页源码里被偷走）。

## 第一步：申请智谱 API Key

1. 打开 https://open.bigmodel.cn/ ，注册账号（手机号即可）。
2. 登录后，进入「API Keys」页面（通常在右上角头像菜单或控制台首页）。
3. 点击「创建 API Key」，复制那串 key（形如 `xxxxxxxx.xxxxxxxx`），存好。
   - 使用的模型是 **GLM-4-Flash**，完全免费、无需绑卡。
   - 免费额度很高，正常问答用不完；如担心被盗用，可在智谱后台设日调用上限。

## 第二步：部署 Cloudflare Worker

1. 打开 https://dash.cloudflare.com/ ，注册账号（邮箱即可，免费）。
2. 左侧菜单点 **Workers & Pages** → **Create** → **Create Worker**。
3. 给 Worker 起个名字（如 `chess-coach`），点 **Deploy**（先随便部署默认代码）。
4. 部署成功后，点 **Edit code**（编辑代码）。
5. 把本项目 `worker/chess-coach-worker.mjs` 文件的**全部内容**复制，粘贴进 Cloudflare 的代码编辑器，覆盖掉默认代码。点右上角 **Deploy**。
6. 回到 Worker 概览页，记下你的 **Worker URL**，形如：
   `https://chess-coach.<你的子域>.workers.dev`

## 第三步：把智谱 Key 填进 Worker

1. 在 Cloudflare Worker 页面，点 **Settings** → **Variables and Secrets**。
2. 点 **Add**，变量名填 `ZHIPU_API_KEY`，值填你在第一步复制的智谱 Key。类型选 **Secret**。**Save / Deploy**。
3. （可选）在 Worker 概览的「Triggers」里可设自定义域名，但用默认 `*.workers.dev` 就够。

## 第四步：测试 Worker 是否工作

在你的电脑终端（或任何能发 POST 的工具）里跑：

```bash
curl -X POST https://chess-coach.<你的子域>.workers.dev \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"你好"}]}'
```

如果返回 `{"answer":"你好！我是..."}` 类的 JSON，说明 Worker 已正常工作。
如果返回 `{"error":"..."}`，按错误信息排查（多半是 Key 没填对或没保存）。

## 第五步：把 Worker URL 告诉网站（二选一）

### 方式 A（推荐）：设到 GitHub 仓库，全站自动生效

1. 在 GitHub 你的仓库页面：**Settings** → **Secrets and variables** → **Actions** → **New repository secret**。
2. Name 填 `CHESS_COACH_WORKER_URL`，Value 填你的完整 Worker URL。
3. 之后任何一次触发部署（push 到 main，或在 Actions 页手动触发 `Deploy Chess Moment` workflow），构建都会自动把这个 URL 注入网站，AI 全站生效。

### 方式 B：直接改网站文件（不依赖 GitHub secret）

1. 在仓库根目录打开任意一个 `*.html`（如 `promotion-combo.html`）。
2. 找到 `<script>window.CHESS_COACH_CONFIG = {"workerUrl":""};</script>` 这一行。
3. 把空字符串改成你的 Worker URL：`{"workerUrl":"https://chess-coach.xxx.workers.dev"}`。
4. 对每个 `*.html` 都改一遍（或只改 `index.html`）。
5. 提交推送，GitHub Pages 自动部署后生效。

## 验证网站 AI 是否生效

打开 https://petrel2015.github.io/chess-moment/ ，进入任一挑战，在「问教练」框里写一句话点发送：

- 出现「教练正在思考…」加载动画，随后显示一段 AI 生成的中文回答 → **成功**。
- 仍然秒回预制答案 → Worker URL 没生效，检查第五步。
- 显示「AI 暂时不可用，已显示预设参考」→ Worker 报错，回到第四步用 curl 测试。

## 用户自带 Key（可选，进一步降额度风险）

即使不配上面的任何东西，访客也可以在网页右下角的「AI 设置」里填自己的智谱 Key：
填了之后，该访客的请求会用他自己的 Key 调用，不走你的额度。
Key 只存在该访客自己的浏览器 localStorage 里，不会上传。

## 故障排查

| 现象 | 原因 | 解决 |
|---|---|---|
| 秒回预制答案 | Worker URL 为空 | 完成第五步 |
| 「AI 暂时不可用」 | Worker 报错或智谱返回非 200 | 用 curl 测试 Worker；检查 Key 是否正确、是否过期 |
| 加载很久才超时 | 智谱服务慢或网络问题 | 前端 15 秒超时会自动降级到预制答案 |
| 401 Unauthorized | 智谱 Key 无效 | 重新生成 Key，更新 Worker 的 `ZHIPU_API_KEY` |
| CORS 报错 | Worker 没正确部署 | 确认粘贴的是 `worker/chess-coach-worker.mjs` 的完整内容并 Deploy |

## 安全说明

- **你的智谱 Key 只存在 Cloudflare Worker 的环境变量里**，不会出现在网站源码、GitHub 仓库或浏览器里。
- 访客无法从网页看到你的 Key。他们能做的只是通过你的 Worker 发问答请求，消耗你的（免费）额度。
- 如担心额度被盗用：在智谱后台设日调用上限，或在 Worker 里加更严格的限流（当前版本未做严格限流，因为 GLM-4-Flash 免费且额度高）。
