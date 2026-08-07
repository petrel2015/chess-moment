import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { loadLessons } from "../scripts/content-lib.mjs";

const root = process.cwd();

test("build generates index plus one page per lesson with working links", async () => {
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

test("build generates wechat preview pages for all lessons", async () => {
  const wechatDir = path.join(root, "_site", "wechat");
  const wechatFiles = (await readdir(wechatDir)).filter(f => f.endsWith(".html")).sort();
  const lessons = await loadLessons(root);

  // Index + one per lesson
  assert.equal(wechatFiles.length, lessons.length + 1);
  assert(wechatFiles.includes("index.html"));

  for (const lesson of lessons) {
    assert(wechatFiles.includes(`${lesson.slug}.html`), `Missing wechat page for ${lesson.slug}`);
  }
});

test("build generates board PNGs for all lessons", async () => {
  const boardsDir = path.join(root, "_site", "wechat", "assets", "boards");
  const lessons = await loadLessons(root);

  for (const lesson of lessons) {
    const pngPath = path.join(boardsDir, `${lesson.slug}.png`);
    const png = await readFile(pngPath);
    // Check PNG signature
    assert.equal(png[0], 0x89);
    assert.equal(png[1], 0x50);
    assert.equal(png[2], 0x4e);
    assert.equal(png[3], 0x47);
    assert.ok(png.length > 1000, `PNG for ${lesson.slug} too small: ${png.length} bytes`);
  }
});

test("build generates structured payloads for all lessons", async () => {
  const artifactsDir = path.join(root, "_artifacts", "wechat");
  const lessons = await loadLessons(root);

  for (const lesson of lessons) {
    const payloadPath = path.join(artifactsDir, `${lesson.slug}.payload.json`);
    const raw = await readFile(payloadPath, "utf8");
    const payload = JSON.parse(raw);

    // Required fields
    assert.ok(payload.idempotency_key, `Missing idempotency_key for ${lesson.slug}`);
    assert.ok(payload.content_hash, `Missing content_hash for ${lesson.slug}`);
    assert.ok(payload.article, `Missing article for ${lesson.slug}`);
    assert.ok(payload.assets, `Missing assets for ${lesson.slug}`);
    assert.ok(payload.interactive_url, `Missing interactive_url for ${lesson.slug}`);

    // content_source_url must be same-slug interactive URL
    assert.equal(
      payload.article.content_source_url,
      `https://petrel2015.github.io/chess-moment/${lesson.slug}.html`,
      `Wrong content_source_url for ${lesson.slug}`
    );

    // Must not contain local absolute paths
    const serialized = JSON.stringify(payload);
    assert.ok(!serialized.includes("/Users/"), `Payload for ${lesson.slug} contains local absolute path`);
    assert.ok(!serialized.includes("AppSecret"), `Payload for ${lesson.slug} contains AppSecret`);
    assert.ok(!serialized.includes("access_token"), `Payload for ${lesson.slug} contains access_token`);
  }
});

test("wechat HTML contains no script, iframe, form, button, or event handlers", async () => {
  const lessons = await loadLessons(root);
  for (const lesson of lessons) {
    const html = await readFile(path.join(root, "_site", "wechat", `${lesson.slug}.html`), "utf8");

    // Forbidden elements/attributes
    assert.ok(!/<script[\s>]/i.test(html), `${lesson.slug}: wechat HTML contains <script>`);
    assert.ok(!/<iframe[\s>]/i.test(html), `${lesson.slug}: wechat HTML contains <iframe>`);
    assert.ok(!/<form[\s>]/i.test(html), `${lesson.slug}: wechat HTML contains <form>`);
    assert.ok(!/<button[\s>]/i.test(html), `${lesson.slug}: wechat HTML contains <button>`);
    assert.ok(!/<textarea[\s>]/i.test(html), `${lesson.slug}: wechat HTML contains <textarea>`);
    assert.ok(!/<input[\s>]/i.test(html), `${lesson.slug}: wechat HTML contains <input>`);
    assert.ok(!/\son\w+\s*=/i.test(html), `${lesson.slug}: wechat HTML contains on* event handler`);
  }
});

test("wechat HTML includes all required content sections", async () => {
  const lessons = await loadLessons(root);
  const lesson = lessons[0];
  const html = await readFile(path.join(root, "_site", "wechat", `${lesson.slug}.html`), "utf8");

  // Must include: introduction, culture, board, question, answer, step-by-step, mistakes, review, principle
  // Check for key section headings
  assert.ok(html.includes("故事引入"), "Missing introduction section");
  assert.ok(html.includes(lesson.culture.title), "Missing culture content");
  assert.ok(html.includes("assets/boards/"), "Missing board image");
  assert.ok(html.includes("今日局面"), "Missing challenge section");
  assert.ok(html.includes("答案与逐步讲解"), "Missing answer section");
  assert.ok(html.includes("复盘"), "Missing review section");
  assert.ok(html.includes("带走一句"), "Missing principle");
  assert.ok(html.includes("阅读原文") || html.includes("进入互动版"), "Missing call-to-action for interactive page");
});

test("wechat HTML answer is self-contained (not hidden behind link)", async () => {
  const lessons = await loadLessons(root);
  const lesson = lessons[0];
  const html = await readFile(path.join(root, "_site", "wechat", `${lesson.slug}.html`), "utf8");

  // The success message must appear in the body
  assert.ok(html.includes(lesson.challenge.success), "Success/answer text must be in wechat body");

  // Each step note must appear
  for (const step of lesson.challenge.steps) {
    assert.ok(html.includes(step.note), `Step note must be in wechat body: ${step.note.slice(0, 20)}...`);
  }

  // The principle must appear
  assert.ok(html.includes(lesson.review.principle), "Principle must be in wechat body");
});

test("wechat index lists all lessons", async () => {
  const indexHtml = await readFile(path.join(root, "_site", "wechat", "index.html"), "utf8");
  const lessons = await loadLessons(root);

  for (const lesson of lessons) {
    assert.ok(indexHtml.includes(`${lesson.slug}.html`), `Wechat index missing link to ${lesson.slug}`);
    assert.ok(indexHtml.includes(lesson.title), `Wechat index missing title for ${lesson.slug}`);
  }
});

test("wechat preview uses relative board path, payload uses absolute interactive URL", async () => {
  const lessons = await loadLessons(root);
  const lesson = lessons[0];

  const previewHtml = await readFile(path.join(root, "_site", "wechat", `${lesson.slug}.html`), "utf8");
  assert.ok(previewHtml.includes(`src="assets/boards/${lesson.slug}.png"`), "Preview should use relative board path");

  const payloadRaw = await readFile(path.join(root, "_artifacts", "wechat", `${lesson.slug}.payload.json`), "utf8");
  const payload = JSON.parse(payloadRaw);
  assert.ok(payload.article.content_source_url.startsWith("https://"), "Payload content_source_url must be absolute");
});

test("P0-5: publish-root syncs wechat directory and board PNGs to repo root", async () => {
  const { spawnSync } = await import("node:child_process");
  const result = spawnSync(process.execPath, ["scripts/publish-root.mjs"], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);

  const lessons = await loadLessons(root);

  // wechat/ directory must exist at repo root
  const rootWechatDir = path.join(root, "wechat");
  const wechatFiles = (await readdir(rootWechatDir)).filter(f => f.endsWith(".html")).sort();
  assert.ok(wechatFiles.includes("index.html"), "Root wechat/ should have index.html");

  for (const lesson of lessons) {
    assert.ok(wechatFiles.includes(`${lesson.slug}.html`), `Root wechat/ should have ${lesson.slug}.html`);
  }

  // Board PNGs must exist at root wechat/assets/boards/
  const rootBoardsDir = path.join(root, "wechat", "assets", "boards");
  for (const lesson of lessons) {
    const pngPath = path.join(rootBoardsDir, `${lesson.slug}.png`);
    const png = await readFile(pngPath);
    assert.equal(png[0], 0x89, `Board PNG for ${lesson.slug} should be valid PNG`);
    assert.equal(png[1], 0x50);
  }
});

test("P1-7: wechat preview shows challenge.title and instruction as question before answer", async () => {
  const lessons = await loadLessons(root);
  const lesson = lessons[0];
  const html = await readFile(path.join(root, "_site", "wechat", `${lesson.slug}.html`), "utf8");

  // Must have a "今日问题" section
  assert.ok(html.includes("今日问题"), "Missing 今日问题 (question) section");

  // challenge.title must appear before the answer section
  const questionIdx = html.indexOf("今日问题");
  const answerIdx = html.indexOf("答案与逐步讲解");
  assert.ok(questionIdx > -1, "Should have question section");
  assert.ok(answerIdx > -1, "Should have answer section");
  assert.ok(questionIdx < answerIdx, "Question must come before answer");

  // challenge.title and instruction must be present
  assert.ok(html.includes(lesson.challenge.title), "challenge.title must be in the question section");
  assert.ok(html.includes(lesson.challenge.instruction), "instruction must be in the question section");

  // Must have clickable interactive link
  assert.ok(html.includes("进入互动版"), "Should have clickable interactive link");
  assert.ok(html.includes(`href="https://petrel2015.github.io/chess-moment/${lesson.slug}.html"`), "Interactive link must point to same-slug URL");
});
