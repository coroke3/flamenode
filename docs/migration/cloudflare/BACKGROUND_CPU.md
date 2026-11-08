# MIG-0609: Background Worker CPU — LOCAL only

> Status: **MEASURED (LOCAL, Linux, 2026-11-01). Not production numbers.**  
> Source: the three CURRENT background Workers (`content-jobs`, `fast-jobs`, `sync-jobs`). No Worker code, `wrangler.toml`, Cron, Queue or Cloudflare configuration was changed.  
> Reproduce: `node scripts/benchmark-background-cpu.mjs --run --out <report.json>` (about 26 minutes), then `node scripts/benchmark-background-cpu.mjs --render <report.json>` prints the tables below. Preparation: `node scripts/benchmark-background-cpu.mjs --dry-run`.

## Safety and measurement semantics

No Cloudflare account / remote D1 / R2 / secret / outbound HTTP is used. Wrangler runs with `--local --ip 127.0.0.1` against a temporary local D1 built from copies of the repo migrations. The wrapper installs a global `fetch` fail-closed trap **before** importing any CURRENT Worker module. While a named job runs, only fixed synthetic bodies for `discord.com` DM endpoints, `www.googleapis.com` (YouTube videos / playlistItems), `oauth2.googleapis.com/token` and `analyticsdata.googleapis.com …:runReport` are served; every other host (including Discord webhooks) throws, is counted as `outbound`, and the sample is invalid. Real external requests: **0** (the global `fetch` was replaced before any job code ran; the unit test counts calls reaching the real `fetch` = 0).

CPU = the V8 sampling profiler of workerd (non-idle samples, 100 µs interval) attached through the local inspector around one request. Wall time and wrangler's local `cpuTimeMs = 0` spans are not used. A sample is valid only when the **real job processed the seeded input** (`check()` per job: counters such as processed / deleted / acked / external calls must match); an empty run, a skipped run, HTTP 200 alone or an unknown outbound request makes the sample `unexpected` and the whole row INVALID.

Each named job runs the CURRENT job function directly inside the wrapper (no job code is edited) on a **freshly seeded** local D1 / R2 / KV before **every** sample (seeding is outside the profiled window; GA4 key / report pages are also prepared outside it). `cold` = a new isolate (the wrapper is rebuilt and the module is imported inside the profiled request), 50 rounds.

### What these numbers mean (read before using the caps)

* **The local D1 simulator is inside the numbers.** A trivial `SELECT 1` costs about **3.9 ms CPU** locally (calibration at the bottom), and the bench route itself costs about 2.8 ms. A production D1 call is a remote round trip whose wait is not Worker CPU. So every statement-heavy job is overstated here; the numbers are an **upper bound** and `cap = floor(7 ms / 1-item max)` collapses to `0` for every job, which is the literal Work Order formula and **not** a usable cap.
* **Host noise is large.** The same-run BASELINE (a no-op request, 10 warm-up runs discarded, 50 samples) has a max of 5.8–8.1 ms per Worker, i.e. the profiler / shared host alone nearly consumes the 8 ms budget (D-14-1 rule: BASELINE max >= 4 ms and job max 4–12 ms => INCONCLUSIVE). `score-recalc` is INCONCLUSIVE for the other reason: its max (15.77 ms) is outside the 4–12 ms band, but `judge()` subtracts the same-run noise (15.77 - 8.07 = 7.70 ms < 8 ms), so the local number cannot tell pass from fail.
* Jobs that are over budget by a wide margin **regardless of the simulator** (few D1 statements, large CPU): `static-rebuild-queue` limit (16 statements, p50 561 ms, heaviest probed target `search_index` over 300 videos), `queue-consumer-content` limit (same drain, 10 duplicate wakes coalesce into one), `ga4-ranking` (1 statement, p50 34 ms: 4,000 report rows parsed + ranked + RSA JWT signed), `playlist-sync` limit (5,000-row source diff).
* Jobs that **cannot be classified** from this run because the simulator dominates: `x-slot-bind-recovery` limit (216 statements), `audit-cleanup` limit (4,000 row changes), `notification-dispatch` limit (23 statements + 12 synthetic Discord requests), `slot-reminders` limit (52 statements). MIG-0610 must re-measure these with D1 replayed (MIG-0606 `--d1 replay` style: app code only) **before** lowering any constant. This is the follow-up this measurement hands to MIG-0610; no job code was changed here.

