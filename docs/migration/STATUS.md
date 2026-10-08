# FlameNode Migration Status

> Status: Active / progress source of truth
> Last updated: 2026-10-07
> Architecture: [`README.md`](README.md)
> Execution: [`AGENT_PROTOCOL.md`](AGENT_PROTOCOL.md)
> Git: [`GIT_WORKFLOW.md`](GIT_WORKFLOW.md)
> 全既存機能一覧: [`FEATURE_CATALOG.md`](FEATURE_CATALOG.md)
> Frontend parity: [`FRONTEND_FEATURES.md`](FRONTEND_FEATURES.md)
> Function parity: [`FUNCTION_INVENTORY.md`](FUNCTION_INVENTORY.md)

Claude / Codex / Antigravityを含む全agentが共有する唯一の進捗正本。chat historyやtool-local task listを正本にしない。

## Overall

```text
Current Phase: 1 — Repository boundaries
Current Task: MIG-0105
Current Owner: unassigned
Task State: READY
Overall State: IN_PROGRESS
Production Cutover: NOT STARTED
Last Completed Task: MIG-0104
Last Task PR: #258
Active Task PR: none
Next: MIG-0105 apps/site Astro skeleton
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

| Surface | Baseline enumerated | Detailed audited / final disposition | Parity verified | Phase 0 target |
| --- | ---: | ---: | ---: | --- |
| CURRENT `app/**/page.tsx` routes | 90 | 90 classified: 74 VISUAL_SCREEN / 9 COMPAT_REDIRECT / 1 DEV_ONLY / 6 SYSTEM_SURFACE | n/a | source route分類漏れ 0 |
| Frontend `UX-*` capabilities | 432 | 405 CURRENT_VERIFIED / 6 CURRENT_DIVERGENCE / 17 MERGED_INTO_OTHER / 4 OBSOLETE | 0 | orphan/unverified/disposition漏れ 0 |
| UX Surface ownership | 170 distinct Surface tokens | 170 route/shell owner resolved | n/a | unresolved owner 0 |
| Backend/domain/platform `FN-*` | 136 | 131 CURRENT_VERIFIED / 2 CURRENT_DIVERGENCE / 2 MERGED_INTO_OTHER / 1 TARGET_REDESIGN_REQUIRED | 0 | DETAIL_AUDIT_REQUIRED 0 |
| Server Actions | 34 modules / 106 exports + 4 inline = 110 | 110 CURRENT_VERIFIED | 0 | all execution units disposed |
| Route Handler APIs | 28 route files / 33 methods | 33 CURRENT_VERIFIED | 0 | all `route.ts` methods disposed |
| CURRENT Worker scripts | 4 | 4 CURRENT_VERIFIED topology + CPU/request + Queue/Cron/job semantics | 0 | bindings/routes/jobs fixed |
| Human-readable full feature catalog | 432 UX + 136 FN | canonical ledgersとcheckerで一致確認対象 | n/a | catalog drift 0 |
| New UI visual source | HTML mock pending | `UI_REFERENCE.md = PENDING_HTML` | n/a | user HTML mock登録前にvisual targetを確定しない |

Current FN state summary:

```text
CURRENT_VERIFIED: 131
CURRENT_DIVERGENCE: 2
MERGED_INTO_OTHER: 2
TARGET_REDESIGN_REQUIRED: 1
DETAIL_AUDIT_REQUIRED: 0
PARITY_VERIFIED: 0
REMOVAL_PROPOSED: 0
REMOVED_APPROVED: 0
Total: 136
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

432は現在確認済みのCURRENT frontend baseline。以後コードから新たなobservable behaviorを発見した場合は、実装前にcanonical ledgerと `FEATURE_CATALOG.md` を同時更新する。
MIG-0011は全件disposition・統合validation済み。2026-10-07のユーザー明示指示により、独立レビュー未達を記録した上でmerge承認され `DONE` とする。独立レビュー要件自体はMIG-0012 Phase 0 Gateで再評価する。

Phase 0 Gateは、未監査必須機能・UX/FN mapping・backend disposition・requirement reconciliation・optimization blocker assessmentが残る限りCLOSED。

---

# Phase summary

