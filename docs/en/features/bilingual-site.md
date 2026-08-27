# Bilingual Site

## Summary

The whole site exists in Chinese and English: Chinese pages at the root, English pages under `en/`, one-to-one file names. The first visit follows the browser language; the header toggle switches instantly and remembers the choice.

![English homepage](../../img/overview-en.webp)

## Background

Content started Chinese-only. English lesson copy landed in the lesson JSON first (`*_en` fields, 2026-08-14, `42c6631`), followed the same day by page-level bilingualism (`700f91d`): the builder emits both page sets, UI copy moved into a dictionary, and language detection/switching arrived.

## Problem

1. Lesson prose, error explanations and reviews are long-form; translations must share the lesson JSON source — maintaining a second set of English pages by hand would drift.
2. UI copy scattered across HTML templates and JS would drift; it needs a single dictionary.
3. Chinese and English readers should each land directly in their language, not read Chinese and switch manually.

## Goals

- One lesson JSON renders both pages; the language is decided at build time (`<html lang>` fixed), with no runtime translation.
- Auto detection: stored preference first, then `navigator.language` (`zh*` → Chinese, `en*` → English, default Chinese).
- The toggle points at the sibling page (`/foo.html` ⇄ `/en/foo.html`) with `hreflang`, writing localStorage on click.
- Chinese output kept structurally identical to the pre-bilingual version (risk control: bilingualization must not change the Chinese site's behavior).

## Non-Goals

- No runtime language switching (switching = navigating to the sibling page).
- No languages beyond Chinese/English (the i18n layer is parameterized, but there is no demand yet).
- `doc/` historical documents and the WeChat output are not translated.

## Solution Overview

- `assets/i18n.mjs`: the `UI` dictionary (piece names, status copy, buttons, settings panel, donations — all UI strings) plus `resolveLanguage`/`siblingPath` pure functions. Build scripts and the frontend import the same dictionary.
- `renderLesson(lesson, { locale })` in `scripts/build-site.mjs`: one template renders both languages; English pages get a `../` asset prefix; `localizeLesson` selects `*_en` fields by locale.
- A non-module detection snippet inlined in `<head>` runs `location.replace` early, avoiding render-then-jump flicker; its logic mirrors `resolveLanguage`/`siblingPath`.

## Detailed Behavior

- Detection runs inline per page: `localStorage.chessMomentLang` (`zh`/`en`) wins; otherwise the `navigator.language` prefix decides; default Chinese.
- The header toggle and auto-redirect both use sibling relative paths, so Pages subpath deployments work (`/chess-moment/…` ⇄ `/chess-moment/en/…`).
- Coach answers follow the page language (`currentLang()`).

## Compatibility and Historical Impact

- Chinese output was deliberately kept byte-for-byte structurally identical to the pre-bilingual version (verified when `adc086d` regenerated the root HTML).
- Auto-redirect changes "visit the Chinese page directly": an English browser is `location.replace`d to the `en/` version. That is the feature's semantics; one manual toggle stores a preference. No URLs break.

## Data and Privacy Impact

One new localStorage key, `chessMomentLang`, storing only the language preference. No network requests.

## Limitations

- Switching is page-level navigation; an in-progress challenge does not carry across languages.
- `doc/` and WeChat output are not localized.

## Release Information

Introduced: Unreleased (2026-08-14)

Status: Stable

## Related Documentation

- [Usage Guide: Language](../usage.md#language)
- [Architecture: Language Routing](../architecture.md#language-routing)
- Tests: `tests/i18n.test.mjs`

## Feature Changelog

### 2026-08-14

Initial release: English lesson copy, `en/` pages, auto detection, manual toggle; localization and language-routing tests.
