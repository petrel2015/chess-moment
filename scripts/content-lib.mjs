import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { Chess } from "chess.js";

// 走法格式：4 字符标准 UCI（如 e2e4），或 5 字符兵升变（末位 q/r/b/n，如 e7e8q）。
const MOVE_RE = /^[a-h][1-8][a-h][1-8][qrbn]?$/;
const FEN_RE = /^([prnbqkPRNBQK1-8]+\/){7}[prnbqkPRNBQK1-8]+ [wb] /;
const SLUG_RE = /^[a-z0-9-]+$/;

/**
 * Default public site base URL.  Can be overridden via the
 * PUBLIC_BASE_URL environment variable.  Must not end with a slash.
 */
export const PUBLIC_BASE_URL = (
  process.env.PUBLIC_BASE_URL || "https://petrel2015.github.io/chess-moment"
).replace(/\/$/, "");

export async function loadLessons(root = process.cwd()) {
  const contentDir = path.join(root, "content");
  const files = (await readdir(contentDir))
    .filter(file => file.endsWith(".json"))
    .sort();
  const lessons = [];
  for (const file of files) {
    const raw = await readFile(path.join(contentDir, file), "utf8");
    const lesson = JSON.parse(raw);
    lesson.__file = file;
    lessons.push(lesson);
  }
  return lessons;
}

/**
 * Validate FEN parseability using the real chess rules library.
 * Returns null if valid, or an error string.
 */
function validateFenWithChessJs(fen) {
  try {
    // chess.js throws on invalid FEN in the constructor
    // eslint-disable-next-line no-new
    new Chess(fen);
    return null;
  } catch {
    return "FEN rejected by chess rules library";
  }
}

/**
 * Validate the full move sequence of a lesson challenge using real chess rules.
 * Each user move and optional opponent reply must be legal in sequence.
 * Returns an array of error strings (empty if all valid).
 */
function validateMoveSequence(at, challenge) {
  const errors = [];
  const fen = challenge.fen;
  let game;
  try {
    game = new Chess(fen);
  } catch {
    errors.push(`${at}: cannot start move validation (FEN rejected by chess rules)`);
    return errors;
  }

  const steps = challenge.steps || [];
  for (let index = 0; index < steps.length; index++) {
    const step = steps[index];
    const stepNum = index + 1;
    const moveStr = step.move || "";
    if (!MOVE_RE.test(moveStr)) {
      errors.push(`${at}: step ${stepNum} invalid move format "${moveStr}"`);
      continue;
    }

    // Verify it is this side's turn
    const turn = game.turn();
    const pieceOnFrom = game.get(moveStr.slice(0, 2));
    if (pieceOnFrom && pieceOnFrom.color !== turn) {
      errors.push(
        `${at}: step ${stepNum} wrong side to move (expected ${turn}, piece is ${pieceOnFrom.color})`
      );
      continue;
    }

    // Attempt the user move (carry the 5th UCI char as promotion when present)
    const userMoveArgs = { from: moveStr.slice(0, 2), to: moveStr.slice(2, 4) };
    if (moveStr[4]) userMoveArgs.promotion = moveStr[4];
    let userMove;
    try {
      userMove = game.move(userMoveArgs);
    } catch {
      userMove = null;
    }
    if (!userMove) {
      errors.push(`${at}: step ${stepNum} illegal user move ${moveStr}`);
      continue;
    }

    // Opponent reply (optional on last step)
    if (step.opponent) {
      const oppStr = step.opponent;
      if (!MOVE_RE.test(oppStr)) {
        errors.push(`${at}: step ${stepNum} invalid opponent move format "${oppStr}"`);
        continue;
      }
      const oppMoveArgs = { from: oppStr.slice(0, 2), to: oppStr.slice(2, 4) };
      if (oppStr[4]) oppMoveArgs.promotion = oppStr[4];
      let oppMove;
      try {
        oppMove = game.move(oppMoveArgs);
      } catch {
        oppMove = null;
      }
      if (!oppMove) {
        errors.push(`${at}: step ${stepNum} illegal opponent reply ${oppStr}`);
      }
    }
  }

  return errors;
}

