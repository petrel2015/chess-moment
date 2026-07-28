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

// Each source PNG uses a different amount of transparent canvas. These values
// describe the visible artwork inside its 512 × 512 source image so every
// piece can be optically centered and normalized to the same visual footprint.
const PIECE_BOUNDS = {
  bb: [311, 67, 201, 313],
  bk: [336, 81, 176, 428],
  bn: [0, 63, 386, 316],
  bp: [0, 108, 195, 274],
  bq: [0, 161, 512, 346],
  br: [0, 199, 206, 305],
  wb: [195, 0, 270, 389],
  wk: [219, 20, 221, 492],
  wn: [127, 75, 279, 304],
  wp: [80, 89, 218, 282],
  wq: [87, 116, 352, 341],
  wr: [79, 139, 236, 321]
};

function pieceAsset(piece) {
  const color = piece === piece.toUpperCase() ? "w" : "b";
  return `assets/pieces/${color}${piece.toLowerCase()}.png`;
}

function normalizePieceArtwork(element, piece) {
  const color = piece === piece.toUpperCase() ? "w" : "b";
  const key = color + piece.toLowerCase();
  const [x, y, width, height] = PIECE_BOUNDS[key];
  const scale = 0.82 * 512 / Math.max(width, height);
  const visibleCenterX = x + width / 2;
  const visibleCenterY = y + height / 2;

  element.style.setProperty("--piece-canvas-size", `${scale * 100}%`);
  element.style.setProperty("--piece-left", `${50 - scale * visibleCenterX / 512 * 100}%`);
  element.style.setProperty("--piece-top", `${50 - scale * visibleCenterY / 512 * 100}%`);
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

function parseFen(fen) {
  const board = {};
  const rows = fen.split(" ")[0].split("/");
  rows.forEach((row, rowIndex) => {
    let file = 0;
    for (const token of row) {
      if (/\d/.test(token)) file += Number(token);
      else {
        const square = "abcdefgh"[file] + (8 - rowIndex);
        board[square] = token;
        file += 1;
      }
    }
  });
  return board;
}

function applyMove(board, move) {
  const from = move.slice(0, 2);
  const to = move.slice(2, 4);
  board[to] = board[from];
  delete board[from];
}

function pieceColor(piece) {
  return piece === piece.toUpperCase() ? "w" : "b";
}

function squareAt(fileIndex, rank) {
  if (fileIndex < 0 || fileIndex > 7 || rank < 1 || rank > 8) return null;
  return "abcdefgh"[fileIndex] + rank;
}

function addStepMove(board, moves, color, fileIndex, rank) {
  const target = squareAt(fileIndex, rank);
  if (!target) return false;
  const occupant = board[target];
  if (!occupant) {
    moves.push(target);
    return true;
  }
  if (pieceColor(occupant) !== color) moves.push(target);
  return false;
}

function pseudoLegalTargets(board, from, attacksOnly = false) {
  const piece = board[from];
  if (!piece) return [];
  const color = pieceColor(piece);
  const type = piece.toLowerCase();
  const fileIndex = "abcdefgh".indexOf(from[0]);
  const rank = Number(from[1]);
  const moves = [];

  if (type === "p") {
    const direction = color === "w" ? 1 : -1;
    for (const fileDelta of [-1, 1]) {
      const target = squareAt(fileIndex + fileDelta, rank + direction);
      if (target && (attacksOnly || (board[target] && pieceColor(board[target]) !== color))) {
        moves.push(target);
      }
    }
    if (attacksOnly) return moves;

    const forward = squareAt(fileIndex, rank + direction);
    if (forward && !board[forward]) {
      moves.push(forward);
      const startRank = color === "w" ? 2 : 7;
      const doubleForward = squareAt(fileIndex, rank + direction * 2);
      if (rank === startRank && doubleForward && !board[doubleForward]) moves.push(doubleForward);
    }
    return moves;
  }

  const jumpDirections = type === "n"
    ? [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]]
    : [[1, 1], [1, 0], [1, -1], [0, -1], [-1, -1], [-1, 0], [-1, 1], [0, 1]];

  if (type === "n" || type === "k") {
    jumpDirections.forEach(([fileDelta, rankDelta]) => {
      addStepMove(board, moves, color, fileIndex + fileDelta, rank + rankDelta);
    });
    return moves;
  }

  const directions = [];
  if (type === "r" || type === "q") directions.push([1, 0], [-1, 0], [0, 1], [0, -1]);
  if (type === "b" || type === "q") directions.push([1, 1], [1, -1], [-1, 1], [-1, -1]);
  directions.forEach(([fileDelta, rankDelta]) => {
    let distance = 1;
    while (addStepMove(
      board,
      moves,
      color,
      fileIndex + fileDelta * distance,
      rank + rankDelta * distance
    )) distance += 1;
  });
  return moves;
}

function isSquareAttacked(board, square, attackingColor) {
  return Object.keys(board).some(from => {
    const piece = board[from];
    return pieceColor(piece) === attackingColor
      && pseudoLegalTargets(board, from, true).includes(square);
  });
}

