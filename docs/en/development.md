# Development Guide

For running the project locally, authoring lessons, or contributing code.

## Requirements

- Node.js 20+ (local development typically 22; CI uses Node 24). Build and tests rely only on Node built-ins (`node:test`, `fs/promises`, fetch) — no global tools.
- Any static file server for previewing (e.g. `python3 -m http.server`).

## Common Commands

```bash
npm ci                # install dependencies (per package-lock.json)
npm run validate      # content validation only (real chess rules + schema + links)
npm test              # full test suite (173 tests, run serially to avoid shared _site races)
npm run build         # optimize piece images + generate _site/ (idempotent: deletes first)
npm run publish:root  # build and sync interactive HTML to the repo root (legacy direct-served Pages mode)
```

There is no dev server and no bundler: edit code and refresh. WeChat adapter commands are covered in the [feature doc](./features/wechat-dual-output.md).

## Directory Layout

```text
content/            lesson JSON (single source of truth, one file per lesson)
scripts/            validation, build, WeChat render/publish, board PNG, image optimization
assets/
  app.js            board interaction, feedback, tooltips, coach UI, language toggle, donations
  chess-engine.mjs  browser-side rules engine (castling / promotion / en passant / check / mate)
  coach-ai.mjs      coach pure-logic layer (request building, providers, key obfuscation)
  i18n.mjs          UI copy dictionary + language resolution (shared by build and frontend)
  styles.css        site styles
  pieces/           transparent piece sprites (originals/ keeps pre-optimization art)
worker/             Cloudflare Worker proxy source (optional AI path)
tests/              node:test suites (content, engine, build, walkthrough, i18n, coach)
doc/                historical design/ops docs (DESIGN, AI_SETUP, ROADMAP, …)
_site/              build output (not committed)
_artifacts/wechat/  WeChat payloads and publish state (not committed)
docs/               this documentation system; docs/img/ holds shared screenshots
```

## Lesson JSON Structure

File name: `content/YYYY-MM-DD-topic.json`. Top-level fields:

| Field | Meaning |
|-------|---------|
| `slug` | Unique ID = page file name (e.g. `rook-ladder`) |
| `publishedAt` | ISO datetime; drives homepage selection and ordering |
| `edition` / `category` | "Morning/Evening edition" and category (endgame, opening, …) |
| `title` / `summary` / `topic` / `difficulty` / `duration` | Display metadata; difficulty 1–5 |
| `tags` / `prerequisites` | Optional tag array and prerequisite slug array (dead links fail validation) |
| `introduction` | Story paragraphs |
| `culture` | `{ title, content }` culture/history aside |
| `challenge` | The interactive challenge (below) |
| `review` | `{ title, steps[], principle }` |
| `*_en` | English copies of all copy fields (`title_en`, `challenge_en`, …) feeding the English pages |

Key `challenge` fields:

| Field | Meaning |
|-------|---------|
| `fen` | Starting position FEN |
| `goal` / `instruction` | Goal and how-to text |
| `steps[]` | Each `{ move, opponent?, note, alternatives? }`; `move` is UCI (normal `e2e4`, promotion `e7e8q`, castling as the king `e1g1`); `opponent` is the automatic reply (must be legal in the resulting position); `alternatives` lists reasonable non-best moves `[{ move, note }]` |
| `odds[]` | One teaching win-probability `{ white, draw, black }` per step; the three values must sum to 100 |
| `errors` / `genericError` | Explanations for specific wrong moves and the generic case |
| `success` | Completion message |
| `quick` / `suggestions` | Quick Q&A; each suggestion's `key` must have an answer in `quick` |
| `defaultAnswer` | Pre-written answer used when every AI path fails |

The validator (`scripts/validate-content.mjs`) checks all fields, FEN shape, the true legality of every solution move, alternative and opponent reply (via chess.js), odds normalization, Q&A pairing and prerequisite dead links, printing `file: reason` on failure. Design details: [Chess Rules Validation](./features/chess-rules-validation.md).

## Tests

`npm test` runs `tests/*.test.mjs` serially:

- **content.test.mjs** — schema and link validation
- **engine.test.mjs** — rules engine unit tests (castling, promotion, en passant, check/mate)
- **lessons-walkthrough.test.mjs** — plays every solution move and opponent reply of every lesson (protects against data corrupting the board)
- **build.test.mjs** — build output, bilingual pages, language routing
- **i18n.test.mjs** — localization and switching
- **coach-ai.test.mjs** — coach request building and provider chain (no network)
- **board-png / optimize-pieces / publisher / worker** — image composition, optimization, WeChat adapter

Add tests for new behavior. Set `CHESS_HOME_DATE=YYYY-MM-DD` to pin "today" for reproducible homepage builds.

## Build and Preview

```bash
npm run build
python3 -m http.server 8000 --directory _site
```

`build-site.mjs` deletes `_site/` and regenerates everything, so repeated builds are idempotent. Output:

- Chinese interactive pages (root) and English pages (`en/`), with the language-detection snippet inlined in `<head>`
- `_site/wechat/`: WeChat preview pages and static board PNGs
- `_artifacts/wechat/`: structured payloads (adapter input, credential-audited)

Local checklist: play every step at phone width, toggle languages, ask the coach (including offline fallback), check archive links.

## Release

Pushing to a deploy branch triggers GitHub Actions: `npm ci → npm test → npm run build → deploy _site/`. See [Deployment](./deployment.md).

## Documentation Conventions

User-visible changes should update: `README.md` / `README.zh.md` (positioning, features), `docs/{en,zh}/usage.md` (usage), the matching `features/` doc (design), and `CHANGELOG*.md`. For major features, add a design document following the format in the [feature index](./features/index.md).