export function validateLessons(lessons) {
  const errors = [];
  const slugs = new Set();
  const publishedAts = new Set();
  const required = [
    "slug", "publishedAt", "edition", "category", "title", "summary",
    "difficulty", "duration", "introduction", "culture", "challenge", "review"
  ];

  for (const lesson of lessons) {
    const at = lesson.__file || lesson.slug || "unknown";
    for (const field of required) {
      if (lesson[field] === undefined || lesson[field] === null || lesson[field] === "") {
        errors.push(`${at}: missing ${field}`);
      }
    }
    if (!/^[a-z0-9-]+$/.test(lesson.slug || "")) errors.push(`${at}: invalid slug`);
    if (slugs.has(lesson.slug)) errors.push(`${at}: duplicate slug ${lesson.slug}`);
    slugs.add(lesson.slug);

    // Unique publish time: each lesson must have a distinct publishedAt
    if (lesson.publishedAt) {
      if (publishedAts.has(lesson.publishedAt)) {
        errors.push(`${at}: duplicate publishedAt ${lesson.publishedAt}`);
      }
      publishedAts.add(lesson.publishedAt);
    }

    if (!Array.isArray(lesson.introduction) || lesson.introduction.length < 2) {
      errors.push(`${at}: introduction needs at least 2 paragraphs`);
    }
    if (!lesson.culture?.title || !lesson.culture?.content) errors.push(`${at}: incomplete culture`);
    if (!lesson.review?.title || !Array.isArray(lesson.review?.steps) || !lesson.review?.principle) {
      errors.push(`${at}: incomplete review`);
    }

    const challenge = lesson.challenge || {};
    if (!FEN_RE.test(challenge.fen || "")) {
      errors.push(`${at}: invalid FEN format`);
    } else {
      // Real chess-rules FEN validation
      const fenErr = validateFenWithChessJs(challenge.fen);
      if (fenErr) errors.push(`${at}: ${fenErr}`);
    }
    if (!challenge.goal || !challenge.success || !challenge.defaultAnswer || !challenge.genericError) {
      errors.push(`${at}: incomplete challenge copy`);
    }
    if (!Array.isArray(challenge.steps) || challenge.steps.length < 3) {
      errors.push(`${at}: challenge needs at least 3 user decisions`);
    } else {
      challenge.steps.forEach((step, index) => {
        if (!MOVE_RE.test(step.move || "")) errors.push(`${at}: invalid step ${index + 1} move`);
        if (step.opponent && !MOVE_RE.test(step.opponent)) errors.push(`${at}: invalid opponent move at step ${index + 1}`);
        if (!step.note) errors.push(`${at}: step ${index + 1} needs note`);
        // alternatives：可选，合理但非最优的候选着。命中时讲解但不推进进度。
        if (step.alternatives !== undefined) {
          if (!Array.isArray(step.alternatives) || step.alternatives.length === 0) {
            errors.push(`${at}: step ${index + 1} alternatives must be a non-empty array if present`);
          } else {
            const altMoves = new Set([step.move]);
            step.alternatives.forEach(alt => {
              if (!MOVE_RE.test(alt.move || "")) errors.push(`${at}: invalid alternative move at step ${index + 1}`);
              if (!alt.note) errors.push(`${at}: step ${index + 1} alternative needs note`);
              if (altMoves.has(alt.move)) errors.push(`${at}: step ${index + 1} duplicate alternative move ${alt.move}`);
              altMoves.add(alt.move);
            });
          }
        }
      });

      // Full move-sequence validation with real chess rules (only if FEN is parseable)
      if (FEN_RE.test(challenge.fen || "")) {
        const seqErrors = validateMoveSequence(at, challenge);
        errors.push(...seqErrors);
      }
    }
    if (!Array.isArray(challenge.odds) || challenge.odds.length !== (challenge.steps?.length || 0) + 1) {
      errors.push(`${at}: odds must contain initial state plus one entry per user step`);
    } else {
      challenge.odds.forEach((odds, index) => {
        if (odds.white + odds.draw + odds.black !== 100) {
          errors.push(`${at}: odds ${index} do not sum to 100`);
        }
      });
    }
    if (!challenge.quick || !Array.isArray(challenge.suggestions) || challenge.suggestions.length < 2) {
      errors.push(`${at}: quick questions need at least 2 suggestions`);
    } else {
      challenge.suggestions.forEach(item => {
        if (!item.label || !challenge.quick[item.key]) errors.push(`${at}: suggestion ${item.key} has no answer`);
      });
    }
    // tags：可选，非空字符串数组（用于 M3 路径浏览与当前 archive 展示）。
    if (lesson.tags !== undefined) {
      if (!Array.isArray(lesson.tags) || lesson.tags.length === 0
        || lesson.tags.some(tag => typeof tag !== "string" || !tag.trim())) {
        errors.push(`${at}: tags must be a non-empty array of strings if present`);
      }
    }
    // prerequisites：可选，slug 数组，引用必须指向当前课程集合中存在的课程。
    if (lesson.prerequisites !== undefined) {
      if (!Array.isArray(lesson.prerequisites) || lesson.prerequisites.length === 0
        || lesson.prerequisites.some(slug => !SLUG_RE.test(slug))) {
        errors.push(`${at}: prerequisites must be a non-empty array of slugs if present`);
      }
    }

    // Optional wechat metadata validation
    if (lesson.wechat !== undefined) {
      if (typeof lesson.wechat !== "object" || lesson.wechat === null) {
        errors.push(`${at}: wechat must be an object`);
      } else {
        const wc = lesson.wechat;
        if (wc.author !== undefined && typeof wc.author !== "string") {
          errors.push(`${at}: wechat.author must be a string`);
        }
        if (wc.digest !== undefined && typeof wc.digest !== "string") {
          errors.push(`${at}: wechat.digest must be a string`);
        }
        if (wc.need_open_comment !== undefined && typeof wc.need_open_comment !== "boolean") {
          errors.push(`${at}: wechat.need_open_comment must be a boolean`);
        }
      }
    }
  }

  // prerequisites 引用死链检查（需要所有 slug 已收集完毕）。
  for (const lesson of lessons) {
    if (!Array.isArray(lesson.prerequisites)) continue;
    const at = lesson.__file || lesson.slug || "unknown";
    for (const slug of lesson.prerequisites) {
      if (!slugs.has(slug)) errors.push(`${at}: prerequisite ${slug} not found`);
    }
  }
  return errors;
}

export function publicLesson(lesson) {
  const { __file, ...clean } = lesson;
  return clean;
}

export function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/**
 * Build the absolute URL for a lesson's interactive page.
 */
export function interactiveUrl(lesson) {
  return `${PUBLIC_BASE_URL}/${lesson.slug}.html`;
}

/**
 * Build the absolute URL for a lesson's wechat preview page.
 */
export function wechatPreviewUrl(lesson) {
  return `${PUBLIC_BASE_URL}/wechat/${lesson.slug}.html`;
}

/**
 * Build the idempotency key for a lesson.
 */
export function idempotencyKey(lesson) {
  return `wechat:${lesson.publishedAt}:${lesson.slug}`;
}

/**
 * Compute a stable content hash for a lesson's public payload.
 */
export async function contentHash(lesson) {
  const { createHash } = await import("node:crypto");
  const payload = JSON.stringify(publicLesson(lesson));
  return createHash("sha256").update(payload).digest("hex").slice(0, 16);
}
