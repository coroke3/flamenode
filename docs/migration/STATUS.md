# FlameNode Migration Status

> Status: Active / progress source of truth
> Last updated: 2026-10-07
> Architecture: [`README.md`](README.md)
> Execution: [`AGENT_PROTOCOL.md`](AGENT_PROTOCOL.md)
> Git: [`GIT_WORKFLOW.md`](GIT_WORKFLOW.md)
> Frontend parity: [`FRONTEND_FEATURES.md`](FRONTEND_FEATURES.md)
> Function parity: [`FUNCTION_INVENTORY.md`](FUNCTION_INVENTORY.md)

Claude / Codex / Antigravityを含む全agentが共有する唯一の進捗正本。chat historyやtool-local task listを正本にしない。

## Overall

```text
Current Phase: 0 — Baseline / Inventory
Current Task: MIG-0007
Current Owner: chatgpt
Task State: IN_PROGRESS
Overall State: IN_PROGRESS
Production Cutover: NOT STARTED
Last Completed Task: MIG-0006
Last Task PR: #242
Next: MIG-0007
```

## State definitions

- `READY`: dependencies解消済み、writer未claim
- `IN_PROGRESS`: 1 agentがwriterとしてclaim中
- `REVIEW`: implementation/audit済み、独立review/検証待ち
- `BLOCKED`: dependency/approval/evidence不足
- `DONE`: acceptance + validation + progress更新済み
- `SKIPPED`: 理由付きで不要

## Loop / handoff rules

- 1 iteration = exactly 1 MIG task
- 原則 1 task = 1 short-lived branch = 1 PR = 1 squash merge
- `READY → IN_PROGRESS → REVIEW → DONE` または `BLOCKED`
- `IN_PROGRESS`のままhandoffしない
- claim時にOwner/branch/PR/affected UX/FNを記録する
- finish時にvalidation/rollback/evidence/next stateを記録する
- Phase Gateをagentが自動承認しない
- production deploy / Worker Route / Custom Domain / Remote D1 / secret変更は明示承認まで停止
- Git詳細は `GIT_WORKFLOW.md`

---

# Inventory coverage

| Surface | Baseline enumerated | Detailed audited | Parity verified | Phase 0 target |
| --- | ---: | ---: | ---: | --- |
| CURRENT USER_SCREEN routes | 86 | 86 route/role/purpose baseline | 0 | all required UX/FN mapped |
| Frontend `UX-*` capabilities | 432 | baseline evidence states only | 0 | orphan/unverified/disposition漏れ 0 |
| CURRENT technical compatibility routes | 4 | purpose/query baseline | n/a | replacement evidence before removal |
| Backend/domain/platform `FN-*` | 136 | 2 CURRENT_VERIFIED | 0 | all required CURRENT contracts audited |
| Server Actions | 34 modules / 106 exports + 4 inline = 110 | 110 CURRENT_VERIFIED | 0 | all execution units disposed |
| Route Handler APIs | 28 route files / 33 methods | 33 CURRENT_VERIFIED | 0 | all `route.ts` methods disposed |
| CURRENT Worker scripts | 4 | 4 CURRENT_VERIFIED topology + CPU/request measured / job semantics pending | 0 | bindings/routes/jobs fixed |
| New UI visual source | HTML mock pending | n/a | n/a | registered in `UI_REFERENCE.md` before Phase 2 visual work |

Current FN state summary:

```text
CURRENT_VERIFIED: 2
DETAIL_AUDIT_REQUIRED: 134
PARITY_VERIFIED: 0
REMOVAL_PROPOSED: 0
REMOVED_APPROVED: 0
```

Initial UX baseline:

```text
frontend/CROSS_CUTTING.md        38
frontend/PUBLIC.md              123
frontend/AUTH_PERSONAL_ENTRY.md 104
frontend/MANAGE_ADMIN.md        167
------------------------------------
Total                           432
```

