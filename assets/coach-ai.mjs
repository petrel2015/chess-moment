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
 *
 * @param {string} question 用户问题
 * @param {object} ctx 上下文：{ title, goal, startFen, currentFen, step, totalSteps }
 */
export function buildCoachMessages(question, ctx = {}) {
  const system = [
    "你是一位耐心的国际象棋教练，正在帮一位中文学习者。请遵守：",
    "1. 用简体中文回答，控制在 150 字以内，一次只讲清一个点。",
    "2. 结合对方给出的当前局面（FEN）讲解，可以解释规则、记号、棋子走法、通用原则、思路方向。",
    "3. 严禁直接给出「这道题的正确走法是 XX」或具体的标准走法序列。引导对方自己思考：观察哪个棋子、注意哪条线、对方王有什么弱点。",
    "4. 如果对方问的不是当前局面，正常回答即可。",
  ].join("\n");

  const ctxLines = [];
  if (ctx.title) ctxLines.push(`题目标题：${ctx.title}`);
  if (ctx.goal) ctxLines.push(`本题目标：${ctx.goal}`);
  if (ctx.startFen) ctxLines.push(`起始局面 FEN：${ctx.startFen}`);
  if (ctx.currentFen) ctxLines.push(`当前局面 FEN：${ctx.currentFen}`);
  if (ctx.totalSteps) ctxLines.push(`进度：第 ${(ctx.step ?? 0) + 1} 步 / 共 ${ctx.totalSteps} 步`);
  const contextBlock = ctxLines.length ? `参考信息（供你理解，不要逐字复述）：\n${ctxLines.join("\n")}` : "";

  return [
    { role: "system", content: system },
    { role: "user", content: contextBlock ? `${contextBlock}\n\n对方的问题：${question}` : question },
  ];
}
