import assert from "node:assert/strict";
import { rm, mkdir, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { loadLessons, publicLesson } from "../scripts/content-lib.mjs";
import { buildWechatPayload, auditPayload } from "../scripts/wechat-payload.mjs";
import {
  publishWechat,
  getPublishStatus,
  retryFailed,
  FatalError,
  sanitizeForLog,
  maskSecret,
  isRealWechatUrl,
  interpretPublishStatus,
  extractArticleUrl,
  buildMultipartFormData,
  acquireLock,
  releaseLock,
  saveStateStore,
  loadStateStore,
} from "../scripts/wechat-publisher.mjs";
import { startMockWechatServer } from "../scripts/mock-wechat-server.mjs";

const root = process.cwd();

// Each test gets its own unique state directory to avoid concurrent test
// interference. node:test runs tests concurrently by default; sharing a
// single state dir would trigger the publisher's concurrent-guard logic.
let stateDirCounter = 0;
function makeTestStateDir() {
  stateDirCounter++;
  return path.join(root, "_artifacts", "wechat", `state-test-${stateDirCounter}-${Date.now()}`);
}

async function getTestPayload(slug) {
  const lessons = await loadLessons(root);
  const lesson = lessons.find(l => l.slug === slug) || lessons[0];
  return buildWechatPayload(publicLesson(lesson));
}

async function cleanTestState(dir) {
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
}

// Helper: build _site before running mock tests (publisher reads board PNGs)
let siteBuilt = false;
async function ensureSiteBuilt() {
  if (siteBuilt) return;
  const { spawnSync } = await import("node:child_process");
  const result = spawnSync(process.execPath, ["scripts/build-site.mjs"], {
    cwd: root,
    encoding: "utf8",
  });
  if (result.status !== 0) throw new Error(`Build failed: ${result.stderr}`);
  siteBuilt = true;
}

test("dry-run mode validates payload without network calls", async () => {
  const dir = makeTestStateDir();
  await cleanTestState(dir);
  const payload = await getTestPayload("rook-ladder");

  const result = await publishWechat(payload, {
    mode: "dry-run",
    stateDir: dir,
  });

  assert.equal(result.state.final_status, "dry_run_validated");
  assert.equal(result.state.stages.token.status, "skipped");
  assert.equal(result.state.stages.upload_images.status, "skipped");
  assert.equal(result.state.stages.upload_cover.status, "skipped");
  assert.equal(result.state.stages.add_draft.status, "skipped");
  assert.equal(result.state.stages.submit_publish.status, "skipped");
  assert.equal(result.state.stages.poll_result.status, "skipped");
  assert.ok(result.state.summary.includes("Dry-run"));
});

test("mock mode completes full publish flow successfully", async () => {
  await ensureSiteBuilt();
  const dir = makeTestStateDir();
  await cleanTestState(dir);
  const { server, url } = await startMockWechatServer();

  try {
    const payload = await getTestPayload("rook-ladder");
    const result = await publishWechat(payload, {
      mode: "mock",
      mockServerUrl: url,
      stateDir: dir,
      pollIntervalMs: 10,
      pollMaxAttempts: 20,
    });

    assert.equal(result.state.final_status, "success", `Expected success, got: ${result.state.final_status} - ${result.state.error_message}`);
    assert.ok(result.state.article_url, "Should have article URL");
    assert.ok(result.state.article_url.includes("mock/article"), `Article URL should be mock URL: ${result.state.article_url}`);

    // All stages should be successful
    assert.equal(result.state.stages.token.status, "success");
    assert.equal(result.state.stages.upload_images.status, "success");
    assert.equal(result.state.stages.upload_cover.status, "success");
    assert.ok(result.state.stages.upload_cover.media_id, "Should have cover media_id");
    assert.equal(result.state.stages.add_draft.status, "success");
    assert.ok(result.state.stages.add_draft.media_id, "Should have draft media_id");
    assert.equal(result.state.stages.submit_publish.status, "success");
    assert.ok(result.state.stages.submit_publish.publish_id, "Should have publish_id");
    assert.equal(result.state.stages.poll_result.status, "success");
  } finally {
    server.close();
  }
});

test("publish_id is returned but flow waits for final success status", async () => {
  await ensureSiteBuilt();
  const dir = makeTestStateDir();
  await cleanTestState(dir);
  const { server, url } = await startMockWechatServer();

  try {
    const payload = await getTestPayload("italian-center-plan");
    const result = await publishWechat(payload, {
      mode: "mock",
      mockServerUrl: url,
      stateDir: dir,
      pollIntervalMs: 10,
      pollMaxAttempts: 20,
    });

    assert.equal(result.state.final_status, "success");
    assert.ok(result.state.stages.submit_publish.publish_id, "publish_id was obtained");
    assert.equal(result.state.stages.poll_result.status, "success");
    assert.ok(result.state.stages.poll_result.attempts >= 2, "Should have polled at least twice (pending then success)");
  } finally {
    server.close();
  }
});

test("idempotency: same key does not create duplicate publish", async () => {
  await ensureSiteBuilt();
  const dir = makeTestStateDir();
  await cleanTestState(dir);
  const { server, url } = await startMockWechatServer();

  try {
    const payload = await getTestPayload("king-opposition");

    const result1 = await publishWechat(payload, {
      mode: "mock",
      mockServerUrl: url,
      stateDir: dir,
      pollIntervalMs: 10,
      pollMaxAttempts: 20,
    });
    assert.equal(result1.state.final_status, "success");

    const result2 = await publishWechat(payload, {
      mode: "mock",
      mockServerUrl: url,
      stateDir: dir,
      pollIntervalMs: 10,
      pollMaxAttempts: 20,
    });
    assert.equal(result2.state.final_status, "success");
    assert.ok(result2.idempotent, "Second call should be idempotent");
    assert.equal(result1.state.article_url, result2.state.article_url, "Should return same article URL");
  } finally {
    server.close();
  }
});

test("auth failure (401) is not retried", async () => {
  await ensureSiteBuilt();
  const dir = makeTestStateDir();
  await cleanTestState(dir);
  const { server, url } = await startMockWechatServer({ failureMode: "auth_failure", failureAttempts: 1 });

  try {
    const payload = await getTestPayload("improve-worst-piece");
    const result = await publishWechat(payload, {
      mode: "mock",
      mockServerUrl: url,
      stateDir: dir,
      maxRetries: 3,
    });

    assert.equal(result.state.final_status, "failed");
    assert.equal(result.state.error_code, "AUTH_ERROR");
    assert.equal(result.state.stages.token.status, "failed");
  } finally {
    server.close();
  }
});

test("audit failure is detected and not retried", async () => {
  await ensureSiteBuilt();
  const dir = makeTestStateDir();
  await cleanTestState(dir);
  const { server, url } = await startMockWechatServer({ failureMode: "audit_failure", failureAttempts: 1 });

  try {
    const payload = await getTestPayload("exchange-order");
    const result = await publishWechat(payload, {
      mode: "mock",
      mockServerUrl: url,
      stateDir: dir,
      maxRetries: 3,
      pollIntervalMs: 10,
      pollMaxAttempts: 5,
    });

    assert.equal(result.state.final_status, "failed");
    assert.ok(
      result.state.error_code === "AUDIT_FAILED" || result.state.error_message?.includes("audit"),
      `Expected audit failure, got: ${result.state.error_code} - ${result.state.error_message}`
    );
  } finally {
    server.close();
  }
});

test("429 rate limit is retried with backoff", async () => {
  await ensureSiteBuilt();
  const dir = makeTestStateDir();
  await cleanTestState(dir);
  const { server, url } = await startMockWechatServer({ failureMode: "rate_limit", failureAttempts: 2 });

  try {
    const payload = await getTestPayload("rook-ladder");
    const result = await publishWechat(payload, {
      mode: "mock",
      mockServerUrl: url,
      stateDir: dir,
      maxRetries: 5,
      pollIntervalMs: 10,
      pollMaxAttempts: 10,
    });

    assert.equal(result.state.final_status, "success", `Expected success after retry, got: ${result.state.final_status} - ${result.state.error_message}`);
    assert.ok(result.state.stages.token.attempts >= 2, "Should have retried token request");
  } finally {
    server.close();
  }
});

test("5xx server error is retried with backoff", async () => {
  await ensureSiteBuilt();
  const dir = makeTestStateDir();
  await cleanTestState(dir);
  const { server, url } = await startMockWechatServer({ failureMode: "server_error", failureAttempts: 2 });

  try {
    const payload = await getTestPayload("king-opposition");
    const result = await publishWechat(payload, {
      mode: "mock",
      mockServerUrl: url,
      stateDir: dir,
      maxRetries: 5,
      pollIntervalMs: 10,
      pollMaxAttempts: 10,
    });

    assert.equal(result.state.final_status, "success", `Expected success after retry, got: ${result.state.final_status}`);
  } finally {
    server.close();
  }
});

test("network timeout is retried and eventually fails", async () => {
  await ensureSiteBuilt();
  const dir = makeTestStateDir();
  await cleanTestState(dir);
  // network_timeout: server never responds, causing AbortController timeout
  const { server, url } = await startMockWechatServer({ failureMode: "network_timeout" });

  try {
    const payload = await getTestPayload("rook-ladder");
    const result = await publishWechat(payload, {
      mode: "mock",
      mockServerUrl: url,
      stateDir: dir,
      maxRetries: 2,
      timeoutMs: 500, // 500ms timeout
      pollIntervalMs: 10,
      pollMaxAttempts: 5,
    });

    assert.equal(result.state.final_status, "failed");
    assert.equal(result.state.error_code, "TRANSIENT_ERROR");
  } finally {
    server.close();
  }
});

test("poll timeout is reported as failure", async () => {
  await ensureSiteBuilt();
  const dir = makeTestStateDir();
  await cleanTestState(dir);
  const { server, url } = await startMockWechatServer({ failureMode: "always_pending" });

  try {
    const payload = await getTestPayload("italian-center-plan");
    const result = await publishWechat(payload, {
      mode: "mock",
      mockServerUrl: url,
      stateDir: dir,
      maxRetries: 3,
      pollIntervalMs: 10,
      pollMaxAttempts: 3,
    });

    assert.equal(result.state.final_status, "failed");
    assert.equal(result.state.error_code, "POLL_TIMEOUT");
    assert.equal(result.state.stages.poll_result.status, "timeout");
  } finally {
    server.close();
  }
});

test("status query returns existing record", async () => {
  await ensureSiteBuilt();
  const dir = makeTestStateDir();
  await cleanTestState(dir);
  const { server, url } = await startMockWechatServer();

  try {
    const payload = await getTestPayload("rook-ladder");
    await publishWechat(payload, {
      mode: "mock",
      mockServerUrl: url,
      stateDir: dir,
      pollIntervalMs: 10,
      pollMaxAttempts: 10,
    });

    const status = await getPublishStatus(payload.idempotency_key, dir);
    assert.ok(status.found);
    assert.equal(status.state.final_status, "success");
  } finally {
    server.close();
  }
});

test("status query returns not found for unknown key", async () => {
  const dir = makeTestStateDir();
  await cleanTestState(dir);
  const status = await getPublishStatus("wechat:unknown:unknown", dir);
  assert.ok(!status.found);
});

test("retry succeeds for transient failure", async () => {
  await ensureSiteBuilt();
  const dir = makeTestStateDir();
  await cleanTestState(dir);
  const { server: failServer, url: failUrl } = await startMockWechatServer({ failureMode: "server_error", failureAttempts: 10 });

  const payload = await getTestPayload("rook-ladder");
  try {
    const result1 = await publishWechat(payload, {
      mode: "mock",
      mockServerUrl: failUrl,
      stateDir: dir,
      maxRetries: 2,
    });
    assert.equal(result1.state.final_status, "failed");
    assert.equal(result1.state.error_code, "TRANSIENT_ERROR");
  } finally {
    failServer.close();
  }

  const { server: okServer, url: okUrl } = await startMockWechatServer();
  try {
    const result2 = await retryFailed(payload.idempotency_key, payload, {
      mode: "mock",
      mockServerUrl: okUrl,
      stateDir: dir,
      maxRetries: 3,
      pollIntervalMs: 10,
      pollMaxAttempts: 10,
    });
    assert.equal(result2.state.final_status, "success", `Retry should succeed, got: ${result2.state.final_status}`);
  } finally {
    okServer.close();
  }
});

test("retry is rejected for non-retryable error", async () => {
  await ensureSiteBuilt();
  const dir = makeTestStateDir();
  await cleanTestState(dir);
  const { server, url } = await startMockWechatServer({ failureMode: "auth_failure", failureAttempts: 10 });

  const payload = await getTestPayload("rook-ladder");
  try {
    const result = await publishWechat(payload, {
      mode: "mock",
      mockServerUrl: url,
      stateDir: dir,
      maxRetries: 2,
    });
    assert.equal(result.state.final_status, "failed");
    assert.equal(result.state.error_code, "AUTH_ERROR");

    await assert.rejects(
      retryFailed(payload.idempotency_key, payload, {
        mode: "mock",
        mockServerUrl: url,
        stateDir: dir,
      }),
      FatalError
    );
  } finally {
    server.close();
  }
});

test("sanitizeForLog masks credential fields", () => {
  const input = {
    access_token: "abcdefghijklmnopqrstuvwxyz123456",
    appsecret: "my-super-secret-value-here",
    cookie: "session=abc123",
    normal_field: "hello",
    nested: {
      token: "another-secret-value",
      data: "ok",
    },
  };

  const sanitized = sanitizeForLog(input);
  assert.ok(sanitized.access_token.includes("..."), "access_token should be masked");
  assert.ok(sanitized.appsecret.includes("..."), "appsecret should be masked");
  assert.ok(sanitized.cookie.includes("..."), "cookie should be masked");
  assert.equal(sanitized.normal_field, "hello");
  assert.ok(sanitized.nested.token.includes("..."), "nested token should be masked");
  assert.equal(sanitized.nested.data, "ok");
});

test("maskSecret shortens values correctly", () => {
  assert.equal(maskSecret("ab"), "***");
  assert.equal(maskSecret("abcdefgh"), "***");
  assert.equal(maskSecret("abcdefghij"), "abcd...ghij");
  assert.equal(maskSecret(null), "***");
  assert.equal(maskSecret(undefined), "***");
});

test("isRealWechatUrl uses hostname (not includes) for precise matching", () => {
  assert.ok(isRealWechatUrl("https://api.weixin.qq.com/cgi-bin/token"));
  assert.ok(!isRealWechatUrl("http://127.0.0.1:3000/token"));
  assert.ok(!isRealWechatUrl("http://localhost:8080/token"));
  // Must NOT match strings that merely contain the domain as a substring
  assert.ok(!isRealWechatUrl("http://evil.com/api.weixin.qq.com/token"));
  assert.ok(!isRealWechatUrl("http://api.weixin.qq.com.evil.com/token"));
  assert.ok(!isRealWechatUrl("not-a-url"));
});

test("auditPayload detects credential leakage", () => {
  const cleanPayload = {
    idempotency_key: "wechat:2026-01-01:test",
    article: { title: "test", content_source_url: "https://example.com/test.html" },
  };
  assert.equal(auditPayload(cleanPayload).length, 0);

  const dirtyPayload = {
    ...cleanPayload,
    access_token: "some-token",
  };
  assert.ok(auditPayload(dirtyPayload).length > 0);

  const pathPayload = {
    ...cleanPayload,
    some_path: "/Users/someone/secret/file",
  };
  assert.ok(auditPayload(pathPayload).length > 0);
});

test("structured diagnostics include stage, status, error_code, attempts", async () => {
  await ensureSiteBuilt();
  const dir = makeTestStateDir();
  await cleanTestState(dir);
  const { server, url } = await startMockWechatServer();

  try {
    const payload = await getTestPayload("rook-ladder");
    const result = await publishWechat(payload, {
      mode: "mock",
      mockServerUrl: url,
      stateDir: dir,
      pollIntervalMs: 10,
      pollMaxAttempts: 10,
    });

    const state = result.state;
    assert.ok(state.stages, "Should have stages object");
    assert.ok(state.final_status, "Should have final_status");
    assert.ok(typeof state.attempts === "number", "Should have attempts count");
    assert.ok(state.summary, "Should have summary");
    assert.ok(state.last_updated, "Should have last_updated timestamp");
    assert.ok(state.idempotency_key, "Should have idempotency_key");

    for (const [name, stage] of Object.entries(state.stages)) {
      assert.ok(stage.status, `Stage ${name} should have status`);
      assert.ok(typeof stage.attempts === "number", `Stage ${name} should have attempts`);
    }
  } finally {
    server.close();
  }
});

test("production mode without credentials is rejected", async () => {
  const dir = makeTestStateDir();
  await cleanTestState(dir);
  const payload = await getTestPayload("rook-ladder");

  await assert.rejects(
    publishWechat(payload, { mode: "production", stateDir: dir }),
    FatalError
  );
});

test("mock mode without mockServerUrl is rejected", async () => {
  const dir = makeTestStateDir();
  await cleanTestState(dir);
  const payload = await getTestPayload("rook-ladder");

  await assert.rejects(
    publishWechat(payload, { mode: "mock", stateDir: dir }),
    FatalError
  );
});

test("invalid mode is rejected", async () => {
  const dir = makeTestStateDir();
  await cleanTestState(dir);
  const payload = await getTestPayload("rook-ladder");

  await assert.rejects(
    publishWechat(payload, { mode: "invalid", stateDir: dir }),
    FatalError
  );
});

// ===== P0 Contract Tests: WeChat API multipart + numeric status =====

test("P0-1: uploadimg receives multipart/form-data with real PNG bytes", async () => {
  await ensureSiteBuilt();
  const dir = makeTestStateDir();
  await cleanTestState(dir);
  const { server, url } = await startMockWechatServer();

  try {
    const payload = await getTestPayload("rook-ladder");
    const result = await publishWechat(payload, {
      mode: "mock",
      mockServerUrl: url,
      stateDir: dir,
      pollIntervalMs: 10,
      pollMaxAttempts: 10,
    });

    assert.equal(result.state.final_status, "success");
    // The mock server validates multipart and returns a url; if it wasn't
    // multipart, the upload stage would have failed with errcode 41006.
    assert.equal(result.state.stages.upload_images.status, "success");
    assert.ok(result.state.stages.upload_images.results[0].url, "Should have uploaded image URL");
  } finally {
    server.close();
  }
});

test("P0-2: upload_cover stage produces thumb_media_id via add_material", async () => {
  await ensureSiteBuilt();
  const dir = makeTestStateDir();
  await cleanTestState(dir);
  const { server, url } = await startMockWechatServer();

  try {
    const payload = await getTestPayload("rook-ladder");
    const result = await publishWechat(payload, {
      mode: "mock",
      mockServerUrl: url,
      stateDir: dir,
      pollIntervalMs: 10,
      pollMaxAttempts: 10,
    });

    assert.equal(result.state.stages.upload_cover.status, "success");
    assert.ok(result.state.stages.upload_cover.media_id, "Should have thumb_media_id from add_material");
    assert.ok(result.state.stages.upload_cover.media_id.startsWith("mock_cover_"), "Cover media_id should come from add_material endpoint");
  } finally {
    server.close();
  }
});

test("P0-3: freepublish/get publish_status is numeric; article_url from article_detail.item[0]", async () => {
  await ensureSiteBuilt();
  const dir = makeTestStateDir();
  await cleanTestState(dir);
  const { server, url } = await startMockWechatServer();

  try {
    const payload = await getTestPayload("rook-ladder");
    const result = await publishWechat(payload, {
      mode: "mock",
      mockServerUrl: url,
      stateDir: dir,
      pollIntervalMs: 10,
      pollMaxAttempts: 10,
    });

    assert.equal(result.state.final_status, "success");
    // article_url must come from article_detail.item[0].article_url (official shape)
    assert.ok(result.state.article_url, "Should have article URL");
    assert.ok(result.state.article_url.includes("mock/article"), "Article URL from official path");
  } finally {
    server.close();
  }

  // Test interpretPublishStatus directly
  assert.equal(interpretPublishStatus(0).finalStatus, "success");
  assert.equal(interpretPublishStatus(1).finalStatus, "pending");
  assert.equal(interpretPublishStatus(3).finalStatus, "failed");
  assert.equal(interpretPublishStatus(3).errorCode, "PUBLISH_FAILED");
  assert.equal(interpretPublishStatus(4).finalStatus, "failed");
  assert.equal(interpretPublishStatus(4).errorCode, "AUDIT_FAILED");

  // Test extractArticleUrl from official shape
  const resp = {
    publish_status: 0,
    article_detail: { item: [{ article_url: "https://mp.weixin.qq.com/s/test123" }] },
  };
  assert.equal(extractArticleUrl(resp), "https://mp.weixin.qq.com/s/test123");
});

test("P0-4: draft/add content has local board src replaced with wechat URL and thumb_media_id present", async () => {
  await ensureSiteBuilt();
  const dir = makeTestStateDir();
  await cleanTestState(dir);
  const { server, url } = await startMockWechatServer();

  try {
    const payload = await getTestPayload("rook-ladder");
    const result = await publishWechat(payload, {
      mode: "mock",
      mockServerUrl: url,
      stateDir: dir,
      pollIntervalMs: 10,
      pollMaxAttempts: 10,
    });

    assert.equal(result.state.final_status, "success");

    // Inspect the draft stored by the mock server
    const drafts = server.getDrafts();
    const draftEntries = [...drafts.values()];
    assert.equal(draftEntries.length, 1, "Should have exactly one draft");

    const draftArticle = draftEntries[0].articles[0];

    // thumb_media_id must be present
    assert.ok(draftArticle.thumb_media_id, "draft/add article must have thumb_media_id");

    // Content must NOT contain the local board path
    assert.ok(
      !draftArticle.content.includes("assets/boards/"),
      "Content should not contain local board path - it must be replaced with wechat URL"
    );

    // Content MUST contain the uploaded wechat image URL
    const uploadedUrl = result.state.stages.upload_images.results[0].url;
    assert.ok(
      draftArticle.content.includes(uploadedUrl),
      `Content should contain uploaded wechat URL: ${uploadedUrl}`
    );
  } finally {
    server.close();
  }
});

test("P0-1 contract: buildMultipartFormData produces valid multipart with file", () => {
  const fileData = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]); // PNG signature
  const { body, contentType } = buildMultipartFormData("media", "test.png", fileData, "image/png", { description: "board" });

  assert.ok(contentType.startsWith("multipart/form-data; boundary="));
  const bodyStr = body.toString("utf8");
  assert.ok(bodyStr.includes('name="media"'));
  assert.ok(bodyStr.includes('filename="test.png"'));
  assert.ok(bodyStr.includes("Content-Type: image/png"));
  assert.ok(bodyStr.includes('name="description"'));
  assert.ok(bodyStr.includes("board"));
  // The actual file bytes should be in the body
  assert.ok(body.includes(fileData));
});

