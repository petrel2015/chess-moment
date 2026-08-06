import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { loadLessons, validateLessons } from "../scripts/content-lib.mjs";

const root = process.cwd();

test("discovers at least five valid multi-step lessons", async () => {
  const lessons = await loadLessons(root);
  assert.ok(lessons.length >= 5, `expected >= 5 lessons, got ${lessons.length}`);
  assert.deepEqual(validateLessons(lessons), []);
  lessons.forEach(lesson => assert.ok(lesson.challenge.steps.length >= 3));
});

test("build generates one index plus one page per lesson with working links", async () => {
  const result = spawnSync(process.execPath, ["scripts/build-site.mjs"], {
    cwd: root,
    encoding: "utf8"
  });
  assert.equal(result.status, 0, result.stderr);
  const lessons = await loadLessons(root);
  const htmlFiles = (await readdir(path.join(root, "_site"))).filter(file => file.endsWith(".html")).sort();
  assert.equal(htmlFiles.length, lessons.length + 1);
  assert(htmlFiles.includes("index.html"));

  const index = await readFile(path.join(root, "_site", "index.html"), "utf8");
  for (const lesson of lessons) {
    assert(index.includes(`${lesson.slug}.html`) || index.includes(`data-puzzle="${lesson.slug}"`));
    const page = await readFile(path.join(root, "_site", `${lesson.slug}.html`), "utf8");
    assert(page.includes(`data-puzzle="${lesson.slug}"`));
    assert(page.includes("window.CHESS_LESSON="));
    assert(page.includes("assets/app.js"));
  }
});

test("shared interaction JavaScript parses", () => {
  const result = spawnSync(process.execPath, ["--check", "assets/app.js"], {
    cwd: root,
    encoding: "utf8"
  });
  assert.equal(result.status, 0, result.stderr);
});

test("shared chess engine module parses", () => {
  const result = spawnSync(process.execPath, ["--check", "assets/chess-engine.mjs"], {
    cwd: root,
    encoding: "utf8"
  });
  assert.equal(result.status, 0, result.stderr);
});

// 构造一个最小合法 lesson，供新字段校验测试复用。__file 仅用于错误定位显示。
function validLesson(overrides = {}) {
  return {
    __file: "fake.json",
    slug: "fake",
    publishedAt: "2026-01-01T09:00:00+08:00",
    edition: "早报",
    category: "测试",
    title: "测试课",
    summary: "摘要",
    difficulty: 2,
    duration: 5,
    introduction: ["段一", "段二"],
    culture: { title: "文化", content: "内容" },
    challenge: {
      fen: "4k3/8/8/8/8/8/4P3/4K3 w - - 0 1",
      goal: "目标",
      steps: [
        { move: "e2e4", opponent: "e8e7", note: "n1" },
        { move: "e4e5", opponent: "e7e6", note: "n2" },
        { move: "e5e6", note: "n3" },
      ],
      odds: [
        { white: 50, draw: 30, black: 20 },
        { white: 55, draw: 28, black: 17 },
        { white: 60, draw: 25, black: 15 },
        { white: 65, draw: 22, black: 13 },
      ],
      success: "成功",
      defaultAnswer: "默认答案",
      genericError: "通用错误",
      quick: { 为何: "答" },
      suggestions: [
        { label: "为何？", key: "为何" },
        { label: "再问", key: "为何" },
      ],
    },
    review: { title: "复盘", steps: ["s1"], principle: "原则" },
    ...overrides,
  };
}

test("validateLessons accepts 5-char promotion moves and alternatives/tags/prereq", () => {
  const pair = [
    validLesson(),
    {
      ...validLesson({ slug: "other", tags: ["开局"], prerequisites: ["fake"] }),
      challenge: {
        ...validLesson().challenge,
        steps: [
          { move: "e2e4", note: "n1", alternatives: [{ move: "d2d4", note: "也可" }] },
          { move: "e7e8q", note: "升变后" },
          { move: "e7e8r", note: "升变车" },
        ],
        odds: [
          { white: 50, draw: 30, black: 20 },
          { white: 55, draw: 28, black: 17 },
          { white: 60, draw: 25, black: 15 },
          { white: 65, draw: 22, black: 13 },
        ],
      },
    },
  ];
  assert.deepEqual(validateLessons(pair), []);
});

test("validateLessons rejects duplicate alternative move and missing note", () => {
  const bad = [validLesson({
    challenge: {
      ...validLesson().challenge,
      steps: [
        { move: "e2e4", note: "n1", alternatives: [{ move: "e2e4", note: "重复" }] },
        { move: "e4e5", note: "n2" },
        { move: "e5e6", note: "n3", alternatives: [{ move: "d2d4" }] },
      ],
    },
  })];
  const errors = validateLessons(bad);
  assert.ok(errors.some(e => e.includes("duplicate alternative")), errors.join("; "));
  assert.ok(errors.some(e => e.includes("alternative needs note")), errors.join("; "));
});

test("validateLessons rejects invalid tags and dangling prerequisites", () => {
  const badTags = validateLessons([validLesson({ tags: ["", "  "] })]);
  assert.ok(badTags.some(e => e.includes("tags must be")), badTags.join("; "));

  const dangling = validateLessons([validLesson({ prerequisites: ["no-such-slug"] })]);
  assert.ok(dangling.some(e => e.includes("prerequisite no-such-slug not found")), dangling.join("; "));

  const badSlug = validateLessons([validLesson({ prerequisites: ["Bad Slug"] })]);
  assert.ok(badSlug.some(e => e.includes("prerequisites must be")), badSlug.join("; "));
});
