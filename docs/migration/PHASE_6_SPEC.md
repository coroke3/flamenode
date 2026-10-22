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
| audit settings / restore | SA-009..011 | `src/lib/actions/audit-admin.ts` |
- Server Action の CSRF は Next が origin で守っている。Hono 側は `src/lib/auth/writeOriginGuard.ts` と同じ origin 検査を middleware で行う。
#### Owned paths
- 新規: `+apps/api/src/routes/admin/*.ts`, `+apps/api/src/middleware/writeOrigin.ts`, `+packages/contracts/src/admin/*.ts`
- 触らない: `src/lib/actions/**`（旧 Server Action は Phase 9 まで残す）
#### Micro-units
- **U01 write guard**: origin 検査と admin 権限の middleware。検証: `writeGuardCore.test.mjs` と同じケース。
- **U02 announcements / api-endpoints**: SA-004〜008 のエンドポイント。MIG-0303 の domain を呼ぶ。
- **U03 audit**: SA-009〜011。SA-011（audit restore）は個別実装のまま。cost guard（SA-016〜020）は MIG-0605 U06 の所有。
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
`API_MATRIX.md` の SA-004〜011 に Hono エンドポイント。`FILE_MIGRATION_MATRIX.md` の action 行の target に Hono の場所。
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

### MIG-0611: Personal read APIs（dashboard / library / settings / onboarding の参照 API）
- **Model:** lead
- **Readiness:** NEEDS_REFINEMENT — 実装済み（PR #333）。merge 後の状態は STATUS（DONE）が正本。認証付き参照 API のため lead が所有する
- **Recipe:** R-API
- **Runtime:** S2
- **Depends on:** MIG-0601, MIG-0608 / **Decisions:** D-02 DECIDED, D-07 DECIDED
- **Verified against:** `c5a62b4d` (2026-10-23)
- **Why:** MIG-0701（`apps/app` Personal SPA）が参照できる Hono の読み取り API が無い（`work-items/MIG-0701.md` Blocker B1）。CURRENT の `app/(auth)/**` は Server Component が D1 を直接読み、`RH-xxx` にも MIG-0601〜0605 にも割り当てが無い。
- **URL（新設。CURRENT に `/api/*` の対応物は無い）:** `GET /api/personal/session`, `/api/personal/dashboard`, `/api/personal/library`, `/api/personal/settings`, `/api/personal/onboarding`。`/api/v1` は作らない。`RH-xxx` と衝突しないよう `/api/personal/` に固定する。
#### Source snapshot
| CURRENT | 参照するもの | file |
| --- | --- | --- |
| 利用者解決（`AuthSessionUser`） | `getCurrentUserContext`: user 行 + `is_tos_accepted` / `accepted_terms_version_id` / `terms_reaccept_required`（最新 major 版からの導出）+ linked X + `resolveActiveXUserId` | `src/lib/auth/currentUser.ts`, `src/lib/auth/guard.tsx`, `src/lib/auth/resolveActiveXId.ts`, `src/lib/auth/headerLinkedXUsers.ts`, `src/lib/terms/reaccept.ts` |
| onboarding 状態 | `getOnboardingState`（linked X + 最新 pending 申請） | `src/lib/auth/onboarding.ts`, `src/lib/slots/reservationIdentity.ts`, `packages/domain/src/slots/reservationIdentity.ts` |
| dashboard | linked X、自分の作品 8+1、共同編集 8+1（DISTINCT）、チャプター 8+1、アクティブ枠 1 + event、統計 2 本（いいね・再生・件数 / event 件数 UNION） | `app/(auth)/dashboard/page.tsx` |
| library | like / bookmark（public のみ）、mine、collab、chapters。24 件/page、最大 500 page、`LIMIT 25 OFFSET`、反対タブの有無 | `app/(auth)/dashboard/library/page.tsx`, `src/lib/db/displayExpr.ts` |
| settings | linked X（profile / contact / youtube / other links / request 時刻）、申請履歴 50、Active X の icon 候補 12 / youtube channel 候補 24 | `app/(auth)/dashboard/settings/page.tsx`, `src/lib/auth/xIdentity.ts`, `src/lib/db/xIconResolution.ts`, `src/lib/db/youtubeChannelCandidates.ts`, `src/lib/profileContact.ts` |
| onboarding | 状態 + 規約本文（`loadStaticRulesPage` → R2 `rules/current.json`、無ければ D1 の公開中の最新規約、無ければクライアント側の `DEFAULT_TERMS_*`） | `app/(auth)/onboarding/page.tsx`, `src/lib/publicData/staticRulesCore.ts`, `src/lib/publicData/degradedQueries.ts` |
#### Owned paths
- 新規: `+apps/api/src/routes/personal/{index,context,sql,candidates,session,dashboard,library,settings,onboarding}.ts`, `+apps/api/test/personal.parity.test.mjs`, `+apps/api/test/support/{personalHarness,personalSeed}.mjs`
- 新規: `+packages/contracts/src/personal/{shared,dashboard,library,settings,onboarding,index}.ts`（DTO と Zod schema）
- 変更: `apps/api/src/app.ts`（mount の追加だけ）, `packages/contracts/src/index.ts`
- 触らない: `apps/api/src/auth/session.ts`, `apps/api/src/middleware/**`（PR #331 が所有）, `app/**`（本番切替まで旧実装を維持）, 書き込み（MIG-0702）
#### Micro-units
- **U00 docs**: 本 Work Order と `work-items/MIG-0611.md`（STATUS は更新しない）。
- **U01 context + session**: `context.ts`（CURRENT `getCurrentUserContext` / `getOnboardingState` と同じ解決。1 statement）と `GET /api/personal/session`。
- **U02 dashboard**: `GET /api/personal/dashboard`。
- **U03 library**: `GET /api/personal/library?tab=&page=`。
- **U04 settings**: `GET /api/personal/settings?tab=&x=&onboarding=`。
- **U05 onboarding**: `GET /api/personal/onboarding`。`maybeMarkOnboardingComplete`（GET 中の UPDATE）は再現せず MIG-0702 の POST へ引き継ぐ（lead 決定 2026-10-23）。
- **U06 tests**: `node:sqlite` に `migrations/*.sql` 全部を適用し、CURRENT の drizzle クエリ（page.tsx の写し）と同じ seed で行・順序・件数が一致することを確認。
#### Test cases
| ID | 入力/操作 | 期待 |
| --- | --- | --- |
| T01 | cookie なし / 期限切れ | 全 5 endpoint が 401 |
| T02 | BAN 済み利用者 | 全 5 endpoint が 403 |
| T03 | 全 5 endpoint の成功・401・403 | `Cache-Control: private, no-store` |
| T04 | 同じ seed で CURRENT クエリと比較 | dashboard の 5 区画、library の 5 タブ、settings、onboarding 状態が一致 |
| T05 | `voided` / 非公開 / 他人の行 / 承認前 X | CURRENT と同じく含めない |
| T06 | library の page / 範囲外 page / 不正 tab | 24 件/page、`page` は 1..500 に丸め、不正 tab は `like` |
| T07 | 承認済み X 81 件 | `json_each` 経路でも CURRENT の述語と同じ結果、bind 数 ≤ 100 |
| T08 | terms 状態（未同意 / 最新 major 未同意 / 同意済み） | `needsTermsAcceptance` が CURRENT の導出と一致 |
#### Commands
```bash
npm run build --workspace=@flamenode/contracts
npm run build --workspace=@flamenode/api
npm run test --workspace=@flamenode/api
npm run typecheck
npm run test:critical
npm run test:unit
npm run check:public-api-leaks
```
#### Ledger updates
`API_MATRIX.md` に Personal read API の行（CURRENT の画面 → Hono の場所、CPU は未計測）。`FILE_MIGRATION_MATRIX.md` に新規 file の行。STATUS は merge 直前の統合でだけ更新する。
#### DONE checklist
- [ ] 5 endpoint が同じ seed で CURRENT と同じ行・順序・件数を返す（private / deleted / banned / visibility の条件が同じ）
- [ ] 全 endpoint が `requireAuth` 配下で、全応答が `Cache-Control: private, no-store`
- [ ] 全クエリが `LIMIT` 付きで N+1 が無い。各 endpoint の D1 statement が session 照合を含め 3 以内（テストで assert）
- [ ] D1 の bind が 100 以下（承認済み X が多い場合も）
- [ ] 本番 Route・Remote D1・secret を変更していない
- [ ] 独立レビュー（他agentまたは人間）の APPROVE
#### STOP
- `GET` の中で書き込みが必要になったら止める。`maybeMarkOnboardingComplete`（`onboarding_completed_at` の条件付き UPDATE）は認可に使われない補助マーカーなので、この task では再現せず、MIG-0702 で `POST` として扱う（lead 決定 2026-10-23: MIG-0702 の Work Order に引き継ぎ済み）。
- 規約本文: 可視性 guard（enforce 時は manifest が無ければ fail closed）は再現する。Cache API と miss 時の rebuild enqueue は GET が書かないため再現しない（既知の差）。未公開の規約は返さない。
- `session.ts` / `middleware` の変更が必要に見えたら止める（PR #331 が所有）。
- 公開してよいか判断が要る列（email 等）を DTO に足したくなったら止める。
#### 記録した既知の差・例外（挙動を変える改善ではなく S2 制約によるもの）
- 連携 X の読み取りは `MAX_LINKED_X_USERS = 100`（`ORDER BY x_users.id`）。CURRENT は無制限なので、101 件以上の連携は返さない（ZERO_1102 S2: LIMIT は名前付き定数 100 以下）。
- dashboard の統計 aggregate クエリ（`SUM`/`COUNT`）は 1 行を返すため `LIMIT` を持たない（CURRENT と同じ。event 件数も 1 行）。
- settings の応答は profile 文字列が長いと S2 の 64KB を超えうる（CURRENT が同じ内容を描画するため切り詰めない）。profile は JSON 列ではなく行として読む。
- D1 の `json_group_array` は順序付き FROM サブクエリの行順で集約される挙動に依存する。parity テストが順序付きの全区画を CURRENT と比較する。
- statement 数（session 照合を含む）: session 2 / dashboard 3 / library 3 / settings 3 / onboarding 2（規約の D1 fallback 時 3）。テストが 3 以内を assert する。
#### Rollback
PRをrevert。`apps/api` に route が増えるだけで、本番 Route・D1・旧 Next は変わらない。

