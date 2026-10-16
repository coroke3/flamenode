# FlameNode Phase 8 & 9 タスク仕様書（Auth Migration & Next.js Retirement Spec）

> 状態: Active / Phase 8 & 9 実行向け仕様書
> 最終検証: 2026-10-09（`auth/README.md` の認証ベースラインおよび `OPEN_DECISIONS.md` D-07 に基づき改定）
> 対象モデル: Claude / Codex / Antigravity / GPT-5.6-luna / Gemini Flash 等の全エージェント
> 関連ドキュメント: [`README.md`](README.md), [`STATUS.md`](STATUS.md), [`TASK_CARDS_8_9.md`](TASK_CARDS_8_9.md), [`auth/README.md`](auth/README.md), [`OPEN_DECISIONS.md`](OPEN_DECISIONS.md) (D-02, D-07)
>
> **実行の正本:** 個別MIGの手順・停止条件・検証は本仕様書の `### MIG-XXXX:` Work Order。[`TASK_CARDS_8_9.md`](TASK_CARDS_8_9.md) は概要索引、CURRENT code/tests は実挙動の正本、[`STATUS.md`](STATUS.md) はmainへ統合済み進捗の正本。`npm run migration:next` はWork Orderと対応カードを併記し、矛盾時はLead確認までSTOP。

---

# 1. Phase 8: Auth タスク別詳細仕様書

### 基本方針（D-07=A 決定済み）
`README.md` §13: 「自前 auth protocol を新規実装しない」。
Next.js 固有のラッパーから Web Standards 準拠の Auth.js（`@auth/core` 等）と既存 D1 database session アダプターを継続利用し、既存の `user`, `account`, `session` テーブルおよび Cookie 契約を 100% 維持する。移行時に全ユーザーが強制ログアウトされる事態を防止。D-07は設計決定済みだが、`@auth/core`/Adapter/Session/Cookie互換が非本番PoCで証明されるまではPhase 8本番切替を許可しない。

### MIG-0801: Auth baseline fixtures/tests
- **Model:** lead
- **Readiness:** NEEDS_REFINEMENT — 依存（MIG-0008）は DONE。lead が cookie 名・属性の実測方法（非本番 build で `Set-Cookie` を記録）を U01 に書き足したら着手可。認証は高リスクなので小型モデルに渡さない
- **Recipe:** R-TEST
- **Runtime:** N
- **Depends on:** MIG-0008 / **Decisions:** D-07 DECIDED
- **Verified against:** `aacf4fd` (2026-10-15)
#### Source snapshot
- `package.json`: `next-auth` `5.0.0-beta.32`, `@auth/drizzle-adapter` `1.11.3`。
- `src/lib/auth/index.ts:67` `session: { strategy: "database" }`。`:122` 以降で adapter を包み、`:184` `deleteSession`。
- `app/api/auth/[...nextauth]/route.ts`（RH-010 GET / RH-011 POST）、`app/(auth-complete)/auth/complete/page.tsx`。
- `src/lib/auth/accountLinkAdapter.ts:72` `linkDiscordAccountAtomically`（テスト `accountLinkAdapter.execution.test.mjs`）。
- テーブル: `src/lib/db/schema.base.ts:87` `session`（`user`, `account` も同ファイル）。
- 既存の認証テスト: `src/lib/auth/authFlowTrace.contract.test.mjs`, `runtimeAuth.contract.test.mjs`, `origin.test.mjs`, `routeApiSecurity.contract.test.mjs`（`test:critical` に含まれる）。
#### Owned paths
- 新規: `+src/lib/auth/authBaseline.fixture.mjs`, `+src/lib/auth/authBaseline.characterization.test.mjs`, `+docs/migration/auth/BASELINE_FIXTURES.md`
- 触らない: `src/lib/auth/index.ts` ほか認証の実装（挙動を固定するだけ）
#### Micro-units
- **U01 cookie**: 非本番 build でログイン・ログアウトの `Set-Cookie`（名前・`Secure`・`HttpOnly`・`SameSite`・`Path`・期限）を記録し、テストで固定する。実 token・secret は fixture に入れない。
- **U02 session**: 有効・期限切れ・削除済み session、BAN、X 0件/複数での利用者解決をテストで固定。
- **U03 linking**: `linkDiscordAccountAtomically` の重複・別利用者所有・再実行の結果を固定。
#### Test cases
| ID | 入力/操作 | 期待 |
| --- | --- | --- |
| T01 | 期限切れ session | 未ログイン扱い |
| T02 | 別利用者の Discord account を連携 | CURRENT と同じ拒否 |
| T03 | callback の不正 host / query | CURRENT と同じ拒否 |
| T04 | fixture の内容 | 実 token・secret を含まない |
#### Commands
```bash
node --test --experimental-strip-types src/lib/auth/authBaseline.characterization.test.mjs
npm run test:critical
npm run typecheck
```
#### Ledger updates
`FILE_MIGRATION_MATRIX.md` の `app/api/auth/[...nextauth]/route.ts` の evidence に baseline テストを記録（state は変えない）。
#### DONE checklist
- [ ] cookie 属性・session 解決・連携の挙動がテストで固定されている
- [ ] fixture に秘密情報が無い
#### STOP
- 本番の cookie や secret を読む必要が出たら止める。
- 認証の実装を変える必要が出たら止める（この task は固定だけ）。
#### Rollback
PRをrevert（テスト追加のみ）。

