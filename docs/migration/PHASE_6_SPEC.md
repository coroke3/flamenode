# FlameNode Phase 6 タスク仕様書（Hono API Spec）

> 状態: Active / Phase 6 実行向け仕様書
> 最終検証: 2026-10-09（`route-handlers/README.md` の RH-001〜RH-033 および `API_MATRIX.md` に基づき改定）
> 対象モデル: Claude / Codex / Antigravity / GPT-5.6-luna / Gemini Flash 等の全エージェント
> 関連ドキュメント: [`README.md`](README.md), [`STATUS.md`](STATUS.md), [`API_MATRIX.md`](API_MATRIX.md), [`route-handlers/README.md`](route-handlers/README.md), [`CODE_QUALITY.md`](CODE_QUALITY.md), [`OPEN_DECISIONS.md`](OPEN_DECISIONS.md) (D-01, D-02)
> **実行の正本:** 個別MIGの手順・停止条件・検証は本仕様書の `### MIG-XXXX:` Work Order。[`TASK_CARDS_6_7.md`](TASK_CARDS_6_7.md) は概要索引、CURRENT code/tests は実挙動の正本、[`STATUS.md`](STATUS.md) はmainへ統合済み進捗の正本。`npm run migration:next` はWork Orderと対応カードを併記し、矛盾時はLead確認までSTOP。

---

# 1. Hono API の基本方針

1. **薄いトランスポート層（Thin Adapter）**:
   - `apps/api` は HTTP 入出力（リクエストパース、Zod バリデーション、レスポンス成形、ステータスコードマッピング）のみを担当。
   - ビジネスロジック・権限判定方針を`packages/domain`に共通化する。**D1 binding/session/request context/SQL実行・監査commitはapplication service/DB adapter側**で管理し、transaction境界・post-commit Queueを維持。`packages/domain`から旧`src/**`へのimportは禁止し、schema型はMIG-0308後の`@flamenode/db`から参照する。
2. **共有 Zod 契約（`packages/contracts`）**:
   - リクエストボディおよびレスポンス DTO は `packages/contracts` で型定義。
   - D1 テーブルのカラムをそのまま漏洩させず、明示的 DTO のみを返却（`check:public-api-leaks` 準拠）。
3. **有界な CPU 時間（< 10ms）と非同期委譲**:
   - HTTP リクエスト内で行う処理量は厳格に制限。重い処理・再生成は Queue（`fast-jobs`, `content-jobs`, `sync-jobs`）へ委譲。
4. **URL 体系の維持**:
   - 新規の独自プレフィックス（`/api/v1` 等）を勝手に作らず、CURRENT の `/api/*` パス構造（RH-001〜RH-033）を原則維持。

---

# 2. Phase 6 タスク別詳細仕様書（実 API 対応）

### Phase 6 共通契約（MIG-0601〜0608）

- CURRENT の Route Handler は `app/api/**/route.ts`（28ファイル / 33メソッド、`route-handlers/README.md`）。Hono 側の実装先は `apps/api/src/**`。**旧版のこの仕様が `apps/api/<path>/route.ts` と書いていたのは誤りで、そのパスは存在しない。**
- URL は CURRENT の `/api/*` を維持し、`/api/v1` 等を新設しない。DTO は `packages/contracts` の Zod 定義だけを返す（`npm run check:public-api-leaks`）。
- 本番の Route 切替（`/api/*` を Hono Worker へ向ける）は各MIGの DONE 後に人間の明示承認を得て別操作として行う。PR内で本番 Route・Remote D1・secret を変更しない。
- 認証が必要なエンドポイントは MIG-0608 の session 読み取りを使う。ログイン・コールバック・ログアウト（RH-010/011）は Phase 8 まで旧 Next に残す。
- 共通の Rollback: PRをrevert。本番 Route を切り替えた後の戻しは `ROUTING_AND_DEPLOY_PLAN.md` の手順で、その実行も明示承認事項。

### MIG-0601: low-risk reads（低リスク参照系 API）
- **Model:** small
- **Readiness:** NEEDS_REFINEMENT — MIG-0307 の merge 後、lead が Hono の route 登録とテストの書き方（U01 のコード例）を `apps/api/src/index.ts` の実物に合わせて追記したら READY_FOR_SMALL_MODEL
- **Recipe:** R-API
- **Runtime:** S2
- **Depends on:** MIG-0307, MIG-0107 / **Decisions:** D-02 DECIDED
- **Verified against:** `aacf4fd` (2026-10-15)
#### Source snapshot
| CURRENT | ID | file |
| --- | --- | --- |
| public health | RH-018 | `app/api/health/route.ts`（テスト `app/api/health/route.test.mjs`） |
| deep health（`WORKER_ADMIN_TOKEN`） | RH-017 | `app/api/health/deep/route.ts`（ロジック `src/lib/health/deepHealth.test.mjs`） |
| about stats（R2 artifact） | RH-026 | `app/api/public/about-stats/route.ts` |
| software suggestions | RH-029 | `app/api/software/suggestions/route.ts`（`src/lib/api/softwareSuggestions.contract.test.mjs`） |
#### Owned paths
- 新規: `+apps/api/src/routes/health.ts`, `+apps/api/src/routes/publicAboutStats.ts`, `+apps/api/src/routes/softwareSuggestions.ts`, `+packages/contracts/src/health.ts` ほか DTO
- 新規: `+apps/api/src/env.ts`, `+apps/api/src/app.ts`, `+apps/api/test/*.test.mjs`（形は `IMPLEMENTATION_RECIPES.md` の R-API）
- 変更: `apps/api/src/index.ts`（`export default app` だけにする）
- 削除: `apps/api/src/types/hono.d.ts`（`any` を返す手書きの型 shim。本物の hono の型を隠す）
- 触らない: `app/api/**`（本番切替まで旧実装を維持）
#### Micro-units
- **U00 土台**: `apps/api/src/types/hono.d.ts` を消し、R-API の配置（`env.ts` / `app.ts` / `index.ts`）を作る。`npm run build --workspace=@flamenode/api` が本物の hono の型で通ることを確認する。zod を `apps/api` の bundle に入れる場合は、build 後の bundle で zod の版を確認し、3.x なら `ZERO_1102.md` §4 の 10 に従って非本番で memory を測り、結果を PR に書く（更新はこの task でしない）。
- **U01 health**: RH-018 と RH-017。deep は token 不一致で CURRENT と同じ status。検証: 既存 `route.test.mjs` と同じケースを Hono の `app.request()` で実行。
- **U02 about-stats**: RH-026。R2 binding 名を CURRENT と同じにする。
- **U03 software**: RH-029。MIG-0302 の domain 関数を使う。
#### Test cases
| ID | 入力/操作 | 期待 |
| --- | --- | --- |
| T01 | `GET /api/health` | CURRENT と同じ status/body/header |
| T02 | `GET /api/health/deep` token なし・誤り | CURRENT と同じ拒否 |
| T03 | about-stats の R2 欠落 | CURRENT と同じ劣化応答 |
| T04 | suggestions の不正 query | CURRENT と同じ 400 |
#### Commands
```bash
npm run build --workspace=@flamenode/api
npm run check:public-api-contract
npm run check:public-api-leaks
npm run typecheck
npm run test:unit
```
#### Ledger updates
`FILE_MIGRATION_MATRIX.md` の4ファイル行を IN_PROGRESS（target は `apps/api/src/routes/*`）。`API_MATRIX.md` の RH-017/018/026/029 に Hono 側の場所と CPU 測定値。
#### DONE checklist
- [ ] 4メソッドで status/body/header が CURRENT と一致
- [ ] 本番 Route を変更していない
- 例外（owner 決定 2026-10-19T11:07:37Z、PR #329）: 認証済み `GET /api/health/deep` は CURRENT の検査本体（`src/lib/health/deepHealth.ts` と依存）を移さず、常に `503 {ok:false, service}` を返す fail-closed の仮実装で DONE とした。拒否（T02）は CURRENT と一致。**`/api/health/deep` を Hono へ route する前に検査本体を package へ移して CURRENT と一致させる**（MIG-0607 の DONE checklist で確認）。
#### STOP
- 認証が必要になったら止める（MIG-0608 の後）。
- 本番 Route の変更が必要に見えたら止める。
#### Rollback
Phase 6 共通契約のとおり。

