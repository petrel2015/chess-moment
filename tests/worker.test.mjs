import assert from "node:assert/strict";
import test from "node:test";
import { buildUpstreamRequest, extractAnswer, jsonResponse } from "../worker/chess-coach-worker.mjs";

// 构造一个最小的伪 Request，带 headers 和 _parsedBody（Worker handler 解析后挂上去）。
function fakeReq({ method = "POST", userKey = null, parsedBody = {} } = {}) {
  const headers = new Map();
  if (userKey) headers.set("x-user-key", userKey); // get() 大小写不敏感
  return {
    method,
    headers: {
      get: name => headers.get(name.toLowerCase()) || null,
    },
    _parsedBody: parsedBody,
  };
}

test("buildUpstreamRequest uses env ZHIPU_API_KEY when no user key", () => {
  const { url, init } = buildUpstreamRequest(fakeReq(), { ZHIPU_API_KEY: "env-secret" });
  assert.equal(url, "https://open.bigmodel.cn/api/paas/v4/chat/completions");
  assert.equal(init.method, "POST");
  assert.equal(init.headers.Authorization, "Bearer env-secret");
  assert.equal(init.headers["Content-Type"], "application/json");
});

test("buildUpstreamRequest prefers X-User-Key over env key", () => {
  const { init } = buildUpstreamRequest(
    fakeReq({ userKey: "user-key" }),
    { ZHIPU_API_KEY: "env-secret" }
  );
  assert.equal(init.headers.Authorization, "Bearer user-key");
});

test("buildUpstreamRequest throws when neither env nor user key is present", () => {
  assert.throws(
    () => buildUpstreamRequest(fakeReq(), {}),
    /missing API key/i
  );
});

test("buildUpstreamRequest forces model to glm-4-flash even if client tampers", () => {
  // 前端试图用更贵的模型，Worker 必须强制覆盖为免费的 glm-4-flash。
  const { init } = buildUpstreamRequest(
    fakeReq({ parsedBody: { model: "glm-4-plus", messages: [] } }),
    { ZHIPU_API_KEY: "k" }
  );
  const body = JSON.parse(init.body);
  assert.equal(body.model, "glm-4-flash", "model must be forced to glm-4-flash");
  assert.deepEqual(body.messages, []);
});

test("buildUpstreamRequest passes through messages untouched", () => {
  const messages = [{ role: "user", content: "hi" }];
  const { init } = buildUpstreamRequest(
    fakeReq({ parsedBody: { messages, temperature: 0.7 } }),
    { ZHIPU_API_KEY: "k" }
  );
  const body = JSON.parse(init.body);
  assert.deepEqual(body.messages, messages);
  assert.equal(body.temperature, 0.7);
});

test("extractAnswer pulls content from OpenAI-compatible response", () => {
  const data = { choices: [{ message: { content: "hello world" } }] };
  assert.equal(extractAnswer(data), "hello world");
});

test("extractAnswer throws on empty or malformed response", () => {
  assert.throws(() => extractAnswer({ choices: [{ message: { content: "" } }] }), /empty answer/i);
  assert.throws(() => extractAnswer({ choices: [] }), /empty answer/i);
  assert.throws(() => extractAnswer({}), /empty answer/i);
  assert.throws(() => extractAnswer(null), /empty answer/i);
});

test("jsonResponse sets CORS headers and JSON content type", async () => {
  const res = jsonResponse(200, { answer: "ok" });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("Content-Type"), "application/json; charset=utf-8");
  assert.equal(res.headers.get("Access-Control-Allow-Origin"), "*");
  assert.equal(res.headers.get("Access-Control-Allow-Methods"), "POST, OPTIONS");
  assert.equal(res.headers.get("Access-Control-Allow-Headers"), "Content-Type, X-User-Key");
  const body = await res.json();
  assert.deepEqual(body, { answer: "ok" });
});

test("jsonResponse carries non-200 status for upstream errors", async () => {
  const res = jsonResponse(502, { error: "upstream error 502" });
  assert.equal(res.status, 502);
  assert.equal(res.headers.get("Access-Control-Allow-Origin"), "*");
  const body = await res.json();
  assert.equal(body.error, "upstream error 502");
});
