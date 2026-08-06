// Chess Moment 纯逻辑规则引擎（无 DOM 依赖，可在 Node 与浏览器复用）。
//
// 局面用 state 对象表示：
//   state = { board, castling, enPassant }
//     - board: { e4: "P", ... }，键为格子名 a1~h8，值为棋子字符（大写白、小写黑）
//     - castling: { K, Q, k, q }，布尔，表示对应王车易位权是否仍在
//     - enPassant: 格子名（如 "e3"）或 null，表示当前回合可吃过路兵的目标格
//
// 走法用 UCI 字符串：
//   - 普通走法 4 字符："e2e4"
//   - 兵升变 5 字符：末位 q/r/b/n 指定升变棋子，如 "e7e8q"（升后）、"a2a1r"（升车）
//   - 王车易位用王的 from→to 表示：白方短易位 "e1g1"，长易位 "e1c1"（黑方 e8g8 / e8c8）
//
// 本引擎覆盖：基本走子、王车易位、兵升变、吃过路兵、将军/将死判定，以及
// 「走完之后己方王不能处于被将军状态」的合法性过滤。

export const MATERIAL_VALUES = { q: 9, r: 5, b: 3, n: 3, p: 1, k: 0 };
export const MATERIAL_LABELS = { q: "后", r: "车", b: "象", n: "马", p: "兵", k: "王" };
export const MATERIAL_ORDER = ["q", "r", "b", "n", "p", "k"];

const FILES = "abcdefgh";

export function pieceColor(piece) {
  return piece === piece.toUpperCase() ? "w" : "b";
}

export function parseFen(fen) {
  const board = {};
  const parts = fen.split(" ");
  const rows = parts[0].split("/");
  rows.forEach((row, rowIndex) => {
    let file = 0;
    for (const token of row) {
      if (/\d/.test(token)) {
        file += Number(token);
      } else {
        const square = FILES[file] + (8 - rowIndex);
        board[square] = token;
        file += 1;
      }
    }
  });

  const rights = parts[1] || "-"; // 行棋方 w/b（本引擎不强制使用）
  const castlingField = parts[2] || "-";
  const castling = {
    K: castlingField.includes("K"),
    Q: castlingField.includes("Q"),
    k: castlingField.includes("k"),
    q: castlingField.includes("q"),
  };
  const enPassantField = parts[3] || "-";
  const enPassant = enPassantField && enPassantField !== "-" ? enPassantField : null;

  return { board, castling, enPassant, sideToMove: rights || "w" };
}

function squareAt(fileIndex, rank) {
  if (fileIndex < 0 || fileIndex > 7 || rank < 1 || rank > 8) return null;
  return FILES[fileIndex] + rank;
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

// 生成伪合法目标格（不考虑己方王是否暴露）。attacksOnly=true 时只返回攻击格
// （用于兵的斜吃与受攻击判定，兵的直进不算攻击）。
export function pseudoLegalTargets(state, from, attacksOnly = false) {
  const { board, castling, enPassant } = state;
  const piece = board[from];
  if (!piece) return [];
  const color = pieceColor(piece);
  const type = piece.toLowerCase();
  const fileIndex = FILES.indexOf(from[0]);
  const rank = Number(from[1]);
  const moves = [];

  if (type === "p") {
    const direction = color === "w" ? 1 : -1;
    // 斜走：攻击 / 吃子 / 吃过路兵
    for (const fileDelta of [-1, 1]) {
      const target = squareAt(fileIndex + fileDelta, rank + direction);
      if (!target) continue;
      const occupant = board[target];
      const canCapture = occupant && pieceColor(occupant) !== color;
      const canEnPassant = enPassant && target === enPassant;
      if (attacksOnly) {
        if (canCapture || canEnPassant) moves.push(target);
      } else if (canCapture || canEnPassant) {
        moves.push(target);
      }
    }
    if (attacksOnly) return moves;

    // 直进
    const forward = squareAt(fileIndex, rank + direction);
    if (forward && !board[forward]) {
      moves.push(forward);
      const startRank = color === "w" ? 2 : 7;
      const doubleForward = squareAt(fileIndex, rank + direction * 2);
      if (rank === startRank && doubleForward && !board[doubleForward]) {
        moves.push(doubleForward);
      }
    }
    return moves;
  }

  // 王车易位（仅攻击判定时不生成，避免把易位目标格误判为「被王攻击」）
  if (type === "k" && !attacksOnly) {
    addCastlingTargets(state, from, color, moves);
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
      rank + rankDelta * distance,
    )) distance += 1;
  });
  return moves;
}

// 王车易位目标生成。条件：有易位权、王与车间无子、王当前/经过/到达格未被攻击。
function addCastlingTargets(state, from, color, moves) {
  const { board, castling } = state;
  const enemyColor = color === "w" ? "b" : "w";
  const rank = color === "w" ? 1 : 8;
  if (from !== FILES[4] + rank) return; // 王必须在原始格
  if (isSquareAttacked(state, from, enemyColor)) return; // 被将军时不能易位

  const kingSide = color === "w" ? "K" : "k";
  const queenSide = color === "w" ? "Q" : "q";

  // 短易位：王 e->g，车 h->f，f/g 空
  if (castling[kingSide]) {
    const fSq = FILES[5] + rank;
    const gSq = FILES[6] + rank;
    const rookSq = FILES[7] + rank;
    if (!board[fSq] && !board[gSq] && board[rookSq]?.toLowerCase() === "r"
      && pieceColor(board[rookSq]) === color) {
      if (!isSquareAttacked(state, fSq, enemyColor)
        && !isSquareAttacked(state, gSq, enemyColor)) {
        moves.push(gSq);
      }
    }
  }
  // 长易位：王 e->c，车 a->d，b/c/d 空
  if (castling[queenSide]) {
    const bSq = FILES[1] + rank;
    const cSq = FILES[2] + rank;
    const dSq = FILES[3] + rank;
    const rookSq = FILES[0] + rank;
    if (!board[bSq] && !board[cSq] && !board[dSq] && board[rookSq]?.toLowerCase() === "r"
      && pieceColor(board[rookSq]) === color) {
      if (!isSquareAttacked(state, cSq, enemyColor)
        && !isSquareAttacked(state, dSq, enemyColor)) {
        moves.push(cSq);
      }
    }
  }
}