432は最終上限ではない。MIG-0003/0004/0007/0008/0009/0010でobservable behaviorが新たに見つかれば追加する。
MIG-0011完了までは「全機能棚卸し完了」と宣言しない。

Phase 0 Gateは、未監査必須機能・UX/FN mapping・backend disposition・requirement reconciliation・optimization blocker assessmentが残る限りCLOSED。

---

# Phase summary

| Phase | Name | State | Gate |
| --- | --- | --- | --- |
| 0 | Baseline / Inventory | IN_PROGRESS | CLOSED |
| 1 | Repository boundaries | BLOCKED | CLOSED |
| 2 | Design System / HTML mock integration | BLOCKED (`PENDING_HTML` + Phase 1) | CLOSED |
| 3 | Domain extraction | BLOCKED | CLOSED |
| 4 | Public PoC | BLOCKED | CLOSED |
| 5 | Public migration | BLOCKED | CLOSED |
| 6 | Hono API | BLOCKED | CLOSED |
| 7 | Private SPA | BLOCKED | CLOSED |
| 8 | Auth | BLOCKED | CLOSED |
| 9 | Next/OpenNext retirement | BLOCKED | CLOSED |

---

# Phase 0 — Baseline / Inventory

| ID | Task | State | Depends on | Acceptance |
| --- | --- | --- | --- | --- |
| MIG-0001 | migration docs / multi-agent command / progress framework | DONE | — | shared protocol/adapters/inventory/checker established |
| MIG-0002 | CURRENT route + frontend observable capability baseline | DONE | MIG-0001 | 86 screens, 432 UX baseline, UX/FN split, HTML-input rule, Antigravity/Git/quality contract |
| MIG-0003 | Server Action / inline action baseline | DONE | MIG-0001 | all exported/inline actions, callers, input, authz, effects, tests, affected UX/FN, optimization observations |
| MIG-0004 | Route Handler / API baseline | DONE | MIG-0001 | all `route.ts` methods, contract/auth/effects/tests, affected UX/FN, duplication observations |
| MIG-0005 | Cloudflare Worker/domain/route/binding baseline | DONE | MIG-0001 | 4 Workers, Custom Domain, Routes, bindings, build/deploy topology |
| MIG-0006 | CPU / 1102 / request baseline | DONE | MIG-0005 | real Cloudflare metrics, hot/cold paths, representative budgets |
| MIG-0007 | static artifact / visibility baseline | IN_PROGRESS | MIG-0001 | artifact types, aliases, fail-closed guarantees, repair/fallback, affected UX/FN |
| MIG-0008 | Auth/session/permission baseline | READY | MIG-0001 | login/session/linking/Active X/owner/permission contracts and gated UX |
| MIG-0009 | Queue/Cron/background job baseline | READY | MIG-0005 | job types, Queue/DLQ, retry/recovery/side effects, user-visible async states |
| MIG-0010 | 86 CURRENT screens + cross-route shells → UX/FN mapping | BLOCKED | MIG-0002, MIG-0003, MIG-0004 | every screen mapped, all UX states, responsive/a11y/query/deep-link requirements |
| MIG-0011 | inventory consolidation / gap scan / requirement + optimization assessment | BLOCKED | MIG-0003, MIG-0004, MIG-0007, MIG-0008, MIG-0009, MIG-0010 | unknown/orphan=0, design divergence disposed, duplicates resolved, blockers reported |
| MIG-0012 | Phase 0 Gate | BLOCKED | MIG-0006, MIG-0011 | independent review, rollback baseline, all Phase 0 invariants satisfied |

## Phase 0 Gate

