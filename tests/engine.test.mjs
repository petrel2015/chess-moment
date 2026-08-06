import assert from "node:assert/strict";
import test from "node:test";
import {
  applyMove,
  isSquareAttacked,
  kingThreatState,
  legalTargets,
  parseFen,
  pseudoLegalTargets,
} from "../assets/chess-engine.mjs";

// ---- 兵升变 ---------------------------------------------------------------

test("pawn promotes to queen by default when reaching last rank", () => {
  // 白兵 e7，前方 e8 空。e7e8 不带第 5 字符 → 默认升后。
  const state = parseFen("4k3/4P3/8/8/8/8/8/4K3 w - - 0 1");
  const next = applyMove(state, "e7e8");
  assert.equal(next.board.e8, "Q");
  assert.equal(next.board.e7, undefined);
});

test("pawn promotes to the piece named in the 5th UCI char", () => {
  const state = parseFen("4k3/4P3/8/8/8/8/8/4K3 w - - 0 1");
  for (const [code, piece] of [["q", "Q"], ["r", "R"], ["b", "B"], ["n", "N"]]) {
    const next = applyMove(state, `e7e8${code}`);
    assert.equal(next.board.e8, piece, `promote ${code} should yield ${piece}`);
  }
  // 黑兵升变为小写
  const blackState = parseFen("4k3/8/8/8/8/8/4p3/4K3 b - - 0 1");
  const blackNext = applyMove(blackState, "e2e1r");
  assert.equal(blackNext.board.e1, "r");
});

test("legalTargets includes promotion destinations for a pushing pawn", () => {
  // 黑王挪到 a8，e8 空出，白兵可直进升变。
  const state = parseFen("k7/4P3/8/8/8/8/8/4K3 w - - 0 1");
  const targets = legalTargets(state, "e7");
  assert.ok(targets.includes("e8"), "pawn must be able to push to e8");
});

// ---- 吃过路兵 -------------------------------------------------------------

test("pawn can capture en passant when target square matches state.enPassant", () => {
  // 白兵 e5，黑刚走 d7-d5，enPassant=d6。白 exd6 应吃掉 d5 的黑兵。
  const state = parseFen("4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1");
  assert.equal(state.enPassant, "d6");
  const next = applyMove(state, "e5d6");
  assert.equal(next.board.d6, "P", "white pawn lands on d6");
  assert.equal(next.board.d5, undefined, "the black pawn that double-pushed is removed");
  assert.equal(next.board.e5, undefined);
});

test("en passant window closes after one move (no enPassant field means illegal)", () => {
  // 同一局面但 enPassant 为空，exd6 不应被当作合法吃子目标。
  const state = parseFen("4k3/8/8/3pP3/8/8/8/4K3 w - - 0 1");
  const targets = pseudoLegalTargets(state, "e5");
  assert.ok(!targets.includes("d6"), "d6 must not be reachable without enPassant right");
});

test("double pawn push sets the enPassant square for the next move", () => {
  const state = parseFen("4k3/8/8/8/8/8/4P3/4K3 w - - 0 1");
  const next = applyMove(state, "e2e4");
  assert.equal(next.enPassant, "e3");
});

// ---- 王车易位 -------------------------------------------------------------

test("kingside castling moves king to g1 and rook to f1", () => {
  const state = parseFen("4k3/8/8/8/8/8/8/4K2R w K - 0 1");
  const targets = legalTargets(state, "e1");
  assert.ok(targets.includes("g1"), "kingside castling g1 must be legal");
  const next = applyMove(state, "e1g1");
  assert.equal(next.board.g1, "K");
  assert.equal(next.board.f1, "R");
  assert.equal(next.board.e1, undefined);
  assert.equal(next.board.h1, undefined);
  // 易位权用完即失
  assert.equal(next.castling.K, false);
});

test("queenside castling moves king to c1 and rook to d1", () => {
  const state = parseFen("4k3/8/8/8/8/8/8/R3K3 w Q - 0 1");
  const next = applyMove(state, "e1c1");
  assert.equal(next.board.c1, "K");
  assert.equal(next.board.d1, "R");
  assert.equal(next.board.a1, undefined);
});

test("castling is forbidden when a piece blocks the path", () => {
  // f1 有马挡路，短易位不可走
  const state = parseFen("4k3/8/8/8/8/8/8/4K1NR w K - 0 1");
  const targets = legalTargets(state, "e1");
  assert.ok(!targets.includes("g1"));
});

