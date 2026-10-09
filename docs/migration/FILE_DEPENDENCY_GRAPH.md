# FlameNode source → provider → consumer dependency order

> Status: Active / migration sequencing and connection matrix
> Authoritative file state: [FILE_MIGRATION_MATRIX.md](FILE_MIGRATION_MATRIX.md)
> Correct sequence & checkpoints: [FILE_PROGRESS_PROTOCOL.md](FILE_PROGRESS_PROTOCOL.md)
> Parent tasks/dependencies: [STATUS.md](STATUS.md)
> Actual source and current behavior always override tentative paths.

## Canonical directional graph

~~~text
CURRENT Next source & feature inventory
        |  characterization tests; route UX/FN/RH/SA evidence
        v
packages/contracts (Zod DTO/type contracts)  +  packages/db (MIG-0308)
        |                                       |
        +---------------+-----------------------+
                        v
              packages/domain (pure policies)
                        |
           application services / DB adapter
             [transaction + audit + Queue]
                        |
             +----------+-------------+
             |                        |
    Legacy Next adapters          Hono apps/api
    (compat, rollback)             |
             |                     +-------+-------------------+
             |                     |                           |
         CURRENT users       apps/app Personal             apps/ops Ops
                             dashboard/entry               manage/admin
                                   |
                              full navigation
                                   v
                             shared cookie/Auth
                                    
Public SSG: build snapshot/R2 ---> Astro apps/site ---> visibility gateway ---> HTML asset/R2 prebuilt
                                                                            [only measured SSR exception]
Cloudflare path-specific Routes (D-02): phased cutover, /api/auth/* stays legacy until Phase 8
~~~

**Cycles forbidden:** packages/db MUST NOT import packages/domain or src/**; domain MUST NOT import Next/Hono/Astro or legacy src/**; apps/api Hono may depend on domain/db/contracts, never on apps/app/ops/site; packages/ui MUST NOT depend on Next routing or a single module-global mutable navigation adapter shared between applications.

## Executable order and acceptance

| Provider-first unit | Reads from | Adds/changes | Explicit connections to test | Acceptance gate |
| --- | --- | --- | --- | --- |
| MIG-0301 | src/lib/slots/slotReservationLimit.ts | packages/domain/src/slots/reservationLimit.ts, old source re-export | legacy slotReservationLimitGuard and Next callers continue importing identical 3 symbols | Node ESM/TS/Next, unchanged normalized message and slot guard tests |
| MIG-0308 | src/lib/db/schema.ts + schema.base.ts + schema.canonical.ts | packages/db/src/schema/{base,canonical,index}.ts, schema.ts bridge | drizzle.config.ts, schema checker, old Next, new domain/Hono | zero generated DDL and immutable applied SQL; Next/Workers builds |
| MIG-0303..0306 | src/lib/actions/* + ownership/transaction helpers | packages/domain policy and application DB adapters | legacy Server Actions, Hono HTTP route/DTO, audit + Queue effects | all affected SA/FN/UX IDs parity, owner/role transaction and retry tests |
| MIG-0401/0404 | static projection snapshots and current public loader | apps/site build loader and route manifest | canonical/alias routes, no hidden/private files generated | Static build reproducible, snapshot generation/version hash |
| MIG-0405/0406 | public visibility fences and generated HTML | thin visibility gateway, SSG/R2 pre-generated fallback | Cloudflare Route+Custom Domain fallback, no private leak, no on-request heavy SSR | nonprod Route PoC, CPU p99/1102, file count and R2 failure tests |
| MIG-0501..0507 | all page.tsx Public 16 route contracts | Astro page files and React Islands | current route class, query/hash, OG, player/live overlay Hono endpoints | per-route UX/FN and browser parity, visibility, static media assets |
| MIG-0601..0605 | app/api/**/route.ts 28 files / 33 methods and 110 SA | apps/api Hono routers | exact RH method+route+status/headers/DTO; same origin session/Auth | 31 non-Auth methods Gate, RH-010/011 intentionally Phase8 |
| MIG-0701..0703 | Dashboard/Entry page.tsx + Server Actions | apps/app Personal | /dashboard, /entry, /onboarding, /_personal_assets; Hono no-store/private DTO | deep URL and permission + full current UI feature parity |
| MIG-0704..0705 | Manage/Admin 57 page contracts | apps/ops new app (Ops) | /manage, /admin, /_ops_assets; admin/owner guards + cross-SPA navigation | independent Vite bundle, authz denied, no Ops chunks in Personal |
| MIG-0801..0805 | legacy /api/auth/[...nextauth], Auth.js D1 session | @auth/core compatible Hono route and adapter | old cookie in Hono and new cookie in Next, callback/logout/CSRF | nonprod OAuth/cookie/DB/session test; production cutover separate approval |
| MIG-0901..0906 | all legacy imports/Route/Worker metrics | remove old Next adapters only when proven unused | no orphan import/route/function/Queue/binding; ability to rollback | observed traffic=0, stable operation, formal phase acceptance |

## Integration tests that join more than one file

1. **Imports:** changed file A exports actual function used by B; B's build under Node/TS/Next/Vite/Astro/Worker has resolved runtime import. Record A#export and B#import in PR.
2. **API:** any UI/RH migration shows source URL+HTTP method+request parser/DTO/error+cache and maps it to an actual Hono route, shared Zod schema and backend service. RH-010/011 are excluded before Auth PoC.
3. **DB and side-effects:** D1 schema relocation is NOT DDL deployment. On mutation, transaction, strict audit, static queue wake, retry and notification remain observable and atomic.
4. **Visibility:** R2/SSG prebuilt HTML must pass current visibility manifest/fence even when cached after private/voided; missing manifest fails closed.
5. **Identity:** Auth User logs in; X account ownership is separate. Historic like/bookmark fan-out to every approved owned X; current like commands affect the selected Active X.
6. **Two SPAs:** two distinct Workers/chunks/assets; same hostname and cookie; cross-app links navigate fully; Hono verifies admin/owner, not merely React route guards.
7. **Cutover:** code merge, live traffic switch, Remote D1 migration, and old-worker retirement are FOUR separate approvals/progress claims. None implies the next.

## File-change workflow rule

When editing a file in one stage but it is shared by downstream stage(s), the owning MIG PR must declare the downstream import/consumer tests to run (or the pending stage/owner and reason). Do not independently mark the downstream route done. Dependency rows can share the same real module but **one GitHub PR writer owns the edit**. Other agents act as reviewers until the file owner releases it.

### Avoid the following incorrect shortcuts

- Moving a Drizzle schema while leaving duplicate independent sqliteTable constructors in both packages.
- Migrating the RH-010/011 Auth.js wildcard during generic /api/* route rollout.
- Mixing Personal and Ops UI bundles because they share React Router.
- Treating a 200-line manifest or green CI as complete implementation.
- On SSG file quota overflow, turning every page into Free CPU-limited SSR without load tests.
- Removing CURRENT source before its consumer imports and URL/side-effects are mapped and protected.

All concrete source file ownership/progress rows are in FILE_MIGRATION_MATRIX.md, not duplicated here.