- [x] CURRENT USER_SCREEN inventory fixed at 86
- [x] initial frontend UX baseline expanded to 432 granular capabilities
- [x] frontend `UX-*` and backend `FN-*` separated as many-to-many ledgers
- [x] CURRENT technical compatibility routes separated from user-visible features
- [x] global error/404/robots/sitemap/shell behaviors represented
- [x] old `docs/design-redesign` removed from migration sources
- [x] new visual source set to `UI_REFERENCE.md = PENDING_HTML`
- [x] existing design/product requirement reconciliation policy fixed
- [x] Claude / Codex / Antigravity shared protocol fixed
- [x] migration Git/branch/PR/squash workflow is mandatory
- [x] professional code-quality standard is mandatory
- [x] all Server Action exports + inline actions inventoried (110 execution units / unclassified 0)
- [x] all Route Handler methods inventoried (28 route files / 33 methods / unclassified 0)
- [ ] all required FN functions CURRENT_VERIFIED or explicitly dispositioned
- [ ] all 86 screens mapped to required UX/FN IDs
- [ ] all required UX capabilities have route/permission/backend/state dispositions
- [ ] all background jobs/Queues/Cron inventoried
- [x] current Cloudflare topology fixed
- [x] CPU/1102 baseline fixed
- [ ] visibility/static guarantees fully fixed
- [ ] auth/permission guarantees fully fixed
- [ ] `REQUIREMENT_ONLY` / `CURRENT_DIVERGENCE` affecting migration resolved
- [ ] backend optimization candidates intentionally validated/rejected
- [ ] every optimization blocker has concrete frontend-impact disposition
- [ ] production behavior unchanged by baseline work
- [ ] rollback target commit/config fixed

---

# Phases 1–9

Phase 1+ remains blocked until MIG-0012 unless a task is explicitly marked as safe preparatory work.

## Phase 1 — Repository boundaries

| ID | Task | State | Depends on |
| --- | --- | --- | --- |
| MIG-0101 | workspace/boundary PoC design | BLOCKED | MIG-0012 |
| MIG-0102 | `packages/ui` skeleton | BLOCKED | MIG-0101 |
| MIG-0103 | `packages/contracts` skeleton | BLOCKED | MIG-0101 |
| MIG-0104 | `packages/domain` skeleton | BLOCKED | MIG-0101 |
| MIG-0105 | `apps/site` Astro skeleton | BLOCKED | MIG-0101 |
| MIG-0106 | `apps/app` React/Vite skeleton | BLOCKED | MIG-0101 |
| MIG-0107 | `apps/api` Hono skeleton | BLOCKED | MIG-0101 |
| MIG-0108 | Phase 1 Gate | BLOCKED | MIG-0102..MIG-0107 |

## Phase 2 — Design System / HTML mock integration

| ID | Task | State | Depends on |
| --- | --- | --- | --- |
| MIG-0200 | register user-provided HTML mock in `UI_REFERENCE.md` | BLOCKED | user input |
| MIG-0201 | visual/IA extraction + design tokens | BLOCKED | MIG-0108, MIG-0200 |
| MIG-0202 | primitives | BLOCKED | MIG-0201 |
| MIG-0203 | navigation/layout | BLOCKED | MIG-0202 |
| MIG-0204 | forms/feedback/data-display | BLOCKED | MIG-0202 |
| MIG-0205 | representative responsive screens + UX mapping | BLOCKED | MIG-0203, MIG-0204 |
| MIG-0206 | Phase 2 Gate | BLOCKED | MIG-0205 |

## Phase 3 — Domain extraction

| ID | Task | State | Depends on |
| --- | --- | --- | --- |
| MIG-0301 | extraction/DI pattern | BLOCKED | MIG-0108 |
| MIG-0302 | low-risk read domain | BLOCKED | MIG-0301 |
| MIG-0303 | low-risk mutation domain | BLOCKED | MIG-0302 |
| MIG-0304 | video domain group | BLOCKED | MIG-0303 |
| MIG-0305 | event/slot domain group | BLOCKED | MIG-0303 |
| MIG-0306 | user/X/admin domain group | BLOCKED | MIG-0303 |
| MIG-0307 | Phase 3 Gate | BLOCKED | MIG-0304..MIG-0306 |

