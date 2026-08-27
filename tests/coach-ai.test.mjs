import assert from "node:assert/strict";
import test from "node:test";
import {
  AI_PROVIDERS, PROMPTGATE_BASE_URL, PROMPTGATE_API_KEY,
  PROMPTGATE_INPUT_BUDGET, PROMPTGATE_MAX_INPUT_CHARS, PROMPTGATE_TIMEOUT_MS,
  buildCoachMessages, buildPromptGateMessages, buildPromptGateRequest,
  buildProviderChatRequest, clampMessagesToCharBudget, extractProviderAnswer,
  normalizePromptGateError, OPENROUTER_MODELS, providerIds,
} from "../assets/coach-ai.mjs";

// ---- buildCoachMessages ---------------------------------------------------

test("buildCoachMessages returns system + user roles", () => {
  const msgs = buildCoachMessages("为什么这步要升后？", {});
  assert.equal(msgs.length, 2);
  assert.equal(msgs[0].role, "system");
  assert.equal(msgs[1].role, "user");
});

test("system prompt forbids giving the answer directly", () => {
  const msgs = buildCoachMessages("q", {});
  const system = msgs[0].content;
  // 教学硬约束：不能直接吐出标准走法序列。
  assert.ok(system.includes("严禁"), "system must forbid direct answers");
  assert.ok(/正确走法/.test(system), "system must mention forbidding the correct move");
  assert.ok(/150 字/.test(system), "system must constrain length");
  assert.ok(/简体中文/.test(system), "system must request Chinese");
});

test("user message includes the question and provided context fields", () => {
  const msgs = buildCoachMessages("这步怎么理解", {
    title: "升变选择",
    goal: "三步将杀",
    startFen: "7k/6P1/6K1/8/8/8/8/8 w - - 0 1",
    currentFen: "8/5KPk/8/8/8/8/8/8 w - - 0 1",
    step: 1,
    totalSteps: 3,
  });
  const user = msgs[1].content;
  assert.ok(user.includes("升变选择"), "user msg must include title");
  assert.ok(user.includes("三步将杀"), "user msg must include goal");
  assert.ok(user.includes("7k/6P1/6K1"), "user msg must include start FEN");
  assert.ok(user.includes("第 2 步"), "user msg must show step (0-indexed +1)");
  assert.ok(user.includes("这步怎么理解"), "user msg must include the question");
});

test("buildCoachMessages works with no context", () => {
  const msgs = buildCoachMessages("国际象棋怎么算赢", {});
  assert.equal(msgs[1].content, "国际象棋怎么算赢");
});

test("buildCoachMessages omits empty context gracefully", () => {
  // 只给了 title，其他字段空 → 不应出现空行。
  const msgs = buildCoachMessages("q", { title: "T", goal: "", startFen: undefined });
  const user = msgs[1].content;
  assert.ok(user.includes("题目标题：T"));
  assert.ok(!user.includes("本题目标：\n"), "empty goal must not produce a label-only line");
});

// ---- PromptGate 网关（站点默认路径）----------------------------------------

test("PromptGate constants are configured with gateway URL, key and sane limits", () => {
  assert.ok(PROMPTGATE_BASE_URL.startsWith("https://"), "gateway base URL must be https");
  assert.ok(PROMPTGATE_BASE_URL.endsWith("/v1"), "gateway base URL is OpenAI-compatible /v1");
  // 只断言 key 形态，不在测试源码里展开真实 key 值（避免密钥扫描误报）。
  assert.ok(PROMPTGATE_API_KEY.startsWith("pk_") && PROMPTGATE_API_KEY.length > 10, "gateway key must be configured");
  // 上游超时 120s，前端超时不得低于它。
  assert.ok(PROMPTGATE_TIMEOUT_MS >= 120000, "frontend timeout must cover the 120s upstream timeout");
  // 裁剪预算必须低于网关 4000 字符硬限。
  assert.ok(PROMPTGATE_INPUT_BUDGET < PROMPTGATE_MAX_INPUT_CHARS, "budget must leave margin under the hard limit");
});

test("buildPromptGateMessages folds the system prompt into a single user message", () => {
  const msgs = buildPromptGateMessages("这步怎么理解", { title: "T" }, "zh");
  assert.equal(msgs.length, 1, "gateway must receive exactly one message");
  assert.equal(msgs[0].role, "user", "gateway strips system messages, so none may be sent");
  // 教学硬约束折进 user 内容后必须仍然在场。
  assert.ok(msgs[0].content.includes("严禁"), "pedagogy constraint must survive the fold");
  assert.ok(msgs[0].content.includes("这步怎么理解"), "question must survive the fold");
});