### MIG-0608: Hono read-only session resolution（Auth.js database session 互換）
- **Model:** lead
- **Readiness:** NEEDS_REFINEMENT — MIG-0801 の baseline テスト（cookie 名・属性・期限・失効）が入ってから。高リスク（認証）なので小型モデルに渡さない
- **Recipe:** R-API
- **Runtime:** S4
- **Depends on:** MIG-0801, MIG-0107 / **Decisions:** D-07 DECIDED
- **Verified against:** `aacf4fd` (2026-10-15)
#### Source snapshot
- `src/lib/auth/index.ts:67` `session: { strategy: "database" }`。cookie の値は D1 の `session` テーブル（`src/lib/db/schema.base.ts:87`）の sessionToken を指す。
- `src/lib/auth/index.ts:63` のコメント: adapter の失敗スタックに sessionToken が含まれうるのでログに出さない。
- 現在の利用者解決: `src/lib/auth/currentUser.ts`, `src/lib/auth/session.ts`, `src/lib/auth/requestAuthContext.ts`。
- この task が無いと、MIG-0602 以降の認証付き Hono API は Phase 8（MIG-0802、MIG-0607 に依存）まで利用者を特定できず、依存が循環する。
#### Owned paths
- 新規: `+apps/api/src/auth/session.ts`（cookie → D1 `session` → `user` の読み取りだけ）, `+apps/api/src/auth/session.test.mjs`
- 触らない: ログイン・コールバック・ログアウト（RH-010/011）、cookie の発行・更新・削除、`src/lib/auth/index.ts`
#### Micro-units
- **U01 lookup**: cookie 名（`__Secure-` 付きを含む、MIG-0801 で固定したもの）から sessionToken を取り、期限切れ・存在しない・BAN を CURRENT と同じ結果型で返す。検証: MIG-0801 の fixture で旧 Next と同じ判定。
- **U02 middleware**: Hono middleware で request ごとに解決（モジュールグローバルに保存しない）。sessionToken をログに出さない。
#### Test cases
| ID | 入力/操作 | 期待 |
| --- | --- | --- |
| T01 | 旧 Next が発行した有効な cookie | 同じ利用者に解決 |
| T02 | 期限切れ・削除済み session | 未ログイン扱い |
| T03 | BAN された利用者 | CURRENT と同じ拒否 |
| T04 | 改ざんした cookie | 未ログイン扱い、D1 読み取り1回以内 |
| T05 | エラーログ | sessionToken を含まない |
#### Commands
```bash
npm run build --workspace=@flamenode/api
npm run test:critical
npm run typecheck
npm run test:unit
```
#### Ledger updates
`FILE_MIGRATION_MATRIX.md` に `apps/api/src/auth/session.ts` 行を追加。`auth/README.md` に「Hono は session を読むだけ、発行は Phase 8 まで旧 Next」を1行追記。
#### DONE checklist
- [ ] 旧 Next の cookie で Hono が同じ利用者を解決する
- [ ] cookie を発行・更新・削除するコードが無い
- [ ] 独立レビュー（他agentまたは人間）の APPROVE
#### STOP
- cookie の発行・更新が必要に見えたら止める（Phase 8）。
- 独自の token 形式や署名を作る必要が出たら止める（D-07: 自前 auth protocol 禁止）。
#### Rollback
PRをrevert。旧 Next の認証は変わらない。

### MIG-0602: low-risk mutations（低リスク更新系 API）
- **Model:** lead
- **Readiness:** NEEDS_REFINEMENT — MIG-0601 と MIG-0608 の merge 後。transaction・監査を Hono → application service のどこで行うかを MIG-0303 の結果で確定
- **Recipe:** R-API
- **Runtime:** S3
- **Depends on:** MIG-0601, MIG-0608 / **Decisions:** D-01 DECIDED
- **Verified against:** `aacf4fd` (2026-10-15)
#### Source snapshot
| CURRENT | ID | file |
| --- | --- | --- |
| announcement lifecycle | SA-004..006 | `src/lib/actions/announcement.ts` |
| API endpoint config | SA-007..008 | `src/lib/actions/api-endpoints.ts` |
| audit settings / restore | SA-009..011（MIG-0629 / MIG-0616 へ移動） | `src/lib/actions/audit-admin.ts` |
- Server Action の CSRF は Next が origin で守っている。Hono 側は `src/lib/auth/writeOriginGuard.ts` と同じ origin 検査を middleware で行う。
#### Owned paths
- 新規: `+apps/api/src/routes/admin/*.ts`, `+apps/api/src/middleware/writeOrigin.ts`, `+packages/contracts/src/admin/*.ts`
- 触らない: `src/lib/actions/**`（旧 Server Action は Phase 9 まで残す）
#### Micro-units
- **U01 write guard**: origin 検査と admin 権限の middleware。検証: `writeGuardCore.test.mjs` と同じケース。
- **U02 announcements / api-endpoints**: SA-004〜008 のエンドポイント。MIG-0303 の domain を呼ぶ。
- **U03（MIG-0629 へ移動）**: SA-009〜010（audit settings / restore dry-run）。SA-011（audit restore）は MIG-0616 で個別実装。本 task の範囲は U01+U02（2026-10-23 分割決定、work-items/MIG-0602.md Decision）。cost guard（SA-016〜020）は MIG-0605 U06 の所有。
#### Test cases
| ID | 入力/操作 | 期待 |
| --- | --- | --- |
| T01 | 別 origin からの POST | 拒否 |
| T02 | 非admin | CURRENT と同じ拒否、監査0 |
| T03 | 成功 | 監査1件、公開反映 enqueue が CURRENT と同じ |
| T04 | CAS 競合 | CURRENT と同じ競合結果 |
#### Commands
```bash
npm run build --workspace=@flamenode/api
npm run test:critical
npm run typecheck
npm run test:unit
npm run test:integration
```
#### Ledger updates
`API_MATRIX.md` の SA-004〜008 に Hono エンドポイント（SA-009〜011 は MIG-0629 / MIG-0616）。`FILE_MIGRATION_MATRIX.md` の action 行の target に Hono の場所。
#### DONE checklist
- [ ] 対象SAすべてで成功・拒否・競合と監査・Queue が CURRENT と一致
- [ ] 本番 Route を変更していない
#### STOP
- 監査の意味を変える必要が出たら止める。
#### Rollback
Phase 6 共通契約のとおり。

