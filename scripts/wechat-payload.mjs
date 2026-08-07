import { createHash } from "node:crypto";
import {
  escapeHtml,
  publicLesson,
  interactiveUrl,
  idempotencyKey,
  contentHash,
  PUBLIC_BASE_URL,
} from "./content-lib.mjs";
import { renderWechatBodyFragment } from "./wechat-render.mjs";
import { boardHash } from "./board-png.mjs";

/**
 * Generate the structured WeChat publishing payload for a lesson.
 *
 * This payload contains NO credentials and is safe to persist, log, or inspect.
 * It describes everything the publisher adapter needs to create a WeChat draft:
 * - metadata (title, digest, author, etc.)
 * - the HTML body fragment (WeChat-safe)
 * - local asset references (board PNG) that the publisher must upload
 * - the content_source_url (interactive page absolute URL)
 * - content hash and idempotency key for dedup
 */
export async function buildWechatPayload(lesson, opts = {}) {
  const pub = publicLesson(lesson);
  const bodyHtml = renderWechatBodyFragment(lesson);
  const hash = await contentHash(pub);
  const sourceUrl = interactiveUrl(lesson);
  const key = idempotencyKey(lesson);
  const boardPngPath = `assets/boards/${lesson.slug}.png`;
  const boardPngHash = boardHash(lesson.challenge.fen);

  // Optional wechat metadata from lesson
  const wc = lesson.wechat || {};
  const digest = wc.digest || lesson.summary;
  const author = wc.author || "棋刻";
  const needOpenComment = wc.need_open_comment !== undefined ? wc.need_open_comment : false;

  const payload = {
    idempotency_key: key,
    content_hash: hash,
    built_at: new Date().toISOString(),
    lesson: {
      slug: lesson.slug,
      published_at: lesson.publishedAt,
      title: lesson.title,
      summary: lesson.summary,
      edition: lesson.edition,
      category: lesson.category,
      difficulty: lesson.difficulty,
      duration: lesson.duration,
      topic: lesson.topic,
    },
    article: {
      title: lesson.title,
      author,
      digest,
      need_open_comment: needOpenComment,
      content_source_url: sourceUrl,
      body_html: bodyHtml,
    },
    assets: [
      {
        type: "board_png",
        local_path: boardPngPath,
        content_hash: boardPngHash,
        description: `静态棋盘图：${lesson.title}`,
      },
    ],
    interactive_url: sourceUrl,
    wechat_preview_url: `${PUBLIC_BASE_URL}/wechat/${lesson.slug}.html`,
  };

  return payload;
}

/**
 * Validate that a payload contains no credentials or local secrets.
 * Returns an array of violation strings (empty if clean).
 */
export function auditPayload(payload) {
  const violations = [];
  const serialized = JSON.stringify(payload);

  // Check for common credential patterns
  const secretPatterns = [
    { pattern: /AppSecret/i, label: "AppSecret" },
    { pattern: /access_token/i, label: "access_token" },
    { pattern: /["']?cookie["']?/i, label: "cookie" },
    { pattern: /\/Users\//, label: "local absolute path" },
    { pattern: /\/home\//, label: "local absolute path" },
  ];

  for (const { pattern, label } of secretPatterns) {
    if (pattern.test(serialized)) {
      violations.push(`payload contains ${label}`);
    }
  }

  return violations;
}
