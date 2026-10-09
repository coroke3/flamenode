# Performance-first Migration Work Order (1102 / CPU / visibility)

> Status: TARGET work order, **not implemented**. Task state authority: [STATUS.md](STATUS.md). Baseline: [cloudflare/PERFORMANCE_BASELINE.md](cloudflare/PERFORMANCE_BASELINE.md). Route-level evidence: [PERF_HOTPATH_MATRIX.md](PERF_HOTPATH_MATRIX.md). Visual input: [UI_REFERENCE.md](UI_REFERENCE.md) (`PENDING_HTML`).
> Authoritative precedence: CURRENT code/test and Cloudflare outcomes → STATUS dependencies → TASK_CARDS_4_5 acceptance → this performance supplement. Do not create a second independent status ledger.

## Objective, scope and independent tracks

Remove the dominant **request-time** Next/OpenNext SSR/RSC cost without relocating it into a gateway, Hono adapter, R2 JSON parser or Queue. Keep URL, auth, privacy, audit, notification and UX/FN/SA/RH equivalence intact.

| Track | Task order (existing MIG IDs) | Blocking rule |
| --- | --- | --- |
| Performance preflight | MIG-0401 → MIG-0404 → MIG-0405 → MIG-0406 | MIG-0105 DONE unlocks 0401. Existing fixture/snapshot and placeholder HTML are permitted **only for isolated nonproduction performance tests**. No D-08 HTML needed. |
| Visual, frontend parity | MIG-0200..0206 → MIG-0402 → MIG-0403 | D-08 approved HTML and test evidence mandatory. 0403 also depends on 0404; no fabricated designs. |
| Production-ready Phase 4 | MIG-0407 after **both 0403 and 0406** | Independent review + human Gate; neither track alone authorizes cutover. |
| Public pages | MIG-0501..0508 | Preserve actual STATUS task dependencies; select high-load routes early once prereqs pass. |
| Domain, Hono, SPA | MIG-0301..0308, MIG-0601..0607, MIG-0701..0706 | Can advance on their own dependencies; a Hono switch does not prove CPU improvement. |

### Task-level performance deliverables

- **MIG-0401:** pure build-time snapshot loader / fixture; count reads/bytes/JSON parse, capture generation/version and fail-closed invalid/private fixture. Produce `apps/site/src/lib/publicDataLoader.ts`; no live D1 or production cutover, no visual work.
- **MIG-0404:** build-time canonical+alias route manifest. Analyze all CURRENT public routes and root slug conflicts, including `/api/auth/*`, `/_next/*`, `/_astro/*`, `/user/*`, query twins. Resolve into bounded lookup data; measure manifest size, lookup p99 and collision safety.
- **MIG-0405:** thin visibility/HTML selection PoC against representative static and prebuilt-R2 objects. Per-request logic only allow/deny, bounded lookup, response streaming; no heavy D1, SSR, cross-entity fan-out, large JSON transform or sync rebuild. Stale private→public and public→private must fail closed even with a cached old HTML. Nonproduction ingress root/www/Custom-Domain priority must pass before any real Route update.
- **MIG-0406:** count actual emitted Static Asset files (HTML/JS/CSS/fonts/redirect/manifest), budget against **Free 20,000 files per version**, measure build time, R2 prebuilt HTML, CPU p50/p95/p99, error outcomes, R2/Queue costs, image/proxy load and cold-cache paths. No silent dynamic SSR fallback; missed object is safe 404/503 + idempotent enqueue.
- **MIG-0407:** combine CPU/visibility evidence **and** real approved HTML + representative 3-screen visual/URL/UX tests, separate independent reviewer and Gate decision.

## Runtime rules