### Decision and handoff to MIG-0610

Decision adopted by owner authorization 2026-11-01: MIG-0609 records the CURRENT jobs as **simulator-inclusive LOCAL upper bounds** (Work Order scope: measure only, no job code and no change to `scripts/benchmark-api-cpu.mjs`, which MIG-0606 owns). Excluding the D1 simulator (the `--d1 replay` mode of `benchmark-api-cpu.mjs`) needs per-job statement recording and is therefore the first unit of MIG-0610 (new `T00`, added to `PHASE_6_SPEC.md`), not a cap source. Consequences:

* The `cap` column below is the literal Work Order formula, kept for the record only. It is `0` for every row and **must not be used to lower any constant**.
* MIG-0610 must run `T00` (re-measure with D1 replayed, same fixtures and the same G18 hash) before any constant is lowered; its `T01` is judged on that table.
* Jobs that are over budget independent of the simulator (static rebuild queue, GA4 ranking, playlist-sync limit, the content queue drain) are already known to need a split.

## Host and run conditions

| Item | Value |
| --- | --- |
| OS / kernel | Linux 6.18.44-fc-v185 (x64) |
| CPU | Intel(R) Xeon(R) Processor @ 2.10GHz, 4 cores (shared host, other agents were running) |
| node | v22.23.4 |
| wrangler | 4.118.0 (workerd via `@cloudflare/workerd-linux-64`) |
| Run | `node scripts/benchmark-background-cpu.mjs --run`, 2026-11-01, 10 warm-up runs discarded per kind, **50 samples per kind**, **50 cold rounds** |
| Sampling | V8 profiler 100 µs interval; resolution 0.1 ms (the largest single non-idle delta is also tracked) |
| Samples per row | normal 50 / limit 50 / invalid 50 / cold 50 for all 18 rows (every `unexpected` = 0) |

## U02 fixtures: what "normal / limit / invalid" mean per job

| Job (entry) | CURRENT cap used | normal | limit | invalid |
| --- | --- | --- | --- | --- |
| `cache-cleanup` (`workers/cleanup/incrementalCache.ts`) | `INCREMENTAL_CACHE_SCAN_LIMIT = 200` | 1 expired R2 object | 201 expired objects (200 scanned + deleted, truncated) | 10 objects with non-cache keys (0 deleted) |
| `audit-cleanup` (`runCleanupWithRetry`) | `AUDIT_CLEANUP_BATCH_LIMIT = 500` | 1 row in each of 8 retention predicates | 600 rows each (8 statements x 500 = 4,000 changes) | rows that match no predicate + invalid `audit_compact_after_days` |
| `x-slot-bind-recovery` | 5 requests x 30 slots | 1 request, 1 slot | 5 approved requests x 30 reserved slots (150 bound) | approved request whose X ID has no approved `x_users` row (completes, 0 bound) |
| `slot-reminders` | `REMINDER_LIMIT = 50` | 1 group | 60 groups (50 enqueued, 2 slots each) | deadline passed + notifications disabled |
| `notification-dispatch` | `MAX_NOTIFICATION_BATCH = 6`, 12 external requests | 1 DM (2 Discord requests) | 8 pending + 6 expired leases, unique Discord IDs (no DM cache): 6 delivered, 12 requests | payload is not JSON (permanent failure, 0 requests) |
| `youtube-sync` (scheduled) | 4 API calls x 50 = 200 videos | 1 pending video | 200 videos (100 pending + 100 due synced), 4 API calls | videos missing from the API response (`missing_or_private`) |
| `youtube-blocked-recheck` | 10 videos | 1 due blocked video | 14 due blocked videos (10 rechecked) | blocked videos rechecked within a week (nothing due) |
| `score-recalc` | `SCORE_RECALC_BATCH_SIZE = 150` | 1 video | 200 eligible videos (150 updated) | non-public videos (skipped) |
| `playlist-sync` | 1 event, 5,000 source videos, mutation budget | 1 source video, 1 insert | 5,000 source videos + 200 remote items, already scanned (3 inserts + OAuth under the CURRENT budget) | sync config with empty playlist id (not due) |
| `ga4-ranking` | `TRENDING_MAX_ITEMS = 200` | 1 public video | 1,000 public videos x 4 date-range rows (200 ranked) | report rows for unknown video IDs (empty ranking) |
| `daily-top-enqueue` (G18, `ensureDailyTopNostalgicShuffle`) | once per JST day | day not yet shuffled | same (cap is 1) | today's shuffle already recorded (no-op) |
| `static-rebuild-queue` (G18, retired by MIG-0907) | `MAX_QUEUE_ITEMS_PER_RUN = 1` | one `list_recent` row, 3 videos | one `search_index` row, 300 videos (heaviest of 7 probed whole-catalogue targets: 100–208 ms for the others) | unknown `target_type` (row fails) |
| `queue-consumer-content` / `-fast` / `-sync` (G18) | `max_batch_size = 10` | 1 canonical wake | 10 duplicate wakes -> one drain of the same work as the job above (sync: 50 pending videos, 1 API batch) | 1 malformed wake (acked, 0 work) |

