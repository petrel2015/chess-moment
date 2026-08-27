# Usage Guide

How to use Chess Moment. Project overview lives in the [README](../../README.md).

## Opening the Site

Visit <https://petrel2015.github.io/chess-moment/>. Best on a mobile browser; desktop works too. No sign-up, no login.

## Home and Archive

The homepage automatically features "today's" lesson: the lesson whose `publishedAt` month/day matches today (year is ignored); if nothing matches, the most recent lesson is shown. The "Archive" section at the bottom lists every other lesson with date, category and tags. A lesson may start with a "Prerequisite" link to an earlier lesson.

## Reading a Lesson

Each lesson has four parts, top to bottom:

1. **Story**: cultural/historical background and the position setup.
2. **Today's Challenge**: the interactive board (next section).
3. **Review**: step-by-step explanations and a one-line principle.
4. **Archive**: links to other lessons.

## Today's Challenge

Challenges are 3–5 move endgame/tactics exercises where you play White:

1. **Select a piece**: click a white piece — its legal target squares are highlighted (or simply drag the piece).
2. **Play the move**: click a target square. A correct move gets a green feedback ring, the progress bar advances, and the opponent replies automatically ("Opponent is replying…"). A wrong move gets a red ring with a one-line explanation; keep trying.
3. **Alternatives**: some steps have "reasonable but not best" moves — they get an amber explanation but do not count toward progress.
4. **Completion**: finishing all steps shows a celebration; the review section below explains every step.

Above the board sits the material & win-odds panel: material scores for both sides and a teaching win-probability bar (updated per move; a pedagogical estimate from the lesson data, not an engine evaluation).

### Helper Buttons

- **Hint**: a nudge in the right direction (never the answer).
- **Reset**: back to the starting position.
- **Report**: opens your mail client pre-filled with the lesson, the current FEN and your move progress.

## Asking the AI Coach

Below the challenge is the "Ask Coach" box:

- Type a question (e.g. "Why doesn't promoting to a rook work?") and press "Ask Coach".
- Or tap one of the quick-question buttons (3–4 pre-written common questions per lesson).
- The coach answers in the page language, within ~150 words, and is **never allowed to state the solution moves** — it explains ideas, rules and notation so the "aha" stays yours.
- The answer area shows the source: a real AI (current platform) or "pre-written reference" (when every AI path is unavailable).

Provider and key configuration: [Configuration](./configuration.md).

## Language

- First visit follows your browser language (Chinese by default).
- The header toggle ("English / 中文") switches instantly; your choice is stored in the browser and wins on later visits.
- Pages mirror one-to-one: Chinese at the root (`/rook-ladder.html`), English under `en/` (`/en/rook-ladder.html`).

## Donations

The footer has an optional "buy me a coffee" entry. On mobile it opens Alipay/WeChat directly; on desktop a QR code is shown. Completely optional.

## Known Boundaries

- The review section is always visible — whether to peek early is up to you.
- The odds bar is a teaching estimate (see [FAQ](./faq.md#is-the-odds-bar-computed-by-an-engine)).
- The AI coach depends on third-party free models and may fall back to pre-written answers (see [Troubleshooting](./troubleshooting.md)).