### MIG-0802: Web Standard/Auth integration PoC
- **Model:** lead
- **Readiness:** NEEDS_REFINEMENT — MIG-0801 と MIG-0607 の後。`@auth/core` と `next-auth@5.0.0-beta.32` の cookie・CSRF の互換を非本番で確かめる
- **Recipe:** R-API
- **Runtime:** S4
- **Depends on:** MIG-0801, MIG-0607 / **Decisions:** D-07 DECIDED
- **Verified against:** `aacf4fd` (2026-10-15)
#### Source snapshot
- MIG-0801 の baseline テスト、MIG-0608 の Hono session 読み取り（`apps/api/src/auth/session.ts`）。
- `app/api/auth/[...nextauth]/route.ts`, `app/(auth-complete)/auth/complete/page.tsx`（`FILE_MIGRATION_MATRIX.md` で MIG-0802 所有）。
#### Owned paths
- 新規: `+apps/api/src/auth/authjs.ts`（`@auth/core` を Hono の Request/Response に接続）, `+apps/api/src/routes/auth.ts`
- 触らない: 本番の Discord 設定、callback URL、secret
#### Micro-units
- **U01 adapter**: `@auth/core` を既存 D1 adapter・同じ cookie 名/属性で動かす。
- **U02 cross-runtime**: 旧 Next 発行の cookie を Hono で、Hono 発行の cookie を旧 Next で読む。logout も両方向。
- **U03 auth/complete**: `/auth/complete` の安全な遷移を Hono 側で再現。
#### Test cases
| ID | 入力/操作 | 期待 |
| --- | --- | --- |
| T01 | 旧 Next の cookie → Hono | 同じ利用者 |
| T02 | Hono の cookie → 旧 Next | 同じ利用者 |
| T03 | logout を片方で実行 | 両方で未ログイン |
| T04 | CSRF token 不一致 | 拒否 |
#### Commands
```bash
npm run build --workspace=@flamenode/api
node --test --experimental-strip-types src/lib/auth/authBaseline.characterization.test.mjs
npm run test:critical
```
#### Ledger updates
`FILE_MIGRATION_MATRIX.md` の auth 2行を IN_PROGRESS。
#### DONE checklist
- [ ] 2つの runtime で同じ session を相互に使える（非本番）
- [ ] 既存ログインを無効化しない
#### STOP
- 独自の OAuth code exchange や token 形式が必要に見えたら止める（D-07）。
- PoC が失敗したら BLOCKED にして旧 Worker を維持する。
#### Rollback
PRをrevert。本番の認証は旧 Next のまま。

