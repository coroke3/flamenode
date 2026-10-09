# FlameNode Platform Migration

> Status: Active / migration architecture source of truth
> Last verified: 2026-10-07
> Progress: [`STATUS.md`](STATUS.md)
> Execution: [`AGENT_PROTOCOL.md`](AGENT_PROTOCOL.md)
> One-MIG implementation: [`IMPLEMENTATION_RUNBOOK.md`](IMPLEMENTATION_RUNBOOK.md), [`TASK_CARDS_2_3.md`](TASK_CARDS_2_3.md), [`TASK_CARDS_4_5.md`](TASK_CARDS_4_5.md), [`TASK_CARDS_6_7.md`](TASK_CARDS_6_7.md), [`TASK_CARDS_8_9.md`](TASK_CARDS_8_9.md)
> Small-model acceptance: [`SMALL_MODEL_SMOKE_TEST.md`](SMALL_MODEL_SMOKE_TEST.md) / [`TASK_MICRO_UNITS.md`](TASK_MICRO_UNITS.md)（大型MIGを複数wakeへ分割）
> Git workflow: [`GIT_WORKFLOW.md`](GIT_WORKFLOW.md)
> Current routes: [`CURRENT_ROUTES.md`](CURRENT_ROUTES.md)
> 全既存機能一覧: [`FEATURE_CATALOG.md`](FEATURE_CATALOG.md)
> Frontend parity: [`FRONTEND_FEATURES.md`](FRONTEND_FEATURES.md)
> CURRENT screen mapping: [`screen-mapping/README.md`](screen-mapping/README.md)
> Backend parity: [`FUNCTION_INVENTORY.md`](FUNCTION_INVENTORY.md)
> Requirement reconciliation: [`PRODUCT_REQUIREMENTS.md`](PRODUCT_REQUIREMENTS.md)
> Code quality: [`CODE_QUALITY.md`](CODE_QUALITY.md)
> UI visual input: [`UI_REFERENCE.md`](UI_REFERENCE.md)
> Cloudflare CURRENT topology: [`cloudflare/TOPOLOGY.md`](cloudflare/TOPOLOGY.md)
> Cloudflare CURRENT performance baseline: [`cloudflare/PERFORMANCE_BASELINE.md`](cloudflare/PERFORMANCE_BASELINE.md)
> Auth / permission CURRENT baseline: [`auth/README.md`](auth/README.md)
> Queue / Cron / jobs CURRENT baseline: [`background-jobs/README.md`](background-jobs/README.md)
> Static/visibility CURRENT baseline: [`static-delivery/README.md`](static-delivery/README.md)
> Phase 1 詳細仕様 & デザイン戦略: [`PHASE_1_SPEC.md`](PHASE_1_SPEC.md)
> Phase 3 詳細仕様 (ドメイン抽出): [`PHASE_3_SPEC.md`](PHASE_3_SPEC.md)
> Phase 4 & 5 詳細仕様 (Astro SSG & Islands): [`PHASE_4_5_SPEC.md`](PHASE_4_5_SPEC.md)
> Phase 6 詳細仕様 (Hono API): [`PHASE_6_SPEC.md`](PHASE_6_SPEC.md)
> Phase 7 詳細仕様 (Private React SPA): [`PHASE_7_SPEC.md`](PHASE_7_SPEC.md)
> Phase 8 & 9 詳細仕様 (Auth & Retirement): [`PHASE_8_9_SPEC.md`](PHASE_8_9_SPEC.md)
> UI コンポーネント移行ガイド: [`UI_MIGRATION_GUIDE.md`](UI_MIGRATION_GUIDE.md)
> Active X データ移行計画: [`ACTIVE_X_MIGRATION_PLAN.md`](ACTIVE_X_MIGRATION_PLAN.md)
> 複数 Worker ルーティング & デプロイ計画: [`ROUTING_AND_DEPLOY_PLAN.md`](ROUTING_AND_DEPLOY_PLAN.md)
> 判断待ち事項正本: [`OPEN_DECISIONS.md`](OPEN_DECISIONS.md)

## Purpose

