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
