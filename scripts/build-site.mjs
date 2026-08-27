import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  escapeHtml, loadLessons, localizeLesson, pickHomepageLesson, publicLesson, validateLessons,
} from "./content-lib.mjs";
import { renderWechatArticle, renderWechatIndex } from "./wechat-render.mjs";
import { generateBoardPng } from "./board-png.mjs";
import { buildWechatPayload, auditPayload } from "./wechat-payload.mjs";
import { UI } from "../assets/i18n.mjs";

const root = process.cwd();
const outDir = path.join(root, "_site");
const lessons = await loadLessons(root);
const errors = validateLessons(lessons);
if (errors.length) throw new Error(errors.join("\n"));

lessons.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });
await mkdir(path.join(outDir, "en"), { recursive: true });
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
// Mirrors the PIECE_KEYS list in assets/app.js. prefix 用于英文页（位于 en/ 子目录，
// 资源路径需回到上一级，即 "../"）。
const PIECE_KEYS = ["wk", "wq", "wr", "wb", "wn", "wp", "bk", "bq", "br", "bb", "bn", "bp"];
const PIECE_PRELOAD_LINKS = (prefix) => PIECE_KEYS
  .map(key => `  <link rel="preload" as="image" href="${prefix}assets/pieces/${key}.png">`)
  .join("\n");

// AI 教练配置：部署 Cloudflare Worker 后，把 Worker URL 设到环境变量
// CHESS_COACH_WORKER_URL（或 GitHub repo secret），构建时自动注入。
// 未设置时 workerUrl 为空字符串，前端走预制答案降级。
const COACH_WORKER_URL = (process.env.CHESS_COACH_WORKER_URL || "").trim();
const COACH_CONFIG_JSON = JSON.stringify({ workerUrl: COACH_WORKER_URL });

// 语言自动检测脚本（内联，非 module，放在 <head> 尽早执行）。
// 逻辑与 assets/i18n.mjs 的 resolveLanguage / siblingPath 保持一致：
// 手动选择（localStorage chessMomentLang）优先；否则按 navigator.language 判断。
function langDetectScript(pageLang) {
  return `<script>
(function(){
  var stored = null;
  try { stored = localStorage.getItem("chessMomentLang"); } catch (e) {}
  var nav = (navigator.language || "").toLowerCase();
  var want = (stored === "zh" || stored === "en") ? stored : (nav.indexOf("zh") === 0 ? "zh" : (nav.indexOf("en") === 0 ? "en" : "zh"));
  var page = "${pageLang}";
  if (want !== page) {
    var p = location.pathname;
    var next = page === "zh" ? p.replace(/([^/]*)\\.html$/, "en/$1.html") : p.replace(/\\/en\\//, "/");
    if (next !== p) location.replace(next);
  }
})();
</script>`;
}

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

// 把 prerequisites slug 数组渲染成可点击的先修链接（标题取自当前课程集合，
// 并按当前语言本地化）。
function prereqLinks(lesson, locale) {
  const u = UI[locale];
  if (!Array.isArray(lesson.prerequisites) || lesson.prerequisites.length === 0) return "";
  const links = lesson.prerequisites
    .map(slug => {
      const target = lessons.find(item => item.slug === slug);
      const localizedTarget = target ? localizeLesson(target, locale) : null;
      const title = localizedTarget ? localizedTarget.title : slug;
      return `<a href="${slug}.html">${escapeHtml(title)}</a>`;
    })
    .join("、");
  return `<p class="prereq"><strong>${u.prereq}</strong>${links}${u.prereqSuffix}</p>`;
}

function tagLine(tags) {
  if (!Array.isArray(tags) || tags.length === 0) return "";
  return `　·　标签：${tags.map(escapeHtml).join("、")}`;
}

/**
 * 渲染一个互动页。中文（locale="zh"）输出到站点根目录，英文（locale="en"）
 * 输出到 en/ 子目录。UI 文案取自 assets/i18n.mjs 的 UI 字典；课程文案用
 * localizeLesson 切换。中文输出保持与历史版本一致的字符串与结构。
 */
