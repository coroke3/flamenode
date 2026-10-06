# FlameNode Migration Status

> Status: Active / Progress source of truth
> Last updated: 2026-10-06
> Baseline commit: `99591f7b3387b6b33d113f2685d6b31e38085fdc`
> Migration bootstrap merged at: `001745e30e7801f8a5ffda93d6c2cfac2ed30466`
> Architecture: [`README.md`](README.md)
> Execution: [`AGENT_PROTOCOL.md`](AGENT_PROTOCOL.md)
> Feature parity: [`FUNCTION_INVENTORY.md`](FUNCTION_INVENTORY.md)

Claude / Codex / Antigravityを含む全agentが共有する進捗正本。chat historyではなく、このファイルを次iterationへ引き継ぐ。

## Overall

```text
Current Phase: 0 — Baseline
Current Task: MIG-0002
Current Owner: chatgpt
Task State: IN_PROGRESS
Overall State: IN_PROGRESS
Production Cutover: NOT STARTED
Last merged PR: #235
```

## State definitions

- `READY`: dependencies解消済み
- `IN_PROGRESS`: 1 agentがclaim中
- `REVIEW`: 実装済み、検証/Lead確認待ち
- `BLOCKED`: 明示blockerあり
- `DONE`: acceptance達成済み
- `SKIPPED`: 理由付きで不要

## Loop rules

- 1 iteration = exactly 1 MIG task
- 1 task = 1 owner
- `READY → IN_PROGRESS → DONE/REVIEW/BLOCKED`
- `IN_PROGRESS`のまま次iterationへ進まない
- 次taskは、依存taskが完了済みの`READY`から選ぶ
- Phase Gateはagentが自動承認しない
- STATUS + affected inventory/matrixを更新してから次へ進む
- production deploy / Worker Route / Custom Domain / Remote D1 / secret変更は明示承認まで停止

## Inventory coverage

| Surface | Baseline discovered | Detailed audited | Parity verified | Phase 0 target |
| --- | ---: | ---: | ---: | --- |
| UI/screens | 86 | 0 | 0 | 86 function-mapped |
| Function IDs | 128 | 2 | 0 | all required CURRENT contracts audited |
| Server Action files | 34+ | 0 exports | 0 | all exports + inline actions disposed |
| API top-level areas | 14 | 0 methods | 0 | all `route.ts` methods disposed |
| CURRENT Worker scripts | 4 | 0 job types | 0 | bindings/routes/jobs fixed |
| Redesign mock screens | 86 | 86 existence | 0 functional parity | all mapped to CURRENT functions |

```text
CURRENT_VERIFIED: 2
DETAIL_AUDIT_REQUIRED: 126
PARITY_VERIFIED: 0
REMOVAL_PROPOSED: 0
REMOVED_APPROVED: 0
```

未監査必須機能が残る限りPhase 0 GateはCLOSED。

## Phase summary

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
| MIG-0001 | migration docs / multi-agent command / progress framework | DONE | — | merged in #232; common protocol、tool adapters、inventory、docs checker |
| MIG-0002 | 86 screen/page/route baseline | IN_PROGRESS | MIG-0001 | CURRENT route一覧、roles、purpose、states、function候補 |
| MIG-0003 | Server Action / inline action baseline | READY | MIG-0001 | 全exports/callers/input/permission/effects/tests |
| MIG-0004 | Route Handler / API baseline | READY | MIG-0001 | 全`route.ts` method/contract/auth/effects/tests |
| MIG-0005 | Cloudflare Worker/domain/route/binding baseline | READY | MIG-0001 | 4 Worker、Custom Domain、Routes、bindings、build topology |
| MIG-0006 | CPU / 1102 / request baseline | BLOCKED | MIG-0005 | 実Cloudflare metrics、hot/cold paths |
| MIG-0007 | static artifact / visibility baseline | READY | MIG-0001 | artifact types、aliases、fail-closed、repair/fallback |
| MIG-0008 | Auth/session/permission baseline | READY | MIG-0001 | login/session/linking/owner/permission contract |
| MIG-0009 | Queue/Cron/background job baseline | BLOCKED | MIG-0005 | job types、Queue/DLQ、retry/recovery/side effects |
| MIG-0010 | 86 redesign screens → function IDs mapping | BLOCKED | MIG-0002,0003,0004 | every screen mapped、state coverage、responsive requirements |
| MIG-0011 | function inventory consolidation / gap scan | BLOCKED | MIG-0003,0004,0007,0008,0009,0010 | unknown=0、duplicates merged、cross-cutting effects covered |
| MIG-0012 | Phase 0 Gate | BLOCKED | MIG-0006,0011 | Lead review + rollback baseline fixed |

