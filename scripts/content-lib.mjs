import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const MOVE_RE = /^[a-h][1-8][a-h][1-8]$/;
const FEN_RE = /^([prnbqkPRNBQK1-8]+\/){7}[prnbqkPRNBQK1-8]+ [wb] /;

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