// ===== P1 Reliability Tests =====

test("P1-9: concurrent publish with same key is protected", async () => {
  await ensureSiteBuilt();
  const dir = makeTestStateDir();
  await cleanTestState(dir);
  const { server, url } = await startMockWechatServer();

  try {
    const payload = await getTestPayload("rook-ladder");

    // Launch two publishes concurrently with the same key
    const [r1, r2] = await Promise.all([
      publishWechat(payload, {
        mode: "mock",
        mockServerUrl: url,
        stateDir: dir,
        pollIntervalMs: 10,
        pollMaxAttempts: 20,
      }),
      publishWechat(payload, {
        mode: "mock",
        mockServerUrl: url,
        stateDir: dir,
        pollIntervalMs: 10,
        pollMaxAttempts: 20,
      }),
    ]);

    // At least one should succeed; the other should be idempotent or concurrent_skip
    const successes = [r1, r2].filter(r => r.state.final_status === "success");
    assert.ok(successes.length >= 1, "At least one publish should succeed");

    // The mock server should only have one draft (not two)
    const drafts = server.getDrafts();
    assert.ok(drafts.size <= 1, `Concurrent publishes should not create duplicate drafts, got ${drafts.size}`);
  } finally {
    server.close();
  }
});

test("P1-10: isRealWechatUrl rejects lookalike domains", () => {
  // These must NOT match - they contain the domain as substring but hostname differs
  assert.ok(!isRealWechatUrl("https://api.weixin.qq.com.evil.com/token"));
  assert.ok(!isRealWechatUrl("https://evil.com/redirect?url=api.weixin.qq.com"));
  assert.ok(!isRealWechatUrl("http://not-api.weixin.qq.com/token"));
  // These MUST match
  assert.ok(isRealWechatUrl("https://api.weixin.qq.com/cgi-bin/token"));
  assert.ok(isRealWechatUrl("https://api.weixin.qq.com:443/cgi-bin/token"));
});

