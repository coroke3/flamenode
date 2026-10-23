# FlameNode API CPU Benchmark (MIG-0606)

> Status: U01 harness DONE-pending-review / U02 (31 methods) NOT RUN
> Measured: 2026-10-23 (LOCAL, one Windows 11 developer machine)
> Source of truth: `scripts/benchmark-api-cpu.mjs`, `docs/migration/ZERO_1102.md` section 3 and 5
> Production mutation: none (no deploy, no Route, no `--remote`, no Cloudflare account call)

**Every number in this file is a LOCAL measurement. None is a production value.** ZERO_1102 section 3 already states that local workerd values are not production values.

## 1. What is judged

Budgets are judged by the **maximum**, not p95 (ZERO_1102 section 3): S2 read `< 7ms`, S3 mutation `< 8ms`, S4 session resolution `<= 2ms` (inside S2/S3). p50/p95/p99 are recorded and never decide pass or fail.

The harness gives one of these verdicts per method, from the max over all four input kinds:

| verdict | rule |
| --- | --- |
| PASS | `max + clock resolution` is below the budget |
| FAIL | `max - noise floor` is at or above the budget (noise floor = max of a zero-work `BASELINE` route in the same run; noise can only inflate a reading) |
| INCONCLUSIVE | over budget but within the noise floor, or too close to the budget for the clock |

## 2. Input kinds (ZERO_1102 section 5), 50 samples each (10 warm-up requests discarded)

| kind | meaning here |
| --- | --- |
| normal | a typical valid request |
| exact-limit | the largest accepted input: announcement title 200 / body 8000 chars, `event_id` 128 chars, `limit=50` suggestions, about-stats R2 object of exactly 64 KiB, 4 KiB token header, 20 extra cookies |
| invalid | rejected input (400/401/404/409/503 as the route defines); the expected status of every request is checked and a mismatch is counted as `unexpected status` |
| cold | first request after the worker isolate was reloaded (`wrangler dev` rebuild, new build id). 50 reloads. After each reload one request per endpoint is sent in rotated order, so only the first endpoint of a round is the very first request of its isolate; the others are first-hit-of-that-route in a fresh isolate |

`unexpected status` was 0 in every row of every run below.

## 3. How to run (all local)

```bash
node scripts/benchmark-api-cpu.mjs --dry-run                 # plan + aggregation self-check, runs nothing
node scripts/benchmark-api-cpu.mjs --mode wrangler --out result.json   # default: workerd, D1/R2 replay (~12 min)
node scripts/benchmark-api-cpu.mjs --mode wrangler --d1 sim  # workerd with wrangler's local D1/R2 simulator
node scripts/benchmark-api-cpu.mjs --mode inproc             # Node wall-time proxy, no workerd (~20 s)
node --test scripts/benchmark-api-cpu.test.mjs               # aggregation / verdict / scenario tests
```

Options: `--samples N` (50), `--cold-samples N` (50), `--warmup N` (10), `--only RH-018,SA-004`, `--skip-cold`, `--sampling-us N` (100), `--port`, `--inspector-port`.

What it does: materialises the repo `migrations/` (D1-compatible copy), applies them to a local D1 (`wrangler d1 migrations apply --local`) in a temp directory, generates a bench-only wrapper worker (not part of `apps/api`, removed afterwards) that imports `apps/api/src/app.ts`, starts `wrangler dev --local`, seeds an admin user, session, `system_settings`, 100 software rows, and drives the real Hono app with real cookies and Origin headers. Nothing is written outside the OS temp directory.

## 4. Limits of the method (read before using any number)

Measured on this host, and the reason U02 cannot be judged here:

