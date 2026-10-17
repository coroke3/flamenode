# FlameNode Migration Status

> Status: Active / progress source of truth
> Last updated: 2026-10-17
> Architecture: [`README.md`](README.md)
> Execution: [`AGENT_PROTOCOL.md`](AGENT_PROTOCOL.md)
> Per-file progress: [`FILE_MIGRATION_MATRIX.md`](FILE_MIGRATION_MATRIX.md) / [`FILE_PROGRESS_PROTOCOL.md`](FILE_PROGRESS_PROTOCOL.md)
> Implementation: [`IMPLEMENTATION_RUNBOOK.md`](IMPLEMENTATION_RUNBOOK.md), [`TASK_MICRO_UNITS.md`](TASK_MICRO_UNITS.md), [`TASK_CARDS_2_3.md`](TASK_CARDS_2_3.md), [`TASK_CARDS_4_5.md`](TASK_CARDS_4_5.md), [`TASK_CARDS_6_7.md`](TASK_CARDS_6_7.md), [`TASK_CARDS_8_9.md`](TASK_CARDS_8_9.md)
> Git: [`GIT_WORKFLOW.md`](GIT_WORKFLOW.md)
> 全既存機能一覧: [`FEATURE_CATALOG.md`](FEATURE_CATALOG.md)
> Frontend parity: [`FRONTEND_FEATURES.md`](FRONTEND_FEATURES.md)
> Function parity: [`FUNCTION_INVENTORY.md`](FUNCTION_INVENTORY.md)
> 判断待ち事項正本: [`OPEN_DECISIONS.md`](OPEN_DECISIONS.md)

Claude / Codex / Antigravityが共有する**mainにmerge済みのtask/依存関係/Phase進捗正本**。open PRの進行中taskは各PR branchの`work-items/MIG-XXXX.md`をcheckpoint正本にする。chat historyやtool-local task listは正本にしない。

## Overall

```text
Current Phase: 2–4 parallel tracks (Phase 2 design system / Phase 3 domain / Phase 4 performance PoC)
Current Task: MIG-0302
Current Owner: unassigned
Task State: DONE
Overall State: IN_PROGRESS
Production Cutover: NOT STARTED
Last Completed Task: MIG-0302
Last Task PR: #308
Merged READY: MIG-0203, MIG-0204, MIG-0308, MIG-0405, MIG-0409, MIG-0608
Next: one unowned READY task per wake (AGENT_PROTOCOL.md Wake decision)
```

この節はmerge済み状態だけを表す。owner・Active PR・IN_PROGRESS/REVIEWのlive状態はGitHubのopen PRとそのbranchの`work-items/MIG-XXXX.md`で確認する（`npm run migration:next`がopen PR所有のtaskを除外して候補を出す）。

## State definitions

- `READY`: dependencies解消済み、writer未claim
- `IN_PROGRESS`: 1 agentがwriterとしてclaim中
- `REVIEW`: implementation/audit済み、独立review/検証待ち
- `BLOCKED`: dependency/approval/evidence不足
- `DONE`: acceptance + validation + progress更新済み
- `SKIPPED`: 例外。代替タスク・独立レビュー・ユーザー/Lead承認を明示。タスク表の外に `SKIP_APPROVAL: MIG-XXXX | PR#NNN | APPROVAL=<real reviewer/approval link> | ALTERNATIVE=<MIG-ID or rationale>` の1行を残す。CIが検証。承認無しのSKIPPEDで依存を解除しない

## Loop / handoff rules

- 1 iteration = exactly 1 MIG task
- 原則 1 task = 1 short-lived branch = 1 PR = 1 squash merge
- `READY → IN_PROGRESS → REVIEW → DONE` または `BLOCKED`
- 大型MIGは `TASK_MICRO_UNITS.md` に従い、同じDraft PRのbranch `work-items/MIG-XXXX.md`にowner/current unit/tests/next unitを残して `IN_PROGRESS`のまま次wakeへ継続可能。**チェックポイント無しの放置禁止**
- claim時にtask固有`work-items/MIG-XXXX.md`へOwner/branch/PR/affected UX/FNと対象ファイル/consumerを記録する。実装途中にSTATUSを変更しない
- 毎wakeのvalidation/rollback/evidence/next stateはtask固有work-itemへ記録する。独立review/CIの後、merge直前に最新mainとSTATUSを統合して当該MIG DONEと次READYを反映する。ファイルの状態はFILE_MIGRATION_MATRIXに残す
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
| New UI visual source | HTML mock registered | `UI_REFERENCE.md = READY (docs/migration/mock/)` | n/a | デザインモック受領済み。MIG-0201以降で抽出・実装可能 |

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

