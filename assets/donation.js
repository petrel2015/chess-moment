/* ============================================================
   Donation — 「请作者喝杯咖啡」通用赞赏组件（buy-me-coffee 规范）
   Footer 入口 → 弹窗 → 支付宝/微信支付切换 → 客户端实时生成二维码
   - 无静态二维码图片，QR 由浏览器按原始内容实时生成
   - QR 库在弹窗首次打开时才按需加载，不影响首屏
   - 手机端支付宝优先打开官方收款链接，二维码始终可见作为兜底
   - 不构造自定义 URL scheme；文案由构建期按页面语言渲染进 DOM
     （入口/标题/副标题/渠道名直接写在 HTML，提示语经 data-* 传入）
   ============================================================ */

(function () {
  'use strict';

  // 支付配置（唯一数据源；不保存任何二维码图片）
  var DONATION_CONFIG = {
    alipay: {
      qrContent: 'https://qr.alipay.com/fkx16432isyyhmx9ttwpi79'
    },
    wechat: {
      qrContent: 'wxp://f2f1fJpOcJc7F-MSeLMxALhc6tWu-oohtxueHRbCe98bMy2AmDunimuOJFv-8bjobLBM'
    }
  };

  var QR_DISPLAY_SIZE = 220;    // 展示尺寸 px
  var QR_ECC = 'M';             // 纠错等级 M
  var QR_QUIET_MODULES = 4;     // 静区 ≥ 4 modules

  var overlay, tabAlipay, tabWechat, canvas, hintEl, entryBtn, texts;
  var currentChannel = 'alipay';
  var qrLibPromise = null;
  var attemptedOpen = false;    // 每次弹窗会话内至多尝试一次支付宝跳转
  var lastFocused = null;

  // QR 库与本组件同目录的 vendor/ 下；从自身 <script src> 推导基路径，
  // 中文页（assets/）与英文页（../assets/）都能正确解析。
  function qrLibUrl() {
    var el = document.currentScript ||
      document.querySelector('script[src$="donation.js"]');
    var base = el && el.src ? el.src.replace(/[^/]*$/, '') : '';
    return base + 'vendor/qrcode-generator.js';
  }

  function isMobileUA() {
    return /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  }

  function isOpen() {
    return overlay && !overlay.hidden;
  }

  // ---------- 提示文案（构建期经 #donation-dialog 的 data-* 注入） ----------

  function updateHint() {
    // 手机端支付宝尝试跳转后，给出「没有自动打开」兜底提示；其余场景为扫码提示
    if (currentChannel === 'alipay' && isMobileUA()) {
      hintEl.textContent = texts.fallbackHint;
    } else {
      hintEl.textContent = currentChannel === 'alipay' ? texts.scanAlipay : texts.scanWechat;
    }
  }

  // ---------- 二维码（客户端实时生成） ----------

  function loadQrLib() {
    if (window.qrcode) return Promise.resolve();
    if (!qrLibPromise) {
      qrLibPromise = new Promise(function (resolve, reject) {
        var script = document.createElement('script');
        script.src = qrLibUrl();
        script.onload = function () { resolve(); };
        script.onerror = function () {
          qrLibPromise = null;
          reject(new Error('QR library failed to load'));
        };
        document.head.appendChild(script);
      });
    }
    return qrLibPromise;
  }

  function drawQrCode(channel) {
    loadQrLib().then(function () {
      var qr = window.qrcode(0, QR_ECC);   // typeNumber 0 = 按内容自动选择
      qr.addData(DONATION_CONFIG[channel].qrContent);
      qr.make();

      var modules = qr.getModuleCount();
      var total = modules + QR_QUIET_MODULES * 2;
      // 整数倍缩放保证模块边缘锐利；实际画布尺寸略小于等于展示尺寸
      var px = Math.max(1, Math.floor(QR_DISPLAY_SIZE / total));
      var canvasSize = px * total;
      canvas.width = canvasSize;
      canvas.height = canvasSize;

      var ctx = canvas.getContext && canvas.getContext('2d');
      if (!ctx) return;   // 环境不支持 canvas 时跳过绘制（提示文案仍可用）

      ctx.fillStyle = '#ffffff';   // 浅色背景
      ctx.fillRect(0, 0, canvasSize, canvasSize);
      ctx.fillStyle = '#111111';   // 深色前景，高对比度
      for (var row = 0; row < modules; row++) {
        for (var col = 0; col < modules; col++) {
          if (qr.isDark(row, col)) {
            ctx.fillRect((col + QR_QUIET_MODULES) * px, (row + QR_QUIET_MODULES) * px, px, px);
          }
        }
      }
    }).catch(function () {
      hintEl.textContent = texts.qrError;
    });
  }

  // ---------- 弹窗 ----------

  function renderTabs() {
    tabAlipay.classList.toggle('active', currentChannel === 'alipay');
    tabAlipay.setAttribute('aria-pressed', String(currentChannel === 'alipay'));
    tabWechat.classList.toggle('active', currentChannel === 'wechat');
    tabWechat.setAttribute('aria-pressed', String(currentChannel === 'wechat'));
  }

  function openDialog(channel) {
    currentChannel = channel || 'alipay';
    attemptedOpen = false;
    lastFocused = document.activeElement;
    overlay.hidden = false;
    renderTabs();
    updateHint();
    drawQrCode(currentChannel);
    if (currentChannel === 'alipay') attemptAlipayOpen();
    (currentChannel === 'alipay' ? tabAlipay : tabWechat).focus();
  }

  function closeDialog() {
    overlay.hidden = true;
    if (lastFocused && typeof lastFocused.focus === 'function') lastFocused.focus();
  }

  function switchChannel(channel) {
    if (currentChannel === channel) return;
    currentChannel = channel;
    renderTabs();
    updateHint();
    drawQrCode(channel);
    if (channel === 'alipay') attemptAlipayOpen();
    (channel === 'alipay' ? tabAlipay : tabWechat).focus();
  }

  // 手机端支付宝：直接打开官方收款链接，由支付宝页面/浏览器自行处理 App 唤起。
  // 不构造自定义 URL scheme；弹窗内二维码始终可见，天然兜底，不会进死胡同。
  function attemptAlipayOpen() {
    if (attemptedOpen || !isMobileUA()) return;
    attemptedOpen = true;
    window.open(DONATION_CONFIG.alipay.qrContent, '_blank', 'noopener');
  }

  // ---------- 初始化 ----------

  function bind() {
    overlay = document.getElementById('donation-dialog');
    if (!overlay) return;
    tabAlipay = document.getElementById('donation-tab-alipay');
    tabWechat = document.getElementById('donation-tab-wechat');
    canvas = document.getElementById('donation-qr');
    hintEl = document.getElementById('donation-hint');
    entryBtn = document.getElementById('donate-entry');
    texts = {
      scanAlipay: overlay.dataset.scanAlipay,
      scanWechat: overlay.dataset.scanWechat,
      fallbackHint: overlay.dataset.fallbackHint,
      qrError: overlay.dataset.qrError
    };

    entryBtn.addEventListener('click', function () { openDialog('alipay'); });
    tabAlipay.addEventListener('click', function () { switchChannel('alipay'); });
    tabWechat.addEventListener('click', function () { switchChannel('wechat'); });
    document.getElementById('donation-close').addEventListener('click', closeDialog);

    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) closeDialog();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && isOpen()) closeDialog();
    });
  }

  bind();

  // 供主脚本查询弹窗状态（如搜索快捷键让位）
  window.Donation = {
    isOpen: isOpen,
    open: openDialog,
    close: closeDialog,
    config: DONATION_CONFIG
  };
})();
