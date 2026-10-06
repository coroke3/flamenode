# FlameNode Migration Status

> Status: Active / Progress source of truth
> Last updated: 2026-10-06
> Baseline commit: `99591f7b3387b6b33d113f2685d6b31e38085fdc`
> Architecture: [`README.md`](README.md)
> Execution: [`AGENT_PROTOCOL.md`](AGENT_PROTOCOL.md)
> Feature parity: [`FUNCTION_INVENTORY.md`](FUNCTION_INVENTORY.md)
>
> Claude / Codex / Antigravityを含む全agentが共有する進捗正本。
> chat historyではなく、このファイルの状態を次iterationへ引き継ぐ。

## Overall

```text
Current Phase: 0 — Baseline
Current Task: MIG-0001
Current Owner: chatgpt
Task State: REVIEW
Overall State: REVIEW
Production Cutover: NOT STARTED
Open PR: #232
Next after approval: MIG-0002
```

## State definitions

- `READY`: dependencies解消済み
- `IN_PROGRESS`: 1 agentがclaim中
- `REVIEW`: 実装済み、CI/Lead確認待ち
- `BLOCKED`: 明示blockerあり
- `DONE`: acceptance達成済み
- `SKIPPED`: 理由付きで不要

## Agent ownership

- 1 task = 1 owner。
- owner例: `claude`, `codex`, `antigravity`, `chatgpt`, `human`。
- 他agentは同じtask/file/domainを同時編集しない。
- read-only review/auditは並列可。
- owner交代時はこのファイルへhandoffを残す。

## Loop invariants

- 1 iteration = 1 MIG task。
- 開始時 `READY → IN_PROGRESS`。
- 終了時 `DONE` / `REVIEW` / `BLOCKED`。
- `IN_PROGRESS`のまま次iterationへ進まない。
- Phase Gateをagentが自動承認しない。
- `BLOCKED`を飛ばして後続高リスクtaskへ進まない。
- production deploy / Worker Route / Custom Domain / Remote D1 / secret操作は明示承認まで停止。
- STATUS + affected inventory/matrixを更新してから次taskへ進む。

---

# Inventory coverage

Phase 0では「存在が分かる」から「contractが監査済み」へ進める。

| Surface | Baseline discovered | Detailed audited | Parity verified | Target for Phase 0 Gate |
| --- | ---: | ---: | ---: | ---: |
| UI/screens | 86 | 0 | 0 | 86 mapped to function IDs |
| Function IDs | 128 | 2 | 0 | all required CURRENT contracts audited |
| Server Action files | 34+ | 0 exports | 0 | all exports + inline actions disposed |
| API top-level areas | 14 | 0 endpoints/methods | 0 | all `route.ts` methods disposed |
| CURRENT Worker scripts | 4 | 0 job-type inventories | 0 | bindings/routes/jobs fixed |
| Redesign mock screens | 86 | 86 existence | 0 functional parity | all mapped to CURRENT functions |

Current function-state summary:

```text
CURRENT_VERIFIED: 2
DETAIL_AUDIT_REQUIRED: 126
PARITY_VERIFIED: 0
REMOVAL_PROPOSED: 0
REMOVED_APPROVED: 0
```

`FUNCTION_INVENTORY.md` の未監査必須機能が残る限り、Phase 0 Gateは開けない。

---

# Phase summary

| Phase | Name | State | Gate | Notes |
| --- | --- | --- | --- | --- |
| 0 | Baseline | REVIEW | CLOSED | MIG-0001 PR review中 |
| 1 | Repository boundaries | BLOCKED | CLOSED | Phase 0 Gate待ち |
| 2 | Design System | BLOCKED | CLOSED | Phase 1 Gate待ち |
| 3 | Domain extraction | BLOCKED | CLOSED | boundary/inventory後 |
| 4 | Public PoC | BLOCKED | CLOSED | boundary/design後 |
| 5 | Public migration | BLOCKED | CLOSED | Phase 4 Gate待ち |
| 6 | Hono API | BLOCKED | CLOSED | domain extraction後 |
| 7 | Private SPA | BLOCKED | CLOSED | API/design/auth bridge必要 |
| 8 | Auth | BLOCKED | CLOSED | compatibility PoCまで待機 |
| 9 | Next/OpenNext retirement | BLOCKED | CLOSED | 全parity後のみ |

---

# Phase 0 — Baseline

Goal: CURRENT productionをコード・設定・数値・機能contractで固定する。

