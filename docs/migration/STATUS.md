# FlameNode Migration Status

> Status: Active / Progress source of truth
> Last updated: 2026-10-06
> Baseline commit: `99591f7b3387b6b33d113f2685d6b31e38085fdc`
> Migration bootstrap merged at: `001745e30e7801f8a5ffda93d6c2cfac2ed30466`
> Architecture: [`README.md`](README.md)
> Execution: [`AGENT_PROTOCOL.md`](AGENT_PROTOCOL.md)
> Frontend parity: [`FRONTEND_FEATURES.md`](FRONTEND_FEATURES.md)
> Function parity: [`FUNCTION_INVENTORY.md`](FUNCTION_INVENTORY.md)
> Optimization: [`BACKEND_OPTIMIZATION.md`](BACKEND_OPTIMIZATION.md)

Claude / Codex / Antigravityを含む全agentが共有する進捗正本。chat historyではなく、このファイルを次iterationへ引き継ぐ。

## Overall

```text
Current Phase: 0 — Baseline
Current Task: MIG-0002
Current Owner: chatgpt
Task State: REVIEW
Overall State: IN_PROGRESS
Production Cutover: NOT STARTED
Open PR: #237
Next after approval: MIG-0003
```

## State definitions

- `READY`: dependencies解消済み
- `IN_PROGRESS`: 1 agentがclaim中
- `REVIEW`: 実装/棚卸し済み、独立review/検証待ち
- `BLOCKED`: 明示blockerあり
- `DONE`: acceptance達成済み
- `SKIPPED`: 理由付きで不要

## Loop rules

- 1 iteration = exactly 1 MIG task
- 1 task = 1 owner / 1 branch / 1 PR
- `READY → IN_PROGRESS → REVIEW → DONE` または `BLOCKED`
- `IN_PROGRESS`のまま次iterationへ進まない
- Phase Gateをagentが自動承認しない
- STATUS + affected inventory/matrixを更新してから次へ進む
- production deploy / Worker Route / Custom Domain / Remote D1 / secret変更は明示承認まで停止
- Git詳細は `GIT_WORKFLOW.md`

---

# Inventory coverage

| Surface | Baseline discovered | Detailed audited | Parity verified | Phase 0 target |
| --- | ---: | ---: | ---: | --- |
| USER_SCREEN routes | 86 | 86 route/purpose baseline | 0 | 86 capability-mapped |
| Frontend-exposed capabilities | 89 | 0 full UX contracts | 0 | 89+ all mapped/audited |
| CURRENT technical compatibility routes | 4 | 4 purpose/query contracts | n/a | replacement evidence before removal |
| Function IDs | 130 | 2 | 0 | all required CURRENT contracts audited |
| Server Action files | 34+ | 0 exports | 0 | all exports + inline actions disposed |
| API top-level areas | 14 | 0 methods | 0 | all `route.ts` methods disposed |
| CURRENT Worker scripts | 4 | 0 job types | 0 | bindings/routes/jobs fixed |
| Redesign mock screens | 86 | 86 existence | 0 functional parity | all mapped to CURRENT capabilities |

Current function-state summary:

```text
CURRENT_VERIFIED: 2
DETAIL_AUDIT_REQUIRED: 128
PARITY_VERIFIED: 0
REMOVAL_PROPOSED: 0
REMOVED_APPROVED: 0
```

Initial frontend capability count:

```text
Public                   22
Authentication/account    9
Personal                  7
Entry                     6
Manage                   12
Admin                    31
System/operational        2
---------------------------
Total                    89
```

Phase 0 Gateは、未監査必須機能・screen mapping・backend disposition・optimization blocker assessmentが残る限りCLOSED。

---

# Phase summary

| Phase | Name | State | Gate |
| --- | --- | --- | --- |
| 0 | Baseline / Inventory | IN_PROGRESS | CLOSED |
| 1 | Repository boundaries | BLOCKED | CLOSED |
| 2 | Design System | BLOCKED | CLOSED |
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
| MIG-0001 | migration docs / multi-agent command / progress framework | DONE | — | merged; protocol/adapters/inventory/checker |
| MIG-0002 | screen/page/route + frontend capability baseline | REVIEW | MIG-0001 | 86 USER_SCREEN、89 frontend capabilities、technical/global surfaces classified |
| MIG-0003 | Server Action / inline action baseline | READY | MIG-0001 | 全exports/callers/input/permission/effects/tests + optimization observations |
| MIG-0004 | Route Handler / API baseline | READY | MIG-0001 | 全`route.ts` method/contract/auth/effects/tests + duplication observations |
| MIG-0005 | Cloudflare Worker/domain/route/binding baseline | READY | MIG-0001 | 4 Worker、Custom Domain、Routes、bindings、build topology |
| MIG-0006 | CPU / 1102 / request baseline | BLOCKED | MIG-0005 | 実Cloudflare metrics、hot/cold paths |
| MIG-0007 | static artifact / visibility baseline | READY | MIG-0001 | artifact types、aliases、fail-closed、repair/fallback |
| MIG-0008 | Auth/session/permission baseline | READY | MIG-0001 | login/session/linking/owner/permission contract |
| MIG-0009 | Queue/Cron/background job baseline | BLOCKED | MIG-0005 | job types、Queue/DLQ、retry/recovery/side effects |
| MIG-0010 | 86 redesign screens → capability/function mapping | BLOCKED | MIG-0002,0003,0004 | every screen mapped、all UX states、responsive/query/deep-link requirements |
| MIG-0011 | inventory consolidation / gap scan / optimization assessment | BLOCKED | MIG-0003,0004,0007,0008,0009,0010 | unknown=0、duplicates resolved、backend candidates assessed、frontend-impact blockers reported |
| MIG-0012 | Phase 0 Gate | BLOCKED | MIG-0006,0011 | Lead review + rollback baseline fixed |