### MIG-0803: Discord/account-linking parity
- **Model:** lead
- **Readiness:** NEEDS_REFINEMENT — MIG-0802 の後
- **Recipe:** R-API
- **Runtime:** S3, S4
- **Depends on:** MIG-0802 / **Decisions:** D-07 DECIDED
- **Verified against:** `aacf4fd` (2026-10-15)
#### Source snapshot
- `src/lib/auth/accountLinkAdapter.ts:72` `linkDiscordAccountAtomically`、`:50` `accountRowWithoutTokens`。
- X 連携申請・承認は SA-090/091, SA-099/100（`server-actions/README.md`）。
#### Owned paths
- 変更: `apps/api/src/auth/authjs.ts`（provider callback の reconciliation を既存関数で呼ぶ）
- 触らない: `src/lib/auth/accountLinkAdapter.ts` の意味
#### Micro-units
- **U01 callback**: user/account の照合と CAS を既存関数で行う。
- **U02 failures**: 状態 token 不正・replay・別利用者所有・BAN・規約未同意を安全な結果型で返す。
#### Test cases
| ID | 入力/操作 | 期待 |
| --- | --- | --- |
| T01 | 同時ログインと連携 | 重複 account が作られない |
| T02 | callback の replay | 拒否 |
| T03 | 規約未同意 | CURRENT と同じ遷移 |
#### Commands
```bash
node --test --experimental-strip-types src/lib/auth/accountLinkAdapter.execution.test.mjs
npm run test:critical
```
#### Ledger updates
`auth/README.md` の連携契約に Hono 側の場所を追記。
#### DONE checklist
- [ ] 旧/新の双方向で乗っ取り防止テストが PASS
- [ ] secret がログ・レスポンスに出ない
#### STOP
- 連携の意味を変える必要が出たら止める。
#### Rollback
PRをrevert。

### MIG-0804: CPU/security review
- **Model:** lead
- **Readiness:** NEEDS_REFINEMENT — MIG-0803 の後
- **Recipe:** R-EVIDENCE
- **Runtime:** N
- **Depends on:** MIG-0803 / **Decisions:** D-07 DECIDED
- **Verified against:** `aacf4fd` (2026-10-15)
#### Source snapshot
- 目標: `ZERO_1102.md` §3 の最大値。session 解決（S4）は 2ms 以内、それを含む API 全体は S2 < 7ms / S3 < 8ms。p95 は参考として記録する。
- 既存の安全なリダイレクト: `src/lib/auth/origin.ts`, `#utils/next` の `sanitizeNextPath`。
#### Owned paths
- 新規: `+docs/migration/auth/SECURITY_REVIEW.md`
- 変更: `apps/api/src/auth/**`（見つかった問題の修正のみ）
#### Micro-units
- **U01 measure**: request あたりの D1 query 数と CPU を非本番で測る。
- **U02 security**: cookie 改ざん、期限、CSRF、別 host、BAN の即時反映、open redirect、D1 失敗時の fail-closed を確認し文書化。
#### Test cases
| ID | 入力/操作 | 期待 |
| --- | --- | --- |
| T01 | `next=https://evil.example` | 拒否 |
| T02 | D1 失敗 | fail-closed |
| T03 | BAN 直後のリクエスト | 拒否 |
#### Commands
```bash
npm run test:critical
npm run build --workspace=@flamenode/api
npm run check:project-docs
```
#### Ledger updates
`SECURITY_REVIEW.md` を新規作成。
#### DONE checklist
- [ ] 測定値と条件が記録されている
- [ ] 高リスクの未解決差分が0件
- [ ] 独立レビューの APPROVE
#### STOP
- 認可結果や secret を cache に入れる設計になったら止める。
#### Rollback
PRをrevert。

