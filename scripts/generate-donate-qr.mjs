import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import QRCode from "qrcode";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDirectory = path.join(projectRoot, "assets/donate");

// 收款链接（来源：作者收款码解码结果；与 chess-reversal-lab 同一套）
const codes = [
  { name: "alipay-qr", url: "https://qr.alipay.com/fkx16432isyyhmx9ttwpi79" },
  { name: "wechat-qr", url: "wxp://f2f1fJpOcJc7F-MSeLMxALhc6tWu-oohtxueHRbCe98bMy2AmDunimuOJFv-8bjobLBM" },
];

// 浅色主题：米色纸面底 + 森林绿码点（匹配站点 --paper / --forest）。
// 金色描边/圆角由 CSS 模态框承担，PNG 只负责可扫的二维码本体，
// 不需要 sharp 合成，保持依赖最小（仅 qrcode）。
const qrOptions = {
  width: 440,
  margin: 2,
  errorCorrectionLevel: "H",
  color: {
    dark: "#173d2b", // --forest：深森林绿码点
    light: "#f5f0e6", // --paper：米色底，与站点背景融合
  },
};

await mkdir(outputDirectory, { recursive: true });

await Promise.all(
  codes.map(async ({ name, url }) => {
    const outFile = path.join(outputDirectory, `${name}.png`);
    await QRCode.toFile(outFile, url, qrOptions);
    console.log(`Generated ${name}.png`);
  }),
);

console.log("Donate QR codes written to assets/donate/");
