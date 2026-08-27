# Chess Moment 棋刻

English | [简体中文](./README.zh.md)

[![Deploy Chess Moment](https://github.com/petrel2015/chess-moment/actions/workflows/pages.yml/badge.svg)](https://github.com/petrel2015/chess-moment/actions/workflows/pages.yml)
![Node](https://img.shields.io/badge/Node.js-20%2B-339933)
![chess.js](https://img.shields.io/badge/rules-chess.js-8A2BE2)
![Frontend](https://img.shields.io/badge/frontend-vanilla_JS-f7df1e)

Three minutes a day to understand one chess move.

Chess Moment is a mobile-first, interactive chess daily for beginners and casual players. Each day brings one short lesson: read the story, play the key moves on a real board, get instant green/red feedback with an explanation for every mistake, and ask an AI coach when you are stuck. The whole site is static — no account, no install, no cost.

> AI assistants and agents: for a structured, machine-friendly description of this project, see [README_FOR_AI.md](./README_FOR_AI.md).

## Live Demo

**[Open Chess Moment →](https://petrel2015.github.io/chess-moment/)**

Works directly in a mobile browser; on iPhone it can be added to the home screen like an app.

## Why This Project

Beginners don't lack large platforms — they lack a low-friction daily habit: a three-minute lesson with a real board to touch, where every wrong move is explained immediately. Chess Moment turns "read a story → play a few moves → get instant explanations" into a daily push, with all logic running locally in the browser. No backend, no sign-up.

## Core Features

### Interactive Lessons

Every lesson combines a culture/history story, a tap-or-drag board challenge, explanations of wrong moves, an instant review after completion, and hover glossary for chess notation. Correct moves get a green ring, wrong moves get red with a reason; the opponent replies automatically after each correct move; reasonable-but-not-best alternatives get an amber explanation.

![Interactive challenge](docs/img/challenge.webp)

[Usage Guide](./docs/en/usage.md) · [Feature Design](./docs/en/features/interactive-lessons.md)

### Instant Feedback with Opponent Replies

Every move is validated in the browser by a built-in rules engine. Correct moves show a green feedback ring and trigger the opponent's automatic reply; the teaching win-probability bar updates after each move.

![Move feedback](docs/img/move-feedback.webp)

[Usage Guide](./docs/en/usage.md#todays-challenge) · [Rules Engine Design](./docs/en/features/chess-rules-validation.md)

### AI Coach

Ask a question in the "Ask Coach" box and get an AI answer in the page language. The coach is prompt-constrained to explain ideas, rules and notation — never to reveal the solution moves. It works out of the box (an obfuscated OpenRouter free-model key is embedded), or you can plug in your own OpenRouter / DeepSeek / Zhipu GLM key in "AI Settings". If every AI path fails, it falls back to pre-written answers so users are never blocked.

![AI coach settings](docs/img/coach-settings.webp)

[Configuration](./docs/en/configuration.md) · [Feature Design](./docs/en/features/ai-coach.md)

### Bilingual (Chinese / English)

All lesson content and UI copy exist in both languages. English pages live in the `en/` subdirectory; the site auto-redirects by browser language, and a manual toggle remembers your choice.

![English homepage](docs/img/overview-en.webp)

[Usage Guide](./docs/en/usage.md#language) · [Feature Design](./docs/en/features/bilingual-site.md)

### Daily Homepage and Archive

The homepage automatically shows "today's" lesson (matched by month/day); all other lessons become archive cards with tags, prerequisite links, and a problem-report button (email).

![Mobile layout](docs/img/mobile-layout.webp)

[Usage Guide](./docs/en/usage.md#home-and-archive) · [Feature Design](./docs/en/features/daily-homepage.md)

### WeChat Dual Output

The same lesson data also generates a second reading form: a text-plus-static-board-image article for WeChat official accounts, plus a structured payload. The WeChat "Read original" link goes straight to that lesson's interactive page.

[Feature Design](./docs/en/features/wechat-dual-output.md)

## How It Works

Lesson JSON (`content/*.json`) is the single source of truth. Build scripts validate every lesson against real chess rules (chess.js), then generate bilingual interactive pages, WeChat preview pages, static board PNGs and publishing payloads. Board interaction, move validation and the AI coach all run locally in the browser — there is no backend.

```text
content/*.json → validate (real chess rules) → _site/ (zh pages + en/ pages + WeChat previews + board PNGs) → GitHub Pages
```

[Architecture](./docs/en/architecture.md) · [Content Schema and Validation](./docs/en/features/chess-rules-validation.md)

## Quick Start

Requires Node.js 20+ (local development uses 22, CI uses 24).

```bash
git clone https://github.com/petrel2015/chess-moment.git
cd chess-moment
npm ci
npm test                # 173 tests: schema, chess rules, build, walkthrough regression, i18n
npm run build           # generates _site/ (interactive pages + WeChat previews + board PNGs)
python3 -m http.server 8000 --directory _site
```

Open <http://localhost:8000>. There is no bundler and no dev server — edit code and refresh.

## Adding a New Lesson

1. Add one file `content/YYYY-MM-DD-topic.json` (copy the structure of an existing lesson, with both Chinese and English copy).
2. Run `npm test` — the validator checks schema, FEN, move legality (including opponent replies), odds normalization, quick-question pairing and prerequisite dead links.
3. Run `npm run build` and play through every step locally.
4. Commit and push; GitHub Actions deploys automatically.

Full field reference in the [Development Guide](./docs/en/development.md).

## Tech Stack

- Vanilla HTML / CSS / JavaScript (ES Modules) — no framework, no bundler
- Node.js scripts for validation and build (`node:test` runner)
- [chess.js](https://github.com/jhlywa/chess.js) — build-time chess rule validation
- [pngjs](https://github.com/lukeed/pngjs) — static board PNG composition for WeChat
- A small in-house rules engine (`assets/chess-engine.mjs`) — browser-side move legality, check and checkmate
- GitHub Actions + GitHub Pages deployment

## Documentation

| Document | Description |
|----------|-------------|
| [Usage Guide](./docs/en/usage.md) | How to use lessons, the AI coach and language switching |
| [Configuration](./docs/en/configuration.md) | AI coach providers and keys, build-time environment variables |
| [Development Guide](./docs/en/development.md) | Directory layout, tests, build, full authoring workflow |
| [Architecture](./docs/en/architecture.md) | Data flow, frontend modules, determinism boundaries |
| [Deployment](./docs/en/deployment.md) | GitHub Pages and release flow |
| [Troubleshooting](./docs/en/troubleshooting.md) | Diagnosing common issues |
| [Privacy](./docs/en/privacy.md) | How data is handled and what leaves the browser |
| [FAQ](./docs/en/faq.md) | Frequently asked questions |

Design documents for major features (background, goals, non-goals, compatibility) are indexed in [Feature Documentation](./docs/en/features/index.md).

## Changelog and Roadmap

- Changelog: [CHANGELOG.md](./CHANGELOG.md)（中文：[CHANGELOG.zh.md](./CHANGELOG.zh.md)）
- Roadmap: see [`doc/ROADMAP.md`](./doc/ROADMAP.md) (next: learning paths, engine evaluation, automated production)

## Contributing

Found a mistake in a lesson or a bug on the page? Use the in-page "Report" button (opens an email) or [open an issue](https://github.com/petrel2015/chess-moment/issues). There is no formal contribution process yet — issues are welcome.

## License

No open-source license has been chosen yet. Until one is added, all rights are reserved by the author.
