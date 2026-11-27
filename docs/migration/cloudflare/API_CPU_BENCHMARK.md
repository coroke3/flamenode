# FlameNode API CPU Benchmark (MIG-0606)

> Status: MIG-0639 U01 measurement-validity correction IN_PROGRESS; qualifying U02 full run NOT RUN
> Measured: 2026-10-23 (LOCAL, one Windows 11 developer machine)
> Source of truth: `scripts/benchmark-api-cpu.mjs`, `docs/migration/ZERO_1102.md` section 3 and 5
> Production mutation: none (no deploy, no Route, no `--remote`, no Cloudflare account call)

> **2026-11-22 P1 #732 correctness gate (PR #456; CI pending):** Historical rows and verdicts below predate the warm/cold separation and are NOT valid S2/S3 acceptance. The former `aggregate.overallMax` and `noiseFloorMs` included cold starts, which could mask warm budget failures. Current code judges the maximum of every warm kind (including RH-013 scheduled-warm/realtime-warm), reports cold separately, and blocks acceptance unless warm BASELINE max is strictly below 4ms with >=50 valid samples per warm kind. No qualifying Linux workerd run is asserted here.

**MIG-0639 malformed CPU sample fail-closed (2026-11-22):** A method with 50 valid CPU readings and one additional invalid measurement (negative, NaN, Infinity or absent) must not report `PASS`. `aggregate()` now retains `invalidCpuSamples` and sets `meetsMinSamples=false` if *any* CPU reading in a kind is invalid, irrespective of the number of other samples. `judge()` also rejects nonfinite/negative times or invalid clock/noise values as `NOT_MEASURED`. Cold eligibility applies the same integrity check even for hypothetically certified first-isolate evidence. This prevents false acceptance; synthetic tests are not formal CPU measurements.

**MIG-0639 profiler calibration fail-closed (2026-11-22):** The local V8 inspector could previously record zero/missing/non-scaling CPU samples for the initial 2M/20M synchronous calibration burns and still proceed to label measured API CPU. The harness now requires finite nonnegative 0/2M/20M calibration values, a measurable 2M burn (>=1ms), a 20M burn >=10ms and >2x the 2M burn and >10ms above idle. If this conservative local calibration fails, it tears down the temporary Wrangler process and **aborts before measuring routes**; no misleading 0ms CPU PASS evidence can be emitted. Tests include missing/invalid values, zero measurements, non-scaling burns and excessive idle noise. This does not supersede the official `ZERO_1102.md §5` nonproduction Worker/`wrangler tail` method.

**Historical MIG-0639 cold-provenance STOP (2026-11-22; lifecycle superseded below):** The previous `runCold()` reloaded the local Worker once per round and submitted many routes to that same isolate. More decisively, `waitBuild()` pings `/__bench/ping` before every route request, and default `--d1 replay` posts `/__bench/script` before a measured request. Therefore even the first route after each rebuild is **not** proven to be the isolate's first invocation. The 50 local `cold` entries per route are post-reload diagnostics, **not 50 valid isolate-first samples**. The samples now carry `isFirstIsolateRequest: false`; the aggregate reports `verifiedIsolateStarts`, and `enforceCpuMeasurementEnvironment` keeps `STOP_COLD` unless each route has 50 independently verified first-isolate requests. A bounded stub regression exercises the real `runCold` path and prevents accidental cold acceptance. **Authoritative acceptance is nonproduction Worker deployment with `wrangler tail` `cpuTime`, under `ZERO_1102.md` §5, and requires separate authorization.** No such deployment or verified cold measurement was done.

**MIG-0639 first local request lifecycle (2026-11-27):** Each cold sample now starts a new dedicated Wrangler/workerd process after its replay script is embedded in generated source. Only inspector traffic precedes profiling; no `/__bench/ping`, `/__bench/script`, or `Runtime.evaluate` readiness call warms the Worker. Its response must attest the expected generation and invocation ordinal `1`; every fetch, including harness endpoints, increments that ordinal. JSON `coldStarts` retains generation, Wrangler process ID, ordinal and verified flag. Targets without this lifecycle remain unverified diagnostics. This removes the deterministic `STOP_COLD` caused by the old sampler, without removing any acceptance gate or replacing the official nonproduction Worker/tail method.

One **diagnostic-only** Linux x64 run of `--only S4 --samples 1 --cold-samples 1 --warmup 1 --d1 replay` used Node v22.23.5, Wrangler 4.118.0 and 100µs requested profiler sampling. S4 generation `b1` (Wrangler PID 820) and BASELINE generation `b2` (PID 897) each attested ordinal `1`, one verified start and zero unexpected statuses. S4 cold CPU was 1.803ms and BASELINE cold 0.326ms; these single observations are not budget evidence. Warm BASELINE max 2.097ms plus observed profiler quantum 3.092ms yielded upper bound 5.189ms: **STOP_BASELINE**, and the selected subset yielded **STOP_PARTIAL**. There was only one warm sample per kind and one warmup. The full 144-scenario run with >=50 samples for each input kind, quiet-host qualification, D-12/T17 verdicts, independent review and final-head CI remain outstanding. The probe executed this uncommitted runtime correction; its metadata HEAD identifies the prior published baseline, and subsequent source edits only corrected report/comment wording. Final published source SHA and exact-head review/CI must be linked on PR #456, which remains Draft until acceptance is established. No remote or production resource was used.

**MIG-0639 live profiler quantum in replay (2026-11-22):** `createReplayTarget()` must forward `wr.resolutionMs` through a **getter**, not the value produced by object-spreading the workerd target. The V8 sampling quantum starts near 0.1ms but may increase to multiple milliseconds during measurement. Freezing the initial quantum can incorrectly pass both the S2/S3 budget and the strict quiet BASELINE gate even after the measured clock becomes coarser. A regression mutates the underlying resolution from 0.1ms to 2.5ms and requires the replay wrapper, `judge()`, and `applyBudgetVerdicts()` to see the live value. This tests only the binding; it is **not a measured Linux performance PASS**.

**MIG-0639 RH-013 named warm mode acceptance (2026-11-22):** The RH-013 500-video × 100-member `scheduled-warm` HIT and `realtime-warm` micro-cache probe are distinct **warm** paths, not cold startup data. Their p50/p95/p99/max are reported and **their maxima now participate in the S2 max CPU budget**, with at least 50 valid samples per named warm mode required; missing, short or anomalous extra warm modes yield `STOP_SAMPLES`. Only `cold` is excluded from the warm CPU budget and warm BASELINE noise. This closes a false-PASS gap where `normal/limit/invalid` could pass despite RH-013's actual named warm path exceeding 7ms. Evidence requires an actual admissible Linux workerd run; synthetic regression is not a performance result.

**MIG-0639 acceptance-environment guard (2026-11-22):** A benchmark run cannot claim S2/S3/S4 CPU PASS from `--mode inproc` (Node wall proxy), Windows/non-Linux workerd, `--d1 sim`, a `--only` subset, a warmup below 10, or missing/insufficient/invalid cold samples (50 per route). These now receive `STOP_PROXY`, `STOP_PLATFORM`, `STOP_D1_SIM`, `STOP_PARTIAL`, `STOP_WARMUP`, or `STOP_COLD` instead of a budget PASS. `STOP_COLD` also requires 50 **verified isolate-first** cold samples, not merely 50 post-reload rows. Warm/cold pure arithmetic and the stricter warm BASELINE `STOP_BASELINE` / warm `STOP_SAMPLES` logic remain unchanged. JSON records `measurementEnvironmentEligible`, `measurementEnvironmentStopReason`, and `baselineUpperBoundMs` (raw warm max plus profiler resolution; raw warm max remains separately in `noiseFloorMs`). A Linux workerd verdict is still **LOCAL**, not production acceptance, and independent review/Lead gates still apply.

**Every number in this file is a LOCAL measurement. None is a production value.** ZERO_1102 section 3 already states that local workerd values are not production values.

## 1. What is judged

Budgets are judged by the **maximum**, not p95 (ZERO_1102 section 3): S2 read `< 7ms`, S3 mutation `< 8ms`, S4 session resolution `<= 2ms` (inside S2/S3). p50/p95/p99 are recorded and never decide pass or fail.

The harness gives one of these verdicts per method from the maximum of **all measured warm kinds** (normal/limit/invalid and any explicitly named warm path such as RH-013 scheduled-warm/realtime-warm); cold start is recorded separately, never included in noise or the S2/S3/S4 budget verdict. A warm BASELINE upper bound (measured max + sampling resolution) >=4ms (strict), missing/invalid profiler resolution, missing baseline or inadequate warm samples produces STOP, not PASS:

| verdict | rule |
| --- | --- |
| PASS | `max + clock resolution` is below the budget |
| FAIL | `max - noise floor` is at or above the budget (noise floor = **warm-only** max of a zero-work `BASELINE` route in the same run; noise can only inflate a reading) |
| INCONCLUSIVE | over budget but within the warm noise floor, or too close to the budget for the clock |
| STOP_BASELINE | no qualified warm BASELINE (measured max + profiler resolution strictly <4ms, >=50 samples/kind, no unexpected warm status) |
| STOP_SAMPLES | one or more route warm kinds has <50 samples or unexpected HTTP statuses |

