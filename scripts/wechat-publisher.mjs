import { readFile, writeFile, rename, mkdir, unlink } from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";

/**
 * WeChat Publisher Adapter
 *
 * Modes:
 * - dry-run: validates payload, no network calls
 * - mock: full flow against a local mock WeChat server
 * - production: only when explicitly configured (requires real credentials)
 *
 * Features:
 * - Idempotency: keyed by wechat:<publishedAt>:<slug>, prevents duplicate drafts/publishes
 * - Atomic state save: temp file + rename for crash safety
 * - Concurrent guard: lock file per idempotency key
 * - Retry: exponential backoff for 429/5xx/network timeouts only
 * - No retry: auth errors, permission errors, audit failures, content errors
 * - Configurable fetch timeout with AbortController
 * - Structured diagnostics: stage, status, error_code, attempts, summary
 * - Credential masking: never logs tokens, secrets, or cookies
 *
 * Real WeChat API contract:
 * - /media/uploadimg: multipart/form-data with media file -> { url }
 * - /material/add_material?type=image: multipart/form-data -> { media_id }
 * - /draft/add: JSON with articles[].thumb_media_id required -> { media_id }
 * - /freepublish/get: { publish_status: number, article_detail: { item: [{ article_url }] } }
 *   publish_status: 0=success 1=publishing 2=orig-fail 3=fail 4=audit-reject 5=user-del 6=sys-ban
 */

const REAL_WECHAT_DOMAINS = new Set(["api.weixin.qq.com"]);

/**
 * Mask a value, showing only first 4 and last 4 characters.
 */
function maskSecret(value) {
  if (!value || typeof value !== "string") return "***";
  if (value.length <= 8) return "***";
  return value.slice(0, 4) + "..." + value.slice(-4);
}

/**
 * Sanitize a log-safe representation of an object, masking all credential fields.
 */
function sanitizeForLog(obj) {
  const sensitive = ["access_token", "appsecret", "secret", "cookie", "authorization", "token"];
  const sanitized = JSON.parse(JSON.stringify(obj));
  function walk(node) {
    if (typeof node !== "object" || node === null) return;
    for (const key of Object.keys(node)) {
      if (sensitive.some(s => key.toLowerCase().includes(s))) {
        node[key] = maskSecret(String(node[key]));
      } else if (typeof node[key] === "object") {
        walk(node[key]);
      }
    }
  }
  walk(sanitized);
  return sanitized;
}

/**
 * Check if a URL points to a real WeChat API domain using precise hostname match.
 */
function isRealWechatUrl(url) {
  try {
    const parsed = new URL(url);
    return REAL_WECHAT_DOMAINS.has(parsed.hostname);
  } catch {
    return false;
  }
}

/**
 * Retryable error class for transient failures.
 */
class TransientError extends Error {
  constructor(message, statusCode) {
    super(message);
    this.name = "TransientError";
    this.statusCode = statusCode;
  }
}

/**
 * Fatal error class for non-retryable failures.
 */
class FatalError extends Error {
  constructor(message, errorCode) {
    super(message);
    this.name = "FatalError";
    this.errorCode = errorCode || "FATAL";
  }
}

/**
 * Sleep for a given number of milliseconds.
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Compute exponential backoff delay.
 */
function backoffDelay(attempt, baseMs = 1000, maxMs = 30000) {
  const delay = Math.min(baseMs * Math.pow(2, attempt), maxMs);
  return delay + (attempt * 100);
}

/**
 * Fetch with retry for transient errors only.
 * Fatal errors are thrown immediately.
 * Returns { response, body, status, attempts } where attempts is the total
 * number of HTTP calls made (including retries).
 *
 * @param {string} url - Request URL
 * @param {object} options - fetch options
 * @param {number} maxRetries - Max retry attempts for transient errors
 * @param {number} timeoutMs - Per-request timeout in milliseconds (0 = no timeout)
 */
