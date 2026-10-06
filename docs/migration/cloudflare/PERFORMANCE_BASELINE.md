# FlameNode Cloudflare CPU / 1102 / Request Baseline

> Status: CURRENT_MEASURED
> Measured: 2026-10-07
> Primary window: 2026-09-30 23:00 UTC - 2026-10-06 23:30 UTC
> Platform boundary: [`TOPOLOGY.md`](TOPOLOGY.md)
> Evidence: Workers Observability invocation logs + CURRENT code/tests + Cloudflare Worker settings
> Production mutation: none

MIG-0006で、4 CURRENT WorkersのCPU/resource failureと代表request pathを実環境からread-only計測した。ここでの数値はmigrationの比較baselineであり、将来のSLO達成値ではない。

## Measurement semantics

Workers Observability Query Builderの計算結果はAdaptive Bit Rate samplingを使用した。今回の集計は主に `abr_level=10`、`sampleInterval ~= 10` であり、countはsampling-weighted estimateである。

したがって:

- この文書の「約N件」はexact incident countではない。
- p50/p95/p99/maxはproduction telemetryから得た実測分布だが、sampling/rollover semanticsを含む。
- exact billing/request countとして使わない。
- resource failureの存在確認はaggregateだけでなくindividual invocation eventでも行った。
- console log行数ではなく、`$workers.cpuTimeMs exists` を条件にinvocation telemetryへ寄せて集計した。
- 7日windowには複数deployment versionが含まれる。CURRENT codeのrollback/performance baselineとして扱い、単一versionのbenchmarkとはみなさない。

Workers settingsでは4 Workerとも Observability / invocation logs / persistence が有効、head sampling rateは1だった。Account subscription endpointは現在のconnector権限では認証エラーになったため、account plan名は推測・記録しない。

## Resource-limit semantics observed

CloudflareのCURRENT invocation outcomeには以下が存在した。

- `ok`
- `exceededCpu`
- `canceled`
- `exceededMemory`

Error 1102の運用上の一次指標は `exceededCpu` / resource-limit invocation outcomeとする。

Individual production evidence:

| Worker | Event | Path / trigger | CPU | Wall | Result |
| --- | --- | --- | ---: | ---: | --- |
| web | fetch | public video detail | 10ms | 373ms | `exceededCpu`, HTTP 503 |
| web | fetch | `/user/<id>` | 10ms | 375ms | `exceededCpu`, HTTP 503 |
| content | queue | `flamenode-static-rebuild-wake` | 50ms | 1921ms | `exceededCpu` |
| web | fetch | public video detail, historical version | 10ms | 2,113,892ms | `exceededMemory`, HTTP 503 |
| web | fetch | `/user/<id>`, historical version | 8ms | 5,686,806ms | `exceededMemory`, HTTP 503 |
| web | fetch | public video detail, historical version | 10ms | 10,627,680ms | `exceededMemory`, HTTP 503 |

Web CPU failures therefore exist independently of D1 quota/error handling, and memory exhaustion is a distinct historical failure mode. The memory examples were concentrated in one historical Worker version; this baseline does not claim that the current version reproduces them.

The observed 10ms web failures are consistent with the existing incident runbook's Free-HTTP 10ms assumption, but account plan could not be independently read through the connector. Migration decisions must rely on the observed failure boundary rather than asserting an unverified plan name.

## Four-Worker invocation CPU baseline

Sampling-weighted estimate for the primary window:

| Worker / event | Est. invocations | CPU avg | CPU median | CPU p95 | CPU p99 | CPU max | Interpretation |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| web / fetch | ~28,860 | 167.8ms | 15ms | 872ms | 1249ms | 1747ms | dominant runtime risk; includes runtime rollover and resource-failure population |
| content / queue | ~1,040 | 37.9ms | 20ms | 107ms | 126ms | 148ms | background work is materially heavier than thin request budget |
| sync / scheduled | ~310 | 32.8ms | 31ms | 76ms | 83ms | 83ms | expected background work; keep off HTTP hot path |
| content / scheduled | ~130 | 33.8ms | 30ms | 71ms | 71ms | 71ms | background work |
| fast / scheduled | ~120 | 14.8ms | 13ms | 25ms | 25ms | 25ms | bounded but not thin-request class |
| content / fetch | ~10 | 1ms | 1ms | 1ms | 1ms | health/admin fetch surface is thin in sample |
| sync / fetch | ~10 | 1ms | 1ms | 1ms | 1ms | health/admin fetch surface is thin in sample |

