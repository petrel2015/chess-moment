# 配置指南

棋刻面向读者零配置：打开即用。本文说明所有可选配置。

## AI 教练

### 读者侧（页面内）

任意课程页的「AI 设置」入口可以配置：

| 配置 | 说明 |
|------|------|
| AI 平台 | OpenRouter（免费模型）/ DeepSeek / 智谱 GLM |
| API Key | 所选平台的 Key；**留空则使用站点默认（内嵌 OpenRouter 免费模型）** |

- Key 只保存在当前浏览器的 localStorage（`chessCoachProvider` / `chessCoachApiKey`），不上传、不进源码。
- 清空 Key 并保存即恢复站点默认。
- 平台端点均为 OpenAI 兼容格式，且都允许浏览器直连（2026-08 实测 CORS 放行）：

| 平台 | 端点 | 模型 |
|------|------|------|
| OpenRouter | `https://openrouter.ai/api/v1/chat/completions` | 免费模型链（主：`nvidia/nemotron-3-ultra-550b-a55b:free`，另有备用两档） |
| DeepSeek | `https://api.deepseek.com/chat/completions` | `deepseek-chat` |
| 智谱 | `https://open.bigmodel.cn/api/paas/v4/chat/completions` | `glm-4-flash`（免费） |

### 站点维护者侧（内嵌默认 Key）

站点默认 Key 以 XOR + Base64 **混淆**形式内嵌在 `assets/coach-ai.mjs`（常量 `DEFAULT_OR_KEY_OBF`），仅使用免费模型（费用 $0）。更换方式见 `doc/AI_SETUP.md`：

```bash
node -e 'import("./assets/coach-ai.mjs").then(m => console.log(m.encodeKeyObfuscation("你的Key", "chess-moment-obf-2026")))'
```

把输出替换 `DEFAULT_OR_KEY_OBF` 后重新构建即可。

> ⚠️ 混淆不是加密：任何访客都能还原明文。**不要给内嵌 Key 充值**；需要付费模型时，请在「AI 设置」里使用自带 Key，或改用下方 Worker 方案。

### 可选：Cloudflare Worker 代理（历史路径）

把 Key 放在服务端的方案：部署 `worker/chess-coach-worker.mjs` 到 Cloudflare Workers 并注入 Zhipu Key，然后把 Worker URL 配为仓库 secret `CHESS_COACH_WORKER_URL`（或构建环境变量），构建时自动写入每个页面的 `window.CHESS_COACH_CONFIG`。未配置时该值为空字符串，前端自动跳过此路径。完整步骤见 `doc/AI_SETUP.md`。

优先级（高到低）：**用户所选平台+Key > 内嵌 OpenRouter Key > Worker（若配置）> 免 Key 中转（实验）> 预制答案**。

## 构建期环境变量

| 变量 | 作用 |
|------|------|
| `CHESS_HOME_DATE` | 固定首页「今天」的日期（ISO），用于测试/CI 可复现构建；生产构建读真实时钟 |
| `CHESS_COACH_WORKER_URL` | 注入可选的 Worker 代理 URL；未设置时为空，前端走默认链 |

## 站点图标与 PWA 元数据

`assets/site.webmanifest`、`assets/icons/` 与各页 `<head>` 的 apple-touch 元数据构成「添加到主屏幕」体验，无需额外配置。

## 语言默认值

站点默认中文。读者的语言由浏览器决定（`navigator.language`），手动选择后记住偏好；维护者无需配置。