Phase 0 GateはMIG-0012でPASSED（未監査必須機能・UX/FN mapping・backend disposition・requirement reconciliation・optimization blocker assessmentの完了を確認済み）。

---

# Phase summary

| Phase | Name | State | Gate |
| --- | --- | --- | --- |
| 0 | Baseline / Inventory | DONE | PASSED |
| 1 | Repository boundaries | DONE | PASSED |
| 2 | Design System / HTML mock integration (公開画面用) | IN_PROGRESS (MIG-0201, MIG-0202 DONE / MIG-0203, MIG-0204 READY) | CLOSED |
| 3 | Domain extraction | READY | CLOSED |
| 4 | Public PoC: performance-first P0 + later visual | PARTIALLY_READY (MIG-0401, MIG-0404 DONE / MIG-0405, MIG-0409 READY) | CLOSED |
| 5 | Public migration | BLOCKED | CLOSED |
| 6 | Hono API | PARTIALLY_READY (MIG-0608 READY) | CLOSED |
| 7 | Private SPA (現行UI流用) | BLOCKED | CLOSED |
| 8 | Auth | IN_PROGRESS (MIG-0801 DONE / MIG-0802 BLOCKED) | CLOSED |
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
- [x] Phase 0 established `UI_REFERENCE.md = PENDING_HTML`; MIG-0200 subsequently registered the approved HTML. Current visual scope is in UI_REFERENCE.
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
- PR #249: Frontend 432 UX / route分類 / requirement reconciliation（移行資料内の92表記は最新sourceと相違し、2026-10-09に90へ訂正）
- PR #250: 人間向け全機能カタログ、agent protocol、STATUS、checkerの最終統合

統合後の確定事項:

- 432 UXは全件final disposition済み。
- 136 FNは全件final disposition済み。DETAIL_AUDIT_REQUIRED = 0。
- like / bookmark / save のTARGET所有主体はActive X。
- 性能/architecture最適化のためにfrontend product behavior変更が必須となるblockerは0。
- Active X interaction ownershipは性能都合ではなく、明示済みTARGET semantic requirement。
- `docs/design-redesign/` は存在せず、移行入力として使用しない。
- 新UIはユーザー提供HTML mockを `UI_REFERENCE.md` へ登録完了（MIG-0200 DONE、`READY`）。
- Cloudflare CURRENT production topologyはread-only再確認済み: `flamenode-web` + fast/content/sync jobs、root/www Custom Domain、`flamenode_db`、`flamenode-storage`、3 wake Queue + 3 DLQ。production mutationは0。
- GitHub Copilot reviewは要求したがquota超過で実レビューされなかったため、独立レビュー済みとは扱わない。
- 2026-10-07、ユーザーから「mainに合流」の明示指示を受けたため、これはPR #250のmergeに対するLead/human approvalとして記録する。
- 独立review gateの未達を隠さず、MIG-0012 Phase 0 Gateで改めて独立reviewを要求する。

Validation:
- UX canonical ledger ↔ FEATURE_CATALOG: 432/432、unique 432、missing 0、unknown 0。
- FN canonical ledger ↔ FEATURE_CATALOG: 136/136、unique 136、missing 0、unknown 0。
- FN final states: 131 CURRENT_VERIFIED / 2 CURRENT_DIVERGENCE / 2 MERGED_INTO_OTHER / 1 TARGET_REDESIGN_REQUIRED / DETAIL_AUDIT_REQUIRED 0。
- source `app/**/page.tsx` ↔ CURRENT_ROUTES: 90/90、missing 0。
- route classes: 74 VISUAL_SCREEN / 9 COMPAT_REDIRECT / 1 DEV_ONLY / 6 SYSTEM_SURFACE。
- `docs/design-redesign` tree entries: 0。
- Claude / Codex / Antigravity adapters: 全て `FEATURE_CATALOG.md` 参照済み。
- `scripts/check-migration-docs.mjs`: V8 syntax parse OK。catalog exact-set検査を追加。
- branch: current mainからbehind 0で作業、runtime/DB/Cloudflare production mutation 0。
- `.github/workflows/migration-docs-check.yml` を追加。GitHub Actions `Migration docs consistency` run #4 はsuccess。