### MIG-0603: video APIs（動画・チャプター API）
- **Model:** lead
- **Readiness:** NEEDS_REFINEMENT — MIG-0602 と MIG-0304 の merge 後
- **Recipe:** R-API
- **Runtime:** S2, S3
- **Depends on:** MIG-0602, MIG-0304 / **Decisions:** D-03 DECIDED
- **Verified against:** `aacf4fd` (2026-10-15)
#### Source snapshot
| CURRENT | ID | file |
| --- | --- | --- |
| video list | RH-032 | `app/api/videos/route.ts` |
| video detail | RH-030 | `app/api/videos/[id]/route.ts` |
| viewer overlay（session 依存） | RH-031 | `app/api/videos/[id]/viewer-overlay/route.ts` |
| chapters | SA-012..015 | `src/lib/actions/chapter.ts` |
| visibility | SA-001..003, SA-040..042 | `src/lib/actions/admin.ts`, `src/lib/actions/manage-video.ts` |
| collaborators | SA-082..085 | `src/lib/actions/video-collab-perms.ts`, `src/lib/actions/video/adminMembers.ts` |
| submit / interaction / update | SA-086..089 | `src/lib/actions/video/{createFreeVideo,interaction,submitSlotVideo,updateVideo}.ts` |
- 公開画面から Server Action を直接呼んでいる部品: `src/components/video/InteractionButton.tsx:6`（SA-087）, `ChapterComposer.tsx:7`（SA-012〜）, `VideoStatusForm.tsx:7-8`（SA-001/040）。Phase 5 の Island はこの MIG の API を使う。
#### Owned paths
- 新規: `+apps/api/src/routes/videos/*.ts`, `+packages/contracts/src/video*.ts`（`packages/contracts/src/video.ts` を拡張）
- 触らない: `src/lib/actions/**`, `app/api/videos/**`
#### Micro-units
- **U01 reads**: RH-030/031/032。
- **U02 chapters / visibility**: SA-012〜015, 001〜003, 040〜042。チャプター削除時のコメント論理保持。
- **U03 collaborators / submit / interaction / update**: SA-082〜089。SA-087 は Active X 単位（`ACTIVE_X_MIGRATION_PLAN.md`）。
#### Test cases
| ID | 入力/操作 | 期待 |
| --- | --- | --- |
| T01 | 権限ごとの編集（MIG-0304 T01 と同じ表） | CURRENT と一致 |
| T02 | Active X 0件でいいね | CURRENT と同じ応答 |
| T03 | チャプター削除 | コメントが論理保持 |
| T04 | 公開→非公開 | フェンス・通知・静的反映 enqueue が CURRENT と一致 |
#### Commands
```bash
npm run build --workspace=@flamenode/api
npm run test:critical
npm run check:video-interactions-auth
npm run test:unit
npm run test:integration
```
#### Ledger updates
`API_MATRIX.md` の RH-030〜032, SA-001〜003, 012〜015, 040〜042, 082〜089 に Hono エンドポイント。
#### DONE checklist
- [ ] U01〜U03 が全部 DONE
- [ ] 権限判定の結果が CURRENT と全件一致
#### STOP
- 権限判定が1件でも変わったら止める。
#### Rollback
Phase 6 共通契約のとおり。

### MIG-0604: event/slot APIs（イベント・枠 API）
- **Model:** lead
- **Readiness:** NEEDS_REFINEMENT — MIG-0602 と MIG-0305 の merge 後。micro-unit の正本は [`TASK_MICRO_UNITS.md`](TASK_MICRO_UNITS.md) MIG-0604
- **Recipe:** R-API
- **Runtime:** S2, S3
- **Depends on:** MIG-0602, MIG-0305 / **Decisions:** none
- **Verified against:** `aacf4fd` (2026-10-15)
#### Source snapshot
| CURRENT | ID | file |
| --- | --- | --- |
| event list | RH-015 | `app/api/events/route.ts` |
| slot viewer overlay | RH-014 | `app/api/events/[id]/slots/viewer-overlay/route.ts` |
| live slots / submissions / summary | RH-020..022 | `app/api/live/events/[id]/{slots,submissions,summary}/route.ts` |
| event export | RH-012..013 | `app/api/event-endpoints/[id]/route.ts`, `app/api/event-endpoints/[id]/release/route.ts` |
| event / staff / template / playlist | SA-021..039 | `src/lib/actions/event-*.ts`, `event-youtube-playlist.ts` |
| slot | SA-056..068 | `src/lib/actions/slot*.ts` |
- 公開画面の `src/components/event/SlotGrid.tsx:15` が `@/lib/actions/slot` を直接呼ぶ。Phase 5 の枠 Island はこの MIG の API を使う。
#### Owned paths
- 新規: `+apps/api/src/routes/events/*.ts`, `+apps/api/src/routes/live/*.ts`, `+packages/contracts/src/event*.ts`
- 触らない: `src/lib/actions/**`, `app/api/events/**`, `app/api/live/**`
#### Micro-units
- U01〜U04 と Final audit は [`TASK_MICRO_UNITS.md`](TASK_MICRO_UNITS.md) MIG-0604 のとおり。
#### Test cases
| ID | 入力/操作 | 期待 |
| --- | --- | --- |
| T01 | 最後の owner の解任 | 拒否 |
| T02 | 同じ枠の同時予約 | 1件だけ成功 |
| T03 | live API の cache header | CURRENT と同じ（5秒） |
| T04 | export の CORS と認可 | CURRENT と同じ |
#### Commands
```bash
npm run build --workspace=@flamenode/api
npm run test:critical
npm run check:event-owners
npm run check:slot-domain-limits
npm run test:unit
npm run test:integration
```
#### Ledger updates
`API_MATRIX.md` の RH-012〜015, 020〜022 と SA-021〜039, 056〜068 に Hono エンドポイント。
#### DONE checklist
- [ ] U01〜U04 と Final audit が DONE
- [ ] owner 0 防止と予約の原子性がテストで実証されている
#### STOP
- 予約の transaction 境界を変える必要が出たら止める。
#### Rollback
Phase 6 共通契約のとおり。

### MIG-0605: user/X/admin APIs（ユーザー・X・管理 API）
- **Model:** lead
- **Readiness:** NEEDS_REFINEMENT — MIG-0602 と MIG-0306 の merge 後。micro-unit の正本は [`TASK_MICRO_UNITS.md`](TASK_MICRO_UNITS.md) MIG-0605
- **Recipe:** R-API
- **Runtime:** S2, S3
- **Depends on:** MIG-0602, MIG-0306 / **Decisions:** D-03 DECIDED, D-04 DECIDED
- **Verified against:** `aacf4fd` (2026-10-15)
#### Source snapshot
| CURRENT | ID | file |
| --- | --- | --- |
| account summary | RH-001 | `app/api/account/summary/route.ts` |
| X-user search | RH-019 | `app/api/internal/x-users/search/route.ts` |
| spreadsheet | RH-003..009 | `app/api/admin/spreadsheet/{data,export,import,tables}/route.ts` |
| legacy import | RH-002 | `app/api/admin/import/legacy/route.ts` |
| media proxies | RH-016, RH-023..025, RH-033 | `app/api/google-drive-image/[id]/route.ts`, `app/api/media/**/route.ts`, `app/api/youtube-thumbnail/[id]/[size]/route.ts` |
| public staff | RH-027..028 | `app/api/public/events/[id]/staff/route.ts` |
| X link / merge | SA-090..097 | `src/lib/actions/xid-admin.ts`, `src/lib/actions/xid-merge-admin.ts` |
| Active X / profile | SA-098..105 | `src/lib/actions/xid.ts` |
| terms / user admin | SA-075..081 | `src/lib/actions/terms.ts`, `src/lib/actions/user-admin.ts` |
| cost guard / moderation / notifications | SA-016..020, SA-043..055 | `src/lib/actions/cost-guard.ts`, `moderation-admin.ts`, `notification-admin.ts` |
- 公開画面の `src/components/user/useActiveXSwitcher.ts:5`（SA-098）と `app/(public)/rules/page.tsx:3,95`（SA-075 の form）は Server Action を直接呼ぶ。Phase 5 の該当 Island と `/rules` はこの MIG の API を使う。
#### Owned paths
- 新規: `+apps/api/src/routes/account/*.ts`, `+apps/api/src/routes/admin/spreadsheet/*.ts`, `+apps/api/src/routes/media/*.ts`, `+apps/api/src/routes/xid/*.ts`
- 触らない: `src/lib/actions/**`, `app/api/**`
#### Micro-units
- U01〜U07 と Final audit は [`TASK_MICRO_UNITS.md`](TASK_MICRO_UNITS.md) MIG-0605 のとおり。U07 で RH-001〜033 の全メソッドに担当MIGがあることを確認する。
#### Test cases
| ID | 入力/操作 | 期待 |
| --- | --- | --- |
| T01 | account summary の未ログイン | CURRENT と同じ `no-store` 応答 |
| T02 | media proxy に外部URL | SSRF 拒否 |
| T03 | spreadsheet import の途中失敗 | 全件ロールバック |
| T04 | X merge の revert | 帰属が戻る |
#### Commands
```bash
npm run build --workspace=@flamenode/api
npm run test:critical
npm run check:x-link-dependencies
npm run check:audit-actor-x
npm run test:unit
npm run test:integration
```
#### Ledger updates
`API_MATRIX.md` の RH-001〜009, 016, 019, 023〜025, 027〜028, 033 と SA-016〜020, 043〜055, 069〜106 に Hono エンドポイント。
#### DONE checklist
- [ ] U01〜U07 と Final audit が DONE
- [ ] RH-010/011 以外の全メソッドに担当MIGがある
- [ ] Remote D1 に書き込んでいない（D-03 は dry-run のみ）
#### STOP
- D-03 の fan-out を本番 D1 で実行する必要が出たら止める。
- D-04 の切替を実行する必要が出たら止める（別承認）。
#### Rollback
Phase 6 共通契約のとおり。