## Phase 4 — Public PoC

| ID | Task | State | Depends on |
| --- | --- | --- | --- |
| MIG-0401 | Astro build-input PoC | BLOCKED | MIG-0105 |
| MIG-0402 | shared React UI in Astro | BLOCKED | MIG-0206, MIG-0401 |
| MIG-0403 | representative video/user/event SSG | BLOCKED | MIG-0402 |
| MIG-0404 | route-map generator | BLOCKED | MIG-0403 |
| MIG-0405 | visibility gateway | BLOCKED | MIG-0404 |
| MIG-0406 | CPU/build benchmark | BLOCKED | MIG-0405 |
| MIG-0407 | Phase 4 Gate | BLOCKED | MIG-0406 |

## Phase 5 — Public migration

| ID | Task | State | Depends on |
| --- | --- | --- | --- |
| MIG-0501 | fixed/static routes | BLOCKED | MIG-0407 |
| MIG-0502 | event routes | BLOCKED | MIG-0501 |
| MIG-0503 | group routes | BLOCKED | MIG-0501 |
| MIG-0504 | user routes | BLOCKED | MIG-0501 |
| MIG-0505 | list/search/recommend/trending | BLOCKED | MIG-0501 |
| MIG-0506 | root/top | BLOCKED | MIG-0505 |
| MIG-0507 | `/:id` video catch-all | BLOCKED | MIG-0502..MIG-0506 |
| MIG-0508 | Phase 5 Gate | BLOCKED | MIG-0507 |

## Phase 6 — Hono API

| ID | Task | State | Depends on |
| --- | --- | --- | --- |
| MIG-0601 | low-risk reads | BLOCKED | MIG-0307, MIG-0107 |
| MIG-0602 | low-risk mutations | BLOCKED | MIG-0601 |
| MIG-0603 | video APIs | BLOCKED | MIG-0602 |
| MIG-0604 | event/slot APIs | BLOCKED | MIG-0602 |
| MIG-0605 | user/X/admin APIs | BLOCKED | MIG-0602 |
| MIG-0606 | API CPU benchmark | BLOCKED | MIG-0603..MIG-0605 |
| MIG-0607 | Phase 6 Gate | BLOCKED | MIG-0606 |

## Phase 7 — Private SPA

| ID | Task | State | Depends on |
| --- | --- | --- | --- |
| MIG-0701 | dashboard read-only | BLOCKED | MIG-0206, MIG-0601 |
| MIG-0702 | dashboard mutations | BLOCKED | MIG-0602, MIG-0701 |
| MIG-0703 | entry | BLOCKED | MIG-0702 |
| MIG-0704 | manage | BLOCKED | MIG-0604, MIG-0703 |
| MIG-0705 | admin | BLOCKED | MIG-0605, MIG-0704 |
| MIG-0706 | Phase 7 Gate | BLOCKED | MIG-0705 |

## Phase 8 — Auth

| ID | Task | State | Depends on |
| --- | --- | --- | --- |
| MIG-0801 | Auth baseline fixtures/tests | BLOCKED | MIG-0008 |
| MIG-0802 | Web Standard/Auth integration PoC | BLOCKED | MIG-0801, MIG-0607 |
| MIG-0803 | Discord/account-linking parity | BLOCKED | MIG-0802 |
| MIG-0804 | CPU/security review | BLOCKED | MIG-0803 |
| MIG-0805 | production cutover proposal | BLOCKED | MIG-0804 |
| MIG-0806 | Phase 8 Gate | BLOCKED | MIG-0805 |

MIG-0805 requires explicit user approval before production action.

## Phase 9 — Next/OpenNext retirement

