import { createServer } from "node:http";
import { createHash } from "node:crypto";

/**
 * Mock WeChat API server for testing.
 *
 * Simulates the real WeChat API contract:
 * 1. GET /token -> { access_token, expires_in }
 * 2. POST /media/uploadimg -> { url }  (multipart/form-data with media file)
 * 3. POST /material/add_material?type=image -> { media_id } (multipart/form-data)
 * 4. POST /draft/add -> { media_id }  (JSON with articles[].thumb_media_id required)
 * 5. POST /freepublish/submit -> { publish_id }
 * 6. POST /freepublish/get -> { publish_status: number, article_detail: { item: [{ article_url }] } }
 *
 * publish_status values (matching real WeChat):
 *   0 = success, 1 = publishing, 2 = original failed, 3 = common failed,
 *   4 = audit rejected, 5 = user deleted after success, 6 = system banned after success
 *
 * Supports configurable failure modes for testing.
 */

function parseMultipart(req, body) {
  const contentType = req.headers["content-type"] || "";
  const boundaryMatch = contentType.match(/boundary=(.+)/);
  if (!boundaryMatch) return null;

  const boundary = boundaryMatch[1].trim();
  const sep = Buffer.from("--" + boundary);
  const parts = [];
  let start = 0;

  while (true) {
    const idx = body.indexOf(sep, start);
    if (idx === -1) break;
    // Skip past the boundary + CRLF
    const partStart = idx + sep.length + 2; // +2 for CRLF after boundary
    const nextIdx = body.indexOf(sep, partStart);
    if (nextIdx === -1) break;
    const partData = body.subarray(partStart, nextIdx - 2); // -2 for CRLF before boundary
    parts.push(partData);
    start = nextIdx;
  }

  const result = { fields: {}, files: {} };
  for (const part of parts) {
    const headerEnd = part.indexOf("\r\n\r\n");
    if (headerEnd === -1) continue;
    const headerStr = part.subarray(0, headerEnd).toString("utf8");
    const data = part.subarray(headerEnd + 4);

    const nameMatch = headerStr.match(/name="([^"]+)"/);
    if (!nameMatch) continue;
    const fieldName = nameMatch[1];

    const filenameMatch = headerStr.match(/filename="([^"]*)"/);
    if (filenameMatch) {
      // File part
      result.files[fieldName] = {
        filename: filenameMatch[1],
        data,
        contentType: headerStr.match(/Content-Type:\s*(.+)/i)?.[1]?.trim() || "application/octet-stream",
      };
    } else {
      result.fields[fieldName] = data.toString("utf8");
    }
  }
  return result;
}