| Phase | Name | State | Gate |
| --- | --- | --- | --- |
| 0 | Baseline / Inventory | DONE | PASSED |
| 1 | Repository boundaries | IN_PROGRESS | CLOSED |
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
| MIG-0002 | CURRENT route + frontend observable capability baseline | DONE | MIG-0001 | 当時の86 USER_SCREEN baseline、432 UX baseline、UX/FN split、HTML-input rule、Antigravity/Git/quality contract |
| MIG-0003 | Server Action / inline action baseline | DONE | MIG-0001 | all exported/inline actions, callers, input, authz, effects, tests, affected UX/FN, optimization observations |
| MIG-0004 | Route Handler / API baseline | DONE | MIG-0001 | all `route.ts` methods, contract/auth/effects/tests, affected UX/FN, duplication observations |
| MIG-0005 | Cloudflare Worker/domain/route/binding baseline | DONE | MIG-0001 | 4 Workers, Custom Domain, Routes, bindings, build/deploy topology |
| MIG-0006 | CPU / 1102 / request baseline | DONE | MIG-0005 | real Cloudflare metrics, hot/cold paths, representative budgets |
| MIG-0007 | static artifact / visibility baseline | DONE | MIG-0001 | artifact types, aliases, fail-closed guarantees, repair/fallback, affected UX/FN |
| MIG-0008 | Auth/session/permission baseline | DONE | MIG-0001 | login/session/linking/Active X/owner/permission contracts and gated UX |
| MIG-0009 | Queue/Cron/background job baseline | DONE | MIG-0005 | job types, Queue/DLQ, retry/recovery/side effects, user-visible async states |
| MIG-0010 | 当時の86 CURRENT screens + cross-route shells → UX/FN mapping | DONE | MIG-0002, MIG-0003, MIG-0004 | every screen mapped, all UX states, responsive/a11y/query/deep-link requirements |
| MIG-0011 | inventory consolidation / gap scan / requirement + optimization assessment | DONE | MIG-0003, MIG-0004, MIG-0007, MIG-0008, MIG-0009, MIG-0010 | unknown/orphan=0, design divergence disposed, duplicates resolved, blockers reported |
| MIG-0012 | Phase 0 Gate | DONE | MIG-0006, MIG-0011 | independent review, rollback baseline, all Phase 0 invariants satisfied |

## Phase 0 Gate

- [x] CURRENT 90 page routesを74 visual / 9 compat redirect / 1 dev / 6 systemへ分類
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
- [x] all 136 required FN functions CURRENT_VERIFIED or explicitly dispositioned
- [x] all CURRENT visual/compat/dev/system surfaces and shells mapped to required UX/FN IDs
- [x] all required UX capabilities have route/permission/backend/state dispositions
- [x] all background jobs/Queues/Cron inventoried
- [x] current Cloudflare topology fixed
- [x] CPU/1102 baseline fixed
- [x] visibility/static guarantees fully fixed
- [x] auth/permission guarantees fully fixed
- [x] `REQUIREMENT_ONLY` / `CURRENT_DIVERGENCE` affecting migration explicitly dispositioned（Active X TARGETを含む）
- [x] backend optimization candidates intentionally validated/rejected（27 OPT-BE dispositions）
- [x] every optimization blocker has concrete frontend-impact disposition（performance/architecture UX-change blocker = 0; Active Xは別のTARGET semantic requirement）
- [x] production behavior unchanged by baseline/inventory work
- [x] rollback target fixed: PR #250 base `4eccae2fb95beabc2fb0055cf405df8b2da1ffd4`; docs/checker-only squash commit can be reverted

---

# MIG-0011 最終統合状況

Frontend / Backend の分割監査は main に統合済み。

- PR #248: Backend 136 FN最終監査 / optimization disposition
- PR #249: Frontend 432 UX / 92 page route分類 / requirement reconciliation
- PR #250: 人間向け全機能カタログ、agent protocol、STATUS、checkerの最終統合

統合後の確定事項:

- 432 UXは全件final disposition済み。
- 136 FNは全件final disposition済み。DETAIL_AUDIT_REQUIRED = 0。
- like / bookmark / save のTARGET所有主体はActive X。
- 性能/architecture最適化のためにfrontend product behavior変更が必須となるblockerは0。
- Active X interaction ownershipは性能都合ではなく、明示済みTARGET semantic requirement。
- `docs/design-redesign/` は存在せず、移行入力として使用しない。
- 新UIはユーザー提供HTML mockを `UI_REFERENCE.md` へ登録するまで `PENDING_HTML`。
- Cloudflare CURRENT production topologyはread-only再確認済み: `flamenode-web` + fast/content/sync jobs、root/www Custom Domain、`flamenode_db`、`flamenode-storage`、3 wake Queue + 3 DLQ。production mutationは0。
- GitHub Copilot reviewは要求したがquota超過で実レビューされなかったため、独立レビュー済みとは扱わない。
- 2026-10-07、ユーザーから「mainに合流」の明示指示を受けたため、これはPR #250のmergeに対するLead/human approvalとして記録する。
- 独立review gateの未達を隠さず、MIG-0012 Phase 0 Gateで改めて独立reviewを要求する。