`<worker>.scheduled` rows are the three cron entry points on an empty database (no due work): the end-to-end idle cost of the cron wrapper.

Differences from the U01 wording (stated, not hidden): the three named queue-consumer rows call the CURRENT inner handler of each consumer (`staticRebuildWakeQueue.ts`, the notification / YouTube wake handlers) with a canonical wake message and count ack / retry, not `default.queue()` of the Worker entry; `default.queue()` itself is exercised only by the idle `<worker>.queue` scenario. The sync consumer is sent `youtube_sync_pending` wakes only; the `youtube_playlist_sync` wake kind (playlist sync, covered by the `playlist-sync` row) is not sent through the consumer.

Not measured (stated, not hidden): `static-rebuild-queue` targets that need extra R2 inputs (`video` v2 pages, etc.) were not seeded — the path is removed by MIG-0907 and the whole-catalogue targets are the heavy ones; playlist-sync with a playlist scan in progress and order repair; real Discord / YouTube / GA4 latency and quota behaviour (synthetic only).

## U03 results (LOCAL, simulator-inclusive, ms of CPU)

Verdict = the benchmark API's `judge(max, 8, {lt, noise, resolution})` plus the D-14-1 noise rule; p50 / p95 are recorded only. `cap` is the Work Order formula `floor(7 / 1-item max)` and is printed only for rows over 8 ms; **a `0` means "even the 1-item run is over budget on this host", not a recommendation**.

