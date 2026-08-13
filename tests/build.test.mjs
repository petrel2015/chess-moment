import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { readFileSync } from "node:fs";
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

// Interactive lesson pages must preload all 12 piece PNGs in <head> so the
// first board render is not blocked on lazy <img> fetches.
test("interactive pages preload all 12 piece PNGs in head", async () => {
  const lessons = await loadLessons(root);
  const pieceKeys = ["wk", "wq", "wr", "wb", "wn", "wp", "bk", "bq", "br", "bb", "bn", "bp"];
  for (const lesson of lessons) {
    const html = await readFile(path.join(root, "_site", `${lesson.slug}.html`), "utf8");
    for (const key of pieceKeys) {
      assert.ok(
        html.includes(`rel="preload" as="image" href="assets/pieces/${key}.png"`),
        `${lesson.slug}.html missing preload for ${key}.png`
      );
    }
  }
});

// 每个交互页必须有"反馈问题"按钮（棋盘旁 + 页脚），供用户报告题目/交互问题。
test("interactive pages include feedback buttons in coach-actions and footer", async () => {
  const lessons = await loadLessons(root);
  for (const lesson of lessons) {
    const html = await readFile(path.join(root, "_site", `${lesson.slug}.html`), "utf8");
    // 棋盘旁按钮（在 .coach-actions 内，带 data-report）
    assert.ok(
      html.includes('type="button" data-report>反馈问题</button>'),
      `${lesson.slug}.html missing coach-actions feedback button`
    );
    // 页脚链接（带 data-footer-report）
    assert.ok(
      html.includes('data-footer-report>反馈问题</a>'),
      `${lesson.slug}.html missing footer feedback link`
    );
  }
});

// 每个交互页页脚都有「请我喝杯咖啡」赞赏区，含支付宝/微信两个触发按钮。
test("interactive pages include donate section with alipay and wechat triggers", async () => {
  const lessons = await loadLessons(root);
  for (const lesson of lessons) {
    const html = await readFile(path.join(root, "_site", `${lesson.slug}.html`), "utf8");
    assert.ok(html.includes("请我喝杯咖啡 ￥4.9"), `${lesson.slug}.html missing donate copy`);
    assert.ok(html.includes("支付宝"), `${lesson.slug}.html missing alipay trigger`);
    assert.ok(html.includes("微信"), `${lesson.slug}.html missing wechat trigger`);
    assert.ok(
      html.includes('data-donate-alipay>支付宝</button>'),
      `${lesson.slug}.html missing data-donate-alipay button`
    );
    assert.ok(
      html.includes('data-donate-wechat>微信</button>'),
      `${lesson.slug}.html missing data-donate-wechat button`
    );
  }
});

// 赞赏二维码必须是真实 PNG，并被构建复制到 _site/assets/donate/。
test("donate QR PNGs exist and are real images", async () => {
  const { stat } = await import("node:fs/promises");
  for (const name of ["alipay-qr.png", "wechat-qr.png"]) {
    const source = await stat(path.join(root, "assets", "donate", name));
    assert.ok(source.size > 2000, `${name} should be a real PNG (source)`);
    const built = await stat(path.join(root, "_site", "assets", "donate", name));
    assert.ok(built.size > 2000, `${name} should be copied into _site/assets/donate`);
  }
});