**実装導線：** `AGENTS.md`→`AGENT_PROTOCOL.md`→`STATUS.md`→`OPEN_DECISIONS.md`→`IMPLEMENTATION_RUNBOOK.md`→該当`TASK_CARDS_*`の1MIG→CURRENT code/test。Luna/Haikuはこの範囲を順次読み、全フェーズ文書を一括投入しない。D-08 HTML未提供のPhase2/4/5 visualはBLOCKED。

Next.js + OpenNext中心のCURRENT productionを、Cloudflare Workers FreeのCPU制約に耐え、既存機能を欠落させず、長期的に読みやすく保守しやすい構成へ段階移行する。

UIは全面的に作り直すが、visual redesignを既存機能の削除理由にしない。
新しいvisual targetは後日ユーザーが提供するHTML mockを入力とする。

### デザイン適用戦略（案A正式採用）
1. **公開画面（Phase 4/5: Astro SSG + React Islands）**: ユーザー提供の新 HTML mock を正本として適用。
2. **管理・マイページ・登録画面（Phase 7: React SPA）**: 現行 UI/コンポーネント資産（`packages/ui` へ抽出）を流用し、移行効率を最大化。
3. **Phase 順序の最適化**: UI/デザインに依存しない **Phase 3（ドメイン抽出: MIG-0301〜MIG-0307 + MIG-0308 packages/db分離）** は、Phase 2 の HTML モック提供を待たずに先行して着手可能とする。

### Active X 未連携ユーザーのインタラクション
- いいね・ブックマーク等の操作主体は Active X に分離する。
- 承認済み Active X を未所持の一般ログインユーザーが操作した場合、拒否せず「Active X 登録・連携モーダル」をオーバーレイ表示してクリエイター名義の登録を促す。

## Goals

- public閲覧からrequest-time SSRを原則排除する
- public→non-publicのfail-closed visibilityを維持する
- CURRENT `app/**/page.tsx` 90 route実装（74 visual / 9 compat redirect / 1 dev / 6 system）を分類・追跡する
- 初期432 `UX-*` frontend observable capabilitiesを追跡し、後続監査で不足分を追加する
- `FN-*` backend/domain/platform契約を別ledgerで追跡する
- UX/FNをmany-to-manyで結び、画面存在=機能存在と誤認しない
- existing design intentとCURRENT実装を照合し、矛盾を黙って消さない
- business logicをframeworkから分離する
- APIを明示的HTTP boundaryへ移す
- D1/R2/KV/Queueへの既存投資を再利用する
- Claude / Codex / Antigravityのどれでも同じ状態から継続可能にする
- `flamenode.net` のURL体系を原則維持する
- route単位でcutover/rollback可能にする
- experienced production engineerが見ても違和感のない、明確で可読性の高いコードを維持する

## Non-goals

- D1/R2/KV/Queueを移行のためだけに置換する
- authをUI/frameworkと同時に全面刷新する
- 独自SSG / Islands runtime / router / cache frameworkを作る
- UI redesignを理由に既存機能を暗黙削除する
- URL/SEO URLを不要に変更する
- code line reductionをKPIにする
- Big Bang rewrite
- productionを一度に切り替える

---

# 1. Source-of-truth model

```text
CURRENT behavior
  code / tests / config / schema / actual Cloudflare settings

CURRENT Cloudflare platform topology
  cloudflare/TOPOLOGY.md

CURRENT measured CPU / 1102 / request evidence
  cloudflare/PERFORMANCE_BASELINE.md

CURRENT auth/session/identity/permission evidence
  auth/README.md

CURRENT Queue / Cron / background job evidence
  background-jobs/README.md

CURRENT static artifact / visibility delivery contract
  static-delivery/README.md

CURRENT route implementation / classification
  CURRENT_ROUTES.md

Human-readable complete capability catalog
  FEATURE_CATALOG.md

Frontend observable behavior
  FRONTEND_FEATURES.md
  screen-mapping/README.md
  frontend/*.md
  UX-* IDs

Backend/domain/platform behavior
  FUNCTION_INVENTORY.md
  functions/*.md
  FN-* IDs

Existing design / product intent
  PRODUCT_REQUIREMENTS.md

New visual target
  UI_REFERENCE.md
  currently PENDING_HTML

Progress
  STATUS.md
```

