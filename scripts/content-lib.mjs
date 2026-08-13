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

    // 多语言（中英）：英文文案字段必须齐全，保证英文版站点完整可用。
    const enRequired = [
      "title_en", "summary_en", "topic_en", "edition_en", "dateLabel_en", "category_en",
      "introduction_en", "culture_en", "review_en", "challenge_en",
    ];
    for (const field of enRequired) {
      if (lesson[field] === undefined || lesson[field] === null || lesson[field] === "") {
        errors.push(`${at}: missing ${field} (English copy)`);
      }
    }
    const cEn = lesson.challenge_en || {};
    if (lesson.challenge_en) {
      for (const f of ["title", "instruction", "goal", "success", "defaultAnswer", "genericError"]) {
        if (!cEn[f]) errors.push(`${at}: challenge_en missing ${f}`);
      }
      if (!Array.isArray(cEn.steps) || cEn.steps.length !== (lesson.challenge?.steps?.length || 0)) {
        errors.push(`${at}: challenge_en steps must mirror challenge.steps`);
      } else {
        cEn.steps.forEach((step, index) => {
          if (!step.note) errors.push(`${at}: challenge_en step ${index + 1} needs note`);
          if (Array.isArray(step.alternatives)) {
            step.alternatives.forEach(alt => {
              if (!alt.note) errors.push(`${at}: challenge_en step ${index + 1} alternative needs note`);
            });
          }
        });
      }
      if (!cEn.quick || !Array.isArray(cEn.suggestions) || cEn.suggestions.length < 2) {
        errors.push(`${at}: challenge_en quick questions need at least 2 suggestions`);
      } else {
        cEn.suggestions.forEach(item => {
          if (!item.label || !cEn.quick[item.key]) errors.push(`${at}: challenge_en suggestion ${item.key} has no answer`);
        });
      }
    }
    if (lesson.culture_en && (!lesson.culture_en.title || !lesson.culture_en.content)) {
      errors.push(`${at}: incomplete culture_en`);
    }
    if (lesson.review_en && (!lesson.review_en.title || !Array.isArray(lesson.review_en.steps) || !lesson.review_en.principle)) {
      errors.push(`${at}: incomplete review_en`);
    }
    if (lesson.tags_en !== undefined && !Array.isArray(lesson.tags_en)) {
      errors.push(`${at}: tags_en must be an array if present`);
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

/**
 * 把课程内容本地化到指定语言。中文为默认（原始字段即中文）；
 * 英文文案取 *_en 字段，缺失时回退中文。只替换文案，棋盘数据
 * （fen / move / opponent / odds / suggestions.key）保持共用。
 * @param {object} lesson 原始课程对象（含 zh + en 字段）
 * @param {"zh"|"en"} locale 目标语言
 * @returns {object} 文案已切换到目标语言的课程对象
 */
export function localizeLesson(lesson, locale = "zh") {
  if (locale !== "en") return lesson;
  const ch = lesson.challenge || {};
  const ce = lesson.challenge_en || {};
  const zhSteps = Array.isArray(ch.steps) ? ch.steps : [];
  const enSteps = Array.isArray(ce.steps) ? ce.steps : [];
  const steps = zhSteps.map((step, i) => {
    const enStep = enSteps[i] || {};
    const zhAlt = step.alternatives;
    const enAlt = enStep.alternatives;
    return {
      ...step,
      ...enStep,
      alternatives: zhAlt ? zhAlt.map((alt, ai) => ({ ...alt, ...(enAlt?.[ai] || {}) })) : undefined,
    };
  });
  return {
    ...lesson,
    title: lesson.title_en || lesson.title,
    summary: lesson.summary_en || lesson.summary,
    topic: lesson.topic_en || lesson.topic,
    edition: lesson.edition_en || lesson.edition,
    dateLabel: lesson.dateLabel_en || lesson.dateLabel,
    category: lesson.category_en || lesson.category,
    tags: lesson.tags_en || lesson.tags,
    introduction: lesson.introduction_en || lesson.introduction,
    culture: {
      title: lesson.culture_en?.title || lesson.culture?.title || "",
      content: lesson.culture_en?.content || lesson.culture?.content || "",
    },
    review: {
      title: lesson.review_en?.title || lesson.review?.title || "",
      steps: lesson.review_en?.steps || lesson.review?.steps || [],
      principle: lesson.review_en?.principle || lesson.review?.principle || "",
    },
    challenge: {
      ...ch,
      ...ce,
      fen: ch.fen,
      odds: ch.odds,
      steps,
      errors: ce.errors || ch.errors,
      quick: ce.quick || ch.quick,
      suggestions: ce.suggestions || ch.suggestions,
    },
  };
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
 * 把 (month, day) 折算成该年的"月日序数"（1 月 1 日 = 1，12 月 31 日 = 365/366）。
 * 用传入 year 计算，从而正确区分平年/闰年的 2 月 29 日。
 * 纯函数：仅依赖入参，不读系统时钟。
 */
export function monthDayOrdinal(month, day, year) {
  // 当年 1 月 1 日 00:00（本地）与目标日 00:00 的天数差 +1 即序数。
  // 使用本地午夜构造、取整日期差，时区不影响 day-to-day 差值结果。
  const startOfYear = new Date(year, 0, 1);
  const target = new Date(year, month - 1, day);
  return Math.round((target - startOfYear) / 86_400_000) + 1;
}

/**
 * 在 +08:00（Asia/Shanghai）时区下读取一个 Date 的 (year, month, day)。
 * publishedAt 全部使用 +08:00，主页"今天"也必须在该时区判定，
 * 否则不同宿主机时区会在午夜前后选到不同的期数。
 */
function shanghaiParts(date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(date);
  const get = type => Number(parts.find(p => p.type === type).value);
  return { year: get("year"), month: get("month"), day: get("day") };
}

/**
 * 从 lesson.publishedAt（ISO 8601，+08:00）解析出月/日。
 * 直接用 ISO 串里的 MM-DD，避免 Date 解析与时区二次干扰。
 */
function monthDayFromPublishedAt(lesson) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(lesson.publishedAt || "");
  if (!m) return null;
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
}

/**
 * 选择主页展示的"今日"课程。规则（仅看月日，不看年份）：
 *   1. 把每期月日和"今天"月日都折算成当年序数；
 *   2. 候选 = 序数 ≤ 今天序数的所有期；
 *   3. 候选非空：取 (序数 desc, publishedAt desc) 第一篇
 *      —— 今天命中则直接取该期，多期同年月日则取年份最新；
 *   4. 候选为空（所有期月日晚于今天，跨年场景）：取 publishedAt desc 第一篇
 *      —— 即月日最晚的一期，作为"跨年衔接"；
 *   5. 无法解析 publishedAt 的期被忽略；全部都无法解析 → 返回 undefined。
 *
 * 纯函数：now 由调用方注入（默认读系统时钟），便于测试与确定性构建。
 */
export function pickHomepageLesson(lessons, now = new Date()) {
  if (!Array.isArray(lessons) || lessons.length === 0) return undefined;
  const today = shanghaiParts(now);
  const todayOrdinal = monthDayOrdinal(today.month, today.day, today.year);

  const scored = lessons
    .map(lesson => {
      const md = monthDayFromPublishedAt(lesson);
      if (!md) return null;
      return {
        lesson,
        ordinal: monthDayOrdinal(md.month, md.day, md.year),
        publishedAt: lesson.publishedAt || "",
      };
    })
    .filter(Boolean);

  if (scored.length === 0) return undefined;

  const candidates = scored.filter(item => item.ordinal <= todayOrdinal);
  const pool = candidates.length > 0 ? candidates : scored;

  pool.sort((a, b) => {
    if (b.ordinal !== a.ordinal) return b.ordinal - a.ordinal;
    return b.publishedAt.localeCompare(a.publishedAt);
  });
  return pool[0].lesson;
}

/**
 * Compute a stable content hash for a lesson's public payload.
 */
export async function contentHash(lesson) {
  const { createHash } = await import("node:crypto");
  const payload = JSON.stringify(publicLesson(lesson));
  return createHash("sha256").update(payload).digest("hex").slice(0, 16);
}