### Phase 0 Gate

- [ ] all CURRENT page/routes inventoried
- [ ] all Server Action exports + inline actions inventoried
- [ ] all Route Handler methods inventoried
- [ ] all required functions CURRENT_VERIFIED
- [ ] all 86 screens mapped to function IDs
- [ ] all background jobs/Queues/Cron inventoried
- [ ] current Cloudflare topology fixed
- [ ] CPU/1102 baseline fixed
- [ ] visibility/static guarantees fixed
- [ ] auth/permission guarantees fixed
- [ ] production behavior unchanged by baseline work
- [ ] rollback target commit/config fixed

---

# Phase 1 — Repository boundaries

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

# Phase 2 — Design System

| ID | Task | State | Depends on |
| --- | --- | --- | --- |
| MIG-0201 | design tokens | BLOCKED | MIG-0108 |
| MIG-0202 | primitives | BLOCKED | MIG-0201 |
| MIG-0203 | navigation/layout | BLOCKED | MIG-0202 |
| MIG-0204 | forms/feedback/data-display | BLOCKED | MIG-0202 |
| MIG-0205 | representative responsive screens | BLOCKED | MIG-0203,0204 |
| MIG-0206 | Phase 2 Gate | BLOCKED | MIG-0205 |

# Phase 3 — Domain extraction

| ID | Task | State | Depends on |
| --- | --- | --- | --- |
| MIG-0301 | extraction/DI pattern | BLOCKED | MIG-0108 |
| MIG-0302 | low-risk read domain | BLOCKED | MIG-0301 |
| MIG-0303 | low-risk mutation domain | BLOCKED | MIG-0302 |
| MIG-0304 | video domain group | BLOCKED | MIG-0303 |
| MIG-0305 | event/slot domain group | BLOCKED | MIG-0303 |
| MIG-0306 | user/X/admin domain group | BLOCKED | MIG-0303 |
| MIG-0307 | Phase 3 Gate | BLOCKED | MIG-0304..0306 |

# Phase 4 — Public PoC

| ID | Task | State | Depends on |
| --- | --- | --- | --- |
| MIG-0401 | Astro build-input PoC | BLOCKED | MIG-0105 |
| MIG-0402 | shared React UI in Astro | BLOCKED | MIG-0206,0401 |
| MIG-0403 | representative video/user/event SSG | BLOCKED | MIG-0402 |
| MIG-0404 | route-map generator | BLOCKED | MIG-0403 |
| MIG-0405 | visibility gateway | BLOCKED | MIG-0404 |
| MIG-0406 | CPU/build benchmark | BLOCKED | MIG-0405 |
| MIG-0407 | Phase 4 Gate | BLOCKED | MIG-0406 |

# Phase 5 — Public migration

| ID | Task | State | Depends on |
| --- | --- | --- | --- |
| MIG-0501 | fixed/static routes | BLOCKED | MIG-0407 |
| MIG-0502 | event routes | BLOCKED | MIG-0501 |
| MIG-0503 | group routes | BLOCKED | MIG-0501 |
| MIG-0504 | user routes | BLOCKED | MIG-0501 |
| MIG-0505 | list/search/recommend/trending | BLOCKED | MIG-0501 |
| MIG-0506 | root/top | BLOCKED | MIG-0505 |
| MIG-0507 | `/:id` video catch-all | BLOCKED | MIG-0502..0506 |
| MIG-0508 | Phase 5 Gate | BLOCKED | MIG-0507 |

# Phase 6 — Hono API