## 2. Input kinds (ZERO_1102 section 5), 50 samples each (10 warm-up requests discarded)

| kind | meaning here |
| --- | --- |
| normal | a typical valid request |
| exact-limit | the largest accepted input: announcement title 200 / body 8000 chars, `event_id` 128 chars, `limit=50` suggestions, about-stats R2 object of exactly 64 KiB, 4 KiB token header, 20 extra cookies |
| invalid | rejected input (400/401/404/409/503 as the route defines); the expected status of every request is checked and a mismatch is counted as `unexpected status` |
| cold (local workerd) | >=50 first-request samples per endpoint, with one fresh Wrangler/workerd process per sample. Replay is embedded before startup; inspector attachment dispatches no Worker request. The response must attest its generation and ordinal 1. Inspect `coldStarts` and `verifiedIsolateStarts`; failed/missing provenance retains STOP_COLD. Local sampling is separate from authorized nonproduction Worker/tail cpuTime. |

`unexpected status` was 0 in every row of every run below.

## 3. How to run (all local)

```bash
node scripts/benchmark-api-cpu.mjs --dry-run                 # plan + aggregation self-check, runs nothing
node scripts/benchmark-api-cpu.mjs --mode wrangler --out result.json   # workerd/replay; a fresh process per cold sample, full duration unmeasured
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
4. **wrangler's local D1 simulator costs CPU that production does not.** 17 trivial `SELECT 1` reads measured 62-108 ms (about 4-6 ms each) under the profiler. To exclude it, the default `--d1 replay` first runs each request once in-process against `node:sqlite` (same migrations), normalizes and snapshots every D1/R2 result in call order, then replays those results inside workerd with D1/R2 stubbed. Request profiling includes app code (Hono, zod, JSON, middleware), **native UUID/time generation retained on each intercepted call, input-hook/transcript overhead and replay identity/row/count bookkeeping**, while excluding the local simulator, Node recording and warm registration. Cold JSON parsing/validation runs during worker module initialization and may precede profiling; first-fetch provenance is not a measurement of total process/module startup CPU. No guessed overhead is subtracted. The real D1 round trip and real D1 binding serialization CPU are not measured. `--d1 sim` is kept for comparison only.
5. **The Cache API in `wrangler dev --local` is real work**: 8 sequential `caches.default.delete` calls measured 3.2-19.4 ms. SA-007/SA-008 perform exactly 8 such deletes after commit (`invalidateEventExportCache`), which matches their consistently high p50. Production Cache API delete CPU is unknown.
6. About-stats uses a fixed Cache API key; the harness clears it before each sample so the R2-miss path is what is measured (the hit path is cheaper).
7. In-process mode (`--mode inproc`) measures `performance.now()` wall time around `app.fetch` in Node (`process.cpuUsage()` was rejected: it ticks in about 15.6 ms steps on Windows), including local SQLite, result normalization and counting. It has no workerd, no Cache API and no cold kind. It is a Node wall-time proxy, not app-only or workerd CPU acceptance.

Consequence: the verdict column from `--mode wrangler` is **machine output with a known noise problem**. Only effects much larger than the noise floor and reproduced in both runs (SA-007, SA-008) are diagnostic evidence. U02 requires the full quiet-host gate, including warm BASELINE max + observed resolution strictly below 4ms. At or above 4ms, STOP on that host; do not select a minimum across retries or change hosts to manufacture a passing verdict. Report the BASELINE row and all required sample evidence.

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

Rows below that say "not yet measured" were superseded by section 10 (MIG-0639: every main Hono method measured once on Linux; verdicts 判定不能). "measured" means U01 measured it locally with the caveats of section 4; the numbers are in section 5. Everything else is **not yet measured** (U02, after MIG-0603..0605 merge). SA rows are extra (admin mutation endpoints that exist on #331), not part of the 31.

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

## 9. MIG-0639 U01: Linux-local live event upper-bound scenarios (2026-10-29)

Status: **SCENARIOS IMPLEMENTED for every main Hono method (116, section 10). The Linux run was done and is INCONCLUSIVE under the STOP rule below (BASELINE warm max 11.14 ms >= 4 ms).** This section records test design; the numbers are in section 10 and are LOCAL, not production values.

| Method | normal | limit | invalid | Source |
| --- | --- | --- | --- | --- |
| RH-020 GET /api/live/events/:id/slots | 1 visible slot | **6,000** available slots (D-12 MAX_LIVE_SLOTS) | 129-character event id → 400 | `apps/api/src/routes/live/events.ts#getLiveEventSlots` |
| RH-021 GET /api/live/events/:id/submissions | 1 public video linked to event | **50** public videos, linked to the event | 129-character event id → 400 | `apps/api/src/routes/live/events.ts#getLiveEventSubmissions` |
| RH-022 GET /api/live/events/:id/summary | 1 available slot | **6,000** available slots | 129-character event id → 400 | `apps/api/src/routes/live/events.ts#getLiveEventSummary` |

All fixtures use a locally seeded public event, synthetic IDs and `node:sqlite` migrations. The 6,000-row fixture is inserted by one bounded recursive CTE and not 6,000 individual D1 statements. The event ID varies for every sample; otherwise the 15-second isolate micro-cache would make an uncached limit scan appear cheaper. The existing `BASELINE` scenario remains in the same benchmark plan.

Required completion before any budget verdict: run `node scripts/benchmark-api-cpu.mjs --mode wrangler` on Linux with **at least 50 normal, 50 limit, 50 invalid and 50 cold samples** for each measured method; record OS/kernel, CPU, Node and Wrangler versions, all p50/p95/p99/max, expected-status mismatches and D1 statement counts. The harness is LOCAL ONLY (workerd + local D1) and is not production observability.

**STOP condition:** If same-run BASELINE warm max ≥ 4ms, classify S2 7ms judgment **INCONCLUSIVE** and stop without using the numbers as a D-12 paging verdict. No paging/additive endpoint change is authorized here. The STOP condition fired in the section 10 run. The other Hono methods (including RH-012 500-video x 100-member and RH-014 own-slots-100) were added to the same harness; see section 10.

Rollback: revert PR #456. No worker, D1/R2/Queue, route, secret, or Cloudflare configuration change.

## 10. Linux run (MIG-0639)

Label: **LOCAL MEASUREMENT - NOT A PRODUCTION VALUE.** One run, `node scripts/benchmark-api-cpu.mjs --mode wrangler` (default `--d1 replay`), started 2026-11-01T22:29:41.255Z, repo commit `eb4bc01b4dbb7b67e8825c3086a6788d4a93ca7d` (the harness commit; `apps/api/src/**` untouched).

| item | value |
| --- | --- |
| host | Linux linux/x64, kernel 6.18.44-fc-v185 (Firecracker-style microVM container), 4 vCPU, Intel Xeon @ 2.10 GHz, 16.9 GB RAM |
| Node / Wrangler | v22.23.4 / 4.118.0 (workerd via `wrangler dev --local`) |
| CPU source | V8 sampling profiler on the workerd inspector, 100 us interval, non-idle samples; D1/R2 results replayed from an in-process `node:sqlite` run (local D1 simulator cost excluded, real D1 round trip excluded); clock resolution 0.1 ms |
| samples | 50 normal + 50 limit + 50 invalid + 50 cold per method, 10 warm-up discarded per kind; 0 methods below 50 samples |
| noise floor | **BASELINE warm max 11.14 ms** (p95 6.22 ms, no-op route) |
| methods | 117 scenarios = every method in `app.routes` (116, pinned by `scripts/benchmark-api-cpu.test.mjs`) + S4 session probe |

### STOP rule applied

The Work Order STOP says: BASELINE warm max >= 4 ms means the S2 verdict is "判定不能" and the run stops on the same host. BASELINE read 11.14 ms, so **every S2 and S3 verdict in this section is 判定不能 (INCONCLUSIVE by rule)**. The `judge()` column below is the machine output (it counts 51 FAIL / 65 INCONCLUSIVE / 1 PASS) and must not be read as a budget verdict: a no-op `new Response("ok")` itself reads up to 11.14 ms on this host, and single-sample maxima follow that shape. No host was changed, no endpoint was edited, no code was fixed.

### Signals that do not depend on the noise floor

BASELINE p95 is 6.22 ms. A method whose p50 (the median, robust to spikes) is well above that is not explained by noise. These are leads for the owner MIG, not verdicts:

| method | kind | p50 / p95 / max (ms) | note | owner MIG |
| --- | --- | --- | --- | --- |
| RH-012 `GET /api/event-endpoints/:id/release` | limit (500 videos x 100 members) | 42.5 / 68.4 / 100.5 | 4,374,353-byte response, D1 statements 1. normal (1 video) p50 3.7. Cost is JSON parse + normalize of the 50,000-member artifact | MIG-0631 (follow-up unit; not in this MIG) |
| SA-007 `POST /api/admin/api-endpoints`, SA-008 `PATCH /api/admin/api-endpoints/:id` | normal / limit | p50 21.7 / 21.5, max 39.2 / 36.0 | reproduces the MIG-0606 finding (8 post-commit `caches.default.delete`, section 4 item 5) | MIG-0602 |
| SA-004/005 admin announcements, SA-009/016..020 audit and cost-guard writes, HONO-ADM-02..05 user writes | all | p50 about 6-7 | S3 writes read p50 6-7 ms against a no-op p50 of 0; session + CostGuard + audit-settings reads. Over the S3 budget only if the p50 is real; cannot be settled on this host | MIG-0602 / MIG-0637 |