### MIG-0805: production cutover proposal
- **Model:** lead
- **Readiness:** NEEDS_REFINEMENT — 手順書だけを作る task。本番の Route・Discord 設定の変更は別の明示承認
- **Recipe:** R-EVIDENCE
- **Runtime:** N
- **Depends on:** MIG-0804 / **Decisions:** D-02 DECIDED, D-07 DECIDED
- **Verified against:** `aacf4fd` (2026-10-15)
#### Source snapshot
- 現在の本番 Worker: `wrangler.toml:1,3`（`name = "flamenode-web"`, `main = ".open-next/worker.js"`）。
- callback URL は同一 origin（`https://flamenode.net/api/auth/callback/discord`）を維持する（本仕様 MIG-0805 目的）。
- 切替手順の枠組み: `ROUTING_AND_DEPLOY_PLAN.md`, `cloudflare/TOPOLOGY.md`。
#### Owned paths
- 新規: `+docs/migration/auth/CUTOVER_PROPOSAL.md`
- 触らない: `wrangler.toml`, Cloudflare の Route、Discord の設定、secret
#### Micro-units
- **U01 proposal**: 切替前・中・後の `/api/auth/*` と `/auth/complete` の経路、session の継続、監視の閾値、戻し方、承認者を書く。
- **U02 rehearsal**: 非本番で切替と戻しを1回ずつ行い、結果を記録。
#### Test cases
| ID | 入力/操作 | 期待 |
| --- | --- | --- |
| T01 | 非本番で切替 | ログイン中の利用者が再ログイン不要 |
| T02 | 非本番で戻し | 旧 Worker で継続 |
#### Commands
```bash
npm run check:project-docs
```
#### Ledger updates
`CUTOVER_PROPOSAL.md` を新規作成。
#### DONE checklist
- [ ] 手順・閾値・戻し方・承認者が書かれている
- [ ] 非本番の演習結果がある
- [ ] 本番を変更していない
#### STOP
- 本番の Route・Discord 設定・secret の変更が必要になったら止める（明示承認事項）。
#### Rollback
文書のPRをrevert。

### MIG-0806: Phase 8 Gate
- **Model:** lead
- **Readiness:** NEEDS_REFINEMENT — Phase Gate はエージェントが自動承認しない
- **Recipe:** R-EVIDENCE
- **Runtime:** N
- **Depends on:** MIG-0805 / **Decisions:** D-07 DECIDED
- **Verified against:** `aacf4fd` (2026-10-15)
#### Source snapshot
- MIG-0801〜0805 の merge 済みPR、`SECURITY_REVIEW.md`, `CUTOVER_PROPOSAL.md`。
#### Owned paths
- 新規: `+docs/migration/auth/PHASE_8_GATE.md`
- 変更: `docs/migration/STATUS.md`（承認後だけ）
#### Micro-units
- **U01 evidence**: session 継続、ログイン・ログアウト・連携、CSRF、CPU の証跡をまとめる。本番切替を実施済みかどうかを分けて書く。
- **U02 review**: 独立レビューと人間の Phase Gate 承認を依頼。
#### Test cases
| ID | 入力/操作 | 期待 |
| --- | --- | --- |
| T01 | 旧→新の session 継続 | 再ログイン不要 |
| T02 | 本番切替が未実施 | 「本番稼働済み」と書いていない |
#### Commands
```bash
npm run test:critical
npm run check:project-docs
```
#### Ledger updates
承認後に `STATUS.md` の MIG-0806 を DONE。
#### DONE checklist
- [ ] 独立レビューの APPROVE と人間の Phase Gate 承認
#### STOP
- 人間の承認なしに STATUS を DONE にしない。
#### Rollback
Gate のPRをrevert。

---

# 2. Phase 9: Next/OpenNext Retirement タスク別詳細仕様書

