import assert from "node:assert/strict";
import { writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { generateBoardPng, encodePng, parseFen, boardHash } from "../scripts/board-png.mjs";

const root = process.cwd();

test("generateBoardPng produces valid PNG", async () => {
  const fen = "6k1/8/8/8/8/8/1R6/R6K w - - 0 1";
  const png = await generateBoardPng(fen, { size: 480 });

  // PNG signature
  assert.equal(png[0], 0x89);
  assert.equal(png[1], 0x50);
  assert.equal(png[2], 0x4e);
  assert.equal(png[3], 0x47);
  assert.equal(png[4], 0x0d);
  assert.equal(png[5], 0x0a);
  assert.equal(png[6], 0x1a);
  assert.equal(png[7], 0x0a);

  assert.ok(png.length > 1000, "PNG should be non-trivial");
});

test("generateBoardPng is deterministic - same FEN produces identical output", async () => {
  const fen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
  const png1 = await generateBoardPng(fen, { size: 480 });
  const png2 = await generateBoardPng(fen, { size: 480 });
  assert.ok(png1.equals(png2), "Same FEN should produce identical PNG");
});

test("generateBoardPng differs for different FENs", async () => {
  const fen1 = "6k1/8/8/8/8/8/1R6/R6K w - - 0 1";
  const fen2 = "r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3";
  const png1 = await generateBoardPng(fen1, { size: 480 });
  const png2 = await generateBoardPng(fen2, { size: 480 });
  assert.ok(!png1.equals(png2), "Different FENs should produce different PNGs");
});

test("generateBoardPng with real piece sprites is larger than letter-only rendering", async () => {
  // A board with real piece sprites should be substantially larger than
  // a simple letter-rendered board, proving real sprites are composited.
  const fen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
  const png = await generateBoardPng(fen, { size: 480 });
  // The starting position has 32 pieces; with real sprites this should be
  // significantly larger than the ~2KB letter-only version was.
  assert.ok(png.length > 8000, `Full board with real sprites should be >8KB, got ${png.length} bytes`);
});

test("generateBoardPng supports black perspective (flip)", async () => {
  const fen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
  const pngWhite = await generateBoardPng(fen, { size: 480, flip: false });
  const pngBlack = await generateBoardPng(fen, { size: 480, flip: true });
  // Flipped board should be different from non-flipped
  assert.ok(!pngWhite.equals(pngBlack), "Flipped board should differ from standard orientation");
  // Both should be valid PNGs
  assert.equal(pngWhite[0], 0x89);
  assert.equal(pngBlack[0], 0x89);
});

test("generateBoardPng auto-flips for black-to-move positions", async () => {
  // FEN with black to move should auto-flip
  const fenBlack = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR b KQkq - 0 1";
  const fenWhite = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
  const pngBlack = await generateBoardPng(fenBlack, { size: 480 });
  const pngWhite = await generateBoardPng(fenWhite, { size: 480 });
  // Black-to-move should be flipped relative to white-to-move
  assert.ok(!pngBlack.equals(pngWhite), "Black-to-move should auto-flip, differing from white-to-move");
});

test("parseFen correctly parses a FEN string", () => {
  const fen = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 1";
  const board = parseFen(fen);

  assert.equal(board.length, 8);
  assert.equal(board[0][0], "r");  // a8 = black rook
  assert.equal(board[0][4], "k");  // e8 = black king
  assert.equal(board[7][4], "K");  // e1 = white king
  assert.equal(board[7][0], "R");  // a1 = white rook
  assert.equal(board[4][4], "P");  // e4 = white pawn
  assert.equal(board[3][4], null); // e5 = empty (rank 5 = row 3)
  assert.equal(board[6][0], "P");  // a2 = white pawn
  assert.equal(board[6][4], null); // e2 = empty (pawn moved to e4)
});

test("boardHash is deterministic and differs per FEN", () => {
  const fen1 = "6k1/8/8/8/8/8/1R6/R6K w - - 0 1";
  const fen2 = "r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3";

  const hash1a = boardHash(fen1);
  const hash1b = boardHash(fen1);
  const hash2 = boardHash(fen2);

  assert.equal(hash1a, hash1b, "Same FEN should produce same hash");
  assert.notEqual(hash1a, hash2, "Different FENs should produce different hashes");
});

test("encodePng produces minimal valid PNG", () => {
  // 2x2 red pixel image
  const rgba = Buffer.alloc(2 * 2 * 4);
  for (let i = 0; i < 4; i++) {
    rgba[i * 4] = 255;     // R
    rgba[i * 4 + 1] = 0;   // G
    rgba[i * 4 + 2] = 0;   // B
    rgba[i * 4 + 3] = 255; // A
  }
  const png = encodePng(2, 2, rgba);

  assert.equal(png[0], 0x89);
  assert.equal(png[1], 0x50);
  assert.equal(png[2], 0x4e);
  assert.equal(png[3], 0x47);
  assert.ok(png.length > 50, "PNG should contain header + data");
});
