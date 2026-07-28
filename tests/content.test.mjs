import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { loadLessons, validateLessons } from "../scripts/content-lib.mjs";

const root = process.cwd();

test("discovers exactly five valid multi-step lessons", async () => {
  const lessons = await loadLessons(root);
  assert.equal(lessons.length, 5);
  assert.deepEqual(validateLessons(lessons), []);
  lessons.forEach(lesson => assert.equal(lesson.challenge.steps.length, 5));
});

test("build generates index plus five lesson pages and working links", async () => {
  const result = spawnSync(process.execPath, ["scripts/build-site.mjs"], {
    cwd: root,
    encoding: "utf8"
  });
  assert.equal(result.status, 0, result.stderr);
  const htmlFiles = (await readdir(path.join(root, "_site"))).filter(file => file.endsWith(".html")).sort();
  assert.equal(htmlFiles.length, 6);
  assert(htmlFiles.includes("index.html"));

  const index = await readFile(path.join(root, "_site", "index.html"), "utf8");
  const lessons = await loadLessons(root);
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