### 基本方針
新システム（`apps/site`, `apps/app`, `apps/api`）への全トラフィック切り替えが完了し、本番での安定稼働（1102 エラー 0 件）を確認した後、旧 Next.js コードを安全に削除してモノレポ構造を完成させる。

### Phase 9 共通契約（MIG-0901〜0906）

- Phase 9 は本番の観測値を証跡にする。非本番の値や経過時間で本番の観測を代用しない。
- 旧 Next の削除は、観測期間の終了と人間の承認の後だけ。削除PRは revert で旧経路を戻せる単位に分ける。
- 本番の Route・Worker の停止・Remote D1・secret は明示承認事項。

### MIG-0901: residual dependency inventory
- **Model:** lead
- **Readiness:** NEEDS_REFINEMENT — Phase 5〜8 の Gate 通過と、各ルートの本番切替が承認・実施済みであることが前提
- **Recipe:** R-REMOVE
- **Runtime:** N
- **Depends on:** MIG-0508, MIG-0607, MIG-0706, MIG-0806 / **Decisions:** none
- **Verified against:** `aacf4fd` (2026-10-15)
#### Source snapshot
- 旧 Worker: `wrangler.toml:1,3`（`flamenode-web`, `.open-next/worker.js`）。他の Worker は `workers/content-jobs`, `workers/fast-jobs`, `workers/sync-jobs`（各 `wrangler.toml`）。
- どの Phase も所有しない CURRENT ページ: `app/(public)/maintenance/page.tsx`（SYSTEM_SURFACE）, `app/(public)/dev/ui-surfaces/page.tsx`（DEV_ONLY）。`FILE_MIGRATION_MATRIX.md` で「RETAIN/REVIEW in MIG-0901」。
- `app/robots.ts`, `app/sitemap.ts`（Next の metadata route。Astro 側の代替が必要）。
#### Owned paths
- 新規: `+docs/migration/RESIDUAL_INVENTORY.md`
- 変更: `docs/migration/FILE_MIGRATION_MATRIX.md`（残存ファイルの disposition）
#### Micro-units
- **U01 inventory**: 全 path/method の新しい担当と、旧 Next に残る利用（asset URL、`/_next/*`、cron、Queue、auth callback、未知の404）を本番のログから列挙。
- **U02 orphans**: `/maintenance`、`/dev/ui-surfaces`、robots/sitemap の行き先を決める（`/maintenance` は mock の `Maintenance` ページがある）。
#### Test cases
| ID | 入力/操作 | 期待 |
| --- | --- | --- |
| T01 | 観測期間の旧 Worker へのリクエスト | 全件に担当か「廃止」の判断がある |
| T02 | robots.txt / sitemap.xml | 新構成で返る |
#### Commands
```bash
node scripts/check-migration-file-progress.mjs
npm run check:project-docs
```
#### Ledger updates
`RESIDUAL_INVENTORY.md` を新規作成。`FILE_MIGRATION_MATRIX.md` の残存行に disposition。
#### DONE checklist
- [ ] 文書化されていない旧経路の利用が0件
- [ ] 本番切替の承認・実施の証跡へのリンクがある
#### STOP
- 本番ログが取れない場合は推測で埋めず BLOCKED にする。
#### Rollback
文書のPRをrevert。

### MIG-0902: rollback observation window
- **Model:** lead
- **Readiness:** NEEDS_REFINEMENT — 観測期間の長さ（最低7日を候補）と責任者を人間が決める
- **Recipe:** R-EVIDENCE
- **Runtime:** N
- **Depends on:** MIG-0901 / **Decisions:** none
- **Verified against:** `aacf4fd` (2026-10-15)
#### Source snapshot
- 切替の承認記録（MIG-0805 / 各 Phase の cutover）、`ROUTING_AND_DEPLOY_PLAN.md` の戻し手順。
#### Owned paths
- 新規: `+docs/migration/OBSERVATION_WINDOW.md`
#### Micro-units
- **U01 plan**: 開始・終了、指標（404/403/500、CPU、1102、非公開の漏れ、Queue の滞留、集計値）、責任者、戻せる旧 deploy version を記録。
- **U02 drill**: 戻しの演習を1回行い記録（実行は承認の下で）。
#### Test cases
| ID | 入力/操作 | 期待 |
| --- | --- | --- |
| T01 | 観測期間の指標 | 重大障害の未解決0件 |
| T02 | 戻しの演習 | 成功 |
#### Commands
```bash
npm run check:project-docs
```
#### Ledger updates
`OBSERVATION_WINDOW.md` を新規作成。
#### DONE checklist
- [ ] 実観測の期間だけを数えている
- [ ] 戻しの演習が成功
#### STOP
- 観測データが無い期間を数えない。
#### Rollback
文書のPRをrevert。