function renderLesson(lesson, { locale = "zh", homepage = false } = {}) {
  const u = UI[locale];
  const isEn = locale === "en";
  const localized = localizeLesson(lesson, locale);
  const htmlLang = isEn ? "en" : "zh-CN";
  // 英文页位于 en/ 子目录，资源路径需回到上一级。
  const assetPrefix = isEn ? "../" : "";
  const pageName = homepage ? "index.html" : `${lesson.slug}.html`;
  const lessonPayload = { id: lesson.slug, challenge: localized.challenge };
  const paragraphs = localized.introduction.map(text => `<p>${escapeHtml(text)}</p>`).join("");
  const reviewSteps = localized.review.steps.map(step => `<li>${escapeHtml(step)}</li>`).join("");
  const progress = localized.challenge.steps.map(() => "<span></span>").join("");
  const pageTitle = homepage ? u.titleHome : `${escapeHtml(localized.title)}${u.titleSuffix}`;
  // 语言切换：当前页指向另一语言的兄弟页，href 用相对路径（en 页位于 en/ 子目录）。
  const toggleHref = isEn ? `../${pageName}` : `en/${pageName}`;
  const toggleDataLang = isEn ? "zh" : "en";
  return `<!doctype html>
<html lang="${htmlLang}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="${escapeHtml(localized.summary)}">
  <meta name="theme-color" content="#183c34">
  <meta name="application-name" content="${u.appName}">
  <meta name="apple-mobile-web-app-title" content="${u.appName}">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="default">
  <title>${pageTitle}</title>
  <link rel="icon" type="image/svg+xml" href="${assetPrefix}assets/icons/chess-moment.svg">
  <link rel="apple-touch-icon" sizes="180x180" href="${assetPrefix}assets/icons/apple-touch-icon.png">
  <link rel="manifest" href="${assetPrefix}assets/site.webmanifest">
  <link rel="stylesheet" href="${assetPrefix}assets/styles.css">
  ${PIECE_PRELOAD_LINKS(assetPrefix)}
  <script>window.CHESS_COACH_CONFIG = ${COACH_CONFIG_JSON};</script>
  ${langDetectScript(isEn ? "en" : "zh")}
</head>
<body>
  <header class="site-header"><div class="header-inner"><a class="brand" href="index.html">${u.brandZh} <span>${u.brandEn}</span></a><span class="issue-mark">${u.issueMark}</span><a class="lang-toggle" href="${toggleHref}" data-lang="${toggleDataLang}" hreflang="${isEn ? "zh-CN" : "en"}">${u.toggleOther}</a></div></header>
  <main class="page">
    <article>
      <header class="article-header">
        <p class="eyebrow">${escapeHtml(localized.dateLabel)} · ${escapeHtml(localized.edition)}${escapeHtml(localized.category)}</p>
        <h1>${escapeHtml(localized.title)}</h1>
        <p class="dek">${escapeHtml(localized.summary)}</p>
        <div class="meta">${u.difficulty} ${localized.difficulty}/5　·　${u.expected} ${localized.duration} ${u.minutes}　·　${localized.challenge.steps.length} ${u.choices}　·　${u.topic}：${escapeHtml(localized.topic)}${tagLine(localized.tags)}</div>
      </header>
      <section class="story">
        ${prereqLinks(localized, locale)}
        ${paragraphs}
        <aside class="culture-note"><strong>${escapeHtml(localized.culture.title)}</strong>${escapeHtml(localized.culture.content)}</aside>
      </section>
      <section class="challenge" data-puzzle="${lesson.slug}">
        <div class="challenge-head"><p class="challenge-kicker">${u.kicker}</p><h2>${escapeHtml(localized.challenge.title)}</h2><p>${escapeHtml(localized.challenge.instruction)}</p></div>
        <div class="challenge-body">
          <div class="board-wrap"><div class="board" role="grid" aria-label="${u.ariaBoard}"></div></div>
          <div class="coach">
            <div class="progress" aria-label="${u.progressAria}">${progress}</div>
            <div class="status" aria-live="polite"><span class="status-label"></span><p></p></div>
            <div class="coach-actions"><button class="btn" type="button" data-hint>${u.hintBtn}</button><button class="btn" type="button" data-reset>${u.resetBtn}</button><button class="btn" type="button" data-report>${u.reportBtn}</button></div>
            <div class="ask-box"><div class="ask-label-row"><label for="ask-${lesson.slug}">${u.askLabel}</label><a class="coach-settings-toggle" href="#" aria-expanded="false" data-coach-settings-toggle>${u.aiSettings}</a></div><div class="ask-row"><textarea id="ask-${lesson.slug}" placeholder="${u.askPlaceholder}"></textarea><button class="btn btn-primary" type="button" data-ask>${u.askCoach}</button></div><div class="ai-answer" aria-live="polite"></div></div>
          </div>
        </div>
      </section>
      <section class="lesson"><h2>${u.reviewPrefix}${escapeHtml(localized.review.title)}</h2><ol class="lesson-steps">${reviewSteps}</ol><div class="principle">${u.principleLabel}${escapeHtml(localized.review.principle)}</div></section>
    </article>
    <section class="archive"><div class="archive-head"><h2>${u.archiveTitle}</h2><span class="meta">${u.archiveMeta}</span></div><div class="archive-grid">${archiveCards(lesson.slug)}</div></section>
  </main>
  <footer class="site-footer"><div class="footer-meta">${u.brandZh} ${u.brandEn} · ${u.footerMeta} · <a class="footer-report" href="#" data-footer-report>${u.footerReport}</a></div><div class="donate-section"><span class="donate-tag">${u.donateTag}</span><div class="donate-triggers"><button type="button" class="donate-trigger alipay" data-donate-alipay>${u.donateAlipay}</button><button type="button" class="donate-trigger wechat" data-donate-wechat>${u.donateWechat}</button></div></div></footer>
  <div class="coach-settings-panel" data-coach-settings-panel hidden>
    <div class="coach-settings-inner">
      <h3>${u.settingsTitle}</h3>
      <p class="coach-settings-hint">${u.settingsHint}</p>
      <label>${u.settingsProvider}<select data-coach-provider><option value="openrouter">${u.providerOpenRouter}</option><option value="deepseek">${u.providerDeepseek}</option><option value="glm">${u.providerGlm}</option></select></label>
      <label>${u.settingsApiKey}<input type="password" data-coach-api-key placeholder="${u.settingsKeyPlaceholder}"></label>
      <div class="coach-settings-actions"><button class="btn btn-primary" type="button" data-coach-save>${u.settingsSave}</button><span class="coach-saved" data-coach-saved aria-live="polite"></span></div>
    </div>
  </div>
  <script>window.CHESS_LESSON=${JSON.stringify(lessonPayload).replaceAll("<", "\\u003c")};</script>
  <script type="module" src="${assetPrefix}assets/app.js"></script>
</body>
</html>`;
}