// ===== P2 Reliability Tail-Item Tests (round 2) =====

test("P2-1: lock is released on exception so the same key is immediately re-acquirable", async () => {
  await ensureSiteBuilt();
  const dir = makeTestStateDir();
  await cleanTestState(dir);
  // network_timeout makes the publish throw inside the locked body
  const { server, url } = await startMockWechatServer({ failureMode: "network_timeout" });

  try {
    const payload = await getTestPayload("rook-ladder");
    const result = await publishWechat(payload, {
      mode: "mock",
      mockServerUrl: url,
      stateDir: dir,
      maxRetries: 2,
      timeoutMs: 500,
      pollIntervalMs: 10,
      pollMaxAttempts: 5,
    });

    // The publish itself failed (transient network error), but the run
    // must have released the lock rather than leaking it for 10 minutes.
    assert.equal(result.state.final_status, "failed");
    assert.equal(result.state.error_code, "TRANSIENT_ERROR");

    // Prove the lock is gone: acquireLock must succeed immediately on the
    // SAME key that just failed, without waiting for the TTL.
    const reAcquired = await acquireLock(dir, payload.idempotency_key);
    assert.ok(reAcquired, "Lock should be released after a failed publish so it can be re-acquired immediately");
    await releaseLock(dir, payload.idempotency_key);
  } finally {
    server.close();
  }
});

