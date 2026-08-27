/**
 * AI 教练的纯逻辑层（无 DOM 依赖，可在 Node 测试）。
 * app.js 从这里 import buildCoachMessages；测试直接 import 验证。
 */

/**
 * 解析 Worker URL：localStorage 覆盖 > window 配置 > 空。
 * 传入 storage 和 config 以便测试注入（避免直接依赖全局 localStorage/window）。
 */
export function resolveWorkerUrl({ storage = null, config = null } = {}) {
  const stored = storage ? storage.getItem("chessCoachWorkerUrl") : null;
  if (stored && stored.trim()) return stored.trim();
  const fromConfig = config && typeof config.workerUrl === "string" ? config.workerUrl : "";
  return fromConfig.trim();
}

/**
 * 构造发给智谱 GLM 的 messages（纯函数）。
 *
 * 关键设计：系统提示词硬约束 AI「不直接给出当前题目的标准走法序列」，
 * 只讲解思路、规则、记号、通用原则——保留挑战的教学价值。
 * locale 取 "zh" 或 "en"，决定教练用中文还是英文回答。
 *
 * @param {string} question 用户问题
 * @param {object} ctx 上下文：{ title, goal, startFen, currentFen, step, totalSteps }
 * @param {"zh"|"en"} locale 教练回答语言
 */
export function buildCoachMessages(question, ctx = {}, locale = "zh") {
  const system = locale === "en"
    ? [
      "You are a patient chess coach helping a learner. Please follow:",
      "1. Answer in English, within 150 words, covering one point at a time.",
      "2. Use the position (FEN) the learner provides to explain rules, notation, piece movement, general principles and directions of thinking.",
      "3. Never state \"the correct move is XX\" or a specific standard move sequence. Guide the learner to think for themselves: observe which piece, notice which line, and what weakness the opponent's king has.",
      "4. If the learner is not asking about the current position, answer normally.",
    ].join("\n")
    : [
      "你是一位耐心的国际象棋教练，正在帮一位中文学习者。请遵守：",
      "1. 用简体中文回答，控制在 150 字以内，一次只讲清一个点。",
      "2. 结合对方给出的当前局面（FEN）讲解，可以解释规则、记号、棋子走法、通用原则、思路方向。",
      "3. 严禁直接给出「这道题的正确走法是 XX」或具体的标准走法序列。引导对方自己思考：观察哪个棋子、注意哪条线、对方王有什么弱点。",
      "4. 如果对方问的不是当前局面，正常回答即可。",
    ].join("\n");

  const ctxLines = [];
  if (ctx.title) ctxLines.push(locale === "en" ? `Lesson title: ${ctx.title}` : `题目标题：${ctx.title}`);
  if (ctx.goal) ctxLines.push(locale === "en" ? `Lesson goal: ${ctx.goal}` : `本题目标：${ctx.goal}`);
  if (ctx.startFen) ctxLines.push(locale === "en" ? `Starting FEN: ${ctx.startFen}` : `起始局面 FEN：${ctx.startFen}`);
  if (ctx.currentFen) ctxLines.push(locale === "en" ? `Current FEN: ${ctx.currentFen}` : `当前局面 FEN：${ctx.currentFen}`);
  if (ctx.totalSteps) ctxLines.push(
    locale === "en"
      ? `Progress: step ${(ctx.step ?? 0) + 1} of ${ctx.totalSteps}`
      : `进度：第 ${(ctx.step ?? 0) + 1} 步 / 共 ${ctx.totalSteps} 步`
  );
  const contextBlock = ctxLines.length ? (locale === "en"
    ? `Reference information (for your understanding, do not repeat verbatim):\n${ctxLines.join("\n")}`
    : `参考信息（供你理解，不要逐字复述）：\n${ctxLines.join("\n")}`) : "";

  return [
    { role: "system", content: system },
    { role: "user", content: contextBlock ? `${contextBlock}\n\n${locale === "en" ? "The learner's question: " : "对方的问题："}${question}` : question },
  ];
}