`UX-*`と`FN-*`は1:1ではない。

- 1 UX capabilityが複数FN/API/jobを利用してよい
- 1 FNが複数UXを支えてよい

これにより、backend単位の粗い一覧だけでfrontend機能漏れを見逃さない。

## UI source rule

`docs/design-redesign/`は廃止し、移行入力として使用しない。
`app/(redesign)`もTARGET visual designの正本ではない。

`UI_REFERENCE.md = PENDING_HTML`の間は:

- CURRENT capability/route/permission/state棚卸しを継続する
- visual designをagentが独自確定しない
- Phase 2 visual completionを開かない

HTML mock受領後:

1. reference/version/hashを`UI_REFERENCE.md`へ登録
2. mock surfaceを`CURRENT_ROUTES.md`へmapping
3. required `UX-*`を各surfaceへmapping
4. mockに見えないCURRENT機能も配置方針を決める
5. loading/empty/error/forbidden/pending/degraded/destructive stateを補完
6. responsive/a11y/history semanticsを補完
7. product behavior差は別途承認する

HTML mockだけではpermission/business/visibility/data/API/audit/notification/retry/URL semanticsを変更しない。

---

# 2. CURRENT

```text
Browser
  |
flamenode.net / www.flamenode.net
  |
flamenode-web
Next.js + OpenNext + Workers Static Assets
  |
D1 / R2 / KV / Queue

Background:
- flamenode-fast-jobs
- flamenode-content-jobs
- flamenode-sync-jobs
```

CURRENTは移行完了までrollback targetとして残す。

原則維持する既存資産:

- D1 canonical model
- Drizzle schema / migrations
- R2 public/static projections
- KV cache/delivery state
- static rebuild Queue / artifacts
- visibility fence / repair
- audit / restore
- permission / owner model
- fast/content/sync Workers
- current public DTO contracts
- current Auth.js behavior until auth phase
- current URLs/query/deep-link semantics unless explicitly changed

---

# 3. TARGET

```text
                         flamenode.net
                              |
                    Cloudflare routing
                              |
             +----------------+----------------+
             |                                 |
          Public                          Private / API
             |                                 |
       flamenode-site                 flamenode-personal / flamenode-ops / api
             |                                 |
 thin visibility gateway             React/Vite + Hono
             |                                 |
      Astro Static Assets                     |
             |                                 |
             +---------------+-----------------+
                             |
                       D1 / R2 / KV
                             |
                           Queues
                             |
            +----------------+----------------+
            |                |                |
        fast-jobs       content-jobs       sync-jobs
```

## Public（公開閲覧画面）

- Astro による静的アセット出力 / SSG
- React 統合（React Islands による動的対話機能の提供）
- クライアント対話性が必要な部分のみ React Islands で実行
- リクエスト時 SSR は原則禁止（デフォルト不可）
- HTML 生成はビルド時（または非同期生成時）に集中

## Private UI（管理・マイページ・登録画面）

- React + Vite による**2 SPA（Personal: `apps/app`, Ops: `+apps/ops`）**
- Personalは `/dashboard`, `/entry`, `/onboarding`、Opsは `/manage`, `/admin` を専有し、別ビルド/Worker/アセットを使用
- React Router による各SPA内のクライアントサイドルーティング。SPA間は普通のHTTP navigation
- TanStack Query 等は必要なサーバー状態管理に限定
- dashboard / entry / manage / admin 等の管理・編集画面は SSR しない

## API

- Hono
- 共有 Zod スキーマによる型安全な入出力契約
- 同期的な HTTP レスポンス内の処理量は有界（軽量・短時間）に制限
- 重い生成処理・集約・同期処理は Queue / バックグラウンド Worker へ委譲

## Data / jobs（データおよび非同期ジョブ）

