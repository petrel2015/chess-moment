import {
  applyMove as engineApplyMove,
  kingThreatState,
  legalTargets,
  materialFor,
  parseFen as engineParseFen,
  pieceColor,
  toFen,
} from "./chess-engine.mjs";
import { buildCoachMessages, resolveWorkerUrl } from "./coach-ai.mjs";

const PIECE_NAMES = {
  K: "白王", Q: "白后", R: "白车", B: "白象", N: "白马", P: "白兵",
  k: "黑王", q: "黑后", r: "黑车", b: "黑象", n: "黑马", p: "黑兵"
};

const NOTATION_GLOSSARY = {
  "Re8#": "白车走到 e8。R 是车（Rook），# 表示将死。",
  "Rg8#": "白车走到 g8。R 是车（Rook），# 表示将死。",
  "Ne7+": "白马跳到 e7。N 是马（Knight），+ 表示将军。",
  "Nxc8": "白马吃掉 c8 的棋子。N 是马，x 表示吃子。",
  "Nxd4": "白马吃到 d4。N 是马，x 表示吃子。",
  "Bc4": "白象走到 c4。B 是象（Bishop）。",
  "...exd4": "黑方的 e 线兵吃到 d4；省略号表示这是黑方着法，x 表示吃子。",
  "exd4": "e 线兵吃到 d4；x 表示吃子。",
  "Re8": "白车走到 e8。R 是车（Rook）。",
  "Rg8": "白车走到 g8。R 是车（Rook）。"
};

const NOTATION_PATTERN = new RegExp(
  Object.keys(NOTATION_GLOSSARY)
    .sort((a, b) => b.length - a.length)
    .map(term => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|"),
  "g"
);

function enhanceNotation(container) {
  if (!container) return;
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  const textNodes = [];
  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (
      node.nodeValue.trim()
      && !node.parentElement.closest("button, textarea, script, style, .chess-notation")
      && NOTATION_PATTERN.test(node.nodeValue)
    ) textNodes.push(node);
    NOTATION_PATTERN.lastIndex = 0;
  }

  textNodes.forEach(node => {
    const fragment = document.createDocumentFragment();
    let cursor = 0;
    node.nodeValue.replace(NOTATION_PATTERN, (term, offset) => {
      fragment.append(node.nodeValue.slice(cursor, offset));
      const notation = document.createElement("button");
      notation.type = "button";
      notation.className = "chess-notation";
      notation.textContent = term;
      notation.dataset.explanation = NOTATION_GLOSSARY[term];
      notation.setAttribute("aria-label", `${term}，点击查看棋谱解释`);
      notation.setAttribute("aria-expanded", "false");
      notation.setAttribute("aria-describedby", "notation-tooltip");
      notation.addEventListener("mouseenter", () => showNotationTooltip(notation));
      notation.addEventListener("mouseleave", () => {
        if (!notation.classList.contains("open")) hideNotationTooltip();
      });
      notation.addEventListener("focus", () => showNotationTooltip(notation));
      notation.addEventListener("blur", () => {
        if (!notation.classList.contains("open")) hideNotationTooltip();
      });
      fragment.append(notation);
      cursor = offset + term.length;
      return term;
    });
    fragment.append(node.nodeValue.slice(cursor));
    node.replaceWith(fragment);
    NOTATION_PATTERN.lastIndex = 0;
  });
}

function notationTooltipElement() {
  let tooltip = document.querySelector("#notation-tooltip");
  if (tooltip) return tooltip;
  tooltip = document.createElement("div");
  tooltip.id = "notation-tooltip";
  tooltip.className = "notation-tooltip-popover";
  tooltip.setAttribute("role", "tooltip");
  document.body.appendChild(tooltip);
  return tooltip;
}

function showNotationTooltip(notation) {
  const tooltip = notationTooltipElement();
  tooltip.textContent = notation.dataset.explanation;
  tooltip.classList.add("show");
  const anchor = notation.getBoundingClientRect();
  const tip = tooltip.getBoundingClientRect();
  const left = Math.max(10, Math.min(
    window.innerWidth - tip.width - 10,
    anchor.left + anchor.width / 2 - tip.width / 2
  ));
  let top = anchor.top - tip.height - 10;
  if (top < 10) top = anchor.bottom + 10;
  tooltip.style.left = `${left}px`;
  tooltip.style.top = `${top}px`;
}

function hideNotationTooltip() {
  document.querySelector("#notation-tooltip")?.classList.remove("show");
}

function closeNotationTooltips(except = null) {
  document.querySelectorAll(".chess-notation.open").forEach(notation => {
    if (notation === except) return;
    notation.classList.remove("open");
    notation.setAttribute("aria-expanded", "false");
  });
  if (!except) hideNotationTooltip();
}

document.addEventListener("click", event => {
  const notation = event.target.closest?.(".chess-notation");
  if (!notation) {
    closeNotationTooltips();
    return;
  }
  const willOpen = !notation.classList.contains("open");
  closeNotationTooltips(notation);
  notation.classList.toggle("open", willOpen);
  notation.setAttribute("aria-expanded", String(willOpen));
  if (willOpen) showNotationTooltip(notation);
  else hideNotationTooltip();
});

document.addEventListener("keydown", event => {
  if (event.key === "Escape") closeNotationTooltips();
});
window.addEventListener("scroll", () => closeNotationTooltips(), { passive: true });
window.addEventListener("resize", () => closeNotationTooltips());