/**
 * 构造免 Key 免费中转（Pollinations 匿名 GET）的请求 URL（纯函数，可测）。
 *
 * 这是「零配置」路径：不依赖 Worker 和 API Key，浏览器直接 GET 一个第三方免费
 * 转发（text.pollinations.ai）。系统提示走 ?system=，问题文本放路径里。
 *
 * 重要：第三方免费转发无 SLA，随时可能停用/限流/中文质量一般，因此调用方必须
 * 把失败兜底到预制答案（见 app.js 的 showCoachAnswerKeyless）。这里只负责构造
 * 请求、不碰网络。
 *
 * @param {string} question 用户问题
 * @param {object} ctx 与 buildCoachMessages 相同的上下文
 * @param {"zh"|"en"} locale 教练回答语言
 * @returns {string} 完整 GET URL
 */
export function buildKeylessUrl(question, ctx = {}, locale = "zh") {
  const messages = buildCoachMessages(question, ctx, locale);
  const system = messages[0].content;
  const prompt = messages[1].content;
  const params = new URLSearchParams();
  if (system) params.set("system", system);
  params.set("model", "openai");
  params.set("seed", "chess-moment");
  return `https://text.pollinations.ai/${encodeURIComponent(prompt)}?${params.toString()}`;
}

// ---- 默认 OpenRouter Key（前端直连）--------------------------------------
// 按需求把默认 Key 以「简单混淆」形式写在前端，免去 AI 设置里手动粘贴。
// 警告：这只是混淆（XOR + Base64），不是真正的加密——任何访客都能在浏览器
// 开发者工具里还原出明文 Key。若该 Key 关联付费额度，请改用「AI 设置」里
// 的自带 Key 覆盖，或删除 DEFAULT_OR_KEY_OBF 常量。
const DEFAULT_OR_KEY_SALT = "chess-moment-obf-2026";
const DEFAULT_OR_KEY_OBF = "EANIHAEAG15ABFlNS1xbU04HU1EOV1FXQkMYWFpfAA9NFFhaUB8FUQoFVFgBQxBIX1cJVQhDS1dRBxlRAgcHU18HR0QdC15VUQ==";

/** XOR + Base64 混淆（纯函数，可测；浏览器与 Node 均可用 btoa/atob）。 */
export function encodeKeyObfuscation(plain, salt) {
  let bin = "";
  for (let i = 0; i < plain.length; i++) {
    bin += String.fromCharCode(plain.charCodeAt(i) ^ salt.charCodeAt(i % salt.length));
  }
  return btoa(bin);
}

/** 还原被 encodeKeyObfuscation 混淆的值（纯函数，可测）。 */
export function decodeKeyObfuscation(obf, salt) {
  const bin = atob(obf);
  let out = "";
  for (let i = 0; i < bin.length; i++) {
    out += String.fromCharCode(bin.charCodeAt(i) ^ salt.charCodeAt(i % salt.length));
  }
  return out;
}

/** 内嵌的默认 OpenRouter Key（运行时还原）。无内嵌 Key 时返回空串。 */
export function embeddedOpenRouterKey() {
  return DEFAULT_OR_KEY_OBF ? decodeKeyObfuscation(DEFAULT_OR_KEY_OBF, DEFAULT_OR_KEY_SALT) : "";
}

/**
 * OpenRouter 免费模型链：主模型 + 备用。免费模型会间歇性返回空回答或
 * 429 限流（实测约 1/4 概率），调用方（app.js 的 askCoachOpenRouter）
 * 按此列表重试并降级换模型。全部经实测可用（2026-08）。
 */
export const OPENROUTER_MODELS = [
  "nvidia/nemotron-3-ultra-550b-a55b:free",
  "poolside/laguna-s-2.1:free",
  "cohere/north-mini-code:free",
];

/**
 * 支持的 AI 平台（均为 OpenAI 兼容端点；CORS 预检均放行浏览器直连，2026-08 实测）：
 *   - openrouter: 免费模型链（站点内嵌默认 Key 走这里）
 *   - deepseek:   deepseek-chat（便宜）
 *   - glm:        智谱 glm-4-flash（免费）
 * 用户可在页面「AI 设置」里选平台 + 填自己的 Key 覆盖默认。
 */