// app.js 必须包含赞赏装配：预加载二维码、alipays scheme 唤起、ESC 关闭模态框。
test("app.js wires the donate modal with preload, alipay scheme, and ESC close", () => {
  const src = readFileSync(path.join(root, "assets", "app.js"), "utf8");
  assert.ok(/new Image\(\)/.test(src), "missing QR preload via new Image()");
  assert.ok(/alipays:\/\//.test(src), "missing alipays:// scheme");
  assert.ok(/data-donate-alipay/.test(src), "missing [data-donate-alipay] binding");
  assert.ok(/data-donate-wechat/.test(src), "missing [data-donate-wechat] binding");
  assert.ok(/key === "Escape"/.test(src), "missing ESC-to-close handler");
});

test("shared interaction JavaScript parses", () => {
  const result = spawnSync(process.execPath, ["--check", "assets/app.js"], {
    cwd: root,
    encoding: "utf8"
  });
  assert.equal(result.status, 0, result.stderr);
});

// 架构断言：对手回应窗口必须有健壮性保护，防止用户卡在无反馈的空窗。
// 这些守卫是针对"走完一步后对手 auto-reply 没正常执行"类 bug 的回归保护。
test("app.js guards the opponent-reply window against getting stuck", async () => {
  const src = await readFile(path.join(root, "assets", "app.js"), "utf8");
  // 1) awaitingOpponent 标志：对手回应窗口内禁止用户操作
  assert.ok(/let awaitingOpponent/.test(src), "missing awaitingOpponent flag");
  assert.ok(/if \(awaitingOpponent\) return/.test(src), "choose() must early-return while awaiting opponent");
  // 2) 对手回应用 try/catch 包裹，失败时显示提示而非静默吞错
  assert.ok(/opponent reply failed/.test(src), "opponent reply errors must be logged");
  assert.ok(/statusOpponentError/.test(src), "opponent reply failure must surface a user-visible status");
  // 3) reset() 清理挂起的定时器，避免悬挂的对手回应污染重置后的状态
  assert.ok(/clearTimeout\(opponentTimer\)/.test(src), "reset() must clear pending opponent timer");
  // 4) 对手回应前用 legalTargets 校验合法性（防御 state 偏离）
  assert.ok(
    /legalTargets\(state, opponentFrom\)\.includes\(opponentTo\)/.test(src),
    "opponent reply must be validated against legalTargets before applying"
  );
});

// AI 教练配置注入：每个交互页 <head> 必须含 window.CHESS_COACH_CONFIG。
// 未设置环境变量时 workerUrl 为空（前端走预制答案降级）；设置后自动注入。
test("interactive pages inject CHESS_COACH_CONFIG in head", async () => {
  const lessons = await loadLessons(root);
  for (const lesson of lessons) {
    const html = await readFile(path.join(root, "_site", `${lesson.slug}.html`), "utf8");
    assert.ok(
      /window\.CHESS_COACH_CONFIG\s*=\s*\{/.test(html),
      `${lesson.slug}.html missing window.CHESS_COACH_CONFIG`
    );
  }
});

test("CHESS_COACH_WORKER_URL env var injects workerUrl into built HTML", () => {
  // 单独跑一次 build，注入环境变量，验证 URL 出现在产物里。
  const result = spawnSync(process.execPath, ["scripts/build-site.mjs"], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, CHESS_COACH_WORKER_URL: "https://test-coach.example.workers.dev" },
  });
  assert.equal(result.status, 0, result.stderr);
  const idx = readFileSync(path.join(root, "_site", "index.html"), "utf8");
  assert.ok(
    idx.includes('"workerUrl":"https://test-coach.example.workers.dev"'),
    "workerUrl env var must appear in built HTML"
  );
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

// 主页"今日"选择端到端：注入 CHESS_HOME_DATE 让构建可复现，
// 断言 _site/index.html 的 data-puzzle 等于当天应取的 slug。
// 今天 2026-08-11，内容库覆盖 7/24–7/29，全部月日 ≤ 今天 → 取月日最晚的 7/29。
test("homepage reflects injected CHESS_HOME_DATE (today's lesson by month-day)", () => {
  const result = spawnSync(process.execPath, ["scripts/build-site.mjs"], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, CHESS_HOME_DATE: "2026-08-11T00:00:00+08:00" },
  });
  assert.equal(result.status, 0, result.stderr);

  return readFile(path.join(root, "_site", "index.html"), "utf8").then(index => {
    assert.ok(
      index.includes('data-puzzle="promotion-combo"'),
      "Homepage should render promotion-combo (7/29, latest month-day <= 8/11)"
    );
  });
});