| ID | Task | State | Depends on |
| --- | --- | --- | --- |
| MIG-0601 | low-risk reads | BLOCKED | MIG-0307,0107 |
| MIG-0602 | low-risk mutations | BLOCKED | MIG-0601 |
| MIG-0603 | video APIs | BLOCKED | MIG-0602 |
| MIG-0604 | event/slot APIs | BLOCKED | MIG-0602 |
| MIG-0605 | user/X/admin APIs | BLOCKED | MIG-0602 |
| MIG-0606 | API CPU benchmark | BLOCKED | MIG-0603..0605 |
| MIG-0607 | Phase 6 Gate | BLOCKED | MIG-0606 |

# Phase 7 — Private SPA

| ID | Task | State | Depends on |
| --- | --- | --- | --- |
| MIG-0701 | dashboard read-only | BLOCKED | MIG-0206,0601 |
| MIG-0702 | dashboard mutations | BLOCKED | MIG-0602,0701 |
| MIG-0703 | entry | BLOCKED | MIG-0702 |
| MIG-0704 | manage | BLOCKED | MIG-0604,0703 |
| MIG-0705 | admin | BLOCKED | MIG-0605,0704 |
| MIG-0706 | Phase 7 Gate | BLOCKED | MIG-0705 |

# Phase 8 — Auth

| ID | Task | State | Depends on |
| --- | --- | --- | --- |
| MIG-0801 | Auth baseline fixtures/tests | BLOCKED | MIG-0008 |
| MIG-0802 | Web Standard/Auth integration PoC | BLOCKED | MIG-0801,0607 |
| MIG-0803 | Discord/account-linking parity | BLOCKED | MIG-0802 |
| MIG-0804 | CPU/security review | BLOCKED | MIG-0803 |
| MIG-0805 | production cutover proposal | BLOCKED | MIG-0804 |
| MIG-0806 | Phase 8 Gate | BLOCKED | MIG-0805 |

MIG-0805 requires explicit user approval before production action.

# Phase 9 — Next/OpenNext retirement

| ID | Task | State | Depends on |
| --- | --- | --- | --- |
| MIG-0901 | residual dependency inventory | BLOCKED | MIG-0508,0607,0706,0806 |
| MIG-0902 | rollback observation window | BLOCKED | MIG-0901 |
| MIG-0903 | remove legacy Server Actions/routes | BLOCKED | MIG-0902 |
| MIG-0904 | remove OpenNext/Next deploy path | BLOCKED | MIG-0903 |
| MIG-0905 | final architecture docs | BLOCKED | MIG-0904 |
| MIG-0906 | Final Gate | BLOCKED | MIG-0905 |

---

# Current task detail

## MIG-0002 — 86 screen/page/route baseline

```text
State: IN_PROGRESS
Owner: chatgpt
Production action required: no
```

Scope:

- CURRENT画面/routeをコードと既存redesign inventoryから固定
- roles / purpose / happy/loading/empty/error/forbidden statesを記録
- 初期function ID候補を紐付け
- `ROUTE_MATRIX.md` と必要なfunction ledgerを更新
- frontend-visible behaviorを`FRONTEND_FEATURE_INVENTORY.md`へ固定
- backend改善候補を`BACKEND_OPTIMIZATION_LEDGER.md`へ記録するための基準を追加

Non-scope:

- Astro実装
- Hono実装
- UI production化
- auth変更
- Cloudflare routing変更
- backend refactorそのもの

Acceptance:

- CURRENT page/route inventoryに未分類routeが残らない
- 86 redesign screensとの関係が追跡可能
- routeごとのauth/visibility/SEO/state候補が明示される
- frontend-visible capability/stateが維持契約として明文化される
- backend改善候補はfrontend契約と分離して記録される
- runtime behavior unchanged

Rollback:

- docs-only changesをrevert

## Last iteration

```text
Agent: chatgpt
Task: MIG-0001
Result: #232 + #233の有効部分を統合しmainへsquash merge
Affected functions: migration framework only; runtime behavior unchanged
Validation: static review; migration consistency checker added; PR CI not configured
PR/commit: #232 / 001745e30e7801f8a5ffda93d6c2cfac2ed30466
Rollback: revert merge commit
Blockers: none
Next: MIG-0002
```

## Next READY

Default next task: `MIG-0002`.

`MIG-0003`, `MIG-0004`, `MIG-0005`, `MIG-0007`, `MIG-0008` are also dependency-ready and may be assigned to separate read-only/audit agents, but only one writer may own a given task and `STATUS.md` changes must be serialized.
