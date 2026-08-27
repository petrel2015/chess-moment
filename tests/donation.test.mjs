import assert from "node:assert/strict";
import { copyFile, mkdir } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { createRequire } from "node:module";
import { JSDOM, VirtualConsole } from "jsdom";
import jsQR from "jsqr";
import { PNG } from "pngjs";
import { UI } from "../assets/i18n.mjs";

const root = process.cwd();
const require = createRequire(import.meta.url);

// buy-me-coffee 规范的唯一支付配置（与 assets/donation.js 保持一致）
const EXPECTED_QR = {
  alipay: "https://qr.alipay.com/fkx16432isyyhmx9ttwpi79",
  wechat: "wxp://f2f1fJpOcJc7F-MSeLMxALhc6tWu-oohtxueHRbCe98bMy2AmDunimuOJFv-8bjobLBM",
};

async function ensureBuilt() {
  const zh = path.join(root, "_site", "index.html");
  const en = path.join(root, "_site", "en", "index.html");
  if (existsSync(zh) && existsSync(en)) return;
  const result = spawnSync(process.execPath, ["scripts/build-site.mjs"], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
}

async function waitFor(condition, timeoutMs = 4000) {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeoutMs) return false;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  return true;
}

/** 载入一个构建产物页面（真实脚本执行 + 本地资源加载），忽略 jsdom 导航噪音。 */
async function loadPage(relPath) {
  const jsdomErrors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on("jsdomError", error => {
    if (!/navigation/i.test(String(error.message))) jsdomErrors.push(error.message);
  });
  const dom = await JSDOM.fromFile(path.join(root, "_site", relPath), {
    runScripts: "dangerously",
    resources: "usable",
    virtualConsole,
    pretendToBeVisual: true,
  });
  await new Promise(resolve => {
    if (dom.window.document.readyState === "complete") resolve();
    else dom.window.addEventListener("load", resolve);
  });
  return { dom, jsdomErrors };
}

// ---------------------------------------------------------------------------
// 合同断言（防回退）：无静态二维码、无自定义支付 scheme、QR 库仅懒加载
// ---------------------------------------------------------------------------