| Job | kind | n | p50 (ms) | p95 (ms) | max (ms) | unexpected | max D1 stmts |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `cache-cleanup` | normal | 50 | 11.79 | 18.95 | 19.85 | 0 | 0 |
| `cache-cleanup` | limit | 50 | 26.82 | 39.99 | 44.15 | 0 | 0 |
| `cache-cleanup` | invalid | 50 | 9.23 | 12.42 | 13.81 | 0 | 0 |
| `cache-cleanup` | cold | 50 | 17.71 | 23.50 | 41.06 | 0 | 0 |
| `audit-cleanup` | normal | 50 | 38.80 | 55.23 | 58.86 | 0 | 9 |
| `audit-cleanup` | limit | 50 | 60.45 | 77.86 | 80.29 | 0 | 9 |
| `audit-cleanup` | invalid | 50 | 39.17 | 54.14 | 84.99 | 0 | 9 |
| `audit-cleanup` | cold | 50 | 42.72 | 58.14 | 106.59 | 0 | 9 |
| `daily-top-enqueue` | normal | 50 | 13.32 | 19.00 | 21.63 | 0 | 2 |
| `daily-top-enqueue` | limit | 50 | 13.65 | 20.88 | 28.47 | 0 | 2 |
| `daily-top-enqueue` | invalid | 50 | 9.75 | 15.22 | 16.57 | 0 | 1 |
| `daily-top-enqueue` | cold | 50 | 37.03 | 52.45 | 54.58 | 0 | 2 |
| `x-slot-bind-recovery` | normal | 50 | 50.20 | 71.68 | 74.36 | 0 | 23 |
| `x-slot-bind-recovery` | limit | 50 | 218.86 | 270.00 | 274.71 | 0 | 216 |
| `x-slot-bind-recovery` | invalid | 50 | 23.46 | 29.47 | 36.14 | 0 | 9 |
| `x-slot-bind-recovery` | cold | 50 | 60.13 | 76.52 | 79.97 | 0 | 23 |
| `static-rebuild-queue` | normal | 50 | 98.80 | 122.20 | 134.17 | 0 | 17 |
| `static-rebuild-queue` | limit | 50 | 561.02 | 711.48 | 797.02 | 0 | 16 |
| `static-rebuild-queue` | invalid | 50 | 31.49 | 41.32 | 43.57 | 0 | 8 |
| `static-rebuild-queue` | cold | 50 | 125.33 | 160.84 | 169.24 | 0 | 17 |
| `queue-consumer-content` | normal | 50 | 88.44 | 114.73 | 133.29 | 0 | 14 |
| `queue-consumer-content` | limit | 50 | 541.72 | 625.58 | 682.25 | 0 | 13 |
| `queue-consumer-content` | invalid | 50 | 3.74 | 7.13 | 58.18 | 0 | 0 |
| `queue-consumer-content` | cold | 50 | 114.18 | 148.96 | 189.73 | 0 | 14 |
| `slot-reminders` | normal | 50 | 11.75 | 16.60 | 19.34 | 0 | 3 |
| `slot-reminders` | limit | 50 | 22.85 | 34.58 | 41.67 | 0 | 52 |
| `slot-reminders` | invalid | 50 | 8.20 | 11.93 | 16.30 | 0 | 1 |
| `slot-reminders` | cold | 50 | 33.04 | 52.98 | 109.12 | 0 | 3 |
| `notification-dispatch` | normal | 50 | 51.63 | 64.86 | 82.04 | 0 | 8 |
| `notification-dispatch` | limit | 50 | 129.67 | 172.03 | 196.12 | 0 | 23 |
| `notification-dispatch` | invalid | 50 | 34.84 | 50.38 | 63.40 | 0 | 8 |
| `notification-dispatch` | cold | 50 | 63.34 | 95.26 | 108.92 | 0 | 8 |
| `queue-consumer-fast` | normal | 50 | 40.37 | 53.17 | 62.75 | 0 | 6 |
| `queue-consumer-fast` | limit | 50 | 106.77 | 135.19 | 186.23 | 0 | 21 |
| `queue-consumer-fast` | invalid | 50 | 3.28 | 5.39 | 5.79 | 0 | 0 |
| `queue-consumer-fast` | cold | 50 | 56.80 | 78.40 | 81.12 | 0 | 6 |
| `score-recalc` | normal | 50 | 7.05 | 11.38 | 13.32 | 0 | 1 |
| `score-recalc` | limit | 50 | 9.54 | 14.37 | 15.42 | 0 | 1 |
| `score-recalc` | invalid | 50 | 7.48 | 12.59 | 15.77 | 0 | 1 |
| `score-recalc` | cold | 50 | 8.83 | 11.84 | 14.10 | 0 | 1 |
| `youtube-sync` | normal | 50 | 50.88 | 61.46 | 65.22 | 0 | 13 |
| `youtube-sync` | limit | 50 | 78.84 | 119.23 | 132.82 | 0 | 37 |
| `youtube-sync` | invalid | 50 | 51.01 | 85.59 | 88.59 | 0 | 13 |
| `youtube-sync` | cold | 50 | 79.33 | 100.96 | 104.57 | 0 | 13 |
| `youtube-blocked-recheck` | normal | 50 | 24.02 | 34.22 | 37.43 | 0 | 6 |
| `youtube-blocked-recheck` | limit | 50 | 24.05 | 36.46 | 72.00 | 0 | 6 |
| `youtube-blocked-recheck` | invalid | 50 | 9.05 | 13.96 | 17.72 | 0 | 1 |
| `youtube-blocked-recheck` | cold | 50 | 57.00 | 72.30 | 82.34 | 0 | 6 |
| `ga4-ranking` | normal | 50 | 20.34 | 30.14 | 40.05 | 0 | 1 |
| `ga4-ranking` | limit | 50 | 33.68 | 43.76 | 60.20 | 0 | 1 |
| `ga4-ranking` | invalid | 50 | 21.27 | 27.48 | 32.28 | 0 | 1 |
| `ga4-ranking` | cold | 50 | 28.73 | 36.50 | 37.94 | 0 | 1 |
| `playlist-sync` | normal | 50 | 49.85 | 65.44 | 67.46 | 0 | 19 |
| `playlist-sync` | limit | 50 | 114.85 | 139.45 | 155.82 | 0 | 28 |
| `playlist-sync` | invalid | 50 | 7.14 | 10.69 | 14.86 | 0 | 1 |
| `playlist-sync` | cold | 50 | 79.29 | 101.34 | 111.49 | 0 | 19 |
| `queue-consumer-sync` | normal | 50 | 45.12 | 58.21 | 65.22 | 0 | 9 |
| `queue-consumer-sync` | limit | 50 | 50.87 | 63.05 | 66.01 | 0 | 13 |
| `queue-consumer-sync` | invalid | 50 | 4.12 | 6.40 | 7.65 | 0 | 0 |
| `queue-consumer-sync` | cold | 50 | 80.53 | 110.48 | 121.13 | 0 | 9 |
| `content.scheduled` | normal | 50 | 74.04 | 88.59 | 93.54 | 0 | 1 |
| `content.scheduled` | limit | 50 | 75.53 | 90.77 | 119.05 | 0 | 1 |
| `content.scheduled` | invalid | 50 | 74.41 | 99.15 | 112.67 | 0 | 1 |
| `content.scheduled` | cold | 50 | 131.03 | 164.38 | 187.01 | 0 | 1 |
| `fast.scheduled` | normal | 50 | 51.26 | 63.47 | 78.12 | 0 | 1 |
| `fast.scheduled` | limit | 50 | 51.98 | 65.25 | 69.27 | 0 | 1 |
| `fast.scheduled` | invalid | 50 | 51.42 | 62.54 | 75.29 | 0 | 1 |
| `fast.scheduled` | cold | 50 | 66.78 | 93.30 | 116.47 | 0 | 1 |
| `sync.scheduled` | normal | 50 | 24.69 | 37.17 | 42.94 | 0 | 1 |
| `sync.scheduled` | limit | 50 | 26.87 | 36.32 | 50.77 | 0 | 1 |
| `sync.scheduled` | invalid | 50 | 24.33 | 39.69 | 41.22 | 0 | 1 |
| `sync.scheduled` | cold | 50 | 43.87 | 53.21 | 56.32 | 0 | 1 |

