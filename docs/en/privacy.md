# Privacy

How Chess Moment handles data. Summary first: **reading, playing and pre-written answers happen entirely in your browser — nothing touches a server. The single exception is the AI coach, which sends your typed question to the AI provider in use when you explicitly ask.**

## What Is Not Collected

- No accounts: no sign-up, no login.
- No analytics: no analytics service, no tracking events.
- No cookies: the site does not use cookies.
- No backend: GitHub Pages serves static files only; there is no site-owned server and no database.

## Data Stored Locally (localStorage)

| Key | Content | How to remove |
|-----|---------|---------------|
| `chessMomentLang` | Language preference (zh/en) | Clear site data, or switch languages |
| `chessCoachProvider` | Your chosen AI provider (if configured) | Clear it in "AI Settings" |
| `chessCoachApiKey` | Your AI API key (if configured) | Clear it in "AI Settings" |

These never leave your browser; the site cannot (and does not) read them back.

## When Data Leaves the Browser

Exactly one case: **you tap "Ask Coach"**. Over HTTPS, the currently active AI platform receives:

- your question text;
- lesson context: title, goal, starting/current position FEN, step progress.

The receiver, by priority:

1. The provider you configured in "AI Settings" (OpenRouter / DeepSeek / Zhipu GLM) with your own key;
2. The site's embedded OpenRouter key (free models);
3. (If the maintainer configured one) the maintainer's Cloudflare Worker proxy;
4. (Experimental path) a third-party keyless relay (Pollinations).

Nothing else is ever sent anywhere. When the coach degrades to pre-written answers, your question text is not transmitted either.

## About the Embedded Default Key

The site embeds an obfuscated (XOR + Base64) OpenRouter key in `assets/coach-ai.mjs`, restricted to free models. It is restorable by anyone who reads the frontend source — a documented, deliberate trade-off whose only risk is free-quota consumption by others. You can override it with your own key in "AI Settings" at any time.

## User-Initiated External Actions

- **Report**: opens your local mail client pre-filled with lesson and position info; nothing is sent until you confirm.
- **Donate**: opens an Alipay/WeChat link or QR code; nothing happens until you continue.

Neither fires automatically.

## Third-Party Static Assets

The site loads no third-party analytics, fonts or CDN resources; pieces, styles and scripts are all self-hosted on GitHub Pages.