High web p95/p99 values do not mean Cloudflare universally grants that CPU as a stable budget. Cloudflare runtime rollover and sampled distributions can record CPU above configured limits for successful invocations. The migration target therefore remains substantially below the observed resource-failure boundary.

## Invocation outcomes

Sampling-weighted estimate for the same window:

| Worker / event | Outcome | Est. invocations |
| --- | --- | ---: |
| web / fetch | `ok` | ~27,030 |
| web / fetch | `exceededCpu` | ~2,070 |
| web / fetch | `canceled` | ~570 |
| web / fetch | `exceededMemory` | ~280 |
| content / queue | `ok` | ~1,030 |
| content / queue | `exceededCpu` | ~10 |
| sync / scheduled | `ok` | ~310 |
| content / scheduled | `ok` | ~130 |
| fast / scheduled | `ok` | ~120 |

Because these are sampled estimates, do not report `2,070` as an exact incident count. The signal is nevertheless large enough to establish that `exceededCpu` is not an isolated one-off on the current architecture.

## Web hot paths

Top sampled path groups demonstrate that resource risk is distributed across SSR/RSC pages and external image proxy paths rather than one single D1 query.

| Path / family | Representative sampled signal | CURRENT code implication |
| --- | --- | --- |
| `/` | ~1,760 invocations; median 11ms; p95 1118ms | public homepage still activates OpenNext Worker/React rendering when not served as a direct static asset |
| `/list` | ~560; median 13ms; p95 698ms; largest observed exceededCpu path bucket (~170 estimate) | no-query ISR helps, but regeneration/query variants still need Worker CPU |
| `/user/*` | ~4,790 ok + ~640 exceededCpu + ~80 exceededMemory + ~270 canceled estimates; exceededCpu median 10ms | current ISR/paged split reduces work but public profile rendering remains a major failure family |
| root `/:id` video detail | repeated 10ms exceededCpu examples and historical memory failures | current public video detail SSR/RSC remains incompatible with a thin gateway budget |
| `/api/google-drive-image/*` | top exact-redacted path family; representative group ~1,880; median 8ms; p95 70ms; exceededCpu observed | external fetch + validation + proxy/buffering does not belong on future public HTML hot path |
| `/api/youtube-thumbnail/*` | sampled thumbnail paths show CPU tail and exceededCpu examples | Edge Cache/R2 proxy remains dynamic on misses; prefer direct/static delivery where safety contract allows |
| `/api/account/summary` | ~570; median 57ms; p95 563ms | private account hydration is not a thin public API and must be redesigned/measured separately |
| `/entry` | ~360; median 505ms; p95 1113ms | private Next SSR cost supports TARGET SPA direction |
| `/robots.txt` / scanner paths | measurable Worker CPU despite low product value | migrate known static/404 surfaces away from application rendering where routing semantics permit |

Counts above are not exact and dynamic IDs fragment group cardinality. They are used to rank migration attention, not to create product analytics.

## CURRENT mitigations already present

Code/tests already contain substantial 1102 mitigation and must not be accidentally removed before replacement:

- public GET pages use ISR rather than unconditional `force-dynamic`.
- dynamic public routes expose empty `generateStaticParams` for on-demand ISR.
- user public cards are bounded to 8 works + 8 collaborations per rendered page.
- recommend/event detail rails are bounded to 8 items.
- video detail initially SSRs 12 related items and does not read related-author icon maps.
- public user page avoids the X icon manifest and uses snapshot icons.
- home top shelf is capped at 8.
- query-bearing `/list`, `/user`, `/event`, and paged user routes split to dynamic twin routes so bare URLs can remain ISR.
- Static Assets use `run_worker_first = false`, so matching static assets bypass the web Worker.
- public R2 miss -> degraded D1 is bounded by a kill switch/circuit breaker and fail-closed visibility logic.
- external image proxies validate identifier/origin/type/size and bound object size.