| ID | Task | State | Depends on |
| --- | --- | --- | --- |
| MIG-0901 | residual dependency inventory | BLOCKED | MIG-0508, MIG-0607, MIG-0706, MIG-0806 |
| MIG-0902 | rollback observation window | BLOCKED | MIG-0901 |
| MIG-0903 | remove legacy Server Actions/routes | BLOCKED | MIG-0902 |
| MIG-0904 | remove OpenNext/Next deploy path | BLOCKED | MIG-0903 |
| MIG-0905 | final architecture/docs consolidation | BLOCKED | MIG-0904 |
| MIG-0906 | Final Gate | BLOCKED | MIG-0905 |

---

# Last completed task

## MIG-0006 — CPU / 1102 / request baseline

```text
State: DONE
Owner: chatgpt
PR: #242
Production action required: no
Runtime behavior changed: no
```

Completed:

- Workers Observabilityをread-only集計し、4 CURRENT WorkersのCPU/resource outcomeを測定
- aggregateはABR sampling（主に `abr_level=10`, `sampleInterval ~= 10`）のためsampling-weighted estimateとして明記
- web fetchはCPU median 15ms / p95 872ms / p99 1249msのCURRENT sampled distribution
- web `exceededCpu` signalを確認し、個別eventでpublic video / user pathがCPU 10ms・HTTP 503で終了する実例を確認
- content static-rebuild QueueでもCPU 50msの `exceededCpu` individual eventを確認
- historical web versionに `exceededMemory` / HTTP 503を確認し、CPUだけでなくmemory/cancellationを別リスクとして固定
- home/list/user/video/image proxy/account summary/entryなどのhot pathをcode/testsと実ログで照合
- CURRENT ISR/card cap/static asset bypass/bounded degraded D1/image safety mitigationsをreplacement parityまで維持する方針を固定
- TARGET budgetsを simple read p95<5ms / normal mutation<8ms / auth-heavy<9ms / visibility gateway p50<1.5ms p95<3ms p99<5ms / exceededCpu=0 として正本化
- `cloudflare/PERFORMANCE_BASELINE.md` をshared protocol / Claude / Codex / Antigravity / checkerへ接続
- account subscription APIはconnector権限上read不能だったためplan名を推測しない方針を明記
- production Cloudflare/runtime mutation 0

Validation evidence:

- Workers Observability invocation logs: CPU, wall time, outcome, event type, request path, HTTP status
- Worker settings: invocation logs / persistence / head sampling rate=1
- individual resource-failure events used in addition to sampled aggregate
- repo compare: branch is behind main by 0 and changes only migration docs/agent/checker files
- migration checker JavaScript syntax parse: OK
- stable baseline markers present; volatile sampled counts are intentionally not checker constants
- full local checker execution is not claimed because repository materialization/network is unavailable in the isolated runtime
- author self-review only; independent approval is not represented

Optimization conclusions:

- current public SSR/RSC execution materially overlaps with `exceededCpu`; TARGET public SSG + thin visibility gateway remains evidence-backed
- private Next SSR tails support React/Vite SPA + bounded API direction
- stable image delivery should avoid mandatory Worker proxy hits where safety/revocation semantics permit
- background Workers retain separate budgets and must not be merged into the web request budget without MIG-0009 evidence
- increasing CPU limit alone is not an acceptable migration strategy because memory/cancellation and unnecessary request-time generation also exist
- frontend product-contract change required for optimization: 0

Rollback:

- revert PR #242 squash commit; no Cloudflare rollback is required because MIG-0006 is documentation/checker-only

# Next task claim template

For MIG-0007 the writer records before work:

```text
Task: MIG-0007
Owner: chatgpt
State: IN_PROGRESS
Branch: migration/mig-0007-static-visibility-baseline
PR: pending
Scope: static artifacts / aliases / visibility fail-closed / repair/fallback baseline
Affected UX IDs:
Affected FN IDs:
Evidence sources: current code/tests + cloudflare/TOPOLOGY.md + cloudflare/PERFORMANCE_BASELINE.md
Rollback:
Production action required: no
```

MIG-0008 and MIG-0009 remain dependency-ready. MIG-0007 is the default next task.
