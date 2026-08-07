import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { Chess } from "chess.js";
import { loadLessons, validateLessons, PUBLIC_BASE_URL, interactiveUrl, idempotencyKey, contentHash } from "../scripts/content-lib.mjs";

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

test("chess.js validates every FEN is parseable", async () => {
  const lessons = await loadLessons(root);
  for (const lesson of lessons) {
    const game = new Chess(lesson.challenge.fen);
    assert.ok(game, `FEN should parse for ${lesson.slug}: ${lesson.challenge.fen}`);
  }
});

test("chess.js validates full move sequences are legal", async () => {
  const lessons = await loadLessons(root);
  for (const lesson of lessons) {
    const game = new Chess(lesson.challenge.fen);
    for (let i = 0; i < lesson.challenge.steps.length; i++) {
      const step = lesson.challenge.steps[i];
      // User move must be legal (carry 5th UCI char as promotion when present)
      const userArgs = { from: step.move.slice(0, 2), to: step.move.slice(2, 4) };
      if (step.move[4]) userArgs.promotion = step.move[4];
      const userMove = game.move(userArgs);
      assert.ok(userMove, `${lesson.slug} step ${i + 1}: user move ${step.move} should be legal`);
      // Opponent reply (if present) must be legal
      if (step.opponent) {
        const oppArgs = { from: step.opponent.slice(0, 2), to: step.opponent.slice(2, 4) };
        if (step.opponent[4]) oppArgs.promotion = step.opponent[4];
        const oppMove = game.move(oppArgs);
        assert.ok(oppMove, `${lesson.slug} step ${i + 1}: opponent reply ${step.opponent} should be legal`);
      }
    }
  }
});

test("validator catches illegal move sequence", () => {
  const badLesson = {
    __file: "test.json",
    slug: "test-bad",
    publishedAt: "2026-01-01T09:00:00+08:00",
    edition: "早报",
    category: "测试",
    title: "测试错误课程",
    summary: "测试",
    difficulty: 1,
    duration: 5,
    topic: "测试",
    introduction: ["段落一", "段落二"],
    culture: { title: "文化", content: "内容" },
    challenge: {
      fen: "6k1/8/8/8/8/8/1R6/R6K w - - 0 1",
      goal: "目标",
      success: "成功",
      defaultAnswer: "答案",
      genericError: "错误",
      title: "挑战",
      instruction: "指令",
      steps: [
        // e1e4 is not a legal move from this position (rook on a1 can go a1a8, not e1e4)
        { move: "a1e4", opponent: "g8h7", note: "错误走法" },
        { move: "b2b8", opponent: "h7g6", note: "第二步" },
        { move: "a1a7", opponent: "g6f5", note: "第三步" },
      ],
      odds: [
        { white: 90, draw: 9, black: 1 },
        { white: 92, draw: 7, black: 1 },
        { white: 94, draw: 5, black: 1 },
        { white: 96, draw: 3, black: 1 },
      ],
      quick: { "q1": "a1" },
      suggestions: [{ label: "Q1", key: "q1" }, { label: "Q2", key: "q2" }],
    },
    review: { title: "复盘", steps: ["步骤"], principle: "原则" },
  };
  // Add q2 answer
  badLesson.challenge.quick.q2 = "a2";

  const errors = validateLessons([badLesson]);
  assert.ok(errors.length > 0, "Should detect errors in bad lesson");
  assert.ok(errors.some(e => e.includes("illegal")), `Should detect illegal move, got: ${errors.join("; ")}`);
});

test("validator catches duplicate slug", () => {
  const lesson1 = {
    __file: "a.json", slug: "dup", publishedAt: "2026-01-01T09:00:00+08:00",
    edition: "早报", category: "测试", title: "T1", summary: "S", difficulty: 1, duration: 5, topic: "T",
    introduction: ["p1", "p2"], culture: { title: "c", content: "c" },
    challenge: {
      fen: "6k1/8/8/8/8/8/1R6/R6K w - - 0 1", goal: "g", success: "s", defaultAnswer: "d", genericError: "e",
      title: "t", instruction: "i",
      steps: [{ move: "b2b8", opponent: "g8h7", note: "n" }, { move: "a1a7", opponent: "h7g6", note: "n" }, { move: "b8b6", note: "n" }],
      odds: [{ white: 90, draw: 9, black: 1 }, { white: 92, draw: 7, black: 1 }, { white: 94, draw: 5, black: 1 }, { white: 96, draw: 3, black: 1 }],
      quick: { "q": "a" }, suggestions: [{ label: "Q", key: "q" }, { label: "Q2", key: "q2" }],
    },
    review: { title: "r", steps: ["s"], principle: "p" },
  };
  lesson1.challenge.quick.q2 = "a2";
  const lesson2 = { ...lesson1, __file: "b.json" };
  const errors = validateLessons([lesson1, lesson2]);
  assert.ok(errors.some(e => e.includes("duplicate slug")), `Should detect duplicate slug, got: ${errors.join("; ")}`);
});

