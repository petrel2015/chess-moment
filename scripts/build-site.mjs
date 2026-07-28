import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { escapeHtml, loadLessons, publicLesson, validateLessons } from "./content-lib.mjs";
import { renderWechatArticle, renderWechatIndex } from "./wechat-render.mjs";
import { generateBoardPng } from "./board-png.mjs";
import { buildWechatPayload, auditPayload } from "./wechat-payload.mjs";

const root = process.cwd();
const outDir = path.join(root, "_site");
const lessons = await loadLessons(root);
const errors = validateLessons(lessons);
if (errors.length) throw new Error(errors.join("\n"));

lessons.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });
await cp(path.join(root, "assets"), path.join(outDir, "assets"), { recursive: true });
await writeFile(path.join(outDir, ".nojekyll"), "");

// Create wechat output directories
const wechatDir = path.join(outDir, "wechat");
const wechatAssetsDir = path.join(wechatDir, "assets");
const wechatBoardsDir = path.join(wechatAssetsDir, "boards");
const artifactsDir = path.join(root, "_artifacts", "wechat");
await mkdir(wechatDir, { recursive: true });
await mkdir(wechatBoardsDir, { recursive: true });
await mkdir(artifactsDir, { recursive: true });

function archiveCards(currentSlug) {
  return lessons
    .filter(lesson => lesson.slug !== currentSlug)
    .map(lesson => `
      <a class="archive-card" href="${lesson.slug}.html">
        <time>${escapeHtml(lesson.dateLabel)} · ${escapeHtml(lesson.edition)}</time>
        <h3>${escapeHtml(lesson.title)}</h3>
        <p>${escapeHtml(lesson.summary)}</p>
        <span class="tag">${escapeHtml(lesson.category)} · ${lesson.challenge.steps.length}次选择 -></span>
      </a>`).join("");
}

function renderLesson(lesson, { homepage = false } = {}) {
  const lessonPayload = {
    id: lesson.slug,
    challenge: lesson.challenge
  };
  const paragraphs = lesson.introduction.map(text => `<p>${escapeHtml(text)}</p>`).join("");
  const reviewSteps = lesson.review.steps.map(step => `<li>${escapeHtml(step)}</li>`).join("");
  const progress = lesson.challenge.steps.map(() => "<span></span>").join("");
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="${escapeHtml(lesson.summary)}">
  <meta name="theme-color" content="#183c34">
  <meta name="application-name" content="棋刻">
  <meta name="apple-mobile-web-app-title" content="棋刻">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="default">
  <title>${homepage ? "棋刻｜每日国际象棋挑战" : `${escapeHtml(lesson.title)}｜棋刻`}</title>
  <link rel="icon" type="image/svg+xml" href="assets/icons/chess-moment.svg">
  <link rel="apple-touch-icon" sizes="180x180" href="assets/icons/apple-touch-icon.png">
  <link rel="manifest" href="assets/site.webmanifest">
  <link rel="stylesheet" href="assets/styles.css">
</head>
<body>
  <header class="site-header"><div class="header-inner"><a class="brand" href="index.html">棋刻 <span>Chess Moment</span></a><span class="issue-mark">每期完整挑战 · 立即讲解</span></div></header>
  <main class="page">
    <article>
      <header class="article-header">
        <p class="eyebrow">${escapeHtml(lesson.dateLabel)} · ${escapeHtml(lesson.edition)}${escapeHtml(lesson.category)}</p>
        <h1>${escapeHtml(lesson.title)}</h1>
        <p class="dek">${escapeHtml(lesson.summary)}</p>
        <div class="meta">难度 ${lesson.difficulty}/5　·　预计 ${lesson.duration} 分钟　·　${lesson.challenge.steps.length} 次关键选择　·　主题：${escapeHtml(lesson.topic)}</div>
      </header>
      <section class="story">
        ${paragraphs}
        <aside class="culture-note"><strong>${escapeHtml(lesson.culture.title)}</strong>${escapeHtml(lesson.culture.content)}</aside>
      </section>
      <section class="challenge" data-puzzle="${lesson.slug}">
        <div class="challenge-head"><p class="challenge-kicker">今日挑战</p><h2>${escapeHtml(lesson.challenge.title)}</h2><p>${escapeHtml(lesson.challenge.instruction)}</p></div>
        <div class="challenge-body">
          <div class="board-wrap"><div class="board" role="grid" aria-label="国际象棋互动棋盘"></div></div>
          <div class="coach">
            <div class="progress" aria-label="进度">${progress}</div>
            <div class="status" aria-live="polite"><span class="status-label"></span><p></p></div>
            <div class="coach-actions"><button class="btn" type="button" data-hint>给一点提示</button><button class="btn" type="button" data-reset>重新挑战</button></div>
            <div class="ask-box"><label for="ask-${lesson.slug}">有哪里没想通？</label><div class="ask-row"><textarea id="ask-${lesson.slug}" placeholder="写下你对这一步的疑问"></textarea><button class="btn btn-primary" type="button" data-ask>问教练</button></div><div class="ai-answer" aria-live="polite"></div></div>
          </div>
        </div>
      </section>
      <section class="lesson"><h2>复盘：${escapeHtml(lesson.review.title)}</h2><ol class="lesson-steps">${reviewSteps}</ol><div class="principle">带走一句：${escapeHtml(lesson.review.principle)}</div></section>
    </article>
    <section class="archive"><div class="archive-head"><h2>往期推送</h2><span class="meta">每一篇都可直接挑战</span></div><div class="archive-grid">${archiveCards(lesson.slug)}</div></section>
  </main>
  <footer class="site-footer">棋刻 Chess Moment · 每天三分钟，想明白一步棋</footer>
  <script>window.CHESS_LESSON=${JSON.stringify(lessonPayload).replaceAll("<", "\\u003c")};</script>
  <script src="assets/app.js"></script>
</body>
</html>`;
}

// Generate interactive pages
for (const lesson of lessons) {
  await writeFile(path.join(outDir, `${lesson.slug}.html`), renderLesson(publicLesson(lesson)));
}
await writeFile(
  path.join(outDir, "index.html"),
  renderLesson(publicLesson(lessons[0]), { homepage: true }),
);

// Generate WeChat preview pages, board PNGs, and payloads
for (const lesson of lessons) {
  // WeChat HTML preview
  await writeFile(
    path.join(wechatDir, `${lesson.slug}.html`),
    renderWechatArticle(publicLesson(lesson)),
  );

  // Static board PNG
  const png = await generateBoardPng(lesson.challenge.fen, { size: 480 });
  await writeFile(path.join(wechatBoardsDir, `${lesson.slug}.png`), png);

  // Structured payload (no credentials)
  const payload = await buildWechatPayload(publicLesson(lesson));
  await writeFile(
    path.join(artifactsDir, `${lesson.slug}.payload.json`),
    JSON.stringify(payload, null, 2),
  );

  // Audit payload for credential leakage
  const violations = auditPayload(payload);
  if (violations.length) {
    throw new Error(`Payload audit failed for ${lesson.slug}: ${violations.join(", ")}`);
  }
}

// WeChat preview index
await writeFile(path.join(wechatDir, "index.html"), renderWechatIndex(lessons));

console.log(`Built ${lessons.length} lessons, ${lessons.length} wechat previews, and ${lessons.length} payloads into _site/.`);
