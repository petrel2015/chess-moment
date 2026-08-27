# Deployment

Chess Moment is hosted on GitHub Pages and built by GitHub Actions.

## Live URLs

- Main site (Chinese): <https://petrel2015.github.io/chess-moment/>
- English version: <https://petrel2015.github.io/chess-moment/en/>

## Release Flow

The deploy workflow is [.github/workflows/pages.yml](../../.github/workflows/pages.yml):

1. Trigger: a push to a deploy branch touching `content/`, `scripts/`, `assets/`, `tests/`, `package.json`, the lockfile, or the workflow itself (docs-only changes do not deploy); manual runs via `workflow_dispatch`.
2. Build: `npm ci → npm test → npm run build` — failing tests or validation block the release.
3. Deploy: `_site/` is uploaded via `actions/upload-pages-artifact` and published with `actions/deploy-pages`.
4. Concurrency: the `pages` concurrency group cancels in-progress runs so deployments cannot land out of order.

## First-Time Setup / Switching Pages Modes

The workflow uses the Actions-artifact mode. If the repository's Pages setting is still "deploy from branch" (legacy), switch it under **Settings → Pages → Build and deployment → Source → GitHub Actions**, or via API:

```bash
gh api -X PUT repos/<owner>/<repo>/pages -f build_type=workflow
```

A `.nojekyll` at the repo root disables Jekyll processing; the `_site/` build also ships its own.

## Verifying a Release Locally

```bash
npm test && npm run build
python3 -m http.server 8000 --directory _site
```

Note that Pages serves under the `/chess-moment/` subpath: all site asset references are relative, so the build works directly under a subpath; previewing locally at the root is fine.

## Common Deployment Issues

- **No deploy after pushing**: check the workflow's `paths` filter; changes to `docs/` or `*.md` do not trigger a deploy.
- **Deploy succeeded but 404**: make sure you use the `/chess-moment/` prefix; `index.html` sits at the `_site/` root.
- **Worker coach path**: to enable the optional Worker proxy, set the `CHESS_COACH_WORKER_URL` repository secret; it is injected at build time (see [Configuration](./configuration.md)).

## Relation to Root HTML Files

The repo root also carries a copy of the generated interactive HTML (the output of `npm run publish:root`) for compatibility with the earlier "Pages serves the branch root directly" mode. With the Actions mode, live content comes from the `_site/` artifact; the root HTML remains as a direct-served fallback.