### MIG-0606: API CPU benchmark
- **Model:** small
- **Readiness:** NEEDS_REFINEMENT — MIG-0603〜0605 の merge 後、lead が測定スクリプトの雛形と測定条件（ローカル `wrangler dev` / 非本番、サンプル数）を確定したら READY_FOR_SMALL_MODEL
- **Recipe:** R-BUILD
- **Runtime:** N
- **Depends on:** MIG-0603, MIG-0604, MIG-0605 / **Decisions:** D-06 DECIDED
- **Verified against:** `aacf4fd` (2026-10-15)
#### Source snapshot
- 予算: `ZERO_1102.md` §3 の**最大値**で判定する（参照 S2 < 7ms、更新 S3 < 8ms、session 解決 S4 は 2ms 以内）。p50/p95/p99 は記録するが合否に使わない。入力は §5 の4種類（通常・上限ちょうど・不正・cold）を各 50回以上。
- 対象: RH-010/011 を除く 31 メソッドの Hono 実装（`apps/api/src/routes/**`）。
#### Owned paths
- 新規: `+scripts/benchmark-api-cpu.mjs`, `+docs/migration/cloudflare/API_CPU_BENCHMARK.md`
- 触らない: `apps/api/src/**`（遅いエンドポイントは担当MIGへ差し戻す）
#### Micro-units
- **U01 harness**: 非本番の Hono Worker に対して各メソッドを N 回呼び、CPU p50/p95/p99/max を集計するスクリプト。
- **U02 run**: 全メソッドを測定し、条件（環境・version・サンプル数）付きで記録。
#### Test cases
| ID | 入力/操作 | 期待 |
| --- | --- | --- |
| T01 | 31メソッド | 全件の測定値がある |
| T02 | 予算超過のメソッド | 担当MIGと理由が記録されている |
#### Commands
```bash
node scripts/benchmark-api-cpu.mjs
npm run check:project-docs
```
#### Ledger updates
`API_CPU_BENCHMARK.md` を新規作成。`API_MATRIX.md` の各メソッドに測定値。
#### DONE checklist
- [ ] 31メソッドの測定値（max を含む）と条件が記録され、max が `ZERO_1102.md` §3 の予算未満か、超過の担当MIGが記録されている
- [ ] 測定値を本番値と書いていない
#### STOP
- 予算超過を直すためにエンドポイントを書き換え始めたら止める（担当MIGへ）。
#### Rollback
PRをrevert。

### MIG-0609: 残る背景処理の CPU を測る（D-09）
- **Model:** lead
- **Readiness:** NEEDS_REFINEMENT — MIG-0606 の計測 script が merge された後。同じ script で Cron と Queue consumer を呼べるかを確かめてから
- **Recipe:** R-BUILD
- **Runtime:** N
- **Depends on:** MIG-0606 / **Decisions:** D-09 DECIDED
- **Verified against:** `96f20dc` (2026-10-15)
#### Source snapshot
- build 時へ移さずに残る job（状態を更新するもの）と、1回の上限:

  | job | 入口 | 1回の上限（CURRENT） |
  | --- | --- | --- |
  | OpenNext cache の掃除 | `workers/cleanup/incrementalCache.ts:29` | `SCAN_LIMIT=200`（`:4`） |
  | 保持期限の削除 | `workers/cleanup/index.ts:36` | `AUDIT_CLEANUP_BATCH_LIMIT=500`（`workers/cleanup/retention.ts:6`） |
  | X ID の枠の紐付け回復 | `workers/content-jobs/xIdSlotBindRecovery.ts:674` | `REQUEST_LIMIT=5`、`SLOT_LIMIT=30`（`:11〜16`） |
  | 通知の lease 回復・配信 | `workers/notification-dispatcher/dispatch.ts:1005`、`:1065` | `MAX_NOTIFICATION_BATCH=6`、外部 request 12（`:46〜55`） |
  | 枠の締切リマインダー | `workers/notification-dispatcher/reminders.ts:131` | `REMINDER_LIMIT=50`（`:7`） |
  | YouTube metadata 同期 | `workers/youtube-sync/index.ts:1080` | API 4回、50件（`:93〜97`） |
  | YouTube 非公開の再確認 | `workers/sync-jobs/index.ts:582` | 10件（`workers/youtube-sync/index.ts:110`） |
  | score の再計算 | `workers/score-recalc/index.ts:39` | 150件（`:29`） |
  | YouTube playlist 同期 | `workers/youtube-playlist-sync/index.ts:2173` | event 1、外部 request 12、元の作品 5,000（`:127〜143`） |
  | GA4 人気順 | `workers/ga-analytics/sync.ts:215` | 200件（`workers/ga-analytics/ranking.ts:29`） |

- CURRENT の計測値（本番、Four-Worker 表）: sync の scheduled が max 83ms、fast の scheduled が max 25ms（`cloudflare/PERFORMANCE_BASELINE.md`）。
- Queue consumer は `max_batch_size = 10`（`workers/*/wrangler.toml`）。batch 全体が1回の invocation。
- **MIG-0410（#325）からの引き継ぎ（Fable 決定 2026-10-23。非本番 `cpuTime`、整数 ms）:** (a) fast-jobs の既存の段は warm 約10ms（C1 max 15ms）、(b) 通知 outbox 6件で 33ms（1件約4ms → `MAX_` を 1〜2 にする案を検討）、(c) cold 24〜30ms。MIG-0410 の段の増分は +2ms で B-add（`ZERO_1102.md` §3）を満たす。fast-jobs 全体を 8ms に収めるのはこの task（測定）と MIG-0610（分割）。
#### Owned paths
- 新規: `+docs/migration/cloudflare/BACKGROUND_CPU.md`
- 変更: `scripts/benchmark-api-cpu.mjs`（Cron と Queue consumer を呼ぶ入口を足すだけ）
- 触らない: `workers/**`（直すのは MIG-0610）
#### Micro-units
- **U01 harness**: MIG-0606 の script に、非本番の Worker の `scheduled` と `queue` を呼ぶ入口を足す。
- **U02 measure**: 上の表の job ごとに、1件あたりの CPU と、CURRENT の上限ちょうどの入力での CPU p50/p95/max を測る（`ZERO_1102.md` §5 の4種類、各 50回以上）。
- **U03 table**: `BACKGROUND_CPU.md` に、job ごとの測定値と「max < 8ms にする1回の上限 = floor(7ms ÷ 1件の max CPU)」を書く（1ms は起動と D1 の結果処理の余裕）。
#### Test cases
| ID | 入力/操作 | 期待 |
| --- | --- | --- |
| T01 | 表の全 job | 測定値と条件がある |
| T02 | 予算を超える job | 新しい上限の計算がある |
#### Commands
```bash
node scripts/benchmark-api-cpu.mjs --background
npm run check:project-docs
```
#### Ledger updates
`BACKGROUND_CPU.md` を新規作成。`cloudflare/PERFORMANCE_BASELINE.md` から link する。
#### DONE checklist
- [ ] 全 job の測定値（max を含む）と条件がある
- [ ] 予算を超える job ごとに、新しい上限の計算がある
- [ ] 測定値を本番値と書いていない
#### STOP
- job の code を直し始めたら止める（MIG-0610）。
- 本番の Worker を計測のために呼ぶ必要が出たら止める（明示承認事項）。
#### Rollback
PRをrevert。