// Piece sprites are preprocessed by scripts/optimize-pieces.mjs: each piece's
// visible artwork is cropped, scaled to a uniform visible HEIGHT, and centered
// on a square 160x160 transparent canvas. Because the canvas is already uniform
// and centered, every piece uses the same footprint — no per-piece bounds table
// is needed. The visual height (scale) is what makes king/pawn/queen line up.
const PIECE_VISIBLE_SCALE = 0.86;   // fraction of the square the piece occupies
const PIECE_KEYS = [
  "wk", "wq", "wr", "wb", "wn", "wp",
  "bk", "bq", "br", "bb", "bn", "bp",
];

function pieceAsset(piece) {
  const color = piece === piece.toUpperCase() ? "w" : "b";
  return `assets/pieces/${color}${piece.toLowerCase()}.png`;
}

function normalizePieceArtwork(element) {
  // All piece PNGs share an identical centered square canvas after optimization,
  // so the placement formula is the same for every piece: fill the square's
  // central region and keep object-fit: contain (set in CSS) to preserve each
  // piece's internal aspect ratio.
  element.style.setProperty("--piece-canvas-size", `${PIECE_VISIBLE_SCALE * 100}%`);
  element.style.setProperty("--piece-left", `${(1 - PIECE_VISIBLE_SCALE) * 50}%`);
  element.style.setProperty("--piece-top", `${(1 - PIECE_VISIBLE_SCALE) * 50}%`);
}

// Preload every piece PNG once so the first render shows real artwork instead
// of an empty board. Resolves even on error so rendering never blocks forever.
let piecesReady = false;
let piecesPreload = null;
function preloadPieces() {
  if (piecesPreload) return piecesPreload;
  piecesPreload = Promise.all(
    PIECE_KEYS.map(key => new Promise(resolve => {
      const img = new Image();
      img.onload = () => resolve();
      img.onerror = () => resolve();
      img.src = `assets/pieces/${key}.png`;
    }))
  ).then(() => { piecesReady = true; });
  return piecesPreload;
}

// ---- 题目反馈 (mailto) ---------------------------------------------------
// 当玩家怀疑题目或交互有问题时，一键打开邮件客户端并预填诊断信息。
// 棋盘旁的按钮可读到闭包内的实时 state（当前局面 FEN、第几步等）；
// 页脚按钮不在闭包内，只能附带基础信息（slug/标题/URL/UA），不含实时局面。

const REPORT_MAILTO = "petrel2015@foxmail.com";