## Phase 0 Gate

- [x] initial CURRENT USER_SCREEN inventory fixed at 86
- [x] initial frontend-exposed capability baseline fixed at 89
- [x] CURRENT query compatibility route class documented
- [x] global error/404/robots/sitemap surfaces classified
- [ ] all Server Action exports + inline actions inventoried
- [ ] all Route Handler methods inventoried
- [ ] all required functions CURRENT_VERIFIED
- [ ] all 86 screens mapped to required capability/function IDs
- [ ] all frontend capabilities have loading/error/empty/forbidden/pending/responsive contract evidence
- [ ] all background jobs/Queues/Cron inventoried
- [ ] current Cloudflare topology fixed
- [ ] CPU/1102 baseline fixed
- [ ] visibility/static guarantees fixed
- [ ] auth/permission guarantees fixed
- [ ] backend optimization candidates validated/rejected intentionally
- [ ] every optimization blocker has frontend-impact disposition
- [ ] production behavior unchanged by baseline work
- [ ] rollback target commit/config fixed

---

# Phases 1–9

Detailed tasks remain defined in `docs/migration/README.md` and existing task rows below. Phase 1+ stays BLOCKED until MIG-0012.

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
| MIG-0108 | Phase 1 Gate | BLOCKED | MIG-0102..0107 |

## Phase 2 — Design System

| ID | Task | State | Depends on |
| --- | --- | --- |
| MIG-0201 | design tokens | BLOCKED | MIG-0108 |
| MIG-0202 | primitives | BLOCKED | MIG-0201 |
| MIG-0203 | navigation/layout | BLOCKED | MIG-0202 |
| MIG-0204 | forms/feedback/data-display | BLOCKED | MIG-0202 |
| MIG-0205 | representative responsive screens | BLOCKED | MIG-0203,0204 |
| MIG-0206 | Phase 2 Gate | BLOCKED | MIG-0205 |

## Phase 3 — Domain extraction

| ID | Task | State | Depends on |
| --- | --- | --- |
| MIG-0301 | extraction/DI pattern | BLOCKED | MIG-0108 |
| MIG-0302 | low-risk read domain | BLOCKED | MIG-0301 |
| MIG-0303 | low-risk mutation domain | BLOCKED | MIG-0302 |
| MIG-0304 | video domain group | BLOCKED | MIG-0303 |
| MIG-0305 | event/slot domain group | BLOCKED | MIG-0303 |
| MIG-0306 | user/X/admin domain group | BLOCKED | MIG-0303 |
| MIG-0307 | Phase 3 Gate | BLOCKED | MIG-0304..0306 |

## Phase 4 — Public PoC

| ID | Task | State | Depends on |
| --- | --- | --- |
| MIG-0401 | Astro build-input PoC | BLOCKED | MIG-0105 |
| MIG-0402 | shared React UI in Astro | BLOCKED | MIG-0206,0401 |
| MIG-0403 | representative video/user/event SSG | BLOCKED | MIG-0402 |
| MIG-0404 | route-map generator | BLOCKED | MIG-0403 |
| MIG-0405 | visibility gateway | BLOCKED | MIG-0404 |
| MIG-0406 | CPU/build benchmark | BLOCKED | MIG-0405 |
| MIG-0407 | Phase 4 Gate | BLOCKED | MIG-0406 |

## Phase 5 — Public migration

| ID | Task | State | Depends on |
| --- | --- | --- |
| MIG-0501 | fixed/static routes | BLOCKED | MIG-0407 |
| MIG-0502 | event routes | BLOCKED | MIG-0501 |
| MIG-0503 | group routes | BLOCKED | MIG-0501 |
| MIG-0504 | user routes | BLOCKED | MIG-0501 |
| MIG-0505 | list/search/recommend/trending | BLOCKED | MIG-0501 |
| MIG-0506 | root/top | BLOCKED | MIG-0505 |
| MIG-0507 | `/:id` video catch-all | BLOCKED | MIG-0502..0506 |
| MIG-0508 | Phase 5 Gate | BLOCKED | MIG-0507 |

