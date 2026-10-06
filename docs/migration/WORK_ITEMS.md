# Migration Work Items

Statuses: `todo` / `ready` / `in_progress` / `blocked` / `verify` / `done` / `obsolete`.

The first `ready` item whose dependencies are `done` is the default next cycle. Do not work on two migration items in one cycle unless the second is only documentation/evidence required to finish the first.

| ID | Phase | Work | Depends | Status | Done when |
| --- | --- | --- | --- | --- | --- |
| MIG-000 | M0 | cross-agent migration harness + progress ledger | — | done | Claude/Antigravity/Codex entrypoints all point to the same state docs |
| INV-001 | M0 | current feature inventory: public/static/visibility first, then all domains | MIG-000 | ready | every inventory row has code/test source + parity requirement; unknowns are explicit |
| INV-002 | M0 | API / Server Action / Route Handler inventory | INV-001 | todo | each mutation/read path has auth, side effect, caller, future Domain/API mapping |
| INV-003 | M0 | auth/permission/account-linking inventory | INV-002 | todo | session, role, banned, active X, origin, ownership/permission contracts documented |
| INV-004 | M0 | Worker/Queue/Cron/R2/D1/KV inventory | INV-001 | todo | current worker/job topology and binding ownership are explicit |
| INV-005 | M0 | UI state parity inventory for 86 screens | INV-001 | todo | happy/loading/empty/error/forbidden/mobile/actions recorded or linked for all screens |
| DOC-001 | M0 | Active Markdown dedupe/staleness audit | INV-001 | todo | Active docs mapped to one source of truth per topic; duplicate target specs removed or linked |
| ARCH-001 | M1 | add monorepo boundaries without moving legacy Next | INV-002,INV-003,INV-004,DOC-001 | todo | `apps/`/`packages/` boundaries exist; current production still builds |
| DOM-001 | M1 | extract first framework-neutral Domain Service | ARCH-001 | todo | legacy Next caller uses extracted service; contract tests unchanged |
| UI-001 | M1 | production-ready shared design tokens/components from redesign mock | INV-005,ARCH-001 | todo | shared UI has visual/interaction acceptance at 1440/1024/768/390 |
| PUB-001 | M2 | Astro site skeleton + selected `/about`, `/rules` PoC | ARCH-001,UI-001 | todo | SSG output, SEO and static asset deploy verified in shadow environment |
| PUB-002 | M2 | `flamenode-public-build` projection/bucket contract | INV-004,PUB-001 | todo | Astro build reads only safe public build data; no direct D1 build query |
| PUB-003 | M2 | generated route guard map | PUB-002 | todo | aliases/canonical ids map deterministically; malformed/unknown paths are safe |
| BUILD-001 | M2 | build generation/coalescing state | PUB-002 | todo | no lost update across desired/building/deployed generations; retry behavior tested |
| GATE-001 | M3 | visibility gateway shadow PoC | PUB-003 | todo | old static HTML cannot bypass fence; enforce failure is fail-closed |
| GATE-002 | M3 | gateway production-like CPU/1102 measurement | GATE-001 | todo | p50<1.5ms p95<3ms p99<5ms, 1102=0 or redesign before cutover |
| ROUTE-001 | M4 | strangler routes for safe static prefixes | GATE-002 | todo | rollback to `flamenode-web` proven; smoke green |
| ROUTE-002 | M4 | remaining public prefixes except root video | ROUTE-001 | todo | public parity + visibility gates green |
| API-001 | M5 | Hono API baseline sharing Domain Services | DOM-001 | todo | selected endpoint parity contract green |
| AUTH-001 | M5 | Auth.js/Hono session compatibility PoC | INV-003,API-001 | todo | account/session/linking/origin/role/banned/active-X contracts green |
| SPA-001 | M6 | Dashboard SPA | AUTH-001,UI-001 | todo | Personal dashboard routes parity green |
| SPA-002 | M6 | Entry SPA | SPA-001 | todo | entry routes parity green |
| SPA-003 | M6 | Manage SPA | SPA-002 | todo | 12 manage screens parity green |
| SPA-004 | M6 | Admin SPA | SPA-003 | todo | 45 admin screens parity green |
| ROUTE-003 | M7 | public root video catch-all migration | ROUTE-002,AUTH-001 | todo | internal/YouTube aliases, SEO, interactions, visibility parity green |
| CUT-001 | M7 | Custom Domain final switch | ROUTE-003,SPA-004 | todo | all route/API/auth/visibility/smoke + rollback checklist green; explicit approval obtained |
| CLEAN-001 | M8 | remove Next/OpenNext dependencies and legacy code | CUT-001 | todo | production observation window complete; no active route/import/test depends on legacy |

## Rules for adding work items

- Prefer a new atomic work item over silently expanding an existing one.
- DB/security/auth/public API/visibility/cutover work must have explicit tests in `Done when`.
- A work item may be marked `done` only with concrete evidence in `PROGRESS.md` or linked PR/commit/test output.
- Findings that do not block the active item become a new row, not hidden scope creep.