1. **workerd's own CPU accounting is unavailable locally.** The `cpu_time_ms` attribute in `wrangler dev --local` observability spans was `0` for every request, including a 4.1 second synchronous burn (`GET /__bench/burn?iters=200000000`: client wall 4102 ms, reported cpu 0). It is not used.
2. **CPU is taken from a V8 sampling profiler** attached to the workerd inspector (`Profiler.start/stop` around each request; CPU = sum of non-idle sample deltas, sampling interval 100 us). Calibration against a known burn: 2 M loop iterations read 28-34 ms, 20 M read 240-244 ms, so large costs are tracked.
3. **Noise floor is about as large as the budgets.** A route that does nothing (`BASELINE`, `new Response("ok")`) read a max of **7.2 ms (run 1)** and **12.5 ms (run 2)**, with p50 0.0 and p95 about 3 ms. Sample deltas arrive in coarse steps (about 2.4 ms) on this Windows host and spikes occur. A max-based verdict at 7-8 ms is therefore not reproducible here: RH-017 read 6.6 ms in run 1 (PASS) and 56.8 ms in run 2 (FAIL); S4 (one cookie lookup, 1 D1 read) read a max of 19.1 ms (run 1, normal) and 19.7 ms (run 2, cold) while its p95 was 3-6 ms, which is noise, not code.
4. **wrangler's local D1 simulator costs CPU that production does not.** 17 trivial `SELECT 1` reads measured 62-108 ms (about 4-6 ms each) under the profiler. To exclude it, the default `--d1 replay` first runs each request once in-process against `node:sqlite` (same migrations) and records every D1/R2 result in call order, then replays those results inside workerd with D1/R2 stubbed. The measured CPU is then the app code (Hono, zod, JSON, middleware) and excludes both the simulator and the real D1 round trip. Real D1 binding serialization CPU is not measured. `--d1 sim` is kept for comparison only.
5. **The Cache API in `wrangler dev --local` is real work**: 8 sequential `caches.default.delete` calls measured 3.2-19.4 ms. SA-007/SA-008 perform exactly 8 such deletes after commit (`invalidateEventExportCache`), which matches their consistently high p50. Production Cache API delete CPU is unknown.
6. About-stats uses a fixed Cache API key; the harness clears it before each sample so the R2-miss path is what is measured (the hit path is cheaper).
7. In-process mode (`--mode inproc`) measures `performance.now()` wall time around `app.fetch` in Node (`process.cpuUsage()` was rejected: it ticks in about 15.6 ms steps on Windows). It has no workerd, no Cache API and no cold kind. Treat it as a lower-bound proxy for application code only.

Consequence: the verdict column from `--mode wrangler` is **machine output with a known noise problem**. Only effects much larger than the noise floor and reproduced in both runs (SA-007, SA-008) are evidence. Before U02 verdicts are trusted, run on a quiet machine (or repeat enough that the minimum of per-run maxima is stable) and report the BASELINE row with them.

## 5. Results (U01 exercise on the endpoints that exist today)

Conditions: commit `e9981365` (+ harness), wrangler 4.118.0, Node v24.13.0, Windows 11 x64, `--mode wrangler --d1 replay`, 50 samples per kind, 50 cold reloads, 10 warm-up discarded. Cell format: `p50 / p95 / p99 / max` in ms (profiler, local, includes noise floor, see section 4).

