# FlameNode Migration Status

> Status: Active / Progress source of truth
> Last updated: 2026-10-06
> Baseline commit: `99591f7b3387b6b33d113f2685d6b31e38085fdc`
> Architecture: [`README.md`](README.md)
>
> この文書は `/flamenode-migration` と `/loop` が読む **明示的な進捗正本**。
> 1 iterationごとに必ず更新する。

## Overall

```text
Current Phase: 0 — Baseline
Phase State: READY
Overall State: READY
Production Cutover: NOT STARTED
Next Task: MIG-0001
```

## State definitions

- `READY`: 依存解消済みで次に実行可能
- `IN_PROGRESS`: 現在のiterationで実装中
- `REVIEW`: 実装済み、Phase GateまたはLead確認待ち
- `BLOCKED`: 明示的な阻害要因あり
- `DONE`: Acceptanceを満たして完了
- `SKIPPED`: 明示理由付きで不要と判断

## Loop invariants

- `/loop` の **1 iteration = 1 MIG task**。
- iteration開始時に対象taskを `IN_PROGRESS` にする。
- iteration終了時に `DONE` / `REVIEW` / `BLOCKED` のいずれかへ必ず遷移する。
- 同じtaskを理由なく繰り返さない。
- `BLOCKED` taskを自動迂回して高リスクtaskへ進まない。
- Phase Gateを自動突破しない。Gate taskを`REVIEW`へ置き、Lead確認後に次PhaseをREADYにする。
- production deploy / Worker Route / Custom Domain / Remote D1 / secret変更は明示承認なしで実行しない。

## Phase summary

| Phase | Name | State | Gate | Notes |
| --- | --- | --- | --- | --- |
| 0 | Baseline | READY | CLOSED | 移行前の正本固定 |
| 1 | Repository boundaries | BLOCKED | CLOSED | Phase 0 gate待ち |
| 2 | Design System | BLOCKED | CLOSED | Phase 1 gate待ち |
| 3 | Domain extraction | BLOCKED | CLOSED | Phase 1/2進捗後 |
| 4 | Public PoC | BLOCKED | CLOSED | boundary/design準備後 |
| 5 | Public migration | BLOCKED | CLOSED | Phase 4 gate待ち |
| 6 | Hono API | BLOCKED | CLOSED | domain抽出後 |
| 7 | Private SPA | BLOCKED | CLOSED | API/auth compatibility必要 |
| 8 | Auth | BLOCKED | CLOSED | compatibility PoCまで待機 |
| 9 | Next/OpenNext retirement | BLOCKED | CLOSED | 全parity後のみ |

---

# Phase 0 — Baseline

Goal: CURRENT productionを数値・設定・contractで固定し、移行のrollback基準を作る。

| ID | Task | State | Depends on | Acceptance |
| --- | --- | --- | --- | --- |
| MIG-0001 | migration docs / command / progress frameworkを導入 | READY | — | docs check、command参照整合 |
| MIG-0002 | CURRENT route / page / API inventoryを固定 | BLOCKED | MIG-0001 | ROUTE/API matrix baseline作成 |
| MIG-0003 | Cloudflare Worker / domain / route / binding baselineを記録 | BLOCKED | MIG-0001 | 実設定とrepo configの差分明示 |
| MIG-0004 | CPU / 1102 / request baselineを固定 | BLOCKED | MIG-0003 | 実Cloudflare metrics記録 |
| MIG-0005 | static artifact / visibility fence baselineを固定 | BLOCKED | MIG-0001 | strict/check結果とfail-closed契約 |
| MIG-0006 | Auth/session/permission baselineを固定 | BLOCKED | MIG-0001 | login/session/account-linking contract |
| MIG-0007 | redesign 86画面 / responsive acceptanceをbaseline化 | BLOCKED | MIG-0001 | catalogとcoverage整合 |
| MIG-0008 | Phase 0 Gate | BLOCKED | MIG-0002..0007 | Lead review、rollback baseline確定 |

## Phase 0 Gate checklist

- [ ] CURRENT route/API inventory fixed
- [ ] Cloudflare current topology fixed
- [ ] CPU/1102 baseline fixed
- [ ] visibility/static delivery baseline fixed
- [ ] auth/session/permission baseline fixed
- [ ] redesign coverage fixed
- [ ] production変更無し
- [ ] rollback target commit/config固定

---

# Phase 1 — Repository boundaries

