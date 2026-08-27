# Chess Rules Validation

## Summary

"Code decides chess rules" is the project's first design principle, implemented in two layers: at build time, every lesson is replay-validated against real chess rules with chess.js (illegal data fails the build); at runtime, a small in-house engine judges every move in the browser.

## Background

Every solution move and opponent reply in the lesson JSON is hand-written (by a human or a model). One illegal move puts the reader in an impossible position and destroys the lesson's credibility. The first version (2026-07-28) validated formats and basic moves; milestone M2 (2026-08-07, `fbbd042`) added the special rules and extracted a standalone engine.

## Problem

1. Hand-written FENs and UCI moves go wrong easily: a promotion missing its 5th character, castling written as a rook move, an opponent reply contradicting the resulting position.
2. Shipping chess.js (~100 KB+) in the browser conflicts with the lightweight-static-page goal — but a hand-rolled engine is more dangerous than none unless fully tested.
3. Validation failures must fail the build, not warn.

## Goals

- Build time: replay every solution move, alternative and opponent reply under real chess rules; any illegality fails the build.
- Browser: castling (with rights), promotion (5-char UCI), en passant, check/checkmate; pure functions, no DOM, Node-testable.
- The validator also covers: field completeness, FEN shape, odds summing to 100, quick-Q&A pairing, prerequisite dead links, slug uniqueness.

## Non-Goals

- No engine evaluation (odds are author-written teaching estimates).
- No opening books or endgame tables.
- It does not stop an author from writing a *legal but bad* lesson — quality is human review's job.

## Solution Overview

Two independent layers with clear responsibilities:

```text
Build time (Node): content/*.json
  └─ scripts/validate-content.mjs ── replays with chess.js
       move / opponent / alternatives all verified; failure exits non-zero

Runtime (browser): assets/chess-engine.mjs (in-house, ~350 lines)
  └─ parseFen / legalTargets / applyMove / inCheck / isCheckmate
       every click and every opponent reply in app.js goes through it
```

Why not chess.js in the browser: the interaction needs only "legal move generation + application + check detection" for one small position; an in-house implementation is smaller and avoids the download. The risk is contained by engine unit tests and the per-lesson walkthrough regression (`tests/lessons-walkthrough.test.mjs`), which replays every solution and reply of every lesson. chess.js appears only at build time and in tests — never in the browser bundle.

Opponent replies are validated again in the browser (`app.js` defense): even with corrupted data the user sees an explicit error instead of getting stuck.

## Detailed Behavior

- UCI notation: normal 4 chars (`e2e4`); promotion 5 chars (`e7e8q`, last char `q/r/b/n`); castling as the king's from→to (`e1g1`).
- FEN fields 3 (castling rights) and 4 (en-passant target) are parsed and maintained by the engine.
- Validator output is `file: reason` (`duplicate slug`, `invalid FEN`, `odds ... do not sum to 100`, …) and fails the build.

## Compatibility and Historical Impact

- After the 2026-08-07 engine upgrade, early lessons relying on lenient behavior were corrected step by step; `60ac119` added the walkthrough regression so any lesson-data change is replay-verified.
- No runtime behavior broke: browser-engine agreement with build-time validation is test-enforced.

## Data and Privacy Impact

Purely local computation; no network.

## Performance Impact

The in-house engine's cost on 64 squares is negligible; the build-time chess.js replay is a few dozen moves per lesson, and the whole test suite finishes in ~17 seconds locally.

## Limitations

- The engine does not implement threefold repetition, the 50-move rule or insufficient-material draws (never reached within a lesson).
- The validator does not judge prose quality, victory claims, or the plausibility of odds values (beyond normalization).

## Release Information

Introduced: Unreleased (initial 2026-07-28; engine upgrade 2026-08-07)

Status: Stable

## Related Documentation

- [Development Guide: Lesson JSON Structure](../development.md#lesson-json-structure)
- [Architecture: Determinism Boundaries](../architecture.md#determinism-boundaries)
- `doc/DESIGN.md` (historical design record)

## Feature Changelog

### 2026-08-07

Engine supports castling/promotion/en passant/check-mate and is extracted into its own module; opponent replies validated; alternatives introduced.

### 2026-07-28

Initial validator and build-time checks; JSON lesson framework.