| ID | class | normal | exact-limit | invalid | cold |
| --- | --- | --- | --- | --- | --- |
| **run1** (noise floor = BASELINE max 7.2ms) | | | | | |
| RH-018 | S2 | 0.0 / 3.8 / 4.6 / **4.6** | 0.0 / 5.0 / 8.7 / **8.7** | 0.0 / 3.8 / 4.2 / **4.2** | 2.5 / 6.3 / 8.9 / **8.9** |
| RH-017 | S2 | 0.0 / 2.4 / 4.0 / **4.0** | 2.4 / 4.2 / 5.4 / **5.4** | 0.0 / 3.1 / 4.4 / **4.4** | 2.4 / 6.0 / 6.6 / **6.6** |
| RH-026 | S2 | 2.2 / 5.3 / 5.6 / **5.6** | 2.4 / 7.4 / 10.2 / **10.2** | 0.0 / 5.6 / 6.4 / **6.4** | 6.2 / 15.6 / 18.3 / **18.3** |
| RH-029 | S2 | 2.3 / 3.1 / 4.2 / **4.2** | 2.4 / 3.1 / 13.6 / **13.6** | 2.4 / 2.9 / 3.0 / **3.0** | 3.1 / 6.0 / 7.0 / **7.0** |
| SA-004 | S3 | 2.4 / 5.2 / 9.0 / **9.0** | 0.0 / 5.4 / 5.8 / **5.8** | 3.6 / 6.0 / 7.1 / **7.1** | 7.5 / 11.4 / 14.4 / **14.4** |
| SA-005 | S3 | 3.1 / 4.8 / 6.1 / **6.1** | 2.4 / 4.7 / 5.7 / **5.7** | 0.0 / 4.4 / 4.9 / **4.9** | 4.8 / 13.1 / 14.0 / **14.0** |
| SA-006 | S3 | 2.4 / 4.2 / 12.0 / **12.0** | 2.4 / 3.2 / 3.6 / **3.6** | 2.4 / 3.1 / 3.9 / **3.9** | 3.5 / 8.7 / 11.1 / **11.1** |
| SA-007 | S3 | 8.4 / 21.9 / 33.8 / **33.8** | 11.7 / 32.4 / 73.1 / **73.1** | 3.1 / 5.7 / 10.2 / **10.2** | 18.9 / 33.3 / 40.6 / **40.6** |
| SA-008 | S3 | 11.7 / 29.6 / 33.2 / **33.2** | 15.6 / 28.4 / 35.0 / **35.0** | 2.3 / 4.8 / 17.0 / **17.0** | 13.1 / 26.7 / 33.4 / **33.4** |
| S4 | S4 | 0.0 / 3.4 / 19.1 / **19.1** | 0.0 / 3.6 / 4.7 / **4.7** | 0.0 / 2.5 / 3.0 / **3.0** | 2.4 / 3.7 / 4.1 / **4.1** |
| BASELINE | S2 | 0.0 / 3.0 / 7.2 / **7.2** | 0.0 / 2.4 / 4.2 / **4.2** | 0.0 / 3.0 / 4.2 / **4.2** | 0.0 / 3.0 / 3.7 / **3.7** |
| **run2** (noise floor = BASELINE max 12.5ms) | | | | | |
| RH-018 | S2 | 0.0 / 5.0 / 6.0 / **6.0** | 0.0 / 5.6 / 8.8 / **8.8** | 0.0 / 11.4 / 15.3 / **15.3** | 3.3 / 11.0 / 13.9 / **13.9** |
| RH-017 | S2 | 0.0 / 5.2 / 10.7 / **10.7** | 4.0 / 11.4 / 16.7 / **16.7** | 0.0 / 5.3 / 13.5 / **13.5** | 3.6 / 8.0 / 56.8 / **56.8** |
| RH-026 | S2 | 3.7 / 9.5 / 13.1 / **13.1** | 3.2 / 7.2 / 9.7 / **9.7** | 0.0 / 8.6 / 11.7 / **11.7** | 8.7 / 22.3 / 31.7 / **31.7** |
| RH-029 | S2 | 2.5 / 4.2 / 5.2 / **5.2** | 0.0 / 5.3 / 5.9 / **5.9** | 2.5 / 5.5 / 8.1 / **8.1** | 4.4 / 9.8 / 12.1 / **12.1** |
| SA-004 | S3 | 2.9 / 6.0 / 9.0 / **9.0** | 3.8 / 8.6 / 11.1 / **11.1** | 3.1 / 7.2 / 11.5 / **11.5** | 9.4 / 14.1 / 18.9 / **18.9** |
| SA-005 | S3 | 4.5 / 7.6 / 14.4 / **14.4** | 4.1 / 7.6 / 9.3 / **9.3** | 4.5 / 7.5 / 13.7 / **13.7** | 6.4 / 12.6 / 19.6 / **19.6** |
| SA-006 | S3 | 3.6 / 8.2 / 23.4 / **23.4** | 3.0 / 6.1 / 6.6 / **6.6** | 0.0 / 6.5 / 10.1 / **10.1** | 3.9 / 8.9 / 12.4 / **12.4** |
| SA-007 | S3 | 14.9 / 26.9 / 38.9 / **38.9** | 25.2 / 58.8 / 110.7 / **110.7** | 0.0 / 9.6 / 37.6 / **37.6** | 23.6 / 41.9 / 111.0 / **111.0** |
| SA-008 | S3 | 10.2 / 36.1 / 41.6 / **41.6** | 22.2 / 42.1 / 66.4 / **66.4** | 3.9 / 8.9 / 11.0 / **11.0** | 15.4 / 42.5 / 54.7 / **54.7** |
| S4 | S4 | 0.0 / 6.3 / 10.6 / **10.6** | 0.0 / 6.4 / 8.0 / **8.0** | 0.0 / 3.3 / 3.4 / **3.4** | 2.9 / 6.5 / 19.7 / **19.7** |
| BASELINE | S2 | 0.0 / 3.7 / 4.3 / **4.3** | 0.0 / 3.7 / 5.7 / **5.7** | 0.0 / 3.4 / 12.5 / **12.5** | 0.0 / 3.0 / 4.1 / **4.1** |