- D1: 正本データベース（Canonical DB）
- R2: 公開プロジェクション／静的アセット配信層
- KV: 適切な範囲での一時キャッシュ／状態保持
- Queue: バックグラウンド非同期処理
- 既存のバックグラウンド Worker 分割（fast-jobs / content-jobs / sync-jobs）を原則維持

---

# 4. Non-negotiable migration invariants

- ownerを0人にしない
- authzをUIだけに置かない
- public APIはexplicit DTOのみ
- private dataをpublic projection/build snapshotへ出さない
- visibility fail-closedを弱めない
- auditを失わない
- Queue retry/idempotencyを弱めない
- Remote D1 migrationを自動適用しない
- current URL/canonical/query semanticsを不用意に変えない
- compatibility bridgeの削除条件を明記する
- required UX/FN inventoryに未監査項目がある状態でmigration完了にしない
- frontend behavior変更を最適化に紛れ込ませない
- code qualityを「とりあえず動く」水準へ落とさない

---

# 5. Existing design / product requirements

`PRODUCT_REQUIREMENTS.md`に従う。

CURRENTと既存設計の関係:

```text
CURRENT code/test/config
  = 実際に何が動いているか

active design/operations docs
  = 何を意図していたか / 未実装要件がないか
```

矛盾時:

- `CURRENT_DIVERGENCE`として記録
- old designへ黙って戻さない
- CURRENT divergenceも黙って正当化しない
- UX/permission/data/side-effect impactを比較
- improvement候補は明示する
- frontend-visible changeは明示承認までCURRENT behavior維持

---

# 6. Code quality

`CODE_QUALITY.md`は全migration implementationに必須。

重要原則:

```text
correctness / parity
> safety / integrity
> operational reliability
> readability / maintainability
> reuse
> code volume
```

要求:

- domain vocabularyが明確
- module responsibilityがcoherent
- framework adapterが薄い
- domain logicはframework-neutralを優先
- permission/visibility/transaction/audit/post-commit effectsが読める
- typed contracts + boundary validation
- expected domain errorsとinfra errorsを分ける
- mega helper / god service / flag-heavy generic CRUDを避ける
- hidden side effectを作らない
- behavior/invariantをtestsで固定する
- CPU/I/O最適化は計測可能にする

「美しいコード」は短いコードではなく、局所的に意味を理解でき、変更時の影響範囲が読めるコード。

---

# 7. Same-domain routing / Strangler migration

外部URLは同じ `flamenode.net` を維持する。

```text
flamenode.net
  |
path-specific Worker Routes
  |-- migrated path -> new Worker
  `-- no match       -> CURRENT flamenode-web Custom Domain