These are CURRENT behavior/safety evidence, not an argument to keep Next/OpenNext SSR as the final architecture.

## Hot vs cold path classification

### Hot: remove or minimize request-time generation

- public home/list/user/video/event HTML generation
- `/entry`, dashboard/manage/admin React SSR
- public image proxy cache-miss buffering
- auth/account hydration called during first-render paths
- any public R2 artifact transform that reparses/rebuilds large JSON on every request

### Warm: keep dynamic but bounded

- viewer/private overlays
- explicit public DTO APIs
- live summaries/slots/submissions
- shallow health
- small visibility/alias lookup gateway
- authenticated mutations after domain extraction

### Cold/background

- static artifact generation
- notification delivery/recovery
- YouTube/GA4 sync
- bulk/admin imports
- repair/reconciliation
- expensive aggregation

Cold work may legitimately consume more CPU than the future HTTP budget; it must remain bounded, idempotent, queue-safe, and separately monitored.

## Representative migration budgets

These are TARGET budgets, not claims about current Cloudflare entitlement.

### API / private dynamic work

- simple reads: p95 < 5ms
- normal mutations: p95 < 8ms
- auth-heavy: p95 < 9ms
- `exceededCpu`: 0 in representative validation set

### Public visibility gateway PoC

- p50 < 1.5ms
- p95 < 3ms
- p99 < 5ms
- `exceededCpu`: 0
- no HTML generation
- no heavy D1 alias lookup
- blocked/unknown visibility remains fail-closed

### Static/public HTML

Request-time application CPU target is effectively zero when a direct static asset can satisfy the route. Dynamic behavior must be isolated to explicit APIs/Islands rather than waking SSR for stable HTML.

Budgets are intentionally below the observed web resource-failure examples. Do not relax them merely because successful CURRENT invocations sometimes report larger rollover CPU.

## Optimization conclusions

1. **TARGET public SSG + thin visibility gateway is evidence-backed.** Current public SSR/RSC families materially overlap with `exceededCpu`; moving stable HTML generation out of request time attacks the dominant failure class.
2. **Private React/Vite SPA remains justified.** `/entry` and authenticated hydration tails show no benefit from server-rendering React under the current Worker CPU constraint.
3. **Image delivery needs a split contract.** Security/type/size/cache guarantees must remain, but future pages should not require a Worker proxy hit for every stable thumbnail/icon. Direct/static/R2-backed URLs are preferred where provenance and revocation semantics permit.
4. **Do not merge background Workers into web for convenience.** Their scheduled/queue CPU is materially different and should not contaminate the HTTP request budget.
5. **Do not respond by only raising CPU limits.** The failure surface includes memory/cancellation and unnecessary SSR. Migration must first remove request-time work.
6. **Preserve CURRENT bounded safeguards until replacement parity exists.** Existing ISR limits, card caps, public visibility fencing, bounded degraded D1 and image safety checks are active controls.

Frontend behavior changes required to realize the architectural optimization: **0 at the product-contract level**. Rendering ownership changes, but required UX/URL/permission/visibility behavior must remain equivalent.

## Validation requirements for later phases

Every PoC/cutover affecting request execution must compare against this baseline using:

- the same four logical runtime roles or an explicitly approved replacement topology;
- invocation outcome distribution;
- CPU p50/p95/p99, not only average;
- representative hot and cold routes;
- 1102 / `exceededCpu` count = 0 in the validation sample;
- memory/canceled outcomes checked separately;
- public visibility and authz tests;
- no new unbounded D1/R2/JSON work.

A local benchmark alone is insufficient to claim production CPU success.

## Follow-up

- MIG-0007 inventories static artifacts/visibility guarantees that make Workerless-first public delivery safe.
- MIG-0009 inventories Queue/Cron semantics before any background-worker restructuring.
- Public PoC phases use this document as the CURRENT performance baseline.
