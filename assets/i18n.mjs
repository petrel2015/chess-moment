/**
 * 全站文案的轻量 i18n 层（中英双语）。
 *
 * - 页面语言由 <html lang> 决定（zh-CN / en），生成时已定死；
 *   app.js 通过 currentLang() / ui() / t() 读取当前语言文案。
 * - UI 文案集中在这一个字典，构建脚本（build-site.mjs）与前端（app.js）共用，
 *   避免同一句文案在 HTML 模板与 JS 里各维护一份。
 * - resolveLanguage / siblingPath 是纯函数，同时被构建期的语言检测脚本与测试复用。
 */

export const LANGS = ["zh", "en"];

/**
 * 根据浏览器语言与用户手动选择（localStorage）解析目标语言。
 * 规则：手动选择优先；其次 navigator.language 以 zh 开头→中文、en 开头→英文；
 * 其余一律中文（本站默认）。
 * @param {string} navigatorLang e.g. "zh-CN" / "en-US" / "ja-JP"
 * @param {string|null} storedLang 用户手动选择（"zh"|"en"|null）
 * @returns {"zh"|"en"}
 */
export function resolveLanguage(navigatorLang, storedLang) {
  if (storedLang === "zh" || storedLang === "en") return storedLang;
  const nav = String(navigatorLang || "").toLowerCase();
  if (nav.startsWith("zh")) return "zh";
  if (nav.startsWith("en")) return "en";
  return "zh";
}

/**
 * 计算当前页面的兄弟语言页面路径（用于自动跳转与语言切换按钮）。
 * 中文页在根目录（/foo.html），英文页在 /en/foo.html。
 * @param {"zh"|"en"} pageLang 当前页语言
 * @param {string} pathname 当前路径，如 "/chess-moment/rook-ladder.html"
 * @returns {string} 兄弟页路径
 */