| ID | Task | State | Depends on | Acceptance |
| --- | --- | --- | --- | --- |
| MIG-0101 | workspace/boundary PoC設計 | BLOCKED | MIG-0008 | package boundary決定 |
| MIG-0102 | `packages/ui` skeleton | BLOCKED | MIG-0101 | framework runtime非依存 |
| MIG-0103 | `packages/contracts` skeleton | BLOCKED | MIG-0101 | Zod/shared types compile |
| MIG-0104 | `packages/domain` skeleton | BLOCKED | MIG-0101 | Next/Hono/Astro import無し |
| MIG-0105 | `apps/site` Astro skeleton | BLOCKED | MIG-0101 | existing production build無影響 |
| MIG-0106 | `apps/app` React/Vite skeleton | BLOCKED | MIG-0101 | SPA build success |
| MIG-0107 | `apps/api` Hono skeleton | BLOCKED | MIG-0101 | Worker local test success |
| MIG-0108 | Phase 1 Gate | BLOCKED | MIG-0102..0107 | current production無変更 |

---

# Phase 2 — Design System

| ID | Task | State | Depends on | Acceptance |
| --- | --- | --- | --- | --- |
| MIG-0201 | design token抽出 | BLOCKED | MIG-0108 | FlameNode Sans/theme/spacing正本化 |
| MIG-0202 | primitive components | BLOCKED | MIG-0201 | keyboard/focus/accessibility |
| MIG-0203 | navigation/layout primitives | BLOCKED | MIG-0202 | public/private双方で再利用 |
| MIG-0204 | forms/feedback/data-display primitives | BLOCKED | MIG-0202 | mock state coverage |
| MIG-0205 | representative responsive screens | BLOCKED | MIG-0203,0204 | 1440/1024/768/390 |
| MIG-0206 | Phase 2 Gate | BLOCKED | MIG-0205 | no feature deletion |

---

# Phase 3 — Domain extraction

Domain単位に細分化する。実際のServer Action/Route inventoryは `API_MATRIX.md` が正本。

| ID | Task | State | Depends on | Acceptance |
| --- | --- | --- | --- | --- |
| MIG-0301 | extraction rules / dependency injection pattern固定 | BLOCKED | MIG-0108 | framework-neutral pattern |
| MIG-0302 | low-risk read domainを1件抽出 | BLOCKED | MIG-0301 | legacy parity test |
| MIG-0303 | low-risk mutation domainを1件抽出 | BLOCKED | MIG-0302 | audit/queue/DB parity |
| MIG-0304 | video domain移行群 | BLOCKED | MIG-0303 | API_MATRIX単位で完了 |
| MIG-0305 | event/slot domain移行群 | BLOCKED | MIG-0303 | API_MATRIX単位で完了 |
| MIG-0306 | user/X/admin domain移行群 | BLOCKED | MIG-0303 | API_MATRIX単位で完了 |
| MIG-0307 | Phase 3 Gate | BLOCKED | MIG-0304..0306 | required domain services抽出 |

---

# Phase 4 — Public PoC

| ID | Task | State | Depends on | Acceptance |
| --- | --- | --- | --- | --- |
| MIG-0401 | Astro static build input PoC | BLOCKED | MIG-0105 | D1 direct projection無し |
| MIG-0402 | shared React UI in Astro PoC | BLOCKED | MIG-0206,0401 | no unnecessary hydration |
| MIG-0403 | representative video/user/event SSG | BLOCKED | MIG-0402 | SEO/OGP parity |
| MIG-0404 | route-map generator | BLOCKED | MIG-0403 | aliases resolve same entity |
| MIG-0405 | visibility gateway | BLOCKED | MIG-0404 | fail-closed |
| MIG-0406 | Public CPU/build benchmark | BLOCKED | MIG-0405 | p99<5ms, 1102=0 |
| MIG-0407 | Phase 4 Gate | BLOCKED | MIG-0406 | Lead review |

---

# Phase 5 — Public migration

実route進捗は `ROUTE_MATRIX.md` を正本とする。

| ID | Task | State | Depends on | Acceptance |
| --- | --- | --- | --- | --- |
| MIG-0501 | fixed/static routes | BLOCKED | MIG-0407 | route parity/rollback |
| MIG-0502 | event routes | BLOCKED | MIG-0501 | route parity/visibility |
| MIG-0503 | groups routes | BLOCKED | MIG-0501 | route parity |
| MIG-0504 | user routes | BLOCKED | MIG-0501 | route parity/visibility |
| MIG-0505 | list/search/recommend | BLOCKED | MIG-0501 | functional parity |
| MIG-0506 | root/top | BLOCKED | MIG-0505 | shelf/data parity |
| MIG-0507 | `/:id` video catch-all | BLOCKED | MIG-0502..0506 | aliases/SEO/visibility |
| MIG-0508 | Phase 5 Gate | BLOCKED | MIG-0507 | public migration complete |