| Job | worker | limit (items) | baseline max / noise (ms) | 1-item max (ms) | overall max (ms) | verdict | cap = floor(7 / 1-item max) |
| --- | --- | ---: | ---: | ---: | ---: | --- | ---: |
| `cache-cleanup` | content | 200 | 7.55 | 19.85 | 44.15 | **FAIL** | 0 |
| `audit-cleanup` | content | 500 | 7.55 | 58.86 | 106.59 | **FAIL** | 0 |
| `daily-top-enqueue` | content | 1 | 7.55 | 21.63 | 54.58 | **FAIL** | 0 |
| `x-slot-bind-recovery` | content | 5 | 7.55 | 74.36 | 274.71 | **FAIL** | 0 |
| `static-rebuild-queue` | content | 1 | 7.55 | 134.17 | 797.02 | **FAIL** | 0 |
| `queue-consumer-content` | content | 10 | 7.55 | 133.29 | 682.25 | **FAIL** | 0 |
| `slot-reminders` | fast | 50 | 5.78 | 19.34 | 109.12 | **FAIL** | 0 |
| `notification-dispatch` | fast | 6 | 5.78 | 82.04 | 196.12 | **FAIL** | 0 |
| `queue-consumer-fast` | fast | 10 | 5.78 | 62.75 | 186.23 | **FAIL** | 0 |
| `score-recalc` | sync | 150 | 8.07 | 13.32 | 15.77 | **INCONCLUSIVE** | 0 |
| `youtube-sync` | sync | 200 | 8.07 | 65.22 | 132.82 | **FAIL** | 0 |
| `youtube-blocked-recheck` | sync | 10 | 8.07 | 37.43 | 82.34 | **FAIL** | 0 |
| `ga4-ranking` | sync | 200 | 8.07 | 40.05 | 60.20 | **FAIL** | 0 |
| `playlist-sync` | sync | 5000 | 8.07 | 67.46 | 155.82 | **FAIL** | 0 |
| `queue-consumer-sync` | sync | 10 | 8.07 | 65.22 | 121.13 | **FAIL** | 0 |
| `content.scheduled` | content | - | 7.55 | 93.54 | 187.01 | **FAIL** | 0 |
| `fast.scheduled` | fast | - | 5.78 | 78.12 | 116.47 | **FAIL** | 0 |
| `sync.scheduled` | sync | - | 8.07 | 42.94 | 56.32 | **FAIL** | 0 |