export const AI_PROVIDERS = {
  openrouter: {
    chatUrl: "https://openrouter.ai/api/v1/chat/completions",
    models: OPENROUTER_MODELS,
    withRefererHeaders: true,
  },
  deepseek: {
    chatUrl: "https://api.deepseek.com/chat/completions",
    models: ["deepseek-chat"],
    withRefererHeaders: false,
  },
  glm: {
    chatUrl: "https://open.bigmodel.cn/api/paas/v4/chat/completions",
    models: ["glm-4-flash"],
    withRefererHeaders: false,
  },
};

/** 全部平台 id（设置面板下拉用）。 */
export function providerIds() {
  return Object.keys(AI_PROVIDERS);
}

/**
 * 构造发给任意支持平台的 chat 请求（纯函数，可测）。
 * 请求体为 OpenAI 兼容格式；OpenRouter 额外带 HTTP-Referer/X-Title 来源头。
 * @param {"openrouter"|"deepseek"|"glm"} providerId 平台 id
 * @param {string} question 用户问题
 * @param {object} ctx 与 buildCoachMessages 相同的上下文
 * @param {string} apiKey 该平台的 API Key
 * @param {object} [opts] { locale, model, referer }
 */
export function buildProviderChatRequest(providerId, question, ctx = {}, apiKey, opts = {}) {
  const provider = AI_PROVIDERS[providerId];
  if (!provider) throw new Error(`unknown AI provider: ${providerId}`);
  const { locale = "zh", model = provider.models[0], referer = "" } = opts;
  const messages = buildCoachMessages(question, ctx, locale);
  const headers = {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${apiKey}`,
  };
  if (provider.withRefererHeaders && referer) {
    headers["HTTP-Referer"] = referer;
    headers["X-Title"] = "Chess Moment";
  }
  return {
    url: provider.chatUrl,
    init: {
      method: "POST",
      headers,
      body: JSON.stringify({ model, messages, temperature: 0.7, max_tokens: 800 }),
    },
  };
}

/**
 * 从平台的 OpenAI 兼容响应里抽出回答文本（三家平台响应结构一致，纯函数，可测）。
 */
export function extractProviderAnswer(json) {
  const content = json?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    throw new Error("empty AI answer");
  }
  return content;
}

/**
 * 构造发给 OpenRouter（OpenAI 兼容）的请求（纯函数，可测）。
 *
 * OpenRouter 是「自带 Key、浏览器直连」路径：其 API 返回 CORS 头
 * （Access-Control-Allow-Origin: *），且提供大量免费模型（id 以 :free 结尾）。
 * 因此用户填一个免费 OpenRouter Key 即可在浏览器里直接拿到真 AI 回答，
 * 不需要 Cloudflare Worker。Key 只存在用户自己的 localStorage，不进源码。
 *
 * @param {string} question 用户问题
 * @param {object} ctx 与 buildCoachMessages 相同的上下文
 * @param {string} apiKey OpenRouter API Key
 * @param {object} [opts] { locale, model, referer }
 * @returns {{url: string, init: RequestInit}} 给 fetch 用的 {url, init}
 */
export function buildOpenRouterRequest(question, ctx = {}, apiKey, opts = {}) {
  const { locale = "zh", model = "nvidia/nemotron-3-ultra-550b-a55b:free", referer = "" } = opts;
  const messages = buildCoachMessages(question, ctx, locale);
  const headers = {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${apiKey}`,
  };
  if (referer) {
    // OpenRouter 要求标识来源站点，用于模型提供方统计与限流。
    headers["HTTP-Referer"] = referer;
    headers["X-Title"] = "Chess Moment";
  }
  return {
    url: "https://openrouter.ai/api/v1/chat/completions",
    init: {
      method: "POST",
      headers,
      body: JSON.stringify({ model, messages, temperature: 0.7, max_tokens: 800 }),
    },
  };
}

/**
 * 从 OpenRouter 响应里抽出回答文本（纯函数，可测）。
 * OpenRouter 返回 OpenAI 兼容格式：{ choices: [{ message: { content } }] }。
 */
export function extractOpenRouterAnswer(json) {
  const content = json?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    throw new Error("empty OpenRouter answer");
  }
  return content;
}
