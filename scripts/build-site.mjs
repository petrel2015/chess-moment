import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { escapeHtml, loadLessons, pickHomepageLesson, publicLesson, validateLessons } from "./content-lib.mjs";
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

// Preload piece sprites in parallel as soon as the HTML head parses, so the
// first board render is not blocked on lazy <img> fetches triggered by app.js.
// Mirrors the PIECE_KEYS list in assets/app.js.
const PIECE_KEYS = ["wk", "wq", "wr", "wb", "wn", "wp", "bk", "bq", "br", "bb", "bn", "bp"];
const PIECE_PRELOAD_LINKS = PIECE_KEYS
  .map(key => `  <link rel="preload" as="image" href="assets/pieces/${key}.png">`)
  .join("\n");

// AI 教练配置：部署 Cloudflare Worker 后，把 Worker URL 设到环境变量
// CHESS_COACH_WORKER_URL（或 GitHub repo secret），构建时自动注入。
// 未设置时 workerUrl 为空字符串，前端走预制答案降级。
const COACH_WORKER_URL = (process.env.CHESS_COACH_WORKER_URL || "").trim();
const COACH_CONFIG_JSON = JSON.stringify({ workerUrl: COACH_WORKER_URL });

function archiveCards(currentSlug) {
  return lessons
    .filter(lesson => lesson.slug !== currentSlug)
    .map(lesson => {
      const tagChips = (lesson.tags || [])
        .map(tag => `<span class="tag-chip">${escapeHtml(tag)}</span>`).join("");
      return `
      <a class="archive-card" href="${lesson.slug}.html">
        <time>${escapeHtml(lesson.dateLabel)} · ${escapeHtml(lesson.edition)}</time>
        <h3>${escapeHtml(lesson.title)}</h3>
        <p>${escapeHtml(lesson.summary)}</p>
        <span class="tag">${escapeHtml(lesson.category)} · ${lesson.challenge.steps.length}次选择 →</span>
        ${tagChips ? `<span class="tag-row">${tagChips}</span>` : ""}
      </a>`;
    })
    .join("");
}

// 把 prerequisites slug 数组渲染成可点击的先修链接（标题取自当前课程集合）。
function prereqLinks(lesson) {
  if (!Array.isArray(lesson.prerequisites) || lesson.prerequisites.length === 0) return "";
  const links = lesson.prerequisites
    .map(slug => {
      const target = lessons.find(item => item.slug === slug);
      const title = target ? target.title : slug;
      return `<a href="${slug}.html">${escapeHtml(title)}</a>`;
    })
    .join("、");
  return `<p class="prereq"><strong>先修：</strong>${links} →</p>`;
}

function tagLine(tags) {
  if (!Array.isArray(tags) || tags.length === 0) return "";
  return `　·　标签：${tags.map(escapeHtml).join("、")}`;
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
  ${PIECE_PRELOAD_LINKS}
  <script>window.CHESS_COACH_CONFIG = ${COACH_CONFIG_JSON};</script>
</head>
<body>
  <header class="site-header"><div class="header-inner"><a class="brand" href="index.html">棋刻 <span>Chess Moment</span></a><span class="issue-mark">每期完整挑战 · 立即讲解</span></div></header>
  <main class="page">
    <article>
      <header class="article-header">
        <p class="eyebrow">${escapeHtml(lesson.dateLabel)} · ${escapeHtml(lesson.edition)}${escapeHtml(lesson.category)}</p>
        <h1>${escapeHtml(lesson.title)}</h1>
        <p class="dek">${escapeHtml(lesson.summary)}</p>
        <div class="meta">难度 ${lesson.difficulty}/5　·　预计 ${lesson.duration} 分钟　·　${lesson.challenge.steps.length} 次关键选择　·　主题：${escapeHtml(lesson.topic)}${tagLine(lesson.tags)}</div>
      </header>
      <section class="story">
        ${prereqLinks(lesson)}
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
            <div class="coach-actions"><button class="btn" type="button" data-hint>给一点提示</button><button class="btn" type="button" data-reset>重新挑战</button><button class="btn" type="button" data-report>反馈问题</button></div>
            <div class="ask-box"><div class="ask-label-row"><label for="ask-${lesson.slug}">有哪里没想通？</label><a class="coach-settings-toggle" href="#" aria-expanded="false" data-coach-settings-toggle>AI 设置</a></div><div class="ask-row"><textarea id="ask-${lesson.slug}" placeholder="写下你对这一步的疑问"></textarea><button class="btn btn-primary" type="button" data-ask>问教练</button></div><div class="ai-answer" aria-live="polite"></div></div>
          </div>
        </div>
      </section>
      <section class="lesson"><h2>复盘：${escapeHtml(lesson.review.title)}</h2><ol class="lesson-steps">${reviewSteps}</ol><div class="principle">带走一句：${escapeHtml(lesson.review.principle)}</div></section>
    </article>
    <section class="archive"><div class="archive-head"><h2>往期推送</h2><span class="meta">每一篇都可直接挑战</span></div><div class="archive-grid">${archiveCards(lesson.slug)}</div></section>
  </main>
  <footer class="site-footer">棋刻 Chess Moment · 每天三分钟，想明白一步棋 · <a class="footer-report" href="#" data-footer-report>反馈问题</a></footer>
  <div class="coach-settings-panel" data-coach-settings-panel hidden>
    <div class="coach-settings-inner">
      <h3>AI 教练设置</h3>
      <p class="coach-settings-hint">默认使用站点配置。你也可以填自己的智谱 API Key 和 Worker URL，Key 只存在本浏览器里。</p>
      <label>Worker URL<input type="url" data-coach-url placeholder="https://your-worker.workers.dev"></label>
      <label>智谱 API Key（可选）<input type="password" data-coach-key placeholder="留空则用站点默认 Key"></label>
      <div class="coach-settings-actions"><button class="btn btn-primary" type="button" data-coach-save>保存</button><span class="coach-saved" data-coach-saved aria-live="polite"></span></div>
      <p class="coach-settings-help">没有 Key？看 <a href="https://open.bigmodel.cn/" target="_blank" rel="noopener">智谱开放平台</a>，GLM-4-Flash 模型免费。</p>
    </div>
  </div>
  <script>window.CHESS_LESSON=${JSON.stringify(lessonPayload).replaceAll("<", "\\u003c")};</script>
  <script type="module" src="assets/app.js"></script>
</body>
</html>`;
}

// Generate interactive pages
for (const lesson of lessons) {
  await writeFile(path.join(outDir, `${lesson.slug}.html`), renderLesson(publicLesson(lesson)));
}
// 主页默认展示"今天"那一期（按月日匹配，不看年份；今天未命中则取最近历史一期，
// 跨年全晚于今天则取最晚一期）。生产构建读真实系统时钟；测试/CI 可用
// CHESS_HOME_DATE 注入固定 ISO 日期，使构建结果可复现。
const homeDate = process.env.CHESS_HOME_DATE ? new Date(process.env.CHESS_HOME_DATE) : new Date();
const homeLesson = pickHomepageLesson(lessons, homeDate) || lessons[0];
await writeFile(
  path.join(outDir, "index.html"),
  renderLesson(publicLesson(homeLesson), { homepage: true }),
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