### MIG-0903: remove legacy Server Actions/routes
- **Model:** lead
- **Readiness:** NEEDS_REFINEMENT — MIG-0902 の後
- **Recipe:** R-REMOVE
- **Runtime:** N
- **Depends on:** MIG-0902 / **Decisions:** none
- **Verified against:** `aacf4fd` (2026-10-15)
#### Source snapshot
- `src/lib/actions/**`（`server-actions/README.md` の SA-001〜110）、`app/api/**/route.ts`（28ファイル）、`app/(public|auth|manage|admin)/**/page.tsx`。
- `packages/*` の bridge（Phase 3 で作った `src/lib/**` の再export）。
#### Owned paths
- 削除: 新実装と同じ契約が証明された旧 action / route handler / page だけ
- 触らない: auth・audit・worker のロジック（Phase 9 の他MIGか担当外）
#### Micro-units
- **U01 plan**: 削除対象を SA/RH/page ごとに、新しい担当と証跡付きで列挙。
- **U02〜**: 領域ごと（公開 / API / Personal / Ops）に1PRずつ削除。
#### Test cases
| ID | 入力/操作 | 期待 |
| --- | --- | --- |
| T01 | 静的 import グラフ | 壊れた import 0件 |
| T02 | 旧にしか無い機能 | 0件 |
#### Commands
```bash
npm run typecheck
npm run test:unit
npm run test:integration
npm run test:workers
node scripts/check-migration-file-progress.mjs
```
#### Ledger updates
`FILE_MIGRATION_MATRIX.md` の削除行を RETIRED（PR/SHA と証跡）。
#### DONE checklist
- [ ] 削除した各ファイルに新しい担当と証跡がある
- [ ] CI green
#### STOP
- 新実装に無い挙動が見つかったら止めて担当MIGへ戻す。
#### Rollback
削除PRを revert。

### MIG-0904: remove OpenNext/Next deploy path
- **Model:** lead
- **Readiness:** NEEDS_REFINEMENT — MIG-0903 の後
- **Recipe:** R-REMOVE
- **Runtime:** N
- **Depends on:** MIG-0903 / **Decisions:** none
- **Verified against:** `aacf4fd` (2026-10-15)
#### Source snapshot
- `package.json`: `next` `15.5.22`, `next-auth` `5.0.0-beta.32`, `@opennextjs/cloudflare` `1.20.2`。scripts `build`, `dev`, `cf:build`, `cf:deploy-production` など。
- `open-next.config.ts`, `wrangler.toml`（`flamenode-web`）, `scripts/cloudflare-build.mjs`, `scripts/cloudflare-deploy-production.mjs`, `scripts/check-open-next-output.mjs`。
- `.github/workflows/pr186-consolidated-verify.yml` は `npm run cf:build` を実行する。
#### Owned paths
- 変更: `package.json`, `package-lock.json`, `.github/workflows/*.yml`
- 削除: `open-next.config.ts`, OpenNext 専用の scripts
- 触らない: `workers/**`（Queue / job の Worker）
#### Micro-units
- **U01 deps**: Next / OpenNext 依存と scripts を外し、`npm ci` で lock を更新。
- **U02 CI**: workflow を新構成の build に置き換える。
- **U03 worker**: `flamenode-web` の停止手順（実行は承認の下で）。
#### Test cases
| ID | 入力/操作 | 期待 |
| --- | --- | --- |
| T01 | 全 workspace の build | 成功 |
| T02 | `workers/**` のテスト | 変化なし |
#### Commands
```bash
npm ci
npm run typecheck
npm run test:workers
npm run build --workspace=@flamenode/site
npm run build --workspace=@flamenode/app
npm run build --workspace=@flamenode/ops
npm run build --workspace=@flamenode/api
```
#### Ledger updates
`FILE_MIGRATION_MATRIX.md` の root config 行を RETIRED。
#### DONE checklist
- [ ] build / deploy の経路がすべて新構成を向く
- [ ] 旧 Worker を止めても利用者の操作が落ちない証跡
#### STOP
- 旧 Worker の停止が必要になったら止める（明示承認事項）。
#### Rollback
PRをrevert。旧 Worker は停止前なら再 deploy で戻る。