export function siblingPath(pageLang, pathname) {
  if (pageLang === "zh") {
    // /a/b/foo.html -> /a/b/en/foo.html
    return pathname.replace(/([^/]*)\.html$/, "en/$1.html");
  }
  // /a/b/en/foo.html -> /a/b/foo.html
  return pathname.replace(/\/en\//, "/");
}

export const UI = {
  zh: {
    // 棋子名（用于棋盘 aria-label 与提示）
    pieceNames: {
      K: "白王", Q: "白后", R: "白车", B: "白象", N: "白马", P: "白兵",
      k: "黑王", q: "黑后", r: "黑车", b: "黑象", n: "黑马", p: "黑兵",
    },
    // 棋谱记号解释（enhanceNotation 的悬停提示）
    notationGlossary: {
      "Re8#": "白车走到 e8。R 是车（Rook），# 表示将死。",
      "Rg8#": "白车走到 g8。R 是车（Rook），# 表示将死。",
      "Ne7+": "白马跳到 e7。N 是马（Knight），+ 表示将军。",
      "Nxc8": "白马吃掉 c8 的棋子。N 是马，x 表示吃子。",
      "Nxd4": "白马吃到 d4。N 是马，x 表示吃子。",
      "Bc4": "白象走到 c4。B 是象（Bishop）。",
      "...exd4": "黑方的 e 线兵吃到 d4；省略号表示这是黑方着法，x 表示吃子。",
      "exd4": "e 线兵吃到 d4；x 表示吃子。",
      "Re8": "白车走到 e8。R 是车（Rook）。",
      "Rg8": "白车走到 g8。R 是车（Rook）。",
    },
    quickQuestionsAria: "常见问题快捷选项",
    notationAria: "{term}，点击查看棋谱解释",
    emptySquare: "空格",
    statusFirstSelectWhite: "先选白棋",
    statusFirstSelectWhiteBody: "点击你想移动的白色棋子，再点击目标格。",
    statusCannotMove: "这里不能走",
    statusCannotMoveBody: "{piece}不能走到 {square}。请选择棋盘上标出的合法目标格。",
    statusGoodDirection: "方向正确",
    statusOpponentReplying: "对手正在回应……",
    statusOpponentError: "对手回应异常",
    statusOpponentErrorBody: "对手的自动回未能完成。可以点「反馈问题」附上当前局面报告，或点「重新挑战」重试。",
    statusAlt: "这步也合理",
    statusError: "想法还差一步",
    statusContinue: "继续",
    statusComplete: "挑战完成",
    statusYourTurn: "轮到你了",
    hintLabel: "给你一点方向",
    hintBody: "观察 {square} 上的棋子：它能不能前往一个同时制造威胁、又改善位置的格子？",
    coachPrefix: "棋局教练：",
    aiLoading: "正在思考…",
    aiFallback: "AI 暂时不可用，已显示预设参考：",
    askDefaultQuestion: "请讲讲这一步的思路。",
    aiSettingSaved: "已保存。",
    aiSettings: "AI 设置",
    settingsTitle: "AI 教练设置",
    settingsHint: "选择平台并填入自己的 API Key，即可用该平台的模型回答；留空则使用站点默认（OpenRouter 免费模型）。Key 只保存在本浏览器。",
    settingsProvider: "AI 平台",
    providerOpenRouter: "OpenRouter（免费模型）",
    providerDeepseek: "DeepSeek",
    providerGlm: "智谱 GLM（glm-4-flash 免费）",
    settingsApiKey: "API Key",
    settingsKeyPlaceholder: "留空则用站点默认",
    settingsSave: "保存",
    celebrationComplete: "挑战完成",
    celebrationMate: "将死！黑王无路可逃",
    celebrationCheck: "将军！黑王必须回应",
    celebrationGood: "思路正确，漂亮完成",
    reportSubjectPrefix: "【棋刻反馈】",
    reportSubjectTitle: "题目问题",
    reportSubjectDate: "（{date}）",
    reportIntro: "请在此处描述你遇到的问题或疑惑：",
    reportDiag: "——以下为系统自动收集的诊断信息，请勿删除——",
    reportLesson: "题目：{slug}（{title}）",
    reportLessonNoTitle: "题目：{slug}",
    reportDate: "日期标签：{date}",
    reportStep: "当前步骤：第 {step} 步（共 {total} 步）",
    reportSide: "轮到：{side}",
    reportLastMove: "最后一步走法：{move}",
    reportStartFen: "起始局面 FEN：{fen}",
    reportCurrentFen: "当前局面 FEN：{fen}",
    reportUrl: "页面地址：{url}",
    reportUa: "浏览器：{ua}",
    reportNoLive: "（未含实时局面。如需更精准诊断，请用棋盘旁的「反馈问题」按钮，会自动带上当前局面。）",
    sideWhite: "白方",
    sideBlack: "黑方",
    materialWhite: "白方 {score}分",
    materialBlack: "黑方 {score}分",
    oddsHead: "局面胜算",
    oddsLine: "白胜 {w}% · 和棋 {d}% · 黑胜 {b}%",
    oddsNote: "教学局面估算 · 走子后实时更新",
    donateTag: "请我喝杯咖啡 ￥4.9",
    donateAlipay: "支付宝",
    donateWechat: "微信",
    donateClose: "关闭",
    donateQrAlt: "{channel}收款码",
    donateModalAria: "{channel}赞赏二维码",
    donateHintAlipay: "长按或保存二维码，打开支付宝扫一扫",
    donateHintWechat: "长按或保存二维码，打开微信扫一扫",
    // ---- 以下为构建期 HTML 模板用文案 ----
    brandZh: "棋刻",
    brandEn: "Chess Moment",
    issueMark: "每期完整挑战 · 立即讲解",
    appName: "棋刻",
    titleHome: "棋刻｜每日国际象棋挑战",
    titleSuffix: "｜棋刻",
    ariaBoard: "国际象棋互动棋盘",
    kicker: "今日挑战",
    difficulty: "难度",
    expected: "预计",
    minutes: "分钟",
    choices: "次关键选择",
    topic: "主题",
    prereq: "先修：",
    prereqSuffix: " →",
    progressAria: "进度",
    hintBtn: "给一点提示",
    resetBtn: "重新挑战",
    reportBtn: "反馈问题",
    askLabel: "有哪里没想通？",
    aiSettings: "AI 设置",
    askPlaceholder: "写下你对这一步的疑问",
    askCoach: "问教练",
    reviewPrefix: "复盘：",
    principleLabel: "带走一句：",
    archiveTitle: "往期推送",
    archiveMeta: "每一篇都可直接挑战",
    archiveChoiceSuffix: "次选择",
    footerMeta: "每天三分钟，想明白一步棋",
    footerReport: "反馈问题",
    toggleOther: "English",
  },

  en: {
    pieceNames: {
      K: "White King", Q: "White Queen", R: "White Rook", B: "White Bishop", N: "White Knight", P: "White Pawn",
      k: "Black King", q: "Black Queen", r: "Black Rook", b: "Black Bishop", n: "Black Knight", p: "Black Pawn",
    },
    notationGlossary: {
      "Re8#": "Rook moves to e8 and checkmates. R = Rook, # = checkmate.",
      "Rg8#": "Rook moves to g8 and checkmates. R = Rook, # = checkmate.",
      "Ne7+": "Knight jumps to e7 with check. N = Knight, + = check.",
      "Nxc8": "Knight captures the piece on c8. N = Knight, x = captures.",
      "Nxd4": "Knight captures on d4. N = Knight, x = captures.",
      "Bc4": "Bishop moves to c4. B = Bishop.",
      "...exd4": "Black's e-pawn captures on d4; the ellipsis means it's Black's move, x = captures.",
      "exd4": "The e-pawn captures on d4; x = captures.",
      "Re8": "Rook moves to e8. R = Rook.",
      "Rg8": "Rook moves to g8. R = Rook.",
    },
    quickQuestionsAria: "Frequently asked questions",
    notationAria: "{term}, click to view notation explanation",
    emptySquare: "empty",
    statusFirstSelectWhite: "Select a white piece",
    statusFirstSelectWhiteBody: "Click the white piece you want to move, then click its destination.",
    statusCannotMove: "Can't go there",
    statusCannotMoveBody: "{piece} cannot move to {square}. Choose one of the highlighted legal targets.",
    statusGoodDirection: "Good direction",
    statusOpponentReplying: "Opponent is responding…",
    statusOpponentError: "Opponent reply failed",
    statusOpponentErrorBody: "The automatic reply could not complete. Use “Report” to attach the position, or “Restart” to try again.",
    statusAlt: "A reasonable move",
    statusError: "Not quite",
    statusContinue: "Keep going",
    statusComplete: "Challenge complete",
    statusYourTurn: "Your turn",
    hintLabel: "A hint for you",
    hintBody: "Look at the piece on {square}: can it reach a square that both creates a threat and improves the position?",
    coachPrefix: "Coach: ",
    aiLoading: "Thinking…",
    aiFallback: "AI is unavailable; showing a prepared answer: ",
    askDefaultQuestion: "Please explain the thinking behind this move.",
    aiSettingSaved: "Saved.",
    aiSettings: "AI Settings",
    settingsTitle: "AI Coach Settings",
    settingsHint: "Pick a provider and paste your own API key to use its models; leave empty for the site default (OpenRouter free models). The key stays in this browser only.",
    settingsProvider: "AI provider",
    providerOpenRouter: "OpenRouter (free models)",
    providerDeepseek: "DeepSeek",
    providerGlm: "Zhipu GLM (glm-4-flash, free)",
    settingsApiKey: "API Key",
    settingsKeyPlaceholder: "Leave empty for the site default",
    settingsSave: "Save",
    celebrationComplete: "Challenge complete",
    celebrationMate: "Checkmate! The black king has no escape",
    celebrationCheck: "Check! The black king must respond",
    celebrationGood: "Right idea, nicely done",
    reportSubjectPrefix: "[Chess Moment Feedback] ",
    reportSubjectTitle: "lesson issue",
    reportSubjectDate: " ({date})",
    reportIntro: "Describe the issue or question you have:",
    reportDiag: "— diagnostics collected automatically, please keep —",
    reportLesson: "Lesson: {slug} ({title})",
    reportLessonNoTitle: "Lesson: {slug}",
    reportDate: "Date label: {date}",
    reportStep: "Current step: {step} of {total}",
    reportSide: "Side to move: {side}",
    reportLastMove: "Last move: {move}",
    reportStartFen: "Start FEN: {fen}",
    reportCurrentFen: "Current FEN: {fen}",
    reportUrl: "Page URL: {url}",
    reportUa: "Browser: {ua}",
    reportNoLive: "(No live position included. For a more precise diagnosis, use the “Report” button beside the board — it attaches the current position.)",
    sideWhite: "White",
    sideBlack: "Black",
    materialWhite: "White {score}",
    materialBlack: "Black {score}",
    oddsHead: "Win odds",
    oddsLine: "White {w}% · Draw {d}% · Black {b}%",
    oddsNote: "Rough teaching estimate · updates after every move",
    donateTag: "Buy me a coffee ￥4.9",
    donateAlipay: "Alipay",
    donateWechat: "WeChat",
    donateClose: "Close",
    donateQrAlt: "{channel} payment QR",
    donateModalAria: "{channel} donation QR code",
    donateHintAlipay: "Long-press or save the QR code, open Alipay and scan",
    donateHintWechat: "Long-press or save the QR code, open WeChat and scan",
    // ---- build-time HTML template strings ----
    brandZh: "棋刻",
    brandEn: "Chess Moment",
    issueMark: "A full challenge every day · explained instantly",
    appName: "Chess Moment",
    titleHome: "Chess Moment | Daily Chess Challenge",
    titleSuffix: " | Chess Moment",
    ariaBoard: "Interactive chess board",
    kicker: "Today's Challenge",
    difficulty: "Difficulty",
    expected: "≈",
    minutes: "min",
    choices: "key decisions",
    topic: "Theme",
    prereq: "Prerequisites: ",
    prereqSuffix: "",
    progressAria: "Progress",
    hintBtn: "Hint",
    resetBtn: "Restart",
    reportBtn: "Report",
    askLabel: "Something unclear?",
    aiSettings: "AI Settings",
    askPlaceholder: "Type your question about this move",
    askCoach: "Ask Coach",
    reviewPrefix: "Review: ",
    principleLabel: "Takeaway: ",
    archiveTitle: "Archive",
    archiveMeta: "Every issue is playable",
    archiveChoiceSuffix: " choices",
    footerMeta: "Three minutes a day to understand one move",
    footerReport: "Report a problem",
    toggleOther: "中文",
  },
};

/** 当前页语言：由 <html lang> 决定（生成时已定死）。 */
export function currentLang() {
  const lang = (document.documentElement.lang || "zh-CN").toLowerCase();
  return lang.startsWith("en") ? "en" : "zh";
}

/** 当前语言的文案字典。 */
export function ui() {
  return UI[currentLang()];
}

/**
 * 取当前语言文案，支持 {key} 占位符替换。
 * @param {string} key 字典键
 * @param {object} [params] 占位符参数，如 { piece: "白车", square: "e8" }
 */
export function t(key, params = {}) {
  let str = ui()[key] ?? UI.zh[key] ?? key;
  for (const [k, v] of Object.entries(params)) {
    str = str.replaceAll(`{${k}}`, String(v));
  }
  return str;
}