| ID | Task | State | Depends on | Acceptance |
| --- | --- | --- | --- | --- |
| MIG-0001 | migration docs / multi-agent command / progress framework | REVIEW | — | common protocol、tool adapters、inventory、docs CI |
| MIG-0002 | CURRENT route / Server Action / API / function inventoryを完全化 | BLOCKED | MIG-0001 | 86 screens・全actions・全route methods・function mapping |
| MIG-0003 | Cloudflare Worker/domain/route/binding/job baseline | BLOCKED | MIG-0001 | repo configと実設定差分、4 Worker責務 |
| MIG-0004 | CPU / 1102 / request baseline | BLOCKED | MIG-0003 | 実Cloudflare metrics |
| MIG-0005 | static artifact / visibility baseline | BLOCKED | MIG-0001 | artifact types、aliases、fail-closed、repair/fallback |
| MIG-0006 | Auth/session/permission baseline | BLOCKED | MIG-0001 | login/session/linking/owner/permission contract |
| MIG-0007 | 86 redesign screens → CURRENT function mapping | BLOCKED | MIG-0002 | responsive/state/function coverage |
| MIG-0008 | Phase 0 Gate | BLOCKED | MIG-0002..0007 | Lead review + rollback baseline固定 |

## Phase 0 Gate

- [ ] route/page inventory complete
- [ ] Server Action exports + inline actions complete
- [ ] API route methods complete
- [ ] all required functions CURRENT_VERIFIED
- [ ] all 86 screens mapped to function IDs
- [ ] current Cloudflare topology fixed
- [ ] CPU/1102 baseline fixed
- [ ] visibility/static baseline fixed
- [ ] auth/permission baseline fixed
- [ ] production runtime unchanged by baseline work
- [ ] rollback target commit/config fixed

---

# Phase 1 — Repository boundaries

| ID | Task | State | Depends on |
| --- | --- | --- | --- |
| MIG-0101 | workspace/boundary PoC設計 | BLOCKED | MIG-0008 |
| MIG-0102 | `packages/ui` skeleton | BLOCKED | MIG-0101 |
| MIG-0103 | `packages/contracts` skeleton | BLOCKED | MIG-0101 |
| MIG-0104 | `packages/domain` skeleton | BLOCKED | MIG-0101 |
| MIG-0105 | `apps/site` Astro skeleton | BLOCKED | MIG-0101 |
| MIG-0106 | `apps/app` React/Vite skeleton | BLOCKED | MIG-0101 |
| MIG-0107 | `apps/api` Hono skeleton | BLOCKED | MIG-0101 |
| MIG-0108 | Phase 1 Gate | BLOCKED | MIG-0102..0107 |

Gate: CURRENT production build/behavior unchanged; target packages compile independently.

---

# Phase 2 — Design System

| ID | Task | State | Depends on |
| --- | --- | --- | --- |
| MIG-0201 | design tokens | BLOCKED | MIG-0108 |
| MIG-0202 | primitives | BLOCKED | MIG-0201 |
| MIG-0203 | navigation/layout | BLOCKED | MIG-0202 |
| MIG-0204 | forms/feedback/data-display | BLOCKED | MIG-0202 |
| MIG-0205 | representative responsive screens | BLOCKED | MIG-0203,0204 |
| MIG-0206 | Phase 2 Gate | BLOCKED | MIG-0205 |

Gate: 1440/1024/768/390 + accessibility + no functional deletion.

---

# Phase 3 — Domain extraction

| ID | Task | State | Depends on |
| --- | --- | --- | --- |
| MIG-0301 | extraction/DI pattern固定 | BLOCKED | MIG-0108 |
| MIG-0302 | low-risk read domain | BLOCKED | MIG-0301 |
| MIG-0303 | low-risk mutation domain | BLOCKED | MIG-0302 |
| MIG-0304 | video domain group | BLOCKED | MIG-0303 |
| MIG-0305 | event/slot domain group | BLOCKED | MIG-0303 |
| MIG-0306 | user/X/admin domain group | BLOCKED | MIG-0303 |
| MIG-0307 | Phase 3 Gate | BLOCKED | MIG-0304..0306 |

Exact server disposition is tracked in `API_MATRIX.md`.

---

# Phase 4 — Public PoC