async function fetchWithRetry(url, options = {}, maxRetries = 3, timeoutMs = 30000) {
  let lastError;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    let timeoutSignal = null;
    let timer = null;
    try {
      const fetchOpts = { ...options };
      if (timeoutMs > 0) {
        // AbortController timeout - works in all Node 18+ environments
        timeoutSignal = new AbortController();
        timer = setTimeout(() => timeoutSignal.abort(new Error("Request timeout")), timeoutMs);
        fetchOpts.signal = timeoutSignal.signal;
      }

      const response = await fetch(url, fetchOpts);
      const body = await response.json().catch(() => ({}));

      if (response.status === 429 || response.status >= 500) {
        throw new TransientError(
          `HTTP ${response.status}: ${JSON.stringify(body)}`,
          response.status
        );
      }

      if (response.status === 401 || response.status === 403) {
        throw new FatalError(
          `Auth/permission error: HTTP ${response.status}: ${JSON.stringify(body)}`,
          response.status === 401 ? "AUTH_ERROR" : "PERMISSION_DENIED"
        );
      }

      // WeChat API error codes
      if (body.errcode) {
        if (body.errcode === 40001 || body.errcode === 48001) {
          throw new FatalError(
            `WeChat API error ${body.errcode}: ${body.errmsg}`,
            body.errcode === 40001 ? "AUTH_ERROR" : "PERMISSION_DENIED"
          );
        }
        if (body.errcode === 45009) {
          throw new TransientError(
            `WeChat API quota exceeded: ${body.errcode}: ${body.errmsg}`,
            429
          );
        }
        if (body.errcode === 40302 || body.errcode === 43004) {
          throw new FatalError(
            `Content audit failed: ${body.errcode}: ${body.errmsg}`,
            "AUDIT_FAILED"
          );
        }
      }

      return { response, body, status: response.status, attempts: attempt + 1 };
    } catch (error) {
      if (error instanceof FatalError) throw error;

      lastError = error;

      // Abort/timeout errors are transient
      const isTimeout = error.name === "AbortError" || error.name === "TimeoutError"
        || (error.cause && error.cause.code === "UND_ERR_ABORTED");

      const isTransient = error instanceof TransientError
        || isTimeout
        || error.name === "TypeError"
        || error.code === "ECONNRESET"
        || error.code === "ETIMEDOUT"
        || error.code === "ENOTFOUND";

      if (!isTransient || attempt === maxRetries) {
        throw error;
      }

      const delay = backoffDelay(attempt);
      await sleep(delay);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  throw lastError;
}

/**
 * Build a multipart/form-data body for file upload.
 * Returns { body: Buffer, contentType: string }.
 */
function buildMultipartFormData(fieldName, filename, fileBuffer, mimeType = "image/png", extraFields = {}) {
  const boundary = "----ChessMoment" + createHash("md5").update(filename + Date.now()).digest("hex").slice(0, 16);

  const parts = [];

  // Extra text fields
  for (const [key, value] of Object.entries(extraFields)) {
    parts.push(Buffer.from(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="${key}"\r\n\r\n` +
      `${value}\r\n`
    ));
  }

  // File part
  parts.push(Buffer.from(
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="${fieldName}"; filename="${filename}"\r\n` +
    `Content-Type: ${mimeType}\r\n\r\n`
  ));
  parts.push(fileBuffer);
  parts.push(Buffer.from(`\r\n--${boundary}--\r\n`));

  return {
    body: Buffer.concat(parts),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

/**
 * State record for tracking publish status.
 */
function createStateRecord(payload, mode) {
  return {
    idempotency_key: payload.idempotency_key,
    content_hash: payload.content_hash,
    mode,
    built_at: payload.built_at,
    interactive_url: payload.interactive_url,
    stages: {
      token: { status: "pending", attempts: 0 },
      upload_images: { status: "pending", attempts: 0, results: [] },
      upload_cover: { status: "pending", attempts: 0, media_id: null },
      add_draft: { status: "pending", attempts: 0, media_id: null },
      submit_publish: { status: "pending", attempts: 0, publish_id: null },
      poll_result: { status: "pending", attempts: 0, final_status: null, article_url: null },
    },
    final_status: "in_progress",
    article_url: null,
    error_code: null,
    error_message: null,
    attempts: 0,
    last_updated: new Date().toISOString(),
    summary: "",
  };
}

/**
 * Update stage status in state record.
 */
function updateStage(state, stageName, update) {
  state.stages[stageName] = { ...state.stages[stageName], ...update, last_updated: new Date().toISOString() };
  state.last_updated = new Date().toISOString();
  state.attempts += 1;
}

/**
 * Generate a human-readable summary from the state record.
 */
function generateSummary(state) {
  const key = state.idempotency_key;
  if (state.final_status === "success") {
    return `发布成功：${key} -> ${state.article_url || "(无URL)"}`;
  }
  if (state.final_status === "skipped") {
    return `跳过（已存在成功记录）：${key}`;
  }
  if (state.final_status === "failed") {
    return `发布失败：${key} [${state.error_code}] ${state.error_message || ""}`;
  }
  return `进行中：${key}`;
}

/**
 * Load existing state records from disk.
 */
async function loadStateStore(stateDir) {
  const stateFile = path.join(stateDir, "publish-state.json");
  try {
    const raw = await readFile(stateFile, "utf8");
    return JSON.parse(raw);
  } catch {
    return { records: {} };
  }
}

/**
 * Save state records to disk atomically (temp file + rename).
 * Uses randomUUID for the temp file suffix so that concurrent saves
 * within the same process/millisecond cannot collide on the same name.
 * If rename fails the orphaned temp file is removed so no residue remains.
 */
async function saveStateStore(stateDir, store) {
  const stateFile = path.join(stateDir, "publish-state.json");
  const tmpFile = path.join(stateDir, `.publish-state.json.${randomUUID()}.tmp`);
  await mkdir(stateDir, { recursive: true });
  try {
    await writeFile(tmpFile, JSON.stringify(store, null, 2));
    await rename(tmpFile, stateFile);
  } catch (err) {
    // Best-effort cleanup of the orphaned temp file so concurrent runs
    // don't accumulate residue on failure. Ignore cleanup errors.
    try { await unlink(tmpFile); } catch { /* already gone */ }
    throw err;
  }
}

/**
 * Try to acquire an exclusive lock for an idempotency key using O_EXCL.
 * Returns true if the lock was acquired, false if another process holds it.
 * The lock is released by deleting the lock file.
 */
async function acquireLock(stateDir, key) {
  await mkdir(stateDir, { recursive: true });
  const lockFile = path.join(stateDir, `${key.replace(/[^a-zA-Z0-9_-]/g, "_")}.lock`);
  try {
    const { open } = await import("node:fs/promises");
    const fh = await open(lockFile, "wx"); // O_EXCL: fails if file exists
    await fh.writeFile(JSON.stringify({ pid: process.pid, time: Date.now() }));
    await fh.close();
    return true;
  } catch (err) {
    if (err.code === "EEXIST") {
      // Lock exists - check if it's stale (older than 10 minutes)
      try {
        const raw = await readFile(lockFile, "utf8");
        const lockInfo = JSON.parse(raw);
        if (Date.now() - lockInfo.time > 10 * 60 * 1000) {
          // Stale lock - remove it and retry
          const { unlink } = await import("node:fs/promises");
          await unlink(lockFile);
          return acquireLock(stateDir, key);
        }
      } catch {
        // Can't read lock info - assume it's valid
      }
      return false;
    }
    throw err;
  }
}

/**
 * Release the lock for an idempotency key.
 */
async function releaseLock(stateDir, key) {
  const lockFile = path.join(stateDir, `${key.replace(/[^a-zA-Z0-9_-]/g, "_")}.lock`);
  try {
    const { unlink } = await import("node:fs/promises");
    await unlink(lockFile);
  } catch {
    // Lock file may already be removed
  }
}

/**
 * Map WeChat numeric publish_status to our internal status.
 * 0 = success, 1 = publishing, 2 = original fail, 3 = common fail,
 * 4 = audit reject, 5 = user delete, 6 = system ban
 */
function interpretPublishStatus(publishStatus) {
  const num = typeof publishStatus === "number" ? publishStatus : Number(publishStatus);
  switch (num) {
    case 0:
      return { finalStatus: "success", errorCode: null, errorMsg: null };
    case 1:
      return { finalStatus: "pending", errorCode: null, errorMsg: null };
    case 2:
      return { finalStatus: "failed", errorCode: "ORIGINAL_FAILED", errorMsg: "原创校验失败" };
    case 3:
      return { finalStatus: "failed", errorCode: "PUBLISH_FAILED", errorMsg: "常规发布失败" };
    case 4:
      return { finalStatus: "failed", errorCode: "AUDIT_FAILED", errorMsg: "审核不通过" };
    case 5:
      return { finalStatus: "failed", errorCode: "USER_DELETED", errorMsg: "成功后被用户删除" };
    case 6:
      return { finalStatus: "failed", errorCode: "SYSTEM_BANNED", errorMsg: "成功后被系统封禁" };
    default:
      return { finalStatus: "pending", errorCode: null, errorMsg: null };
  }
}

/**
 * Extract article_url from the freepublish/get response per official shape:
 * article_detail.item[0].article_url
 */
function extractArticleUrl(statusResp) {
  if (statusResp.article_detail?.item?.[0]?.article_url) {
    return statusResp.article_detail.item[0].article_url;
  }
  // Fallback for legacy/edge cases
  if (statusResp.article_url) {
    return statusResp.article_url;
  }
  return null;
}

/**
 * Publish a WeChat article.
 *
 * @param {object} payload - The wechat payload from buildWechatPayload()
 * @param {object} config - Configuration
 * @param {string} config.mode - "dry-run" | "mock" | "production"
 * @param {string} [config.mockServerUrl] - URL for mock WeChat server (required for mock mode)
 * @param {string} [config.appId] - WeChat AppID (production only)
 * @param {string} [config.appSecret] - WeChat AppSecret (production only, must come from secret store)
 * @param {string} [config.stateDir] - Directory for state persistence
 * @param {number} [config.maxRetries] - Max retry attempts for transient errors
 * @param {number} [config.pollIntervalMs] - Polling interval for publish status
 * @param {number} [config.pollMaxAttempts] - Max polling attempts
 * @param {number} [config.timeoutMs] - Per-request timeout in milliseconds (default: 30000)
 * @param {string} [config.assetsDir] - Directory containing board PNG assets (default: _site/wechat/assets)
 * @returns {Promise<object>} Diagnostics result
 */
export async function publishWechat(payload, config = {}) {
  const mode = config.mode || "dry-run";
  const stateDir = config.stateDir || path.join(process.cwd(), "_artifacts", "wechat", "state");
  const maxRetries = config.maxRetries ?? 3;
  const pollIntervalMs = config.pollIntervalMs ?? 100;
  const pollMaxAttempts = config.pollMaxAttempts ?? 10;
  const timeoutMs = config.timeoutMs ?? 30000;
  const assetsDir = config.assetsDir || path.join(process.cwd(), "_site", "wechat", "assets");

  if (!["dry-run", "mock", "production"].includes(mode)) {
    throw new FatalError(`Invalid mode: ${mode}`, "INVALID_CONFIG");
  }

  if (mode === "production") {
    if (!config.appId || !config.appSecret) {
      throw new FatalError("Production mode requires appId and appSecret", "INVALID_CONFIG");
    }
    if (config.appSecret.length < 10) {
      throw new FatalError("AppSecret appears invalid", "INVALID_CONFIG");
    }
  }

  if (mode === "mock" && !config.mockServerUrl) {
    throw new FatalError("Mock mode requires mockServerUrl", "INVALID_CONFIG");
  }

  // Dry-run mode must never touch real WeChat domains
  if (mode === "dry-run") {
    const state = createStateRecord(payload, mode);
    updateStage(state, "token", { status: "skipped", reason: "dry-run mode" });
    updateStage(state, "upload_images", { status: "skipped", reason: "dry-run mode", results: [] });
    updateStage(state, "upload_cover", { status: "skipped", reason: "dry-run mode" });
    updateStage(state, "add_draft", { status: "skipped", reason: "dry-run mode" });
    updateStage(state, "submit_publish", { status: "skipped", reason: "dry-run mode" });
    updateStage(state, "poll_result", { status: "skipped", reason: "dry-run mode" });
    state.final_status = "dry_run_validated";
    state.summary = `Dry-run validation passed: ${payload.idempotency_key}`;
    state.last_updated = new Date().toISOString();

    const store = await loadStateStore(stateDir);
    store.records[payload.idempotency_key] = state;
    await saveStateStore(stateDir, store);

    return { state, log: sanitizeForLog(state) };
  }

  // For mock and production: check idempotency first
  const store = await loadStateStore(stateDir);
  const existing = store.records[payload.idempotency_key];
  if (existing && existing.final_status === "success") {
    existing.summary = generateSummary(existing);
    existing.last_updated = new Date().toISOString();
    await saveStateStore(stateDir, store);
    return { state: existing, log: sanitizeForLog(existing), idempotent: true };
  }

  // Concurrent guard: acquire exclusive lock for this idempotency key.
  // If the lock cannot be acquired, another instance is already publishing.
  const lockAcquired = await acquireLock(stateDir, payload.idempotency_key);
  if (!lockAcquired) {
    const skipState = existing || createStateRecord(payload, mode);
    skipState.summary = `跳过（另一实例正在发布）：${payload.idempotency_key}`;
    skipState.last_updated = new Date().toISOString();
    if (existing) {
      await saveStateStore(stateDir, store);
    }
    return { state: skipState, log: sanitizeForLog(skipState), idempotent: true, concurrent_skip: true };
  }

  // Re-check idempotency after acquiring lock (in case another run completed
  // while we were waiting). The whole lock-holding body is wrapped in a
  // try/finally so that releaseLock runs on EVERY exit path -- success, an
  // exception from a publish stage, or even an exception from the final
  // state-save. This guarantees a crashed/throwing run can never leak the
  // lock for its full 10-minute TTL; the next run can acquire it immediately.
  let publishResult;
  try {
    const freshStore = await loadStateStore(stateDir);
    const freshExisting = freshStore.records[payload.idempotency_key];
    if (freshExisting && freshExisting.final_status === "success") {
      freshExisting.summary = generateSummary(freshExisting);
      freshExisting.last_updated = new Date().toISOString();
      await saveStateStore(stateDir, freshStore);
      publishResult = { state: freshExisting, log: sanitizeForLog(freshExisting), idempotent: true };
    } else {
      const state = createStateRecord(payload, mode);
      freshStore.records[payload.idempotency_key] = state;
      await saveStateStore(stateDir, freshStore);

      const apiBase = mode === "production" ? "https://api.weixin.qq.com/cgi-bin" : config.mockServerUrl;

      try {
        // Stage 1: Get access token
        updateStage(state, "token", { status: "in_progress" });
        let accessToken;
        if (mode === "production") {
          const tokenUrl = `${apiBase}/token?grant_type=client_credential&appid=${config.appId}&secret=${config.appSecret}`;
          const { body, attempts } = await fetchWithRetry(tokenUrl, { method: "GET" }, maxRetries, timeoutMs);
          if (body.errcode) {
            throw new FatalError(`Token request failed: ${body.errcode}: ${body.errmsg}`, "AUTH_ERROR");
          }
          accessToken = body.access_token;
          updateStage(state, "token", { status: "success", attempts });
        } else {
          const tokenUrl = `${apiBase}/token?grant_type=client_credential&appid=mock_appid&secret=mock_secret`;
          const { body, attempts } = await fetchWithRetry(tokenUrl, { method: "GET" }, maxRetries, timeoutMs);
          accessToken = body.access_token;
          updateStage(state, "token", { status: "success", attempts });
        }

        // Stage 2: Upload content images (board PNG)
        // Real WeChat: /media/uploadimg expects multipart/form-data with "media" file field
        // Returns { url } - the WeChat CDN URL for use in article content
        updateStage(state, "upload_images", { status: "in_progress" });
        const imageResults = [];
        let imgAttempts = 0;
        for (const asset of payload.assets) {
          if (asset.type === "board_png") {
            const uploadUrl = `${apiBase}/media/uploadimg?access_token=${accessToken}`;
            // Read the actual PNG file bytes
            const pngPath = path.join(assetsDir, "boards", `${payload.lesson.slug}.png`);
            let pngBuffer;
            try {
              pngBuffer = await readFile(pngPath);
            } catch {
              throw new FatalError(`Board PNG not found: ${pngPath}`, "ASSET_MISSING");
            }

            const { body: uploadBody, contentType } = buildMultipartFormData(
              "media",
              `${payload.lesson.slug}.png`,
              pngBuffer,
              "image/png",
            );

            const { body, attempts } = await fetchWithRetry(uploadUrl, {
              method: "POST",
              headers: { "Content-Type": contentType },
              body: uploadBody,
            }, maxRetries, timeoutMs);

            // WeChat must return a { url }. A response with no url (unknown
            // errcode, media-missing 41006, or any other contract violation)
            // is a fatal upload failure -- we must NOT push an undefined url
            // into the article HTML or proceed to add_draft.
            const uploadedUrl = body.url;
            if (!uploadedUrl || typeof uploadedUrl !== "string") {
              throw new FatalError(
                `Image upload failed: uploadimg returned no url (errcode=${body.errcode ?? "null"}, errmsg=${body.errmsg ?? "null"})`,
                "IMAGE_UPLOAD_FAILED",
              );
            }

            imgAttempts += attempts;
            imageResults.push({
              local_path: asset.local_path,
              url: uploadedUrl,
              content_hash: asset.content_hash,
            });
          }
        }
        updateStage(state, "upload_images", {
          status: "success",
          attempts: imgAttempts,
          results: imageResults,
        });

        // Replace local board src in HTML with uploaded WeChat URLs
        let finalHtml = payload.article.body_html;
        for (const img of imageResults) {
          // Replace both the relative path and any variations
          finalHtml = finalHtml.replace(
            new RegExp(img.local_path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"),
            img.url
          );
        }

        // Stage 3: Upload cover image as permanent material for thumb_media_id
        // Real WeChat: /material/add_material?type=image expects multipart/form-data
        // Returns { media_id }
        updateStage(state, "upload_cover", { status: "in_progress" });
        const coverUrl = `${apiBase}/material/add_material?type=image&access_token=${accessToken}`;
        // Use the same board PNG as cover
        const coverPngPath = path.join(assetsDir, "boards", `${payload.lesson.slug}.png`);
        let coverPngBuffer;
        try {
          coverPngBuffer = await readFile(coverPngPath);
        } catch {
          throw new FatalError(`Cover PNG not found: ${coverPngPath}`, "ASSET_MISSING");
        }

        const { body: coverBody, contentType: coverContentType } = buildMultipartFormData(
          "media",
          `cover-${payload.lesson.slug}.png`,
          coverPngBuffer,
          "image/png",
        );

        const { body: coverResp, attempts: coverAttempts } = await fetchWithRetry(coverUrl, {
          method: "POST",
          headers: { "Content-Type": coverContentType },
          body: coverBody,
        }, maxRetries, timeoutMs);

        const thumbMediaId = coverResp.media_id;
        if (!thumbMediaId) {
          throw new FatalError(`Cover upload failed: no media_id in response`, "COVER_UPLOAD_FAILED");
        }
        updateStage(state, "upload_cover", {
          status: "success",
          attempts: coverAttempts,
          media_id: thumbMediaId,
        });

        // Stage 4: Add draft (JSON with thumb_media_id required)
        updateStage(state, "add_draft", { status: "in_progress" });
        const draftUrl = `${apiBase}/draft/add?access_token=${accessToken}`;
        const draftBody = {
          articles: [{
            title: payload.article.title,
            author: payload.article.author,
            digest: payload.article.digest,
            content: finalHtml,
            content_source_url: payload.article.content_source_url,
            thumb_media_id: thumbMediaId,
            need_open_comment: payload.article.need_open_comment ? 1 : 0,
          }],
        };
        const { body: draftResp, attempts: draftAttempts } = await fetchWithRetry(draftUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(draftBody),
        }, maxRetries, timeoutMs);
        const draftMediaId = draftResp.media_id;
        if (!draftMediaId) {
          throw new FatalError(`Draft creation failed: ${draftResp.errcode}: ${draftResp.errmsg}`, "DRAFT_FAILED");
        }
        updateStage(state, "add_draft", {
          status: "success",
          attempts: draftAttempts,
          media_id: draftMediaId,
        });

        // Stage 5: Submit for publishing (freepublish/submit)
        updateStage(state, "submit_publish", { status: "in_progress" });
        const publishUrl = `${apiBase}/freepublish/submit?access_token=${accessToken}`;
        const { body: publishResp, attempts: submitAttempts } = await fetchWithRetry(publishUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ media_id: draftMediaId }),
        }, maxRetries, timeoutMs);
        const publishId = publishResp.publish_id;
        if (!publishId) {
          throw new FatalError(`Publish submission failed: ${publishResp.errcode}: ${publishResp.errmsg}`, "SUBMIT_FAILED");
        }
        updateStage(state, "submit_publish", {
          status: "success",
          attempts: submitAttempts,
          publish_id: publishId,
        });

        // Stage 6: Poll for final status (critical: publish_id != success)
        // WeChat publish_status is a NUMBER: 0=success, 1=publishing, 2-6=various failures
        updateStage(state, "poll_result", { status: "in_progress" });
        let finalStatus = null;
        let articleUrl = null;
        let pollError = null;
        let pollAttemptsTotal = 0;

        for (let pollAttempt = 0; pollAttempt < pollMaxAttempts; pollAttempt++) {
          const statusUrl = `${apiBase}/freepublish/get?access_token=${accessToken}`;
          const { body: statusResp, attempts: pollAttempts } = await fetchWithRetry(statusUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ publish_id: publishId }),
          }, maxRetries, timeoutMs);
          pollAttemptsTotal += pollAttempts;

          const interpreted = interpretPublishStatus(statusResp.publish_status);

          if (interpreted.finalStatus === "success") {
            finalStatus = "success";
            articleUrl = extractArticleUrl(statusResp);
            break;
          } else if (interpreted.finalStatus === "failed") {
            pollError = statusResp.fail_msg || interpreted.errorMsg;
            finalStatus = "failed";
            state.error_code = interpreted.errorCode;
            break;
          }
          // Still pending (publishing): wait and retry
          await sleep(pollIntervalMs);
        }

        if (finalStatus === "success") {
          updateStage(state, "poll_result", {
            status: "success",
            attempts: pollAttemptsTotal,
            final_status: "success",
            article_url: articleUrl,
          });
          state.final_status = "success";
          state.article_url = articleUrl;
        } else if (finalStatus === "failed") {
          updateStage(state, "poll_result", {
            status: "failed",
            attempts: pollAttemptsTotal,
            final_status: "failed",
            error: pollError,
          });
          state.final_status = "failed";
          if (!state.error_code) state.error_code = "AUDIT_FAILED";
          state.error_message = pollError;
        } else {
          updateStage(state, "poll_result", {
            status: "timeout",
            attempts: pollAttemptsTotal,
            final_status: "timeout",
          });
          state.final_status = "failed";
          state.error_code = "POLL_TIMEOUT";
          state.error_message = `Publish status polling timed out after ${pollMaxAttempts} attempts`;
        }

      } catch (error) {
        if (error instanceof FatalError) {
          state.final_status = "failed";
          state.error_code = error.errorCode;
          state.error_message = error.message;

          for (const [name, stage] of Object.entries(state.stages)) {
            if (stage.status === "in_progress") {
              updateStage(state, name, { status: "failed", error: error.message });
            }
          }
        } else {
          state.final_status = "failed";
          state.error_code = "TRANSIENT_ERROR";
          state.error_message = error.message;

          for (const [name, stage] of Object.entries(state.stages)) {
            if (stage.status === "in_progress") {
              updateStage(state, name, { status: "failed", error: error.message, exhausted_retries: true });
            }
          }
        }
      }

      state.summary = generateSummary(state);
      state.last_updated = new Date().toISOString();

      const finalStore = await loadStateStore(stateDir);
      finalStore.records[payload.idempotency_key] = state;
      await saveStateStore(stateDir, finalStore);

      publishResult = { state, log: sanitizeForLog(state) };
    }
  } finally {
    // Release the lock on EVERY exit path -- success, a stage exception,
    // or even a throw from the final state-save above. A leaked lock would
    // otherwise block the same idempotency key for its full 10-minute TTL.
    await releaseLock(stateDir, payload.idempotency_key);
  }

  return publishResult;
}