| ID | class | budget | max run1 | max run2 | verdict run1 | verdict run2 | D1 stmts (max) | response bytes (max) |
| --- | --- | --- | ---: | ---: | --- | --- | ---: | ---: |
| RH-018 | S2 | < 7ms | 8.9 | 15.3 | INCONCLUSIVE | INCONCLUSIVE | 0 | 119 |
| RH-017 | S2 | < 7ms | 6.6 | 56.8 | PASS | FAIL | 0 | 38 |
| RH-026 | S2 | < 7ms | 18.3 | 31.7 | FAIL | FAIL | 0 | 58 |
| RH-029 | S2 | < 7ms | 13.6 | 12.1 | INCONCLUSIVE | INCONCLUSIVE | 2 | 4541 |
| SA-004 | S3 | < 8ms | 14.4 | 18.9 | INCONCLUSIVE | INCONCLUSIVE | 11 | 68 |
| SA-005 | S3 | < 8ms | 14.0 | 19.6 | INCONCLUSIVE | INCONCLUSIVE | 12 | 115 |
| SA-006 | S3 | < 8ms | 12.0 | 23.4 | INCONCLUSIVE | FAIL | 12 | 73 |
| SA-007 | S3 | < 8ms | 73.1 | 111.0 | FAIL | FAIL | 10 | 202 |
| SA-008 | S3 | < 8ms | 35.0 | 66.4 | FAIL | FAIL | 10 | 202 |
| S4 | S4 | <= 2ms | 19.1 | 19.7 | FAIL | FAIL | 1 | 16 |
| BASELINE | S2 | < 7ms | 7.2 | 12.5 | NOISE_FLOOR | NOISE_FLOOR | 0 | 2 |

### In-process proxy (Node wall time, no workerd, `--mode inproc`, 50 samples, no cold kind)

`p50 / p95 / p99 / max` in ms. Not a workerd judgment.

| ID | class | normal | exact-limit | invalid | verdict (proxy) |
| --- | --- | --- | --- | --- | --- |
| RH-018 | S2 | 0.06 / 0.10 / 0.12 / **0.12** | 0.06 / 0.11 / 0.16 / **0.16** | 0.05 / 0.08 / 0.13 / **0.13** | PASS |
| RH-017 | S2 | 0.06 / 0.13 / 0.21 / **0.21** | 0.09 / 0.17 / 0.43 / **0.43** | 0.04 / 0.06 / 0.07 / **0.07** | PASS |
| RH-026 | S2 | 0.05 / 0.10 / 0.17 / **0.17** | 0.13 / 0.20 / 0.45 / **0.45** | 0.04 / 0.08 / 0.52 / **0.52** | PASS |
| RH-029 | S2 | 0.30 / 0.44 / 0.55 / **0.55** | 0.54 / 1.23 / 1.78 / **1.78** | 0.36 / 0.64 / 0.84 / **0.84** | PASS |
| SA-004 | S3 | 1.08 / 2.46 / 3.67 / **3.67** | 0.96 / 1.51 / 1.81 / **1.81** | 0.40 / 0.67 / 3.30 / **3.30** | PASS |
| SA-005 | S3 | 0.90 / 1.34 / 4.32 / **4.32** | 1.05 / 1.99 / 3.67 / **3.67** | 0.42 / 0.62 / 0.68 / **0.68** | PASS |
| SA-006 | S3 | 0.93 / 2.25 / 3.18 / **3.18** | 0.99 / 2.17 / 3.16 / **3.16** | 0.32 / 0.53 / 0.90 / **0.90** | PASS |
| SA-007 | S3 | 0.95 / 1.46 / 3.95 / **3.95** | 1.03 / 3.57 / 4.42 / **4.42** | 0.29 / 0.52 / 2.29 / **2.29** | PASS |
| SA-008 | S3 | 0.83 / 2.36 / 2.95 / **2.95** | 0.92 / 1.42 / 2.91 / **2.91** | 0.30 / 0.51 / 2.26 / **2.26** | PASS |
| S4 | S4 | 0.07 / 0.10 / 0.12 / **0.12** | 0.08 / 0.15 / 0.89 / **0.89** | 0.06 / 0.09 / 0.10 / **0.10** | PASS |
| BASELINE | S2 | 0.00 / 0.01 / 0.01 / **0.01** | 0.00 / 0.01 / 0.01 / **0.01** | 0.00 / 0.00 / 0.00 / **0.00** | NOISE_FLOOR |