### MIG-0626: Admin 読み取り API その B（settings・audit・ops・残り）
- **Model:** lead
- **Readiness:** NEEDS_REFINEMENT — MIG-0625 の分担表の確定後
- **Recipe:** R-API
- **Runtime:** S2
- **Depends on:** MIG-0601, MIG-0608 / **Decisions:** D-05 DECIDED
- **Verified against:** `c5a62b4d` (2026-10-23)
#### Source snapshot
- G13 MIG-0625 に含まれない admin page: settings、audit、notifications、static-builds、workers、health、security、youtube-sync、quota など（`CURRENT_ROUTES.md` の Admin 45 の残り）。
- 外部サービスの診断（Cloudflare、YouTube）を読む page は、API から外部へ出る request 数を `ZERO_1102.md` の予算内にする。
#### Owned paths
- 新規: `+apps/api/src/routes/adminRead/settings.ts`, `+apps/api/src/routes/adminRead/audit.ts`, `+apps/api/src/routes/adminRead/ops.ts`, `+apps/api/test/adminReadOps.parity.test.mjs`
- 変更: `packages/contracts/src/adminRead.ts`（MIG-0625 で作成）
- 触らない: `app/**`, `src/lib/actions/**`
#### Micro-units
- **U01 inventory**: 残り page の loader を列挙し、MIG-0625 と合わせて Admin 45 を漏れなく覆うことを表で示す。
- **U02 contract** → **U03 routes** → **U04 parity**。
#### Test cases
| ID | 入力/操作 | 期待 |
| --- | --- | --- |
| T01 | Admin 45 すべて | MIG-0625 または本 task の endpoint がある |
| T02 | 正常系 | CURRENT loader と DTO が一致 |
| T03 | admin 以外 | 拒否 |
| T04 | D1 statement 数 | 1 endpoint あたり3件以下 |
| T05 | 外部診断が失敗 | CURRENT と同じ劣化表示 |
#### Commands
```bash
npm run build --workspace=@flamenode/api
node --test apps/api/test/adminReadOps.parity.test.mjs
npm run check:public-api-leaks
npm run typecheck
npm run test:unit
```
#### Ledger updates
`API_MATRIX.md` に行。Admin 45 の担当表を `ROUTE_MATRIX.md` に追記。
#### DONE checklist
- [ ] Admin 45 の全 page に read endpoint がある
- [ ] secret・token が response に出ない
#### STOP
- 外部 request が budget を超えるなら lead に確認する。
#### Rollback
PRをrevert。

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