### D-12 live slots 6000 (T03) and RH-020..022

| method | kind | n | p50 | p95 | p99 | max (ms) | D1 stmts | response bytes |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| RH-020 slots | normal (1 slot) | 50 | 4.01 | 7.62 | 11.12 | 11.12 | 1 | 175 |
| RH-020 slots | limit (6000 slots) | 50 | 5.94 | 8.88 | 23.12 | 23.12 | 1 | 556977 |
| RH-021 submissions | limit (50 videos) | 50 | 4.06 | 7.98 | 10.84 | 10.84 | 2 | 5470 |
| RH-022 summary | limit (6000 slots) | 50 | 4.00 | 6.01 | 8.00 | 8.00 | 2 | 130 |

**D-12 verdict: 判定不能 (INCONCLUSIVE).** The 6000-slot warm max is 23.1 ms, numerically above 7 ms, but BASELINE max is 11.1 ms (>= 4 ms), so under the STOP rule this number is not a paging verdict in either direction. The p50 gap between 1 slot (4.0) and 6000 slots (5.9) is about 1.9 ms. **No additive paging unit is created and no permanent exception is declared**; MIG-0604 records "D-12 open, re-measure on a quiet host" (its work item, Known differences). An owner decision on a quiet host is needed to close it.

### MIG-0631 T17 (RH-012 / RH-015 / RH-014 upper bounds)

- RH-012 500 videos x 100 members: warm p50 42.5 ms, max 100.5 ms, response 4,374,353 bytes, D1 statements 1. Formal verdict: 判定不能 (STOP). The median alone is about 6x the S2 budget, so this is the strongest lead in the table for a MIG-0631 follow-up (bounded artifact size or a smaller public DTO); this MIG changes no code.
- RH-015 `GET /api/events` page of 60 events with 2,000-char explanations: see the table (response 140053 bytes, D1 1).
- RH-014 own slots 100 (D-12, MAX_VIEWER_SLOTS): response 40403 bytes (under the 64 KiB cap), p50 3.95 ms, max 227.9 ms (one isolated spike; p95 7.1).
- RH-013 is not mounted on main: its upper-bound scenario (1 event, 500 videos x 100 members) is in the harness as a pending scenario (`--include-pending`) owned by this MIG per the owner authorization; MIG-0632 moves it into the inventory when it mounts the route (a test fails the day the route appears).

### Data-depth coverage and known measurement limits (read before using the table)

1. The generic inventory runs on the shared minimal fixture (one event, one video, one slot, one chapter ...). Its `limit` kind pushes every bounded input to its cap (limit/page/q, long reasons, 8-row csv, 128-char ids); it does not seed deep data. Deep data exists only for RH-003/007 (60/120 `events` rows over the 50/99 page caps), RH-012 (500 x 100), RH-014 (100 own slots), RH-015 (60 x 2,000 chars), RH-020/022 (6000 slots), RH-021 (50 videos), RH-028 (100 staff) and HONO-AR-26 (24,000-char audit payload, second chunk).
2. Status mismatches (the harness counts any status outside the pinned expectation): RH-020 cold 14, RH-021 limit 2 and cold 1, RH-022 cold 1, RH-003/007/009 cold 42 each. The cold kind reloads the isolate, and the replay script was recorded warm; per-isolate caches (spreadsheet catalog, live operation mode) change the D1 statement sequence, so the replay drifts. Treat the **cold column of those six methods as void**; their normal/limit/invalid columns have 0 mismatches except RH-021 limit (2 of 50).
3. `/api/media/*`, Google Drive and YouTube proxies use a bench-only offline image stub (no network). Methods that need an R2 object or a binding the harness does not provide answer their documented 503/404 (pinned in the expectations); their CPU is the guard path, not the success path.
4. Writes go through the replay target: real D1 round trips, the Cache API cost in production and workerd's own CPU accounting are not measured (section 4).
5. A quiet host is required before any budget verdict. The next step is an owner decision: run on a host whose BASELINE warm max is below 4 ms (the STOP rule forbids changing the host inside this MIG).

### Method table

Columns are LOCAL maxima in ms per kind (overall max includes cold). `verdict (judge)` is the harness output, **not** the budget verdict (see STOP rule). Owner MIG is who gets the follow-up if a quiet-host re-run confirms an overrun; reason for every row marked FAIL/INCONCLUSIVE: single-sample maxima are within the BASELINE noise shape, except the three signal rows above.