### MIG-0610: 予算を超える背景処理を1回 8ms 未満に分ける（D-09）
- **Model:** lead
- **Readiness:** NEEDS_REFINEMENT — MIG-0609 の表で予算を超えた job ごとに micro-unit を作ってから。各 unit は「定数を表の値に変える + R-JOB の5種の test」の形なので、値が決まれば small に渡せる
- **Recipe:** R-JOB
- **Runtime:** B
- **Depends on:** MIG-0609 / **Decisions:** D-09 DECIDED
- **Verified against:** `96f20dc` (2026-10-15)
#### Source snapshot
- 上限と入口は MIG-0609 の Source snapshot の表。測定値は `cloudflare/BACKGROUND_CPU.md`（MIG-0609 が作る）。
- Cron の入口: `workers/content-jobs/index.ts:111`、`workers/fast-jobs/index.ts:114`、`workers/sync-jobs/index.ts:170`。CURRENT は1回の Cron の中で複数の job を順に動かす。
- 仕事の正本は D1 の行、Queue は doorbell だけ（`background-jobs/README.md` の最重要原則）。
#### Owned paths
- 変更: MIG-0609 の表で予算を超えた job の file と、その test（unit ごとに PR 本文で file を列挙する）、`workers/*/wrangler.toml` の `max_batch_size`
- 触らない: `workers/json-generator/**`（MIG-0907 で消す）、`crons` の式、本番の Queue 設定
#### Micro-units
- **U01 cron fan-out**: 3つの Cron を「job ごとに doorbell を1つ enqueue する」形にし、Cron 自体は D1 を読まない（MIG-0410 の build 要求の確認だけは例外）。
- **U02 batch size**: 各 Queue consumer の `max_batch_size` を「8ms ÷ 1 message の max CPU」以下にする（計算を PR に書く）。
- **U03..Unn job**: 予算を超えた job ごとに1 unit。定数を MIG-0609 の値に下げ、残りを D1 に残して続きの doorbell を enqueue する。R-JOB の5種の test を足す。
#### Test cases
| ID | 入力/操作 | 期待 |
| --- | --- | --- |
| T01 | 各 job の上限ちょうどの入力 | 非本番の max < 8ms |
| T02 | 上限 + 1 件 | 続きの doorbell が1つ enqueue され、D1 に残りがある |
| T03 | 同じ doorbell が2回 | 二重に処理しない |
| T04 | 外部 API（YouTube・Discord・GA4）の失敗 | D1 の状態が retry 可能なまま残る |
| T05 | 1日の message 数 | Queue の無料枠（1日 10,000 operations）の 50%以下の見積もりが PR にある |
#### Commands
```bash
npm run test:unit
node scripts/benchmark-api-cpu.mjs --background
npm run typecheck
```
#### Ledger updates
`BACKGROUND_CPU.md` に分割後の測定値。`background-jobs/README.md` の上限の表を更新。
#### DONE checklist
- [ ] 全 job の非本番 max < 8ms（上限ちょうどの入力、50回以上）
- [ ] 通知・同期の到達時間が CURRENT より延びる場合、その値を PR に書き、ユーザーが承認している
- [ ] Queue の1日の message 数の見積もりがある
#### STOP
- 本番の Queue 設定・Cron・Worker の deploy は明示承認事項なので止める。
- 分割すると通知や同期の遅れが CURRENT より大きく延びる場合は、実装前に値を示してユーザーに確認する。
- 外部 API の呼び出し回数が CURRENT より増える分割になったら止める（YouTube の quota）。
#### Rollback
PRをrevert。D1 が正本なので、途中まで処理した仕事は次の Cron が拾う。

### D-10 共有 server core の共通契約（MIG-0612 から MIG-0618）

- 決定は [`OPEN_DECISIONS.md`](OPEN_DECISIONS.md) D-10、形は [`IMPLEMENTATION_RECIPES.md`](IMPLEMENTATION_RECIPES.md) R-CORE。`packages/server-core`（`@flamenode/server-core`）が drizzle handle と ports を引数で受け、Next（`src/lib/**` の bridge）と Hono が同じ関数を呼ぶ。
- 呼び出し側 file は変えない。CURRENT の `mutateWithAudit` 81 箇所・34 file は bridge の signature を維持する。
- 各 task の最初の commit は、移動前の挙動を固定する golden test（batch の SQL 文字列 + params と `audit_logs` の行。時刻と乱数 id を固定して `id` / `created_at` も比較する）。移動後も byte 単位で一致させる。1 byte でも違えば STOP。
- 実行順（D1 `batch` → 成功後に best-effort の wake）と strict / CAS の意味を変えない。変える必要が出たら STOP。
- `src/lib/publicData/loader.ts` は移さない（[`ZERO_1102.md`](ZERO_1102.md) §4.1 / §4.7 と D-09 に反する）。`revalidatePath` は Next の Server Action に残す。
- MIG-0602 の `apps/api` 内の写し（Option A）は MIG-0617 まで暫定 bridge として残す。
- 本番 Route・Remote D1・secret を変更しない。共通の Rollback: PR を revert（bridge を元の実装へ戻すだけで、DB・Queue・Route の変更は無い）。

### MIG-0612: 共有 server core の足場（D-10）
- **Model:** lead
- **Readiness:** NEEDS_REFINEMENT — STATUS は READY（依存なし）。lead が足場の範囲を確定済み。依存なし。docs・package の足場・境界検査だけで、既存の実装コードは動かさない
- **Recipe:** R-CORE
- **Runtime:** N
- **Depends on:** none / **Decisions:** D-10 DECIDED, D-01 DECIDED
- **Verified against:** `c5a62b4d` (2026-10-23)
#### Source snapshot
- `packages/domain` / `packages/db` は DB 実行・env・Queue を持てない。`apps/api` の写し（MIG-0602）と Next の `src/lib/audit/**` が同じ処理を二重に持つ危険を、共有 package で止める。
- 境界検査の前例: `scripts/check-domain-imports.mjs`（ts.preProcessFile による specifier 抽出）。
#### Owned paths
- 新規: `+packages/server-core/{package.json,tsconfig.json,src/index.ts,src/ports.ts,test/ports.test.mjs}`, `+scripts/check-server-core-boundaries.mjs`, `+scripts/check-server-core-boundaries.test.mjs`, `+docs/migration/work-items/MIG-0612.md`
- 変更: `docs/migration/{OPEN_DECISIONS,DB_PACKAGE_EXTRACTION_PLAN,IMPLEMENTATION_RECIPES,PHASE_6_SPEC,STATUS,TASK_CARDS_6_7}.md`, `AGENTS.md`, `tsconfig.base.json`, `tsconfig.json`, `package-lock.json`, `scripts/check-project-docs.mjs`, `scripts/check-domain-imports.mjs`（export の追加だけ）, `.github/workflows/migration-docs-check.yml`
- 触らない: `src/lib/**`, `apps/api/**`, `packages/domain/**`, `packages/db/**`
#### Micro-units
- **U01 docs**: D-10、DB_PACKAGE_EXTRACTION_PLAN §2、AGENTS.md、R-CORE、R-API の注、本 Work Order 群、STATUS 行、task card。
- **U02 package**: `packages/server-core` の足場と `src/ports.ts`（型 `QueueWakePort`, `WaitUntilPort`, `BucketPort`, `KvPort`, `EdgeCachePort`, `EnvValues`, `RethrowFrameworkControl`, `Clock`）。
- **U03 check**: `scripts/check-server-core-boundaries.mjs` を `check:project-docs` と CI に配線する。
#### Test cases
| ID | 入力/操作 | 期待 |
| --- | --- | --- |
| T01 | 実リポジトリの `packages/server-core/src` | OK（違反 0） |
| T02 | fixture に `next/navigation`, `react`, `hono`, `server-only`, `@/lib/x`, `../../src/x` | それぞれ違反として検出 |
| T03 | fixture に `process.env.X`, `getCloudflareContext()`, `@opennextjs/cloudflare` | 検出 |
| T04 | fixture の `packages/domain/src` が `@flamenode/server-core` を import | 検出（逆向きの依存） |
| T05 | コメント・文字列の中の `process.env` | 検出しない |
#### Commands
```bash
npm run typecheck --workspace=@flamenode/server-core
npm run test --workspace=@flamenode/server-core
node --test scripts/check-server-core-boundaries.test.mjs
node scripts/check-server-core-boundaries.mjs
npm run typecheck
npm run test:critical
npm run test:unit
npm run test:integration
npm run check:project-docs
```
#### Ledger updates
STATUS は merge 直前の統合でだけ更新する。移した file は `FILE_MIGRATION_MATRIX.md` の行の target を bridge と core の場所に更新する。
#### DONE checklist
- [ ] D-10 が DECIDED で、AGENTS.md と DB_PACKAGE_EXTRACTION_PLAN §2 が同じ境界を書いている
- [ ] `packages/server-core` が build / typecheck でき、境界検査が CI（`migration-contract` と `migration-workspaces`）で動く
- [ ] 既存の実装コード（`src/lib/**`）の diff が 0
#### STOP
- core が `next/*`, `react`, `server-only`, `@/`, `src/` を必要とする設計になったら止める。
#### Rollback
PR を revert。実装コードの変更が無いので他に戻すものは無い。

