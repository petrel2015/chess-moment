# WeChat Dual Output

## Summary

The same lesson JSON produces two reading forms: the interactive site version and the WeChat official-account article (plain text + a static board image + the full answer and explanation). The article's "Read original" link goes to that lesson's interactive page, not the homepage. The build also emits a structured payload with a credential-leak audit, and the publisher supports dry-run and mock modes.

## Background

The project's original form was a WeChat daily push (the repository folder is still named "chess daily push static page"). WeChat articles are a constrained rich-text environment: no JS, no embedded interactive boards — yet readers need the full solving experience.

## Problem

1. Hand-maintaining a second copy of lesson prose for WeChat would inevitably drift from the site.
2. The article cannot be interactive, so the answer must be written into the article itself (readers open it to read the explanation).
3. The WeChat publishing API requires AppSecret-class credentials that must never enter the repository.

## Goals

- Lesson JSON is the single source; the WeChat form is rendered deterministically from the same data.
- The article must be useful on its own: static board image + complete answer and explanation, never hiding the answer behind "Read original".
- The publishing chain must be testable: a mock server plus a dry-run mode; the real WeChat API is only called with explicit configuration.
- A credential found in a payload fails the build (`auditPayload`).

## Non-Goals

- No article-layout beautifier or third-party editor integration.
- No comment or message-reply operations features.
- No scheduled auto-publishing (the maintainer or an automation agent triggers runs).

## Solution Overview

Each build, `scripts/build-site.mjs` generates per lesson:

- `_site/wechat/<slug>.html`: the article preview (plain text plus `_site/wechat/assets/boards/<slug>.png`, a 480 px board composed with pngjs);
- `_artifacts/wechat/<slug>.payload.json`: the structured publish payload (title, body HTML, board image, original-content link pointing to the interactive page), audited by `auditPayload` — a credential hit fails the build.

The publisher adapter `scripts/wechat-publish.mjs` offers `prepare / publish / status / retry / list` subcommands with persistent state in `_artifacts/wechat/` (not committed); `publish` supports `--mode dry-run`, and `scripts/mock-wechat-server.mjs` fakes the WeChat API for tests. Credentials come from environment variables; no credential files exist in or are committed to the repository.

## Compatibility and Historical Impact

The pipeline evolved in parallel with the site and merged with M2 on 2026-08-07 (`9742e66`) to share the same content source. It has no effect on site readers — `_site/wechat/` is just an extra static preview directory. Previews are kept both in the repo root and in `_site` so layouts can be checked without the WeChat backend.

## Data and Privacy Impact

The maintainer's own credentials enter the publisher via environment variables and are never persisted or committed. No new reader-facing data handling.

## Limitations

- The WeChat form targets the maintainer's operations flow; readers normally never open `/wechat/` previews.
- The real WeChat API is only called after the maintainer explicitly configures credentials; CI and tests use mock/dry-run exclusively.

## Release Information

Introduced: Unreleased (2026-07-28)

Status: Stable

## Related Documentation

- Design and acceptance (maintainer docs): `doc/WECHAT_PIPELINE_DESIGN.md`, `doc/WECHAT_PIPELINE_ACCEPTANCE.md`, `doc/WECHAT_PIPELINE_PLAN.md`
- Command reference: the root [README](../../../README.md) and `doc/HERMES_OPS_HANDBOOK.md`

## Feature Changelog

### 2026-07-28

Initial release: article renderer, board PNGs, payload audit, dry-run publisher, mock server.