function legalTargets(board, from) {
  const piece = board[from];
  if (!piece) return [];
  const color = pieceColor(piece);
  const enemyColor = color === "w" ? "b" : "w";

  return pseudoLegalTargets(board, from).filter(to => {
    const nextBoard = { ...board };
    applyMove(nextBoard, from + to);
    const kingSquare = Object.keys(nextBoard).find(square => nextBoard[square] === (color === "w" ? "K" : "k"));
    return !kingSquare || !isSquareAttacked(nextBoard, kingSquare, enemyColor);
  });
}

function kingThreatState(board, color) {
  const king = color === "w" ? "K" : "k";
  const kingSquare = Object.keys(board).find(square => board[square] === king);
  if (!kingSquare) return "none";
  const enemyColor = color === "w" ? "b" : "w";
  if (!isSquareAttacked(board, kingSquare, enemyColor)) return "none";

  const canEscape = Object.keys(board).some(square => {
    return pieceColor(board[square]) === color && legalTargets(board, square).length > 0;
  });
  return canEscape ? "check" : "checkmate";
}

const MATERIAL_VALUES = { q: 9, r: 5, b: 3, n: 3, p: 1, k: 0 };
const MATERIAL_LABELS = { q: "后", r: "车", b: "象", n: "马", p: "兵", k: "王" };
const MATERIAL_ORDER = ["q", "r", "b", "n", "p", "k"];

function materialFor(board, color) {
  const counts = {};
  let score = 0;
  Object.values(board).forEach(piece => {
    if (pieceColor(piece) !== color) return;
    const type = piece.toLowerCase();
    counts[type] = (counts[type] || 0) + 1;
    score += MATERIAL_VALUES[type];
  });
  const pieces = MATERIAL_ORDER
    .filter(type => counts[type])
    .map(type => `${MATERIAL_LABELS[type]}×${counts[type]}`)
    .join(" · ");
  return { pieces: pieces || "无棋子", score };
}

function setupChallenge(root) {
  const id = root.dataset.puzzle;
  const puzzle = PUZZLES[id];
  if (!puzzle) return;

  let board = parseFen(puzzle.fen);
  let selected = null;
  let step = 0;
  let lastMove = null;
  let moveFeedback = null;
  let moveFeedbackTimer = null;
  let dragState = null;
  let suppressClick = false;
  let nativeDragFrom = null;
  let nativeDropHandled = false;
  const boardEl = root.querySelector(".board");
  const status = root.querySelector(".status");
  const statusLabel = status.querySelector(".status-label");
  const statusText = status.querySelector("p");
  const resetBtn = root.querySelector("[data-reset]");
  const hintBtn = root.querySelector("[data-hint]");
  const askBtn = root.querySelector("[data-ask]");
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
    const whiteMaterial = materialFor(board, "w");
    const blackMaterial = materialFor(board, "b");
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
    const availableTargets = selected ? legalTargets(board, selected) : [];
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
          const piece = document.createElement("img");
          piece.className = "piece";
          piece.src = pieceAsset(board[squareName]);
          piece.alt = "";
          piece.draggable = false;
          normalizePieceArtwork(piece, board[squareName]);
          square.appendChild(piece);
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
    const threatState = kingThreatState(board, "b");
    animateThreatenedKing(threatState);
    showBoardCelebration(threatState);
  }

  function startDrag(event, squareName) {
    if (step >= puzzle.steps.length || event.button > 0) return;
    const piece = board[squareName];
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
    const targets = legalTargets(board, from);
    boardEl.querySelectorAll(".square").forEach(square => {
      const squareName = square.dataset.square;
      square.classList.toggle("selected", squareName === from);
      square.classList.toggle("target", targets.includes(squareName));
      square.classList.toggle("capture", targets.includes(squareName) && Boolean(board[squareName]));
    });
  }

  function startNativeDrag(event, squareName) {
    const piece = board[squareName];
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

    if (!legalTargets(board, selected).includes(squareName)) {
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
      markMoveFeedback(fromSquare, "wrong");
      const message = puzzle.errors[move] || puzzle.genericError;
      setStatus("error", "想法还差一步", message);
      render();
      return;
    }

    applyMove(board, move);
    lastMove = move;
    step += 1;
    markMoveFeedback(squareName, "correct", current.opponent ? 680 : 1150);

    if (current.opponent) {
      setStatus("", "方向正确", current.note || "对手正在回应……");
      render();
      window.setTimeout(() => {
        clearMoveFeedback();
        applyMove(board, current.opponent);
        lastMove = current.opponent;
        render();
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

  function reset() {
    board = parseFen(puzzle.fen);
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

  function showCoachAnswer(question, preferredKey = "") {
    const compact = question.toLowerCase().replace(/[？?，,。\s]/g, "");
    let response = puzzle.quick[preferredKey] || puzzle.defaultAnswer;
    if (!preferredKey) {
      for (const [key, value] of Object.entries(puzzle.quick)) {
        if (compact.includes(key)) { response = value; break; }
      }
    }
    answer.innerHTML = `<strong>棋局教练：</strong>${response}`;
    enhanceNotation(answer);
    answer.classList.add("show");
  }

  askBtn.addEventListener("click", () => {
    showCoachAnswer(askInput.value.trim());
  });

  reset();
}

document.querySelectorAll("[data-puzzle]").forEach(setupChallenge);
enhanceNotation(document.querySelector("main"));