test("P1-11: validator catches duplicate publishedAt (not just slug)", () => {
  const baseLesson = {
    __file: "a.json", slug: "lesson-a", publishedAt: "2026-01-01T09:00:00+08:00",
    edition: "早报", category: "测试", title: "T1", summary: "S", difficulty: 1, duration: 5, topic: "T",
    introduction: ["p1", "p2"], culture: { title: "c", content: "c" },
    challenge: {
      fen: "6k1/8/8/8/8/8/1R6/R6K w - - 0 1", goal: "g", success: "s", defaultAnswer: "d", genericError: "e",
      title: "t", instruction: "i",
      steps: [{ move: "b2b8", opponent: "g8h7", note: "n" }, { move: "a1a7", opponent: "h7g6", note: "n" }, { move: "b8b6", note: "n" }],
      odds: [{ white: 90, draw: 9, black: 1 }, { white: 92, draw: 7, black: 1 }, { white: 94, draw: 5, black: 1 }, { white: 96, draw: 3, black: 1 }],
      quick: { "q": "a" }, suggestions: [{ label: "Q", key: "q" }, { label: "Q2", key: "q2" }],
    },
    review: { title: "r", steps: ["s"], principle: "p" },
  };
  baseLesson.challenge.quick.q2 = "a2";

  // Same publishedAt, different slug - should still be flagged
  const lesson2 = { ...baseLesson, __file: "b.json", slug: "lesson-b" };
  const errors = validateLessons([baseLesson, lesson2]);
  assert.ok(
    errors.some(e => e.includes("duplicate publishedAt")),
    `Should detect duplicate publishedAt even with different slugs, got: ${errors.join("; ")}`
  );
});

test("PUBLIC_BASE_URL defaults to GitHub Pages", () => {
  assert.equal(PUBLIC_BASE_URL, "https://petrel2015.github.io/chess-moment");
});

test("interactiveUrl generates correct absolute URL", async () => {
  const lessons = await loadLessons(root);
  for (const lesson of lessons) {
    const url = interactiveUrl(lesson);
    assert.ok(url.startsWith("https://"));
    assert.ok(url.endsWith(`${lesson.slug}.html`));
  }
});

test("idempotencyKey format is correct", async () => {
  const lessons = await loadLessons(root);
  for (const lesson of lessons) {
    const key = idempotencyKey(lesson);
    assert.ok(key.startsWith("wechat:"));
    assert.ok(key.includes(lesson.publishedAt));
    assert.ok(key.endsWith(lesson.slug));
  }
});

test("contentHash is deterministic", async () => {
  const lessons = await loadLessons(root);
  const { __file, ...pub } = lessons[0];
  const hash1 = await contentHash(pub);
  const hash2 = await contentHash(pub);
  assert.equal(hash1, hash2);
  assert.equal(hash1.length, 16);
});

test("shared chess engine module parses", () => {
  const result = spawnSync(process.execPath, ["--check", "assets/chess-engine.mjs"], {
    cwd: root,
    encoding: "utf8"
  });
  assert.equal(result.status, 0, result.stderr);
});

// 构造一个最小合法 lesson，供新字段校验测试复用。__file 仅用于错误定位显示。
// 构造一个最小合法 lesson，供新字段校验测试复用。FEN 与走法链经引擎与 chess.js 双重验证
// 为合法（取自 promotion-combo 的起始局面，白王 g6 / 兵 g7 / 黑王 h8）。
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
      fen: "7k/6P1/6K1/8/8/8/8/8 w - - 0 1",
      goal: "目标",
      steps: [
        { move: "g6f7", opponent: "h8h7", note: "n1" },
        { move: "g7g8q", opponent: "h7h6", note: "n2" },
        { move: "g8g6", note: "n3" },
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
      ...validLesson({
        slug: "other",
        publishedAt: "2026-02-02T09:00:00+08:00",
        tags: ["开局"],
        prerequisites: ["fake"],
      }),
      challenge: {
        ...validLesson().challenge,
        steps: [
          { move: "g6f7", opponent: "h8h7", note: "n1", alternatives: [{ move: "g6h6", note: "也可" }] },
          { move: "g7g8q", opponent: "h7h6", note: "升变后" },
          { move: "g8g6", note: "收网" },
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
        { move: "g6f7", opponent: "h8h7", note: "n1", alternatives: [{ move: "g6f7", note: "重复" }] },
        { move: "g7g8q", opponent: "h7h6", note: "n2" },
        { move: "g8g6", note: "n3", alternatives: [{ move: "g8g7" }] },
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