---

# Phases 1–9

## Phase 1 — Repository boundaries

> タスク別詳細仕様書: [`PHASE_1_SPEC.md`](PHASE_1_SPEC.md)（Luna / Flash 等の軽量モデル向け完全仕様・コード例）

| ID | Task | State | Depends on |
| --- | --- | --- | --- |
| MIG-0101 | workspace/boundary PoC design | DONE | MIG-0012 |
| MIG-0102 | `packages/ui` skeleton | DONE | MIG-0101 |
| MIG-0103 | `packages/contracts` skeleton | DONE | MIG-0101 |
| MIG-0104 | `packages/domain` skeleton | DONE | MIG-0101 |
| MIG-0105 | `apps/site` Astro skeleton | DONE | MIG-0101 |
| MIG-0106 | `apps/app` React/Vite skeleton | DONE | MIG-0101 |
| MIG-0107 | `apps/api` Hono skeleton | DONE | MIG-0101 |
| MIG-0108 | Phase 1 Gate | DONE | MIG-0102..MIG-0107 |

## Phase 2 — Design System / HTML mock integration

> 2026-10-13: ユーザーより新HTMLモック一式を受領し、`docs/migration/mock/` へ配置および `UI_REFERENCE.md` への登録完了（MIG-0200 DONE）。MIG-0201 は PR #303 で DONE。MIG-0202 は PR #306 で DONE。MIG-0203 と MIG-0204 が READY。

> ※デザイン適用戦略（案A）に基づき、本Phaseは公開画面（Phase 4/5）の前提条件となります。
> UI/デザインに依存しない Phase 3（ドメイン抽出）は先行して着手可能です。

| ID | Task | State | Depends on |
| --- | --- | --- | --- |
| MIG-0200 | register user-provided HTML mock in `UI_REFERENCE.md` | DONE | user input |
| MIG-0201 | visual/IA extraction + design tokens | DONE | MIG-0108, MIG-0200 |
| MIG-0202 | primitives | DONE | MIG-0201 |
| MIG-0203 | navigation/layout | READY | MIG-0202 |
| MIG-0204 | forms/feedback/data-display | READY | MIG-0202 |
| MIG-0205 | representative responsive screens + UX mapping | BLOCKED | MIG-0203, MIG-0204 |
| MIG-0206 | Phase 2 Gate | BLOCKED | MIG-0205 |

## Phase 3 — Domain extraction

> タスク別詳細仕様書: [`PHASE_3_SPEC.md`](PHASE_3_SPEC.md) / [`DB_PACKAGE_EXTRACTION_PLAN.md`](DB_PACKAGE_EXTRACTION_PLAN.md)（D-01=A、MIG-0308をTier2の依存に追加）

| ID | Task | State | Depends on |
| --- | --- | --- | --- |
| MIG-0301 | extraction/DI pattern | DONE | MIG-0108 |
| MIG-0302 | low-risk read domain | DONE | MIG-0301 |
| MIG-0308 | `packages/db` schema extraction (zero DDL) | READY | MIG-0302 |
| MIG-0303 | low-risk mutation domain | BLOCKED | MIG-0308 |
| MIG-0304 | video domain group | BLOCKED | MIG-0303 |
| MIG-0305 | event/slot domain group | BLOCKED | MIG-0303 |
| MIG-0306 | user/X/admin domain group | BLOCKED | MIG-0303 |
| MIG-0307 | Phase 3 Gate | BLOCKED | MIG-0304..MIG-0306, MIG-0308 |

## Phase 4 — Public PoC