### MIG-0907: 旧 rebuild 経路を消し、背景処理の 1102 を7日観測する（D-09）
- **Model:** lead
- **Readiness:** NEEDS_REFINEMENT — MIG-0904 の後。消す前の呼び出し元 0件を `rg` で示してから
- **Recipe:** R-REMOVE
- **Runtime:** N
- **Depends on:** MIG-0904, MIG-0610 / **Decisions:** D-09 DECIDED
- **Verified against:** `96f20dc` (2026-10-15)
#### Source snapshot
- 消す対象: `workers/json-generator/**`、static rebuild queue の consumer（`workers/content-jobs/staticRebuildWakeQueue.ts`）、生成を起こすだけの段（`workers/content-jobs/index.ts:201〜318`、`workers/sync-jobs/index.ts:205`）、`src/lib/staticRebuild/**` と `src/lib/queues/wakeStaticRebuildQueueAfterCommit.ts`（MIG-0903・0904 で残っていれば）。
- 残す: `public_build_state`（MIG-0410）、MIG-0610 で分けた job。
- Queue `flamenode-static-rebuild-wake` と DLQ、D1 の `static_rebuild_queue` 表は本番の資源なので、消すのはユーザーの承認後（`background-jobs/README.md` の Queue の表）。
#### Owned paths
- 削除: `workers/json-generator/**`、`workers/content-jobs/staticRebuildWakeQueue.ts` とその test
- 変更: `workers/content-jobs/index.ts`、`workers/content-jobs/wrangler.toml`（consumer と producer の削除）、`workers/sync-jobs/index.ts`、`workers/sync-jobs/wrangler.toml`
- 新規: `+docs/migration/BACKGROUND_OBSERVATION.md`
#### Micro-units
- **U01 inventory**: 消す file の export ごとに `rg` で呼び出し元を数え、0件の結果を PR に貼る。
- **U02 remove**: 1 PR で消すのは1系統（R-REMOVE）。順番は consumer → 生成を起こす段 → `workers/json-generator`。
- **U03 observe**: 本番へ反映（承認後）してから7日間、背景処理の Worker ごと・日ごとの Exceeded CPU / Exceeded Memory を `BACKGROUND_OBSERVATION.md` に記録する（`ZERO_1102.md` の G2）。
#### Test cases
| ID | 入力/操作 | 期待 |
| --- | --- | --- |
| T01 | 消す export の呼び出し元 | 0件 |
| T02 | 公開データを変える更新 | build 要求だけが記録され、R2 artifact は書かれない |
| T03 | 7日間の観測 | 背景処理の Worker で Exceeded CPU / Memory が 0件 |
#### Commands
```bash
npm run test:unit
npm run typecheck
npm run check:project-docs
```
#### Ledger updates
`FILE_MIGRATION_MATRIX.md` の消した file を REMOVED。`background-jobs/README.md` の Queue の表から static rebuild を消す。`BACKGROUND_OBSERVATION.md` に7日分。
#### DONE checklist
- [ ] 呼び出し元 0件の証跡
- [ ] 実観測7日で G2 を満たす（推定ではなく実測）
#### STOP
- 本番の Queue・D1 の表・Worker の削除や deploy は明示承認事項なので止める。
- 観測中に 1102 が出たら数え直さず、該当の job を MIG-0610 の形で直す task をユーザーに提案する。
#### Rollback
PRをrevert して再 deploy（承認後）。D1 の `static_rebuild_queue` を消していなければ、旧経路はそのまま戻る。

