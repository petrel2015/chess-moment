import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { Chess } from "chess.js";

const MOVE_RE = /^[a-h][1-8][a-h][1-8]$/;
const FEN_RE = /^([prnbqkPRNBQK1-8]+\/){7}[prnbqkPRNBQK1-8]+ [wb] /;

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

    // Attempt the user move
    let userMove;
    try {
      userMove = game.move({ from: moveStr.slice(0, 2), to: moveStr.slice(2, 4) });
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
      let oppMove;
      try {
        oppMove = game.move({ from: oppStr.slice(0, 2), to: oppStr.slice(2, 4) });
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