test("buildPromptGateMessages keeps localized prompts", () => {
  const zh = buildPromptGateMessages("q", {}, "zh")[0].content;
  assert.ok(zh.includes("国际象棋教练"), "zh prompt");
  const en = buildPromptGateMessages("q", {}, "en")[0].content;
  assert.ok(en.includes("chess coach"), "en prompt");
});

test("buildPromptGateMessages clamps long input under the char budget", () => {
  const longQuestion = "很".repeat(5000);
  const msgs = buildPromptGateMessages(longQuestion, { title: "T", goal: "G", startFen: "7k/6P1/6K1/8/8/8/8/8 w - - 0 1" }, "zh");
  const total = msgs.reduce((n, m) => n + m.content.length, 0);
  assert.ok(total <= PROMPTGATE_INPUT_BUDGET, `total chars ${total} must stay within budget`);
  assert.ok(msgs[0].content.endsWith("…"), "truncated content must end with an ellipsis marker");
  // 开头的教学约束优先保住，截断只发生在末尾。
  assert.ok(msgs[0].content.startsWith("你是"), "head constraints must be preserved");
});

test("buildPromptGateRequest posts to the gateway chat endpoint with bearer auth and minimal body", () => {
  const { url, init } = buildPromptGateRequest("q", {}, "zh");
  assert.equal(url, `${PROMPTGATE_BASE_URL}/chat/completions`);
  assert.equal(init.method, "POST");
  assert.equal(init.headers.Authorization, `Bearer ${PROMPTGATE_API_KEY}`);
  assert.equal(init.headers["Content-Type"], "application/json");
  const body = JSON.parse(init.body);
  assert.ok(Array.isArray(body.messages) && body.messages.length === 1, "body carries the merged single message");
  assert.equal(typeof body.model, "string", "model may be sent (server ignores and pins it)");
  assert.equal(body.stream, undefined, "must not request streaming (gateway rejects it)");
  assert.equal(body.temperature, undefined, "extra params are ignored by the gateway; keep the body minimal");
});

test("extractProviderAnswer works for gateway responses (OpenAI-compatible)", () => {
  assert.equal(extractProviderAnswer({ choices: [{ message: { content: "好" } }] }), "好");
  assert.throws(() => extractProviderAnswer({}), /empty AI answer/);
  assert.throws(() => extractProviderAnswer({ choices: [{ message: { content: "  " } }] }), /empty AI answer/);
});

// ---- clampMessagesToCharBudget ----------------------------------------------

test("clampMessagesToCharBudget is a no-op under budget and never mutates input", () => {
  const messages = [{ role: "user", content: "abc" }, { role: "assistant", content: "de" }];
  const out = clampMessagesToCharBudget(messages, 100);
  assert.deepEqual(out, messages);
  messages[0].content = "changed";
  assert.equal(out[0].content, "abc", "input must not be mutated");
});

test("clampMessagesToCharBudget truncates from the tail down to budget", () => {
  const messages = [{ role: "user", content: "头部约束" }, { role: "user", content: "x".repeat(100) }];
  const out = clampMessagesToCharBudget(messages, 20);
  const total = out.reduce((n, m) => n + m.content.length, 0);
  assert.ok(total <= 20, `total ${total} must fit the budget`);
  assert.equal(out[0].content, "头部约束", "head message must be preserved when tail overflow suffices");
  assert.ok(out[1].content.endsWith("…"), "truncated message must be marked");
});

test("clampMessagesToCharBudget degrades gracefully with a tiny budget", () => {
  const out = clampMessagesToCharBudget([{ role: "user", content: "abcdef" }], 1);
  const total = out.reduce((n, m) => n + m.content.length, 0);
  assert.ok(total <= 1, "even a tiny budget must be respected");
});

// ---- normalizePromptGateError ------------------------------------------------

test("network-level failures map to the check-config message", () => {
  // 域名未部署/DNS 失败/CORS 拦截时 fetch 抛 TypeError，无 status。
  const net = normalizePromptGateError(new TypeError("fetch failed"));
  assert.equal(net.messageKey, "aiUnavailable");
  assert.ok(net.detail.includes("fetch failed"), "detail keeps the raw error for diagnostics");
});

test("timeout abort maps to the check-config message with a timeout detail", () => {
  const err = new Error("The user aborted a request.");
  err.name = "AbortError";
  const out = normalizePromptGateError(err);
  assert.equal(out.messageKey, "aiUnavailable");
  assert.ok(out.detail.includes("超时"), "detail must say it timed out");
});

test("auth and origin failures map to the check-config message", () => {
  for (const [status, code] of [[401, "invalid_api_key"], [403, "origin_not_allowed"], [403, "profile_disabled"]]) {
    const err = new Error(`AI HTTP ${status}`);
    err.status = status;
    err.code = code;
    const out = normalizePromptGateError(err);
    assert.equal(out.messageKey, "aiUnavailable", `${status} ${code}`);
    assert.ok(out.detail.includes(code), "detail must carry the gateway error code");
  }
});

