const PIECE_NAMES = {
  K: "白王", Q: "白后", R: "白车", B: "白象", N: "白马", P: "白兵",
  k: "黑王", q: "黑后", r: "黑车", b: "黑象", n: "黑马", p: "黑兵"
};

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

const PUZZLES = {
  corridor: {
    fen: "6k1/5ppp/8/8/8/8/8/4R1K1 w - - 0 1",
    goal: "白方走。找到一步将杀。",
    steps: [{ move: "e1e8" }],
    success: "Re8#。黑王被自己的三枚兵关在第八横线，车一落到 e8，三个逃生格都不存在了。",
    defaultAnswer: "车走到 e8 后沿第八横线将军。黑王不能向前，因为 f7、g7、h7 都被自己的兵占着；也没有棋子能挡在车和王之间。因此这不是普通将军，而是立即将杀。",
    errors: {
      e1e7: "Re7 看起来很积极，但它没有将军。黑方获得一整步，可以给王腾出逃生格。后排杀王讲究的是立即封口。",
      e1a1: "横向调车没有制造直接威胁。先问自己：黑王现在唯一的弱点，是不是整条第八横线？"
    },
    genericError: "这步没有形成将军，黑方就有时间推动兵给王开一扇窗。请寻找一条能让车直接攻击黑王的开放横线。",
    quick: {
      "为什么结束": "因为 Re8 已经是将杀：王无处可走、无法吃车，也没有棋子能挡住这次贴着横线的攻击。规则上棋局立刻结束。",
      "为什么不能": "关键不只是把车放活跃，而是不给黑方任何喘息。非将军着通常允许黑方走 ...h6 或 ...g6，为王制造逃生格。"
    }
  },
  arabian: {
    fen: "7k/7p/5N2/8/8/8/8/6RK w - - 0 1",
    goal: "白方走。用车和马完成将杀。",
    steps: [{ move: "g1g8" }],
    success: "Rg8#。车负责将军，f6 的马守住 g8 和 h7 周边的关键格。两枚棋子配合得像一把锁。",
    defaultAnswer: "车到 g8 直接攻击 h8 的王。黑王不能吃掉车，因为 f6 的马会保护 g8；h7 又被自己的兵堵住，所以没有合法逃路。",
    errors: {},
    genericError: "先别急着移动马。马已经在保护一个非常关键的格子；想想车能不能借用这层保护，贴近黑王将军。",
    quick: {
      "马": "马在这里不是主攻手，而是保镖。它保护 g8，让黑王不能吃掉前来将军的白车。",
      "为什么结束": "Rg8 后黑王处于将军，既不能逃、不能吃车，也无法挡棋，所以立即结束。"
    }
  },
  fork: {
    fen: "2q3k1/8/8/5N2/8/8/8/6K1 w - - 0 1",
    goal: "白方走。找到同时攻击王和后的落点。",
    steps: [{ move: "f5e7" }],
    success: "Ne7+！马在 e7 将军，同时攻击 c8 的黑后。黑方必须先应对将军，白方下一步就能吃后。",
    defaultAnswer: "马到 e7 后同时攻击 g8 的王和 c8 的后。因为将军具有最高优先级，黑方必须先救王，无法同时保住后。",
    errors: {},
    genericError: "双重攻击要找的不是离目标最近的格子，而是一个能同时覆盖两个目标的格子。数一数马从哪里能同时跳到 g8 与 c8。",
    quick: {
      "为什么是e7": "从 e7 出发，马恰好同时控制 g8 和 c8。一个目标是王，一个目标是后；将军迫使黑方先处理王。",
      "黑后": "黑后此刻还没被吃，但它已经无法被兼顾。黑方应对完将军后，白马下一步就能 Nxc8。"
    }
  },
  philidor: {
    fen: "rnbqkbnr/ppp2ppp/3p4/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 0 3",
    goal: "白方走两步：立即挑战中心，并用子力收回。",
    steps: [
      { move: "d2d4", opponent: "e5d4", note: "黑方接受挑战，...exd4。现在该用哪枚已经发展的棋子收回中心兵？" },
      { move: "f3d4" }
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
    }
  }
};

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

