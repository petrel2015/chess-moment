# Architecture

Chess Moment is a fully static site: no backend of its own, no database, no server-side runtime logic. This page describes the data flow and module boundaries.

## Overall Data Flow

```text
                ┌────────────────────────┐
                │  content/*.json        │  single content source (zh + en copy in one file)
                └───────────┬────────────┘
                            │ npm run build
          ┌─────────────────┼──────────────────┐
          ▼                 ▼                  ▼
 scripts/validate-content.mjs   chess.js replay   assets/pieces optimization
          │                 │
          ▼                 ▼
    scripts/build-site.mjs (renderer, Node side)
          │
          ├── _site/index.html + <slug>.html        Chinese interactive pages
          ├── _site/en/…                            English interactive pages
          ├── _site/wechat/<slug>.html              WeChat article previews
          ├── _site/wechat/assets/boards/*.png      static board PNGs (pngjs)
          └── _artifacts/wechat/*.payload.json      WeChat payloads (not committed)
          │
          ▼
    GitHub Actions (npm test → npm run build)
          │
          ▼
    GitHub Pages (deploys _site/)
```

Validation failures fail the build: if any solution move, alternative or opponent reply is illegal under real chess rules, the site is not published.

## Frontend Modules

| Module | Responsibility |
|--------|----------------|
| `assets/app.js` | The only page script. Board rendering (tap and drag paths), legal-target highlighting, red/green feedback rings, opponent-reply window, progress, odds/material panel, notation tooltips, coach Q&A UI, AI settings panel, language toggle, donation modal, report-mail building |
| `assets/chess-engine.mjs` | Browser-side rules engine: FEN parsing, move generation and legality (castling, promotion, en passant), check/checkmate. Pure functions, no DOM, directly unit-tested in Node |
| `assets/coach-ai.mjs` | Coach pure-logic layer: system-prompt construction (never reveal solutions), OpenAI-compatible request building for OpenRouter/DeepSeek/GLM, the OpenRouter free-model chain, XOR+Base64 key obfuscation. Pure functions, no network |
| `assets/i18n.mjs` | The UI copy dictionary (shared by build scripts and the frontend to avoid dual maintenance) + `resolveLanguage`/`siblingPath` pure functions |

Lesson data is inlined per page as `window.CHESS_LESSON`, so pages are self-contained — sharing one lesson's URL reproduces it fully with no extra requests.

## Language Routing

- Chinese pages at the root, English pages under `en/`, one-to-one file names.
- A small non-module snippet inlined in each `<head>` runs early: stored choice (localStorage `chessMomentLang`) wins, then `navigator.language` (`zh*`/`en*`), default Chinese; on mismatch it `location.replace`s to the sibling page.
- The header toggle points at the sibling page with `hreflang`; clicking also writes localStorage.

## AI Coach Call Chain

All AI requests go directly from the browser (the supported provider APIs return CORS headers), with a 15-second timeout:

```text
user taps "Ask Coach"
  → user configured a provider + key? (localStorage)
      yes → use the selected platform (OpenRouter / DeepSeek / GLM)
      no  → embedded OpenRouter key (free models: retry primary → fall back down the model list)
          → (legacy path) Cloudflare Worker proxy (only if CHESS_COACH_WORKER_URL was injected at build time)
          → (experimental) keyless third-party relay (Pollinations)
          → all failed → pre-written answers (defaultAnswer / quick)
```

The system prompt hard-constrains the coach: explain ideas, rules and notation; never state the correct move sequence; ≤150 words; answer in the page language. Details: [AI Coach](./features/ai-coach.md) and [Configuration](./configuration.md).

## Determinism Boundaries

Design principle: **a model may draft prose; code decides everything that touches chess rules.**

- Field completeness, FEN shape, UCI move format, legality of solutions/alternatives/opponent replies, odds normalization, Q&A pairing, prerequisite dead links — all decided at build time by `scripts/validate-content.mjs` (via chess.js); failure blocks publishing.
- In-browser move legality, check and checkmate — decided by the in-house engine, covered by tests.
- 173 tests in total (`node:test`), including a per-lesson walkthrough regression that replays every solution and opponent reply.
- The homepage's "today" choice is made at build time from the system clock; tests/CI can pin it with `CHESS_HOME_DATE`.

## Backend and Third-Party Dependencies

- Normal operation (reading, playing, pre-written answers): GitHub Pages static hosting only.
- AI coach: the selected third-party AI platform (OpenRouter / DeepSeek / Zhipu) or the experimental relay — the site's only external runtime dependency, always backed by pre-written answers.
- The Cloudflare Worker (`worker/chess-coach-worker.mjs`) is an optional legacy path, enabled only when its URL is injected at build time.

## Relation to Historical Docs

`doc/DESIGN.md`, `doc/WECHAT_PIPELINE_DESIGN.md` and friends are earlier design records; they remain valid but this page and the feature docs are authoritative.
