import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { Chess } from "chess.js";
import { loadLessons, validateLessons, PUBLIC_BASE_URL, interactiveUrl, idempotencyKey, contentHash } from "../scripts/content-lib.mjs";

const root = process.cwd();

test("discovers exactly five valid multi-step lessons", async () => {
  const lessons = await loadLessons(root);
  assert.equal(lessons.length, 5);
  assert.deepEqual(validateLessons(lessons), []);
  lessons.forEach(lesson => assert.equal(lesson.challenge.steps.length, 5));
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
      // User move must be legal
      const userMove = game.move({ from: step.move.slice(0, 2), to: step.move.slice(2, 4) });
      assert.ok(userMove, `${lesson.slug} step ${i + 1}: user move ${step.move} should be legal`);
      // Opponent reply (if present) must be legal
      if (step.opponent) {
        const oppMove = game.move({ from: step.opponent.slice(0, 2), to: step.opponent.slice(2, 4) });
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