function setupChallenge(root) {
  const id = root.dataset.puzzle;
  const puzzle = PUZZLES[id];
  if (!puzzle) return;

  let board = parseFen(puzzle.fen);
  let selected = null;
  let step = 0;
  let lastMove = null;
  const boardEl = root.querySelector(".board");
  const status = root.querySelector(".status");
  const statusLabel = status.querySelector(".status-label");
  const statusText = status.querySelector("p");
  const resetBtn = root.querySelector("[data-reset]");
  const hintBtn = root.querySelector("[data-hint]");
  const askBtn = root.querySelector("[data-ask]");
  const askInput = root.querySelector("textarea");
  const answer = root.querySelector(".ai-answer");

  function render() {
    boardEl.innerHTML = "";
    for (let rank = 8; rank >= 1; rank--) {
      for (let fileIndex = 0; fileIndex < 8; fileIndex++) {
        const file = "abcdefgh"[fileIndex];
        const squareName = file + rank;
        const square = document.createElement("button");
        square.type = "button";
        square.className = "square" + ((fileIndex + rank) % 2 ? " dark" : "");
        square.dataset.square = squareName;
        square.setAttribute("aria-label", squareName + (board[squareName] ? " " + PIECE_NAMES[board[squareName]] : " 空格"));
        if (selected === squareName) square.classList.add("selected");
        if (selected && squareName !== selected) square.classList.add("target");
        if (lastMove && lastMove.includes(squareName)) square.classList.add("last-move");

        if (board[squareName]) {
          const piece = document.createElement("img");
          piece.className = "piece";
          piece.src = pieceAsset(board[squareName]);
          piece.alt = "";
          piece.draggable = false;
          normalizePieceArtwork(piece, board[squareName]);
          square.appendChild(piece);
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
        square.addEventListener("click", () => choose(squareName));
        boardEl.appendChild(square);
      }
    }
    root.querySelectorAll(".progress span").forEach((dot, i) => dot.classList.toggle("done", i < step));
  }

  function setStatus(kind, label, text) {
    status.className = "status" + (kind ? " " + kind : "");
    statusLabel.textContent = label;
    statusText.textContent = text;
  }

  function choose(squareName) {
    if (step >= puzzle.steps.length) return;
    const piece = board[squareName];
    if (!selected) {
      if (!piece || piece === piece.toLowerCase()) {
        setStatus("error", "先选白棋", "点击你想移动的白色棋子，再点击目标格。");
        return;
      }
      selected = squareName;
      render();
      return;
    }

    if (piece && piece === piece.toUpperCase()) {
      selected = squareName;
      render();
      return;
    }

    const move = selected + squareName;
    const current = puzzle.steps[step];
    selected = null;
    if (move !== current.move) {
      const message = puzzle.errors[move] || puzzle.genericError;
      setStatus("error", "想法还差一步", message);
      render();
      return;
    }

    applyMove(board, move);
    lastMove = move;
    step += 1;

    if (current.opponent) {
      setStatus("", "方向正确", current.note || "对手正在回应……");
      render();
      window.setTimeout(() => {
        applyMove(board, current.opponent);
        lastMove = current.opponent;
        render();
      }, 480);
    } else if (step >= puzzle.steps.length) {
      setStatus("success", "挑战完成", puzzle.success);
      render();
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

  askBtn.addEventListener("click", () => {
    const question = askInput.value.trim();
    const compact = question.toLowerCase().replace(/[？?，,。\s]/g, "");
    let response = puzzle.defaultAnswer;
    for (const [key, value] of Object.entries(puzzle.quick)) {
      if (compact.includes(key)) { response = value; break; }
    }
    answer.innerHTML = `<strong>棋局教练：</strong>${response}`;
    answer.classList.add("show");
  });

  reset();
}

document.querySelectorAll("[data-puzzle]").forEach(setupChallenge);