### MIG-0613: 監査 mutation core
- **Model:** lead
- **Readiness:** NEEDS_REFINEMENT — MIG-0612 の merge 後。golden test を最初に commit する
- **Recipe:** R-CORE
- **Runtime:** S3
- **Depends on:** MIG-0612 / **Decisions:** D-10 DECIDED
- **Verified against:** `c5a62b4d` (2026-10-23)
#### Source snapshot
| CURRENT | 内容 | file |
| --- | --- | --- |
| 監査 mutation | `mutateWithAudit`（81 呼び出し・34 file）、`mutateBudget`、`expectedRowCondition` | `src/lib/audit/{mutate,mutateBudget,expectedRowCondition}.ts` |
| 監査行の組み立て | `prepareAuditLogEntries` / `writeAuditLog`、snapshot、diff、retention、settings、capability、registry、adapters、types、helpers | `src/lib/audit/*.ts` |
| 監査の post commit | `runPostCommitBestEffort` | `src/lib/audit/postCommit.ts` + `src/lib/observability/flowTrace.ts` |
| Queue wake | `sendQueueWakeBestEffort`（env / KV / `waitUntil` を ambient に読む）、wake message、budget、failure record | `src/lib/queues/*.ts` |
- import 連鎖は 32 file・約 4,000 行（`server-only` 5、`getCloudflareContext` 直接 3、`@/` 8、`process.env` 1）。
#### Owned paths
- 新規: `+packages/server-core/src/{audit,queues,observability,video}/**`, `+packages/server-core/src/{db,id}.ts`, `+packages/server-core/test/**`, `+src/lib/serverCore/nextPorts.ts`, `+src/lib/audit/auditGolden.execution.test.mjs`, `+src/lib/audit/auditGolden.snapshot.json`
- 変更: `src/lib/audit/*.ts`, `src/lib/queues/*.ts`（re-export bridge 化。`restore.ts` と `*.test.mjs` は移さない）, `src/lib/utils/id.ts`, `src/lib/observability/flowTrace.ts`, `src/lib/video/memberSetSnapshot.ts`
- 移動（R-DOMAIN）: `src/lib/auth/permissions/presets.ts` → `packages/domain/src/auth/permissions/presets.ts`（`capability` が `isEventStaffPreset` を使うため。純粋で、`@flamenode/domain/auth/permissions/presets` の subpath export だけ足し、barrel には足さない。`EventStaffPreset` 型が `@flamenode/domain/event` と衝突するため）
- test / script のうち、移動した source の text を読むもの（read するパスだけを新しい場所に変える。assertion と件数は同じ）: `src/lib/audit/{audit,auditPreparationBudget.contract,mutate.wake.contract,registry}.test.mjs`, `src/lib/queues/{sendQueueWakeLifetime.contract,wakeNotificationQueueAfterCommit,wakeStaticRebuildQueueAfterCommit,youtubeSyncWake}.test.mjs`, `src/lib/{integration/spec010207Contracts,integration/spec07Static,knownBugs20260821.contract,youtubePlaylistReadiness.contract,video/atomicWritePlan.contract,admin/optimization.contract,actions/videoCollabPermsBudget.contract}.test.mjs`, `src/components/forms/videoMembersReliability.contract.test.mjs`, `workers/sync-jobs/index.test.mjs`, `scripts/check-audit-actor-x.mjs`, `scripts/check-migration-docs.mjs`
- 触らない: 呼び出し側（`src/lib/actions/**` など）、`workers/shared/**`（`src/lib/queues/*.ts` の bridge を経由して同じ module を読む）
#### 設計の決定（実装時）
- `mutateWithAudit(db, input, loadWakeHost?)`: core は第 3 引数に `QueueWakeHostLoader`（commit 後に host を解決する async 関数）を受ける。Next の bridge は `nextPorts.ts` を動的 import する loader を渡す（CURRENT が wake module を commit 後に動的 import していたのと同じ順序・遅延）。wake source を指定したのに loader が無い呼び出しは、batch の前に `AuditMutationError` にする（bridge では起きない）。
- `QueueWakeHost { readEnv, readWaitUntil, readKv }`（`ports.ts`）が、CURRENT の `getEnv()` / `getCloudflareContext().ctx.waitUntil` / `getEnv().KV` の ambient な読み取りの置き換え。reader が throw または null のときは CURRENT と同じく「binding 無し」として扱う。
- core の DB 型は `ServerCoreDb = DrizzleD1Database<typeof schema>`（`@flamenode/db/schema`）。Next の `DB` がそのまま代入できる。
- core の build は emit しない（`typecheck` のみ）。`tsconfig.base.json` の paths が `@flamenode/db` を src へ向けるため、`rootDir` 付きの emit は TS6059 になる。`apps/api` が core を使う MIG-0617 で消費方法（paths を dist か src か）を決める。
- core の module 内 state（`missingBindingWarned`, `recentFailureWrites`）は CURRENT と同じ module-scope の Set / Map。bridge は同じ core module を共有する。
#### Micro-units
- **U01 golden**: 移動前の commit で、代表入力の batch SQL + params と `audit_logs` 行を固定する test（時刻と乱数 id を固定するので `id` / `created_at` も比較する）。
- **U02 move**: audit を `packages/server-core/src/audit/**` へ、queues を `src/queues/**` へ移し、ports を引数にする。
- **U03 bridge**: `src/lib/audit/*.ts` と `src/lib/queues/*.ts` を re-export にし、`nextPorts.ts` が env / KV / Queue / `waitUntil` を供給する。
#### Test cases
| ID | 入力/操作 | 期待 |
| --- | --- | --- |
| T01 | golden: announcements 更新、events の CAS、`payload_exceeded`、redaction、`restore_strategy` の各種、actor X | 移動前後で SQL・params・`audit_logs` が一致 |
| T02 | 既存の `src/lib/audit/*.test.mjs`、`src/lib/queues/*.test.mjs` | 移動前と同じ件数が PASS |
| T03 | wake: dispatch 無効 / binding 無し / 送信失敗 / `waitUntil` 登録失敗 | CURRENT と同じ結果と KV 記録 |
| T04 | 境界検査 | OK |
#### Commands
```bash
node --import tsx --test src/lib/audit/auditGolden.execution.test.mjs
npm run test --workspace=@flamenode/server-core
node scripts/check-server-core-boundaries.mjs
npm run typecheck
npm run test:critical
npm run test:unit
npm run test:integration
npm run check:project-docs
npm run build
```
#### Ledger updates
STATUS は merge 直前の統合でだけ更新する。移した file は `FILE_MIGRATION_MATRIX.md` の行の target を bridge と core の場所に更新する。
#### DONE checklist
- [ ] golden の diff が 0（`id` / `created_at` を含む）
- [ ] 既存 test の件数が移動前と同じ
- [ ] 呼び出し側 file の diff が 0
- [ ] `check-audit-actor-x` など、source の text を読む script が新しい場所を読んでいる
#### STOP
- golden に 1 byte でも差が出たら止める。実行順（batch → best-effort wake）や strict / CAS の意味を変える必要が出たら止める。core が `next/*`, `react`, `server-only`, `@/`, `src/` を必要としたら止める。
#### Rollback
PR を revert（bridge が元の実装に戻る）。