| ID | method path | class | owner MIG | normal max | limit max | invalid max | cold max | overall max | p50 / p95 / p99 of the worst kind | D1 stmts (max) | status mismatches | verdict (judge) |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- | ---: | ---: | --- |
| RH-018 | GET /api/health | S2 | MIG-0601/0661 | 5.58 | 8.00 | 6.85 | 38.47 | 38.47 | cold: 2.84 / 5.19 / 38.47 | 0 | 0 | FAIL |
| RH-017 | GET /api/health/deep | S2 | MIG-0601/0661 | 7.39 | 8.03 | 10.81 | 14.48 | 14.48 | cold: 3.30 / 7.78 / 14.48 | 0 | 0 | INCONCLUSIVE |
| RH-026 | GET /api/public/about-stats | S2 | MIG-0601/0661 | 13.41 | 13.37 | 11.37 | 21.12 | 21.12 | cold: 6.50 / 15.07 / 21.12 | 0 | 0 | FAIL |
| RH-029 | GET /api/software/suggestions | S2 | MIG-0601/0661 | 7.72 | 8.91 | 45.45 | 6.68 | 45.45 | invalid: 3.50 / 5.46 / 45.45 | 2 | 0 | FAIL |
| SA-004 | POST /api/admin/announcements | S3 | MIG-0602 | 9.61 | 18.41 | 10.10 | 23.39 | 23.39 | cold: 6.19 / 19.37 / 23.39 | 9 | 0 | FAIL |
| SA-005 | PUT /api/admin/announcements/:id | S3 | MIG-0602 | 11.08 | 12.45 | 19.65 | 35.15 | 35.15 | cold: 6.04 / 9.71 / 35.15 | 10 | 0 | FAIL |
| SA-006 | DELETE /api/admin/announcements/:id | S3 | MIG-0602 | 10.31 | 12.30 | 12.82 | 18.74 | 18.74 | cold: 3.94 / 6.79 / 18.74 | 10 | 0 | INCONCLUSIVE |
| SA-007 | POST /api/admin/api-endpoints | S3 | MIG-0602 | 39.20 | 34.01 | 10.98 | 34.33 | 39.20 | normal: 21.71 / 32.15 / 39.20 | 8 | 0 | FAIL |
| SA-008 | PATCH /api/admin/api-endpoints/:id | S3 | MIG-0602 | 36.02 | 35.45 | 9.99 | 40.63 | 40.63 | cold: 19.68 / 34.34 / 40.63 | 8 | 0 | FAIL |
| RH-020 | GET /api/live/events/:id/slots (6000-slot D-12 cap) | S2 | MIG-0604 | 11.12 | 23.12 | 7.28 | 17.26 | 23.12 | limit: 5.94 / 8.88 / 23.12 | 2 | 14 | FAIL |
| RH-021 | GET /api/live/events/:id/submissions (50 public videos) | S2 | MIG-0604 | 7.15 | 10.84 | 8.60 | 11.19 | 11.19 | cold: 3.20 / 5.50 / 11.19 | 2 | 3 | INCONCLUSIVE |
| RH-022 | GET /api/live/events/:id/summary (6000-slot counts) | S2 | MIG-0604 | 8.26 | 8.00 | 7.81 | 33.05 | 33.05 | cold: 2.89 / 12.82 / 33.05 | 2 | 1 | FAIL |
| S4 | session resolution (cookie -> session -> user, 1 D1 read) | S4 | MIG-0602 | 6.77 | 15.61 | 7.89 | 7.75 | 15.61 | limit: 3.48 / 5.80 / 15.61 | 1 | 0 | FAIL |
| MIG-0661 | GET /api/operation-mode/banner | S2 | MIG-0601/0661 | 11.72 | 16.32 | 10.88 | 11.57 | 16.32 | limit: 3.80 / 5.72 / 16.32 | 0 | 0 | INCONCLUSIVE |
| RH-027 | OPTIONS /api/public/events/:id/staff | S2 | MIG-0647 | 10.98 | 7.45 | 16.97 | 45.16 | 45.16 | cold: 3.36 / 11.39 / 45.16 | 0 | 0 | FAIL |
| RH-028 | GET /api/public/events/:id/staff | S2 | MIG-0647 | 10.00 | 15.30 | 12.07 | 13.56 | 15.30 | limit: 5.92 / 9.16 / 15.30 | 0 | 0 | INCONCLUSIVE |
| HONO-PERS-01 | POST /api/personal/terms/accept | S3 | MIG-0636 | 39.19 | 57.65 | 9.46 | 18.57 | 57.65 | limit: 5.59 / 10.93 / 57.65 | 3 | 0 | FAIL |
| HONO-PERS-02 | POST /api/personal/onboarding/terms | S3 | MIG-0636 | 17.64 | 15.50 | 11.71 | 20.44 | 20.44 | cold: 5.02 / 6.73 / 20.44 | 3 | 0 | FAIL |
| HONO-PERS-03 | POST /api/personal/onboarding/complete | S3 | MIG-0636 | 10.76 | 12.42 | 8.96 | 22.31 | 22.31 | cold: 4.55 / 7.59 / 22.31 | 4 | 0 | FAIL |
| HONO-PERS-04 | GET /api/personal/session | S2 | MIG-0611 | 9.09 | 14.51 | 9.55 | 10.40 | 14.51 | limit: 3.95 / 6.30 / 14.51 | 2 | 0 | INCONCLUSIVE |
| HONO-PERS-05 | GET /api/personal/dashboard | S2 | MIG-0611 | 8.55 | 15.51 | 6.81 | 14.05 | 15.51 | limit: 4.06 / 7.37 / 15.51 | 3 | 0 | INCONCLUSIVE |
| HONO-PERS-06 | GET /api/personal/library | S2 | MIG-0611 | 9.27 | 10.32 | 7.43 | 12.02 | 12.02 | cold: 3.17 / 4.78 / 12.02 | 3 | 0 | INCONCLUSIVE |
| HONO-PERS-07 | GET /api/personal/settings | S2 | MIG-0611 | 7.77 | 10.91 | 30.64 | 13.27 | 30.64 | invalid: 3.93 / 7.90 / 30.64 | 3 | 0 | FAIL |
| HONO-PERS-08 | GET /api/personal/onboarding | S2 | MIG-0611 | 58.38 | 6.33 | 7.27 | 10.90 | 58.38 | normal: 4.11 / 7.16 / 58.38 | 2 | 0 | FAIL |
| HONO-PERS-09 | GET /api/personal/entry | S2 | MIG-0611 | 8.82 | 7.95 | 6.52 | 9.56 | 9.56 | cold: 3.46 / 7.62 / 9.56 | 3 | 0 | INCONCLUSIVE |
| HONO-PERS-10 | GET /api/personal/entry/slotted | S2 | MIG-0611 | 9.39 | 6.52 | 7.20 | 9.91 | 9.91 | cold: 3.14 / 7.36 / 9.91 | 2 | 0 | INCONCLUSIVE |
| HONO-PERS-11 | GET /api/personal/entry/unslotted | S2 | MIG-0611 | 14.45 | 10.24 | 90.42 | 11.59 | 90.42 | invalid: 3.54 / 6.98 / 90.42 | 3 | 0 | FAIL |
| HONO-PERS-12 | GET /api/personal/edit/:id/permissions | S2 | MIG-0611 | 7.71 | 6.30 | 21.31 | 11.76 | 21.31 | invalid: 3.05 / 5.79 / 21.31 | 3 | 0 | FAIL |
| HONO-PERS-13 | GET /api/personal/edit/:id/form-options | S2 | MIG-0611 | 8.11 | 30.10 | 8.70 | 18.06 | 30.10 | limit: 3.48 / 6.56 / 30.10 | 3 | 0 | FAIL |
| HONO-PERS-14 | GET /api/personal/edit/:id | S2 | MIG-0611 | 7.56 | 7.06 | 9.16 | 10.55 | 10.55 | cold: 3.45 / 6.86 / 10.55 | 3 | 0 | INCONCLUSIVE |
| HONO-AR-01 | GET /api/admin-read/cost-guard-banner | S2 | MIG-0625 | 6.38 | 7.80 | 5.49 | 11.23 | 11.23 | cold: 3.41 / 5.80 / 11.23 | 2 | 0 | INCONCLUSIVE |
| HONO-AR-02 | GET /api/admin-read/users/:id/edit | S2 | MIG-0625 | 5.12 | 10.11 | 10.63 | 13.12 | 13.12 | cold: 2.93 / 6.36 / 13.12 | 2 | 0 | INCONCLUSIVE |
| HONO-AR-03 | GET /api/admin-read/users | S2 | MIG-0625 | 31.38 | 11.98 | 7.91 | 7.87 | 31.38 | normal: 3.38 / 6.44 / 31.38 | 2 | 0 | FAIL |
| HONO-AR-04 | GET /api/admin-read/users/:id | S2 | MIG-0625 | 25.29 | 6.84 | 7.86 | 12.59 | 25.29 | normal: 3.62 / 6.80 / 25.29 | 3 | 0 | FAIL |
| HONO-AR-05 | GET /api/admin-read/videos | S2 | MIG-0625 | 7.04 | 7.72 | 6.70 | 9.74 | 9.74 | cold: 3.44 / 5.74 / 9.74 | 3 | 0 | INCONCLUSIVE |
| HONO-AR-06 | GET /api/admin-read/videos/:id/members | S2 | MIG-0625 | 7.72 | 32.76 | 9.88 | 9.93 | 32.76 | limit: 3.68 / 6.47 / 32.76 | 3 | 0 | FAIL |
| HONO-AR-07 | GET /api/admin-read/videos/:id | S2 | MIG-0625 | 9.44 | 11.40 | 70.75 | 8.36 | 70.75 | invalid: 3.44 / 6.74 / 70.75 | 3 | 0 | FAIL |
| HONO-AR-08 | GET /api/admin-read/event-groups | S2 | MIG-0625 | 18.61 | 8.33 | 8.23 | 6.05 | 18.61 | normal: 3.85 / 7.20 / 18.61 | 2 | 0 | FAIL |
| HONO-AR-09 | GET /api/admin-read/event-groups/:id | S2 | MIG-0625 | 10.55 | 8.03 | 8.90 | 8.67 | 10.55 | normal: 3.87 / 8.31 / 10.55 | 3 | 0 | INCONCLUSIVE |
| HONO-AR-10 | GET /api/admin-read/events/templates | S2 | MIG-0625 | 10.00 | 10.11 | 6.85 | 9.86 | 10.11 | limit: 3.64 / 7.52 / 10.11 | 3 | 0 | INCONCLUSIVE |
| HONO-AR-11 | GET /api/admin-read/events/new | S2 | MIG-0625 | 14.60 | 9.64 | 14.54 | 19.83 | 19.83 | cold: 2.77 / 8.59 / 19.83 | 3 | 0 | FAIL |
| HONO-AR-12 | GET /api/admin-read/events | S2 | MIG-0625 | 9.14 | 5.57 | 11.07 | 12.97 | 12.97 | cold: 2.67 / 5.39 / 12.97 | 2 | 0 | INCONCLUSIVE |
| HONO-AR-13 | GET /api/admin-read/moderation | S2 | MIG-0625 | 8.01 | 7.06 | 6.03 | 9.60 | 9.60 | cold: 2.99 / 4.86 / 9.60 | 2 | 0 | INCONCLUSIVE |
| HONO-AR-14 | GET /api/admin-read/x-link-requests | S2 | MIG-0625 | 10.08 | 9.78 | 11.16 | 12.90 | 12.90 | cold: 2.92 / 5.88 / 12.90 | 3 | 0 | INCONCLUSIVE |
| HONO-AR-15 | GET /api/admin-read/x-id-merges | S2 | MIG-0625 | 198.24 | 7.43 | 7.18 | 11.62 | 198.24 | normal: 3.73 / 8.92 / 198.24 | 2 | 0 | FAIL |
| HONO-AR-16 | GET /api/admin-read/announcements | S2 | MIG-0625 | 7.83 | 27.72 | 6.84 | 29.29 | 29.29 | cold: 2.99 / 8.56 / 29.29 | 2 | 0 | FAIL |
| HONO-AR-17 | GET /api/admin-read/announcements/:id | S2 | MIG-0625 | 9.27 | 9.25 | 7.77 | 10.19 | 10.19 | cold: 2.79 / 6.79 / 10.19 | 2 | 0 | INCONCLUSIVE |
| HONO-AR-18 | GET /api/admin-read/rules | S2 | MIG-0625 | 6.72 | 7.81 | 6.71 | 8.48 | 8.48 | cold: 2.84 / 3.77 / 8.48 | 3 | 0 | INCONCLUSIVE |
| HONO-AR-19 | GET /api/admin-read/rules/:id | S2 | MIG-0625 | 5.55 | 8.47 | 17.10 | 17.03 | 17.10 | invalid: 3.48 / 6.22 / 17.10 | 2 | 0 | INCONCLUSIVE |
| HONO-AR-20 | GET /api/admin-read/permissions/simulator | S2 | MIG-0625 | 9.29 | 6.34 | 8.32 | 13.03 | 13.03 | cold: 2.89 / 4.62 / 13.03 | 1 | 0 | INCONCLUSIVE |
| HONO-AR-21 | GET /api/admin-read/api-endpoints | S2 | MIG-0625 | 5.77 | 11.81 | 7.35 | 10.31 | 11.81 | limit: 3.72 / 7.29 / 11.81 | 3 | 0 | INCONCLUSIVE |
| HONO-AR-22 | GET /api/admin-read/audit-settings | S2 | MIG-0625 | 8.76 | 6.35 | 9.02 | 42.84 | 42.84 | cold: 2.57 / 4.47 / 42.84 | 2 | 0 | FAIL |
| HONO-AR-23 | GET /api/admin-read/audit | S2 | MIG-0625 | 8.71 | 6.17 | 12.91 | 7.26 | 12.91 | invalid: 2.95 / 6.10 / 12.91 | 3 | 0 | INCONCLUSIVE |
| HONO-AR-24 | GET /api/admin-read/audit/restore | S2 | MIG-0625 | 5.17 | 9.05 | 57.34 | 5.31 | 57.34 | invalid: 3.19 / 7.70 / 57.34 | 2 | 0 | FAIL |
| HONO-AR-25 | GET /api/admin-read/audit/:id | S2 | MIG-0625 | 7.80 | 7.50 | 7.16 | 7.37 | 7.80 | normal: 3.19 / 5.88 / 7.80 | 3 | 0 | INCONCLUSIVE |
| HONO-AR-26 | GET /api/admin-read/audit/:id/payload/:field | S2 | MIG-0625 | 7.64 | 4.62 | 9.02 | 17.87 | 17.87 | cold: 3.02 / 5.44 / 17.87 | 2 | 0 | INCONCLUSIVE |
| HONO-AR-27 | GET /api/admin-read/ops/notifications | S2 | MIG-0625 | 6.56 | 8.62 | 12.82 | 5.34 | 12.82 | invalid: 3.17 / 7.51 / 12.82 | 3 | 0 | INCONCLUSIVE |
| HONO-AR-28 | GET /api/admin-read/ops/health | S2 | MIG-0625 | 7.14 | 9.38 | 8.13 | 7.11 | 9.38 | limit: 3.48 / 5.01 / 9.38 | 2 | 0 | INCONCLUSIVE |
| HONO-AR-29 | GET /api/admin-read/ops/integrity | S2 | MIG-0625 | 7.06 | 7.10 | 8.87 | 6.20 | 8.87 | invalid: 2.77 / 4.51 / 8.87 | 1 | 0 | INCONCLUSIVE |
| HONO-AR-30 | GET /api/admin-read/ops/static-builds | S2 | MIG-0625 | 6.17 | 7.77 | 8.91 | 8.35 | 8.91 | invalid: 2.52 / 6.38 / 8.91 | 3 | 0 | INCONCLUSIVE |
| HONO-AR-31 | GET /api/admin-read/ops/workers | S2 | MIG-0625 | 7.84 | 5.90 | 6.40 | 7.47 | 7.84 | normal: 2.92 / 6.01 / 7.84 | 3 | 0 | INCONCLUSIVE |
| HONO-AR-32 | GET /api/admin-read/ops/security | S2 | MIG-0625 | 6.03 | 7.21 | 7.04 | 5.53 | 7.21 | limit: 3.03 / 5.95 / 7.21 | 1 | 0 | INCONCLUSIVE |
| HONO-AR-33 | GET /api/admin-read/ops/youtube-playlists | S2 | MIG-0625 | 5.08 | 6.54 | 6.00 | 6.16 | 6.54 | limit: 3.23 / 5.25 / 6.54 | 3 | 0 | PASS |
| HONO-AR-34 | GET /api/admin-read/ops/youtube-quota | S2 | MIG-0625 | 10.01 | 6.70 | 7.24 | 37.89 | 37.89 | cold: 18.66 / 29.26 / 37.89 | 2 | 0 | FAIL |
| HONO-AR-35 | GET /api/admin-read/ops/top | S2 | MIG-0625 | 7.26 | 7.81 | 10.64 | 9.79 | 10.64 | invalid: 2.88 / 5.23 / 10.64 | 2 | 0 | INCONCLUSIVE |
| HONO-AR-36 | GET /api/admin-read/ops/cost-guard | S2 | MIG-0625 | 6.56 | 14.17 | 6.75 | 5.58 | 14.17 | limit: 3.43 / 6.81 / 14.17 | 3 | 0 | INCONCLUSIVE |
| HONO-AR-37 | GET /api/admin-read/ops/youtube-sync | S2 | MIG-0625 | 9.38 | 7.99 | 6.87 | 14.82 | 14.82 | cold: 3.75 / 8.60 / 14.82 | 2 | 0 | INCONCLUSIVE |
| HONO-MG-01 | GET /api/manage/navigation | S2 | MIG-0624/0630 | 6.53 | 9.59 | 7.39 | 8.33 | 9.59 | limit: 3.48 / 7.57 / 9.59 | 2 | 0 | INCONCLUSIVE |
| HONO-MG-02 | GET /api/manage/events/:id/staff | S2 | MIG-0624/0630 | 9.56 | 9.18 | 23.75 | 26.69 | 26.69 | cold: 2.76 / 5.60 / 26.69 | 2 | 0 | FAIL |
| HONO-MG-03 | GET /api/manage/events/:id/slots | S2 | MIG-0624/0630 | 9.56 | 6.81 | 9.28 | 7.00 | 9.56 | normal: 3.41 / 7.19 / 9.56 | 2 | 0 | INCONCLUSIVE |
| HONO-MG-04 | GET /api/manage/events/:id/edit | S2 | MIG-0624/0630 | 13.56 | 8.70 | 8.12 | 53.12 | 53.12 | cold: 3.05 / 5.31 / 53.12 | 2 | 0 | FAIL |
| HONO-MG-05 | GET /api/manage/events/:id/videos/:videoId | S2 | MIG-0624/0630 | 6.07 | 7.45 | 10.69 | 117.40 | 117.40 | cold: 3.35 / 7.61 / 117.40 | 2 | 0 | FAIL |
| HONO-MG-06 | GET /api/manage/events/:id/videos | S2 | MIG-0624/0630 | 6.48 | 225.83 | 6.81 | 6.63 | 225.83 | limit: 3.97 / 7.30 / 225.83 | 2 | 0 | FAIL |
| HONO-MG-07 | GET /api/manage/events/:id/youtube-playlist | S2 | MIG-0624/0630 | 9.32 | 6.26 | 8.65 | 8.41 | 9.32 | normal: 3.63 / 6.24 / 9.32 | 2 | 0 | INCONCLUSIVE |
| SA-038 | PUT /api/manage/events/:id/youtube-playlist | S3 | MIG-0655 | 9.80 | 39.00 | 7.97 | 18.91 | 39.00 | limit: 5.61 / 11.67 / 39.00 | 10 | 0 | FAIL |
| SA-039 | POST /api/manage/events/:id/youtube-playlist/sync | S3 | MIG-0655 | 6.87 | 8.35 | 10.26 | 14.94 | 14.94 | cold: 4.38 / 8.20 / 14.94 | 4 | 0 | INCONCLUSIVE |
| HONO-MG-08 | GET /api/manage/events/:id/audience | S2 | MIG-0624/0630 | 6.83 | 8.25 | 13.46 | 6.97 | 13.46 | invalid: 3.21 / 5.33 / 13.46 | 2 | 0 | INCONCLUSIVE |
| HONO-MG-09 | GET /api/manage/events/:id | S2 | MIG-0624/0630 | 7.91 | 6.02 | 7.49 | 8.07 | 8.07 | cold: 3.33 / 5.49 / 8.07 | 2 | 0 | INCONCLUSIVE |
| HONO-MG-10 | GET /api/manage/notifications | S2 | MIG-0624/0630 | 8.79 | 7.99 | 7.19 | 10.75 | 10.75 | cold: 3.38 / 6.66 / 10.75 | 2 | 0 | INCONCLUSIVE |
| HONO-MG-11 | GET /api/manage/x-link-requests | S2 | MIG-0624/0630 | 6.19 | 10.49 | 8.22 | 5.81 | 10.49 | limit: 3.11 / 6.63 / 10.49 | 2 | 0 | INCONCLUSIVE |
| HONO-MG-12 | GET /api/manage | S2 | MIG-0624/0630 | 6.46 | 8.85 | 8.55 | 7.22 | 8.85 | limit: 4.22 / 8.04 / 8.85 | 2 | 0 | INCONCLUSIVE |
| RH-003 | GET /api/admin/spreadsheet/data | S2 | MIG-0605 | 8.35 | 76.10 | 14.64 | 11.91 | 76.10 | limit: 4.97 / 10.02 / 76.10 | 3 | 42 | FAIL |
| RH-007 | GET /api/admin/spreadsheet/export | S2 | MIG-0605 | 8.95 | 7.92 | 9.38 | 8.16 | 9.38 | invalid: 3.56 / 5.80 / 9.38 | 2 | 42 | INCONCLUSIVE |
| RH-009 | GET /api/admin/spreadsheet/tables | S2 | MIG-0605 | 8.18 | 11.17 | 9.03 | 14.47 | 14.47 | cold: 3.47 / 5.19 / 14.47 | 2 | 42 | INCONCLUSIVE |
| HONO-ADM-01 | GET /api/admin/event-templates | S2 | MIG-0604/0655 | 12.37 | 9.49 | 10.02 | 16.35 | 16.35 | cold: 3.03 / 7.06 / 16.35 | 4 | 0 | INCONCLUSIVE |
| SA-009 | POST /api/admin/audit/settings | S3 | MIG-0637 | 11.46 | 18.89 | 11.75 | 17.50 | 18.89 | limit: 6.77 / 10.94 / 18.89 | 8 | 0 | INCONCLUSIVE |
| SA-010 | POST /api/admin/audit/dry-run | S3 | MIG-0637 | 13.72 | 12.39 | 15.67 | 28.64 | 28.64 | cold: 7.24 / 10.60 / 28.64 | 5 | 0 | FAIL |
| SA-016 | POST /api/admin/cost-guard/mode | S3 | MIG-0637 | 28.29 | 13.36 | 11.97 | 13.26 | 28.29 | normal: 5.71 / 8.88 / 28.29 | 7 | 0 | FAIL |
| SA-017 | POST /api/admin/cost-guard/maintenance | S3 | MIG-0637 | 11.42 | 11.54 | 11.41 | 12.98 | 12.98 | cold: 6.27 / 11.59 / 12.98 | 7 | 0 | INCONCLUSIVE |
| SA-018 | POST /api/admin/cost-guard/override | S3 | MIG-0637 | 14.36 | 13.16 | 15.04 | 18.30 | 18.30 | cold: 6.59 / 9.92 / 18.30 | 7 | 0 | INCONCLUSIVE |
| SA-019 | POST /api/admin/cost-guard/disabled-features | S3 | MIG-0637 | 27.59 | 12.37 | 10.19 | 12.95 | 27.59 | normal: 6.14 / 9.60 / 27.59 | 7 | 0 | FAIL |
| SA-020 | POST /api/admin/cost-guard/override/clear | S3 | MIG-0637 | 14.31 | 14.45 | 8.95 | 9.89 | 14.45 | limit: 6.68 / 10.73 / 14.45 | 7 | 0 | INCONCLUSIVE |
| HONO-ADM-02 | POST /api/admin/users/:userId/role | S3 | MIG-0637 | 16.74 | 12.05 | 12.14 | 10.40 | 16.74 | normal: 6.53 / 11.04 / 16.74 | 8 | 0 | INCONCLUSIVE |
| HONO-ADM-03 | POST /api/admin/users/:userId/banned | S3 | MIG-0637 | 9.61 | 10.21 | 9.46 | 10.07 | 10.21 | limit: 5.68 / 9.36 / 10.21 | 8 | 0 | INCONCLUSIVE |
| HONO-ADM-04 | POST /api/admin/users/:userId/notifications | S3 | MIG-0637 | 11.51 | 10.38 | 9.77 | 9.47 | 11.51 | normal: 5.77 / 9.68 / 11.51 | 10 | 0 | INCONCLUSIVE |
| HONO-ADM-05 | POST /api/admin/users/:userId/can-create-events | S3 | MIG-0637 | 31.13 | 12.59 | 13.93 | 10.87 | 31.13 | normal: 6.16 / 10.44 / 31.13 | 8 | 0 | FAIL |
| HONO-ADM-06 | POST /api/admin/x-users/:xUserId/icon-refresh | S3 | MIG-0637 | 10.25 | 9.51 | 11.61 | 11.94 | 11.94 | cold: 5.00 / 9.21 / 11.94 | 4 | 0 | INCONCLUSIVE |
| HONO-ADM-07 | POST /api/admin/event-templates | S3 | MIG-0604/0655 | 12.85 | 15.06 | 23.06 | 13.44 | 23.06 | invalid: 5.61 / 8.77 / 23.06 | 8 | 0 | FAIL |
| SA-036 | DELETE /api/admin/event-templates/:id | S3 | MIG-0604/0655 | 70.10 | 8.42 | 8.48 | 8.56 | 70.10 | normal: 4.37 / 6.25 / 70.10 | 8 | 0 | FAIL |
| RH-014 | GET /api/events/:id/slots/viewer-overlay | S2 | MIG-0604 | 9.84 | 227.88 | 11.93 | 9.21 | 227.88 | limit: 3.95 / 7.06 / 227.88 | 3 | 0 | FAIL |
| RH-015 | GET /api/events | S2 | MIG-0631 | 8.46 | 10.48 | 14.44 | 15.28 | 15.28 | cold: 4.71 / 7.90 / 15.28 | 1 | 0 | INCONCLUSIVE |
| RH-012 | GET /api/event-endpoints/:id/release | S2 | MIG-0631 | 8.81 | 100.52 | 7.47 | 10.59 | 100.52 | limit: 42.46 / 68.39 / 100.52 | 1 | 0 | FAIL |
| RH-032 | GET /api/videos | S2 | MIG-0634 | 7.75 | 8.69 | 9.06 | 9.73 | 9.73 | cold: 3.64 / 7.92 / 9.73 | 0 | 0 | INCONCLUSIVE |
| RH-031 | GET /api/videos/:id/viewer-overlay | S2 | MIG-0634 | 6.75 | 10.58 | 6.99 | 20.16 | 20.16 | cold: 4.23 / 6.28 / 20.16 | 3 | 0 | FAIL |
| RH-030 | GET /api/videos/:id | S2 | MIG-0634 | 5.63 | 9.46 | 5.79 | 10.79 | 10.79 | cold: 3.74 / 7.26 / 10.79 | 2 | 0 | INCONCLUSIVE |
| SA-012 | POST /api/videos/:videoId/chapters | S3 | MIG-0603/0640 | 28.01 | 34.84 | 37.05 | 10.57 | 37.05 | invalid: 5.24 / 8.93 / 37.05 | 10 | 0 | FAIL |
| SA-015 | POST /api/videos/:videoId/chapters/bulk | S3 | MIG-0603/0640 | 8.08 | 13.67 | 9.76 | 35.71 | 35.71 | cold: 6.26 / 11.31 / 35.71 | 12 | 0 | FAIL |
| SA-013 | PUT /api/videos/chapters/:chapterId | S3 | MIG-0603/0640 | 11.52 | 13.84 | 12.90 | 11.44 | 13.84 | limit: 5.63 / 8.49 / 13.84 | 10 | 0 | INCONCLUSIVE |
| SA-014 | DELETE /api/videos/chapters/:chapterId | S3 | MIG-0603/0640 | 8.02 | 9.52 | 7.70 | 10.76 | 10.76 | cold: 4.79 / 7.50 / 10.76 | 10 | 0 | INCONCLUSIVE |
| SA-087 | POST /api/videos/:videoId/interaction | S3 | MIG-0603/0640 | 12.48 | 17.09 | 9.73 | 12.68 | 17.09 | limit: 5.66 / 8.03 / 17.09 | 12 | 0 | INCONCLUSIVE |
| RH-001 | GET /api/account/summary | S2 | MIG-0605 | 5.99 | 6.94 | 8.62 | 10.96 | 10.96 | cold: 3.58 / 7.38 / 10.96 | 2 | 0 | INCONCLUSIVE |
| RH-016 | GET /api/google-drive-image/:id | S2 | MIG-0605 | 7.13 | 5.90 | 20.66 | 7.37 | 20.66 | invalid: 3.65 / 6.39 / 20.66 | 0 | 0 | FAIL |
| RH-033 | GET /api/youtube-thumbnail/:id/:size | S2 | MIG-0605 | 10.38 | 13.10 | 8.93 | 13.10 | 13.10 | limit: 4.61 / 9.75 / 13.10 | 0 | 0 | INCONCLUSIVE |
| RH-024 | GET /api/media/manage-x-icon/* | S2 | MIG-0646 | 9.29 | 7.09 | 11.40 | 7.04 | 11.40 | invalid: 3.65 / 7.00 / 11.40 | 0 | 0 | INCONCLUSIVE |
| RH-025 | GET /api/media/slot-submission-icon/:slotId | S2 | MIG-0646 | 7.03 | 8.89 | 8.58 | 38.51 | 38.51 | cold: 3.37 / 7.72 / 38.51 | 0 | 0 | FAIL |
| RH-023 | GET /api/media/* | S2 | MIG-0646 | 43.50 | 6.71 | 6.27 | 4.56 | 43.50 | normal: 3.61 / 6.81 / 43.50 | 0 | 0 | FAIL |
| RH-019 | GET /api/internal/x-users/search | S2 | MIG-0648 | 7.54 | 9.17 | 10.47 | 18.54 | 18.54 | cold: 3.36 / 5.39 / 18.54 | 1 | 0 | FAIL |


## MIG-0639: D1 returned-result row proxy (2026-11-13, CI pending)

The local API benchmark additionally collects `d1RowsReturned` and `d1PerQueryRows` from `first()`, `all()`, `raw()` and D1 batch results in both the Node SQLite adapter and local workerd (sim/replay) wrapper. The per-request `d1PerQueryRows` array counts each result-returning D1 invocation; `aggregate().kinds[kind].d1PerQueryRowsBySample` retains these arrays per sample. `d1RowsReturned` summarizes min / nearest-rank median / max / total per request kind and appears as `D1 returned rows proxy` in the Markdown report. Missing row data is reported as unknown, not zero. Replay compares the result-row count seen by its mock worker against the recorded SQLite result count and treats mismatches as invalid samples.

**Not a D1 billing metric:** This counts rows *returned to the application*, including zero for pure writes and unsuccessful reads. It cannot account for rows examined by SQLite scans, index seeks, or Cloudflare D1's billed `rows_read` / `rows_written` metadata. The replay also uses synthetic local results, not live Cloudflare D1 reads. The proxy must not be substituted for actual D1 billed rows in security/performance acceptance or used to pass the 500-video × 100-member RH-013 budget. For that gate, record actual Cloudflare non-production D1 query/rows-read evidence plus warm/cold local workerd CPU under the quiet-host BASELINE criterion; none has been measured by this code change.

Source commits: `1d04f9ee57df2c8f1c7aff583c1d8315bbc1d3d1`, `471fa239d3b125990d372e084f3edf8a2e7e352f`; regression `ff7310592dea4c067f13ad700e3b449ea8bd6a49`. No production API, remote D1/R2/Queue, routing, secrets or deployments changed.

## MIG-0639: execution-request counting and result transport (2026-11-27)

Source `2ee3b8ae67e3d7fab35b0a1c0f1f9911092924ff` corrects existing local harness accounting and transport. In Node, replay and simulator modes, **prepare/bind/rebind count 0; every first/all/run/raw attempt counts 1; batch counts submitted entries**. A failing batch still contributes its submitted entry count even if a later SQL statement never executes. The existing JSON `d1`/`maxD1Statements` fields and response `x-bench-d1` header carry this execution-request proxy. It does not count completed physical DB operations, transaction-control SQL or billed D1 reads/writes. Historical `D1 stmts` tables predate this correction and were not remeasured.

SQLite BLOBs are normalized from Uint8Array to number arrays, matching the installed Miniflare D1 `convertRows()` behavior; row keys retain their original order (`rowsToObjects()`/Drizzle's D1 raw mapping depend on that order). Node receives the same normalized values as replay, with a separate recorded snapshot. Only finite numbers other than -0, strings, booleans, null, dense arrays and plain/null-prototype objects are accepted after BLOB normalization. Unsupported/lossy values, accessors, Date, undefined, BigInt, cycles, sparse/extra-key arrays and symbol/non-enumerable keys fail recording even if an application handler catches the error. No sorting, truncation or argument-identity size cap is applied to results: regressions retain the complete 6,000-slot and 500-video x 100-member fixtures.

Node recording/registration and warm worker registration validate the snapshot before measured replay. Cold bootstrap uses a JSON string followed by JSON.parse, preserving own `__proto__` data keys with the same meaning as warm upload; module-initialization validation may occur before profiling. Each measured operation continues to check strict SQL/bind/method/batch/R2 identity and completion, without rewalking the entire result. This is local replay fidelity evidence, not a native Miniflare/full D1 adapter conformance claim or a CPU result.

At that historical source checkpoint, the existing suite was **68/68 PASS**, independently repeated with source-scope APPROVE; the optional native Miniflare startup probe produced no result and was stopped. **SA-026/098 fresh-UUID replay mismatches were still STOP**; the next section records the bounded input-fidelity correction. That checkpoint changed neither clock nor crypto. No full current 153-method/155-scenario run, quiet BASELINE, >=50-per-kind acceptance, D-12/T17 verdict, billed D1 result or separately authorized official Worker/tail cpuTime was supplied by that correction. PR #456 remains Draft and MIG-0639 IN_PROGRESS.

## MIG-0639: native UUID/time replay fidelity (2026-11-27)

Source [`d790468199b74cd66245589e3c6c06c3296a3473`](https://github.com/coroke3/flamenode/commit/d790468199b74cd66245589e3c6c06c3296a3473), tree `ee5e8bebb2ddfa6b686f55567a6f9c64d53ca6fd`, integrates main `203263eb94e55c6784fbf51ec4387ac4385ae5dc` with the existing PR #456 history. This follows the [owner's bounded handoff](https://github.com/coroke3/flamenode/pull/456#issuecomment-7218606549). The input transcript makes UUID-dependent operations comparable while preserving strict SQL, bind, operation-kind, batch-position and R2 argument identity checks.

During awaited application dispatch, `crypto.randomUUID()` and `Date.now()` join the same ordered transcript as D1/R2 operations. Every intercepted record **and replay** call invokes the native method first with its original receiver/arguments; replay then consumes a validated UUID-v4 or safe nonnegative integer time from the transcript. Input entries do not increment D1 execution counts. Invalid, missing, extra or out-of-order input invalidates the request even if the application catches the error. Original native property descriptors are restored in `finally`, including failure during partial installation. `performance.now()`, profiler boundaries/resolution and cold bootstrap are unchanged.

The native-input scope ends when `app.fetch` settles. It does not replay `new Date()`, `getRandomValues()`, `Math.random()` or inputs generated later in a streaming body/background task. These eight probes exercise awaited JSON handlers. In the Node recording server, a separate request guard retains recorder ownership through response-body draining and cleanup: overlapping requests fail closed even after dispatch has settled. The generated worker separately rejects overlapping run/control/simulator requests while handler dispatch is active. The guard fixes an independently reproduced case where a second request could otherwise clear the first request's recording. Every generated-worker fetch attempt, including an overlap rejection, increments the ordinal, preserving honest first-request provenance.

### Exact-source local workerd diagnostics

Linux x64, Node v22.23.5, repository-locked workerd 1.20260730.1; generated wrapper imports the actual Hono application. Synthetic local SQLite recordings feed bare workerd with no network service and an explicit local deny worker replacing the implicit internet capability. All eight results below have matching expected status, D1 execution/returned-row evidence and `replayComplete=1`.

| Scenario | Normal / limit / invalid / cold status | D1 execution requests, same order | Cold provenance |
| --- | --- | --- | --- |
| SA-026 | 200 / 200 / 400 / 200 | 9 / 9 / 2 / 9 | fresh process 47, generation native-cold-SA-026, ordinal 1 |
| SA-098 | 200 / 200 / 400 / 200 | 7 / 7 / 1 / 7 | fresh process 65, generation native-cold-SA-098, ordinal 1 |

Diagnostic `recordedUUIDInputs` / `recordedClockInputs` are **transcript entry counts**, not independent native invocation counters. A separate native-method interception probe verified native invocation and restoration over success / throw / success; it is distinct from these route diagnostics. The independent reviewer inspected both the source and route evidence, independently reran the existing Node suite **71/71 PASS**, and verified this source tree equals the tested integrated tree. The reviewer did not independently rerun the native route diagnostics. Final integrated-head dual CI and final documentation-review receipts belong on [PR #456](https://github.com/coroke3/flamenode/pull/456).

The Wrangler diagnostic was rejected by automatic approval review because it could make an external HTTPS connection to `workers.cloudflare.com`; it was not retried or bypassed. The isolated bare-workerd checks above are a materially narrower source-fidelity diagnostic. They provide **no CPU/profile result, no Wrangler lifecycle acceptance, no official tail evidence and no production-data evidence**. First-fetch provenance here certifies only the two bare-workerd requests, not an entire cold measurement campaign.

### Remaining acceptance

Keep Draft / IN_PROGRESS. Run all current 153 mounted methods plus session/BASELINE (155 scenarios), with at least 50 valid samples for every required kind, at least 10 discarded warmups and verified first-fetch cold provenance. Require strict warm BASELINE max + resolution <4ms; at >=4ms STOP on that host, without selecting retries/hosts to obtain a pass. Record fixed source SHA, raw distributions, resolution and the actual CPU source, including native/input/replay overhead described above. Complete D-12's 6,000-slot and T17's 500-video x 100-member verdicts, the existing owner-lane Auth.js coverage and separately authorized official nonproduction Worker/tail cpuTime evidence. Returned rows remain a proxy, not billed rows_read. No whole-PR merge or performance PASS follows from these fidelity results.

## MIG-0639: explicit event-playlist harness inputs (2026-11-27)

Source `2b1bf792d70ec2a79b5ec71e0b2dbb3697c35f80` follows the [bounded #456 work order](https://github.com/coroke3/flamenode/pull/456#issuecomment-7221131249) and integrates main `1cdf95dca594282d922cfd0bd98b2f703427b09a`. This adds local harness inputs and fidelity checks; no runtime API or Auth.js implementation changes. The default inventory remains **153 mounted methods plus session and BASELINE (155 scenarios)**, with the original video-only RH-031 request unchanged.

`RH-031-PLAYLIST` is an explicit diagnostic variant selected by `--only RH-031-PLAYLIST`; it is not a duplicate mounted-method inventory entry. Plan inspection requires no runtime measurement:

```bash
node scripts/benchmark-api-cpu.mjs --dry-run --only RH-031-PLAYLIST
```

Programmatic diagnostics use `buildScenarios(plan, { includeEventPlaylist: true })`, select this ID, apply `prepareKind[kind].r2Objects`, and execute the kind's `setup` before its request. The query is `/api/videos/bench-playlist-video/viewer-overlay?playlist=bench-playlist-event`. Isolated video/event fixtures supply a matching public event label and a synthetic signed-in viewer; the manifest fences `bp-v1` while preserving the current video. Cold preparation now reapplies each selected scenario's own normal fixture before recording its request, including the shared visibility-manifest key.

| Kind | Raw canonical playlist rows | Expected visible IDs | Purpose |
| --- | --- | --- | --- |
| normal | 3 | current video and `bp-v2` | Check the individual fence while retaining a nonempty playlist |
| limit | 500 | 499 ordered survivors | Exercise the canonical item limit with short valid strings and a response within 64 KiB |
| invalid | 501 | none, generic playlist label | Require rejection of the original oversized artifact before filtering its fenced row |
| cold | normal fixture in a fresh process | same as normal | Preserve existing first-fetch provenance requirements |

Each variant spec explicitly selects `visibilityGuardMode: "enforce"`. `benchmarkRequestHeaders()` validates `off|observe|enforce` and transports it in the reserved local `x-bench-visibility-guard-mode` header; `benchmarkRequestEnv()` validates the received value and clones the environment for that request. Unspecified requests retain the existing environment. Invalid modes fail the benchmark, and success or failure does not change the next request's mode. Node recording and generated simulator/replay dispatch use the same helper; cold mode selection needs no preliminary application fetch.

R2 `head()` records and replays its own strict `r2.head` key/options identity, returning detached `{size, etag}` metadata or `null`, without a GET/body operation. GET and HEAD remain distinct transcript operations; wrong keys, typed options, order, exhausted/trailing entries and caught mismatches remain invalid. For the text objects installed by `setR2`, HEAD size matches the GET object's UTF-8 byte size and the fixed fixture ETag. The existing binary `put()` adapter stores a base64 representation and is unchanged; this unit does not establish general R2 upload/body/conditional-request conformance or actual R2 service cost. A synthetic ordered GET-manifest / GET-playlist / HEAD-manifest probe preserves stable, changed and missing final ETags for a fail-closed consumer. It is a harness transport regression, not an actual #723 endpoint test.

The explicit spec's `expectPlaylist` carries the expected ordered IDs and label. After the response drains and the existing Node timer or workerd profiler has stopped, `playlistResponseMismatch()` verifies those values, the signed-in/non-degraded shape and the 64 KiB cap. Both recorder and measured responses must satisfy the contract; failed or missing body verification makes warm/cold samples unexpected even if HTTP status is 200. Default scenarios retain their existing recorder result shape. Request-local mode validation, environment copying and HEAD replay identity bookkeeping remain inside the generated request's measured work; no overhead is subtracted and no app-only CPU claim is made.

Node v22.23.5 ran the existing benchmark suite **79/79 PASS** (71 existing cases plus eight bounded additions), including the real migrated-schema seed, metadata/null replay, sticky failures, mode isolation through throw, first-fetch mode transport, canonical 500/501 rows, body rejection and cold fixture isolation. The opt-in dry-run selects only this variant and BASELINE. These are harness/fixture tests; the separate actual-Hono diagnostic below uses a fixed temporary candidate combining this source with #719 `57860ad0e45069b4508da641cf6f6b77941782ad` and #723 `87404de199d525ecf55118f0a84b02368e132d3a`; full bounded S2 assessment also requires #705 `7cb2073b65af536e7030e6e3f31ada3947c95260`. Those runtime changes are not part of #456's source tree.

Keep Draft / IN_PROGRESS. `--only` remains subject to `STOP_PARTIAL`; this variant supplies no full-run acceptance. No CPU profiling was run for this continuation. The strict warm BASELINE max + resolution <4ms gate, all 155 required scenarios, >=50 valid samples per required kind, >=10 warmups, S2 max <7ms, D1/response bounds, D-12/T17 verdicts, Auth.js coverage and separately authorized official Worker/tail evidence remain unchanged. Independent exact-source review and final-head required CI remain necessary; receipts belong on the existing PR.

### Combined native playlist diagnostic (2026-11-28 JST)

Publication mapping: public source `2b1bf792d70ec2a79b5ec71e0b2dbb3697c35f80` has the same complete tree `ea76c1ad2ffd3218e0a0823fedf05def131d0a95` as locally tested `f65a6b3e1f00cf1e1f556c8dccf5e44d17b62f67`. The temporary diagnostic combined commit below retains the local source in its ancestry; this establishes content equivalence without changing the recorded diagnostic ancestry.

The integration coordinator ran actual Hono handlers through the generated native workerd replay wrapper on temporary combined head `27c077eb347a5b1604a87d911fd0b32d6b35394b`, tree `df1a2f81a3175d46cbc2aa83389619479ccca075`: locally tested benchmark source `f65a6b3e1f00cf1e1f556c8dccf5e44d17b62f67` plus main `1cdf95dca594282d922cfd0bd98b2f703427b09a`, public #719 `57860ad0e45069b4508da641cf6f6b77941782ad` and public #723 `87404de199d525ecf55118f0a84b02368e132d3a`. **#705 is absent from this diagnostic tree.** Node v22.23.5, workerd 1.20260730.1 and Miniflare 5.20260730.0-alpha were used. The `consumed-inputs.json` manifest identifies 343 tracked source inputs. Final `report.json` SHA-256: `8d8e19004a28c6c1017eb2cc8e62c3338ecb679c3803cbc39f2a680845ebac9a`; `native-final.log` retains the two final failures.

The final nine-case report contains **7 PASS / 2 FAIL**. Here, `warm-normal` names the registration path's first application dispatch (worker fetch ordinal 2 after registration); it is not a steady-warm CPU sample. The table's fresh first-request cases use separate workers and attest fetch ordinal 1.

| Diagnostic case | HTTP | Playlist items | Response bytes | Fetch ordinal | Replay complete | Result |
| --- | --- | --- | --- | --- | --- | --- |
| Registered first application normal (`warm-normal`) | 200 | 2 | 464 | 2 | 1 | PASS |
| Steady limit (`warm-limit`) | 200 | 499 | 37,531 | 4 | 1 | PASS |
| Steady invalid, raw 501 (`warm-invalid`) | 200 | 0 | 299 | 6 | 1 | PASS |
| Unspecified mode after enforce | 200 | 3 | 535 | 8 | 1 | PASS |
| Final manifest HEAD ETag changed | 200 | 0 | 299 | 10 | 1 | PASS |
| Final manifest HEAD missing | 200 | 0 | 299 | 12 | 1 | PASS |
| Fresh worker first normal | 200 | 2 | 464 | 1 | 1 | PASS |
| Fresh worker first limit, warmed Node recording | 500 | unavailable | 21 | 1 | 0 | **FAIL** |
| Fresh worker first invalid, warmed Node recording | 500 | unavailable | 21 | 1 | 0 | **FAIL** |

Successful enforced replays preserve signed-in/non-degraded responses, D1 execution count 3 and the returned-row vector `[1,1,1]`; their strict transcripts contain four R2 GETs and one R2 HEAD. The unspecified-mode probe contains no HEAD and restores the three unfiltered items, confirming the preceding enforce override did not leak. The two fresh-worker failures report D1 count 0 and no usable playlist body; their recorded R2 operations are not evidence of successful replay. These are synthetic recorded-service operations and functional fidelity outcomes, with **no CPU profiling, actual R2 service measurement or official-tail evidence**.

An earlier ETag-race attempt reused the first-application normal transcript on an already-warm worker. Its strict replay failed and the handler degraded to `authUnavailable`; that attempt remains invalid and is not included among the seven passing final cases. The final changed/missing-HEAD cases used a newly recorded steady-warm normal transcript. Native clock entries were not deleted, filtered, fabricated or reordered to obtain those passes.

The remaining cold-context blocker is concrete: `apps/api/src/routes/live/operationMode.ts` stores module-level `isolateMode`; first initialization records three `Date.now()` inputs across the request, while this steady-warm path records two. `resolvePublicOperationMode()`/`remember()` therefore follow different input-operation sequences in a persistent Node recorder and a fresh worker. A new `createInprocTarget()` in the same Node process does not refresh imported application-module caches. Independent review identified this initialization mismatch as pre-existing at owner head `c205522351b72a67359bc8a246b78f1891dcaba9`; the operation-mode source blob is unchanged. Strict transcript rejection is retained.

The bounded HEAD/mode/playlist source unit is complete and independently approved at prior final head `6dfa0d219857f89a53a70ffc63c54179202772f7`; this documentation amendment still requires final-head review/CI. The next #456 unit must align cold recorder application initialization with the measured fresh worker and prove matching first-request operation order, while keeping native invocation, exact identity and prior failure evidence. Do not edit/filter clock entries, relax identity, treat a new same-process DB target as a fresh app isolate, or convert the two failed cold cases into PASS. All full-run/cold, quiet BASELINE, CPU, D-12/T17, Auth.js, #705 and official-tail gates remain open. No whole-PR merge acceptance follows from this diagnostic.


## 2026-11-28 — fresh-module cold replay recording

Cold replay now creates one fresh Node worker-thread module graph for each cold recording, matching the fresh workerd process's application initialization rather than reusing the parent process's warmed Hono imports. The worker runs the same synthetic seed, selected scenario R2 objects and per-request D1 setup before capturing the first application request. It returns the strict ordered transcript to the measured worker; native `crypto.randomUUID()` and `Date.now()` are still invoked and recorded during application dispatch.

The transport preserves scalar/string, `URLSearchParams`, `Blob`/`File`, `FormData` entries, and byte bodies. Unsupported streaming request bodies fail closed. No input entries are deleted, reordered, synthesized, or excluded from identity. The recorder worker and Node recording remain outside the workerd CPU profile; the measured workerd still has its own fresh process and must attest first-fetch ordinal 1.

This is a harness correction for the retained 7 PASS / 2 FAIL combined playlist diagnostic: the two fresh-worker first limit/invalid failures are not retroactively changed to PASS. The new exact-head tests/CI and a rerun of the fixed combined Hono/workerd diagnostic are required before those cases can be closed. No CPU profiling, quiet-host BASELINE, official Worker/tail cpuTime, or production operation is claimed.
