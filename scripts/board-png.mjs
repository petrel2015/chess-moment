import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Board PNG generator using real piece sprite assets.
 *
 * Uses assets/pieces/*.png (512x512 transparent sprites) composited onto a
 * chess board with coordinates.  The board is rendered from the perspective
 * of the side to move (white = standard orientation, black = flipped).
 *
 * Deterministic: same FEN + same perspective always produces identical bytes.
 */

// Color constants for the board
const LIGHT_SQUARE = [173, 190, 209]; // #adbed1
const DARK_SQUARE = [39, 61, 92];     // #273d5c
const BORDER = [23, 61, 43];          // forest green border
const COORD_TEXT = [245, 240, 230]; // light text on dark border

// Map FEN piece characters to sprite filenames
const PIECE_FILE = {
  K: "wk", Q: "wq", R: "wr", B: "wb", N: "wn", P: "wp",
  k: "bk", q: "bq", r: "br", b: "bb", n: "bn", p: "bp",
};

const pieceCache = new Map();

/**
 * Load a piece sprite PNG and return its pixel data.
 * @param {string} piecesDir - Directory containing piece PNG files
 * @param {string} pieceChar - FEN piece character (K/Q/R/B/N/P/k/q/r/b/n/p)
 * @returns {Promise<{width, height, data}>} PNG pixel data
 */
async function loadPieceSprite(piecesDir, pieceChar) {
  const file = PIECE_FILE[pieceChar];
  if (!file) return null;

  if (pieceCache.has(file)) return pieceCache.get(file);

  const filePath = path.join(piecesDir, `${file}.png`);
  const buffer = await readFile(filePath);
  const png = PNG.sync.read(buffer);
  pieceCache.set(file, png);
  return png;
}

/**
 * Parse a FEN string into an 8x8 board of piece characters.
 * Returns a 2D array indexed [row][col] where row 0 = rank 8, row 7 = rank 1.
 */
export function parseFen(fen) {
  const rows = fen.split(" ")[0].split("/");
  const board = [];
  for (const row of rows) {
    const cols = [];
    for (const token of row) {
      if (/\d/.test(token)) {
        for (let i = 0; i < Number(token); i++) cols.push(null);
      } else {
        cols.push(token);
      }
    }
    board.push(cols);
  }
  return board;
}

/**
 * Composit a piece sprite onto the board buffer.
 * @param {Buffer} boardBuf - RGBA buffer for the board image
 * @param {number} boardWidth - Total board image width
 * @param {object} sprite - { width, height, data } from pngjs
 * @param {number} destX - Top-left X on board
 * @param {number} destY - Top-left Y on board
 * @param {number} destSize - Target size (square) to fit the sprite into
 */
function compositePiece(boardBuf, boardWidth, sprite, destX, destY, destSize) {
  const { width: srcW, height: srcH, data: srcData } = sprite;
  // Scale sprite to destSize, preserving aspect ratio (sprites are square)
  const scale = destSize / srcW;
  const scaledW = Math.round(srcW * scale);
  const scaledH = Math.round(srcH * scale);
  const offsetX = Math.floor((destSize - scaledW) / 2);
  const offsetY = Math.floor((destSize - scaledH) / 2);

  for (let y = 0; y < scaledH; y++) {
    for (let x = 0; x < scaledW; x++) {
      const srcX = Math.floor(x / scale);
      const srcY = Math.floor(y / scale);
      const srcIdx = (srcY * srcW + srcX) * 4;
      const alpha = srcData[srcIdx + 3];
      if (alpha === 0) continue; // transparent pixel

      const dx = destX + offsetX + x;
      const dy = destY + offsetY + y;
      if (dx < 0 || dy < 0 || dx >= boardWidth) continue;
      const dstIdx = (dy * boardWidth + dx) * 4;

      // Alpha blend
      const alphaNorm = alpha / 255;
      boardBuf[dstIdx] = Math.round(srcData[srcIdx] * alphaNorm + boardBuf[dstIdx] * (1 - alphaNorm));
      boardBuf[dstIdx + 1] = Math.round(srcData[srcIdx + 1] * alphaNorm + boardBuf[dstIdx + 1] * (1 - alphaNorm));
      boardBuf[dstIdx + 2] = Math.round(srcData[srcIdx + 2] * alphaNorm + boardBuf[dstIdx + 2] * (1 - alphaNorm));
      boardBuf[dstIdx + 3] = 255;
    }
  }
}

/**
 * Draw a character using a simple 5x7 bitmap font for coordinate labels.
 */
const FONT_5x7 = {
  a: ["01110","10001","10001","11111","10001","10001","10001"],
  b: ["11110","10001","10001","11110","10001","10001","11110"],
  c: ["01110","10001","10000","10000","10000","10001","01110"],
  d: ["11110","10001","10001","10001","10001","10001","11110"],
  e: ["11111","10000","10000","11110","10000","10000","11111"],
  f: ["11111","10000","10000","11110","10000","10000","10000"],
  g: ["01110","10001","10000","10011","10001","10001","01110"],
  h: ["10001","10001","10001","11111","10001","10001","10001"],
  "1": ["00100","01100","00100","00100","00100","00100","01110"],
  "2": ["01110","10001","00001","00010","00100","01000","11111"],
  "3": ["01110","10001","00001","00110","00001","10001","01110"],
  "4": ["00010","00110","01010","10010","11111","00010","00010"],
  "5": ["11111","10000","11110","00001","00001","10001","01110"],
  "6": ["00110","01000","10000","11110","10001","10001","01110"],
  "7": ["11111","00001","00010","00100","01000","01000","01000"],
  "8": ["01110","10001","10001","01110","10001","10001","01110"],
};

