# FlameNode HTTP hot-path / 1102 optimization matrix

> Status: TARGET monitoring and implementation mapping; **not evidence of migrated or fixed routes**. CURRENT source: [cloudflare/PERFORMANCE_BASELINE.md](cloudflare/PERFORMANCE_BASELINE.md). Order/Gates: [PERFORMANCE_IMPLEMENTATION_PLAN.md](PERFORMANCE_IMPLEMENTATION_PLAN.md). Task progress: [STATUS.md](STATUS.md) and file status: [FILE_MIGRATION_MATRIX.md](FILE_MIGRATION_MATRIX.md).
>
> Measurements below use the older 2026-09-30T23:00Z–2026-10-06T23:30Z sampling-weighted Cloudflare baseline unless labeled otherwise. The 24h 2026-10-09 sample is an **overall Worker** measure, not attribution to individual routes. Never invent per-route post-migration CPU values.

| Priority | Route/job family | CURRENT code / primary cost | Baseline indicator (approximate) | TARGET serving / provider → consumer | Owner and verification |
| --- | --- | --- | --- | --- | --- |
| P0 | `/user/*`, alias/profile | `app/(public)/user/**`, OpenNext SSR/ISR + `src/lib/publicData/loader.ts` | ~640 `exceededCpu` sampled-weighted, plus memory/cancel | build snapshot → Astro static/R2 HTML → thin visibility/alias gateway; pagination query supported | MIG-0401/0404/0405/0406 → MIG-0504; CPU, privacy/redirect |
| P0 | `/list`, search/query | `app/(public)/list/**`, SSR/RSC, query twin | ~170 `exceededCpu` sampled-weighted | prebuilt list/search projection → Astro + bounded client/API queries | 0401/0406 → MIG-0505; filter/query/deep links |
| P0 | root video `/:id` | `app/(public)/[id]/page.tsx`, video detail + related projection | repeated 10ms CPU-exceeded examples; historical memory exceptions | canonical slug manifest → visibility gate → prebuilt video HTML, overlay as Island | 0404/0405/0406 → MIG-0507; unknown root paths/alias/deny-first |
| P0 | `/`, top | `app/(public)/page.tsx`, OpenNext render | median 11ms, p95 1118ms | prebuilt top HTML; dynamic controls/overlay isolated | 0401/0406 → MIG-0506; no request-time rebuild |
| P1 | `/event/*` | `app/(public)/event/**`, slots/release status | measured SSR contribution; no reliable single exceed count | prebuilt event/slots content + bounded live overlay | 0401/0405/0406 → MIG-0502; event lifecycle/visibility |
| P1 | Google Drive / YouTube image proxies | `app/api/google-drive-image/[id]/route.ts`, `app/api/youtube-thumbnail/[id]/[size]/route.ts` | Drive group median 8ms / p95 70ms; exceededCpu cases | validated source → cache/R2/direct stable asset where ACL/revocation permits | OPT-016; coordinate MIG-0605/RH-023..025; verify mime/size/security |
| P1 | `/entry`, Dashboard | `app/(auth)/**` and `src/lib/auth/headerUser.ts`, Next authenticated rendering | entry median 505ms / p95 1113ms | Personal Vite SPA shell + bounded Hono session DTO | MIG-0701..0703, MIG-0601..0605; role/no-store/401 |
| P1 | `/api/account/summary` | `app/api/account/summary/route.ts`, auth-linked hydration | median 57ms / p95 563ms | explicit small DTO/one authorization boundary/cache policy | RH-001; MIG-0605, MIG-0701; CPU/DB rows |
| P1 | static rebuild Queue | `workers/json-generator/queue.ts`, `rebuild.ts` | queue p95 107ms, exceededCpu observed | bounded enqueue/dedupe/chunked rebuild; **not** web SSR fallback | OPT-008/015; MIG-0406 validates, later owner PR changes jobs |
| P2 | `/about`, `/rules`, robots | fixed pages and web Worker | CPU is avoidable; route count not established | Astro direct/static assets | MIG-0501; first cutover safety canary |

## Evidence required to mark a row complete

Record **route family; old/new Worker; code/source file#export; static HTML/R2 key/DTO; route-map and privacy fence; cache hit/miss; CPU p50/p95/p99/max; outcome counts; sample interval; test URL/log or CI; version; rollback**. Do not mark done solely because a file exists or a build is green. `exceededCpu`, `exceededMemory` and `canceled` are distinct. CPU p95/p99 must be compared in matched windows, preferably ≥7 days per stage.

This matrix is an **index**, not a second progress or feature ledger; authoritative task states stay in STATUS, one-file states in FILE_MIGRATION_MATRIX, and existing UX/FN/SA/RH behavior in their corresponding canonical ledgers.