### MIG-0614: static rebuild enqueue・通知 batch・visibility fence・public cache（core）
- **Model:** lead
- **Readiness:** NEEDS_REFINEMENT — MIG-0613 の merge 後に精緻化
- **Recipe:** R-CORE
- **Runtime:** S3
- **Depends on:** MIG-0613 / **Decisions:** D-10 DECIDED, D-09 DECIDED
- **Verified against:** `c5a62b4d` (2026-10-23)
#### Source snapshot
- `src/lib/staticRebuild/**` の enqueue / hooks、`src/lib/notifications/**` の batch、visibility fence の store と manifest（R2 を `BucketPort` で受ける）、`publicCache` の削除（`EdgeCachePort`）。`src/lib/publicData/loader.ts` は移さない。
- 実施した形（PR #360、`work-items/MIG-0614.md` が正本）: 通知 template と `format.ts` は `process.env` を既定引数に使うため core に入れず、core の batch builder に template builder を引数で渡す。R2 manifest は etag/CAS が要るので `BucketPort` ではなく module 内の `VisibilityManifestBucket` を維持。`publicVisibilityManifest.ts`（react cache + getEnv）は src に残す。MIG-0411 の producer 配線は U06 として後続（本 PR では配線しない）。
#### Owned paths
- 新規: `+packages/server-core/src/{staticRebuild,notifications,visibility,publicCache}/**`。変更: 該当する `src/lib/**` を bridge 化。
#### Micro-units
- **U01 golden**（移動前）→ **U02 staticRebuild** → **U03 notifications** → **U04 visibility fence** → **U05 publicCache**。
#### Test cases
| ID | 入力/操作 | 期待 |
| --- | --- | --- |
| T01 | golden（各 U の SQL + params + 行） | 移動前後で一致 |
| T02 | 既存の `src/lib/staticRebuild/*.test.mjs` など | 同じ件数 PASS |
| T03 | R2 / cache の失敗 | CURRENT と同じ fail-closed / best-effort |
#### Commands
```bash
npm run test --workspace=@flamenode/server-core
node scripts/check-server-core-boundaries.mjs
npm run typecheck && npm run test:critical && npm run test:unit && npm run test:integration && npm run test:static-rebuild && npm run check:project-docs
```
#### Ledger updates
STATUS は merge 直前の統合でだけ更新する。移した file は `FILE_MIGRATION_MATRIX.md` の行の target を bridge と core の場所に更新する。
#### DONE checklist
- [ ] golden の diff が 0。既存 test の件数が同じ。呼び出し側の diff が 0
#### STOP
- 公開データ層（`loader.ts`）を移したくなったら止める。ZERO_1102 §4 に反する形が必要になったら止める。
#### Rollback
PR を revert。

### MIG-0615: 可視性遷移 planner（video / event / xUser）
- **Model:** lead
- **Readiness:** NEEDS_REFINEMENT — MIG-0614 の merge 後に精緻化
- **Recipe:** R-CORE
- **Runtime:** S3
- **Depends on:** MIG-0614 / **Decisions:** D-10 DECIDED
- **Verified against:** `c5a62b4d` (2026-10-23)
#### Source snapshot
- `src/lib/video/videoVisibilityTransition*`、event / xUser の可視性遷移。`unstable_rethrow`（`next/navigation`）は、`RethrowFrameworkControl`（ports）を引数で受ける形にする。
#### Owned paths
- 新規: `+packages/server-core/src/visibility/**`。変更: 該当する `src/lib/**` を bridge 化し、`nextPorts.ts` が `unstable_rethrow` を供給する。
#### Micro-units
- **U01 golden** → **U02 video** → **U03 event** → **U04 xUser**。
#### Test cases
| ID | 入力/操作 | 期待 |
| --- | --- | --- |
| T01 | golden: 公開 → 非公開、非公開 → 公開、補償（compensation）、通知の post commit | 一致 |
| T02 | 既存の `videoVisibility*.test.mjs` | 同じ件数 PASS |
| T03 | framework の制御例外（redirect / notFound 相当） | 握りつぶさず再 throw |
#### Commands
```bash
npm run test --workspace=@flamenode/server-core
node scripts/check-server-core-boundaries.mjs
npm run typecheck && npm run test:critical && npm run test:unit && npm run test:integration && npm run check:project-docs
```
#### Ledger updates
STATUS は merge 直前の統合でだけ更新する。移した file は `FILE_MIGRATION_MATRIX.md` の行の target を bridge と core の場所に更新する。
#### DONE checklist
- [ ] golden の diff が 0。既存 test の件数が同じ。呼び出し側の diff が 0
#### STOP
- 遷移の順序・補償の意味を変える必要が出たら止める。
#### Rollback
PR を revert。

### MIG-0616: audit restore（core）
- **Model:** lead
- **Readiness:** NEEDS_REFINEMENT — MIG-0615 の merge 後に精緻化
- **Recipe:** R-CORE
- **Runtime:** S3
- **Depends on:** MIG-0615 / **Decisions:** D-10 DECIDED
- **Verified against:** `c5a62b4d` (2026-10-23)
#### Source snapshot
- `src/lib/audit/restore.ts`（744 行）と `restore*.test.mjs`。SA-011（audit restore）。
#### Owned paths
- 新規: `+packages/server-core/src/audit/restore.ts`。変更: `src/lib/audit/restore.ts` を bridge 化。
#### Micro-units
- **U01 golden**（restore の batch SQL + params、`audit_restore_runs`、`audit_logs`）→ **U02 move**。
#### Test cases
| ID | 入力/操作 | 期待 |
| --- | --- | --- |
| T01 | golden: restore の各 strategy、CAS 競合、YouTube eligibility | 一致 |
| T02 | 既存の `restore*.test.mjs` | 同じ件数 PASS |
#### Commands
```bash
npm run test --workspace=@flamenode/server-core
node scripts/check-server-core-boundaries.mjs
npm run typecheck && npm run test:critical && npm run test:unit && npm run test:integration && npm run check:project-docs
```
#### Ledger updates
STATUS は merge 直前の統合でだけ更新する。移した file は `FILE_MIGRATION_MATRIX.md` の行の target を bridge と core の場所に更新する。
#### DONE checklist
- [ ] golden の diff が 0。既存 test の件数が同じ。呼び出し側の diff が 0
#### STOP
- restore の意味（strict / CAS / 順序）を変える必要が出たら止める。
#### Rollback
PR を revert。

### MIG-0617: `apps/api` の Option A を core に置き換える
- **Model:** lead
- **Readiness:** NEEDS_REFINEMENT — MIG-0613、MIG-0614、MIG-0602 の merge 後に精緻化
- **Recipe:** R-CORE, R-API
- **Runtime:** S3
- **Depends on:** MIG-0613, MIG-0614, MIG-0602 / **Decisions:** D-10 DECIDED
- **Verified against:** `c5a62b4d` (2026-10-23)
#### Source snapshot
- MIG-0602 が `apps/api` に作った監査・wake の写し（Option A）。core と二重になっている部分を消す。テストの fake D1 は `.raw()` を持つ形に揃える。
#### Owned paths
- 変更: `apps/api/src/**` の監査・wake 部分、`apps/api/test/**`。削除: Option A の写し。
#### Micro-units
- **U01 差分の棚卸し**（写しと core の差を表にする）→ **U02 置き換え** → **U03 写しの削除**。
#### Test cases
| ID | 入力/操作 | 期待 |
| --- | --- | --- |
| T01 | MIG-0602 の既存 test | 置き換え前後で同じ件数 PASS |
| T02 | 写しと core の SQL + params | 一致 |
| T03 | `rg` で写しの呼び出しが 0 | 0 件 |
#### Commands
```bash
npm run build --workspace=@flamenode/api && npm run test --workspace=@flamenode/api
node scripts/check-server-core-boundaries.mjs
npm run typecheck && npm run test:unit && npm run check:project-docs
```
#### Ledger updates
STATUS は merge 直前の統合でだけ更新する。移した file は `FILE_MIGRATION_MATRIX.md` の行の target を bridge と core の場所に更新する。
#### DONE checklist
- [ ] Option A の写しが無い。API の応答・監査・wake が置き換え前と一致
#### STOP
- 写しと core の挙動が違うとき、どちらが CURRENT かを lead が決めるまで止める。
#### Rollback
PR を revert。