Validation:
- UX canonical ledger ↔ FEATURE_CATALOG: 432/432、unique 432、missing 0、unknown 0。
- FN canonical ledger ↔ FEATURE_CATALOG: 136/136、unique 136、missing 0、unknown 0。
- FN final states: 131 CURRENT_VERIFIED / 2 CURRENT_DIVERGENCE / 2 MERGED_INTO_OTHER / 1 TARGET_REDESIGN_REQUIRED / DETAIL_AUDIT_REQUIRED 0。
- source `app/**/page.tsx` ↔ CURRENT_ROUTES: 92/92、missing 0。
- route classes: 74 VISUAL_SCREEN / 9 COMPAT_REDIRECT / 3 DEV_ONLY / 6 SYSTEM_SURFACE。
- `docs/design-redesign` tree entries: 0。
- Claude / Codex / Antigravity adapters: 全て `FEATURE_CATALOG.md` 参照済み。
- `scripts/check-migration-docs.mjs`: V8 syntax parse OK。catalog exact-set検査を追加。
- branch: current mainからbehind 0で作業、runtime/DB/Cloudflare production mutation 0。
- `.github/workflows/migration-docs-check.yml` を追加。GitHub Actions `Migration docs consistency` run #4 はsuccess。

---

# Phases 1–9

Phase 1+ remains blocked until MIG-0012 unless a task is explicitly marked as safe preparatory work.

## Phase 1 — Repository boundaries

> タスク別詳細仕様書: [`PHASE_1_SPEC.md`](PHASE_1_SPEC.md)（Luna / Flash 等の軽量モデル向け完全仕様・コード例）

| ID | Task | State | Depends on |
| --- | --- | --- | --- |
| MIG-0101 | workspace/boundary PoC design | DONE | MIG-0012 |
| MIG-0102 | `packages/ui` skeleton | DONE | MIG-0101 |
| MIG-0103 | `packages/contracts` skeleton | DONE | MIG-0101 |
| MIG-0104 | `packages/domain` skeleton | DONE | MIG-0101 |
| MIG-0105 | `apps/site` Astro skeleton | READY | MIG-0101 |
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

## MIG-0010 — 86 CURRENT screens + cross-route shells → UX/FN mapping

```text
State: DONE
Owner: chatgpt
PR: #246
Production action required: no
Runtime behavior changed: no
```

Completed:

- 86 CURRENT USER_SCREENを全件route-local UX/FNへmapping
- 16 cross-route shellを定義
- 432 UX capabilitiesの170 distinct Surface tokenをCURRENT routeまたはshellへ完全解決
- screenごとに permission profile / dynamic-state profile / URL-query-history profile / responsive-a11y profile / TARGET render ownershipを固定
- public technical twin:
  - /list/~query -> Q-LIST(q,event,sort,page,view)
  - /user/~query -> Q-USER(q,sort,page)
  - /event/~query -> Q-EVENT(q,status,sort)
  - /user/[id]/paged -> Q-USER-PAGED(worksPage,collabPage)
  のlogical URL contractを固定
- searchParamsを読むCURRENT pageをQ-DIRECT扱いしないdrift ruleを追加
- error/global-error/not-found/robots/sitemapを86 screen外のglobal surfacesとしてshell mapping
- visual sourceはUI_REFERENCE=PENDING_HTMLのまま維持し、target layout/componentは捏造しない
- `screen-mapping/README.md` をROUTE_MATRIX / FRONTEND_FEATURES / architecture / shared protocol / Claude / Codex / Antigravity / checkerへ接続
- production runtime/Cloudflare/D1/R2/KV/Queue mutation 0

Validation evidence:

- CURRENT routes: 86
- screen mapping rows: 86
- UX capabilities: 432
- distinct UX Surface tokens: 170
- Surface resolution rows: 170
- cross-route shells: 16
- screen routes with no local UX: 0
- unresolved Surface tokens: 0
- unknown route/shell owners: 0
- malformed permission/state/query/RA rows: 0
- CURRENT page searchParams vs Q profile mismatches: 0
- migration checker JavaScript syntax parse: OK
- branch behind main=0 at final review
- GitHub status checks: none
- author self-review only; independent approval is not represented

Optimization conclusions:

- backend commonization may not erase screen-specific permission/state/query/deep-link contracts
- responsive/a11y requirements are migration contracts independent of future visual mock
- technical query twin routes may disappear only after logical URL replacement evidence exists
- frontend product-contract change required for current optimization candidates: 0

Rollback:

- revert PR #246 squash commit; production rollback action is unnecessary because MIG-0010 is documentation/checker-only


## MIG-0011 checkpoint merged before completion

- Progress saved in `gap-scan/CHECKPOINT.md`.
- MIG-0011 is **not DONE**; it is returned to READY/unassigned for safe handoff.
- Confirmed redirect-only route classification gaps must be reconciled before Phase 0 completion.
- Last completed task is MIG-0104 / packages/domain skeleton.

# Next task claim template

For MIG-0105 the writer records before work:

```text
Task: MIG-0105
Owner: unassigned
State: READY
Branch: feat/mig-0105-apps-site
PR: none
Scope: apps/site Astro skeleton, package.json, astro.config.mjs, static assets config
Evidence sources: PHASE_1_SPEC.md, README.md, CODE_QUALITY.md
Rollback: git revert
Production action required: no
```

MIG-0104 is DONE. MIG-0105 is READY to proceed.




