import { escapeHtml, interactiveUrl } from "./content-lib.mjs";

/**
 * Render a single lesson as a WeChat-safe static HTML preview page.
 *
 * Design constraints (WECHAT_PIPELINE_DESIGN.md section 4):
 * - No script, iframe, form, button, textarea, input, or on* event handlers.
 * - All user-controlled text is HTML-escaped.
 * - Uses only inline styles + controlled basic tags.
 * - Answer and full explanation are in the body, NOT hidden behind a link.
 * - "阅读原文" points to the same-slug interactive page absolute URL.
 */
export function renderWechatArticle(lesson) {
  const esc = escapeHtml;
  const paragraphs = lesson.introduction.map(p => `<p style="margin:0 0 1em;">${esc(p)}</p>`).join("");
  const reviewSteps = lesson.review.steps.map(s => `<li style="margin-bottom:0.5em;">${esc(s)}</li>`).join("");
  const challenge = lesson.challenge;

  // Build the step-by-step answer walkthrough
  const stepDetails = challenge.steps.map((step, i) => {
    const num = i + 1;
    const move = esc(step.move);
    const opp = step.opponent ? ` · 对手回应 ${esc(step.opponent)}` : "";
    const note = esc(step.note);
    return `<div style="margin-bottom:1em;padding:0.6em 0.8em;background:#f7f3ea;border-left:3px solid #b77a2a;border-radius:4px;">` +
      `<div style="font-weight:700;color:#173d2b;margin-bottom:0.3em;">第 ${num} 步：${move}${opp}</div>` +
      `<div style="color:#444;line-height:1.6;">${note}</div>` +
      `</div>`;
  }).join("");

  // Common mistakes section
  let mistakesHtml = "";
  if (challenge.errors && Object.keys(challenge.errors).length > 0) {
    const mistakeItems = Object.entries(challenge.errors).map(([move, explanation]) =>
      `<div style="margin-bottom:0.6em;padding:0.5em 0.7em;background:#fdf0ee;border-left:3px solid #9b3d31;border-radius:4px;">` +
      `<div style="font-weight:700;color:#9b3d31;margin-bottom:0.2em;">如果走 ${esc(move)}</div>` +
      `<div style="color:#555;line-height:1.6;">${esc(explanation)}</div>` +
      `</div>`
    ).join("");
    mistakesHtml =
      `<h2 style="font-size:1.1em;color:#173d2b;border-bottom:1px solid #ddd;padding-bottom:0.3em;margin-top:1.8em;">常见错误</h2>` +
      mistakeItems;
  }

  // Quick Q&A section
  let quickHtml = "";
  if (challenge.suggestions && challenge.suggestions.length > 0) {
    const qaItems = challenge.suggestions.map(s => {
      const q = esc(s.label);
      const a = esc(challenge.quick[s.key] || "");
      return `<div style="margin-bottom:0.8em;">` +
        `<div style="font-weight:700;color:#173d2b;margin-bottom:0.2em;">Q：${q}</div>` +
        `<div style="color:#555;line-height:1.6;">A：${a}</div>` +
        `</div>`;
    }).join("");
    quickHtml =
      `<h2 style="font-size:1.1em;color:#173d2b;border-bottom:1px solid #ddd;padding-bottom:0.3em;margin-top:1.8em;">常见疑问</h2>` +
      qaItems;
  }

  // Determine side to move for display
  const sideToMove = challenge.fen.includes(" w ") ? "白方" : "黑方";

  // Board image path (relative for preview page, will be absolute in payload)
  const boardImg = `assets/boards/${lesson.slug}.png`;

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="${esc(lesson.summary)}">
  <title>${esc(lesson.title)}｜棋刻公众号版</title>
</head>
<body style="margin:0;padding:0;background:#f5f0e6;font-family:ui-serif,'Songti SC','Noto Serif CJK SC',Georgia,serif;color:#17211c;line-height:1.72;">
  <div style="max-width:640px;margin:0 auto;padding:20px 16px 40px;">
    <div style="border-bottom:2px solid #173d2b;padding-bottom:12px;margin-bottom:20px;">
      <span style="font-size:0.85em;color:#647067;">${esc(lesson.dateLabel)} · ${esc(lesson.edition)} · ${esc(lesson.category)}</span>
      <h1 style="font-size:1.5em;color:#173d2b;margin:0.3em 0 0.2em;">${esc(lesson.title)}</h1>
      <p style="font-size:0.95em;color:#647067;margin:0;">${esc(lesson.summary)}</p>
      <p style="font-size:0.8em;color:#999;margin:0.5em 0 0;">难度 ${lesson.difficulty}/5 · 预计 ${lesson.duration} 分钟 · ${challenge.steps.length} 次关键选择 · 主题：${esc(lesson.topic)}</p>
    </div>

    <h2 style="font-size:1.15em;color:#173d2b;border-bottom:1px solid #ddd;padding-bottom:0.3em;">故事引入</h2>
    ${paragraphs}

    <div style="background:#e9dfce;border-radius:8px;padding:12px 16px;margin:1em 0;">
      <div style="font-weight:700;color:#173d2b;margin-bottom:0.3em;">${esc(lesson.culture.title)}</div>
      <div style="color:#555;line-height:1.6;">${esc(lesson.culture.content)}</div>
    </div>

    <h2 style="font-size:1.15em;color:#173d2b;border-bottom:1px solid #ddd;padding-bottom:0.3em;margin-top:1.8em;">今日局面</h2>
    <p style="color:#555;">${esc(challenge.goal)}</p>
    <div style="text-align:center;margin:1em 0;">
      <img src="${boardImg}" alt="棋盘局面：${sideToMove}走棋" style="max-width:100%;height:auto;border-radius:4px;border:1px solid #ddd;" />
      <p style="font-size:0.85em;color:#999;margin-top:0.4em;">行棋方：${sideToMove} · FEN：${esc(challenge.fen)}</p>
    </div>

    <h2 style="font-size:1.15em;color:#173d2b;border-bottom:1px solid #ddd;padding-bottom:0.3em;margin-top:1.8em;">今日问题</h2>
    <div style="background:#fdf6e8;border-left:4px solid #b77a2a;padding:12px 16px;border-radius:4px;margin:1em 0;">
      <div style="font-weight:700;color:#173d2b;font-size:1.05em;margin-bottom:0.5em;">${esc(challenge.title)}</div>
      <div style="color:#555;line-height:1.7;">${esc(challenge.instruction)}</div>
    </div>

    <h2 style="font-size:1.15em;color:#173d2b;border-bottom:1px solid #ddd;padding-bottom:0.3em;margin-top:1.8em;">答案与逐步讲解</h2>
    ${stepDetails}

    <div style="background:#dfe9df;border-radius:8px;padding:12px 16px;margin:1em 0;">
      <div style="font-weight:700;color:#173d2b;margin-bottom:0.3em;">完成总结</div>
      <div style="color:#444;line-height:1.6;">${esc(challenge.success)}</div>
    </div>

    ${mistakesHtml}

    <h2 style="font-size:1.1em;color:#173d2b;border-bottom:1px solid #ddd;padding-bottom:0.3em;margin-top:1.8em;">复盘：${esc(lesson.review.title)}</h2>
    <ol style="padding-left:1.4em;color:#444;line-height:1.7;">
      ${reviewSteps}
    </ol>
    <div style="background:#f7f3ea;border-left:3px solid #b77a2a;padding:10px 14px;border-radius:4px;margin:1em 0;">
      <span style="font-weight:700;color:#173d2b;">带走一句：</span>
      <span style="color:#444;">${esc(lesson.review.principle)}</span>
    </div>

    ${quickHtml}

    <div style="background:#173d2b;border-radius:8px;padding:14px 18px;margin:2em 0 1em;text-align:center;">
      <div style="color:#f5f0e6;font-weight:700;font-size:1.05em;margin-bottom:0.4em;">想亲自走一遍这盘棋？</div>
      <div style="color:#dfe9df;font-size:0.9em;line-height:1.6;">
        点击下方链接进入互动版，可以点击或拖动走棋，每一步都有即时红绿反馈和教练讲解。
      </div>
    </div>
    <div style="text-align:center;margin:1em 0;">
      <a href="${esc(interactiveUrl(lesson))}" style="display:inline-block;padding:10px 24px;background:#b77a2a;color:#fff;text-decoration:none;border-radius:6px;font-weight:700;font-size:0.95em;">进入互动版 -></a>
    </div>
    <div style="text-align:center;font-size:0.8em;color:#999;">
      棋刻 Chess Moment · 每天三分钟，想明白一步棋
    </div>
  </div>
</body>
</html>`;
}

/**
 * Render the wechat preview index page listing all lessons.
 */
export function renderWechatIndex(lessons) {
  const esc = escapeHtml;
  const cards = lessons.map(lesson => {
    return `<a href="${esc(lesson.slug)}.html" style="display:block;text-decoration:none;color:inherit;margin-bottom:1em;padding:1em;border:1px solid #ddd;border-radius:6px;background:#fff;">` +
      `<div style="font-size:0.85em;color:#647067;">${esc(lesson.dateLabel)} · ${esc(lesson.edition)} · ${esc(lesson.category)}</div>` +
      `<div style="font-weight:700;color:#173d2b;font-size:1.05em;margin:0.2em 0;">${esc(lesson.title)}</div>` +
      `<div style="font-size:0.9em;color:#555;">${esc(lesson.summary)}</div>` +
      `<div style="font-size:0.8em;color:#b77a2a;margin-top:0.3em;">查看公众号版 →</div>` +
      `</a>`;
  }).join("");

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>棋刻公众号版预览索引</title>
</head>
<body style="margin:0;padding:0;background:#f5f0e6;font-family:ui-serif,'Songti SC','Noto Serif CJK SC',Georgia,serif;color:#17211c;line-height:1.72;">
  <div style="max-width:640px;margin:0 auto;padding:20px 16px 40px;">
    <div style="border-bottom:2px solid #173d2b;padding-bottom:12px;margin-bottom:20px;">
      <h1 style="font-size:1.4em;color:#173d2b;margin:0;">棋刻公众号版预览</h1>
      <p style="font-size:0.9em;color:#647067;margin:0.3em 0 0;">全部课程的公众号纯文字版预览页面</p>
    </div>
    ${cards}
    <div style="text-align:center;font-size:0.8em;color:#999;margin-top:2em;">
      棋刻 Chess Moment · 每天三分钟，想明白一步棋
    </div>
  </div>
</body>
</html>`;
}

/**
 * Generate the WeChat article body fragment (for use in the publisher payload).
 * This is the same content as the preview page body, but extracted as a fragment
 * suitable for the WeChat draft API.  No <html>, <head>, or <body> wrapper.
 */
export function renderWechatBodyFragment(lesson) {
  // Delegate to the full page but extract just the inner content div
  const full = renderWechatArticle(lesson);
  const start = full.indexOf('<div style="max-width:640px');
  const end = full.lastIndexOf('</div>\n</body>');
  if (start === -1 || end === -1) {
    // Fallback: extract everything between <body> and </body>
    const bodyStart = full.indexOf("<body") ;
    const bodyContentStart = full.indexOf(">", bodyStart) + 1;
    const bodyEnd = full.lastIndexOf("</body>");
    return full.slice(bodyContentStart, bodyEnd).trim();
  }
  return full.slice(start, end + 6); // include closing </div>
}