> **1102優先の2トラック (2026-10-09):** MIG-0401 → 0404 → 0405 → 0406 は既存projection/fixtureで実行可能、視覚系の **MIG-0402/0403と正式UI移行** はPhase 2 Gate（MIG-0206）の完了待ち（D-08はDECIDED、mock登録済み）。0405は実Gatewayの非本番PoCであり本番Worker Route変更を許可しない。0407 Phase Gateは0403+0406完了・独立レビュー・人間承認を要求する。性能がPASSでも視覚/UX受入を勝手にDONEへ進めない。
>
> **並行READY (2026-10-16):** MIG-0202 (Design system)、MIG-0301 (Domain)、MIG-0404 (Public route-map) は依存解決済みで別担当・別PRで進められる。MIG-0401 は PR #283 で DONE。各taskのWork OrderのModel/Readinessと全open PRのownershipを必ず再確認し、小型モデルは `READY_FOR_SMALL_MODEL` 以外をclaimしない。`Current Task`は別タスクの自動claimを許可しない。
>
> Performance measurement/protocol: [PERF_HOTPATH_MATRIX.md](PERF_HOTPATH_MATRIX.md) / [PERFORMANCE_IMPLEMENTATION_PLAN.md](PERFORMANCE_IMPLEMENTATION_PLAN.md) 。



> タスク別詳細仕様書: [`PHASE_4_5_SPEC.md`](PHASE_4_5_SPEC.md)（Astro SSG & Islands 詳細仕様）

| ID | Task | State | Depends on |
| --- | --- | --- | --- |
| MIG-0401 | Astro build-input / fixture perf PoC (no UI mock) | DONE | MIG-0105 |
| MIG-0402 | shared React UI in Astro | BLOCKED | MIG-0206, MIG-0401 |
| MIG-0403 | representative video/user/event SSG | BLOCKED | MIG-0402, MIG-0404 |
| MIG-0404 | route-map generator (mock-independent) | DONE | MIG-0401 |
| MIG-0405 | visibility gateway | READY | MIG-0404 |
| MIG-0406 | CPU/build benchmark | BLOCKED | MIG-0405 |
| MIG-0409 | build-time public data from D1 + build-minute budget (D-09) | READY | MIG-0404 |
| MIG-0410 | deploy-hook build scheduler Cron (B, D-09) | BLOCKED | MIG-0409 |
| MIG-0411 | per-page R2 HTML regeneration via Queue (ISR equivalent, D-09) | BLOCKED | MIG-0405, MIG-0409 |
| MIG-0407 | Phase 4 Gate: performance + visual evidence | BLOCKED | MIG-0403, MIG-0406, MIG-0410, MIG-0411 |

## Phase 5 — Public migration

> タスク別詳細仕様書: [`PHASE_4_5_SPEC.md`](PHASE_4_5_SPEC.md)（全公開ルート移行詳細仕様）

| ID | Task | State | Depends on |
| --- | --- | --- | --- |
| MIG-0501 | fixed/static routes | BLOCKED | MIG-0407 |
| MIG-0502 | event routes | BLOCKED | MIG-0501 |
| MIG-0503 | group routes | BLOCKED | MIG-0501 |
| MIG-0504 | user routes | BLOCKED | MIG-0501 |
| MIG-0505 | list/search/recommend/trending | BLOCKED | MIG-0501 |
| MIG-0506 | root/top | BLOCKED | MIG-0505 |
| MIG-0507 | `/:id` video catch-all | BLOCKED | MIG-0502..MIG-0506 |
| MIG-0509 | all public data generated at build time (D-09) | BLOCKED | MIG-0507 |
| MIG-0508 | Phase 5 Gate | BLOCKED | MIG-0509, MIG-0607 |

公開画面の like / 枠予約 / 規約同意 / Active X 切替は Server Action を直接呼ぶため、各ルートの本番切替は対応する Phase 6 API（MIG-0603/0604/0605/0608）の DONE 後に行う（[`PHASE_4_5_SPEC.md`](PHASE_4_5_SPEC.md) Phase 5 共通契約）。

## Phase 6 — Hono API

> タスク別詳細仕様書: [`PHASE_6_SPEC.md`](PHASE_6_SPEC.md)（Hono API 詳細仕様）

| ID | Task | State | Depends on |
| --- | --- | --- | --- |
| MIG-0601 | low-risk reads | BLOCKED | MIG-0307, MIG-0107 |
| MIG-0608 | Hono read-only session resolution (Auth.js DB session) | READY | MIG-0801, MIG-0107 |
| MIG-0602 | low-risk mutations | BLOCKED | MIG-0601, MIG-0608 |
| MIG-0603 | video APIs | BLOCKED | MIG-0602 |
| MIG-0604 | event/slot APIs | BLOCKED | MIG-0602 |
| MIG-0605 | user/X/admin APIs | BLOCKED | MIG-0602 |
| MIG-0606 | API CPU benchmark | BLOCKED | MIG-0603..MIG-0605 |
| MIG-0609 | background job CPU measurement (D-09) | BLOCKED | MIG-0606 |
| MIG-0610 | split background jobs under 8ms (D-09) | BLOCKED | MIG-0609 |
| MIG-0607 | Phase 6 Gate | BLOCKED | MIG-0606 |