test("daily quota errors map to the tomorrow message", () => {
  for (const code of ["daily_requests_exceeded", "daily_tokens_exceeded"]) {
    const err = new Error("quota");
    err.status = 429;
    err.code = code;
    assert.equal(normalizePromptGateError(err).messageKey, "aiDailyQuota", code);
  }
});

test("other rate limits map to the retry-later message", () => {
  for (const code of ["rate_limited", "profile_rate_limited", "upstream_rate_limited", ""]) {
    const err = new Error("slow down");
    err.status = 429;
    err.code = code;
    assert.equal(normalizePromptGateError(err).messageKey, "aiRateLimited", code || "(no code)");
  }
});

test("5xx upstream failures map to the upstream message", () => {
  for (const status of [500, 502, 504]) {
    const err = new Error(`AI HTTP ${status}`);
    err.status = status;
    err.code = "upstream_error";
    assert.equal(normalizePromptGateError(err).messageKey, "aiUpstreamError", String(status));
  }
});

test("request-construction errors map to the check-config message", () => {
  for (const status of [400, 413]) {
    const err = new Error(`AI HTTP ${status}`);
    err.status = status;
    err.code = "input_too_long";
    assert.equal(normalizePromptGateError(err).messageKey, "aiUnavailable", String(status));
  }
});

// ---- 多平台（OpenRouter / DeepSeek / GLM，用户自带 Key 覆盖）------------------

test("AI_PROVIDERS exposes openrouter, deepseek and glm with chat URLs and models", () => {
  assert.deepEqual(providerIds().sort(), ["deepseek", "glm", "openrouter"]);
  assert.equal(AI_PROVIDERS.openrouter.chatUrl, "https://openrouter.ai/api/v1/chat/completions");
  assert.equal(AI_PROVIDERS.deepseek.chatUrl, "https://api.deepseek.com/chat/completions");
  assert.equal(AI_PROVIDERS.glm.chatUrl, "https://open.bigmodel.cn/api/paas/v4/chat/completions");
  for (const id of providerIds()) {
    assert.ok(AI_PROVIDERS[id].models.length >= 1, `${id} must declare at least one model`);
  }
});

test("OPENROUTER_MODELS is a non-empty chain of free models led by the default", () => {
  assert.ok(Array.isArray(OPENROUTER_MODELS) && OPENROUTER_MODELS.length >= 2, "model chain should have a primary plus backups");
  for (const model of OPENROUTER_MODELS) {
    assert.ok(model.endsWith(":free"), `model ${model} should be a free tier model`);
  }
  // 链首必须等于 buildProviderChatRequest 的默认模型
  const { init } = buildProviderChatRequest("openrouter", "q", {}, "k", {});
  assert.equal(JSON.parse(init.body).model, OPENROUTER_MODELS[0], "chain head must match the request default model");
});

test("buildProviderChatRequest targets the right endpoint per provider with bearer auth", () => {
  for (const id of providerIds()) {
    const { url, init } = buildProviderChatRequest(id, "q", {}, "k-" + id, {});
    assert.equal(url, AI_PROVIDERS[id].chatUrl, `${id} endpoint`);
    assert.equal(init.headers.Authorization, `Bearer k-${id}`, `${id} bearer auth`);
    assert.equal(JSON.parse(init.body).model, AI_PROVIDERS[id].models[0], `${id} default model`);
    assert.equal(init.body.includes("messages"), true);
  }
});

test("buildProviderChatRequest adds referer headers only for OpenRouter", () => {
  const or = buildProviderChatRequest("openrouter", "q", {}, "k", { referer: "https://x.example/" });
  assert.equal(or.init.headers["HTTP-Referer"], "https://x.example/");
  assert.equal(or.init.headers["X-Title"], "Chess Moment");
  const ds = buildProviderChatRequest("deepseek", "q", {}, "k", { referer: "https://x.example/" });
  const glm = buildProviderChatRequest("glm", "q", {}, "k", { referer: "https://x.example/" });
  assert.equal(ds.init.headers["HTTP-Referer"], undefined, "deepseek must not carry referer headers");
  assert.equal(glm.init.headers["HTTP-Referer"], undefined, "glm must not carry referer headers");
});

test("buildProviderChatRequest carries localized system prompt and rejects unknown providers", () => {
  const zh = buildProviderChatRequest("deepseek", "q", { goal: "目标" }, "k", { locale: "zh" });
  assert.ok(JSON.parse(zh.init.body).messages[0].content.includes("国际象棋教练"));
  const en = buildProviderChatRequest("glm", "q", {}, "k", { locale: "en" });
  assert.ok(JSON.parse(en.init.body).messages[0].content.includes("chess coach"));
  assert.throws(() => buildProviderChatRequest("nope", "q", {}, "k", {}), /unknown AI provider/);
});
