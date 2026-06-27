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
| `groups_index` | `groups/index.json` |
| `event_group` | `groups/{slug}.json` |
| `video` | `videos/{id}.json` |
| `user` | `users/{id}.json` |
| `search_index` | `search-index-lite.json` |

`score-recalc` updates `videos.score` directly. The old stats table is not used.