// 主页在"今天月日早于所有内容"时跨年回退到月日最晚的一期。
// 今天 1/5，内容全是 7 月 → 回退到 7/29 = promotion-combo。
test("homepage falls back to latest month-day when CHESS_HOME_DATE precedes all issues", () => {
  const result = spawnSync(process.execPath, ["scripts/build-site.mjs"], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, CHESS_HOME_DATE: "2027-01-05T00:00:00+08:00" },
  });
  assert.equal(result.status, 0, result.stderr);

  return readFile(path.join(root, "_site", "index.html"), "utf8").then(index => {
    assert.ok(
      index.includes('data-puzzle="promotion-combo"'),
      "Homepage should fall back to promotion-combo (7/29) when today precedes all issues"
    );
  });
});

// 主页在"今天月日恰好命中某一期"时取该期。
// 真实内容库含 7/26 = italian-center-plan，今天 7/26 → 候选含 7/24/25/26，取月日最晚的 7/26。
test("homepage picks nearest past month-day when today falls between issues", () => {
  const result = spawnSync(process.execPath, ["scripts/build-site.mjs"], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, CHESS_HOME_DATE: "2026-07-26T00:00:00+08:00" },
  });
  assert.equal(result.status, 0, result.stderr);

  return readFile(path.join(root, "_site", "index.html"), "utf8").then(index => {
    assert.ok(
      index.includes('data-puzzle="italian-center-plan"'),
      "Homepage should render italian-center-plan (7/26, latest month-day <= 7/26 in real content)"
    );
  });
});

// ---- 多语言（中英）：构建必须产出英文版 en/ 子目录 -----------------------

test("build generates English pages in _site/en for all lessons plus index", async () => {
  const lessons = await loadLessons(root);
  const enDir = path.join(root, "_site", "en");
  const enFiles = (await readdir(enDir)).filter(f => f.endsWith(".html")).sort();
  assert.equal(enFiles.length, lessons.length + 1, "en/ should have index + one page per lesson");
  assert(enFiles.includes("index.html"), "en/index.html must exist");
  for (const lesson of lessons) {
    assert(enFiles.includes(`${lesson.slug}.html`), `Missing en page for ${lesson.slug}`);
  }
});

test("English pages use lang=en, ../asset paths, and localized lesson copy", async () => {
  const lessons = await loadLessons(root);
  for (const lesson of lessons) {
    const html = await readFile(path.join(root, "_site", "en", `${lesson.slug}.html`), "utf8");
    assert.ok(/<html lang="en">/.test(html), `${lesson.slug}.en must be lang=en`);
    assert.ok(html.includes('src="../assets/app.js"'), `${lesson.slug}.en must reference ../assets/app.js`);
    assert.ok(html.includes('href="../assets/styles.css"'), `${lesson.slug}.en must reference ../assets/styles.css`);
    // 嵌入的课程挑战数据必须是英文
    assert.ok(
      html.includes(`"title":${JSON.stringify(lesson.challenge_en.title)}`),
      `${lesson.slug}.en must embed the English challenge title`
    );
    assert.ok(html.includes(`<h1>${lesson.title_en}</h1>`), `${lesson.slug}.en must render the English h1`);
    // 英文 UI 文案
    assert.ok(html.includes("Ask Coach"), `${lesson.slug}.en missing 'Ask Coach' button`);
    assert.ok(html.includes("Restart"), `${lesson.slug}.en missing 'Restart' button`);
  }
});

test("English pages include language auto-detect script and a toggle link", async () => {
  const html = await readFile(path.join(root, "_site", "en", "promotion-combo.html"), "utf8");
  assert.ok(html.includes('localStorage.getItem("chessMomentLang")'), "en page missing detect script");
  assert.ok(html.includes('class="lang-toggle"'), "en page missing language toggle");
  assert.ok(html.includes('data-lang="zh"'), "en toggle must point back to zh");
  // 中文页也要有检测脚本与英文切换
  const zhHtml = await readFile(path.join(root, "_site", "promotion-combo.html"), "utf8");
  assert.ok(zhHtml.includes('localStorage.getItem("chessMomentLang")'), "zh page missing detect script");
  assert.ok(zhHtml.includes('class="lang-toggle" href="en/promotion-combo.html"'), "zh toggle must point to en page");
});