/**
 * Query the status of a publish operation by idempotency key.
 */
export async function getPublishStatus(idempotencyKey, stateDir) {
  const dir = stateDir || path.join(process.cwd(), "_artifacts", "wechat", "state");
  const store = await loadStateStore(dir);
  const record = store.records[idempotencyKey];
  if (!record) {
    return { found: false, summary: `No record found for key: ${idempotencyKey}` };
  }
  return { found: true, state: record, summary: generateSummary(record) };
}

/**
 * List all publish state records.
 */
export async function listPublishStates(stateDir) {
  const dir = stateDir || path.join(process.cwd(), "_artifacts", "wechat", "state");
  const store = await loadStateStore(dir);
  return Object.values(store.records).map(r => ({
    idempotency_key: r.idempotency_key,
    final_status: r.final_status,
    article_url: r.article_url,
    error_code: r.error_code,
    summary: generateSummary(r),
  }));
}

/**
 * Retry a failed publish operation.
 * Only retries if the failure was transient.
 */
export async function retryFailed(idempotencyKey, payload, config) {
  const stateDir = config.stateDir || path.join(process.cwd(), "_artifacts", "wechat", "state");
  const store = await loadStateStore(stateDir);
  const existing = store.records[idempotencyKey];

  if (!existing) {
    throw new FatalError(`No record found for key: ${idempotencyKey}`, "NOT_FOUND");
  }

  if (existing.final_status === "success") {
    return { state: existing, log: sanitizeForLog(existing), idempotent: true, message: "Already succeeded, no retry needed" };
  }

  if (existing.error_code === "AUDIT_FAILED" || existing.error_code === "AUTH_ERROR" || existing.error_code === "PERMISSION_DENIED") {
    throw new FatalError(`Cannot retry: error was ${existing.error_code} (non-retryable)`, existing.error_code);
  }

  delete store.records[idempotencyKey];
  await saveStateStore(stateDir, store);

  return publishWechat(payload, config);
}

export { FatalError, TransientError, sanitizeForLog, maskSecret, isRealWechatUrl, fetchWithRetry, buildMultipartFormData, interpretPublishStatus, extractArticleUrl, acquireLock, releaseLock, saveStateStore, loadStateStore };
