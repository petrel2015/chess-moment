# Feature Documentation

This section documents major features: motivation, scope, design decisions, compatibility considerations, and release history.

The project has not declared a released version yet (no git tags or GitHub releases; `package.json` declares 1.0.0), so every feature's "introduced" field is **Unreleased** with the first-ship date noted. Detailed history: [CHANGELOG](../../../CHANGELOG.md). 中文版：[docs/zh/features/](../../zh/features/index.md)。

| Feature | Introduced | Status | Description |
| --- | --- | --- | --- |
| [Interactive Lessons](./interactive-lessons.md) | 2026-07-27 | Stable | Tap/drag board play, green/red feedback, opponent replies, instant review |
| [Daily Homepage and Archive](./daily-homepage.md) | 2026-07-28 | Stable | Date-driven homepage, archive cards, tags and prerequisites |
| [Chess Rules Validation](./chess-rules-validation.md) | 2026-07-28 (upgraded 2026-08-07) | Stable | Browser-side move judging + build-time chess-rule validation |
| [WeChat Dual Output](./wechat-dual-output.md) | 2026-07-28 | Stable | Same JSON renders the WeChat article and publish payloads |
| [AI Coach](./ai-coach.md) | 2026-08-12 (zero-config since 2026-08-14) | Stable | Multi-provider AI Q&A that never reveals the answer; pre-written fallback |
| [Bilingual Site](./bilingual-site.md) | 2026-08-14 | Stable | Chinese/English pages, auto detection, remembered manual toggle |