Local D1 simulator calibration: 3.90 ms CPU per trivial `SELECT 1`, 2.77 ms fixed bench-request overhead (p50 of n=1 and n=17 reads, mean of 3 workers).


## G18 golden: fixed seed / date output hash (MIG-0610 T01b baseline)

Computed by the `g18-golden` fixture (not CPU-measured), twice per report; both runs were identical (`deterministic = true`). Input: `resolveNostalgicDisplaySelection` from `src/lib/publicData/topNostalgicDaily.ts` over a fixed pool of 60 ids `g18-video-01..60`, `Math.random` replaced by a seeded PRNG (mulberry32, seed `609`), `now = 1760000000` (JST day `2025-10-09`), `limit = 20`, plus the row `ensureDailyTopNostalgicShuffle` enqueues (`static_rebuild_queue`: `top_nostalgic` / `global` / `nostalgic_daily_shuffle` / `normal`).

* SHA-256 of `JSON.stringify({seed, now, selectionDay, isNew, ids, enqueue})`: `6073f44d80fceb3e694ee68b1574b219cb07ec82942b0136ba8cbc7dc66fcc3d`
* first ids: `g18-video-46, 59, 06, 49, 57, 29, 28, 42, 26, 48, …` (20 ids)

MIG-0610 must reproduce this hash (same seed, same date) after any change to the daily top selection.

## Calibration and baseline

The calibration routes (`/__bench/d1?n=1|17`, 10 warm-up + 30 samples each, per Worker) give the line printed under the tables: ~3.9 ms CPU per trivial local D1 read and ~2.8 ms fixed bench-request overhead. The BASELINE (`/__bench/noop`) max per Worker is the `baseline max / noise` column (content 7.55, fast 5.78, sync 8.07 ms).

## Budget and reproducibility

Budget = **max CPU < 8 ms** (not p95) with `judge(maxMs, 8, {kind:'lt', resolutionMs, noiseMs})`. Per-item cap = `floor(7 ms / 1-item max CPU)` (1 ms is left for start-up and D1 result handling). If the same-run BASELINE max is >= 4 ms and the job max is 4–12 ms the result is **INCONCLUSIVE** and must not approve a cutover. Always record OS / CPU / node / wrangler and the sample counts, never label these as production numbers. Total run time on this host: about 26 minutes (about 230 seeded samples per job).

## Rollback

Revert PR #455. Only local scripts and docs changed; no Worker, `wrangler.toml`, Cron, Queue, D1, R2, secret or Cloudflare configuration was touched.
