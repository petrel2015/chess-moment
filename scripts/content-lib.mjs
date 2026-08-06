import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

// 走法格式：4 字符标准 UCI（如 e2e4），或 5 字符兵升变（末位 q/r/b/n，如 e7e8q）。
const MOVE_RE = /^[a-h][1-8][a-h][1-8][qrbn]?$/;
const FEN_RE = /^([prnbqkPRNBQK1-8]+\/){7}[prnbqkPRNBQK1-8]+ [wb] /;
const SLUG_RE = /^[a-z0-9-]+$/;

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

export function validateLessons(lessons) {
  const errors = [];
  const slugs = new Set();
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
    if (!Array.isArray(lesson.introduction) || lesson.introduction.length < 2) {
      errors.push(`${at}: introduction needs at least 2 paragraphs`);
    }
    if (!lesson.culture?.title || !lesson.culture?.content) errors.push(`${at}: incomplete culture`);
    if (!lesson.review?.title || !Array.isArray(lesson.review?.steps) || !lesson.review?.principle) {
      errors.push(`${at}: incomplete review`);
    }

    const challenge = lesson.challenge || {};
    if (!FEN_RE.test(challenge.fen || "")) errors.push(`${at}: invalid FEN`);
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
    .replaceAll('"', "&quot;");
}