export function isSquareAttacked(state, square, attackingColor) {
  const { board } = state;
  return Object.keys(board).some(from => {
    const piece = board[from];
    return pieceColor(piece) === attackingColor
      && pseudoLegalTargets(state, from, true).includes(square);
  });
}

// 执行一步走法，返回新的 state（不修改入参）。处理升变、吃过路兵、王车易位、
// 易位权与吃过路兵目标的维护。
export function applyMove(state, move) {
  const next = {
    board: { ...state.board },
    castling: { ...state.castling },
    enPassant: null,
  };
  const board = next.board;
  const from = move.slice(0, 2);
  const to = move.slice(2, 4);
  const promotion = move[4];
  const piece = board[from];
  const color = pieceColor(piece);
  const type = piece.toLowerCase();

  // 吃过路兵：兵斜走到 enPassant 格，被吃的兵在落点同 file、起手方同 rank
  if (type === "p" && state.enPassant && to === state.enPassant && !board[to]) {
    const capturedPawnSq = to[0] + from[1];
    delete board[capturedPawnSq];
  }

  // 搬动棋子
  delete board[from];
  let landingPiece = piece;
  // 兵升变
  if (type === "p") {
    const lastRank = color === "w" ? 8 : 1;
    if (Number(to[1]) === lastRank) {
      const promoType = promotion || "q"; // 未指定则默认升后（向后兼容）
      landingPiece = color === "w" ? promoType.toUpperCase() : promoType.toLowerCase();
    }
  }
  board[to] = landingPiece;

  // 王车易位：王横移两格时同步搬车
  if (type === "k" && Math.abs(FILES.indexOf(to[0]) - FILES.indexOf(from[0])) === 2) {
    const rank = from[1];
    if (to[0] === "g") {
      // 短易位：h->f
      const rookFrom = FILES[7] + rank;
      const rookTo = FILES[5] + rank;
      board[rookTo] = board[rookFrom];
      delete board[rookFrom];
    } else if (to[0] === "c") {
      // 长易位：a->d
      const rookFrom = FILES[0] + rank;
      const rookTo = FILES[3] + rank;
      board[rookTo] = board[rookFrom];
      delete board[rookFrom];
    }
  }

  // 维护易位权：王动则该方全失；车从原始格移走或被吃则对应侧失。
  if (type === "k") {
    if (color === "w") { next.castling.K = false; next.castling.Q = false; }
    else { next.castling.k = false; next.castling.q = false; }
  }
  // 任一原始车格在本步被「离开」或「被吃」（from 或 to 命中），对应权清除。
  const touched = new Set([from, to]);
  if (touched.has(FILES[7] + "1")) next.castling.K = false;   // 白 h1 车
  if (touched.has(FILES[0] + "1")) next.castling.Q = false;   // 白 a1 车
  if (touched.has(FILES[7] + "8")) next.castling.k = false;   // 黑 h8 车
  if (touched.has(FILES[0] + "8")) next.castling.q = false;   // 黑 a8 车

  // 维护吃过路兵目标：兵双步前进时，设置路过格
  if (type === "p" && Math.abs(Number(to[1]) - Number(from[1])) === 2) {
    const passedRank = color === "w" ? Number(from[1]) + 1 : Number(from[1]) - 1;
    next.enPassant = from[0] + passedRank;
  }

  return next;
}

// 合法目标格 = 伪合法 ∧ 走完后己方王不被将军。
export function legalTargets(state, from) {
  const piece = state.board[from];
  if (!piece) return [];
  const color = pieceColor(piece);
  const enemyColor = color === "w" ? "b" : "w";

  return pseudoLegalTargets(state, from).filter(to => {
    const next = applyMove(state, from + to);
    const kingSquare = Object.keys(next.board).find(sq => next.board[sq] === (color === "w" ? "K" : "k"));
    return !kingSquare || !isSquareAttacked(next, kingSquare, enemyColor);
  });
}

// 返回某方王的受威胁状态："none" | "check" | "checkmate"。
export function kingThreatState(state, color) {
  const king = color === "w" ? "K" : "k";
  const kingSquare = Object.keys(state.board).find(sq => state.board[sq] === king);
  if (!kingSquare) return "none";
  const enemyColor = color === "w" ? "b" : "w";
  if (!isSquareAttacked(state, kingSquare, enemyColor)) return "none";

  const canEscape = Object.keys(state.board).some(sq => {
    return pieceColor(state.board[sq]) === color && legalTargets(state, sq).length > 0;
  });
  return canEscape ? "check" : "checkmate";
}

export function materialFor(board, color) {
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