test("P2-2: saveStateStore is atomic and leaves no residual tmp under concurrent writes", async () => {
  const dir = makeTestStateDir();
  await cleanTestState(dir);

  // Hammer the same state dir with many concurrent saves. Each save uses a
  // unique store so the final file content is deterministic only if every
  // write was atomic; a collision on a PID+ms tmp name or a lost rename
  // would surface as a thrown error or a leftover .tmp file.
  const N = 60;
  const writes = [];
  for (let i = 0; i < N; i++) {
    writes.push(saveStateStore(dir, { records: { [`k${i}`]: { i } } }));
  }
  await Promise.all(writes);

  // No thrown errors means no ENOENT/race during rename. Now verify no
  // orphaned temp files remain in the directory.
  const entries = await readdir(dir);
  const tmpResidue = entries.filter(e => e.endsWith(".tmp"));
  assert.equal(tmpResidue.length, 0, `Expected no residual .tmp files, found: ${tmpResidue.join(", ")}`);

  // The final state file must be valid JSON (the last writer wins atomically).
  const finalStore = await loadStateStore(dir);
  assert.ok(finalStore && typeof finalStore === "object", "Final state store should be valid JSON");
  assert.ok(finalStore.records, "Final state store should have records");
});

test("P2-3: uploadimg with no url fails with IMAGE_UPLOAD_FAILED before add_draft", async () => {
  await ensureSiteBuilt();
  const dir = makeTestStateDir();
  await cleanTestState(dir);
  // uploadimg_no_url: server returns errcode with no url field
  const { server, url } = await startMockWechatServer({ failureMode: "uploadimg_no_url" });

  try {
    const payload = await getTestPayload("rook-ladder");
    const result = await publishWechat(payload, {
      mode: "mock",
      mockServerUrl: url,
      stateDir: dir,
      maxRetries: 2,
      pollIntervalMs: 10,
      pollMaxAttempts: 5,
    });

    // Must fail explicitly -- never write undefined into HTML or proceed.
    assert.equal(result.state.final_status, "failed");
    assert.equal(result.state.error_code, "IMAGE_UPLOAD_FAILED", `Expected IMAGE_UPLOAD_FAILED, got ${result.state.error_code}`);

    // upload_images stage must be marked failed; add_draft must NOT have run.
    assert.equal(result.state.stages.upload_images.status, "failed");
    assert.notEqual(result.state.stages.add_draft.status, "success", "add_draft must not succeed when uploadimg returned no url");
    assert.ok(
      !result.state.stages.add_draft.media_id,
      "add_draft must not have produced a media_id when image upload failed",
    );

    // No draft should have been created on the server side.
    const drafts = server.getDrafts();
    assert.equal(drafts.size, 0, "No draft should be created when uploadimg has no url");
  } finally {
    server.close();
  }
});
