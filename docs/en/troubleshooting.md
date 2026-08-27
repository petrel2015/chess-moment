# Troubleshooting

## Site Issues

| Symptom | Likely Cause | Fix |
|---------|--------------|-----|
| Blank page, no board | JavaScript disabled, or a very old browser | The board and challenge require JS (ES Modules); use a modern browser |
| Page bounces between Chinese and English | Stored language preference clashing with a manually typed URL | Toggle once with the header language button — the preference resets |
| Broken styles | Deploy/cache window in progress | Hard refresh (Cmd/Ctrl+Shift+R); Pages takes a few minutes after deploy |
| Wrong icon/title after adding to iPhone home screen | Home-screen cache | Remove the icon and add it again |

## Challenge Interaction

| Symptom | Likely Cause | Fix |
|---------|--------------|-----|
| Clicking a piece does nothing | You clicked a black piece or an empty square | Click one of your (white) pieces first, then a highlighted target square |
| Red feedback on a move | The move is not this lesson's solution (or is illegal) | The red feedback includes a one-line hint; try again or press "Hint" |
| Move "worked" but progress didn't advance | You hit a reasonable-but-not-best alternative (amber explanation) | Alternatives don't count; keep looking for the main line |
| Stuck on "Opponent is replying…" | A rare opponent-reply anomaly (defended against by design) | Press "Reset"; if it reproduces, use "Report" |

## AI Coach

| Symptom | Cause | Fix |
|---------|-------|-----|
| Instant "pre-written reference" answer | Every AI path unavailable (free models rate-limited / network blocked) | Retry later, or set your own OpenRouter/DeepSeek/GLM key in "AI Settings" |
| Answer language differs from the page | The coach follows the page language | Check the header language; switching the page switches the coach |
| Long wait, then fallback | Provider timeout (15 s frontend timeout) | Retry when the network recovers; free models get congested occasionally |
| Error mentions 429 / rate limit | Free-model rate limiting (observed occasionally, ~1 in 4 empty answers or 429s) | The frontend retries and falls back through the model list; worst case it shows pre-written answers |
| 401 / Invalid key | The key in "AI Settings" is invalid | Check the key and provider match; clear and save to restore the site default |
| CORS errors | Corporate proxies or blockers intercepting AI domains | Try another network, or configure your own key and allow the provider domain |

## Authors / Maintainers

| Symptom | Cause | Fix |
|---------|-------|-----|
| `npm test` fails with `invalid move` | Move is not UCI (promotions need 5 chars; castling is written as the king) | Fix per the reported file; format reference in the [Development Guide](./development.md#lesson-json-structure) |
| `opponent reply … illegal` | The `opponent` move is illegal in the position after your move | Re-derive the line; the validator names the move |
| `odds … do not sum to 100` | One step's three odds values don't sum to 100 | Normalize the odds array |
| `suggestion … has no answer` | A suggestion's `key` has no matching entry in `quick` | Add the answer or fix the key |
| `duplicate slug` / dead prerequisite link | Duplicate slug or `prerequisites` pointing to a missing lesson | Fix the slug or the prerequisite list |
| Homepage doesn't show the new lesson | The homepage matches today's month/day against `publishedAt` | Showing the latest lesson on a non-matching day is expected; pin dates in tests with `CHESS_HOME_DATE` |

If nothing above helps, [open an issue](https://github.com/petrel2015/chess-moment/issues) or use the in-page "Report" button, which attaches an auto-generated position report.