test("donation code contains no custom payment scheme or QR image reference", () => {
  const src = readFileSync(path.join(root, "assets", "donation.js"), "utf8");
  assert.ok(!/alipays:\/\//i.test(src), "donation.js must not build alipays:// schemes");
  assert.ok(!/(weixin|wechat|wxp):\/\//i.test(src.replace(/wxp:\/\/f2f1[\w-]+/, "")),
    "donation.js must not jump via wxp:// (it is QR payload only)");
  assert.ok(!/qr[^'"]*\.(png|jpe?g|svg)/i.test(src), "donation.js must not reference QR image files");
  assert.ok(!existsSync(path.join(root, "assets", "donate")), "assets/donate/ static QRs must not exist");
  // app.js 不得再保留旧赞赏装配
  const appSrc = readFileSync(path.join(root, "assets", "app.js"), "utf8");
  assert.ok(!/alipays:\/\//.test(appSrc), "app.js must not contain alipays://");
  assert.ok(!/donate\/.*\.png/.test(appSrc), "app.js must not reference static QR PNGs");
});

test("vendored QR library is present with license header", () => {
  const lib = readFileSync(path.join(root, "assets", "vendor", "qrcode-generator.js"), "utf8");
  assert.ok(lib.includes("Kazuhiko Arase"), "vendored lib must keep its copyright header");
  assert.ok(lib.includes("MIT"), "vendored lib must keep its MIT license notice");
});

test("built pages wire entry, dialog, styles; QR lib is lazy-load only", async () => {
  await ensureBuilt();
  const pages = [
    { file: "index.html", prefix: "", entry: "☕ 请作者喝杯咖啡", scan: "打开支付宝扫一扫" },
    { file: "rook-ladder.html", prefix: "", entry: "☕ 请作者喝杯咖啡", scan: "打开支付宝扫一扫" },
    { file: path.join("en", "index.html"), prefix: "../", entry: "☕ Buy me a coffee", scan: "Scan with Alipay" },
  ];
  for (const { file, prefix, entry, scan } of pages) {
    const html = readFileSync(path.join(root, "_site", file), "utf8");
    assert.ok(html.includes(`id="donate-entry">${entry}</button>`), `${file} missing localized entry`);
    assert.ok(html.includes(`href="${prefix}assets/donation.css"`), `${file} missing donation.css link`);
    assert.ok(html.includes(`src="${prefix}assets/donation.js"`), `${file} missing donation.js script`);
    assert.ok(html.includes('id="donation-dialog" hidden role="dialog" aria-modal="true"'),
      `${file} missing dialog shell`);
    for (const id of ["donation-tab-alipay", "donation-tab-wechat", "donation-qr", "donation-hint", "donation-close"]) {
      assert.ok(html.includes(`id="${id}"`), `${file} missing #${id}`);
    }
    for (const attr of ["data-scan-alipay", "data-scan-wechat", "data-fallback-hint", "data-qr-error"]) {
      assert.ok(html.includes(attr), `${file} missing ${attr} hint text`);
    }
    assert.ok(html.includes(scan), `${file} missing localized scan hint`);
    // QR 库绝不随页面加载，只能由 donation.js 在弹窗打开后懒加载
    assert.ok(!html.includes("vendor/qrcode-generator.js"), `${file} must not ship the QR lib tag`);
    // 旧实现痕迹必须清除
    assert.ok(!html.includes("donate-section"), `${file} still has legacy donate-section`);
    assert.ok(!html.includes("￥4.9"), `${file} still has legacy price copy`);
  }
});

test("wechat preview pages carry no donation markup", async () => {
  await ensureBuilt();
  const html = readFileSync(path.join(root, "_site", "wechat", "index.html"), "utf8");
  assert.ok(!html.includes("donate-entry"), "wechat html must not contain donation entry");
  assert.ok(!html.includes("donation.js"), "wechat html must not load donation script");
});

test("i18n donate keys are identical across zh/en and verbatim per spec", () => {
  const zhKeys = Object.keys(UI.zh).filter(k => k.startsWith("donate")).sort();
  const enKeys = Object.keys(UI.en).filter(k => k.startsWith("donate")).sort();
  assert.deepEqual(zhKeys, enKeys, "zh/en donate key sets must match");
  // 逐字文案（buy-me-coffee 规范对照表）
  assert.equal(UI.zh.donateEntry, "☕ 请作者喝杯咖啡");
  assert.equal(UI.zh.donateTitle, "请作者喝杯咖啡 ☕");
  assert.equal(UI.zh.donateSubtitle, "如果这个小工具帮到了你，可以请作者喝杯咖啡。");
  assert.equal(UI.zh.donateAlipay, "支付宝");
  assert.equal(UI.zh.donateWechatPay, "微信支付");
  assert.equal(UI.zh.donateScanAlipay, "打开支付宝扫一扫");
  assert.equal(UI.zh.donateScanWechat, "打开微信扫一扫");
  assert.equal(UI.zh.donateFallbackHint, "没有自动打开？请使用支付宝 / 微信扫码");
  assert.equal(UI.en.donateEntry, "☕ Buy me a coffee");
  assert.equal(UI.en.donateTitle, "Buy me a coffee ☕");
  assert.equal(UI.en.donateSubtitle, "If this little tool helped you, you can buy the author a coffee.");
  assert.equal(UI.en.donateAlipay, "Alipay");
  assert.equal(UI.en.donateWechatPay, "WeChat Pay");
  assert.equal(UI.en.donateScanAlipay, "Scan with Alipay");
  assert.equal(UI.en.donateScanWechat, "Scan with WeChat");
  assert.equal(UI.en.donateFallbackHint, "Didn't open automatically? Scan the QR code instead.");
});

test("donation-* class names in markup reconcile with donation.css", () => {
  const css = readFileSync(path.join(root, "assets", "donation.css"), "utf8");
  for (const className of ["donate-entry", "donation-overlay", "donation-dialog", "donation-close",
    "donation-title", "donation-subtitle", "donation-tabs", "donation-tab", "donation-qr", "donation-hint"]) {
    assert.ok(css.includes(`.${className}`), `donation.css missing rule for .${className}`);
  }
});

// ---------------------------------------------------------------------------
// 二维码回环：页面同款绘制算法 → jsQR 解码 → 与支付链接逐字一致
// ---------------------------------------------------------------------------

test("QR roundtrip renders and decodes both payment links exactly", async () => {
  // 本包 "type":"module"，vendored 库按 .js 会被当 ESM 加载导致 UMD 导出失效；
  // 复制为 .cjs 后 require，与浏览器经典脚本路径行为一致。
  const artifactsDir = path.join(root, "_artifacts");
  await mkdir(artifactsDir, { recursive: true });
  const cjsCopy = path.join(artifactsDir, "qrcode-generator.test.cjs");
  await copyFile(path.join(root, "assets", "vendor", "qrcode-generator.js"), cjsCopy);
  const qrcode = require(cjsCopy);

  const QR_DISPLAY_SIZE = 220;
  const QR_ECC = "M";
  const QR_QUIET_MODULES = 4;

  function renderToPixels(content, scaleBoost) {
    const qr = qrcode(0, QR_ECC);
    qr.addData(content);
    qr.make();
    const modules = qr.getModuleCount();
    const total = modules + QR_QUIET_MODULES * 2;
    const px = Math.max(1, Math.floor(QR_DISPLAY_SIZE / total)) * (scaleBoost || 4);
    const size = px * total;
    const png = new PNG({ width: size, height: size });
    for (let i = 0; i < png.data.length; i += 4) {
      png.data[i] = 255; png.data[i + 1] = 255; png.data[i + 2] = 255; png.data[i + 3] = 255;
    }
    for (let row = 0; row < modules; row++) {
      for (let col = 0; col < modules; col++) {
        if (!qr.isDark(row, col)) continue;
        const x0 = (col + QR_QUIET_MODULES) * px;
        const y0 = (row + QR_QUIET_MODULES) * px;
        for (let dy = 0; dy < px; dy++) {
          for (let dx = 0; dx < px; dx++) {
            const idx = (size * (y0 + dy) + (x0 + dx)) * 4;
            png.data[idx] = 17; png.data[idx + 1] = 17; png.data[idx + 2] = 17;
          }
        }
      }
    }
    return { png, modules, total };
  }

  for (const [channel, content] of Object.entries(EXPECTED_QR)) {
    const { png, modules, total } = renderToPixels(content);
    assert.ok(modules >= 21 && modules <= 177, `${channel}: auto type selection produced sane module count`);
    assert.equal(total - modules, QR_QUIET_MODULES * 2, `${channel}: quiet zone must be ${QR_QUIET_MODULES} modules`);
    const decoded = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
    assert.ok(decoded, `${channel}: jsQR decode failed`);
    assert.equal(decoded.data, content, `${channel}: decoded payload must match the payment link verbatim`);
  }

  // 输出样张供真机人工扫码验收（_artifacts 已被 gitignore）
  const sample = renderToPixels(EXPECTED_QR.alipay, 6);
  const { writeFileSync } = await import("node:fs");
  writeFileSync(path.join(artifactsDir, "qr-sample-alipay.png"), PNG.sync.write(sample.png));
});

// ---------------------------------------------------------------------------
// jsdom 交互：加载构建产物页面，驱动真实 donation.js
// ---------------------------------------------------------------------------

test("desktop: entry opens dialog, lazy-loads QR lib, switches channels, ESC restores focus", async () => {
  await ensureBuilt();
  const { dom } = await loadPage("index.html");
  try {
    const { document } = dom.window;
    const entry = document.getElementById("donate-entry");
    assert.ok(entry, "entry button must exist");
    assert.equal(entry.textContent, "☕ 请作者喝杯咖啡");

    const opens = [];
    dom.window.open = (...args) => { opens.push(args); return {}; };

    // 弹窗未打开时，QR 库不得存在于 DOM（首屏零开销）
    assert.ok(!document.querySelector('script[src*="vendor/qrcode-generator"]'),
      "QR lib must not be loaded before the dialog opens");

    entry.click();
    const overlay = document.getElementById("donation-dialog");
    assert.equal(overlay.hidden, false, "dialog should be visible after entry click");
    assert.equal(document.getElementById("donation-hint").textContent, UI.zh.donateScanAlipay);
    assert.equal(document.getElementById("donation-tab-alipay").getAttribute("aria-pressed"), "true");
    assert.equal(document.getElementById("donation-tab-wechat").getAttribute("aria-pressed"), "false");

    // 打开后 QR 库按需注入并加载完成
    const libLoaded = await waitFor(() => dom.window.qrcode, 4000);
    assert.ok(libLoaded, "QR lib should load after the dialog opens");
    assert.ok(document.querySelector('script[src*="vendor/qrcode-generator"]'),
      "QR lib script should now be in the DOM");

    // 桌面端不尝试唤起支付宝
    assert.equal(opens.length, 0, "desktop must not window.open the payment link");

    // 渠道切换：提示与 aria 状态跟随
    document.getElementById("donation-tab-wechat").click();
    assert.equal(document.getElementById("donation-hint").textContent, UI.zh.donateScanWechat);
    assert.equal(document.getElementById("donation-tab-alipay").getAttribute("aria-pressed"), "false");
    assert.equal(document.getElementById("donation-tab-wechat").getAttribute("aria-pressed"), "true");
    document.getElementById("donation-tab-alipay").click();
    assert.equal(document.getElementById("donation-hint").textContent, UI.zh.donateScanAlipay);
    assert.equal(opens.length, 0, "desktop alipay channel must still not window.open");

    // ESC 关闭并把焦点归还入口
    entry.focus();
    document.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    assert.equal(overlay.hidden, true, "ESC should close the dialog");
    assert.equal(document.activeElement, entry, "focus should return to the entry button");
  } finally {
    dom.window.close();
  }
});

test("mobile: alipay window.opens official https link once per dialog session, QR stays as fallback", async () => {
  await ensureBuilt();
  const { dom } = await loadPage("index.html");
  try {
    const { document } = dom.window;
    // jsdom 24.x 会忽略构造项 userAgent，必须 defineProperty 覆盖（先自证再测）
    Object.defineProperty(dom.window.navigator, "userAgent", {
      get: () => "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1",
      configurable: true,
    });
    assert.ok(/Mobi|iPhone/.test(dom.window.navigator.userAgent), "mobile UA override must take effect");

    const opens = [];
    dom.window.open = (...args) => { opens.push(args); return {}; };

    document.getElementById("donate-entry").click();
    assert.equal(document.getElementById("donation-dialog").hidden, false);
    assert.equal(opens.length, 1, "mobile alipay should window.open exactly once");
    assert.deepEqual(opens[0], [EXPECTED_QR.alipay, "_blank", "noopener"],
      "must open the official https link in a new tab with noopener");
    assert.equal(document.getElementById("donation-hint").textContent, UI.zh.donateFallbackHint,
      "mobile alipay hint should be the didn't-open fallback copy");

    // 同一弹窗会话内切换渠道不重复跳转
    document.getElementById("donation-tab-wechat").click();
    assert.equal(opens.length, 1);
    assert.equal(document.getElementById("donation-hint").textContent, UI.zh.donateScanWechat);
    document.getElementById("donation-tab-alipay").click();
    assert.equal(opens.length, 1, "switching back to alipay within a session must not re-open");

    // 关闭后重新打开 = 新会话，允许再尝试一次
    document.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    document.getElementById("donate-entry").click();
    assert.equal(opens.length, 2, "reopening the dialog starts a new attempt session");
  } finally {
    dom.window.close();
  }
});

test("english page renders english donation copy", async () => {
  await ensureBuilt();
  const { dom } = await loadPage(path.join("en", "index.html"));
  try {
    const { document } = dom.window;
    const entry = document.getElementById("donate-entry");
    assert.equal(entry.textContent, "☕ Buy me a coffee");
    assert.equal(document.querySelector(".donation-title").textContent, "Buy me a coffee ☕");
    assert.equal(document.getElementById("donation-tab-alipay").textContent, "Alipay");
    assert.equal(document.getElementById("donation-tab-wechat").textContent, "WeChat Pay");
    entry.click();
    assert.equal(document.getElementById("donation-hint").textContent, "Scan with Alipay");
  } finally {
    dom.window.close();
  }
});