### MIG-0905: final architecture/docs consolidation
- **Model:** lead
- **Readiness:** NEEDS_REFINEMENT — MIG-0907 の後
- **Recipe:** R-EVIDENCE
- **Runtime:** N
- **Depends on:** MIG-0907 / **Decisions:** none
- **Verified against:** `aacf4fd` (2026-10-15)
#### Source snapshot
- `FEATURE_CATALOG.md`, `FRONTEND_FEATURES.md`, `FUNCTION_INVENTORY.md`（432 UX / 136 FN）、`CURRENT_ROUTES.md`、`AGENTS.md`、`docs/operations/**`。
#### Owned paths
- 変更: `docs/**`, `AGENTS.md`, `CLAUDE.md`
#### Micro-units
- **U01 parity**: 432 UX / 136 FN の全IDに最終 disposition を付ける。
- **U02 docs**: CURRENT/TARGET の表記を新構成に揃え、廃止した Next を CURRENT と書いている箇所を0にする。運用手順（障害対応・deploy・D1・Queue）を更新。
#### Test cases
| ID | 入力/操作 | 期待 |
| --- | --- | --- |
| T01 | UX/FN の disposition | 漏れ0件 |
| T02 | docs の link checker | 0エラー |
#### Commands
```bash
npm run check:docs
npm run check:project-docs
node scripts/check-migration-links.mjs
```
#### Ledger updates
各台帳の最終 disposition。
#### DONE checklist
- [ ] 432 UX / 136 FN の disposition が揃っている
- [ ] 旧 Next を CURRENT と書いた箇所が0件
#### STOP
- 実環境と食い違う記述を見つけたら推測で直さず確認する。
#### Rollback
PRをrevert。

### MIG-0906: Final Gate & Migration Complete
- **Model:** lead
- **Readiness:** NEEDS_REFINEMENT — 人間の最終承認が必要
- **Recipe:** R-EVIDENCE
- **Runtime:** N
- **Depends on:** MIG-0905 / **Decisions:** none
- **Verified against:** `aacf4fd` (2026-10-15)
#### Source snapshot
- MIG-0901〜0905・0907 の merge 済みPRと観測期間の記録（`OBSERVATION_WINDOW.md`、`BACKGROUND_OBSERVATION.md`）。
#### Owned paths
- 新規: `+docs/migration/FINAL_GATE.md`
- 変更: `docs/migration/STATUS.md`（承認後だけ）
#### Micro-units
- **U01 audit**: 新旧差・UX/FN・全ルートと API・不変条件・障害・戻しの証跡をまとめる。
- **U02 approval**: 独立レビューと人間の最終承認を依頼。
#### Test cases
| ID | 入力/操作 | 期待 |
| --- | --- | --- |
| T01 | 本番の 1102 | web 系は MIG-0902、背景処理は MIG-0907 の観測期間で0件（`ZERO_1102.md` の G1・G2。推定ではなく実測） |
| T02 | 欠けた証跡 | BLOCKED と担当・次の行動を記録 |
#### Commands
```bash
npm run check:project-docs
```
#### Ledger updates
承認後に `STATUS.md` を完了にする。
#### DONE checklist
- [ ] 独立レビューの APPROVE と人間の最終承認
#### STOP
- 人間の承認なしに完了と書かない。
#### Rollback
Gate のPRをrevert。