## Phase 6 — Hono API

| ID | Task | State | Depends on |
| --- | --- | --- |
| MIG-0601 | low-risk reads | BLOCKED | MIG-0307,0107 |
| MIG-0602 | low-risk mutations | BLOCKED | MIG-0601 |
| MIG-0603 | video APIs | BLOCKED | MIG-0602 |
| MIG-0604 | event/slot APIs | BLOCKED | MIG-0602 |
| MIG-0605 | user/X/admin APIs | BLOCKED | MIG-0602 |
| MIG-0606 | API CPU benchmark | BLOCKED | MIG-0603..0605 |
| MIG-0607 | Phase 6 Gate | BLOCKED | MIG-0606 |

## Phase 7 — Private SPA

| ID | Task | State | Depends on |
| --- | --- | --- |
| MIG-0701 | dashboard read-only | BLOCKED | MIG-0206,0601 |
| MIG-0702 | dashboard mutations | BLOCKED | MIG-0602,0701 |
| MIG-0703 | entry | BLOCKED | MIG-0702 |
| MIG-0704 | manage | BLOCKED | MIG-0604,0703 |
| MIG-0705 | admin | BLOCKED | MIG-0605,0704 |
| MIG-0706 | Phase 7 Gate | BLOCKED | MIG-0705 |

## Phase 8 — Auth

| ID | Task | State | Depends on |
| --- | --- | --- |
| MIG-0801 | Auth baseline fixtures/tests | BLOCKED | MIG-0008 |
| MIG-0802 | Web Standard/Auth integration PoC | BLOCKED | MIG-0801,0607 |
| MIG-0803 | Discord/account-linking parity | BLOCKED | MIG-0802 |
| MIG-0804 | CPU/security review | BLOCKED | MIG-0803 |
| MIG-0805 | production cutover proposal | BLOCKED | MIG-0804 |
| MIG-0806 | Phase 8 Gate | BLOCKED | MIG-0805 |

MIG-0805 requires explicit user approval before production action.

## Phase 9 — Next/OpenNext retirement

| ID | Task | State | Depends on |
| --- | --- | --- |
| MIG-0901 | residual dependency inventory | BLOCKED | MIG-0508,0607,0706,0806 |
| MIG-0902 | rollback observation window | BLOCKED | MIG-0901 |
| MIG-0903 | remove legacy Server Actions/routes | BLOCKED | MIG-0902 |
| MIG-0904 | remove OpenNext/Next deploy path | BLOCKED | MIG-0903 |
| MIG-0905 | final architecture docs | BLOCKED | MIG-0904 |
| MIG-0906 | Final Gate | BLOCKED | MIG-0905 |

---

# Current task detail

## MIG-0002 — screen/page/route + frontend capability baseline

```text
State: REVIEW
Owner: chatgpt
PR: #237
Production action required: no
```

Completed baseline:

- existing 86-screen inventory preserved as route/purpose source
- 89 frontend-exposed capabilities explicitly inventoried
- missing System functions added: `FN-PLAT-011`, `FN-PLAT-012`
- total function IDs 128 → 130
- `/list/~query`, `/user/~query`, `/event/~query`, `/user/[id]/paged` classified as TECH_COMPAT rather than duplicate features
- global error/not-found/robots/sitemap surfaces classified
- frontend UX-state preservation contract defined
- backend optimization ledger and blocker-report policy introduced
- runtime behavior unchanged

Acceptance:

- [x] 86 USER_SCREEN baseline is traceable to exact route inventory
- [x] users/roles/purpose/primary action baseline exists for all 86 screens
- [x] initial 89 frontend capabilities are explicit and function-ID backed
- [x] technical compatibility routes are separately classified
- [x] global cross-route UI/SEO surfaces are separately classified
- [x] feature deletion requires explicit approval
- [x] backend optimization cannot silently change frontend behavior
- [x] efficiency blockers must report concrete frontend impact after full inventory
- [x] runtime/Cloudflare/D1 unchanged
- [ ] `npm run check:docs` / `check:project-docs` execution evidence
- [ ] independent reviewer approval

Rollback:

- docs-only branch/PR revert

## Last iteration

```text
Agent: chatgpt
Task: MIG-0002
Result: frontend capability baseline + route classes + backend optimization policy prepared for independent review
Affected functions: 130 total IDs; 89 frontend-exposed capabilities
Validation: repository code/tree/search cross-check; docs consistency checker updated; runtime checks not applicable
PR/commit: #237
Rollback: revert squash commit after merge, or close PR before merge
Blockers: independent review/check execution pending
Next: after approval mark MIG-0002 DONE; default next MIG-0003
```

## Next after approval

Default: `MIG-0003` — all Server Action / inline action baseline + optimization observations.

`MIG-0004`, `MIG-0005`, `MIG-0007`, `MIG-0008` are also dependency-ready for read-only audit/review work, but writer state updates must remain serialized.
