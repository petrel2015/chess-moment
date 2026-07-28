# Chess Moment agent instructions

This repository is maintained as a low-cost, model-replaceable automation that
Hermes Agent can operate. Read these files before changing code:

- `doc/WECHAT_PIPELINE_PLAN.md`
- `doc/WECHAT_PIPELINE_DESIGN.md`
- `doc/WECHAT_PIPELINE_ACCEPTANCE.md`

Implementation rules:

- Content JSON is the single source of truth. Do not hand-maintain a second
  copy of lesson prose for WeChat.
- Deterministic code owns validation, rendering, URLs, retries, idempotency and
  diagnostics. A model may draft prose, but may not decide whether chess moves
  are legal.
- Preserve the existing interactive lesson behavior, mobile tap path, drag
  path, immediate explanation, red/green feedback and notation help.
- The WeChat article must be useful and self-contained. Do not hide the answer
  behind the “阅读原文” link.
- Never commit AppSecret, access tokens, cookies or generated credential files.
- Do not call real WeChat publishing APIs, push to GitHub, merge branches or
  create scheduled jobs while implementing this task. Use mocks and dry-run
  paths only.
- Keep dependencies small and justified. Prefer Node.js standard-library APIs.
- Add or update automated tests for every deterministic behavior.
- Run the complete acceptance commands and leave structured diagnostics for
  every failure.
