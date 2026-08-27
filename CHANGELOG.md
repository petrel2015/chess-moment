# Changelog

All notable changes to this project are documented in this file.

The project has not declared a released version yet: `package.json` declares `1.0.0`, but no git tags or GitHub releases exist, so all history lives under **[Unreleased]**. Entries carry the date of the change (from git history) instead of version numbers. The format is inspired by [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

中文版见 [CHANGELOG.zh.md](./CHANGELOG.zh.md)。

## [Unreleased]

### 2026-08-27

- Added: configurable AI provider — the coach settings panel accepts an OpenRouter, DeepSeek or Zhipu GLM key and stores it in the user's browser only.
- Added: repository documentation system (README in English and Chinese, README_FOR_AI, docs/ in both languages, feature design documents, this changelog).

### 2026-08-14

- Added: AI coach works out of the box — an obfuscated OpenRouter key embedded in the frontend drives free models directly from the browser; the AI settings panel was removed again in favor of the zero-config default.
- Added: retry plus model-fallback chain for OpenRouter free models (`OPENROUTER_MODELS`), with the fallback reason surfaced to the user.
- Fixed: the coach fell back to pre-written answers on non-Chinese pages because `currentLang` was not imported; English coach answers now work.
- Added: keyless third-party relay (Pollinations) as an experimental zero-config coach path with automatic fallback to pre-written answers.
- Added: bilingual site — English pages under `en/`, browser-language detection, manual language toggle with stored preference, and English copy for all lesson content JSON. Test coverage added for localization, language routing and English pages.

### 2026-08-12

- Added: Alipay / WeChat donate buttons in the footer with QR-code fallback for desktop.
- Added: AI coach proxied through a Cloudflare Worker (Zhipu GLM-4-Flash), including the worker source and setup guide.

### 2026-08-11

- Fixed: guarded the opponent-reply window so a failed auto-reply can never leave the user stuck without feedback.
- Added: per-lesson walkthrough regression tests verifying every move and opponent reply for legality.
- Changed: homepage now selects the lesson matching today's date (month/day), with graceful fallback to the most recent lesson; piece image optimization; in-page problem reporting (mailto).

### 2026-08-07

- Added (M2): upgraded rules engine extracted to `assets/chess-engine.mjs` — castling, promotion (5-character UCI moves), en passant, check/checkmate — unit-tested in pure Node.
- Added (M2): alternative moves (`step.alternatives`) for reasonable-but-not-best branches — explained in amber without counting progress.
- Added (M2): lesson tags and prerequisites with dead-link validation; shown on archive cards and lesson pages.
- Merged: WeChat dual-output publishing pipeline integrated with M2 features.

### 2026-07-27 / 2026-07-28 (initial development)

- Added: first public version of the interactive chess daily — JSON lesson framework with five courses, board-level move feedback, legal-move enforcement, material and win-odds panel, drag-and-drop moves, notation tooltips, check/checkmate feedback.
- Added: deterministic build (`scripts/build-site.mjs`) with schema, FEN, move-format, odds and cross-link validation; homepage + archive.
- Added: WeChat dual-output publishing pipeline (article renderer, board PNGs, payload audit, dry-run publisher, mock server).
- Added: GitHub Pages deployment workflow; iPhone home-screen branding.