MIG-0608 は Phase 8 の Auth.js 移行（MIG-0802 は MIG-0607 に依存）を待たずに、認証付き Hono API が旧 Next 発行の session cookie を読むための読み取り専用 task。cookie の発行・更新は Phase 8 まで旧 Next のまま。

## Phase 7 — Private SPA

> タスク別詳細仕様書: [`PHASE_7_SPEC.md`](PHASE_7_SPEC.md)（Private SPA 詳細仕様）
> ※デザイン適用戦略（案A）に基づき、管理画面・ダッシュボードは現行UI資産（`packages/ui`）を流用します。

| ID | Task | State | Depends on |
| --- | --- | --- | --- |
| MIG-0701 | dashboard read-only | BLOCKED | MIG-0102, MIG-0601, MIG-0608 |
| MIG-0702 | dashboard mutations | BLOCKED | MIG-0602, MIG-0605, MIG-0701 |
| MIG-0703 | entry | BLOCKED | MIG-0603, MIG-0604, MIG-0702 |
| MIG-0704 | manage | BLOCKED | MIG-0604, MIG-0703 |
| MIG-0705 | admin | BLOCKED | MIG-0605, MIG-0704 |
| MIG-0706 | Phase 7 Gate | BLOCKED | MIG-0705 |

## Phase 8 — Auth

> タスク別詳細仕様書: [`PHASE_8_9_SPEC.md`](PHASE_8_9_SPEC.md)（Auth 移行詳細仕様）

| ID | Task | State | Depends on |
| --- | --- | --- | --- |
| MIG-0801 | Auth baseline fixtures/tests | DONE | MIG-0008 |
| MIG-0802 | Web Standard/Auth integration PoC | BLOCKED | MIG-0801, MIG-0607 |
| MIG-0803 | Discord/account-linking parity | BLOCKED | MIG-0802 |
| MIG-0804 | CPU/security review | BLOCKED | MIG-0803 |
| MIG-0805 | production cutover proposal | BLOCKED | MIG-0804 |
| MIG-0806 | Phase 8 Gate | BLOCKED | MIG-0805 |

MIG-0805 requires explicit user approval before production action.

## Phase 9 — Next/OpenNext retirement

> タスク別詳細仕様書: [`PHASE_8_9_SPEC.md`](PHASE_8_9_SPEC.md)（Next.js 退役詳細仕様）

| ID | Task | State | Depends on |
| --- | --- | --- | --- |
| MIG-0901 | residual dependency inventory | BLOCKED | MIG-0508, MIG-0607, MIG-0706, MIG-0806 |
| MIG-0902 | rollback observation window | BLOCKED | MIG-0901 |
| MIG-0903 | remove legacy Server Actions/routes | BLOCKED | MIG-0902 |
| MIG-0904 | remove OpenNext/Next deploy path | BLOCKED | MIG-0903 |
| MIG-0907 | remove json-generator / static rebuild queue + G2 observation (D-09) | BLOCKED | MIG-0904, MIG-0610 |
| MIG-0905 | final architecture/docs consolidation | BLOCKED | MIG-0907 |
| MIG-0906 | Final Gate | BLOCKED | MIG-0905 |

---

# Completed task history

完了taskの詳細（変更・validation・rollback）は各PRと`work-items/MIG-XXXX.md`、およびgit履歴を正本とする。直近: MIG-0200（PR #284、HTML mock登録）、MIG-0108（PR #276、Phase 1 Gate）、MIG-0011/0012（Phase 0）。

<!-- MIG-0401 #283: synthetic-only public snapshot PoC integrated; no production deployment, routing, Remote D1 or secret changes. Independent review note: https://github.com/coroke3/flamenode/pull/283#pullrequestreview-5541888183 ; user authorized merge 2026-10-16. Latest pre-integration CI: https://github.com/coroke3/flamenode/actions/runs/38200639532. -->