---

# Phase 6 — Hono API

実endpoint進捗は `API_MATRIX.md` を正本とする。

| ID | Task | State | Depends on | Acceptance |
| --- | --- | --- | --- | --- |
| MIG-0601 | low-risk read endpoints | BLOCKED | MIG-0307,0107 | contract parity |
| MIG-0602 | low-risk mutations | BLOCKED | MIG-0601 | permission/audit/queue parity |
| MIG-0603 | video APIs | BLOCKED | MIG-0602 | API_MATRIX complete |
| MIG-0604 | event/slot APIs | BLOCKED | MIG-0602 | API_MATRIX complete |
| MIG-0605 | user/X/admin APIs | BLOCKED | MIG-0602 | API_MATRIX complete |
| MIG-0606 | CPU benchmark | BLOCKED | MIG-0603..0605 | target budget/1102=0 |
| MIG-0607 | Phase 6 Gate | BLOCKED | MIG-0606 | Lead review |

---

# Phase 7 — Private SPA

| ID | Task | State | Depends on | Acceptance |
| --- | --- | --- | --- | --- |
| MIG-0701 | dashboard read-only | BLOCKED | MIG-0206,0601 | auth/read parity |
| MIG-0702 | dashboard mutations | BLOCKED | MIG-0602,0701 | mutation parity |
| MIG-0703 | entry | BLOCKED | MIG-0702 | workflow parity |
| MIG-0704 | manage | BLOCKED | MIG-0604,0703 | permission/workflow parity |
| MIG-0705 | admin | BLOCKED | MIG-0605,0704 | admin parity |
| MIG-0706 | Phase 7 Gate | BLOCKED | MIG-0705 | SPA functional parity |

---

# Phase 8 — Auth

| ID | Task | State | Depends on | Acceptance |
| --- | --- | --- | --- | --- |
| MIG-0801 | existing Auth contract fixture/test固定 | BLOCKED | MIG-0006 | baseline reusable |
| MIG-0802 | Web Standard/Auth integration PoC | BLOCKED | MIG-0801,0607 | session/account parity |
| MIG-0803 | Discord/account-linking parity | BLOCKED | MIG-0802 | no account regression |
| MIG-0804 | auth CPU/security review | BLOCKED | MIG-0803 | Free CPU/security gate |
| MIG-0805 | production auth cutover proposal | BLOCKED | MIG-0804 | explicit approval required |
| MIG-0806 | Phase 8 Gate | BLOCKED | MIG-0805 | Lead review/cutover complete |

---

# Phase 9 — Next/OpenNext retirement

| ID | Task | State | Depends on | Acceptance |
| --- | --- | --- | --- | --- |
| MIG-0901 | residual Next/OpenNext dependency inventory | BLOCKED | MIG-0508,0607,0706,0806 | removal list complete |
| MIG-0902 | rollback observation window | BLOCKED | MIG-0901 | production stable |
| MIG-0903 | remove legacy Server Actions/routes | BLOCKED | MIG-0902 | no consumers |
| MIG-0904 | remove OpenNext/Next deployment path | BLOCKED | MIG-0903 | build/deploy green |
| MIG-0905 | docs final architecture consolidation | BLOCKED | MIG-0904 | migration docs archive ready |
| MIG-0906 | Final Gate | BLOCKED | MIG-0905 | migration DONE |

---

# Current task detail

## MIG-0001 — migration docs / command / progress framework

State: `READY`

Scope:

- `AGENTS.md` migration awareness
- `docs/AI_CONTEXT.md` migration routing
- `docs/migration/README.md`
- this `STATUS.md`
- `ROUTE_MATRIX.md`
- `API_MATRIX.md`
- `.claude/commands/flamenode-migration.md`
- docs index updates

Acceptance:

- docs references are non-cyclic and clear
- `/flamenode-migration` can select exactly one task
- `/loop` repeated invocation cannot skip STATUS update
- progress is recoverable from repository alone
- no production code/config/Cloudflare mutation
- `check:docs` / `check:project-docs` pass or failures are documented

Rollback:

- revert documentation/command PR only
- production runtime unaffected

## Last iteration

```text
Task: none
Result: not started
Validation: not run
PR: none
Blockers: none
```

## Next READY

```text
MIG-0001
```
