/**
 * Chess Moment 的 AI 教练代理 — Cloudflare Worker。
 *
 * 作用：
 *   1. 给浏览器加 CORS 头（智谱官方 API 不开放跨域，浏览器直连会被拦截）。
 *   2. 把智谱 API Key 注入请求头，Key 只存在 Worker 环境变量里，不暴露给前端。
 *   3. 转发到智谱 GLM-4-Flash（免费），把回答回给前端。
 *
 * 部署：见 doc/AI_SETUP.md。核心逻辑（构造请求、解析响应、CORS 头）抽成了导出的
 * 纯函数，便于在 Node 测试里用 mock fetch 验证，不必真的部署。
 */

// 智谱 GLM 对话补全端点。
const ZHIPU_ENDPOINT = "https://open.bigmodel.cn/api/paas/v4/chat/completions";
const MODEL = "glm-4-flash";

// 浏览器允许的来源。Worker 是公开代理，用 * 最简单；如需收紧可改成你的 Pages 域名。
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-User-Key",
  "Access-Control-Max-Age": "86400",
};

/**
 * 从入站请求解析出要发给智谱的请求参数（纯函数，可测）。
 * @param {Request} request 浏览器来的 fetch 请求
 * @param {object} env Worker 环境变量，含 ZHIPU_API_KEY
 * @returns {{url, init}} 给 fetch 用的 {url, init}
 *   - 若用户在请求头里带了 X-User-Key，用它覆盖环境变量里的 Key（支持用户自带 Key）。
 *   - 若两处都没 Key，抛错，调用方应返回 500。
 */
export function buildUpstreamRequest(request, env) {
  const userKey = request.headers.get("X-User-Key");
  const apiKey = userKey || env.ZHIPU_API_KEY;
  if (!apiKey) {
    throw new Error("missing API key: set ZHIPU_API_KEY in Worker env or pass X-User-Key");
  }
  return {
    url: ZHIPU_ENDPOINT,
    init: {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      // body 原样透传前端发的 {messages, ...}，但强制覆盖 model 字段为 glm-4-flash，
      // 防止前端篡改 model 调用收费模型。
      body: JSON.stringify({ ...request._parsedBody, model: MODEL }),
    },
  };
}

/**
 * 从智谱的响应里抽出回答文本（纯函数，可测）。
 * 智谱返回兼容 OpenAI 格式：{ choices: [{ message: { content } }] }。
 */
export function extractAnswer(upstreamJson) {
  const content = upstreamJson?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    throw new Error("empty answer from upstream");
  }
  return content;
}

/**
 * 构造一个给前端的 JSON 响应，带 CORS 头（纯函数，可测）。
 */
export function jsonResponse(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...CORS_HEADERS },
  });
}

/**
 * Worker 入口：绑定 fetch 事件。
 * @param {Request} request
 * @param {object} env  Worker 环境变量（在 Dashboard 配置）
 *   - ZHIPU_API_KEY: 智谱 API Key（必填，或由前端 X-User-Key 覆盖）
 */
export default {
  async fetch(request, env) {
    // CORS 预检：直接放行。
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }
    if (request.method !== "POST") {
      return jsonResponse(405, { error: "method not allowed, use POST" });
    }

    try {
      const parsed = await request.json().catch(() => ({}));
      // 把解析后的 body 挂到 request 上供 buildUpstreamRequest 读取（避免二次消费流）。
      const req = new Request(request.url, request);
      req._parsedBody = parsed;

      const { url, init } = buildUpstreamRequest(req, env);
      const upstream = await fetch(url, init);

      if (!upstream.ok) {
        const errText = await upstream.text().catch(() => "");
        return jsonResponse(upstream.status, {
          error: `upstream error ${upstream.status}`,
          detail: errText.slice(0, 500),
        });
      }

      const data = await upstream.json();
      const answer = extractAnswer(data);
      return jsonResponse(200, { answer });
    } catch (err) {
      return jsonResponse(500, { error: "worker failed", detail: String(err.message || err) });
    }
  },
};