## 6. Methods over budget or needing attention (T02: owner and reason)

| item | finding | owner | reason / next |
| --- | --- | --- | --- |
| SA-007 `POST /api/admin/api-endpoints`, SA-008 `PATCH /api/admin/api-endpoints/:id` | FAIL in both runs; p50 8-25 ms, max 33-111 ms; reproducible and far above the noise floor | MIG-0602 (#331) | likely the 8 post-commit `caches.default.delete` calls (section 4 item 5) plus the 31-column `expectedRowCondition`. In-process (no Cache API) they read 2.6-4.4 ms max. Needs a measurement where Cache API cost is known (production Observability or a quiet re-run) before any change; per the Work Order this PR does not edit `apps/api/src/**` |
| RH-026 `GET /api/public/about-stats` | FAIL in both runs, driven by the cold kind (18.3 / 31.7 ms) and the 64 KiB exact-limit object (10.2 / 9.7 ms) | MIG-0601 (#329) | cold first hit does Cache API match + R2 get + JSON parse of up to 64 KiB. Re-measure on a quiet machine |
| SA-004/005/006 admin announcements | INCONCLUSIVE in run 1; run 2 SA-006 FAIL (23.4 ms single spike); p50 2.4-4.5 ms | MIG-0602 (#331) | within noise; cold kind is the highest (11-20 ms) |
| RH-018 health, RH-029 suggestions | INCONCLUSIVE | MIG-0601 (#329) | max within the noise floor |
| RH-017 deep health | PASS in run 1, FAIL in run 2 | MIG-0601 (#329) | shows the noise problem, not a code problem (the route does no I/O) |
| S4 session resolution | FAIL in both runs from single-sample maxima (19.1 / 19.7 ms); p95 3.4-6.5 | MIG-0608 | spike is noise (BASELINE has the same shape); inconclusive until quiet-host re-run. D1 statements: 1 (matches the S4 design) |

None of these is attributed to a code defect yet. Do not rewrite endpoints from this table (Work Order STOP).

## 7. Method table: all 31 methods (RH-010/011 excluded)

"measured" means U01 measured it locally with the caveats of section 4; the numbers are in section 5. Everything else is **not yet measured** (U02, after MIG-0603..0605 merge). SA rows are extra (admin mutation endpoints that exist on #331), not part of the 31.

| RH | method path | class | owner MIG | CPU max (local) | verdict |
| --- | --- | --- | --- | --- | --- |
| RH-001 | GET /api/account/summary | S2 | MIG-0605 | not yet measured | - |
| RH-002 | POST /api/admin/import/legacy | S3 | MIG-0605 | not yet measured | - |
| RH-003 | GET /api/admin/spreadsheet/data | S2 | MIG-0605 | not yet measured | - |
| RH-004 | PATCH /api/admin/spreadsheet/data | S3 | MIG-0605 | not yet measured | - |
| RH-005 | POST /api/admin/spreadsheet/data | S3 | MIG-0605 | not yet measured | - |
| RH-006 | DELETE /api/admin/spreadsheet/data | S3 | MIG-0605 | not yet measured | - |
| RH-007 | GET /api/admin/spreadsheet/export | S2 | MIG-0605 | not yet measured | - |
| RH-008 | POST /api/admin/spreadsheet/import | S3 | MIG-0605 | not yet measured | - |
| RH-009 | GET /api/admin/spreadsheet/tables | S2 | MIG-0605 | not yet measured | - |
| RH-012 | GET /api/event-endpoints/[id]/release | S2 | MIG-0604 | not yet measured | - |
| RH-013 | GET /api/event-endpoints/[id] | S2 | MIG-0604 | not yet measured | - |
| RH-014 | GET /api/events/[id]/slots/viewer-overlay | S2 | MIG-0604 | not yet measured | - |
| RH-015 | GET /api/events | S2 | MIG-0604 | not yet measured | - |
| RH-016 | GET /api/google-drive-image/[id] | S2 | MIG-0605 | not yet measured | - |
| RH-017 | GET /api/health/deep | S2 | MIG-0601 | measured (section 5) | see section 5 |
| RH-018 | GET /api/health | S2 | MIG-0601 | measured (section 5) | see section 5 |
| RH-019 | GET /api/internal/x-users/search | S2 | MIG-0605 | not yet measured | - |
| RH-020 | GET /api/live/events/[id]/slots | S2 | MIG-0604 | not yet measured | - |
| RH-021 | GET /api/live/events/[id]/submissions | S2 | MIG-0604 | not yet measured | - |
| RH-022 | GET /api/live/events/[id]/summary | S2 | MIG-0604 | not yet measured | - |
| RH-023 | GET /api/media/[...key] | S2 | MIG-0605 | not yet measured | - |
| RH-024 | GET /api/media/manage-x-icon/[...key] | S2 | MIG-0605 | not yet measured | - |
| RH-025 | GET /api/media/slot-submission-icon/[slotId] | S2 | MIG-0605 | not yet measured | - |
| RH-026 | GET /api/public/about-stats | S2 | MIG-0601 | measured (section 5) | see section 5 |
| RH-027 | OPTIONS /api/public/events/[id]/staff | S2 | MIG-0605 | not yet measured | - |
| RH-028 | GET /api/public/events/[id]/staff | S2 | MIG-0605 | not yet measured | - |
| RH-029 | GET /api/software/suggestions | S2 | MIG-0601 | measured (section 5) | see section 5 |
| RH-030 | GET /api/videos/[id] | S2 | MIG-0603 | not yet measured | - |
| RH-031 | GET /api/videos/[id]/viewer-overlay | S2 | MIG-0603 | not yet measured | - |
| RH-032 | GET /api/videos | S2 | MIG-0603 | not yet measured | - |
| RH-033 | GET /api/youtube-thumbnail/[id]/[size] | S2 | MIG-0605 | not yet measured | - |
| SA-004..006 | POST/PUT/DELETE /api/admin/announcements[/:id] | S3 | MIG-0602 | measured (section 5) | see section 5 |
| SA-007/008 | POST /api/admin/api-endpoints, PATCH /api/admin/api-endpoints/:id | S3 | MIG-0602 | measured (section 5) | see section 5 |
| S4 | session resolution (1 D1 read) | S4 | MIG-0608 | measured (section 5, via a bench-only probe route) | see section 5 |

## 8. U02 plan

1. After MIG-0603..0605 merge, add one entry per remaining RH method to `buildScenarios()` (path, three request kinds, expected statuses, seeds). `apps/api/src/**` stays untouched.
2. Run on a quiet host (or repeat runs and report the lowest stable max), keep the BASELINE row beside every table, and record owner MIG and reason for any method over budget.
3. Fill `API_MATRIX.md` per-method CPU max only from a run whose BASELINE noise floor is well below the budget.
4. Unmeasurable locally and still open: real D1 binding cost, Cache API production cost, workerd's real per-request CPU accounting. Production Workers Observability (MIG-0902) is the only source for those and needs separate approval.