function drawChar(buf, width, char, x0, y0, scale, r, g, b) {
  const glyph = FONT_5x7[char];
  if (!glyph) return;
  for (let row = 0; row < 7; row++) {
    for (let col = 0; col < 5; col++) {
      if (glyph[row][col] === "1") {
        for (let dy = 0; dy < scale; dy++) {
          for (let dx = 0; dx < scale; dx++) {
            const px = x0 + col * scale + dx;
            const py = y0 + row * scale + dy;
            const idx = (py * width + px) * 4;
            if (idx >= 0 && idx + 3 < buf.length) {
              buf[idx] = r;
              buf[idx + 1] = g;
              buf[idx + 2] = b;
              buf[idx + 3] = 255;
            }
          }
        }
      }
    }
  }
}

function fillRect(buf, width, x0, y0, w, h, r, g, b, a = 255) {
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      const idx = (y * width + x) * 4;
      if (idx >= 0 && idx + 3 < buf.length) {
        buf[idx] = r;
        buf[idx + 1] = g;
        buf[idx + 2] = b;
        buf[idx + 3] = a;
      }
    }
  }
}

/**
 * Generate a deterministic static board PNG from a FEN string.
 *
 * @param {string} fen - FEN position string
 * @param {object} [opts]
 * @param {number} [opts.size=512] - image size in pixels (square)
 * @param {string} [opts.piecesDir] - directory containing piece PNG files
 * @param {boolean} [opts.flip=false] - flip board for black's perspective
 * @returns {Promise<Buffer>} PNG file bytes
 */
export async function generateBoardPng(fen, opts = {}) {
  const size = opts.size || 512;
  const piecesDir = opts.piecesDir || path.resolve(__dirname, "..", "assets", "pieces");
  // Determine side to move from FEN: " w " = white, " b " = black
  const sideToMove = fen.includes(" w ") ? "w" : "b";
  const flip = opts.flip !== undefined ? opts.flip : (sideToMove === "b");

  const board = parseFen(fen);
  const borderW = Math.round(size * 0.04);
  const boardSize = size - borderW * 2;
  const cellSize = Math.floor(boardSize / 8);
  const actualBoardSize = cellSize * 8;
  const totalSize = borderW * 2 + actualBoardSize;

  const buf = Buffer.alloc(totalSize * totalSize * 4);

  // Fill border background
  fillRect(buf, totalSize, 0, 0, totalSize, totalSize, ...BORDER);

  // Determine coordinate order based on flip
  const files = flip ? "hgfedcba" : "abcdefgh";
  const ranks = flip ? [1,2,3,4,5,6,7,8] : [8,7,6,5,4,3,2,1];

  // Draw board squares and pieces
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const isLight = (row + col) % 2 === 0;
      const color = isLight ? LIGHT_SQUARE : DARK_SQUARE;
      const x0 = borderW + col * cellSize;
      const y0 = borderW + row * cellSize;
      fillRect(buf, totalSize, x0, y0, cellSize, cellSize, ...color);

      // Get piece at this visual position
      // board[row][col] uses FEN indexing (row 0 = rank 8)
      // If flipped, we need to reverse both row and col
      const fenRow = flip ? 7 - row : row;
      const fenCol = flip ? 7 - col : col;
      const piece = board[fenRow][fenCol];

      if (piece && PIECE_FILE[piece]) {
        const sprite = await loadPieceSprite(piecesDir, piece);
        if (sprite) {
          // Fit piece into cell with small padding
          const padding = Math.floor(cellSize * 0.08);
          const pieceSize = cellSize - padding * 2;
          compositePiece(buf, totalSize, sprite, x0 + padding, y0 + padding, pieceSize);
        }
      }
    }
  }

  // Draw file coordinates (a-h) at bottom border
  const coordScale = Math.max(1, Math.floor(borderW / 10));
  for (let col = 0; col < 8; col++) {
    const char = files[col];
    const cx = borderW + col * cellSize + Math.floor(cellSize / 2) - Math.floor(5 * coordScale / 2);
    const cy = totalSize - borderW + Math.floor(borderW / 2) - Math.floor(7 * coordScale / 2);
    drawChar(buf, totalSize, char, cx, cy, coordScale, ...COORD_TEXT);
  }

  // Draw rank coordinates (1-8) at left border
  for (let row = 0; row < 8; row++) {
    const rank = ranks[row];
    const char = String(rank);
    const cx = Math.floor(borderW / 2) - Math.floor(5 * coordScale / 2);
    const cy = borderW + row * cellSize + Math.floor(cellSize / 2) - Math.floor(7 * coordScale / 2);
    drawChar(buf, totalSize, char, cx, cy, coordScale, ...COORD_TEXT);
  }

  // Encode as PNG using pngjs for proper PNG output
  const png = new PNG({ width: totalSize, height: totalSize });
  buf.copy(png.data);

  return PNG.sync.write(png, { deflateLevel: 9, deflateStrategy: 3 });
}

/**
 * Compute a deterministic content hash for a board PNG given a FEN.
 * Same FEN always produces the same hash, enabling cache/dedup.
 */
export function boardHash(fen) {
  let hash = 0;
  for (let i = 0; i < fen.length; i++) {
    hash = ((hash << 5) - hash + fen.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(16).padStart(8, "0");
}

/**
 * Keep the minimal PNG encoder export for backward compatibility with tests
 * that test encodePng directly.  Uses pngjs under the hood.
 */
export function encodePng(width, height, rgba) {
  const png = new PNG({ width, height });
  // pngjs expects RGBA in its data buffer
  if (rgba.length === width * height * 4) {
    rgba.copy ? rgba.copy(png.data) : Buffer.from(rgba).copy(png.data);
  }
  return PNG.sync.write(png, { deflateLevel: 9 });
}