### MIG-0618: xid merge core
- **Model:** lead
- **Readiness:** NEEDS_REFINEMENT — MIG-0613 の merge 後に精緻化
- **Recipe:** R-CORE
- **Runtime:** S3
- **Depends on:** MIG-0613 / **Decisions:** D-10 DECIDED, D-03 DECIDED
- **Verified against:** `c5a62b4d` (2026-10-23)
#### Source snapshot
- X ID の merge（`src/lib/auth/xId*`、`planXIdMergeEventStaffOwnerProtection`）。MIG-0605 の user/X API が使う。
#### Owned paths
- 新規: `+packages/server-core/src/xid/**`, `+packages/server-core/test/xidMergeCore.test.mjs`, `+src/lib/xid/xidMergeGolden.execution.test.mjs`, `+src/lib/xid/xidMergeGolden.snapshot.json`。変更: `src/lib/xid/{merge,mergeBudget,mergeSafety}.ts`（bridge 化 / core の import）。
- 実装時の分け方（PR #373）: core は `src/` を import できないため、`merge.ts` の flow 関数（`captureXIdMergeRestoreSnapshot` / `executeApprovedXIdMergeRequest` / `restoreApprovedXIdMergeRevertRequest` / `buildMergeStaticRebuildTargets`）と `xUserVisibilityTransition.ts` は MIG-0614（`staticRebuild/enqueue`・`staticRebuild/types`）と MIG-0615（`publicVisibilityFenceTransition`）の後に移す。今回移したのは `mergeBudget.ts` / `mergeSafety.ts`（全体）と、`merge.ts` から切り出した `xid/mergeCore.ts`（定数・snapshot 型・`assertMergeRequest`・`parseSnapshot`・SQL fragment 2 つ）。`mergeAudits.ts` は export が TEST_ONLY のため移さない。`nextPorts` に足す port は無い。
- source を text で読む test は読み先だけを変える（assertion と件数は同じ）: `src/lib/xid/{mergeReferences.contract,mergeLifecycle.execution}.test.mjs`。
#### Micro-units
- **U01 golden** → **U02 move**。
#### Test cases
| ID | 入力/操作 | 期待 |
| --- | --- | --- |
| T01 | golden: merge の batch SQL + params、監査行、owner 保護 | 一致 |
| T02 | 既存の `xId*.test.mjs` | 同じ件数 PASS |
#### Commands
```bash
npm run test --workspace=@flamenode/server-core
node scripts/check-server-core-boundaries.mjs
npm run typecheck && npm run test:critical && npm run test:unit && npm run test:integration && npm run check:project-docs
```
#### Ledger updates
STATUS は merge 直前の統合でだけ更新する。移した file は `FILE_MIGRATION_MATRIX.md` の行の target を bridge と core の場所に更新する。
#### DONE checklist
- [ ] golden の diff が 0。既存 test の件数が同じ。呼び出し側の diff が 0
#### STOP
- 最後の owner の保護や共有 X の衝突の判定を変える必要が出たら止める。
#### Rollback
PR を revert。

### MIG-0629: admin audit settings + restore dry-run APIs（監査設定・dry-run API）
- **Model:** lead
- **Readiness:** NEEDS_REFINEMENT — MIG-0602 の merge 後（MIG-0613 は台帳未登録。登録され次第 Depends に追加）
- **Recipe:** R-API
- **Runtime:** S3
- **Depends on:** MIG-0602 / **Decisions:** D-01 DECIDED
- **Verified against:** `aacf4fd` (2026-10-15)
#### Source snapshot
| CURRENT | ID | file |
| --- | --- | --- |
| audit settings update | SA-009 | `src/lib/actions/audit-admin.ts#updateAuditLogSettingsAction` |
| audit dry run | SA-010 | `src/lib/actions/audit-admin.ts#getAuditLogDryRun` |
- MIG-0602 の分割で移動（2026-10-23）。SA-011（audit restore）は MIG-0616 で個別実装。ガードは MIG-0602 の `writeGuardMiddleware` + `costGuardMiddleware` を再利用する。
#### Owned paths
- 新規: `+apps/api/src/routes/admin/audit*.ts`、`+packages/contracts/src/admin/audit*.ts`
- 触らない: `src/lib/actions/**`
#### Micro-units
- **U01 audit settings**: SA-009。`updateAuditLogSettings` と同じ strict 監査（`system_settings` 更新 + 監査 1 件を 1 batch）。
- **U02 dry run**: SA-010。読み取りのみ（既定の admin read guard を使う）。
#### Test cases
| ID | 入力/操作 | 期待 |
| --- | --- | --- |
| T01 | 別 origin からの POST | 拒否 |
| T02 | 非admin | CURRENT と同じ拒否、監査0 |
| T03 | 設定更新の成功 | 監査1件が CURRENT と byte 一致 |
| T04 | dry run | 書き込み0、CURRENT と同じ件数 |
#### Commands
```bash
npm run build --workspace=@flamenode/api
npm run test --workspace=@flamenode/api
npm run typecheck
npm run test:critical
npm run test:unit
```
#### Ledger updates
`API_MATRIX.md` の SA-009〜010 に Hono エンドポイント。
#### DONE checklist
- [ ] SA-009 / SA-010 で成功・拒否・競合と監査が CURRENT と一致
- [ ] 本番 Route を変更していない
#### STOP
- 監査の意味を変える必要が出たら止める。
#### Rollback
Phase 6 共通契約のとおり。

### MIG-0607: Phase 6 Gate
- **Model:** lead
- **Readiness:** NEEDS_REFINEMENT — Phase Gate はエージェントが自動承認しない
- **Recipe:** R-EVIDENCE
- **Runtime:** N
- **Depends on:** MIG-0606 / **Decisions:** none
- **Verified against:** `aacf4fd` (2026-10-15)
#### Source snapshot
- `route-handlers/README.md` の RH-001〜033（33メソッド）。RH-010/011（Auth.js、`app/api/auth/[...nextauth]/route.ts`）は Phase 8 まで旧 Next に残す。
- MIG-0601〜0606, 0608 の merge 済みPRと `API_CPU_BENCHMARK.md`。
#### Owned paths
- 変更: `docs/migration/API_MATRIX.md`（33メソッドの移行先・fallback・テスト）, `docs/migration/STATUS.md`（承認後だけ）
#### Micro-units
- **U01 matrix**: 33メソッドすべてに Hono の場所、method 単位の routing、契約テスト、未移行の明示的な fallback を記録。
- **U02 review**: 独立レビューと人間の Phase Gate 承認を依頼。
#### Test cases
| ID | 入力/操作 | 期待 |
| --- | --- | --- |
| T01 | 33メソッド | 移行先または明示的な fallback がある |
| T02 | RH-010/011 | 旧 Next のまま、Phase 8 へ引き継ぎ記録がある |
#### Commands
```bash
npm run build --workspace=@flamenode/api
npm run check:public-api-contract
npm run check:public-api-leaks
npm run check:project-docs
```
#### Ledger updates
承認後に `STATUS.md` の MIG-0607 を DONE、MIG-0802 の依存を反映。
#### DONE checklist
- [ ] 33メソッドの disposition が揃っている
- [ ] RH-017 認証済み `/api/health/deep` が CURRENT の検査本体と一致している（MIG-0601 の fail-closed 仮実装が残っていない）
- [ ] 独立レビューの APPROVE と人間の Phase Gate 承認
#### STOP
- 人間の承認なしに STATUS を DONE にしない。
- Auth.js を Hono へ移したと記録しない。
#### Rollback
Gate のPRをrevert。
