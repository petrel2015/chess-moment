/**
 * AI 教练的纯逻辑层（无 DOM 依赖，可在 Node 测试）。
 * app.js 从这里 import 请求构造与错误归类函数；测试直接 import 验证。
 *
 * 两条请求路径：
 *   - promptgate：站点默认 AI（自建 PromptGate 网关，OpenAI 兼容、非流式）。
 *     网关的 key 是公开调用方标识而非机密——模型、提示词、限流与熔断全部
 *     由服务端固定，前端硬编码符合网关设计（见 integrations/chess.md）。
 *   - 自带 Key：用户在「AI 设置」选平台（openrouter/deepseek/glm）并填自己
 *     的 Key，浏览器直连，覆盖站点默认。
 */

// ---- 站点默认：PromptGate 网关 ---------------------------------------------
// 集中成常量方便轮换：换 key / 换地址只改这里。
export const PROMPTGATE_BASE_URL = "https://api.fluffyeti.com:61234/v1";
export const PROMPTGATE_API_KEY = "pk_chess_cb1ace3431bf8be5987b48d2d5bdd9ee";
export const PROMPTGATE_MODEL = "chess-assistant"; // 任意值均可，服务端忽略并固定

// 网关硬限：所有消息 content 字符数合计 ≤ 4000，超限返回 input_too_long；
// 前端裁剪时留出余量。
export const PROMPTGATE_MAX_INPUT_CHARS = 4000;
export const PROMPTGATE_INPUT_BUDGET = 3600;

// 上游超时 120s（网关侧），前端 fetch 超时不得低于它，取 125s。
export const PROMPTGATE_TIMEOUT_MS = 125000;

/**
 * 构造发给 AI 的 messages（纯函数）。
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
 * 把消息列表裁到字符预算内（纯函数，可测）。
 * 网关按所有消息 content 的字符数总和限流（≤ 4000），超限直接 400。
 * 超预算时从最后一条消息的末尾截断（问题在末尾、教学约束在开头，优先保住
 * 开头），并追加省略号标记。返回新数组，不改入参。
 */
export function clampMessagesToCharBudget(messages, budget = PROMPTGATE_INPUT_BUDGET) {
  const total = messages.reduce((n, m) => n + m.content.length, 0);
  if (total <= budget) return messages.map(m => ({ ...m }));
  const out = messages.map(m => ({ ...m }));
  let overflow = total - budget;
  for (let i = out.length - 1; i >= 0 && overflow > 0; i--) {
    const content = out[i].content;
    // -1 给省略号腾位；预算极小时保底只剩省略号。
    const keep = Math.max(0, content.length - overflow - 1);
    out[i].content = content.slice(0, keep) + "…";
    overflow -= content.length - keep;
  }
  return out;
}

/**
 * 构造发给 PromptGate 网关的 messages（纯函数，可测）。
 *
 * 网关会剥离前端发的 system 消息并注入自己的固定人设，因此这里把教练的
 * 教学硬约束（不直接给答案）折进 user 内容开头——既保住约束，也不浪费
 * 4000 字符配额。最终只有一条 user 消息，并裁剪到预算内。
 */
export function buildPromptGateMessages(question, ctx = {}, locale = "zh") {
  const [system, user] = buildCoachMessages(question, ctx, locale);
  return clampMessagesToCharBudget([{ role: "user", content: `${system.content}\n\n${user.content}` }]);
}

/**
 * 构造发给 PromptGate 网关的 chat 请求（纯函数，可测）。
 * 网关只读取 messages（和 stream），model 等其余参数一律忽略——所以请求体
 * 保持最小，不带 temperature/max_tokens（非流式，不带 stream）。
 * @param {string} question 用户问题
 * @param {object} ctx 与 buildCoachMessages 相同的上下文
 * @param {"zh"|"en"} locale 教练回答语言
 * @returns {{url: string, init: RequestInit}} 给 fetch 用的 {url, init}
 */
export function buildPromptGateRequest(question, ctx = {}, locale = "zh") {
  return {
    url: `${PROMPTGATE_BASE_URL}/chat/completions`,
    init: {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${PROMPTGATE_API_KEY}`,
      },
      body: JSON.stringify({
        model: PROMPTGATE_MODEL,
        messages: buildPromptGateMessages(question, ctx, locale),
      }),
    },
  };
}

/**
 * 把网关路径的任意失败归类成 UI 文案 key（纯函数，可测）。
 *
 * 归类规则（对应接入文档的错误表）：
 *   - 网络层失败（域名未解析/CORS/断网/超时中止）与 401/403/400/413 →
 *     aiUnavailable「当前 AI 设置不可用，请检查配置」。
 *   - 429 且 code 为 daily_* → aiDailyQuota「今日额度已用完，明天再试」。
 *   - 其余 429 → aiRateLimited「请求太频繁，稍后再试」。
 *   - 5xx → aiUpstreamError「AI 服务暂时不可用，稍后重试」。
 * detail 附原始错误信息供诊断，调用方必须用 textContent 渲染（防注入）。
 *
 * @param {{name?: string, message?: string, status?: number, code?: string}} err
 * @returns {{messageKey: string, detail: string}}
 */
export function normalizePromptGateError(err) {
  const message = String(err?.message || "unknown error");
  const detail = err?.code ? `${message}（${err.code}）` : message;
  if (err?.name === "AbortError") return { messageKey: "aiUnavailable", detail: "请求超时" };
  if (!err?.status) return { messageKey: "aiUnavailable", detail };
  if (err.status === 401 || err.status === 403) return { messageKey: "aiUnavailable", detail };
  if (err.status === 429) {
    if (err.code === "daily_requests_exceeded" || err.code === "daily_tokens_exceeded") {
      return { messageKey: "aiDailyQuota", detail };
    }
    return { messageKey: "aiRateLimited", detail };
  }
  if (err.status >= 500) return { messageKey: "aiUpstreamError", detail };
  return { messageKey: "aiUnavailable", detail };
}

// ---- 用户自带 Key 的可选平台 ------------------------------------------------

/**
 * OpenRouter 免费模型链：主模型 + 备用。免费模型会间歇性返回空回答或
 * 429 限流（实测约 1/4 概率），调用方（app.js 的 askProviderAI）
 * 按此列表重试并降级换模型。全部经实测可用（2026-08）。
 */
export const OPENROUTER_MODELS = [
  "nvidia/nemotron-3-ultra-550b-a55b:free",
  "poolside/laguna-s-2.1:free",
  "cohere/north-mini-code:free",
];

/**
 * 支持的 AI 平台（均为 OpenAI 兼容端点；CORS 预检均放行浏览器直连，2026-08 实测）：
 *   - openrouter: 免费模型链（自带 Key）
 *   - deepseek:   deepseek-chat（便宜）
 *   - glm:        智谱 glm-4-flash（免费）
 * 用户可在页面「AI 设置」里选平台 + 填自己的 Key 覆盖站点默认（PromptGate 网关）。
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
 * 从 OpenAI 兼容响应里抽出回答文本（网关与三家平台响应结构一致，纯函数，可测）。
 */
export function extractProviderAnswer(json) {
  const content = json?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    throw new Error("empty AI answer");
  }
  return content;
}
