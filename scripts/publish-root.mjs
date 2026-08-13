import { copyFile, readdir, mkdir, rm, cp, stat } from "node:fs/promises";
import path from "node:path";

const projectRoot = path.resolve(import.meta.dirname, "..");
const buildDir = path.join(projectRoot, "_site");
const rootWechatDir = path.join(projectRoot, "wechat");
const rootEnDir = path.join(projectRoot, "en");

// 1. Copy generated HTML files from _site/ root to repo root
const generatedPages = (await readdir(buildDir)).filter((name) =>
  name.endsWith(".html"),
);

await Promise.all(
  generatedPages.map((name) =>
    copyFile(path.join(buildDir, name), path.join(projectRoot, name)),
  ),
);

// 1b. Sync _site/en/** to repo-root en/ (English pages live in a subdirectory).
await rm(rootEnDir, { recursive: true, force: true });
await cp(path.join(buildDir, "en"), rootEnDir, { recursive: true });

// 2. Idempotently sync _site/wechat/** to repo-root wechat/
//    This ensures public /wechat/ pages and board PNGs are served from main root.
//    Remove stale wechat/ dir first, then copy fresh - idempotent on every run.
await rm(rootWechatDir, { recursive: true, force: true });
await cp(path.join(buildDir, "wechat"), rootWechatDir, { recursive: true });

console.log(
  `Published ${generatedPages.length} generated HTML files to the repository root.`,
);
console.log(
  `Synced en/ directory (${(await readdir(rootEnDir)).length} entries) to repository root.`,
);
console.log(
  `Synced wechat/ directory (${(await readdir(rootWechatDir)).length} entries) to repository root.`,
);