1. Deliver a static asset directly when authorization/visibility invariants permit; request-time Worker CPU is **effectively zero** for the HTML generation part, not a claim the entire request costs literally zero CPU.
2. Gatekeeper budget (nonproduction acceptance target): **CPU p50 < 1.5 ms, p95 < 3 ms, p99 < 5 ms**, no `exceededCpu` across representative normal and adverse samples. Profile *max*, cold isolates, cache misses, corrupt R2, visibility revocation, unknown aliases and concurrency. A percentile alone never establishes absence of >10ms spikes.
3. Stable HTML is prebuilt to Astro Static Assets or R2. Do not parse/generate it in the gateway. Keep manifest bounded, versioned and invalidated by visibility fences; never allow stale/unknown private resources.
4. Media: audit `app/api/google-drive-image/[id]/route.ts` and `app/api/youtube-thumbnail/[id]/[size]/route.ts`; safely static/R2/CDN-cache eligible assets only. Preserve origin/ID allowlists, type/size limits, and revocation rules. **OPT-016** in [BACKEND_OPTIMIZATION.md](BACKEND_OPTIMIZATION.md); implementation PR separately scoped, not a silent part of MIG-0401.
5. Background: audit `workers/json-generator/queue.ts` and `rebuild.ts` for 25 rebuild target families, overlapping enqueues, per-message budget, DLQ, idempotency, failure recovery and bounded fan-out. Do not merge scheduled/queue CPU onto the web request. Record `OPT-008/015` and independent task/micro-unit claim before changing production jobs.
6. Dynamic API: separate CPU time, wall time, D1 rows_read, R2 GET, JSON parse/serialization, authorization and caching. D1 waiting time is **not** CPU time; D1 result processing is. Hono alone is not an optimization metric.

## Measurement protocol and nonproduction Gate

- Use Workers Observability invocation outcomes **`exceededCpu`, `exceededMemory`, `canceled`, `ok` separately**, grouped by script, normalized route family, version, event (`fetch`/`queue`/`scheduled`), cache hit/miss, and time window. Never log private IDs, email, tokens, URLs with secrets or full user request payloads. Sampling/ABR factor and unknown classifications must be recorded.
- Compare baseline **2026-10-08 22:00 to 2026-10-09 22:00 JST** recorded in [cloudflare/PERFORMANCE_BASELINE.md](cloudflare/PERFORMANCE_BASELINE.md) with a comparable 7-day production window **after individually approved cutover**; compare both counts and *exceededCpu / invocation rate* by route and overall. Do not equate `canceled` or 503 with 1102. Do not merge old/new Worker metrics without marking boundary.
- **Target, not guarantee:** web CPU-limit failure reduction ≥90% versus like-for-like baseline, and zero `exceededCpu` in targeted nonproduction samples. If denominators, version or route classification differ, label the comparison **INCONCLUSIVE**, not PASS.
- Before promoting any path, verify URL+query, redirects, 404/403, OAuth exclusions, cookies, Active-X viewer overlay, SEO/OGP, private/public fences, R2 fail/rebuild and a rehearsed path-scoped rollback. Never roll back new writes by only changing a router.
- Production DNS/Custom Domain/Worker Routes/Remote D1/Secrets/deploy mutations still require specific user approval. Even GREEN CI, mock-independent PoC and PASS performance are **not** approval.
- All run evidence is attached to original MIG/card and affected file rows; do not invent numeric results or change rows beyond observed work.

## Release priority (after Phase 4 Gate, not before)

(1) `/about` and `/rules` for safety; (2) `/user/*` including aliases/portfolio; (3) `/list`, `/recommend`, `/trending`; (4) `/event/*` and `/`; (5) root `/:id` **last** because root slug conflict and visibility. Group redirects remain URL-compatible; high load does not override route-security or task dependencies. Image proxy and Queue optimization tracks can be scoped and tested separately from this sequence.

## Stop / fallback

CPU/Gateway p99 threshold fails, a single privacy leak, missing visibility manifest, unknown alias resolution, excessive asset count, Queue fan-out/regeneration loop, stale auth or missing historical route → **BLOCKED**, freeze rollout, capture sanitized repro, retain old Next path, create a narrowly scoped corrective PR. No auto-toggle to high-CPU SSR.