| ID | Task | State | Depends on |
| --- | --- | --- | --- |
| MIG-0401 | Astro build-input PoC | BLOCKED | MIG-0105 |
| MIG-0402 | shared React UI in Astro | BLOCKED | MIG-0206,0401 |
| MIG-0403 | video/user/event representative SSG | BLOCKED | MIG-0402 |
| MIG-0404 | route-map generator | BLOCKED | MIG-0403 |
| MIG-0405 | visibility gateway | BLOCKED | MIG-0404 |
| MIG-0406 | CPU/build benchmark | BLOCKED | MIG-0405 |
| MIG-0407 | Phase 4 Gate | BLOCKED | MIG-0406 |

Gate includes fail-closed visibility, no request-time SSR, p99 gateway CPU target, 1102=0, acceptable build time.

---

# Phase 5 — Public migration

| ID | Task | State | Depends on |
| --- | --- | --- | --- |
| MIG-0501 | fixed/static routes | BLOCKED | MIG-0407 |
| MIG-0502 | event routes | BLOCKED | MIG-0501 |
| MIG-0503 | groups routes | BLOCKED | MIG-0501 |
| MIG-0504 | user routes | BLOCKED | MIG-0501 |
| MIG-0505 | list/search/recommend/trending | BLOCKED | MIG-0501 |
| MIG-0506 | root/top | BLOCKED | MIG-0505 |
| MIG-0507 | `/:id` video catch-all | BLOCKED | MIG-0502..0506 |
| MIG-0508 | Phase 5 Gate | BLOCKED | MIG-0507 |

Exact route/function coverage is tracked in `ROUTE_MATRIX.md` + `FUNCTION_INVENTORY.md`.

---

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

---

# Phase 7 — Private SPA

| ID | Task | State | Depends on |
| --- | --- | --- | --- |
| MIG-0701 | dashboard read-only | BLOCKED | MIG-0206,0601 |
| MIG-0702 | dashboard mutations | BLOCKED | MIG-0602,0701 |
| MIG-0703 | entry | BLOCKED | MIG-0702 |
| MIG-0704 | manage | BLOCKED | MIG-0604,0703 |
| MIG-0705 | admin | BLOCKED | MIG-0605,0704 |
| MIG-0706 | Phase 7 Gate | BLOCKED | MIG-0705 |

Each screen requires associated function IDs to be `PARITY_VERIFIED` or explicitly approved for removal.

---

# Phase 8 — Auth

| ID | Task | State | Depends on |
| --- | --- | --- | --- |
| MIG-0801 | Auth baseline fixtures/tests | BLOCKED | MIG-0006 |
| MIG-0802 | Web Standard/Auth integration PoC | BLOCKED | MIG-0801,0607 |
| MIG-0803 | Discord/account-linking parity | BLOCKED | MIG-0802 |
| MIG-0804 | CPU/security review | BLOCKED | MIG-0803 |
| MIG-0805 | production cutover proposal | BLOCKED | MIG-0804 |
| MIG-0806 | Phase 8 Gate | BLOCKED | MIG-0805 |

MIG-0805 requires explicit user approval before production action.

---

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

## MIG-0001 — migration docs / multi-agent execution / progress framework

```text
State: REVIEW
Owner: chatgpt
PR: #232
Production action required: no
```

Implemented scope:

- universal `AGENTS.md`
- shared `AGENT_PROTOCOL.md`
- target `README.md`
- explicit `STATUS.md`
- `FUNCTION_INVENTORY.md`
- `ROUTE_MATRIX.md`
- `API_MATRIX.md`
- Claude command + skill adapter
- Codex repo skill adapter
- Antigravity workspace skill + agent adapter
- README / AI_CONTEXT / CLAUDE navigation

Acceptance:

- [x] one canonical protocol for all agents
- [x] exactly-one-task loop rule
- [x] repository-persisted progress
- [x] explicit Phase Gate stop
- [x] existing-function inventory introduced
- [x] redesign completion tied to function parity
- [x] no production runtime/config/Cloudflare mutation
- [ ] `check:docs` / `check:project-docs` CI confirmation
- [ ] Lead review / PR merge

Rollback:

- revert PR #232
- production runtime unaffected

## Last iteration

```text
Agent: chatgpt
Task: MIG-0001
Result: multi-agent migration framework implemented; awaiting CI/review
Affected functions: inventory framework only; no runtime function changed
Validation: CI pending
PR: #232
Rollback: revert PR #232
Blockers: CI + Lead review
Next: MIG-0002 after MIG-0001 approval/merge
```

## Next READY

```text
none while MIG-0001 = REVIEW
```