export function createMockWechatServer(options = {}) {
  const {
    failureMode = null,
    failureAttempts = 1,
    pollDelay = 0,
  } = options;

  let requestCount = 0;
  let pollCount = 0;
  const drafts = new Map();
  const publishes = new Map();
  const materials = new Map();

  const server = createServer(async (req, res) => {
    res.setHeader("Content-Type", "application/json");

    const url = new URL(req.url, "http://localhost");
    const pathname = url.pathname;
    const query = Object.fromEntries(url.searchParams);

    // Collect request body
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const rawBody = Buffer.concat(chunks);

    requestCount++;

    // Helper to check failure mode
    function shouldFail(mode) {
      return failureMode === mode && requestCount <= failureAttempts;
    }

    try {
      // Token endpoint
      if (pathname === "/token") {
        if (shouldFail("auth_failure")) {
          res.writeHead(401);
          res.end(JSON.stringify({ errcode: 40001, errmsg: "invalid credential" }));
          return;
        }
        if (shouldFail("rate_limit")) {
          res.writeHead(429);
          res.end(JSON.stringify({ errcode: 45009, errmsg: "reach max api daily request limit" }));
          return;
        }
        if (shouldFail("server_error")) {
          res.writeHead(500);
          res.end(JSON.stringify({ errcode: -1, errmsg: "system error" }));
          return;
        }
        if (failureMode === "network_timeout") {
          // Never respond - simulates timeout
          return;
        }
        res.writeHead(200);
        res.end(JSON.stringify({
          access_token: "mock_token_" + Date.now(),
          expires_in: 7200,
        }));
        return;
      }

      // Upload content image (multipart/form-data with media file)
      // Returns { url }
      if (pathname === "/media/uploadimg") {
        const multipart = parseMultipart(req, rawBody);
        if (!multipart || !multipart.files.media) {
          res.writeHead(200);
          res.end(JSON.stringify({ errcode: 41006, errmsg: "media missing" }));
          return;
        }
        if (failureMode === "uploadimg_no_url") {
          // Simulate an uploadimg response that returns no url (e.g. unknown
          // errcode). The publisher must fail before add_draft rather than
          // pushing undefined into the article HTML.
          res.writeHead(200);
          res.end(JSON.stringify({ errcode: 46003, errmsg: "media id not found" }));
          return;
        }
        if (shouldFail("server_error")) {
          res.writeHead(500);
          res.end(JSON.stringify({ errcode: -1, errmsg: "system error" }));
          return;
        }
        const fileData = multipart.files.media.data;
        const hash = createHash("md5").update(fileData).digest("hex").slice(0, 8);
        const imgUrl = `http://localhost/mock/images/${hash}.png`;
        res.writeHead(200);
        res.end(JSON.stringify({ url: imgUrl }));
        return;
      }

      // Add permanent material (multipart/form-data, type=image)
      // Returns { media_id }
      if (pathname === "/material/add_material" && query.type === "image") {
        const multipart = parseMultipart(req, rawBody);
        if (!multipart || !multipart.files.media) {
          res.writeHead(200);
          res.end(JSON.stringify({ errcode: 41006, errmsg: "media missing" }));
          return;
        }
        const fileData = multipart.files.media.data;
        const hash = createHash("md5").update(fileData).digest("hex").slice(0, 12);
        const mediaId = `mock_cover_${hash}`;
        materials.set(mediaId, { type: "image", data: fileData });
        res.writeHead(200);
        res.end(JSON.stringify({ media_id: mediaId, url: `http://localhost/mock/cover/${hash}.png` }));
        return;
      }

      // Add draft (JSON)
      // Requires articles[].thumb_media_id
      if (pathname === "/draft/add") {
        let parsedBody = {};
        try { parsedBody = JSON.parse(rawBody.toString("utf8")); } catch { /* empty */ }

        if (shouldFail("audit_failure")) {
          res.writeHead(200);
          res.end(JSON.stringify({ errcode: 40302, errmsg: "content contains sensitive words" }));
          return;
        }

        // Validate that articles have thumb_media_id
        const articles = parsedBody.articles || [];
        for (const art of articles) {
          if (!art.thumb_media_id) {
            res.writeHead(200);
            res.end(JSON.stringify({ errcode: 47003, errmsg: "thumb_media_id is required" }));
            return;
          }
        }

        const mediaId = "mock_draft_" + Date.now();
        drafts.set(mediaId, parsedBody);
        res.writeHead(200);
        res.end(JSON.stringify({ media_id: mediaId, errcode: 0 }));
        return;
      }

      // Submit publish
      if (pathname === "/freepublish/submit") {
        let parsedBody = {};
        try { parsedBody = JSON.parse(rawBody.toString("utf8")); } catch { /* empty */ }

        const publishId = "mock_publish_" + Date.now();
        publishes.set(publishId, {
          media_id: parsedBody.media_id,
          status: 1, // publishing
          created_at: Date.now(),
          poll_count: 0,
        });
        res.writeHead(200);
        res.end(JSON.stringify({ publish_id: publishId, errcode: 0 }));
        return;
      }

      // Poll publish status
      // publish_status is a NUMBER per WeChat docs:
      // 0=success, 1=publishing, 2=original fail, 3=common fail,
      // 4=audit reject, 5=user delete, 6=system ban
      if (pathname === "/freepublish/get") {
        let parsedBody = {};
        try { parsedBody = JSON.parse(rawBody.toString("utf8")); } catch { /* empty */ }

        const pub = publishes.get(parsedBody.publish_id);
        if (!pub) {
          res.writeHead(200);
          res.end(JSON.stringify({ errcode: 40013, errmsg: "invalid publish_id" }));
          return;
        }

        pub.poll_count++;
        pollCount++;

        const articleUrl = `http://localhost/mock/article/${parsedBody.publish_id}`;

        if (failureMode === "always_pending") {
          res.writeHead(200);
          res.end(JSON.stringify({
            publish_id: parsedBody.publish_id,
            publish_status: 1,
            article_detail: { item: [] },
            errcode: 0,
          }));
          return;
        }

        if (failureMode === "audit_failure" && pub.poll_count >= 2) {
          res.writeHead(200);
          res.end(JSON.stringify({
            publish_id: parsedBody.publish_id,
            publish_status: 4, // audit rejected
            fail_msg: "Content audit rejected: sensitive content detected",
            article_detail: { item: [] },
            errcode: 0,
          }));
          return;
        }

        // Simulate: publishing (1) on first poll, success (0) on second
        if (pub.poll_count === 1) {
          res.writeHead(200);
          res.end(JSON.stringify({
            publish_id: parsedBody.publish_id,
            publish_status: 1,
            article_detail: { item: [] },
            errcode: 0,
          }));
        } else {
          res.writeHead(200);
          res.end(JSON.stringify({
            publish_id: parsedBody.publish_id,
            publish_status: 0, // success
            article_detail: {
              item: [{ article_url: articleUrl }],
            },
            errcode: 0,
          }));
        }
        return;
      }

      // Unknown endpoint
      res.writeHead(404);
      res.end(JSON.stringify({ errcode: -1, errmsg: "not found" }));
    } catch (error) {
      res.writeHead(500);
      res.end(JSON.stringify({ errcode: -1, errmsg: error.message }));
    }
  });

  server.getRequestCount = () => requestCount;
  server.getPollCount = () => pollCount;
  server.getDrafts = () => drafts;
  server.getPublishes = () => publishes;
  server.getMaterials = () => materials;

  return server;
}

/**
 * Start a mock server on a random port and return { server, url }.
 */
export function startMockWechatServer(options = {}) {
  return new Promise((resolve, reject) => {
    const server = createMockWechatServer(options);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const url = `http://127.0.0.1:${addr.port}`;
      resolve({ server, url });
    });
    server.on("error", reject);
  });
}