test("castling is forbidden when the king passes through an attacked square", () => {
  // 黑象在 h3，沿 h3-g2-f1 斜线攻击 f1；白王短易位必经 f1，不可走。
  const attacked = parseFen("4k3/8/8/8/8/7b/8/4K2R w K - 0 1");
  assert.ok(!legalTargets(attacked, "e1").includes("g1"), "f1 attacked blocks castling");
  // 对照组：无象时可易位
  const safe = parseFen("4k3/8/8/8/8/8/8/4K2R w K - 0 1");
  assert.ok(legalTargets(safe, "e1").includes("g1"), "baseline allows castling");
});

test("castling is forbidden while in check", () => {
  // 黑车沿 e 线将军白王，不能易位
  const state = parseFen("4r3/8/8/8/8/8/8/4K2R w K - 0 1");
  assert.equal(kingThreatState(state, "w"), "check");
  const targets = legalTargets(state, "e1");
  assert.ok(!targets.includes("g1"));
});

test("castling is forbidden without the right", () => {
  const state = parseFen("4k3/8/8/8/8/8/8/4K2R w - - 0 1");
  const targets = legalTargets(state, "e1");
  assert.ok(!targets.includes("g1"), "no castling right means no g1 target");
});

test("moving the rook clears castling right on that side", () => {
  const state = parseFen("4k3/8/8/8/8/8/8/R3K2R w KQ - 0 1");
  const next = applyMove(state, "a1b1"); // 动长易位车
  assert.equal(next.castling.Q, false);
  assert.equal(next.castling.K, true, "kingside right untouched");
});

// ---- 将军 / 将死 / 不送王 -------------------------------------------------

test("legalTargets never leaves own king in check", () => {
  // 白王 e1，黑车 e8 沿 e 线将军。白王不能走到仍被攻击的格子。
  const state = parseFen("4r3/8/8/8/8/8/8/4K3 w - - 0 1");
  const targets = legalTargets(state, "e1");
  // d1/f1 虽相邻，但 e 线车不攻击它们；e2 仍被车攻击，不应出现
  assert.ok(!targets.includes("e2"), "king cannot stay on the checked file");
  assert.ok(targets.includes("d1") || targets.includes("f1") || targets.includes("d2"),
    "king must have at least one escape square");
});

test("kingThreatState reports check when king is attacked", () => {
  const state = parseFen("4r3/8/8/8/8/8/8/4K3 w - - 0 1");
  assert.equal(kingThreatState(state, "w"), "check");
});

test("kingThreatState reports checkmate when king is attacked with no escape", () => {
  // 经典两车杀：黑王 a8，白车 g7 控制第 7 行，g8 贴脸将杀。
  const state = parseFen("k5R1/6R1/8/8/8/8/8/4K3 w - - 0 1");
  // 先确认这是将死：白车 g8 将军，a8 王无法逃（第 7 行被 g7 车控制）
  assert.equal(kingThreatState(state, "b"), "checkmate");
});

test("kingThreatState reports none when the king is safe", () => {
  const state = parseFen("4k3/8/8/8/8/8/8/4K3 w - - 0 1");
  assert.equal(kingThreatState(state, "w"), "none");
  assert.equal(kingThreatState(state, "b"), "none");
});

// ---- 向后兼容：现有课程的基础走子 -----------------------------------------

test("basic knight and pawn moves still work (regression for existing lessons)", () => {
  // 取自 italian-center 课程的起始局面：白兵已在 e4，马在 f3。
  const state = parseFen("r1bqkbnr/ppp1pppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3");
  const knightTargets = legalTargets(state, "f3");
  // 马在 f3 可走到 e5（吃兵）、g5、d4、h4 等
  assert.ok(knightTargets.includes("e5"));
  assert.ok(knightTargets.includes("g5"));
});

test("double pawn push from a starting rank sets the en passant square", () => {
  // italian-center 起始局面：e2 兵已到 e4，d2 兵仍在原位，走 d2-d4 双步前进。
  const startState = parseFen("r1bqkbnr/ppp1pppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3");
  assert.equal(startState.board.d2, "P", "d2 should hold a white pawn for the push");
  const after = applyMove(startState, "d2d4");
  assert.equal(after.enPassant, "d3");
});
