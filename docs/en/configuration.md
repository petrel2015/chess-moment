# Configuration

Chess Moment needs zero configuration for readers: open and play. This page lists every optional setting.

## AI Coach

### Reader Side (in the page)

The "AI Settings" entry on any lesson page offers:

| Setting | Meaning |
|---------|---------|
| AI provider | OpenRouter (free models) / DeepSeek / Zhipu GLM |
| API key | A key for the chosen provider; **leave empty to use the site default (embedded OpenRouter free-model key)** |

- Keys are stored only in your browser's localStorage (`chessCoachProvider` / `chessCoachApiKey`) — never uploaded, never in the source.
- Clearing the key and saving restores the site default.
- All provider endpoints are OpenAI-compatible and allow direct browser calls (CORS verified 2026-08):

| Provider | Endpoint | Model |
|----------|----------|-------|
| OpenRouter | `https://openrouter.ai/api/v1/chat/completions` | free-model chain (primary `nvidia/nemotron-3-ultra-550b-a55b:free`, two fallbacks) |
| DeepSeek | `https://api.deepseek.com/chat/completions` | `deepseek-chat` |
| Zhipu | `https://open.bigmodel.cn/api/paas/v4/chat/completions` | `glm-4-flash` (free) |

### Maintainer Side (embedded default key)

The site default key is embedded in `assets/coach-ai.mjs` as an XOR + Base64 **obfuscated** constant (`DEFAULT_OR_KEY_OBF`) and is used only with free models ($0 cost). To replace it (see also `doc/AI_SETUP.md`):

```bash
node -e 'import("./assets/coach-ai.mjs").then(m => console.log(m.encodeKeyObfuscation("YOUR_KEY", "chess-moment-obf-2026")))'
```

Replace `DEFAULT_OR_KEY_OBF` with the output and rebuild.

> ⚠️ Obfuscation is not encryption: anyone can restore the plaintext. **Never top up the embedded key.** For paid models, use your own key in "AI Settings", or the Worker approach below.

### Optional: Cloudflare Worker Proxy (legacy path)

The server-side-key option: deploy `worker/chess-coach-worker.mjs` to Cloudflare Workers with your provider key as a secret, then set the Worker URL as the repository secret `CHESS_COACH_WORKER_URL` (or a build environment variable); it is injected into every page's `window.CHESS_COACH_CONFIG` at build time. When unset the value is an empty string and the frontend skips this path. Full steps in `doc/AI_SETUP.md`.

Priority (high to low): **user's provider+key > embedded OpenRouter key > Worker (if configured) > keyless relay (experimental) > pre-written answers**.

## Build-Time Environment Variables

| Variable | Effect |
|----------|--------|
| `CHESS_HOME_DATE` | Pins the homepage's "today" (ISO date) for reproducible test/CI builds; production builds use the real clock |
| `CHESS_COACH_WORKER_URL` | Injects the optional Worker proxy URL; empty by default |

## Site Icons and PWA Metadata

`assets/site.webmanifest`, `assets/icons/` and the apple-touch meta tags in each page's `<head>` provide the add-to-home-screen experience; no configuration needed.

## Default Language

The site defaults to Chinese. The reader's language follows the browser (`navigator.language`); a manual choice is remembered. Maintainers configure nothing.
