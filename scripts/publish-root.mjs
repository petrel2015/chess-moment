import { copyFile, readdir } from "node:fs/promises";
import path from "node:path";

const projectRoot = path.resolve(import.meta.dirname, "..");
const buildDir = path.join(projectRoot, "_site");
const generatedPages = (await readdir(buildDir)).filter((name) =>
  name.endsWith(".html"),
);

await Promise.all(
  generatedPages.map((name) =>
    copyFile(path.join(buildDir, name), path.join(projectRoot, name)),
  ),
);

console.log(
  `Published ${generatedPages.length} generated HTML files to the repository root.`,
);