```

最終ownership概念:

```text
/api/<migrated path> -> flamenode-api
/api/auth/*   -> CURRENT Auth.js until Phase 8
/api/others   -> CURRENT until individually migrated
/auth/*       -> auth phaseで確定
/dashboard/*  -> flamenode-personal (apps/app)
/entry/*      -> flamenode-personal (apps/app)
/onboarding   -> flamenode-personal (apps/app)
/manage/*     -> flamenode-ops (+apps/ops)
/admin/*      -> flamenode-ops (+apps/ops)
/*            -> flamenode-site
```

Rules:

- route patternはcutover直前に実Cloudflare設定を再確認
- specific routeから移す
- root-level `/:id` catch-allはPublic migration最後
- Worker Routeを外せばCURRENTへ戻るrollbackを維持
- code landingとtraffic switchingを分離
- production route変更は明示承認時のみ

---

# 8. Public delivery

原則:

```text
Static Asset SSG first
R2 pre-generated HTML second when asset quota would be exceeded
Limited SSR by exception only after measured CPU/1102 gate
```

Public requestで避ける:

- React SSR/RSC generation
- D1-heavy projection
- large JSON transform
- build/rebuild
- image transformation proxy
- heavy aggregation

## Visibility gateway

Publicを完全Workerlessにはしない。
古いstatic HTMLが残ってもpublic→privateを即時blockするCURRENT guaranteeを維持するため。

Gateway責務:

1. pathname → entity identity解決
2. visibility state確認
3. blocked/unknownならfail closed
4. allowedならStatic Asset配信

リクエスト時HTML生成は禁止（R2に事前生成済みHTMLを読むことは可）。

## Route map

Astro build時にalias→canonical entity mapを生成する。
Gatewayでalias解決のために重いD1 lookupを行わない。

PoC CPU target:

- p50 < 1.5ms
- p95 < 3ms
- p99 < 5ms
- 1102 = 0

閾値未達なら原因を分析し、gateを都合よく緩めない。

---

# 9. Astro / React boundary

Astro責務:

- route generation
- SSG
- HTML/head/SEO/OGP
- asset bundling
- React component integration
- Islands orchestration

Astroへbusiness logicを置かない。

SSGへ入れるstable public content例:

- title / creator / description
- music / credit
- event metadata
- thumbnail / canonical / SEO / OGP
- stable public chapters/content
- first paintに有効なinitial lists

Island/APIへ残すdynamic content例:

- login/session state
- like/save
- view tracking/count
- viewer/private overlay
- live slot count/state
- high-frequency trending
- authenticated/private data
- mutations
- polling/WebSocket candidate

高頻度値だけの変更でsite rebuildを起こさない。

---

# 10. Public build data

Astro buildからD1 projectionを再実装しない。

```text
D1
 |
existing static rebuild Queue
 |
content-jobs
 |
safe public projections
 |
private R2 build snapshot
 |
Astro build
```

Build inputはread-only / least privilegeにする。

Conceptual generation state:

```text
desired_generation
snapshot_generation
building_generation
deployed_generation
dirty_since
last_triggered_at
last_deployed_at
build_id
last_error
```

- change -> desired++
- coalesce
- snapshot ready -> site build trigger
- build中更新はdesiredへ蓄積
- completion時 deployed < desiredなら再build

Code BuildとContent Buildを分離する。
content更新でfast/sync Workerを再deployしない。

---

# 11. Private SPA / shared UI

**D-05決定：Personal/Opsの2SPAへ分割**。`apps/app`はPersonal（`/_personal_assets/*`）、Phase7で`+apps/ops`を追加してOps（`/_ops_assets/*`）を担当。Cloudflare Routeと独立Worker/static assetsを分ける。共通UIは`packages/ui`で共有し、認可はAPIで再検証。root URLは変更しない。

対象:

- `/dashboard`
- `/entry`
- `/manage`
- `/admin`
- SEO不要なprivate/system surfaces

Rules:

- Static SPA shell
- Hono API経由でdata/mutation
- server-side authz再検証
- private dataをpublic buildへ流さない
- direct URL/reload/back-forwardをacceptanceに含める

Target shared UI:

```text
packages/ui/
  primitives/
  typography/
  navigation/
  forms/
  feedback/
  data-display/
  video/
  event/
  user/
```

`packages/ui`では原則禁止:

- Next routing imports
- Server Actions
- Hono/Astro imports
- direct D1/R2 access

Visual tokens/componentsはHTML mock受領後に確定する。
それ以前に旧redesign proposalを転用しない。

---

# 12. API / domain migration

Server ActionをHonoへ機械copyしない。

```text
CURRENT Server Action / Route Handler
            |
            v
framework-neutral domain service
            ^
            |
     +------+------+
     |             |
legacy Next     Hono route
```

`packages/domain`で原則禁止:

- Next/Astro/Hono framework imports
- `"use server"`
- `revalidatePath`
- framework request/cookie/navigation APIs
- browser APIs

`packages/contracts`:

- Zod input/output
- explicit error contracts
- domain-scoped shared types

Mutation parityはDBだけで判断しない。

確認対象:

- permission
- DB writes
- transaction boundary
- audit
- Queue
- R2/KV
- notifications/external effects
- client-visible refresh/pending semantics

Exact dispositionは `API_MATRIX.md`。

---

# 13. Auth

**D-07決定：Auth.jsのDBセッションをWorkers上でも継続**。互換PoC成功まで旧Auth.jsを維持する。

Auth migrationは後段。
それまではCURRENT Auth.js behaviorを維持する。

必須parity:

- Discord OAuth
- existing users/accounts/sessions
- custom account linking
- banned/role/active-X behavior
- origin/callback behavior
- logout/login
- permission integration
- CPU/security
- rollback

自前auth protocolを新規実装しない。

---

# 14. Media / upload

- public requestで画像変換proxyを原則行わない
- static/R2/direct deliveryを優先
- transformationが必要ならbackground artifact化を優先
- large upload bodyをAPI Workerでbufferしない
- permission/authorization後にdirect-to-R2 uploadを優先

---

# 15. Migration phases

進捗・task ID・ownerは `STATUS.md` が正本。

## Phase 0 — Baseline / inventory

- `MIG-0001` multi-agent migration framework
- `MIG-0002` CURRENT route + frontend UX baseline
- `MIG-0003` Server Action inventory
- `MIG-0004` Route Handler/API inventory
- `MIG-0005` Cloudflare topology/bindings/jobs
- `MIG-0006` CPU/1102/request baseline
- `MIG-0007` static artifact/visibility baseline
- `MIG-0008` auth/session/permission baseline
- `MIG-0009` background Queue/Cron/job inventory
- `MIG-0010` 86 CURRENT screens + cross-route shells → UX/FN mapping
- `MIG-0011` inventory consolidation / gap scan / requirement reconciliation / optimization assessment
- `MIG-0012` Phase 0 Gate

Phase 0 Gate:

- all required CURRENT UX/FN inventoried
- all 86 CURRENT screens mapped to required UX/FN
- all Server Actions/inline actions disposed
- all Route Handler methods disposed
- all background jobs disposed
- Cloudflare baseline fixed
- CPU/1102 baseline fixed
- visibility/auth guarantees fixed
- unresolved `CURRENT_DIVERGENCE` affecting migration = 0
- `REQUIREMENT_ONLY` without disposition = 0
- optimization blocker without frontend impact disposition = 0
- rollback target fixed
- production behavior unchanged by baseline work

## Phase 1 — Repository boundaries

タスク別詳細仕様・作成ファイル・コード例: [`PHASE_1_SPEC.md`](PHASE_1_SPEC.md)

Create only required boundaries:

```text
apps/site
apps/app
apps/api
packages/ui
packages/domain
packages/contracts
packages/public-data
```

Do not move CURRENT tree wholesale.

## Phase 2 — Design system / HTML mock integration

Phase 2 visual work remains blocked while `UI_REFERENCE.md = PENDING_HTML`.

After HTML mock registration:

1. visual/IA extraction
2. tokens
3. primitives
4. navigation/layout
5. forms/feedback/data-display
6. representative responsive screens
7. UX capability coverage verification

Gate:

- HTML target mapped
- responsive/a11y complete
- required UX/FN coverage complete
- no silent feature deletion

## Phase 3 — Domain extraction

Extract framework-neutral business logic while CURRENT path still calls the same services.

Gate: D-01=Aに基づくMIG-0308 (`packages/db` schema extraction)を先行し、ゼロDDL/循環なし/Next+Hono互換の検証後、behavior / permission / DB / transaction / audit / Queue parity + code-quality review.

## Phase 4 — Public PoC

Representative:

- fixed/static page
- video
- user
- event
- React Island
- route map
- visibility gateway

Gate: SSG files/versionの実測とQuota超過時R2事前HTMLの配信計画、no request-time SSR by default、fail-closed、SEO/OGP parity、CPU/1102/build targets、affected UX/FN parity.

## Phase 5 — Public migration

Order:

1. fixed/static
2. events
3. groups
4. users
5. list/search/recommend/trending
6. root/top
7. `/:id` catch-all last

## Phase 6 — Hono API

Order: low-risk reads → low-risk mutations → video → event/slot → user/X/admin → benchmark/gate.

## Phase 7 — Private SPA

Order: Personal SPA（dashboard reads → dashboard mutations → entry）→ Ops SPAの独立scaffold → manage → admin。2SPAのdeep-link/asset/cookie/権限をPhase7 Gateで検証。

Screen DONE requires associated UX/FN parity verified.

## Phase 8 — Auth

Compatibility PoC and explicit production cutover proposal only after previous boundaries are stable.

## Phase 9 — Next/OpenNext retirement

Only after:

- all production routes disposed
- no required legacy actions/routes remain
- auth cutover complete
- observation/rollback window complete
- CPU/1102 stable
- docs consolidated

Legacy removal is separate from migration implementation PRs.

---

# 16. Acceptance gates

## Public

- request-time SSR = 0 by default
- fail-closed visibility
- alias correctness
- SEO/canonical/OGP parity
- static HTML delivery
- gateway CPU target met
- 1102 = 0

## API

Initial CPU targets:

- simple reads p95 < 5ms
- normal mutations p95 < 8ms
- auth-heavy p95 < 9ms
- 1102 = 0

Use real Cloudflare metrics for production gates.

## Build

Initial PoC targets:

- full Astro build < 60s ideal
- < 120s acceptable
- public content reflection < 90s target
- generation loss = 0
- Static Assets count with Free-tier headroom

If exceeded, analyze input/page count/build strategy before inventing custom SSG.

## UI / UX

- 86 CURRENT screen coverage maintained or explicitly dispositioned
- all required `UX-*` mapped
- desktop/tablet/mobile where applicable
- keyboard/focus/a11y where applicable
- loading/error/empty/forbidden/pending/degraded states
- permission/server effects parity
- URL/query/history/reload parity
- no feature deletion without explicit approval

## Code quality

- responsibilities coherent
- naming/domain vocabulary precise
- dependency direction explicit
- side effects/transaction boundaries visible
- no framework leakage into domain layer without justification
- no abstraction solely for LOC reduction
- tests cover important invariants
- performance implications understood

---

# 17. Rollback

Route migration:

- remove new Worker Route → CURRENT `flamenode-web`

API:

- keep legacy endpoint until client/new endpoint parity is stable

UI:

- retain old route during migration window when practical

DB:

- do not introduce destructive migration solely for framework migration

Auth:

- CURRENT auth remains rollback path until compatibility is proven

---

# 18. Document ownership

| Document | Owns |
| --- | --- |
| `README.md` | architecture / invariants / phases / gates |
| `AGENT_PROTOCOL.md` | Claude/Codex/Antigravity execution/loop contract |
| `GIT_WORKFLOW.md` | branch/PR/review/squash/merge rules |
| `STATUS.md` | current task/owner/progress/blockers |
| `CURRENT_ROUTES.md` | CURRENT user-visible route/screen inventory |
| `FRONTEND_FEATURES.md` + `frontend/*.md` | frontend observable `UX-*` capabilities |
| `screen-mapping/README.md` | 86 CURRENT screens + cross-route shells → UX/FN/permission/state/query/RA mapping |
| `FUNCTION_INVENTORY.md` + `functions/*.md` | backend/domain/platform `FN-*` contracts |
| `PRODUCT_REQUIREMENTS.md` | CURRENT vs existing design/product intent reconciliation |
| `CODE_QUALITY.md` | professional implementation standard |
| `UI_REFERENCE.md` | user-provided HTML visual/IA source registration |
| `BACKEND_OPTIMIZATION.md` | commonization/optimization/blocker decisions |
| `cloudflare/TOPOLOGY.md` | verified CURRENT Worker/ingress/binding/resource/build-deploy topology |
| `cloudflare/PERFORMANCE_BASELINE.md` | measured CPU/resource-failure/request baseline + PoC budgets |
| `auth/README.md` | Auth.js/session/linking/terms/Active X/permission/owner CURRENT baseline |
| `background-jobs/README.md` | Queue/Cron/D1 work-state/retry/DLQ/recovery/idempotency CURRENT baseline |
| `static-delivery/README.md` | artifact families/aliases/visibility fences/fallback/repair CURRENT contract |
| `ROUTE_MATRIX.md` | route migration disposition |
| `API_MATRIX.md` | Server Action/Route Handler/API disposition |
| code/test/config | exact CURRENT implementation truth |

Do not duplicate rapidly changing implementation details across multiple Markdown files.
