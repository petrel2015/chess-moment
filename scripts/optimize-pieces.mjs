import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const piecesDir = path.join(root, "assets", "pieces");
const backupDir = path.join(piecesDir, "originals");

// Target canvas edge length (px). Board max = 520px / 8 = 65px per square;
// 160px gives ~2.5x headroom for retina displays while keeping bytes tiny.
const TARGET = 160;
const SOURCE_CANVAS = 512;

// 12 piece sprite keys (color + type). Matches assets/pieces/*.png filenames.
const PIECE_KEYS = [
  "wk", "wq", "wr", "wb", "wn", "wp",
  "bk", "bq", "br", "bb", "bn", "bp",
];

// Visible-artwork rectangles [x, y, width, height] inside each 512x512 source
// PNG. Used to crop the artwork out of its asymmetric transparent padding so it
// can be re-centered on a uniform canvas. MUST stay in sync with the
// PIECE_BOUNDS table historically used by assets/app.js; kept here as a literal
// copy to avoid importing browser-only code into a Node build script.
const PIECE_BOUNDS = {
  wk: [219, 20, 221, 492],
  wq: [87, 116, 352, 341],
  wr: [79, 139, 236, 321],
  wb: [195, 0, 270, 389],
  wn: [127, 75, 279, 304],
  wp: [80, 89, 218, 282],
  bk: [336, 81, 176, 428],
  bq: [0, 161, 512, 346],
  br: [0, 199, 206, 305],
  bb: [311, 67, 201, 313],
  bn: [0, 63, 386, 316],
  bp: [0, 108, 195, 274],
};

/**
 * Sample the source RGBA buffer with bilinear interpolation at fractional (x, y).
 * Returns [r, g, b, a] as floats in [0, 255]. Coordinates outside the source are
 * treated as fully transparent (zero alpha), so artwork edges anti-alias onto
 * transparent canvas rather than bleeding neighbouring pixels in.
 */
function sampleBilinear(src, w, h, fx, fy) {
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const x1 = x0 + 1;
  const y1 = y0 + 1;
  const wx = fx - x0;
  const wy = fy - y0;

  const at = (x, y) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return [0, 0, 0, 0];
    const idx = (y * w + x) * 4;
    return [src[idx], src[idx + 1], src[idx + 2], src[idx + 3]];
  };

  const tl = at(x0, y0);
  const tr = at(x1, y0);
  const bl = at(x0, y1);
  const br = at(x1, y1);

  // Premultiply by alpha before interpolating so transparent edges do not
  // pull dark fringes into the blended result.
  const blend = (c00, c10, c01, c11) => {
    const top = c00 + (c10 - c00) * wx;
    const bot = c01 + (c11 - c01) * wx;
    return top + (bot - top) * wy;
  };
  const r = blend(tl[0] * tl[3], tr[0] * tr[3], bl[0] * bl[3], br[0] * br[3]);
  const g = blend(tl[1] * tl[3], tr[1] * tr[3], bl[1] * bl[3], br[1] * br[3]);
  const b = blend(tl[2] * tl[3], tr[2] * tr[3], bl[2] * bl[3], br[2] * br[3]);
  const a = blend(tl[3], tr[3], bl[3], br[3]);
  return a > 0 ? [r / a, g / a, b / a, a] : [0, 0, 0, 0];
}

async function optimize() {
  // Back up pristine 512x512 sources on first run. Idempotent: if backups
  // already exist we treat the current assets/pieces/*.png as already
  // optimized and read originals from the backup instead.
  const hasBackup = existsSync(backupDir);
  if (!hasBackup) {
    await mkdir(backupDir, { recursive: true });
    for (const key of PIECE_KEYS) {
      const file = `${key}.png`;
      const src = path.join(piecesDir, file);
      if (!existsSync(src)) {
        throw new Error(`Missing piece source: ${src}`);
      }
      await writeFile(path.join(backupDir, file), await readFile(src));
    }
  }

  const report = [];
  let totalBefore = 0;
  let totalAfter = 0;

  for (const key of PIECE_KEYS) {
    const file = `${key}.png`;
    const backupPath = path.join(backupDir, file);
    const outPath = path.join(piecesDir, file);

    const beforeBuf = await readFile(backupPath);
    const beforeSize = beforeBuf.length;
    totalBefore += beforeSize;
    const src = PNG.sync.read(beforeBuf);
    if (src.width !== SOURCE_CANVAS || src.height !== SOURCE_CANVAS) {
      throw new Error(
        `${file}: expected ${SOURCE_CANVAS}x${SOURCE_CANVAS} source, got ${src.width}x${src.height}`
      );
    }

    const [bx, by, bw, bh] = PIECE_BOUNDS[key];
    // Uniform visible height = TARGET. This is the proportion fix: every piece
    // occupies the same vertical extent, so king/pawn/queen line up visually.
    const scale = TARGET / bh;
    const drawnW = bw * scale;
    const drawnH = TARGET;
    const offsetX = Math.round((TARGET - drawnW) / 2);
    const offsetY = 0; // height fills the canvas

    const dst = new PNG({ width: TARGET, height: TARGET });
    // pngjs initializes the buffer to zero (transparent). Fill pixels.
    for (let y = 0; y < TARGET; y++) {
      for (let x = 0; x < TARGET; x++) {
        const dx = x - offsetX;
        const dy = y - offsetY;
        // Source pixel coordinate inside the visible-artwork rect.
        const sx = bx + dx / scale;
        const sy = by + dy / scale;
        const [r, g, b, a] = sampleBilinear(src.data, SOURCE_CANVAS, SOURCE_CANVAS, sx, sy);
        const idx = (y * TARGET + x) * 4;
        dst.data[idx] = Math.max(0, Math.min(255, Math.round(r)));
        dst.data[idx + 1] = Math.max(0, Math.min(255, Math.round(g)));
        dst.data[idx + 2] = Math.max(0, Math.min(255, Math.round(b)));
        dst.data[idx + 3] = Math.max(0, Math.min(255, Math.round(a)));
      }
    }

    const outBuf = PNG.sync.write(dst, { deflateLevel: 9, deflateStrategy: 3 });
    await writeFile(outPath, outBuf);
    const afterSize = outBuf.length;
    totalAfter += afterSize;
    report.push({ key, beforeSize, afterSize });
  }

  const fmt = bytes => `${(bytes / 1024).toFixed(1)}KB`;
  for (const r of report) {
    const drop = (((r.beforeSize - r.afterSize) / r.beforeSize) * 100).toFixed(0);
    console.log(`  ${r.key}.png  ${fmt(r.beforeSize)} -> ${fmt(r.afterSize)}  (-${drop}%)`);
  }
  const totalDrop = (((totalBefore - totalAfter) / totalBefore) * 100).toFixed(0);
  console.log(
    `Optimized ${PIECE_KEYS.length} pieces: ${fmt(totalBefore)} -> ${fmt(totalAfter)} (-${totalDrop}%). ` +
      `Sources backed up at assets/pieces/originals/.`
  );
}

optimize().catch(err => {
  console.error(err);
  process.exit(1);
});
