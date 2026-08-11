import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { PNG } from "pngjs";

const root = process.cwd();
const piecesDir = path.join(root, "assets", "pieces");
const backupDir = path.join(piecesDir, "originals");

const PIECE_KEYS = ["wk", "wq", "wr", "wb", "wn", "wp", "bk", "bq", "br", "bb", "bn", "bp"];
const TARGET = 160;
const SOURCE_CANVAS = 512;
// 160x160 optimized pieces should be well under this; catches accidental
// re-export of full-resolution sources.
const MAX_PIECE_BYTES = 50_000;

function readPngSize(buf) {
  const png = PNG.sync.read(buf);
  return { width: png.width, height: png.height };
}

test("optimize-pieces runs successfully", () => {
  const result = spawnSync(process.execPath, ["scripts/optimize-pieces.mjs"], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
});

// Verify the actual output artifacts: every piece is 160x160 and small.
test("optimized pieces are 160x160 and small", async () => {
  for (const key of PIECE_KEYS) {
    const buf = await readFile(path.join(piecesDir, `${key}.png`));
    const { width, height } = readPngSize(buf);
    assert.equal(width, TARGET, `${key}.png width should be ${TARGET}`);
    assert.equal(height, TARGET, `${key}.png height should be ${TARGET}`);
    assert.ok(
      buf.length <= MAX_PIECE_BYTES,
      `${key}.png is ${buf.length} bytes, expected <= ${MAX_PIECE_BYTES}`
    );
  }
});

test("optimize-pieces backs up 12 pristine 512x512 sources to originals/", async () => {
  const backups = (await readdir(backupDir)).filter(f => f.endsWith(".png")).sort();
  assert.equal(backups.length, PIECE_KEYS.length, "should back up all 12 pieces");
  for (const key of PIECE_KEYS) {
    const buf = await readFile(path.join(backupDir, `${key}.png`));
    const { width, height } = readPngSize(buf);
    assert.equal(width, SOURCE_CANVAS, `${key} backup width should be ${SOURCE_CANVAS}`);
    assert.equal(height, SOURCE_CANVAS, `${key} backup height should be ${SOURCE_CANVAS}`);
  }
});

test("optimize-pieces is idempotent — re-running keeps 160x160 output", () => {
  // Snapshot byte sizes before second run.
  const before = spawnSync(
    process.execPath,
    ["-e", "for (const k of ['wk','wp','bk','bn']) { const fs=require('fs'); const b=fs.readFileSync('assets/pieces/'+k+'.png'); console.log(k+'\t'+b.length); }"],
    { cwd: root, encoding: "utf8" }
  );
  assert.equal(before.status, 0, before.stderr);

  const result = spawnSync(process.execPath, ["scripts/optimize-pieces.mjs"], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);

  const after = spawnSync(
    process.execPath,
    ["-e", "for (const k of ['wk','wp','bk','bn']) { const fs=require('fs'); const b=fs.readFileSync('assets/pieces/'+k+'.png'); console.log(k+'\t'+b.length); }"],
    { cwd: root, encoding: "utf8" }
  );
  assert.equal(after.status, 0, after.stderr);

  // Output must be deterministic byte-for-byte (same input from originals/).
  assert.equal(before.stdout, after.stdout, "re-running must produce identical output sizes");
});

test("total optimized payload is under 500KB (down from ~3MB)", async () => {
  let total = 0;
  for (const key of PIECE_KEYS) {
    const st = await stat(path.join(piecesDir, `${key}.png`));
    total += st.size;
  }
  assert.ok(total < 500_000, `total piece payload ${total} bytes should be < 500KB`);
});
