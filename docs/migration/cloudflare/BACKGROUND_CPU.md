# MIG-0609: Background Worker CPU — LOCAL only

> Status: **U01 implementation / unmeasured; NOT a performance verdict**  
> Main/source: three CURRENT background workers, no code or production deployment change.  
> Preparation: `node scripts/benchmark-background-cpu.mjs --dry-run`  
> Actual measurements: `node scripts/benchmark-background-cpu.mjs --run --out /tmp/flamenode-background-cpu-local.json`.

## Safety and measurement semantics

No Cloudflare account/remote D1/R2, secrets or outbound HTTP traffic is allowed. Wrangler runs with `--local --ip 127.0.0.1` and a temporary local D1 database created from migration copies. The wrapper installs a global `fetch` fail-closed trap **before** importing CURRENT Worker modules, so YouTube/Discord/GA4 calls cannot reach their endpoints. A wrapper that encounters external requests returns `502`; scenario results with unexpected HTTP statuses are **not valid measurements**. The V8 inspector's non-idle sampling time is a LOCAL CPU proxy. Event-loop wall time and Wrangler local `cpuTimeMs=0` spans are **not** used as CPU.

## U01 plan (implemented, not yet measured)

| Worker | CURRENT cron | Queue consumer | Limit |
| --- | --- | --- | --- |
| `content-jobs` | `15 * * * *` | `flamenode-static-rebuild-wake` | queue batch 10 |
| `fast-jobs` | `0 * * * *` | `flamenode-notification-wake` | queue batch 10 |
| `sync-jobs` | `7,52 * * * *` | `flamenode-youtube-sync-wake` | queue batch 10 |

U01 records six generic trigger probes for the three Workers. They are **not** a replacement for the named per-job scenarios in U02, and must not be presented as a completed budget or throughput measurement.

## U02 per-job measurement ledger (pending)

The required job cases are: incremental cache cleanup (200), audit cleanup (500), X slot bind recovery (5 requests / 30 slots), notification lease/retry (6, external calls 12), slot deadline reminders (50), YouTube sync (4 API calls / 50 items), blocked YouTube recheck (10), score recalc (150), playlist sync (1 event / 5,000 items / 12 requests), GA4 ranking (200), daily nostalgic top (fixed seed/date + SHA-256 hash), static rebuild processing (CURRENT cap), and each queue consumer (10). Each must be seeded with a normal (1 item), limit (full cap), invalid and cold case, **at least 50 samples each**. External API responses must remain synthetic and bounded. The static rebuild job target is retired only by MIG-0907.

| Job | normal n | limit n | invalid n | cold n | p50 (ms) | p95 (ms) | max (ms) | baseline max (ms) | verdict | local cap |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | ---: |
| All named jobs above | — | — | — | — | — | — | — | — | **NOT MEASURED** | — |

Do **not** infer a pass from an empty fixture or an error response. A sample with `unexpected = true` invalidates that run's performance verdict.

## Budget and reproducibility

Budget = **max CPU < 8 ms** (not p95), with the benchmark API's `judge(maxMs, 8, {kind:'lt', resolutionMs, noiseMs})`. On a valid per-item run, the tentative cap is `floor(7ms / per-item max CPU ms)`. Document noise and CPU sampler resolution. If baseline max is >= 4 ms and measured job max is 4–12 ms, report **INCONCLUSIVE** and do not approve cutover. Record OS/CPU/Node/Wrangler versions and sample counts, never label these as production numbers.

## Rollback

Revert PR #455; no Worker or Cloudflare configuration has been touched. Continue U02/U03 in the same PR until the real measurements are recorded and reviewed.
