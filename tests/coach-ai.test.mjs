import assert from "node:assert/strict";
import test from "node:test";
import { buildCoachMessages, buildKeylessUrl, buildOpenRouterRequest, extractOpenRouterAnswer, resolveWorkerUrl } from "../assets/coach-ai.mjs";

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

// ---- resolveWorkerUrl -----------------------------------------------------

test("resolveWorkerUrl returns empty when nothing configured", () => {
  assert.equal(resolveWorkerUrl({}), "");
  assert.equal(resolveWorkerUrl({ storage: null, config: null }), "");
});

test("resolveWorkerUrl uses config.workerUrl when no localStorage override", () => {
  const url = resolveWorkerUrl({ config: { workerUrl: "https://w.example.dev" } });
  assert.equal(url, "https://w.example.dev");
});

test("resolveWorkerUrl prefers localStorage over config", () => {
  const fakeStorage = {
    store: { chessCoachWorkerUrl: "https://mine.workers.dev" },
    getItem(k) { return this.store[k] ?? null; },
  };
  const url = resolveWorkerUrl({
    storage: fakeStorage,
    config: { workerUrl: "https://default.workers.dev" },
  });
  assert.equal(url, "https://mine.workers.dev");
});

test("resolveWorkerUrl falls back to config when localStorage key is empty", () => {
  const fakeStorage = { getItem: () => null };
  const url = resolveWorkerUrl({
    storage: fakeStorage,
    config: { workerUrl: "https://default.workers.dev" },
  });
  assert.equal(url, "https://default.workers.dev");
});

test("resolveWorkerUrl trims whitespace", () => {
  const url = resolveWorkerUrl({ config: { workerUrl: "  https://w.example.dev  " } });
  assert.equal(url, "https://w.example.dev");
});

// ---- buildKeylessUrl -------------------------------------------------------

test("buildKeylessUrl builds a GET to text.pollinations.ai with encoded prompt", () => {
  const url = buildKeylessUrl("这步怎么理解", { title: "升变选择" });
  assert.ok(url.startsWith("https://text.pollinations.ai/"), "must target the keyless relay");
  assert.ok(decodeURIComponent(url).includes("这步怎么理解"), "question must appear in the path");
  assert.ok(url.includes("model=openai"), "must pin a free openai model");
  assert.ok(url.includes("seed=chess-moment"), "must set a stable seed");
});

test("buildKeylessUrl carries the system prompt and Chinese survives encoding", () => {
  const url = buildKeylessUrl("q", {});
  const decoded = decodeURIComponent(url);
  assert.ok(decoded.includes("system="), "must pass the system prompt via ?system=");
  assert.ok(decoded.includes("国际象棋教练"), "system prompt must be included verbatim");
  // 系统提示里的硬约束不应丢失。
  assert.ok(decoded.includes("严禁"), "system forbid-rule must survive the round trip");
});

test("buildKeylessUrl returns same URL for same input (deterministic)", () => {
  const a = buildKeylessUrl("x", { goal: "三步将杀" });
  const b = buildKeylessUrl("x", { goal: "三步将杀" });
  assert.equal(a, b);
});

// ---- buildOpenRouterRequest（自带 Key 浏览器直连路径）----------------------

test("buildOpenRouterRequest targets OpenAI-compatible chat completions with bearer auth", () => {
  const { url, init } = buildOpenRouterRequest("q", {}, "sk-or-test", {});
  assert.equal(url, "https://openrouter.ai/api/v1/chat/completions");
  assert.equal(init.method, "POST");
  assert.equal(init.headers.Authorization, "Bearer sk-or-test");
  assert.equal(init.headers["Content-Type"], "application/json");
});

test("buildOpenRouterRequest defaults to a free model and includes referer headers", () => {
  const { init } = buildOpenRouterRequest("q", {}, "sk-or", {
    referer: "https://petrel2015.github.io/chess-moment/promotion-combo.html",
  });
  const body = JSON.parse(init.body);
  assert.ok(body.model.endsWith(":free"), "default model should be a free OpenRouter model");
  assert.equal(init.headers["HTTP-Referer"], "https://petrel2015.github.io/chess-moment/promotion-combo.html");
  assert.equal(init.headers["X-Title"], "Chess Moment");
});

test("buildOpenRouterRequest carries localized system prompt and question", () => {
  const zh = buildOpenRouterRequest("q", { goal: "目标" }, "sk-or", { locale: "zh" });
  assert.ok(JSON.parse(zh.init.body).messages[0].content.includes("国际象棋教练"), "zh system prompt");
  const en = buildOpenRouterRequest("q", {}, "sk-or", { locale: "en" });
  assert.ok(JSON.parse(en.init.body).messages[0].content.includes("chess coach"), "en system prompt");
});

test("extractOpenRouterAnswer pulls content and throws on empty", () => {
  assert.equal(extractOpenRouterAnswer({ choices: [{ message: { content: "好" } }] }), "好");
  assert.throws(() => extractOpenRouterAnswer({}), /empty OpenRouter answer/);
  assert.throws(() => extractOpenRouterAnswer({ choices: [{ message: { content: "  " } }] }), /empty OpenRouter answer/);
});