function buildReportMailto(opts) {
  const { title, dateLabel, slug, step, totalSteps, lastMove, startFen, currentFen, sideToMove, includeLiveState, url, userAgent } = opts;
  const subject = `【棋刻反馈】${title || "题目问题"}${dateLabel ? `（${dateLabel}）` : ""}`;
  const lines = [
    "请在此处描述你遇到的问题或疑惑：",
    "",
    "——以下为系统自动收集的诊断信息，请勿删除——",
    `题目：${slug || "未知"}${title ? `（${title}）` : ""}`,
  ];
  if (dateLabel) lines.push(`日期标签：${dateLabel}`);
  if (includeLiveState) {
    lines.push(`当前步骤：第 ${(step ?? 0) + 1} 步（共 ${totalSteps ?? "?"} 步）`);
    lines.push(`轮到：${sideToMove === "b" ? "黑方" : "白方"}`);
    if (lastMove) lines.push(`最后一步走法：${lastMove}`);
    if (startFen) lines.push(`起始局面 FEN：${startFen}`);
    if (currentFen) lines.push(`当前局面 FEN：${currentFen}`);
  } else {
    lines.push("（未含实时局面。如需更精准诊断，请用棋盘旁的「反馈问题」按钮，会自动带上当前局面。）");
  }
  if (url) lines.push(`页面地址：${url}`);
  if (userAgent) lines.push(`浏览器：${userAgent}`);

  const body = lines.join("\n");
  return `mailto:${REPORT_MAILTO}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

// ---- AI 教练（智谱 GLM-4-Flash，经 Cloudflare Worker 代理）------------------
// Worker URL 默认为空 → 走预制答案降级。部署 Worker 后填入配置即接入真 AI。
// 三层优先级：localStorage 覆盖 > window.CHESS_COACH_CONFIG.workerUrl > 空。
function coachWorkerUrl() {
  return resolveWorkerUrl({
    storage: typeof localStorage !== "undefined" ? localStorage : null,
    config: typeof window !== "undefined" ? window.CHESS_COACH_CONFIG : null,
  });
}

function coachUserKey() {
  return typeof localStorage !== "undefined" ? (localStorage.getItem("chessCoachUserKey") || "").trim() : "";
}

/**
 * 调用 Worker 请求 AI 回答。成功返回文本，失败抛错（调用方降级）。
 * 15 秒超时，避免用户长时间等待。
 */
async function askCoachAI(workerUrl, messages, userKey) {
  const headers = { "Content-Type": "application/json" };
  if (userKey) headers["X-User-Key"] = userKey;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(workerUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({ messages, temperature: 0.7, max_tokens: 800 }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`worker HTTP ${res.status}`);
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    if (typeof data.answer !== "string" || !data.answer.trim()) throw new Error("empty answer");
    return data.answer.trim();
  } finally {
    clearTimeout(timer);
  }
}

const BUILT_IN_PUZZLES = {
  corridor: {
    fen: "6k1/5ppp/8/8/8/8/8/4R1K1 w - - 0 1",
    goal: "白方走。找到一步将杀。",
    steps: [{ move: "e1e8" }],
    odds: [
      { white: 100, draw: 0, black: 0 },
      { white: 100, draw: 0, black: 0 }
    ],
    success: "白车走到 e8，并将死。棋谱记作 Re8#：R 代表车，e8 是落点，# 代表将死。黑王被自己的三枚兵关住，三个逃生格都不存在了。",
    defaultAnswer: "车走到 e8 后沿第八横线将军。黑王不能向前，因为 f7、g7、h7 都被自己的兵占着；也没有棋子能挡在车和王之间。因此这不是普通将军，而是立即将杀。",
    errors: {
      e1e7: "Re7 看起来很积极，但它没有将军。黑方获得一整步，可以给王腾出逃生格。后排杀王讲究的是立即封口。",
      e1a1: "横向调车没有制造直接威胁。先问自己：黑王现在唯一的弱点，是不是整条第八横线？"
    },
    genericError: "这步没有形成将军，黑方就有时间推动兵给王开一扇窗。请寻找一条能让车直接攻击黑王的开放横线。",
    quick: {
      "为什么结束": "因为 Re8 已经是将杀：王无处可走、无法吃车，也没有棋子能挡住这次贴着横线的攻击。规则上棋局立刻结束。",
      "为什么不能": "关键不只是把车放活跃，而是不给黑方任何喘息。非将军着通常允许黑方走 ...h6 或 ...g6，为王制造逃生格。"
    },
    suggestions: [
      { label: "为什么这就结束了？", key: "为什么结束" },
      { label: "为什么不能走别处？", key: "为什么不能" }
    ]
  },
  arabian: {
    fen: "7k/7p/5N2/8/8/8/8/6RK w - - 0 1",
    goal: "白方走。用车和马完成将杀。",
    steps: [{ move: "g1g8" }],
    odds: [
      { white: 100, draw: 0, black: 0 },
      { white: 100, draw: 0, black: 0 }
    ],
    success: "白车走到 g8，并将死。棋谱记作 Rg8#：R 代表车，# 代表将死。f6 的马守住关键格，两枚棋子配合得像一把锁。",
    defaultAnswer: "车到 g8 直接攻击 h8 的王。黑王不能吃掉车，因为 f6 的马会保护 g8；h7 又被自己的兵堵住，所以没有合法逃路。",
    errors: {},
    genericError: "先别急着移动马。马已经在保护一个非常关键的格子；想想车能不能借用这层保护，贴近黑王将军。",
    quick: {
      "马": "马在这里不是主攻手，而是保镖。它保护 g8，让黑王不能吃掉前来将军的白车。",
      "为什么结束": "Rg8 后黑王处于将军，既不能逃、不能吃车，也无法挡棋，所以立即结束。"
    },
    suggestions: [
      { label: "这匹马做了什么？", key: "马" },
      { label: "为什么这就结束了？", key: "为什么结束" }
    ]
  },
  fork: {
    fen: "2q3k1/8/8/5N2/8/8/8/6K1 w - - 0 1",
    goal: "白方走。找到同时攻击王和后的落点。",
    steps: [{ move: "f5e7" }],
    odds: [
      { white: 94, draw: 5, black: 1 },
      { white: 99, draw: 1, black: 0 }
    ],
    success: "白马跳到 e7，将军！棋谱记作 Ne7+：N 代表马，+ 代表将军。白马同时攻击 c8 的黑后，黑方必须先救王。",
    defaultAnswer: "马到 e7 后同时攻击 g8 的王和 c8 的后。因为将军具有最高优先级，黑方必须先救王，无法同时保住后。",
    errors: {},
    genericError: "双重攻击要找的不是离目标最近的格子，而是一个能同时覆盖两个目标的格子。数一数马从哪里能同时跳到 g8 与 c8。",
    quick: {
      "为什么是e7": "从 e7 出发，马恰好同时控制 g8 和 c8。一个目标是王，一个目标是后；将军迫使黑方先处理王。",
      "黑后": "黑后此刻还没被吃，但它已经无法被兼顾。黑方应对完将军后，白马下一步就能 Nxc8。"
    },
    suggestions: [
      { label: "为什么一定是 e7？", key: "为什么是e7" },
      { label: "黑后为什么跑不掉？", key: "黑后" }
    ]
  },
  philidor: {
    fen: "rnbqkbnr/ppp2ppp/3p4/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 0 3",
    goal: "白方走两步：立即挑战中心，并用子力收回。",
    steps: [
      { move: "d2d4", opponent: "e5d4", note: "黑方接受挑战，...exd4。现在该用哪枚已经发展的棋子收回中心兵？" },
      { move: "f3d4" }
    ],
    odds: [
      { white: 40, draw: 49, black: 11 },
      { white: 42, draw: 48, black: 10 },
      { white: 44, draw: 47, black: 9 }
    ],
    success: "d4、...exd4、Nxd4。白方用一个中心兵换来了空间，并让马自然地站到活跃位置。",
    defaultAnswer: "d4 立即质问黑方的 e5 兵。交换后用 f3 的马收回，既恢复兵力平衡，又让马占据中心；同一步棋完成了两个发展目标。",
    errors: {
      f1c4: "Bc4 是完全合理的棋，也是意大利式思路；但本课练的是趁黑方用 ...d6 稍显被动时，立刻用 d4 打开中心。",
      d2d3: "d3 很稳健，却把中心张力留给以后。本题希望你体验更直接的 d4：主动问黑方的 e5 兵怎么办。"
    },
    genericError: "这步未必是坏棋，但没有完成本题目标：立刻用兵挑战 e5 中心。找找白方哪个兵能前进两格做到这一点。",
    quick: {
      "为什么不能bc4": "Bc4 并不坏，它会进入常见的意大利式结构。本题只把它判为偏离目标，因为我们正在练习 d4 的即时中心反击。",
      "为什么用马": "Nxd4 让马从 f3 来到更中心的格子，同时收回兵。若用后吃，后容易过早暴露并被对方子力追赶。"
    },
    suggestions: [
      { label: "为什么不能先走 Bc4？", key: "为什么不能bc4" },
      { label: "为什么要用马收回？", key: "为什么用马" }
    ]
  }
};

const PUZZLES = { ...BUILT_IN_PUZZLES };
if (window.CHESS_LESSON?.id && window.CHESS_LESSON?.challenge) {
  PUZZLES[window.CHESS_LESSON.id] = window.CHESS_LESSON.challenge;
}

// 引擎在 chess-engine.mjs 中实现，覆盖王车易位、兵升变、吃过路兵与将军/将死判定。
// app.js 用 state = { board, castling, enPassant } 表示局面，下面两个别名保持调用简洁。
const parseFen = engineParseFen;
const applyMove = engineApplyMove;

function setupChallenge(root) {
  const id = root.dataset.puzzle;
  const puzzle = PUZZLES[id];
  if (!puzzle) return;

  let state = parseFen(puzzle.fen);
  let selected = null;
  let step = 0;
  let lastMove = null;
  let moveFeedback = null;
  let moveFeedbackTimer = null;
  let dragState = null;
  let suppressClick = false;
  let nativeDragFrom = null;
  let nativeDropHandled = false;
  // 对手回应窗口：用户走对一步后到对手 auto-reply 完成之间为 true，
  // 期间禁止用户操作（避免与异步 render 竞争导致状态错乱）。
  let awaitingOpponent = false;
  let opponentTimer = null;
  const boardEl = root.querySelector(".board");
  const status = root.querySelector(".status");
  const statusLabel = status.querySelector(".status-label");
  const statusText = status.querySelector("p");
  const resetBtn = root.querySelector("[data-reset]");
  const hintBtn = root.querySelector("[data-hint]");
  const askBtn = root.querySelector("[data-ask]");
  const reportBtn = root.querySelector("[data-report]");
  const askInput = root.querySelector("textarea");
  const answer = root.querySelector(".ai-answer");
  const askRow = root.querySelector(".ask-row");
  const quickQuestions = document.createElement("div");
  quickQuestions.className = "quick-questions";
  quickQuestions.setAttribute("aria-label", "常见问题快捷选项");
  (puzzle.suggestions || []).forEach(suggestion => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "quick-question";
    button.textContent = suggestion.label;
    button.addEventListener("click", () => {
      askInput.value = suggestion.label;
      showCoachAnswer(suggestion.label, suggestion.key);
    });
    quickQuestions.appendChild(button);
  });
  askRow.before(quickQuestions);
  const boardWrap = boardEl.parentElement;
  const positionPanel = document.createElement("section");
  positionPanel.className = "position-panel";
  positionPanel.setAttribute("aria-label", "当前子力与局面胜算");
  boardWrap.insertBefore(positionPanel, boardEl);

  function renderPositionPanel() {
    const whiteMaterial = materialFor(state.board, "w");
    const blackMaterial = materialFor(state.board, "b");
    const odds = puzzle.odds?.[Math.min(step, puzzle.odds.length - 1)]
      || { white: 34, draw: 33, black: 33 };
    positionPanel.innerHTML = `
      <div class="material-line">
        <div class="material-side">
          <span class="side-dot white-dot" aria-hidden="true"></span>
          <span><strong>白方 ${whiteMaterial.score}分</strong><small>${whiteMaterial.pieces}</small></span>
        </div>
        <div class="material-side material-side-black">
          <span><strong>黑方 ${blackMaterial.score}分</strong><small>${blackMaterial.pieces}</small></span>
          <span class="side-dot black-dot" aria-hidden="true"></span>
        </div>
      </div>
      <div class="odds-head">
        <strong>局面胜算</strong>
        <span>白胜 ${odds.white}% · 和棋 ${odds.draw}% · 黑胜 ${odds.black}%</span>
      </div>
      <div class="odds-bar" role="img" aria-label="白胜 ${odds.white}%，和棋 ${odds.draw}%，黑胜 ${odds.black}%">
        <span class="odds-white" style="width:${odds.white}%"></span>
        <span class="odds-draw" style="width:${odds.draw}%"></span>
        <span class="odds-black" style="width:${odds.black}%"></span>
      </div>
      <p class="odds-note">教学局面估算 · 走子后实时更新</p>
    `;
  }

  function render() {
    const board = state.board;
    const availableTargets = selected ? legalTargets(state, selected) : [];
    renderPositionPanel();
    boardEl.innerHTML = "";
    for (let rank = 8; rank >= 1; rank--) {
      for (let fileIndex = 0; fileIndex < 8; fileIndex++) {
        const file = "abcdefgh"[fileIndex];
        const squareName = file + rank;
        const square = document.createElement("button");
        square.type = "button";
        square.className = "square" + ((fileIndex + rank) % 2 ? " dark" : "");
        square.dataset.square = squareName;
        square.draggable = Boolean(
          board[squareName]
          && pieceColor(board[squareName]) === "w"
          && step < puzzle.steps.length
        );
        square.setAttribute("aria-label", squareName + (board[squareName] ? " " + PIECE_NAMES[board[squareName]] : " 空格"));
        if (selected === squareName) square.classList.add("selected");
        if (availableTargets.includes(squareName)) {
          square.classList.add("target");
          if (board[squareName]) square.classList.add("capture");
        }
        if (lastMove && lastMove.includes(squareName)) square.classList.add("last-move");
        if (moveFeedback?.square === squareName) {
          square.classList.add("move-feedback", `move-feedback-${moveFeedback.kind}`);
        }

        if (board[squareName]) {
          if (piecesReady) {
            const piece = document.createElement("img");
            piece.className = "piece";
            piece.src = pieceAsset(board[squareName]);
            piece.alt = "";
            piece.draggable = false;
            normalizePieceArtwork(piece);
            square.appendChild(piece);
          } else {
            // Pieces still loading: show a pulsing silhouette placeholder so
            // users see something is on the way rather than an empty board.
            const placeholder = document.createElement("div");
            placeholder.className = "piece-placeholder";
            normalizePieceArtwork(placeholder);
            square.appendChild(placeholder);
          }
        }
        if (moveFeedback?.square === squareName) {
          const feedbackRing = document.createElement("span");
          feedbackRing.className = "move-feedback-ring";
          feedbackRing.setAttribute("aria-hidden", "true");
          square.appendChild(feedbackRing);
        }
        if (fileIndex === 0) {
          const label = document.createElement("span");
          label.className = "rank";
          label.textContent = rank;
          square.appendChild(label);
        }
        if (rank === 1) {
          const label = document.createElement("span");
          label.className = "file";
          label.textContent = file;
          square.appendChild(label);
        }
        square.addEventListener("pointerdown", event => startDrag(event, squareName));
        square.addEventListener("mousedown", event => {
          if (!dragState) startDrag(event, squareName);
        });
        square.addEventListener("dragstart", event => startNativeDrag(event, squareName));
        square.addEventListener("dragover", event => {
          if (nativeDragFrom) event.preventDefault();
        });
        square.addEventListener("drop", event => dropNativePiece(event, squareName));
        square.addEventListener("dragend", finishNativeDrag);
        square.addEventListener("click", () => {
          if (!suppressClick) choose(squareName);
        });
        boardEl.appendChild(square);
      }
    }
    root.querySelectorAll(".progress span").forEach((dot, i) => dot.classList.toggle("done", i < step));
  }

  function setStatus(kind, label, text) {
    status.className = "status" + (kind ? " " + kind : "");
    statusLabel.textContent = label;
    statusText.textContent = text;
    enhanceNotation(statusText);
  }

  function markMoveFeedback(square, kind, duration = 1050) {
    const feedback = { square, kind };
    moveFeedback = feedback;
    window.clearTimeout(moveFeedbackTimer);
    moveFeedbackTimer = window.setTimeout(() => {
      if (moveFeedback !== feedback) return;
      moveFeedback = null;
      const feedbackSquare = boardEl.querySelector(`[data-square="${square}"]`);
      feedbackSquare?.classList.remove("move-feedback", `move-feedback-${kind}`);
      feedbackSquare?.querySelector(".move-feedback-ring")?.remove();
    }, duration);
  }

  function clearMoveFeedback() {
    moveFeedback = null;
    window.clearTimeout(moveFeedbackTimer);
    moveFeedbackTimer = null;
  }

  function showBoardCelebration(threatState) {
    const celebration = document.createElement("div");
    celebration.className = `board-celebration ${threatState === "checkmate" ? "mate" : ""}`;
    celebration.innerHTML = `
      <span class="celebration-check" aria-hidden="true">✓</span>
      <strong>挑战完成</strong>
      <small>${threatState === "checkmate" ? "将死！黑王无路可逃" : threatState === "check" ? "将军！黑王必须回应" : "思路正确，漂亮完成"}</small>
    `;
    boardEl.appendChild(celebration);
    window.setTimeout(() => celebration.classList.add("leaving"), 2100);
    window.setTimeout(() => celebration.remove(), 2550);
  }

  function animateThreatenedKing(threatState) {
    const board = state.board;
    const kingSquare = Object.keys(board).find(square => board[square] === "k");
    const kingImage = kingSquare
      ? boardEl.querySelector(`[data-square="${kingSquare}"] .piece`)
      : null;
    if (!kingImage || threatState === "none") return;

    const kingCell = kingImage.closest(".square");
    kingCell.classList.add(threatState === "checkmate" ? "king-mated" : "king-checked");

    if (threatState === "checkmate") {
      kingImage.classList.add("king-shattered");
      ["north-west", "north-east", "south-west", "south-east"].forEach(direction => {
        const fragment = kingImage.cloneNode(true);
        fragment.classList.remove("king-shattered");
        fragment.classList.add("king-fragment", `fragment-${direction}`);
        fragment.setAttribute("aria-hidden", "true");
        kingCell.appendChild(fragment);
      });
    }
  }

  function playCompletionFeedback() {
    const threatState = kingThreatState(state, "b");
    animateThreatenedKing(threatState);
    showBoardCelebration(threatState);
  }

  function startDrag(event, squareName) {
    if (step >= puzzle.steps.length || event.button > 0) return;
    const piece = state.board[squareName];
    if (!piece || pieceColor(piece) !== "w") return;
    const pieceImage = event.currentTarget.querySelector(".piece");
    dragState = {
      pointerId: event.pointerId ?? "mouse",
      from: squareName,
      startX: event.clientX,
      startY: event.clientY,
      active: false,
      pieceImage: pieceImage?.cloneNode(true),
      ghost: null
    };
  }

  function showNativeDragTargets(from) {
    const board = state.board;
    const targets = legalTargets(state, from);
    boardEl.querySelectorAll(".square").forEach(square => {
      const squareName = square.dataset.square;
      square.classList.toggle("selected", squareName === from);
      square.classList.toggle("target", targets.includes(squareName));
      square.classList.toggle("capture", targets.includes(squareName) && Boolean(board[squareName]));
    });
  }

  function startNativeDrag(event, squareName) {
    const piece = state.board[squareName];
    if (step >= puzzle.steps.length || !piece || pieceColor(piece) !== "w") {
      event.preventDefault();
      return;
    }
    nativeDragFrom = squareName;
    nativeDropHandled = false;
    selected = squareName;
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("application/board-square", squareName);
    showNativeDragTargets(squareName);
    document.body.classList.add("is-dragging-piece");
  }

  function dropNativePiece(event, targetSquare) {
    if (!nativeDragFrom) return;
    event.preventDefault();
    nativeDropHandled = true;
    suppressClick = true;
    window.setTimeout(() => { suppressClick = false; }, 0);
    choose(targetSquare);
  }

  function finishNativeDrag() {
    if (!nativeDragFrom) return;
    nativeDragFrom = null;
    document.body.classList.remove("is-dragging-piece");
    if (!nativeDropHandled) {
      selected = null;
      render();
    }
    nativeDropHandled = false;
  }

  function positionDragGhost(event) {
    if (!dragState?.ghost) return;
    dragState.ghost.style.transform = `translate(${event.clientX}px, ${event.clientY}px) translate(-50%, -50%)`;
  }

  function moveDrag(event) {
    if (!dragState || (event.pointerId != null && event.pointerId !== dragState.pointerId)) return;
    const distance = Math.hypot(event.clientX - dragState.startX, event.clientY - dragState.startY);
    if (!dragState.active && distance < 7) return;

    event.preventDefault();
    if (!dragState.active) {
      dragState.active = true;
      selected = dragState.from;
      const ghost = document.createElement("div");
      const squareSize = boardEl.getBoundingClientRect().width / 8;
      ghost.className = "drag-ghost";
      ghost.style.width = `${squareSize}px`;
      ghost.style.height = `${squareSize}px`;
      if (dragState.pieceImage) ghost.appendChild(dragState.pieceImage);
      document.body.appendChild(ghost);
      dragState.ghost = ghost;
      document.body.classList.add("is-dragging-piece");
      render();
    }
    positionDragGhost(event);
  }

  function finishDrag(event, cancelled = false) {
    if (!dragState || (event.pointerId != null && event.pointerId !== dragState.pointerId)) return;
    const finishedDrag = dragState;
    dragState = null;
    finishedDrag.ghost?.remove();
    document.body.classList.remove("is-dragging-piece");

    if (!finishedDrag.active) return;
    event.preventDefault();
    suppressClick = true;
    window.setTimeout(() => { suppressClick = false; }, 0);

    if (cancelled) {
      selected = null;
      render();
      return;
    }

    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest(".square");
    const targetSquare = target?.dataset.square;
    if (!targetSquare || targetSquare === finishedDrag.from) {
      selected = null;
      render();
      return;
    }
    choose(targetSquare);
  }

  document.addEventListener("pointermove", moveDrag, { passive: false });
  document.addEventListener("pointerup", event => finishDrag(event));
  document.addEventListener("pointercancel", event => finishDrag(event, true));
  document.addEventListener("mousemove", moveDrag, { passive: false });
  document.addEventListener("mouseup", event => finishDrag(event));

  function choose(squareName) {
    if (step >= puzzle.steps.length) return;
    // 对手正在回应（异步窗口）：忽略用户操作，避免与 render 竞争。
    if (awaitingOpponent) return;
    const board = state.board;
    const piece = board[squareName];
    if (!selected) {
      if (!piece || piece === piece.toLowerCase()) {
        setStatus("error", "先选白棋", "点击你想移动的白色棋子，再点击目标格。");
        return;
      }
      clearMoveFeedback();
      selected = squareName;
      render();
      return;
    }

    if (piece && piece === piece.toUpperCase()) {
      clearMoveFeedback();
      selected = squareName;
      render();
      return;
    }

    if (!legalTargets(state, selected).includes(squareName)) {
      markMoveFeedback(selected, "wrong");
      setStatus("error", "这里不能走", `${PIECE_NAMES[board[selected]]}不能走到 ${squareName}。请选择棋盘上标出的合法目标格。`);
      render();
      return;
    }

    const fromSquare = selected;
    const move = fromSquare + squareName;
    const current = puzzle.steps[step];
    selected = null;
    if (move !== current.move) {
      // 先查 alternatives：合理但非最优的候选着，讲解但不推进进度。
      const alt = (current.alternatives || []).find(candidate => candidate.move === move);
      if (alt) {
        markMoveFeedback(fromSquare, "alt");
        setStatus("alt", "这步也合理", alt.note);
        render();
        return;
      }
      markMoveFeedback(fromSquare, "wrong");
      const message = puzzle.errors[move] || puzzle.genericError;
      setStatus("error", "想法还差一步", message);
      render();
      return;
    }

    state = applyMove(state, move);
    lastMove = move;
    step += 1;
    markMoveFeedback(squareName, "correct", current.opponent ? 680 : 1150);

    if (current.opponent) {
      // 进入对手回应窗口：阻止用户在此期间操作（避免与异步 render 竞争）。
      awaitingOpponent = true;
      setStatus("", "方向正确", current.note || "对手正在回应……");
      render();
      const opponentMove = current.opponent;
      const opponentFrom = opponentMove.slice(0, 2);
      const opponentTo = opponentMove.slice(2, 4);
      opponentTimer = window.setTimeout(() => {
        opponentTimer = null;
        try {
          // 校验对手回应在当前局面合法，避免数据错误静默腐蚀棋盘。
          if (!legalTargets(state, opponentFrom).includes(opponentTo)) {
            throw new Error(`对手回应 ${opponentMove} 在当前局面不合法`);
          }
          clearMoveFeedback();
          state = applyMove(state, opponentMove);
          lastMove = opponentMove;
          awaitingOpponent = false;
          render();
        } catch (err) {
          // 对手回应失败：解锁状态并明确提示，绝不让用户卡在无反馈的空窗。
          awaitingOpponent = false;
          setStatus("error", "对手回应异常", "对手的自动回未能完成。可以点「反馈问题」附上当前局面报告，或点「重新挑战」重试。");
          console.error("opponent reply failed:", err);
          render();
        }
      }, 700);
    } else if (step >= puzzle.steps.length) {
      setStatus("success", "挑战完成", puzzle.success);
      render();
      window.setTimeout(playCompletionFeedback, 80);
    } else {
      setStatus("", "继续", current.note || puzzle.goal);
      render();
    }
  }

  // 构造棋盘旁「反馈问题」按钮的 mailto 链接，附带当前实时局面等诊断信息。
  function composeReport() {
    const titleEl = document.querySelector("main h1");
    const title = titleEl ? titleEl.textContent.trim() : "";
    const eyebrowEl = root.querySelector(".eyebrow");
    const dateLabel = eyebrowEl ? eyebrowEl.textContent.split("·")[0].trim() : "";
    // 轮次推断：用户永远执白。若 lastMove 等于"用户上一步应走的着法"，说明对手尚未回应，轮到黑；
    // 若 lastMove 等于"对手的回应着法"，则轮到白。否则默认白。
    const prevUserMove = step > 0 ? puzzle.steps[step - 1]?.move : null;
    const prevOpponentMove = step > 0 ? puzzle.steps[step - 1]?.opponent : null;
    let sideToMove = "w";
    if (lastMove && lastMove === prevUserMove && lastMove !== prevOpponentMove) sideToMove = "b";
    else if (lastMove && lastMove === prevOpponentMove) sideToMove = "w";
    return buildReportMailto({
      title,
      dateLabel,
      slug: id,
      step,
      totalSteps: puzzle.steps.length,
      lastMove,
      startFen: puzzle.fen,
      currentFen: toFen(state, sideToMove),
      sideToMove,
      includeLiveState: true,
      url: location.href,
      userAgent: navigator.userAgent,
    });
  }

  function reset() {
    // 取消任何挂起的对手回应定时器，并解锁操作窗口。
    if (opponentTimer !== null) {
      window.clearTimeout(opponentTimer);
      opponentTimer = null;
    }
    awaitingOpponent = false;
    state = parseFen(puzzle.fen);
    selected = null;
    step = 0;
    lastMove = null;
    clearMoveFeedback();
    answer.classList.remove("show");
    setStatus("", "轮到你了", puzzle.goal);
    render();
  }

  hintBtn.addEventListener("click", () => {
    const expected = puzzle.steps[step]?.move;
    if (!expected) return;
    setStatus("", "给你一点方向", `观察 ${expected.slice(0, 2)} 上的棋子：它能不能前往一个同时制造威胁、又改善位置的格子？`);
  });

  resetBtn.addEventListener("click", reset);

  // 棋盘旁「反馈问题」按钮：附带当前实时局面等诊断信息。
  if (reportBtn) {
    reportBtn.addEventListener("click", () => {
      window.location.href = composeReport();
    });
  }

  // 预制答案（降级用）：先按 suggestions key 匹配，再按用户问题里的关键词匹配 quick 字典，
  // 都不中就用 defaultAnswer。
  function prefabAnswer(question, preferredKey = "") {
    const compact = question.toLowerCase().replace(/[？?，,。\s]/g, "");
    let response = puzzle.quick[preferredKey] || puzzle.defaultAnswer;
    if (!preferredKey) {
      for (const [key, value] of Object.entries(puzzle.quick)) {
        if (compact.includes(key)) { response = value; break; }
      }
    }
    return response;
  }

  function renderCoachReply(text, { fallback } = {}) {
    const prefix = fallback
      ? `<small class="ai-fallback-note">AI 暂时不可用，已显示预设参考：</small>`
      : "";
    answer.innerHTML = `${prefix}<strong>棋局教练：</strong>${text}`;
    enhanceNotation(answer);
    answer.classList.add("show");
  }

  async function showCoachAnswer(question, preferredKey = "") {
    if (!question && !preferredKey) {
      renderCoachReply(prefabAnswer("", preferredKey));
      return;
    }
    const workerUrl = coachWorkerUrl();
    // 未配置 Worker：直接走预制答案（现状行为）。
    if (!workerUrl) {
      renderCoachReply(prefabAnswer(question, preferredKey));
      return;
    }
    // 配置了 Worker：显示 loading，调 AI，失败降级。
    answer.innerHTML = `<strong>棋局教练：</strong><span class="ai-loading">正在思考…</span>`;
    answer.classList.add("show", "loading");
    try {
      const titleEl = document.querySelector("main h1");
      // 点快捷问题按钮时 question 可能为空，用 quick 字典里对应的 label 作为问题文本。
      const questionForAI = question || (preferredKey ? puzzle.quick[preferredKey] : "") || "请讲讲这一步的思路。";
      const messages = buildCoachMessages(questionForAI, {
        title: titleEl ? titleEl.textContent.trim() : "",
        goal: puzzle.goal,
        startFen: puzzle.fen,
        currentFen: toFen(state, "w"),
        step,
        totalSteps: puzzle.steps.length,
      });
      const reply = await askCoachAI(workerUrl, messages, coachUserKey());
      renderCoachReply(reply);
    } catch (err) {
      console.error("AI coach failed, falling back:", err);
      renderCoachReply(prefabAnswer(question, preferredKey), { fallback: true });
    } finally {
      answer.classList.remove("loading");
    }
  }

  askBtn.addEventListener("click", () => {
    showCoachAnswer(askInput.value.trim());
  });

  reset();

  // Once piece PNGs have decoded, swap any placeholders for real artwork.
  preloadPieces().then(() => render());
}

document.querySelectorAll("[data-puzzle]").forEach(setupChallenge);
enhanceNotation(document.querySelector("main"));

// 页脚「反馈问题」链接：不在 challenge 闭包内，只能附带基础信息（不含实时局面）。
document.querySelectorAll("[data-footer-report]").forEach(link => {
  link.addEventListener("click", event => {
    event.preventDefault();
    const challengeRoot = document.querySelector("[data-puzzle]");
    const slug = challengeRoot ? challengeRoot.dataset.puzzle : "";
    const titleEl = document.querySelector("main h1");
    const title = titleEl ? titleEl.textContent.trim() : "";
    const eyebrowEl = challengeRoot ? challengeRoot.querySelector(".eyebrow") : null;
    const dateLabel = eyebrowEl ? eyebrowEl.textContent.split("·")[0].trim() : "";
    window.location.href = buildReportMailto({
      title, dateLabel, slug,
      includeLiveState: false,
      url: location.href,
      userAgent: navigator.userAgent,
    });
  });
});

// ---- AI 设置面板（全局）--------------------------------------------------
// 让用户填自己的 Worker URL 和智谱 Key（存 localStorage），覆盖站点默认配置。
// 默认折叠，不影响普通访客。触发器：[data-coach-settings-toggle]。
document.querySelectorAll("[data-coach-settings-toggle]").forEach(toggle => {
  toggle.addEventListener("click", () => {
    const panel = document.querySelector("[data-coach-settings-panel]");
    if (!panel) return;
    const open = panel.classList.toggle("open");
    toggle.setAttribute("aria-expanded", String(open));
    if (open) {
      const urlInput = panel.querySelector("[data-coach-url]");
      const keyInput = panel.querySelector("[data-coach-key]");
      if (urlInput) urlInput.value = localStorage.getItem("chessCoachWorkerUrl") || "";
      if (keyInput) keyInput.value = localStorage.getItem("chessCoachUserKey") || "";
    }
  });
});

document.querySelectorAll("[data-coach-settings-panel]").forEach(panel => {
  const saveBtn = panel.querySelector("[data-coach-save]");
  if (!saveBtn) return;
  saveBtn.addEventListener("click", () => {
    const url = panel.querySelector("[data-coach-url]")?.value.trim() || "";
    const key = panel.querySelector("[data-coach-key]")?.value.trim() || "";
    if (url) localStorage.setItem("chessCoachWorkerUrl", url);
    else localStorage.removeItem("chessCoachWorkerUrl");
    if (key) localStorage.setItem("chessCoachUserKey", key);
    else localStorage.removeItem("chessCoachUserKey");
    const note = panel.querySelector("[data-coach-saved]");
    if (note) {
      note.textContent = "已保存。";
      window.setTimeout(() => { note.textContent = ""; }, 2000);
    }
  });
});

// ---- 赞赏支持（全局）----------------------------------------------------
// 页脚「请我喝杯咖啡 ￥4.9」：支付宝优先智能唤起 alipays://，唤起失败或桌面端
// 兜底弹二维码；微信始终弹二维码（微信无 URL scheme 直接付款）。
// 模态框按需构建，ESC / 点遮罩 / × 关闭。二维码在页面就绪后预加载，
// 模态框打开时瞬间显示。
const DONATE_ALIPAY_URL = "https://qr.alipay.com/fkx16432isyyhmx9ttwpi79";
const DONATE_ALIPAY_SCHEME = `alipays://platformapi/startapp?saId=10000007&qrcode=${encodeURIComponent(DONATE_ALIPAY_URL)}`;
const DONATE_QR = {
  alipay: "assets/donate/alipay-qr.png",
  wechat: "assets/donate/wechat-qr.png",
};
const DONATE_LABEL = { alipay: "支付宝", wechat: "微信" };
const DONATE_HINT = {
  alipay: "长按或保存二维码，打开支付宝扫一扫",
  wechat: "长按或保存二维码，打开微信扫一扫",
};

function donateIsMobile() {
  return /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}

// 预加载两张二维码到浏览器缓存，避免首次打开模态框时的"反应一下"。
[DONATE_QR.alipay, DONATE_QR.wechat].forEach(src => {
  const img = new Image();
  img.src = src;
});

function closeDonateModal() {
  const overlay = document.querySelector("[data-donate-overlay]");
  if (!overlay) return;
  overlay.remove();
  document.removeEventListener("keydown", donateKeydown);
}

function donateKeydown(event) {
  if (event.key === "Escape") closeDonateModal();
}

function openDonateModal(channel) {
  // 同一时刻只保留一个模态框
  closeDonateModal();

  const overlay = document.createElement("div");
  overlay.className = "donate-modal-overlay";
  overlay.dataset.donateOverlay = "";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-label", `${DONATE_LABEL[channel]}赞赏二维码`);

  const modal = document.createElement("div");
  modal.className = "donate-modal";
  modal.innerHTML = `
    <button type="button" class="donate-close" aria-label="关闭">×</button>
    <h3>请我喝杯咖啡 ￥4.9</h3>
    <img class="donate-qr" src="${DONATE_QR[channel]}" alt="${DONATE_LABEL[channel]}收款码">
    <small>${DONATE_HINT[channel]}</small>`;

  overlay.appendChild(modal);
  overlay.addEventListener("click", event => {
    if (event.target === overlay) closeDonateModal();
  });
  modal.querySelector(".donate-close").addEventListener("click", closeDonateModal);

  document.body.appendChild(overlay);
  document.addEventListener("keydown", donateKeydown);
}

document.querySelectorAll("[data-donate-alipay]").forEach(btn => {
  btn.addEventListener("click", () => {
    if (donateIsMobile()) {
      // 记录可见性：1.5s 内未切走说明 alipays:// 唤起失败 → 兜底弹二维码。
      const before = document.visibilityState;
      window.location.href = DONATE_ALIPAY_SCHEME;
      window.setTimeout(() => {
        if (document.visibilityState === before) openDonateModal("alipay");
      }, 1500);
    } else {
      // 桌面端无 alipays scheme，直接弹二维码。
      openDonateModal("alipay");
    }
  });
});

document.querySelectorAll("[data-donate-wechat]").forEach(btn => {
  btn.addEventListener("click", () => openDonateModal("wechat"));
});