// Generate interactive pages (both languages)
for (const lesson of lessons) {
  const pub = publicLesson(lesson);
  await writeFile(path.join(outDir, `${lesson.slug}.html`), renderLesson(pub, { locale: "zh" }));
  await writeFile(path.join(outDir, "en", `${lesson.slug}.html`), renderLesson(pub, { locale: "en" }));
}
// 主页默认展示"今天"那一期（按月日匹配，不看年份；今天未命中则取最近历史一期，
// 跨年全晚于今天则取最晚一期）。生产构建读真实系统时钟；测试/CI 可用
// CHESS_HOME_DATE 注入固定 ISO 日期，使构建结果可复现。
const homeDate = process.env.CHESS_HOME_DATE ? new Date(process.env.CHESS_HOME_DATE) : new Date();
const homeLesson = pickHomepageLesson(lessons, homeDate) || lessons[0];
const homePub = publicLesson(homeLesson);
await writeFile(
  path.join(outDir, "index.html"),
  renderLesson(homePub, { locale: "zh", homepage: true }),
);
await writeFile(
  path.join(outDir, "en", "index.html"),
  renderLesson(homePub, { locale: "en", homepage: true }),
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

console.log(`Built ${lessons.length} lessons (zh + en), ${lessons.length} wechat previews, and ${lessons.length} payloads into _site/.`);
