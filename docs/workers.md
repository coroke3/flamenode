# Workers

FlameNode uses 3 Cron Workers in production.

| Worker | Cron | Main responsibility | Notes |
|---|---:|---|---|
| `fast-jobs` | `*/5 * * * *` | Slot reminder enqueue + notification dispatch | Uses `workers/notification-dispatcher/*` modules |
| `content-jobs` | `*/15 * * * *` | Static JSON rebuild queue + retention cleanup | Writes R2/KV static JSON |
| `sync-jobs` | `0 */12 * * *` | YouTube sync + score recalculation | Requires `YOUTUBE_API_KEY` for YouTube sync |

Legacy standalone worker entrypoints remain as importable modules, but their `wrangler.toml` files are intentionally removed. Deploy only:

```bash
cd workers/fast-jobs && wrangler deploy && cd ../..
cd workers/content-jobs && wrangler deploy && cd ../..
cd workers/sync-jobs && wrangler deploy && cd ../..
```

Static JSON targets currently supported by `content-jobs`:

| Target | Output |
|---|---|
| `top` | `top.json` |
| `list_recent` | `list/recent.json` |
| `list_popular` | `list/popular.json` |
| `events_index` | `events/index.json` |
| `event` | `events/{id}.json` |
| `video` | `videos/{id}.json` |
| `user` | `users/{id}.json` |
| `search_index` | `search-index-lite.json` |

`events_index` includes public event group sections for the public `/event` index. Dedicated group detail/static payloads are still not generated.

Queue targetは上表のcanonical値だけを受理する。旧別名や未知の値を正規化または
成功扱いにはせず、Workerの有限retry後に`failed`として可視化する。

`content-jobs` queue behavior follows `system_settings.operation_mode`. The worker
does not collect Cloudflare usage, calculate thresholds, or change the mode. An
administrator observes Cloudflare Dashboard and changes `operation_mode` manually
from `/admin/cost-guard`. Feature-specific overrides expire after exactly 15
minutes. Entering or leaving `maintenance` uses the dedicated maintenance action,
not the normal mode-change action.

| Mode | Queue behavior |
|---|---|
| `normal` | Up to 20 pending rows per run, includes stale queue reconciliation |
| `economy` | Up to 5 rows per run; `search_index` / `list_popular` are skipped unless priority is `high` |
| `read_only` | Processes only `event`, `video`, and `user` targets |
| `static_only` | Processes only `high` priority rows |
| `maintenance` | Does not process the queue |

`score-recalc` updates `videos.score` directly. The old stats table is not used.
