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
- **U04 binding / vars 表（coverage gap G16）**: Hono Worker（`apps/api/src/env.ts`）が持つ binding と vars を表にする。CURRENT の `wrangler.toml`（flamenode-web）の `DB`, `KV`, `BUCKET`, `ASSETS`, `WORKER_SELF_REFERENCE`、queue producer 3、vars `PUBLIC_DEGRADED_D1_ENABLED`, `PUBLIC_VISIBILITY_GUARD_MODE`, queue flags、placement smart、`nodejs_compat`、`global_fetch_strictly_public` のうち、変更系 parity に必要なものを `env.ts` に反映する。Worker 側の定義と注入は MIG-0628。
#### Test cases
| ID | 入力/操作 | 期待 |
| --- | --- | --- |
| T01 | 別 origin からの POST | 拒否 |
| T02 | 非admin | CURRENT と同じ拒否、監査0 |
| T03 | 成功 | 監査1件、公開反映 enqueue が CURRENT と同じ |
| T04 | CAS 競合 | CURRENT と同じ競合結果 |
| T05 | `apps/api/src/env.ts` の key（G16） | 移行済み SA が必要な key の和集合と一致 |
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
- **Readiness:** NEEDS_REFINEMENT — READY（lead 決定 D-13-40〜66 で残りの unit を確定。U02a / U02b は今すぐ着手できる。U03a（SA-087）は D-14-8 で MIG-0640 へ分割。U02c / U03b / U03c は MIG-0633 が STATUS で DONE になるまで着手しない（D-13-44）。実装は Sonnet、レビューは Opus）
- **Recipe:** R-API, R-CORE
- **Runtime:** S2, S3
- **Depends on:** MIG-0602, MIG-0304 / **Decisions:** D-03 DECIDED, D-0603-1 DECIDED, D-13-40〜66
- **Verified against:** `a1b910b4` (2026-10-25)
#### Source snapshot
| CURRENT | ID | file | 状態 |
| --- | --- | --- | --- |
| video detail | RH-030 | `app/api/videos/[id]/route.ts` | DONE（#336、`apps/api/src/routes/videos/detail.ts`） |
| chapters | SA-012..015 | `src/lib/actions/chapter.ts` | DONE（#393、`apps/api/src/routes/videos/chapters.ts`） |
| video list / viewer overlay | RH-032 / RH-031 | `app/api/videos/route.ts`, `app/api/videos/[id]/viewer-overlay/route.ts` | **MIG-0634 へ移管** |
| admin visibility | SA-001..003 | `src/lib/actions/admin.ts:70,77,85`（`setVideoStatus`） | U02a/U02b |
| moderation case | SA-043/044 | `src/lib/actions/moderation-admin.ts:109,260` | U02b（MIG-0605 から移管、D-13-40） |
| manage visibility | SA-040..042 | `src/lib/actions/manage-video.ts:58,65,73`（`canEditEvent` = `src/lib/auth/ownership.ts:306`） | U02c（MIG-0633 後） |
| like / bookmark | SA-087 | `src/lib/actions/video/interaction.ts:243` | **MIG-0640 へ分割**（D-14-8） |
| collaborators / members | SA-082..085 | `src/lib/actions/video-collab-perms.ts:891,949,995`, `src/lib/actions/video/adminMembers.ts:67` | U03b（MIG-0633 後） |
| submit / update | SA-086, SA-088, SA-089 | `src/lib/actions/video/{createFreeVideo,submitSlotVideo,updateVideo}.ts` | U03c（MIG-0633 後。別 MIG 推奨） |
- 解消済みの blocker（2026-10-25 に code で確認）: B-1/B-2（`writeGuardMiddleware` の `requiredRole` / `activeX`、`apps/api/src/middleware/writeOrigin.ts:103-171`）、B-5（core `buildStaticRebuildQueueBatch` の prefetch 0、`packages/server-core/src/staticRebuild/enqueue.ts:69`。`chapters.ts:33` が使用済み）。B-3 は半分解消: planner は core（`packages/server-core/src/visibility/videoTransition.ts:195` `planVideoVisibilityTransition`、`:367` `preCommitVideoVisibilityDepublicization`、`:425` `runVideoVisibilityTransitionPostCommit`、`:626` `handleVideoVisibilityMutationFailure`）にあり、無いのは Hono 用 host（型 `VideoVisibilityTransitionHost`、`:45`）と `src/lib/video/videoVisibilityStatusAction.ts`（164 行、`executeVideoVisibilityStatusMutation`）、`src/lib/video/videoVisibilityStatusCore.ts#loadVideoRebuildEventIds`、`src/lib/admin/videoReviewQueueOrder.ts#attachApproveAndNextHref`（119 行）、`src/lib/moderation/voidCaseType.ts`（11 行）。
- Next の host（写し元）: `src/lib/video/videoVisibilityTransition.ts:47-82`（manifest = `nextVisibilityManifestHost`、通知 builder、export cache 無効化、公開 cache 削除、通知 wake）。core 側の部品: `visibility/manifestR2.ts#readVisibilityManifestObject` / `#putVisibilityManifestWithCas`、`publicCache/delete.ts#deletePublicJsonCaches`、`notifications/videoStatusNotify.ts#buildVideoStatusChangeNotificationBatch`、`moderation/openCases.ts`。
- 公開画面から直接呼ぶ部品: `src/components/video/InteractionButton.tsx:6`（SA-087）, `VideoStatusForm.tsx:7-8`（SA-001/040）。
#### Owned paths
- U02a: `+apps/api/src/visibility/videoTransitionHost.ts`, `+apps/api/src/visibility/publicCacheKeys.ts`（D-13-42 の定数）, `+packages/server-core/src/publicCache/eventExportKeys.ts`, `+packages/server-core/src/video/visibilityStatusAction.ts`（`executeVideoVisibilityStatusMutation`, `loadVideoRebuildEventIds`）, `+packages/server-core/src/video/reviewQueueOrder.ts`（`attachApproveAndNextHref`）, `+apps/api/test/videoTransitionHost.test.mjs`。変更（bridge）: `src/lib/api/eventExportCache.ts`, `src/lib/video/videoVisibilityStatusAction.ts`, `src/lib/video/videoVisibilityStatusCore.ts`, `src/lib/admin/videoReviewQueueOrder.ts`, `packages/server-core/package.json`（exports）
- U02b: `+apps/api/src/routes/admin/videoStatus.ts`, `+apps/api/src/routes/admin/moderation.ts`, `+packages/contracts/src/admin/videoStatus.ts`, `+apps/api/test/adminVideoStatus.parity.test.mjs`。変更: `apps/api/src/routes/admin/index.ts`（route 2 行）, `packages/contracts/src/admin/index.ts`（export 1 行）
- U02c / U03b / U03c: MIG-0633 の後に lead が file を確定する（`apps/api/src/routes/manage/videoStatus.ts`, `apps/api/src/routes/videos/collaborators.ts` などを予定）
- 触らない: `src/lib/actions/**`, `app/api/**`, `apps/api/src/routes/videos/detail.ts`, `STATUS.md`
#### Micro-units
- **U02a Hono 可視性 host**（R-CORE + R-API）: D-13-42 のとおり移動と定数の写し。host は `c.env.BUCKET` に core の manifest read / CAS put、`caches.default` に `deletePublicJsonCaches`、`buildNotificationBatch` は core の builder に `NEXT_PUBLIC_SITE_URL` を束ねて渡す、`wakeNotificationQueueAfterCommit` は何もしない（D-13-41）、`rethrowFrameworkControl` は no-op。test: 定数 drift（src の実値と一致）、host の各メソッドが CURRENT host と同じ key 集合で呼ばれる。
- **U02b SA-001..003 + SA-043/044**: `POST /api/admin/videos/:videoId/status`（body: `status`, `reason`, `case_id`, `and_next`, `review_event_id`, `force_notify`, `void_reason_category`。SA-001 = `status: "public"`、SA-002 = それ + `and_next: "1"`、SA-003 = 任意 status。CURRENT `admin.ts:70-85` の `formData.set` と同じ写像）、`POST /api/admin/moderation/cases`（SA-043）、`POST /api/admin/moderation/cases/:caseId/status`（SA-044）。guard: admin writeGuard + CostGuard（`admin_video_status` / `admin_moderation_create` / `admin_moderation_update`）。順序は CURRENT `setVideoStatus`（`admin.ts:85-221`）と同じ: 入力検証（domain `validateAdminVideoStatusInput`）→ video → `validateVideoPublicEligibility` → 同一 status は `SAME_VIDEO_STATUS_MESSAGE` → rebuild event ids → planner → voided の case open / resolve → `executeVideoVisibilityStatusMutation`（core へ移したもの）→ post-commit → `attachApproveAndNextHref`。失敗は `handleVideoVisibilityMutationFailure`（fence の補償）。parity: 実 CURRENT action と同じ node:sqlite で audit / `static_rebuild_queue` / `notification_outbox` / `video_moderation_cases` / manifest（fake bucket）を field 単位で比較。`DOCUMENTED DIFFERENCE D-0603-1` と `DOCUMENTED DIFFERENCE D-13-41`（CURRENT の wake 数 vs 0）を1件ずつ。D1 文数を test で固定（D-13-43）。
- **U03a**: MIG-0640 へ分割（D-14-8）。
- **U02c SA-040..042**（MIG-0633 後）: `POST /api/manage/events/:eventId/videos/:videoId/status`。権限は MIG-0633 の core `canEditEvent(..., "video.status")`。U02a の host を使う。
- **U03b SA-082..085**（MIG-0633 後）、**U03c SA-086/088/089**（MIG-0633 後。G21 の body 上限は MIG-0636 の `apps/api/src/middleware/bodyLimit.ts` を使う。lead が別 MIG に切り出すなら本 Work Order から消す）。
- **Final audit**: SA-001..003/012..015/040..044/082..089 と UX/FN の対応表。
#### Rules
- D-0603-1（queue 行は同じ batch、wake 0）と D-13-41（通知 wake 0）を全 write に適用。route file の先頭 comment に両方を書く。
- 共有 module（`apps/api/src/middleware/**`, `apps/api/src/auth/session.ts`）は変えない。変える必要が出たら STOP。
#### Test cases
| ID | 入力/操作 | 期待 |
| --- | --- | --- |
| T01 | 権限ごとの編集（MIG-0304 T01 と同じ表） | CURRENT と一致 |
| T02 | Active X 0件でいいね | MIG-0640 で満たす |
| T03 | チャプター削除 | コメントが監査の before に残る（U02b で済み） |
| T04 | 公開→非公開（admin） | manifest の block が D1 更新より先、通知・queue 行・監査が CURRENT と一致、wake 0 |
| T05 | voided へ / voided から（case あり / なし） | case open / resolve と拒否文言が CURRENT と一致 |
| T06 | D1 batch 失敗で公開→非公開 | fence の補償が CURRENT と一致 |
| T07 | いいねの同時実行（UNIQUE 競合） | MIG-0640 で満たす |
| T08 | 別 origin・未ログイン・BAN・非 admin（U02b） | CURRENT と同じ拒否、書き込み 0 |
#### Commands
```bash
npm run build --workspace=@flamenode/api
npm run test --workspace=@flamenode/api
npm run test --workspace=@flamenode/server-core
node scripts/check-server-core-boundaries.mjs
npm run test:critical
npm run check:video-interactions-auth
npm run typecheck && npm run test:unit && npm run test:integration
```
#### Ledger updates
`API_MATRIX.md` の SA-001〜003, 040〜044, 082〜089 に Hono endpoint と D-13-41/64 の参照。RH-031/032 は MIG-0634。`FILE_MIGRATION_MATRIX.md` に新規 file と bridge の行。
#### DONE checklist
- [ ] U02a / U02b / U02c / U03b / U03c（または lead が切り出した先）と Final audit が DONE（U03a は MIG-0640）
- [ ] 権限判定の結果が CURRENT と全件一致
- [ ] wake 0 の差（D-0603-1 / D-13-41）が test 名 `DOCUMENTED DIFFERENCE` で残っている
#### STOP
- 権限判定が1件でも変わったら止める。
- planner（core、Next と共有）の挙動を変える必要が出たら止める。
- Queue binding、本番 R2 manifest の読み書き、Route 切替が必要になったら止める（owner の明示承認事項）。
- U02c / U03b / U03c を MIG-0633 DONE より前に始めない。
#### Rollback
Phase 6 共通契約のとおり（U02a の移動は bridge なので revert で戻る）。

### MIG-0604: event/slot APIs（イベント・枠 API）
- **Model:** lead
- **Readiness:** NEEDS_REFINEMENT — BLOCKED（MIG-0633 と MIG-0639 待ち。MIG-0639 は D-12 の live slots 6000 枠の判定（additive paging の要否）を U04 の前に出す、D-14-7）。U01 RH-014（#391、5d4e980）、U02 RH-020..022 と SA-036（#334）は merge 済み。残りは U04（SA-021..035, 037..039, 056..068）と Final audit。micro-unit の正本は [`TASK_MICRO_UNITS.md`](TASK_MICRO_UNITS.md) MIG-0604
- **Recipe:** R-API
- **Runtime:** S2, S3
- **Depends on:** MIG-0602, MIG-0305, MIG-0633, MIG-0639 / **Decisions:** D-12 DECIDED, D-13-48, D-14-7
- **Verified against:** `a1b910b4` (2026-10-25)
#### Source snapshot
| CURRENT | ID | file | 状態 |
| --- | --- | --- | --- |
| event list | RH-015 | `app/api/events/route.ts` | MIG-0631 で DONE |
| slot viewer overlay | RH-014 | `app/api/events/[id]/slots/viewer-overlay/route.ts` | DONE（#391） |
| live slots / submissions / summary | RH-020..022 | `app/api/live/events/[id]/{slots,submissions,summary}/route.ts` | DONE（#334） |
| event export | RH-012 / RH-013 | `app/api/event-endpoints/[id]/release/route.ts`, `app/api/event-endpoints/[id]/route.ts` | RH-012 は MIG-0631 で DONE、RH-013 は MIG-0632 |
| event / staff / template / playlist | SA-021..039 | `src/lib/actions/event-*.ts`, `event-youtube-playlist.ts` | SA-036 DONE、残り U04 |
| slot | SA-056..068 | `src/lib/actions/slot*.ts` | U04 |
- 解消済み: B2（RH-014）、B5（MIG-0617 で `apps/api` が core `mutateWithAudit` を使い、監査入力 `WriteAuditLogInput` が `restore_strategy` / `actor_x_user_id` を持つ。`packages/server-core/src/audit/types.ts:75,81`）、B4 のうち guard 側（`writeGuardMiddleware` の `requiredRole: null`、`writeOrigin.ts:151,170`）。残る B4 は非 admin の event 権限と owner 0 guard（MIG-0633）。B6: SA-035 は `src/lib/admin/eventTemplateSettings.ts#snapshotFromEvent` を domain へ移す（同じ file の `parseEventTemplateSnapshot` / `snapshotToFormInitial` も一緒に移し、MIG-0705 が使う。D-13-48）。SA-037 は GET が admin write guard を通る CURRENT の形（拒否時 `[]`）の写像を U04 で決める。
- 公開画面の `src/components/event/SlotGrid.tsx:15` が `@/lib/actions/slot` を直接呼ぶ。Phase 5 の枠 Island はこの MIG の API を使う。
#### Owned paths
- 新規: `+apps/api/src/routes/events/*.ts`（`publicList.ts` / `publicRelease.ts` / `publicSnapshot.ts` は MIG-0631 の所有で触らない）, `+apps/api/src/routes/live/*.ts`, `+packages/contracts/src/event*.ts`
- 触らない: `src/lib/actions/**`, `app/api/events/**`, `app/api/live/**`
#### Micro-units
- U04 と Final audit は [`TASK_MICRO_UNITS.md`](TASK_MICRO_UNITS.md) MIG-0604 のとおり。U04 は MIG-0633 の core（`canEditEvent`, `remainingOperableEventOwnerSql` の owner 0 guard）を使い、写しを作らない。FIX-0604-1（slotViewerOverlay の `visibility_status` 欠落の修正）は MIG-0633 の後に lead が別 PR で追跡。
#### 記録した既知の差・例外（lead 決定。挙動を変える改善ではなく S2 制約との衝突）
- live slots の `MAX_LIVE_SLOTS = 6000` は ZERO_1102 S2 を超えるが CURRENT（`liveApi.ts`）と同じため変えない（D-12 で承認。MIG-0606 の 6000 枠入力で warm max ≥ 7ms のときだけ additive paging）。
- RH-014: 本人の枠 LIMIT 100 / 64 KiB で fail-closed、own-slots 読み失敗は 503、ORDER BY の明示、pending 100 件、`operatorOverrideAllowed` 常に false（CURRENT の挙動）。D-12 で承認。詳細は `work-items/MIG-0604.md` Known differences。
#### Test cases
| ID | 入力/操作 | 期待 |
| --- | --- | --- |
| T01 | 最後の owner の解任 | 拒否 |
| T02 | 同じ枠の同時予約 | 1件だけ成功 |
| T03 | live API の cache header | CURRENT と同じ（5秒）（済み） |
| T04 | export の CORS と認可 | MIG-0632 の DONE で満たす |
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
`API_MATRIX.md` の SA-021〜039, 056〜068 に Hono エンドポイント。RH-012 / RH-015 は MIG-0631（DONE）、RH-013 は MIG-0632。
#### DONE checklist
- [ ] U01（済み）、U02（済み）、U04 と Final audit が DONE
- [ ] owner 0 防止と予約の原子性がテストで実証されている
#### STOP
- 予約の transaction 境界を変える必要が出たら止める。
- MIG-0633 と MIG-0639 が DONE になる前に U04 を始めない（MIG-0639 の D-12 判定で paging の追加 unit が要ると出たら、それを U04 に含める）。
#### Rollback
Phase 6 共通契約のとおり。

### MIG-0605: user/X/admin APIs（ユーザー・X・管理 API）
- **Model:** lead
- **Readiness:** NEEDS_REFINEMENT — BLOCKED（MIG-0633 待ち）。2026-10-25 に残りを MIG-0636 / 0637 / 0638 へ分けた（D-13-56）。本 task に残るのは SA-090/091、D-03 fan-out dry-run、D-04 checkpoint、U07、Final audit。micro-unit の正本は [`TASK_MICRO_UNITS.md`](TASK_MICRO_UNITS.md) MIG-0605
- **Recipe:** R-API, R-EVIDENCE
- **Runtime:** S3, N
- **Depends on:** MIG-0602, MIG-0306, MIG-0633 / **Decisions:** D-03 DECIDED, D-04 DECIDED, D-13-56, D-13-57
- **Verified against:** `a1b910b4` (2026-10-25)
#### Source snapshot
| CURRENT | ID | 担当 |
| --- | --- | --- |
| account summary | RH-001 | DONE（#335、`apps/api/src/routes/account/summary.ts`） |
| media proxy | RH-016, RH-033 | DONE（#335、`apps/api/src/routes/media/proxies.ts`） |
| spreadsheet read | RH-003, RH-007, RH-009 | DONE（#392、`apps/api/src/routes/admin/spreadsheet/read.ts`） |
| spreadsheet write / import, legacy import, RH-019, RH-023..025, RH-027/028 | RH-002, RH-004..008, RH-019, RH-023..025, RH-027, RH-028 | MIG-0638（RH-004..008）、MIG-0645（RH-002）、MIG-0646（RH-023..025）、MIG-0647（RH-027/028）、MIG-0648（RH-019）（D-14-11） |
| terms, Active X, profile, link request | SA-074..076, SA-098..105 | MIG-0636（SA-098..105）、MIG-0641（SA-074..076、D-14-9） |
| cost guard, notifications, permissions, rules, static rebuild, user admin, youtube sync, visibility repair, X merge admin | SA-016..020, SA-045..055, SA-069..073, SA-077..081, SA-092..097, SA-106, SA-110 | MIG-0637（SA-016..020 / 077..081）、MIG-0642（SA-045..049 / 051..055）、MIG-0643（SA-050 / 069..073 / 106）、MIG-0644（SA-092..097 / 110）（D-14-10） |
| moderation case | SA-043/044 | MIG-0603 U02b（D-13-40） |
| X link request review | SA-090/091 | **本 task U05x**（`src/lib/actions/xid-admin.ts`、権限 `canManageXIdLinkRequests` = `src/lib/auth/ownership.ts:174-217`、MIG-0633 の core） |
- 解消済み: B-1（`writeGuardMiddleware` の `requiredRole`、`writeOrigin.ts:151,170`）、B-2（#392）、B-3 / B-6 の「`apps/api` は src/lib を import できない」は `publicApi` / `publicDto` / `artifactVisibility` が server-core に移った（#398、`packages/server-core/src/publicData/`）ので MIG-0638 で解ける。
- 公開画面の `src/components/user/useActiveXSwitcher.ts:5`（SA-098）と `app/(public)/rules/page.tsx:3,95`（SA-075）は MIG-0636。
#### Owned paths
- 新規: `+apps/api/src/routes/xid/linkRequests.ts`, `+packages/contracts/src/xidLinkRequest.ts`, `+apps/api/test/xidLinkRequests.parity.test.mjs`, `+scripts/d03-fanout-dry-run.mjs`, `+scripts/d03-fanout-dry-run.test.mjs`, `+docs/migration/D04_CUTOVER_CHECKPOINT.md`
- 変更: `apps/api/src/app.ts`（mount 1 行）, `docs/migration/API_MATRIX.md`, `docs/migration/route-handlers/README.md`（U07 の担当列）
- 触らない: `src/lib/actions/**`, `app/api/**`、子 task（MIG-0636〜0638）の owned paths
#### Micro-units
- **U05x SA-090/091**（MIG-0633 後）: `POST /api/xid/link-requests/:requestId/approve`, `/reject`。guard は `writeGuardMiddleware({ requiredRole: null, activeX: { feature: "xid_links" } })`（CURRENT `xid-admin.ts:78`）+ core の `resolveXIdLinkRequestAuthorization`（監査の `actor_x_user_id` もそこから）。
- **U05d D-03 fan-out dry-run**: `video_interactions_auth` → 承認済み owner X 全部への複製を node:sqlite で計算し、件数・衝突・like count の差分を出す script（`OPEN_DECISIONS.md` D-03、`ACTIVE_X_MIGRATION_PLAN.md`）。Remote D1 は読まない。入力は local の migration 済み DB だけ。
- **U05e D-04 checkpoint**: 一括 cutover の手順と停止点を `D04_CUTOVER_CHECKPOINT.md` に書く。実行は owner の別承認。
- **U07 coverage**: RH-001〜033 の全メソッドに担当 MIG（RH-010/011 は Phase 8）があることを表にする。SA-107〜110 の行（SA-107 = MIG-0703 / MIG-0802、SA-108/109 = MIG-0602 の型付き API へ写す、SA-110 = MIG-0637）。
- **Final audit**: MIG-0602/0603/0604/0636〜0638/0640〜0648 と SA / RH の二重所有が無いこと。
#### Test cases
| ID | 入力/操作 | 期待 |
| --- | --- | --- |
| T01 | account summary の未ログイン | CURRENT と同じ `no-store` 応答（済み） |
| T02 | media proxy に外部URL | SSRF 拒否（済み） |
| T04 | X merge の revert | MIG-0637 で満たす |
| T08 | 権限の無い staff が link request を承認 | CURRENT と同じ拒否、書き込み 0 |
| T09 | D-03 dry-run（manager リンク・申請中・同じ X が複数 Auth User） | D-03 の規則どおり対象外 / 1 行に畳む。書き込み 0 |
| T10 | RH-001〜033 の担当表 | RH-010/011 以外に空欄なし |
#### Commands
```bash
npm run build --workspace=@flamenode/api
npm run test --workspace=@flamenode/api
node --test scripts/d03-fanout-dry-run.test.mjs
npm run check:x-link-dependencies
npm run check:audit-actor-x
npm run test:critical
npm run test:unit
```
#### Ledger updates
`API_MATRIX.md` の SA-090/091 に Hono endpoint。担当表は `route-handlers/README.md`。子 task の行は子 task が書く。
#### DONE checklist
- [ ] U05x / U05d / U05e / U07 / Final audit が DONE（子 task の DONE は MIG-0606 / MIG-0607 の依存で見る）
- [ ] RH-010/011 以外の全メソッドに担当MIGがある
- [ ] Remote D1 に書き込んでいない（D-03 は dry-run のみ）
#### STOP
- D-03 の fan-out を本番 D1 で実行する必要が出たら止める。
- D-04 の切替を実行する必要が出たら止める（別承認）。
- U05x を MIG-0633 DONE より前に始めない。
#### Rollback
Phase 6 共通契約のとおり。

### MIG-0606: API CPU benchmark
- **Model:** small
- **Readiness:** NEEDS_REFINEMENT — U01 harness は #341 で merge 済み。U02 は依存 task 全部の DONE と静かな host（`work-items/MIG-0606.md`: local の雑音が 7〜8ms の予算と同じ大きさ）の後。lead が測定条件（host、サンプル数、cold の作り方）を確定したら READY_FOR_SMALL_MODEL
- **Recipe:** R-BUILD
- **Runtime:** N
- **Depends on:** MIG-0603..MIG-0605, MIG-0626, MIG-0629, MIG-0634..MIG-0648 / **Decisions:** D-06 DECIDED, D-12 DECIDED, D-13-58, D-14-7
- **Verified against:** `a1b910b4` (2026-10-25)
#### Source snapshot
- 予算: `ZERO_1102.md` §3 の**最大値**で判定（参照 S2 < 7ms、更新 S3 < 8ms、session S4 は 2ms 以内）。p50/p95/p99 は記録だけ。入力は §5 の4種類を各 50 回以上。
- 対象: RH-010/011 と RH-013（MIG-0632 が自分で測る。D-13-58）を除く Hono 実装の RH メソッドと、Phase 6 の S3 書き込み（SA）。harness: `scripts/benchmark-api-cpu.mjs`（`buildScenarios()`）。
- 指定の上限入力: live slots 6000 枠（D-12）、spreadsheet events 50 行（MIG-0605 F-7）、RH-012 の 500 動画 × 100 member（MIG-0631 T17）、like_count drift（D-13-51）、可視性遷移の書き込み（D-13-43）、SA-010 dry run（D-13-54）。
#### Owned paths
- 変更: `scripts/benchmark-api-cpu.mjs`, `scripts/benchmark-api-cpu.test.mjs`, `docs/migration/cloudflare/API_CPU_BENCHMARK.md`, `docs/migration/work-items/MIG-0606.md`
- 触らない: `apps/api/src/**`（遅いエンドポイントは担当MIGへ差し戻す）
#### Micro-units
- **U01 harness**: DONE（#341）。
- **U02 run**: MIG-0639（D-14-7）が main にある endpoint と D-12 / MIG-0631 T17 の上限入力を測った後の残り。`buildScenarios()` に残りのメソッドを足し、全件を MIG-0639 と同じ host 条件で測って最終表にする。
#### Test cases
| ID | 入力/操作 | 期待 |
| --- | --- | --- |
| T01 | 対象の全メソッド | 全件の測定値がある |
| T02 | 予算超過のメソッド | 担当MIGと理由が記録されている |
#### Commands
```bash
node --test scripts/benchmark-api-cpu.test.mjs
node scripts/benchmark-api-cpu.mjs --dry-run
npm run check:project-docs
```
#### Ledger updates
`API_CPU_BENCHMARK.md` に値。`API_MATRIX.md` の各メソッドに測定値。
#### DONE checklist
- [ ] 対象メソッドの測定値（max を含む）と条件が記録され、max が予算未満か、超過の担当MIGが記録されている
- [ ] 測定値を本番値と書いていない
#### STOP
- 予算超過を直すためにエンドポイントを書き換え始めたら止める（担当MIGへ）。
- `--remote`、deploy、Cloudflare account の操作が必要になったら止める。
#### Rollback
PRをrevert。

### MIG-0609: 残る背景処理の CPU を測る（D-09）
- **Model:** lead
- **Readiness:** NEEDS_REFINEMENT — READY（D-14-1: 待ち条件だった MIG-0606 の harness は #341 `77f65d69` で main にある。計測は LOCAL だけ。実装は Sonnet、review は Opus）
- **Recipe:** R-BUILD
- **Runtime:** N
- **Depends on:** — / **Decisions:** D-09 DECIDED, D-14-1
- **Verified against:** `dde6fa8` (2026-10-25)
#### Source snapshot
- deploy される背景 Worker は3つだけ: `workers/content-jobs`（cron `15 * * * *`、consumer `flamenode-static-rebuild-wake` `max_batch_size = 10`）、`workers/fast-jobs`（cron `0 * * * *`、consumer `flamenode-notification-wake` 10）、`workers/sync-jobs`（cron `7,52 * * * *`、consumer `flamenode-youtube-sync-wake` 10）。各 `wrangler.toml` の `crons` / `[[queues.consumers]]`。入口は各 `index.ts` の `export default`（content-jobs :558、fast-jobs :296、sync-jobs :658。`scheduled` と `queue`）。他の `workers/*` は library。
- 1回の上限（2026-10-25 に code で確認した定数）:

  | job | 入口 | 1回の上限（CURRENT） |
  | --- | --- | --- |
  | OpenNext cache の掃除 | `workers/cleanup/incrementalCache.ts:29` | `INCREMENTAL_CACHE_SCAN_LIMIT = 200`（`:4`） |
  | 保持期限の削除 | `workers/cleanup/index.ts:36` | `AUDIT_CLEANUP_BATCH_LIMIT = 500`（`workers/cleanup/retention.ts:6`） |
  | X ID の枠の紐付け回復 | `workers/content-jobs/xIdSlotBindRecovery.ts:674` | `X_ID_SLOT_BIND_RECOVERY_REQUEST_LIMIT = 5`、`_SLOT_LIMIT = 30`（`:11-12`） |
  | 通知の lease 回復・配信 | `workers/notification-dispatcher/dispatch.ts:1005`、`:1065` | `MAX_NOTIFICATION_BATCH = 6`（`:55`）、外部 request 12 |
  | 枠の締切リマインダー | `workers/notification-dispatcher/reminders.ts:131` | `REMINDER_LIMIT = 50`（`:7`） |
  | YouTube metadata 同期 | `workers/youtube-sync/index.ts:1080` | API 4回、50件（`:93-97`） |
  | YouTube 非公開の再確認 | `workers/sync-jobs/index.ts:582` | 10件（`workers/youtube-sync/index.ts:110`） |
  | score の再計算 | `workers/score-recalc/index.ts:39` | 150件（`:29`） |
  | YouTube playlist 同期 | `workers/youtube-playlist-sync/index.ts:2173` | event 1、外部 request 12、元の作品 5,000（`:127-143`） |
  | GA4 人気順 | `workers/ga-analytics/sync.ts:215` | 200件（`workers/ga-analytics/ranking.ts:29`） |
  | 日替わりの top 並び（G18） | `workers/content-jobs/index.ts:30` `ensureDailyTopNostalgicShuffle` | 1日1回 |
  | static rebuild queue の処理（G18） | content-jobs の rebuild queue 処理 | MIG-0907 で消すまでの現行値 |
  | wake queue の consumer 3つ（G18） | 上の3 Worker の `queue()` | batch 10 件 |

  行番号のうち定数の行は確認済み。入口の行番号（`:29`、`:674` など）は U01 の着手時に `rg -n` で引き直し、ずれていたら work item に新しい値を書く。
- harness: `scripts/benchmark-api-cpu.mjs`（#341）。`workerSource()`（:408）が bench 専用の wrapper worker を生成し、`wrangler dev --local`（:559）+ workerd inspector の V8 sampling profiler（:588-626）で CPU を取る。workerd の span `cpu_time_ms` は local で 0 になるので使わない（同 file :591 の NOTE）。
- 既存の値: 本番 Four-Worker 表（sync の scheduled max 83ms、fast の scheduled max 25ms、`cloudflare/PERFORMANCE_BASELINE.md`）。MIG-0410（#325）の非本番 `cpuTime`: fast-jobs warm 約10ms（C1 max 15ms）、通知 outbox 6件で 33ms、cold 24〜30ms。2026-10-22 の非本番計測: Queue consumer は 100ms で通り 1000ms で超過。
- 予算は `ZERO_1102.md` §3 の B（< 8ms）を **max** で判定。p50/p95 は記録だけ。
#### Owned paths
- 新規: `+docs/migration/cloudflare/BACKGROUND_CPU.md`, `+scripts/benchmark-background-cpu.mjs`, `+scripts/benchmark-background-cpu.test.mjs`
- 変更: `scripts/benchmark-api-cpu.mjs`（`percentile` / `summarize` / `judge` / inspector 接続を export するだけ。API 側の挙動は変えない）, `docs/migration/cloudflare/PERFORMANCE_BASELINE.md`（link 1 行）, `docs/migration/FILE_MIGRATION_MATRIX.md`（新規 script 2 行）
- 触らない: `workers/**`（直すのは MIG-0610）、`apps/api/**`、各 `wrangler.toml`
#### Micro-units
- **U01 harness**: `benchmark-background-cpu.mjs` が Worker ごとに wrapper worker を生成する。wrapper は `workers/<w>/index.ts` の default を import し、`POST /__bench/scheduled?cron=<expr>` で `default.scheduled({ cron, scheduledTime }, env, ctx)`、`POST /__bench/queue` で `default.queue(batch, env, ctx)`（body の JSON を `messages[]` にした fake `MessageBatch`、`ack` / `retry` は記録するだけ）を呼ぶ。local D1 は repo の migration から作る（`benchmark-api-cpu.mjs:554` と同じ `d1 migrations apply --local`）。外部 API（YouTube / Discord / GA4）は wrapper が `fetch` を差し替えて固定応答を返す（本物の外部 request は 0）。`--dry-run` は plan と集計の self-check だけ。
- **U02 measure**: 表の job ごとに (a) 1件あたりの CPU、(b) 上限ちょうどの入力（seed を `scripts/benchmark-background-cpu.mjs` 内で生成）の CPU を、`ZERO_1102.md` §5 の4種類（normal / limit / invalid / cold）各 50 回以上。同じ run で BASELINE（何もしない `scheduled`）の max を取り、noise として記録する（D-14-1）。
- **U03 table**: `BACKGROUND_CPU.md` に job ごとの p50 / p95 / max、host（OS・CPU・node・wrangler の version）、サンプル数、noise、「max < 8ms にする1回の上限 = floor(7ms ÷ 1件の max CPU)」を書く（1ms は起動と D1 の結果処理の余裕）。G18 の日替わり top は seed と日付を固定した出力の hash も書く（MIG-0610 T01b の基準）。
#### Test cases
| ID | 入力/操作 | 期待 |
| --- | --- | --- |
| T01 | 表の全 job | 測定値と条件（host、サンプル数、noise）がある |
| T02 | 予算を超える job | 新しい上限の計算がある |
| T03 | `node scripts/benchmark-background-cpu.mjs --dry-run` | 3 Worker × scheduled / queue の plan を出し、何も起動しない |
| T04 | 集計の unit test（`benchmark-background-cpu.test.mjs`） | max 判定・noise の扱いが `benchmark-api-cpu.mjs` の `judge` と同じ |
| T05 | wrapper の外部 fetch | 本物の host へ 0 回（test で fetch を数える） |
#### Commands
```bash
node --test scripts/benchmark-background-cpu.test.mjs scripts/benchmark-api-cpu.test.mjs
node scripts/benchmark-background-cpu.mjs --dry-run
node scripts/benchmark-background-cpu.mjs
npm run check:project-docs
```
#### Ledger updates
`BACKGROUND_CPU.md` を新規作成。`cloudflare/PERFORMANCE_BASELINE.md` から link する。`FILE_MIGRATION_MATRIX.md` に新規 script 2 行。
#### DONE checklist
- [ ] 全 job の測定値（max を含む）と条件がある
- [ ] 予算を超える job ごとに、新しい上限の計算がある
- [ ] 測定値を本番値と書いていない（全て LOCAL と明記）
- [ ] 外部 API・Remote D1・Cloudflare account を一度も呼んでいない
#### STOP
- job の code を直し始めたら止める（MIG-0610）。
- 本番または非本番の Cloudflare 上の Worker を計測のために呼ぶ必要が出たら止める（明示承認事項）。
- BASELINE の max が 4ms 以上で、予算に近い job（max 4〜12ms）の判定ができないときは、その job を「判定不能」と書いて止めずに次へ進み、PR に書く。
#### Rollback
PRをrevert（script と文書だけ）。

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
- **coverage gap G18 の job**: MIG-0609 の表に追加した `ensureDailyTopNostalgicShuffle`、static rebuild queue の処理、wake queue の consumer 3つ（batch 10）も unit にする。日替わり top の並びは MIG-0410 の build 側の置き換えと整合させる。
#### Test cases
| ID | 入力/操作 | 期待 |
| --- | --- | --- |
| T01 | 各 job の上限ちょうどの入力 | 非本番の max < 8ms |
| T01b | 固定した seed と日付での top の出力、wake queue consumer の batch 10 件（G18） | top の並びは CURRENT と一致、consumer は 8ms 未満 |
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
- **Readiness:** NEEDS_REFINEMENT — 精緻化済み（2026-10-23、MIG-0615 の merge 後に lead が確定）。STATUS は READY で、下の Work Order のとおり実装してよい。Model が lead なので checker 上の値は NEEDS_REFINEMENT のまま（MIG-0612 と同じ扱い）
- **Recipe:** R-CORE
- **Runtime:** S3
- **Depends on:** MIG-0615 / **Decisions:** D-10 DECIDED
- **Verified against:** `e8ac0020` (2026-10-23)
#### Source snapshot
- `src/lib/audit/restore.ts`（744 行、最終変更 `c55f9a71`）。export は `restoreAuditLog` だけ（`find-unused-exports`: non-test 1。呼び出しは `src/lib/actions/audit-admin.ts` の SA-010 dry run と SA-011 restore）。
- restore.ts の import 先は、下の 4 つを除いて MIG-0613〜0615 で core に移っている（`./capability` `./mutate` `./registry` `./snapshot` `./types`、`@/lib/utils/id`、`@/lib/staticRebuild/hooks`、`@/lib/event/eventVisibilityTransition`、`@/lib/video/videoVisibilityTransition`、`@/lib/publicData/publicCache` は bridge で、中身は `packages/server-core/src/**`）。
- source の text を読む test（read 先だけを変える）: `src/lib/audit/{restore.batch.contract,restore.youtubeEligibility.contract,restoreVisibilityCache.contract}.test.mjs`、`src/lib/integration/{spec07Static,spec010207Contracts}.test.mjs`（`src/lib/audit/restore.ts` を読む行）。`src/lib/audit/eventStaffRestore.execution.test.mjs` は adapters だけを使うので触らない。
- 到達しない分岐（golden では扱わず、そのまま移す）: capability の reasonCode は全て `PERMANENT_RESTORE_REASONS` に入るので、capability 失敗時の `persistFailedRestoreRun` 側。`evaluateRestoreCapability` が registry を先に確かめるので、`!registration` の分岐。
#### 残る src 依存の扱い（lead 決定 2026-10-23）
golden を byte 一致に保ち、呼び出し側を変えず、host の面を最小にする形を選ぶ。
1. **`@/lib/db/schema` の table と `DB` 型** → core は `@flamenode/db/schema` の `auditLogs` / `auditRestoreRuns` / `users` / `videoEvents` と `ServerCoreDb`（`../db.ts`）を直接使う。理由: `src/lib/db/schema.ts` はこれらを `@flamenode/db/schema` から re-export するだけで、同じ object なので SQL は変わらない。`DB` は `ServerCoreDb` に代入できる（MIG-0613 で確認済み）。
2. **object key 定数**（`staticEventDetailCore` / `randomVideoPoolCore` / `staticTopSectionsCore` / `staticYoutubeRelatedBlocklistCore` / `staticUserProfileCore` の `STATIC_USER_MAX_PAGES`）→ host で渡す。MIG-0615 の `VideoPublicCacheKeyHost`（`packages/server-core/src/visibility/videoTransition.ts`）をそのまま使い、新しい型を作らない。理由: 複製すると生成側（src）と drift する。移すと UI / Next 型を引く生成コードごと core に入る（MIG-0615 で不採用）。restore の key の並びは `VideoPublicCacheKeyHost` の定義と一致する（`staticObjectKeys` は `"search-index-lite.json"` の後・`"top.json"` の前の 6 key で同じ順。`eventObjectKeys(id)` は `[composed, base, slots, release]`）。値は video bridge の host が既に持つので、`src/lib/video/videoVisibilityTransition.ts` の inline literal を `export const nextVideoPublicCacheKeyHost: VideoPublicCacheKeyHost` に切り出す（値と順は変えない）。video の host と restore の bridge の両方がこれを使い、restore と visibility action が同じ key 集合を消すこと（`restoreVisibilityCache.contract` の意図）が 1 か所で保たれる。
3. **`invalidateEventExportCache`**（`src/lib/api/eventExportCache.ts`）→ host の関数 `invalidateEventExportCache(eventId)` で渡す。理由: このファイルは `server-only` と `publicCache`（Cache API）を読み、route 用の export も持つので移さない。複数形の `invalidateEventExportCaches([id])` で代用すると `filter(Boolean)` と空配列の skip が入って挙動が 1 点変わり得るので、単数形をそのまま渡す。
4. **`validateVideoPublicEligibility`**（`src/lib/video/videoPublicEligibility.ts`）→ port も move も不要。このファイルは既に `@flamenode/domain/video` の re-export なので、core は `@flamenode/domain/video` から import する（`visibility/videoTransition.ts` と同じ）。

Queue wake: core の restore は core の `mutateWithAudit(db, input, loadWakeHost)` を呼び、loader は host から受ける（MIG-0613 の `QueueWakeHostLoader`）。`nextPorts.ts` に足す port は無い。
#### Core API（U02 で作る形）
```ts
// packages/server-core/src/audit/restore.ts
export type AuditRestoreHost = VisibilityFenceHost & {          // manifest: event / video の fence precommit と補償
  publicCacheKeys: VideoPublicCacheKeyHost;                     // 決定 2
  deletePublicJsonCaches(r2Keys: readonly string[]): Promise<void>;
  invalidateEventExportCache(eventId: string): Promise<void>;   // 決定 3
  loadQueueWakeHost: QueueWakeHostLoader;                       // mutateWithAudit の第 3 引数
};
export async function restoreAuditLog(db: ServerCoreDb, options: RestoreOptions, host: AuditRestoreHost): Promise<RestoreResult>;
```
- 本体は CURRENT の文の並び・文言・`console.warn` / `console.error` の引数を変えずに写す。置き換えるのは import 先と次の箇所だけ: video の固定 key は `"list/recent.json", "list/popular.json", "search-index-lite.json", ...host.publicCacheKeys.staticObjectKeys, "top.json", "users/index.json", ...` の順、event の key は `...host.publicCacheKeys.eventObjectKeys(id)`。`STATIC_USER_MAX_PAGES` は `host.publicCacheKeys.userMaxPages`（`userPublicCacheKeys(xUserId, userMaxPages)` は restore 内の private 関数のまま残す）。`deletePublicJsonCaches` / `invalidateEventExportCache` は `host.*`。`preCommit*` / `compensate*` は最後の引数に `host`。`mutateWithAudit(db, {...}, host.loadQueueWakeHost)`。
- `parseSnapshot` / `sanitizeRestoreError` / `persist*` / `PERMANENT_RESTORE_REASONS` は export しない（今も private）。
- `packages/server-core/package.json` の exports に `"./audit/restore": "./src/audit/restore.ts"` を足す。barrel（`src/index.ts`）には足さない。
#### Bridge（U03）
- `src/lib/audit/restore.ts` は `restoreAuditLog(db: DB, options: RestoreOptions): Promise<RestoreResult>` の signature を保つ wrapper だけにする。host は module 定数で、次を渡す:
  - `manifest: nextVisibilityManifestHost`（`@/lib/publicData/visibilityManifestHost`。event / video の bridge と同じ値）
  - `publicCacheKeys: nextVideoPublicCacheKeyHost`（`@/lib/video/videoVisibilityTransition`）
  - `deletePublicJsonCaches`（`@/lib/publicData/publicCache`）、`invalidateEventExportCache`（`@/lib/api/eventExportCache`）
  - `loadQueueWakeHost: async () => (await import("@/lib/serverCore/nextPorts")).nextQueueWakeHost`（`src/lib/audit/mutate.ts` の loader と同じ形・同じ遅延。commit 後まで nextPorts を評価しない順序を保つ）
- 先頭に `// Compatibility bridge (MIG-0616, D-10): ...` の 1 行（MIG-0613〜0615 と同じ）。
- 呼び出し側（`src/lib/actions/audit-admin.ts`）の diff は 0。
#### Owned paths
- 新規: `+packages/server-core/src/audit/restore.ts`, `+src/lib/serverCore/auditRestoreGolden.execution.test.mjs`, `+src/lib/serverCore/auditRestoreGolden.snapshot.json`
- 変更: `src/lib/audit/restore.ts`（bridge 化）、`src/lib/video/videoVisibilityTransition.ts`（key host を named export に切り出すだけ）、`packages/server-core/package.json`（exports 1 行）、source を読む test 5 件（上記）、`docs/migration/FILE_MIGRATION_MATRIX.md`（該当行）、`docs/migration/work-items/MIG-0616.md`
- 触らない: `src/lib/actions/**`、`src/lib/serverCore/nextPorts.ts`、既存 core（`visibility/**`、`staticRebuild/**`、`publicCache/**`、`audit/mutate.ts`）の signature、`apps/api/**`
#### Micro-units
- **U01 golden（移動前の tree で commit）**: `src/lib/serverCore/auditRestoreGolden.execution.test.mjs` と snapshot。harness は `src/lib/serverCore/visibilityTransitionGolden.execution.test.mjs` を写す（migrations を流した `node:sqlite` と記録する fake D1、`getCloudflareContext` を stub して BUCKET / KV / Queue / `waitUntil` を渡す、etag CAS 付きの fake R2、Cache API の delete recorder、`console.*` の記録）。固定値: `Date.now = () => 1_760_000_000_000`（`now` = 1760000000）、`crypto.randomUUID` は `00000000-0000-4000-8000-<連番 12 桁>`、`PUBLIC_VISIBILITY_GUARD_MODE` は未設定、`QUEUE_DISPATCH_ENABLED: "1"`。入口は bridge の `../audit/restore.ts` の `restoreAuditLog`（移動後も同じ path を呼ぶ）。fake D1 に注入を 2 つ足す: `beforeBatch(sqlite)`（最初の `batch` の直前に 1 回だけ実行。並行更新の再現）と `failRun: RegExp`（batch 外の `run` で SQL が一致したら throw）。scenario ごとに記録するもの: 戻り値、`log`（D1 の SQL + params、batch の SQL + params と commit / rollback、`r2.get` / `r2.put`、`cache.delete`、`queue.send`、`kv.put`、`waitUntil`、`console.*` を呼ばれた順）、実行後の `audit_logs`（全列。`id` / `created_at` を含む）、`audit_restore_runs`、対象 table の行、`public_visibility_fences`、`static_rebuild_queue`、manifest。最低限の scenario（名前を snapshot の key にする）:
  - 入口の拒否: `confirm_text_mismatch`、`reason_blank`、`non_admin_user`、`audit_log_missing`、`already_restored`（success の run が既にある）
  - 期限: `expired_dry_run`（書き込み 0）、`expired_persists_permanent_failure`（`audit_logs` 更新と run 挿入の 1 batch、status `expired`）
  - capability: `payload_exceeded_permanent`、`snapshot_redacted_permanent`、`strategy_none_dry_run`、`strategy_unsupported_permanent`（videos の `recreate_deleted`）
  - snapshot: `target_id_mismatch`（書き込み 0）
  - 競合: `dry_run_no_conflict`、`dry_run_with_conflicts`（message の key の並び）、`conflict_without_force_records_failed_run`（batch 外の run 1 件、`restore_status` は元のまま）、`recreate_target_already_exists`
  - strategy 別の成功（visibility 無し、cache delete 無し、wake 無し）: `announcements_update_before`、`announcements_recreate_deleted`、`event_staff_delete_created`、`video_members_set_custom_adapter`、`conflict_with_force_overwrite`
  - mutation 作成の失敗: `build_mutation_throws`（`video_members_set` の before の `rows` が parse できない → adapter が `video_members_set_snapshot_invalid` を throw）→ `mutation_failed` の run（batch 外）
  - owner 保護: `event_staff_sole_owner_rolls_back`（唯一の owner を非 owner の snapshot に戻す → owner 件数条件で 0 changes → rollback → `mutation_failed` の run）
  - events: `event_public_to_private`（期待する順: fence precommit の `r2.put` → batch（restore 文 + transition 文 + static rebuild queue、priority `high`）→ commit → Queue wake（source `admin`）→ public cache 9 key の delete → export cache 8 key の delete。wake が `waitUntil` 経由ならその記録位置も golden が固定する）、`event_private_to_public`、`event_title_only`（fence 無し・priority 無し。cache / export の delete と wake は行う）
  - videos: `video_public_to_private`（`video_events` 由来の event と current / target の primary event、current / target の creator の user page 全 page、`videos/<id>` と current / target の `youtube_video_id`）、`video_private_to_public`、`video_snapshot_without_source_keys_uses_current`、`video_youtube_ineligible`（snapshot が `youtube_video_id: null` を明示 → throw → precommit 無し・補償無し、`mutation_failed` の run）、`video_event_limit_exceeded`（`video_events` 9 行）
  - CAS / rollback: `event_cas_conflict_rolls_back_and_compensates`（`beforeBatch` で対象行を更新 → `assertChanges` で rollback → event の fence 補償 → failed run）、`video_cas_conflict_rolls_back_and_compensates`、`compensation_failure_is_warned`（補償中の `r2.get` が throw → `[audit-restore] visibility compensation failed` の warn → failed run は記録）、`failed_run_record_failure_is_logged`（`failRun` で `audit_restore_runs` の insert を落とす → `restore_failure_record_failed` の `console.error`、`restore_run_id` 無し）
  - 後処理の失敗: `cache_delete_failure_is_swallowed`（Cache API の delete が throw しても `ok: true`）、`wake_dispatch_disabled`（`QUEUE_DISPATCH_ENABLED` 無し。KV 記録と戻り値を固定）
  - 公開 API（`restoreAuditLog`）から入力を作れない scenario は省き、理由を work item に書く（例: capability を通る malformed snapshot が作れない場合）。scenario を足すのはよい。
  - 移動前の test 件数を記録する: `node --test --experimental-strip-types src/lib/audit/*.test.mjs src/lib/integration/spec07Static.test.mjs src/lib/integration/spec010207Contracts.test.mjs` の pass 数。
- **U02 move**: `packages/server-core/src/audit/restore.ts` を作り（上の Core API）、`package.json` の exports を足す。core に `@/`・`src/`・`server-only`・`next/*`・`process.env`・`getCloudflareContext` が無いこと（境界検査）。
- **U03 bridge**: `src/lib/audit/restore.ts` を wrapper にし、`src/lib/video/videoVisibilityTransition.ts` の key host を `nextVideoPublicCacheKeyHost` に切り出す。golden を再実行して snapshot の diff 0（`FLAMENODE_UPDATE_GOLDEN` は使わない）。
- **U04 source を読む test**: read 先を変える。`restore.batch.contract` / `restore.youtubeEligibility.contract` / `spec07Static` / `spec010207Contracts` は core の file を読む（assertion は同じ）。`restoreVisibilityCache.contract` は core と `src/lib/video/videoVisibilityTransition.ts`（key 定数を束ねる場所）を連結して読む。assertion のうち `eventComposedObjectKey\(log\.target_id\)` だけを、core の `publicCacheKeys\.eventObjectKeys\(log\.target_id\)` と bridge の `eventComposedObjectKey\(eventId\)` の 2 つに置き換える（意図は同じで場所が変わる。MIG-0615 の rethrow と同じ扱い）。test の件数は変えない。
- **U05 ledger**: 下の Ledger updates と work item。
#### Test cases
| ID | 入力/操作 | 期待 |
| --- | --- | --- |
| T01 | U01 の golden 全 scenario | 移動前後で snapshot が byte 一致（SQL・params・`audit_logs` の `id` / `created_at`・`audit_restore_runs`・R2 / Cache / Queue / console の順） |
| T02 | `src/lib/audit/*.test.mjs` と `spec07Static` / `spec010207Contracts` | 移動前と同じ件数 PASS |
| T03 | `check-server-core-boundaries` | OK（core に src / Next / ambient env の参照が無い） |
| T04 | `rg -n "@/lib/audit/restore" src app` | `audit-admin.ts` の 1 件のまま（呼び出し側の diff 0） |
#### Commands
```bash
node --import tsx --test src/lib/serverCore/auditRestoreGolden.execution.test.mjs
node --test --experimental-strip-types src/lib/audit/*.test.mjs src/lib/integration/spec07Static.test.mjs src/lib/integration/spec010207Contracts.test.mjs
node scripts/find-unused-exports.mjs packages/server-core/src/audit/restore.ts
npm run typecheck --workspace=@flamenode/server-core
npm run test --workspace=@flamenode/server-core
node scripts/check-server-core-boundaries.mjs
npm run typecheck && npm run test:critical && npm run test:unit && npm run test:integration && npm run test:static-rebuild
npm run check:project-docs
MIGRATION_FILE_BASE_SHA=$(git merge-base origin/main HEAD) node scripts/check-migration-file-progress.mjs
```
#### Ledger updates
STATUS は merge 直前の統合でだけ更新する。`FILE_MIGRATION_MATRIX.md`: 新規行 `packages/server-core/src/audit/restore.ts`（HELPER, RETAINED。host `AuditRestoreHost` を記す）、`src/lib/serverCore/auditRestoreGolden.execution.test.mjs` と `.snapshot.json`（TEST, RETAINED）、既存行 `src/lib/audit/restore.ts`（Work Order 精緻化の PR で NOT_STARTED・owner MIG-0616 として追加済み）を BRIDGED に、`src/lib/audit/{restore.batch.contract,restore.youtubeEligibility.contract,restoreVisibilityCache.contract}.test.mjs`（TEST, RETAINED）。既存行 `src/lib/video/videoVisibilityTransition.ts` の target に「key host を `nextVideoPublicCacheKeyHost` として audit restore と共有」を足す。`spec07Static` / `spec010207Contracts` の行は evidence を本 PR に更新する。evidence は `PR#<n> SHA=<40 hex> TEST=...`（MIG-0615 と同じ形）。
#### DONE checklist
- [ ] U01 の golden を移動前の commit に入れ、移動後に snapshot の diff が 0（`id` / `created_at` を含む）
- [ ] 既存 test の件数が移動前と同じ。呼び出し側（`audit-admin.ts`）の diff が 0
- [ ] `nextPorts.ts` と既存 core の signature に変更が無い
- [ ] source を読む test は新しい場所を読み、assertion の変更は U04 の 1 件だけ
#### STOP
- golden に 1 byte でも差が出たら止める（`FLAMENODE_UPDATE_GOLDEN=1` で上書きしない）。
- 実行順（入口の検査 → 読み取り → precommit → 1 batch → 補償 / failed run → cache delete → export cache）や strict / CAS / `PERMANENT_RESTORE_REASONS` の意味を変える必要が出たら止める。
- core が `@/`・`src/`・`next/*`・`server-only`・`process.env` を必要としたら止める。`VideoPublicCacheKeyHost` や `mutateWithAudit` など既存 core の signature を変えたくなったら止める。`nextPorts.ts` に port を足したくなったら止める。
- 呼び出し側（`src/lib/actions/**`）を変えたくなったら止める。
#### Rollback
PR を revert（bridge が元の実装に戻る。DB・Queue・Route・secret の変更は無い）。

### MIG-0617: `apps/api` の Option A を core に置き換える
- **Model:** lead
- **Readiness:** NEEDS_REFINEMENT — READY（lead 決定 L1〜L3 は 2026-10-24 に決定済み。依存 MIG-0613 / 0614 / 0602 は DONE。U01 の棚卸し表から着手）
- **Recipe:** R-CORE, R-API
- **Runtime:** S3
- **Depends on:** MIG-0613, MIG-0614, MIG-0602 / **Decisions:** D-10 DECIDED
- **Verified against:** `e8ac0020` (2026-10-23)
#### Source snapshot
- MIG-0602 が `apps/api` に作った監査・wake の写し（Option A）。core と二重になっている部分を消す。テストの fake D1 は `.raw()` を持つ形に揃える。
- Option A の本体: `apps/api/src/audit/{mutateWithAudit,snapshot,staticRebuildQueue}.ts`（計 731 行）。利用先: `apps/api/src/{env.ts,middleware/costGuard.ts,middleware/writeOrigin.ts,routes/admin/{announcements,apiEndpoints,body}.ts,routes/events/templates.ts}`、test `apps/api/test/{adminGuards,auditParity}.test.mjs`。
#### lead 決定（2026-10-24、Fable（owner-delegate）2026-10-24、Yugo の standing instruction「検討事項は推奨で進めて」に基づく。Yugo には事後に伝える）
- **L1 apps/api が core をどう読むか**: (a) を採る。`apps/api` は typecheck のみ（`tsconfig` を `noEmit`、`rootDir` / `outDir` を外し、`paths` を root と同じく `@flamenode/domain` / `@flamenode/db` / `@flamenode/server-core` の src へ向ける）。build script は `tsc --noEmit`。Worker の bundle は MIG-0628 の wrangler / esbuild に任せる。test は node の exports 解決（`src/*.ts`、strip-types）で変更不要。U01 で `apps/api/dist` の消費者が 0 件であることを `rg` で記録する。(b) は core 側の二重構成、(c) は TS6059 の再発になるため採らない。
- **L2 drizzle を apps/api の Worker に入れるか**: 入れる。依存に `@flamenode/server-core`, `@flamenode/db`, `drizzle-orm` を追加し、request ごとに `drizzle(c.env.DB)` を middleware で 1 回作って `c.set("db")`。`apps/api/src/routes/**` から `drizzle-orm` / `@flamenode/db` を直接 import するのは禁止（server-core 経由のみ。`check-server-core-boundaries.mjs` に 1 規則追加）。PR に `wrangler deploy --dry-run` の bundle size を記録し、MIG-0606 で同一 route の before/after CPU を測る（増分 ≤ 2ms が目標、超えたら STOP）。bundle gzip と request CPU は未計測。
- **L3 `preloaded` の扱い**: core の `mutateWithAudit` に optional `preloaded`（settings / `actorSnapshotJsonById`）を足す。省略時は現在の core と同じ読み取り。Next 側は渡さない（監査行の SQL + params が不変であることを T02 で確認）。Option A に `restore_strategy` を足すことはしない（Option A は本 task で削除する暫定）。
- U01 の棚卸し表（写しと core の SQL + params の差）から先は MIG-0616 と同じ書き方で精緻化する。
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
- 実装時の分け方（PR #373）: core は `src/` を import できないため、`merge.ts` の flow 関数（`captureXIdMergeRestoreSnapshot` / `executeApprovedXIdMergeRequest` / `restoreApprovedXIdMergeRevertRequest` / `buildMergeStaticRebuildTargets`）と `xUserVisibilityTransition.ts` は MIG-0614（`staticRebuild/enqueue`・`staticRebuild/types`）と MIG-0615（`publicVisibilityFenceTransition`）の後に移す（PR #380 で `xid/merge.ts` へ移動済み。bridge が `XIdMergeHost` を注入する）。今回移したのは `mergeBudget.ts` / `mergeSafety.ts`（全体）と、`merge.ts` から切り出した `xid/mergeCore.ts`（定数・snapshot 型・`assertMergeRequest`・`parseSnapshot`・SQL fragment 2 つ）。`mergeAudits.ts` は export が TEST_ONLY のため移さない。`nextPorts` に足す port は無い。
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

### Coverage gap 登録（MIG-0619〜0628、2026-10-23）

CURRENT の機能と移行計画を突き合わせた監査（G01〜G30）で、担当 task が無かった機能を登録する。決定は owner（Yugo）の「推奨で決める」包括承認に基づく（2026-10-23）。既存 task への追記は各 task の Micro-units / Test cases の「coverage gap」行にある。

| gap | 内容 | 担当 |
| --- | --- | --- |
| G01, G02, G23 | canonical host 308、maintenance redirect、`/maintenance` 静的 page | MIG-0619 |
| G04 | 静的 asset の Cache-Control | MIG-0620 |
| G09 | robots.txt と sitemap.xml | MIG-0621 |
| G11 | FILE_MIGRATION_MATRIX の網羅検査 | MIG-0622 |
| G13 | 非公開 page の読み取り API | MIG-0623〜0626 |
| G14 | R2 artifact の読み手 | MIG-0627 |
| G15, G16 | 新 Worker の deploy・smoke・binding | MIG-0628 |

### MIG-0619: 公開 gateway の edge policy parity（canonical host・maintenance）
- **Model:** lead
- **Readiness:** NEEDS_REFINEMENT — 実装前に lead が `apps/site/src/gateway/index.ts` の fetch 入口へ policy をどの順で挟むかを決める（canonical host → maintenance → route shard）
- **Recipe:** R-GATEWAY
- **Runtime:** S1
- **Depends on:** MIG-0405 / **Decisions:** D-02 DECIDED
- **Verified against:** `c5a62b4d` (2026-10-23)
#### Source snapshot
- G01 canonical host: `middleware.ts:45-70` と `src/lib/auth/canonicalHostRedirect.ts`。`AUTH_URL` / `NEXT_PUBLIC_SITE_URL` と host / `x-forwarded-host` を比べて 308。query を保つ。`/api/auth` を含む。`/api/health` は対象外。設定が workers.dev を指すときは redirect しない。Auth.js の cookie は host に束縛されるため、この redirect が無いと www と apex で session が分かれる。
- G02 maintenance: `middleware.ts:72-88` と `src/lib/operationMode/middlewareMaintenance.ts`。`operation_mode=maintenance`（KV mirror）または `MAINTENANCE_MODE=1` で `/maintenance` へ redirect。除外は `/maintenance`, `/admin`, `/api/auth`, `/api/health`。
- G23 `/maintenance` と `/dev/ui-surfaces`（本番 404）。現状 MIG-0901 の RETAIN/REVIEW だが、MIG-0904 が OpenNext を消す前に redirect 先が新 Worker に必要。
- 現状 `apps/site/src/gateway/index.ts` に host 判定も maintenance 判定も無い。
- 既存 test: `src/lib/auth/canonicalHostRedirect.test.mjs`、`src/lib/operationMode/middlewareMaintenance.contract.test.mjs`。
#### Owned paths
- 新規: `+apps/site/src/gateway/edgePolicy.ts`, `+apps/site/src/gateway/edgePolicy.test.mjs`, `+apps/site/src/pages/maintenance.astro`
- 変更: `apps/site/src/gateway/index.ts`
- 触らない: `middleware.ts`（本番切替まで現行のまま）, `app/maintenance/**`
- 同じ policy を personal / ops / api の Worker にも置く場合の共有方法は U04 で決める（呼び出し元が2つ以上になった時点で共有 package へ移す）。
#### Micro-units
- **U01 golden**: `resolveCanonicalHostRedirect` と `middlewareMaintenance` の入出力表を、CURRENT の既存 test から取り出して fixture 化する。
- **U02 canonical host**: `edgePolicy.ts` に同じ判定を実装し、gateway の fetch の先頭で適用。
- **U03 maintenance**: 同じ allowlist と KV mirror 読み取り（request ごとに KV 1回まで）で `/maintenance` へ redirect。
- **U04 /maintenance page**: 静的 page。admin 例外が残ること。他 Worker（personal / ops / api）への適用方法を決めて記録。
#### Test cases
| ID | 入力/操作 | 期待 |
| --- | --- | --- |
| T01 | 表 {host, x-forwarded-host, path, query, 設定 origin} | `resolveCanonicalHostRedirect` と同じ Location と 308 |
| T02 | `/api/health` | redirect しない |
| T03 | 設定 origin が workers.dev | redirect しない |
| T04 | 表 {normal, maintenance, env flag} × {許可 path, 公開 page, SPA route `/dashboard` `/entry` `/manage`, `/api/*`} | CURRENT middleware と同じ status と Location |
| T05 | `/maintenance` | 新 Worker が静的に返す。`/admin` 例外が残る |
| T06 | KV 読み取り失敗 | CURRENT と同じ側（fail-open か fail-closed か）に倒れる |
#### Commands
```bash
node --test --experimental-strip-types apps/site/src/gateway/edgePolicy.test.mjs
node --test src/lib/auth/canonicalHostRedirect.test.mjs src/lib/operationMode/middlewareMaintenance.contract.test.mjs
npm run build --workspace=@flamenode/site
npm run typecheck
npm run check:project-docs
```
#### Ledger updates
`FILE_MIGRATION_MATRIX.md` に `middleware.ts`, `src/lib/auth/canonicalHostRedirect.ts`, `src/lib/operationMode/middlewareMaintenance.ts` の行（MIG-0622 が行無しを検出する）。`ROUTE_MATRIX.md` の `/maintenance` 行に証跡。
#### DONE checklist
- [ ] T01〜T06 が PASS
- [ ] 本番 Route を変更していない
- [ ] SPA・Hono の `/api/*` にも同じ policy を置く方法が記録されている
#### STOP
- 本番 Route・secret・KV の変更が必要に見えたら止める。
- host 判定の意味（どの host を正とするか）を変える必要が出たら止める。
#### Rollback
PRをrevert。

### MIG-0620: 静的 asset の Cache-Control parity（新しい prefix と `_headers`）
- **Model:** lead
- **Readiness:** NEEDS_REFINEMENT — DONE（PR #351, merge `e8ac0020`）。`/_ops_assets/*` は D-13-4 で MIG-0704 U01 へ移した
- **Recipe:** R-GATEWAY
- **Runtime:** S0, S1
- **Depends on:** MIG-0405 / **Decisions:** D-02 DECIDED, D-13-4 DECIDED
- **Verified against:** `7a19a42` (2026-10-25)
#### Source snapshot
- G04 `public/_headers`: `/_next/static` immutable 1年、`/favicon.ico` 1日、png / webp / svg は `max-age=86400` と `stale-while-revalidate=604800`。CURRENT の file は MIG-0904 まで残す。
- 新 prefix の値の表は `work-items/MIG-0620.md` の Table が正本。`/_astro/*`（`apps/site/public/_headers`、`! Cache-Control` で SWR 結合を外す）、`/_personal_assets/*`（`apps/app/public/_headers`）は immutable 1年。`/_ops_assets/*` は同じ値で MIG-0704 U01 が `apps/ops/public/_headers` に置く（D-13-4）。
#### Owned paths
- 新規: `+apps/site/public/_headers`, `+apps/app/public/_headers`, `+apps/site/src/gateway/assetHeaders.test.mjs`
- 触らない: `public/_headers`（CURRENT。MIG-0904 まで残す）
#### Micro-units
- **U01 spec**（DONE）: 値の表（work item）。
- **U02 file**（DONE）: `apps/site/public/_headers`, `apps/app/public/_headers`。
- **U03 test**（DONE）: `assetHeaders.test.mjs` が Static Assets の規則（一致した rule を上から結合、`!` で削除）で解決して比較。5/5。
- `/_ops_assets/*` は MIG-0704 U01（D-13-4）。
#### Test cases
| ID | 入力/操作 | 期待 |
| --- | --- | --- |
| T01 | `/_astro/*`, `/_personal_assets/*` | hash 付きは immutable 1年（`/_ops_assets/*` は MIG-0704 の T07） |
| T02 | `/brand/*`, `/favicon.ico` | 現行と同じ値 |
| T03 | HTML | immutable にならない |
#### Commands
```bash
node --test --experimental-strip-types apps/site/src/gateway/assetHeaders.test.mjs
npm run build --workspace=@flamenode/site
npm run check:project-docs
```
#### Ledger updates
`FILE_MIGRATION_MATRIX.md` の `public/_headers` 行は NOT_STARTED のまま（MIG-0904 で消す）。`apps/site/public/_headers`, `apps/app/public/_headers`, `apps/site/src/gateway/assetHeaders.test.mjs` の3行を DONE（evidence `PR#351 merge=e8ac0020 TEST=node --test --experimental-strip-types apps/site/src/gateway/assetHeaders.test.mjs (5/5)`）。
#### DONE checklist
- [x] 全 prefix の Cache-Control が表と一致（`/_ops_assets/*` は D-13-4 で MIG-0704 U01 の DONE checklist へ移した）
- [x] HTML に immutable が付いていない
- [x] 独立レビュー: PR #351 comment 6360298693「Independent review (Claude Opus): APPROVE | Head: 50712610」、CI run 39920805924 green
#### STOP
- 本番 Route の変更が必要に見えたら止める。
#### Rollback
PR #351 を revert（`git revert -m 1 e8ac0020`）。wrangler / Route / Custom Domain は触っていない。

### MIG-0621: robots.txt の byte parity と sitemap.xml（build 時 snapshot から）
- **Model:** lead
- **Readiness:** NEEDS_REFINEMENT — READY（D-14-4: 入力の snapshot と manifest は #354 の `produceSnapshots.ts` が既に作るので依存を MIG-0409 に替えた。動画 URL の集合・creator の入力・lastmod は D-14-4 で決定済み。実装は Sonnet、review は Opus）
- **Recipe:** R-PAGE, R-BUILD
- **Runtime:** S0, N
- **Depends on:** MIG-0409 / **Decisions:** D-09 DECIDED, D-14-4
- **Verified against:** `dde6fa8` (2026-10-25)
#### Source snapshot
- CURRENT robots: `app/robots.ts`（`userAgent: "*"`, `allow: "/"`, disallow 9件 `/api/`, `/admin/`, `/manage/`, `/dashboard/`, `/entry`, `/entry/`, `/onboarding`, `/dev/`, `/maintenance`、`sitemap: absoluteUrl("/sitemap.xml")`、`host: site.origin`）。文字列化は Next の `resolveRobots`（`next/dist/build/webpack/loaders/metadata/resolve-route-data.js`）。
- CURRENT sitemap: `app/sitemap.ts`（revalidate 3600、`[...buildStaticSitemapStaticEntries(), ...buildStaticSitemapEntries()]`）。`src/lib/publicData/sitemapSources.ts`: 動画 = `list/recent.json` を `normalizeStaticRecentVideoPage(recent, 1, 500)`（:75-77）、URL `/${youtube_video_id ?? id}`、lastmod `scheduled_time`、weekly / 0.7。event = `events/index.json` を `normalizeStaticEventsIndex`、`/event/<id>`、lastmod `end_time ?? start_time`、weekly / 0.7。creator = `users/index.json` の `x_id ?? id`、`/user/<id>`、lastmod `updated_at`、weekly / 0.6（:105-125。search-index fallback :126-142）。lastmod の fallback は4 index の `generated_at` の max、それも無ければ `new Date()`（:31）。静的 7 entry（:146-156）。文字列化は Next の `resolveSitemap`（同じ module）。
- apps/site: `output: "static"`（`astro.config.mjs`）。build 時 endpoint の前例 `src/pages/user/index.json.ts`（`loadUserBuildData()`）。event は `src/lib/eventData.ts:88` `loadEventBuildData`、creator は `src/lib/userData.ts:159` `loadUserBuildData`（index は「page がある creator」だけ、:151-152）。origin は `src/lib/pageHead.ts:11` `siteOrigin()`。
- producer: `apps/site/scripts/produceSnapshots.ts:325` が `list/recent.json` を読み、先頭 24 件（`LIST_FIRST_PAGE_SIZE` :53）だけを `LIST_FIRST_PAGE_KEY` にする。500 件は snapshot に無い。
- gateway: `apps/site/src/gateway/routeShards.ts:95` は `/robots.txt` を allowlist 済み、`/sitemap.xml` は無い。
#### Owned paths
- 新規: `+apps/site/src/pages/robots.txt.ts`, `+apps/site/src/pages/sitemap.xml.ts`, `+apps/site/src/lib/sitemap.ts`, `+scripts/migration-robots-sitemap.test.mjs`
- 変更: `apps/site/scripts/produceSnapshots.ts`（`SITEMAP_VIDEOS_KEY` の `add` 1 行）, `apps/site/src/lib/publicDataLoader.ts`（`SITEMAP_VIDEOS_KEY` 定数と loader 1 つ）, `apps/site/src/gateway/routeShards.ts`（`/sitemap.xml` 1 行）, `scripts/migration-snapshot-producers.test.mjs`（新 key の parity 1 件）, `.github/workflows/migration-docs-check.yml`（REQUIRE_BUILT の test 列に1つ足す）
- 触らない: `app/robots.ts`, `app/sitemap.ts`, `src/lib/publicData/sitemapSources.ts`（本番切替まで）, `workers/json-generator/**`
#### Micro-units
- **U01 robots**: `robots.txt.ts` の `GET` が `text/plain` で次を返す（`<origin>` = `siteOrigin()`）。行は `User-Agent: *` / `Allow: /` / disallow 9 行（CURRENT の順）/ 空行 / `Host: <origin>` / `Sitemap: <origin>/sitemap.xml`、各行末 `\n`。test は Next の `resolveRobots` に `app/robots.ts` と同じ object を渡した出力と byte 比較し、さらに `app/robots.ts` の本文から disallow の9文字列を順に読み出して一致を確かめる（CURRENT が変わったら落ちる）。
- **U02 sitemap producer**: `produceSnapshots.ts` に `add(SITEMAP_VIDEOS_KEY, recent ? { videos: normalizeStaticRecentVideoPage(recent, 1, 500).videos.map(v => ({ id: v.id, youtube_video_id: v.youtube_video_id ?? null, scheduled_time: v.scheduled_time ?? null })) } : undefined)`（`SITEMAP_VIDEOS_KEY = "snapshot/sitemap/videos.json"`）。normalizer は CURRENT の `src/lib/publicData/staticRecentVideoCore.ts` を import する（2026-10-25 に `server-only` を import していないことを確認済み）。parity test: seed SQLite で CURRENT `buildStaticSitemapEntries` の動画 URL 集合（同じ `list/recent.json` を入力）と一致。
- **U03 sitemap endpoint**: `lib/sitemap.ts` に entry 生成（CURRENT と同じ path・changefreq・priority、lastmod は D-14-4 の規則: entry の値 → index の `generated_at` の max → build 時刻）と XML 文字列化（Next `resolveSitemap` と同じ形）。`sitemap.xml.ts` が静的 7 entry + 動画（`SITEMAP_VIDEOS_KEY`）+ event（`loadEventBuildData().index`）+ creator（`loadUserBuildData().index`）を返す。`SITEMAP_VIDEOS_KEY` が manifest に無いときは動画 0 件 + `console.warn`（build は成功）。
- **U04 allowlist**: `routeShards.ts` に `/sitemap.xml`。route map の衝突検査（`scripts/migration-route-map.test.mjs`）が通る。
#### Test cases
| ID | 入力/操作 | 期待 |
| --- | --- | --- |
| T01 | `dist/robots.txt` | Next `resolveRobots` の出力と byte 一致（origin `https://flamenode.net`） |
| T02 | `dist/sitemap.xml` の URL 集合（seed） | CURRENT `buildStaticSitemapEntries` + `buildStaticSitemapStaticEntries` と同じ集合。ただし page の無い creator は除く（D-14-4） |
| T03 | 非公開の video / event / creator | sitemap に 0 件 |
| T04 | `SITEMAP_VIDEOS_KEY` が manifest に無い | 動画 0 件、build 成功、warn 1 回 |
| T05 | 同じ entry 配列を Next `resolveSitemap` と `lib/sitemap.ts` で文字列化 | byte 一致 |
| T06 | gateway に `/sitemap.xml` と `/robots.txt` | 両方を Assets から返す |
#### Commands
```bash
npm ci --no-audit --no-fund
REQUIRE_BUILT=1 node --test --test-concurrency=1 --experimental-strip-types scripts/migration-robots-sitemap.test.mjs scripts/migration-snapshot-producers.test.mjs
node --test --experimental-strip-types scripts/migration-route-map.test.mjs scripts/migration-gateway.test.mjs
npm run build --workspace=@flamenode/site
npm run check:public-visibility-fences
npm run check:project-docs
```
#### Ledger updates
`FILE_MIGRATION_MATRIX.md` に `app/robots.ts`, `app/sitemap.ts`, `src/lib/publicData/sitemapSources.ts` の行（MIG-0621、IN_PROGRESS → DONE）と新規 4 file。`ROUTE_MATRIX.md` に `/robots.txt` と `/sitemap.xml` の2行。
#### DONE checklist
- [ ] T01〜T06 が PASS
- [ ] 最初の公開 cutover の前に DONE（MIG-0508 の依存）
- [ ] CURRENT との差（page の無い creator の除外、lastmod の fallback が build 時刻）を `ROUTE_MATRIX.md` の行に書いた
#### STOP
- 本番 Route の変更が必要に見えたら止める。
- sitemap を build より頻繁に更新する必要が出たら止める（CURRENT は revalidate 3600 秒、D-11 で build 周期の遅れは承認済み）。
- `next/dist/build/webpack/loaders/metadata/resolve-route-data.js` が無い、または `resolveRobots` / `resolveSitemap` を export していないときは止めて lead に報告する（推測の format で書かない）。
#### Rollback
PRをrevert。CURRENT の robots / sitemap は本番切替まで動いたまま。

### MIG-0622: ledger の網羅検査（FILE_MIGRATION_MATRIX に行が無い file を CI で落とす）
- **Model:** lead
- **Readiness:** NEEDS_REFINEMENT — 実装前に、対象 category と除外一覧（test、生成物）を lead が決める
- **Recipe:** R-TEST
- **Runtime:** N
- **Depends on:** none / **Decisions:** none
- **Verified against:** `c5a62b4d` (2026-10-23)
#### Source snapshot
- G11 `FILE_MIGRATION_MATRIX.md` に行が無い CURRENT file: `middleware.ts`, `next.config.mjs`, `app/layout.tsx`, 5つの route group の `layout.tsx`, `app/robots.ts`, `app/sitemap.ts`, error / not-found 系, `public/*`, `src/lib/{seo,observability,health,analytics,client,integration}`, `workers/{ga-analytics,notification-dispatcher,json-generator,shared}`。
- `scripts/check-migration-file-progress.mjs` は表に載った file しか見ないため、載っていない file は検出できない。これが G01〜G10 の取りこぼしの原因。
#### Owned paths
- 新規: `+scripts/check-migration-ledger-completeness.mjs`, `+scripts/check-migration-ledger-completeness.test.mjs`
- 変更: `docs/migration/FILE_MIGRATION_MATRIX.md`（不足行の追加）, `.github/workflows/migration-docs-check.yml`（検査の追加）, `package.json`（script 名）
#### Micro-units
- **U01 checker**: `git ls-files` の category（layout, middleware, config, public, workers, `src/lib`, `app`）と表を突き合わせ、行が無い file で失敗する。除外は test file と生成物の一覧で明示する。
- **U02 rows**: G11 の file すべてに行を追加（disposition と担当 MIG）。担当が決まらない file は lead に確認する。
- **U03 CI**: workflow に追加し、新しい tracked file が行無しで入ると落ちることを確認する。
#### Test cases
| ID | 入力/操作 | 期待 |
| --- | --- | --- |
| T01 | 行が無い tracked file | 失敗し file 名を出す |
| T02 | 除外一覧にある file | 失敗しない |
| T03 | 現在の main | PASS（U02 の後） |
#### Commands
```bash
node --test scripts/check-migration-ledger-completeness.test.mjs
node scripts/check-migration-ledger-completeness.mjs
node scripts/check-migration-file-progress.mjs
npm run check:project-docs
```
#### Ledger updates
`FILE_PROGRESS_PROTOCOL.md` に新しい検査を1行。
#### DONE checklist
- [ ] G11 の file すべてに行がある
- [ ] CI で行無しの file が落ちる
#### STOP
- 他 task が所有する行の担当 MIG を勝手に変えない。
#### Rollback
PRをrevert。

### MIG-0623: Entry 画面の読み取り API
- **Model:** lead
- **Readiness:** NEEDS_REFINEMENT — MIG-0611（PR #333）の merge 後にその R-API の形を確定してから
- **Recipe:** R-API
- **Runtime:** S2
- **Depends on:** MIG-0601, MIG-0608 / **Decisions:** D-05 DECIDED
- **Verified against:** `c5a62b4d` (2026-10-23)
#### Source snapshot
- G13 CURRENT の `app/(auth)/entry/**` と `app/(manage)/dashboard/edit/[id]/**` の `page.tsx` は RSC loader（`src/lib/db`, `src/lib/auth`, `src/lib/publicData`）を直接 import する。Phase 6 の API 一覧（RH-001〜033, SA-001〜110）に対応する読み取り endpoint が無い。MIG-0703 の STOP 規則「API が無ければ lead に戻す」に当たる。
- 対象（本 task）: `/entry`, `/entry/slotted`, `/entry/unslotted` の 3 ルート。`/dashboard/edit/[id]`（813 行の loader）と `/dashboard/edit/[id]/permissions` は規模が大きいため **MIG-0630** へ分割（2026-10-23、Opus レビュー指摘）。本 task の DONE に含めない。
- パターン: MIG-0611（dashboard / library / settings / onboarding）と同じ。
- S2 上限（ZERO_1102）: 全 LIMIT は名前付き定数 <= 100、response は <= 64 KiB。CURRENT が 100 件超を 1 画面で表示する event 一覧（index の受付中 event、unslotted / slotted の event 選択肢）は `?offset=` で分割し、`truncated` + `nextOffset` を返す。1 page は 100 行、さらに response が 64 KiB を超える前に byte で切る（manage の `truncated` / `offset` と同形）。
#### Owned paths
- 新規: `+apps/api/src/routes/personal/entry/**`, `+packages/contracts/src/personal/entry.ts`, `+apps/api/test/personalEntry.parity.test.mjs`, `+apps/api/test/support/personalEntrySeed.mjs`（`edit.ts` は MIG-0630）
- 触らない: `app/**`（本番切替まで）, `src/lib/actions/**`
#### Micro-units
- **U01 inventory**: 3ルートの loader が読む query と戻り値を表にする。
- **U02 contract**: DTO を `packages/contracts` に置く。D1 の column を漏らさない。
- **U03 routes**: MIG-0608 の session を使う。`Cache-Control: private, no-store`。
- **U04 parity**: 実 CURRENT loader と Hono を `node:sqlite` に全 migration を当てた DB で比べる（`personal.parity` と同じ形）。
#### Test cases
| ID | 入力/操作 | 期待 |
| --- | --- | --- |
| T01 | 各 endpoint の正常系 | CURRENT loader と DTO が一致 |
| T02 | 未ログイン・権限無し・存在しない id | CURRENT と同じ status と redirect 相当 |
| T03 | D1 失敗 | CURRENT と同じ劣化 |
| T04 | D1 statement 数 | 1 endpoint あたり3件以下（S2） |
| T05 | response header | private, no-store |
| T06 | 100 件超の event（unslotted / index / slotted） | 1 page 100 行以下、`?offset=` を辿ると全件、順序は CURRENT と一致 |
| T07 | 大きい event option（template 9KB × 30） | response <= 64 KiB、`nextOffset` で続きを取得 |
| T08 | 101 slot 超の event の part | SQL の part index が CURRENT の `buildSlotParts` と一致 |
#### Commands
```bash
npm run build --workspace=@flamenode/api
node --test apps/api/test/personalEntry.parity.test.mjs
npm run check:public-api-leaks
npm run typecheck
npm run test:unit
```
#### Ledger updates
`API_MATRIX.md` に読み取り endpoint の行。`FILE_MIGRATION_MATRIX.md` の entry の page 行の target（edit の page 行は MIG-0630）。
#### DONE checklist
- [ ] `/entry` `/entry/slotted` `/entry/unslotted` の 3 ルートに endpoint があり parity が PASS（`/dashboard/edit/[id]` と `/permissions` は MIG-0630 で、本 task の DONE から除外）
- [ ] 全 LIMIT <= 100 の名前付き定数、response <= 64 KiB（byte 上限をテスト）
- [ ] 本番 Route を変更していない
#### STOP
- 認証の cookie の発行・更新が必要になったら止める（Phase 8）。
- D1 statement が3件を超えるなら、分割か projection を lead に確認する。
#### Rollback
PRをrevert。

### MIG-0624: Manage 画面の読み取り API
- **Model:** lead
- **Readiness:** NEEDS_REFINEMENT — MIG-0611（PR #333）の merge 後に形を確定してから
- **Recipe:** R-API
- **Runtime:** S2
- **Depends on:** MIG-0601, MIG-0608 / **Decisions:** D-05 DECIDED
- **Verified against:** `c5a62b4d` (2026-10-23)
#### Source snapshot
- G13 `app/(manage)/manage/**` の `page.tsx`（11 / 12 が db / auth / publicData を直接 import）。API 一覧に読み取り endpoint が無い。
- 対象: manage の event workspace、slots、staff、videos、notifications、review、一覧など（`CURRENT_ROUTES.md` の Manage 12ルート）。
- 権限: `(manage)/layout.tsx` は user 無しなら `/entry`、enrichmentFailed なら `/entry?error=auth_temporarily_unavailable`、manage / admin 権限無しなら `/dashboard` へ redirect（G12）。API でも同じ権限を確認する（SPA 側のガードだけにしない）。
#### Owned paths
- 新規: `+apps/api/src/routes/manage.ts`, `+packages/contracts/src/manage.ts`, `+apps/api/test/manage.parity.test.mjs`
- 触らない: `app/**`, `src/lib/actions/**`
#### Micro-units
- **U01 inventory**: 12ルートの loader の query と戻り値を表にする。
- **U02 contract**: DTO（D1 の column を漏らさない）。
- **U03 routes**: session と event 単位の権限（owner / staff / admin）を API で確認。`private, no-store`。
- **U04 parity**: 実 loader と Hono を `node:sqlite` で比較。
#### Test cases
| ID | 入力/操作 | 期待 |
| --- | --- | --- |
| T01 | 12ルートの正常系 | CURRENT loader と DTO が一致 |
| T02 | route × role（guest, user, staff, owner, admin） | CURRENT と同じ許可と拒否 |
| T03 | 他人の event の id | CURRENT と同じ拒否 |
| T04 | D1 statement 数 | 1 endpoint あたり3件以下 |
| T05 | response header | private, no-store |
#### Commands
```bash
npm run build --workspace=@flamenode/api
node --test apps/api/test/manage.parity.test.mjs
npm run check:public-api-leaks
npm run typecheck
npm run test:unit
```
#### Ledger updates
`API_MATRIX.md` に読み取り endpoint の行。manage の page 行の target。
#### DONE checklist
- [ ] 12ルートの endpoint と parity が PASS
- [ ] 権限が API で確認されている
#### STOP
- 権限を SPA だけで判定する形になったら止める。
- statement が3件を超えるなら lead に確認する。
#### Rollback
PRをrevert。

### MIG-0625: Admin 読み取り API その A（users・videos・events・moderation）
- **Model:** lead
- **Readiness:** NEEDS_REFINEMENT — 完了（DONE、2026-10-25 に範囲を縮小。#349 merge `acf18f50`、Opus APPROVE on `2b2b6a5d`）。残り（videos/[id]、videos/[id]/members、users/[id]/edit、users `?view=xid` の icon_url）は MIG-0635、events/new の formInitial は MIG-0604 U04 + MIG-0705（D-13-48〜71）
- **Recipe:** R-API
- **Runtime:** S2
- **Depends on:** MIG-0601, MIG-0608 / **Decisions:** D-05 DECIDED, D-13-48
- **Verified against:** `a1b910b4` (2026-10-25)
#### Source snapshot
- G13 `app/(admin)/admin/**` のうち users / videos / events / moderation / x-link-requests / x-id-merges / event-groups / event templates の一覧と詳細。分担表は `work-items/MIG-0625.md` U01 と `ROUTE_MATRIX.md` "Admin read endpoint ownership"。
- `events/[id]`, `/edit`, `/slots`, `/staff` は `/manage/...` への `redirect()` だけで API は不要（ROUTE_MATRIX.md:192 の NONE）。
#### Owned paths
- 新規（済み）: `apps/api/src/routes/adminRead/{users,videos,events,moderation,eventGroups,eventTemplates,xIdMerges,xLinkRequests,shared}.ts`, `packages/contracts/src/adminRead.ts`, `apps/api/test/adminRead.parity.test.mjs`, `apps/api/test/support/adminReadSeed.mjs`
- 触らない: `app/**`, `src/lib/actions/**`
#### Micro-units
- **U01 inventory** / **U02 contract** / **U03 routes** / **U04 parity**: すべて DONE（#349）。
#### Test cases
| ID | 入力/操作 | 期待 |
| --- | --- | --- |
| T01 | 対象 page の正常系 | CURRENT loader と DTO が一致（済み） |
| T02 | route × role（guest, user, staff, owner, admin） | admin 以外を拒否（済み） |
| T03 | D1 statement 数 | 1 endpoint あたり3件以下（済み） |
| T04 | response | private, no-store。secret・token を含まない（済み） |
#### Commands
```bash
npm run build --workspace=@flamenode/api
node --test apps/api/test/adminRead.parity.test.mjs
npm run check:public-api-leaks
npm run typecheck
```
#### Ledger updates
`API_MATRIX.md` の Admin read A 節の "Not covered" 行を「MIG-0635 / MIG-0604 U04 / MIG-0705（D-13-48〜71）」に書き換える。
#### DONE checklist
- [x] 縮小後の担当範囲の page すべてに endpoint と parity
- [x] MIG-0626 / MIG-0635 との分担に漏れが無い
#### STOP
- 権限を緩める必要が出たら止める。
#### Rollback
PRをrevert。

### MIG-0626: Admin 読み取り API その B（settings・audit・ops・残り）
- **Model:** lead
- **Readiness:** NEEDS_REFINEMENT — READY（#353 merge `27b69bfe`、Opus APPROVE on `ca461626`。残りは U05 integrity、U06 deep health、U07 RH-017。決定 D-13-51 / 73 / 80）
- **Recipe:** R-CORE, R-API
- **Runtime:** S2
- **Depends on:** MIG-0601, MIG-0608 / **Decisions:** D-05 DECIDED, D-13-51, D-13-52, D-13-59
- **Verified against:** `a1b910b4` (2026-10-25)
#### Source snapshot
- 済み: 25 endpoint + chunk 1（`apps/api/src/routes/adminRead/{settings,audit,ops}.ts`）。残りは `ops.ts` の STOP 記録 3 件:
  - `/admin/health?deep=1|run=1` → 501（`apps/api/src/routes/adminRead/ops.ts:232-241`）。CURRENT `src/lib/admin/healthChecks.ts:677` `runHealthChecks`（22 check、`:19`〜`:640` の `check*` 関数）。
  - `/admin/health/integrity?run=1` → 501（`ops.ts:320-332`）。CURRENT `src/lib/admin/integrityChecks.ts:148` `runIntegrityChecks`（28 check、`:56` `makeCheck` が1 check 1 文の window count）+ `permissionIntegrityChecks.ts`。
  - static-builds の shared-input diagnostics → MIG-0627（D-13-52）。
- RH-017 の検査本体: `src/lib/health/deepHealth.ts`（448 行。`./schemaContract.ts`, `./artifactSlo.ts`, `./queueEmergency.ts`, `../r2Body.ts`, `../publicData/publicVisibilityManifestCore.ts` を import）。Hono 側 `apps/api/src/routes/health.ts:53-77` は token gate だけ CURRENT と一致。
- `integrityChecks.ts` は `DB`、`healthChecks.ts` は `LibSQLDatabase`（`AnyDb`）型の drizzle を受け取る。server-core の型は `ServerCoreDb`（`packages/server-core/src/db.ts`）。`apps/api` の routes は drizzle を直接 import できない（`scripts/check-server-core-boundaries.mjs`、MIG-0617 L2）ので `apps/api/src/middleware/db.ts#dbMiddleware` の `c.get("db")` を使う。
#### Owned paths
- U05: `+packages/server-core/src/admin/integrityChecks.ts`, `+packages/server-core/src/admin/permissionIntegrityChecks.ts`。bridge: `src/lib/admin/integrityChecks.ts`, `src/lib/admin/permissionIntegrityChecks.ts`
- U06: `+packages/server-core/src/admin/healthChecks.ts`。bridge: `src/lib/admin/healthChecks.ts`
- U05 / U06 共通: `apps/api/src/routes/adminRead/ops.ts`, `packages/contracts/src/adminReadOps.ts`, `apps/api/test/adminReadOps.parity.test.mjs`, `packages/server-core/package.json`（exports）
- U07: `+packages/server-core/src/health/deepHealth.ts`（と import 先の `schemaContract` / `artifactSlo` / `queueEmergency`）, bridge `src/lib/health/deepHealth.ts`、`apps/api/src/routes/health.ts`, `apps/api/test/health.test.mjs`
- 触らない: `app/**`, `src/lib/actions/**`
#### Micro-units
- **U05 integrity per check**（R-CORE → R-API）: 3 file を core へ移す（bridge の1行目 `// Compatibility bridge (MIG-0626, D-10): ...`）。core に `INTEGRITY_CHECK_IDS`（28 個、`runIntegrityChecks` の順）と `runIntegrityCheckById(db, id)` を足す（`runIntegrityChecks` は残し、同じ定義を使う）。`GET /api/admin-read/ops/integrity/:checkId`: 未知の id は 404、1 request = session + 1 文。`?run=1` の 501 は SPA が check id を1つずつ呼ぶ形に置き換え、`GET /ops/integrity` は `{ ran:false, results:[], checkIds }` を返す。
- **U06 deep health per check**（D-13-51）: 同じ形で `HEALTH_CHECK_IDS`（22 個）と `runHealthCheckById(db, id)`、`GET /api/admin-read/ops/health/checks/:checkId`。`?deep=1` の 501 は `checkIds` を返す形に置き換える。
- **U07 RH-017**（D-13-59）: `deepHealth.ts` を core へ移し、`health.ts` の `/deep` が token gate の後に core の `runDeepHealthChecks(env)` を呼ぶ。応答の status 写像は CURRENT（`app/api/health/deep/route.ts:24-31`）と同じ。
#### Test cases
| ID | 入力/操作 | 期待 |
| --- | --- | --- |
| T01 | Admin 45 すべて | MIG-0625 / MIG-0635 / 本 task の endpoint、または NONE / MIG-0627（D-13-52） |
| T02 | 正常系（各 check id） | CURRENT の同じ check と結果が一致 |
| T03 | admin 以外 | 拒否 |
| T04 | D1 statement 数 | integrity は session + 1、health は CURRENT の check と同じ数 |
| T05 | 外部診断が失敗 | CURRENT と同じ劣化表示 |
| T06 | RH-017 正しい token | CURRENT `runDeepHealthChecks` と同じ body と status |
| T07 | 移動前後の `npm run test:unit` | 件数と PASS が同じ |
#### Commands
```bash
npm run build --workspace=@flamenode/api
node --test apps/api/test/adminReadOps.parity.test.mjs
node --test apps/api/test/health.test.mjs
npm run test --workspace=@flamenode/server-core
node scripts/check-server-core-boundaries.mjs
npm run check:public-api-leaks
npm run typecheck && npm run test:unit && npm run test:critical
```
#### Ledger updates
`API_MATRIX.md` の Admin read B 節と RH-017 行。`ROUTE_MATRIX.md` の Admin 45 担当表（health / integrity を DONE、static-builds の diagnostics を MIG-0627）。`FILE_MIGRATION_MATRIX.md` に core の新規行。
#### DONE checklist
- [ ] Admin 45 の全 page に read endpoint がある（static-builds の shared-input diagnostics は MIG-0627、D-13-52）
- [ ] secret・token が response に出ない
- [ ] RH-017 の仮実装が残っていない
#### STOP
- 外部 request が budget を超えるなら lead に確認する。
- check の SQL を1文字でも変える必要が出たら止める（移動だけ）。
- `deepHealth.ts` の import 先が `src/lib/publicData/loader.ts` に届くと分かったら止める（D-10 で loader は移さない）。
#### Rollback
PRをrevert（bridge なので revert で戻る）。

### MIG-0627: R2 artifact の読み手を build 時 snapshot に置き換える（MIG-0907 の前提）
- **Model:** lead
- **Readiness:** NEEDS_REFINEMENT — MIG-0509 と MIG-0649 の後。棚卸し（旧 U01）は D-14-13 で MIG-0649 に分割したので、その表と CI 検査を入力にする
- **Recipe:** R-REMOVE
- **Runtime:** B
- **Depends on:** MIG-0509, MIG-0649 / **Decisions:** D-09 DECIDED, D-14-13
- **Verified against:** `c5a62b4d` (2026-10-23)
#### Source snapshot
- G14 R2 artifact の producer（`workers/json-generator`）と consumer: RH-019 member-suggestions artifact、RH-026 `top` / `sections` / `stats.v1`、RH-028 event-base、`sitemapSources` の index、`ga-analytics` の `list/recent.json`、MIG-0611 の `rules/current.json`。
- MIG-0907 T02 は「R2 artifact は書かれない」とするが、生き残る Hono / worker の読み手が何に置き換わるかを書く task が無い（GA4 だけは `PHASE_4_5_SPEC.md` の MIG-0509 が扱う）。
- MIG-0631 の Hono 読み手 2 件（2026-10-24、MIG-0631 Q2 で Fable が決定）: RH-015 static_only の `events/index.json`、RH-012 の `events/<id>/release.v1.json`。両者とも GET は D1 / Queue / `public_build_state` に書かない（MIG-0631 L3）。MIG-0907 の後、欠けた artifact を作り直すのは build だけ（`apps/site/scripts/produceSnapshots.ts` が build ごとに全 public event の release と events index を D1 から作り直す）。
- `visibility/blocked-entities.v1.json` は残す側（producer は server-core `visibility/eventTransition.ts` などの S3 経路で、json-generator ではない）。
#### Owned paths
- 新規: なし（`R2_ARTIFACT_CONSUMERS.md` は MIG-0649 が作る。本 task は更新する）
- 変更: 読み手の file（棚卸しで確定。1 PR は1系統）。build の artifact publish と完全性検査の file（U04 / U05 で確定）
#### Micro-units
- **U01 inventory**: MIG-0649 へ分割（D-14-13）。
- **U02 replace**: 読み手を1系統ずつ build 時 snapshot へ。DTO は変えない。
- **U03 gate**: MIG-0907 の U01 が参照できる状態（読み手0件）を確認。
- **U04 API artifact publish**: API が読む artifact（MIG-0631 の 2 種）を build が同じ key / schema で R2 へ差分 PUT する（変わった object だけ）。PUT 件数を build log に出し、`BUILD_TIME_DATA.md` §6 に月間 Class A の見積りを書く（無料枠の 80% 以下）。build が R2 に書くのは runtime の書き込みではないので、`ZERO_1102.md` §4.7「request 時に書かない」とも MIG-0907 T02 とも矛盾しない。
- **U05 build 内の完全性検査**: snapshot の public event id と R2 の release key を照合する。欠けは最大 3 回再試行し、残れば build を失敗にする。
#### Test cases
| ID | 入力/操作 | 期待 |
| --- | --- | --- |
| T01 | `rg` で R2 get key | producer 一覧に無い読み手が0件 |
| T02 | 置き換え後の各読み手 | 置き換え前と同じ DTO |
| T03 | snapshot 欠落 | CURRENT と同じ劣化 |
| T04 | 非本番で release の artifact key を削除 → RH-012 → build publish → RH-012 | 削除後は 503、publish 後は 200。PUT 件数 = 欠けた数 |
#### Commands
```bash
npm run test:unit
npm run typecheck
npm run check:project-docs
```
#### Ledger updates
`R2_ARTIFACT_CONSUMERS.md`（MIG-0649 が作成）の置き換え先の列を「置き換え済み」に更新。
#### DONE checklist
- [ ] 全 artifact に置き換え先がある
- [ ] MIG-0907 が依存として参照できる
- [ ] `/admin/static-builds` の shared-input diagnostics（`src/lib/admin/staticSharedInputDiagnostics.ts:52` `loadStaticSharedInputDiagnostics`）が build 時 snapshot を読む形になり、MIG-0626 の read endpoint が R2 の head 以外を返せる（MIG-0626 から移管、D-13-52）
#### STOP
- 本番 R2 の書き込みや削除が必要になったら止める（明示承認事項）。
- build 用の R2 write credential が要ると分かったら止める（secret。Yugo の承認事項）。
- artifact の DTO を変える必要が出たら止める。
#### Rollback
PRをrevert。

### MIG-0628: 新 Worker の wrangler 設定・dry-run・smoke の連鎖
- **Model:** lead
- **Readiness:** NEEDS_REFINEMENT — READY（D-14-3: 依存を MIG-0405 だけにした。`apps/ops` の設定は MIG-0704 U01。本物の deploy・Route・secret の操作は含めず、明示承認まで止まる。実装は Sonnet、review は Opus）
- **Recipe:** R-EVIDENCE
- **Runtime:** N
- **Depends on:** MIG-0405 / **Decisions:** D-02 DECIDED, D-13-20, D-14-3
- **Verified against:** `dde6fa8` (2026-10-25)
#### Source snapshot
- CURRENT: `wrangler.toml`（`flamenode-web`）の binding `DB`, `KV`, `BUCKET`, `NEXT_INC_CACHE_R2_BUCKET`, `ASSETS`, `WORKER_SELF_REFERENCE`、queue producer 3（`NOTIFICATION_WAKE_QUEUE`, `STATIC_REBUILD_WAKE_QUEUE`, `YOUTUBE_SYNC_WAKE_QUEUE`）、`[vars]`、`[placement]`、`[observability]`、id は placeholder（:65 の comment）。Workers Builds は `flamenode-web` にだけ attach（G15）。`scripts/cloudflare-production.mjs` と `scripts/smoke-cloudflare.mjs` は CURRENT の4 Worker 固定（`smoke-cloudflare.mjs:399`）。
- 新 Worker の binding（code から読んだもの）:
  - gateway（`apps/site`）: `apps/site/src/gateway/index.ts:37-53` `GatewayEnv` = `ASSETS`（`run_worker_first = true` が必須、:38）, `R2_STORAGE`, `REBUILD_QUEUE`（D-13-20、非本番だけ）, `AUTH_ORIGIN`（service binding、Auth.js origin）, `VISIBILITY_KV`, `DB`（MIG-0411 consumer だけ）, `PUBLIC_PAGE_STYLESHEETS`、`edgePolicy.ts:23-31` `EdgePolicyEnv` = `NEXT_PUBLIC_SITE_URL`, `AUTH_URL`, `MAINTENANCE_MODE`, `KV`。
  - api（`apps/api`）: `apps/api/src/env.ts:5-24` `Bindings` = `DB`, `BUCKET`, `KV`, `BUILD_COMMIT_SHA`, `WORKER_ADMIN_TOKEN`, `AUTH_SECRET`, `PUBLIC_VISIBILITY_GUARD_MODE`, `FORCE_STATIC_ONLY`, `YOUTUBE_DAILY_QUOTA_LIMIT`, `NEXT_PUBLIC_SITE_URL`, `FLAMENODE_LOCAL_PREVIEW`, `ADMIN_SPREADSHEET_ENABLED`, `ADMIN_SPREADSHEET_PAGE_SIZE`。Queue producer は持たない（D-0603-1 の wake 0）。
  - personal SPA（`apps/app`）: Vite の静的 build（`apps/app/package.json` `build`）。Worker code は無く、Static Assets と `public/_headers`（D-13-8）だけ。
- `apps/ops` は存在しない（MIG-0704 が作る）。
#### Owned paths
- 新規: `+apps/site/wrangler.toml`, `+apps/api/wrangler.toml`, `+apps/app/wrangler.toml`, `+docs/migration/cloudflare/NEW_WORKER_DEPLOY.md`, `+scripts/new-worker-smoke-list.mjs`, `+scripts/new-worker-smoke-list.test.mjs`
- 変更: `.github/workflows/migration-docs-check.yml`（dry-run 3 本と smoke list test の step）, `docs/migration/cloudflare/TOPOLOGY.md`（target Worker 表を CURRENT と分けて追記）, `docs/migration/FILE_MIGRATION_MATRIX.md`
- 触らない: `wrangler.toml`（CURRENT）, `scripts/cloudflare-production.mjs`, `scripts/smoke-cloudflare.mjs`（CURRENT の deploy 経路。新 Worker 用は新規 script に分ける）、本番 Worker・Route・Custom Domain・secret・Remote D1
#### Micro-units
- **U01 binding 表**: `NEW_WORKER_DEPLOY.md` に Worker（gateway / api / app）ごとの binding・vars・secret 名を上の Source snapshot から表にし、CURRENT `wrangler.toml` の対応する行を並べる。secret（`AUTH_SECRET`, `WORKER_ADMIN_TOKEN`）は名前だけ書き、値は書かない。
- **U02 wrangler files**: 3 file。id は CURRENT と同じく placeholder（`00000000000000000000000000000000` 形式）、`compatibility_date` と `compatibility_flags` は CURRENT と同じ値。gateway は `[assets] run_worker_first = true`。Route・Custom Domain の行は書かない。
- **U03 dry-run**: CI で `npx wrangler deploy --dry-run --outdir <tmp> --config apps/<x>/wrangler.toml` を3本（site と app は先に build）。
- **U04 smoke list**: `new-worker-smoke-list.mjs` が `ROUTE_MATRIX.md` と `API_MATRIX.md` の「Hono / new」列が埋まった path を読み、method・path・期待 status の一覧（JSON）を出す。test は「`apps/api/src/app.ts` に mount された route で一覧に無いもの」が 0 件であることを確かめる。commit SHA の収束検査は CURRENT `smoke-cloudflare.mjs` と同じ方式（`/api/health` の `BUILD_COMMIT_SHA`）を手順書に書く。MIG-0805 が cutover 前に同じ test を再実行する。
- **U05 手順書**: 実 deploy・Route・secret の手順を `NEW_WORKER_DEPLOY.md` に書く。実行は owner の明示承認後。
#### Test cases
| ID | 入力/操作 | 期待 |
| --- | --- | --- |
| T01 | 3 Worker の `wrangler deploy --dry-run` | 全て PASS |
| T02 | `apps/api/wrangler.toml` の binding と `apps/api/src/env.ts` の `Bindings` | key が一致（test で比較） |
| T03 | smoke list と mount 済み route | 一覧に無い route が 0 件 |
| T04 | gateway の `run_worker_first` | true（test で TOML を読む） |
| T05 | 3 file に実 id・secret 値 | 0 件（placeholder だけ） |
#### Commands
```bash
npm ci --no-audit --no-fund
npm run build --workspace=@flamenode/site && npm run build --workspace=@flamenode/app
npx wrangler deploy --dry-run --outdir /tmp/wr-site --config apps/site/wrangler.toml
npx wrangler deploy --dry-run --outdir /tmp/wr-api --config apps/api/wrangler.toml
npx wrangler deploy --dry-run --outdir /tmp/wr-app --config apps/app/wrangler.toml
node --test scripts/new-worker-smoke-list.test.mjs
npm run check:project-docs
```
#### Ledger updates
`cloudflare/TOPOLOGY.md` に target の Worker 表を追記（CURRENT と区別）。`FILE_MIGRATION_MATRIX.md` に新規 file。
#### DONE checklist
- [ ] T01〜T05 が PASS、dry-run が CI で PASS
- [ ] 実 deploy・Route・secret を実行していない
- [ ] MIG-0704（`apps/ops`）と MIG-0805（cutover）が参照する手順書がある
#### STOP
- 本番 Worker・Route・Custom Domain・secret・Remote D1 の操作は明示承認が出るまで止める。
- dry-run が実 id や `wrangler login` を要求したら止める（placeholder のまま通らない設定は書かない）。
#### Rollback
PRをrevert（設定 file・script・文書だけ）。

### MIG-0629: admin audit settings + restore dry-run APIs（監査設定・dry-run API）
- **Model:** lead
- **Readiness:** NEEDS_REFINEMENT — READY（MIG-0617 DONE。M1〜M3 は 2026-10-24、D-13-53〜76 は 2026-10-25 に決定。実装は Sonnet、review は Opus）
- **Recipe:** R-API
- **Runtime:** S3
- **Depends on:** MIG-0602, MIG-0616, MIG-0617 / **Decisions:** D-01 DECIDED, D-10 DECIDED, M1〜M3, D-13-53, D-13-54, D-13-55
- **Verified against:** `a1b910b4` (2026-10-25)
#### Source snapshot
| CURRENT | ID | file |
| --- | --- | --- |
| audit settings update | SA-009 | `src/lib/actions/audit-admin.ts:47` `updateAuditLogSettingsAction`（schema `:31-37`、core `updateAuditLogSettings` を呼ぶ） |
| audit dry run | SA-010 | `src/lib/actions/audit-admin.ts:91` `getAuditLogDryRun`（schema `:77-80`、`restoreAuditLog(db, {auditId, userId, reason, dry_run:true})`） |
- 両方 `requireAdminWrite("admin_permissions")`（`:22`）。
- core: `packages/server-core/src/audit/settings.ts:45` `updateAuditLogSettings`（before の select 1、`mutateWithAudit` で `system_settings` 更新 + 監査 1 件、`context: "audit_settings_update"`、`retention_class: "long_audit"`）、`packages/server-core/src/audit/restore.ts:174` `restoreAuditLog(db, options, host: AuditRestoreHost)`（host 型は `:35`）。
- `apps/api` の部品: `apps/api/src/routes/admin/index.ts`（origin → session → writeGuard → `dbMiddleware`。非 GET だけ）、`apps/api/src/routes/admin/body.ts`（`readAdminJsonBody` 64 KiB、`auditPreloaded`）、`apps/api/src/middleware/costGuard.ts`（`costGuardMiddleware`）。手本は `apps/api/src/routes/admin/announcements.ts`。
#### lead 決定（2026-10-24、Fable（owner-delegate）。Yugo の standing instruction「検討事項は推奨で進めて」に基づく）
- **M1**: SA-010 は core の `restoreAuditLog` を `dry_run: true` で呼ぶ。8 adapter と capability の写しは作らない（D-10）。host は D-13-54。
- **M2**: SA-009 / SA-010 とも `POST` + `writeGuardMiddleware` + `costGuardMiddleware("admin_permissions")`。
- **M3**: MIG-0617 の後に実装する（満たした）。
#### Owned paths
- 新規: `+apps/api/src/routes/admin/audit.ts`, `+packages/contracts/src/admin/audit.ts`, `+apps/api/test/adminAudit.parity.test.mjs`
- 変更: `apps/api/src/routes/admin/index.ts`（`admin.route("/audit", auditAdminRoutes)` 1 行と import 1 行）, `packages/contracts/src/admin/index.ts`（export 1 行）, `packages/server-core/src/audit/settings.ts`（D-13-53 の第4引数だけ）
- 触らない: `src/lib/actions/**`, `packages/server-core/src/audit/restore.ts`
#### Micro-units
- **U01 SA-009**: `POST /api/admin/audit/settings`。body は `readAdminJsonBody`（413）→ contracts の zod（CURRENT `settingsPatchSchema` と同じ `z.coerce.number().int().min().max().optional()` 5 項目、最初の issue の message、無ければ「入力エラー」）。`updateAuditLogSettings(c.get("db"), userId, patch, auditPreloaded(c))`。成功 `{ok:true}` 200、zod 失敗 400、例外は `{ok:false, message: err.message}`（Error でなければ「設定の更新に失敗しました。」）500。読みは user + settings（guard）+ before 1 = 3 + batch。
- **U02 SA-010**: `POST /api/admin/audit/dry-run`。zod は `audit_id` trim min 1、`reason` trim min 1 max 500。D-13-54 の host を渡し、`{ok, message, diff}` を 200。
- **U03 parity**: 実 CURRENT action（tsx 子 process、`apps/api/test/auditParity.test.mjs` と同じ起動）と同じ sqlite で、監査行（id・時刻・`actor_snapshot_json` を含む）、`system_settings`、dry run の `diff` を比較。
#### Test cases
| ID | 入力/操作 | 期待 |
| --- | --- | --- |
| T01 | 別 origin からの POST | 拒否、D1 読み 0 |
| T02 | 非admin | CURRENT と同じ拒否、監査0 |
| T03 | 設定更新の成功 | 監査1件が CURRENT と byte 一致、読み 3 + batch 1 |
| T04 | dry run（競合なし / 競合あり / 期限切れ / 既に復元済み / 存在しない id） | 書き込み0、CURRENT と同じ body。host が呼ばれない |
| T05 | CostGuard が `admin_permissions` を止めている | 503、書き込み 0 |
| T06 | 64 KiB 超の body | 413 |
#### Commands
```bash
npm run build --workspace=@flamenode/api
npm run test --workspace=@flamenode/api
npm run test --workspace=@flamenode/server-core
npm run typecheck
npm run test:critical
npm run test:unit
```
#### Ledger updates
`API_MATRIX.md` の SA-009〜010 に Hono エンドポイントと D-13-54 の記録した例外（6 文）。
#### DONE checklist
- [ ] SA-009 / SA-010 で成功・拒否・競合と監査が CURRENT と一致
- [ ] core の Next 側呼び出しの diff が 0（第4引数を渡していない）
- [ ] 本番 Route を変更していない
#### STOP
- 監査の意味を変える必要が出たら止める。
- `restore.ts` を変える必要が出たら止める（dry run が host を使うと分かった場合を含む）。
#### Rollback
Phase 6 共通契約のとおり。

### MIG-0630: Video edit 画面の読み取り API（/dashboard/edit/[id] + permissions）
- **Model:** lead
- **Readiness:** NEEDS_REFINEMENT — 完了（DONE）。U01 / U02a / U03 / U04 は PR #382、U02b（form-options）は PR #385 でマージ済み、U05 は STATUS 統合（`work-items/MIG-0630.md`）。MIG-0703 は他の依存（MIG-0603 / 0604 / 0702）が DONE になるまで BLOCKED
- **Recipe:** R-API
- **Runtime:** S2
- **Depends on:** MIG-0601, MIG-0608, MIG-0623 / **Decisions:** D-05 DECIDED
- **Verified against:** `84fbd458` (2026-10-23)
#### Source snapshot
- MIG-0623 の分割で移動（2026-10-23、Opus レビュー指摘）。`app/(auth)/dashboard/edit/[id]/page.tsx`（813 行）と `permissions/page.tsx` は RSC loader で D1 / auth を直接読み、対応する Hono 読み取り endpoint が無い。MIG-0703（Entry SPA）の slotted 完了後の遷移先、および MIG-0701/0702 の edit 導線が使う。
- 対象: `/dashboard/edit/[id]`, `/dashboard/edit/[id]/permissions`。
#### Owned paths
- 新規: `+apps/api/src/routes/personal/edit/**`, `+packages/contracts/src/personal/edit.ts`, `+apps/api/test/personalEdit.parity.test.mjs`
- 触らない: `app/**`（本番切替まで）, `src/lib/actions/**`, `apps/api/src/routes/personal/entry/**`（MIG-0623 の所有）
#### Micro-units
- **U01 inventory**: 2ルートの loader が読む query と戻り値（作品本体・共同編集者・chapter・event link・質問回答・権限）を表にし、100 行 / 64 KiB を超える面を特定する。
- **U02 contract + route**: DTO と `GET /api/personal/edit/:id`（所有者 / 共同編集者の権限確認を API 側でも行う）。
- **U03 permissions**: `GET /api/personal/edit/:id/permissions`。
- **U04 parity**: 実 CURRENT loader と Hono を `node:sqlite` で比べる。
- **U02b form-options**: `GET /api/personal/edit/:id/form-options?privileged=&offset=`（受付イベント ∪ 所属イベント、質問、既存回答、ステージ許可回答、ソフト / アイコン / チャンネル候補。`GET /:id` と同じ権限 gate、3 statement / 4 bind、`truncated` / `nextOffset`、64 KiB）。
#### Test cases
| ID | 入力/操作 | 期待 |
| --- | --- | --- |
| T01 | 所有者・共同編集者の正常系 | CURRENT loader と DTO が一致 |
| T02 | 他人の作品・存在しない id・未ログイン | CURRENT と同じ status / redirect 相当 |
| T03 | D1 失敗 | CURRENT と同じ劣化 |
| T04 | D1 statement 数 | 3 件以下（S2） |
| T05 | 100 行超・64 KiB 超 | LIMIT <= 100、`truncated` / offset、response <= 64 KiB |
#### Commands
```bash
npm run build --workspace=@flamenode/api
node --test apps/api/test/personalEdit.parity.test.mjs
npm run typecheck
npm run test:unit
```
#### Ledger updates
`API_MATRIX.md` に読み取り endpoint の行。`FILE_MIGRATION_MATRIX.md` の edit page 行の target。
#### DONE checklist
- [ ] 2ルートに endpoint があり parity が PASS
- [ ] 全 LIMIT <= 100、response <= 64 KiB
- [ ] 本番 Route を変更していない
#### STOP
- 認証の cookie の発行・更新が必要になったら止める（Phase 8）。
- D1 statement が 3 件を超えるなら、分割か projection を lead に確認する。
#### Rollback
PRをrevert。

### MIG-0631: 公開 event 一覧・release の Hono route（RH-015, RH-012。live mode は D1、static_only と release は CURRENT の R2 artifact）
- **Model:** lead
- **Readiness:** NEEDS_REFINEMENT — READY（lead 決定 L1〜L6 は 2026-10-24 に実コードで決定。実装は Sonnet、review は Opus。U01 / U02 は今すぐ着手できる。U03 以降は MIG-0617 の merge（`apps/api` が `@flamenode/server-core` を import できる状態。MIG-0617 L1/L2）の後）
- **Recipe:** R-DOMAIN（U01）, R-CORE（U02）, R-API（U03〜U05）
- **Runtime:** S2
- **Depends on:** MIG-0602, MIG-0614 / **Decisions:** D-09 DECIDED, D-10 DECIDED, D-12 DECIDED（MIG-0631 の行は 2026-10-24 に L4 で訂正）
- **Verified against:** `5d4e9800` (2026-10-24)
#### Source snapshot
- RH-015 `app/api/events/route.ts`: rate limit（`checkPublicApiRateLimit(req, "/api/events")`）→ `page`（既定 1、上限なし）/ `limit`（既定 60、上限 `MAX_PUBLIC_EVENT_LIMIT` = 60）→ `loadStaticEventsIndex()`（throw なら 503 `database_unavailable`）→ **`strategy === "static_json_only"` で index があるときだけ** R2 artifact を slice して `pickKeys(PUBLIC_EVENT_KEYS)` → static_only / maintenance で index が無ければ 503 `public_data_unavailable` → **それ以外（normal / economy / read_only = `static_json_with_live_overlay`）は毎回 D1** を読む（`WHERE visibility_status = 'public' ORDER BY start_time DESC, created_at DESC LIMIT ? OFFSET ?`。失敗は 503 `database_unavailable`）。normal では loader の結果は捨てられ、応答は D1 から作られる（「D1 fallback」ではなく主経路）。Cache-Control は両経路とも `public, max-age=60, s-maxage=120, stale-while-revalidate=300`、ETag / 304 あり（`publicJsonResponse`）。
- RH-012 `app/api/event-endpoints/[id]/release/route.ts`: rate limit（`"/api/event-endpoints/:id/release"`）→ id を `decodeURIComponent` + trim し、1〜128 文字以外は 404 → **D1 1 文**（`id = ? AND visibility_status = 'public' AND public_api_enabled = 1 LIMIT 1`。binding 例外は 503 `runtime_bindings_unavailable`、null は `db_unavailable`、query 失敗は `database_unavailable`、行なしは 404）→ 全 mode で `loadStaticEventRelease(id)`（R2 `events/<id>/release.v1.json`）→ data なしは state により 404 / 503 `public_data_reflecting` / 503 `public_data_unavailable` → `event.id` 不一致は 503 `public_data_unavailable` → 200（`public, max-age=30, s-maxage=60, stale-while-revalidate=120`）。404 は `public, max-age=60`。
- loader（`src/lib/publicData/loader.ts`）のうち両 route が実際に通る部分: `loadPublicJson`（L758）の maintenance 判定（`resolvePublicOperationMode({ allowD1: true })` だが db を渡さないので D1 は読まない）→ `resolvePublicVisibilityGuard`（L309。`PUBLIC_VISIBILITY_GUARD_MODE` が enforce のときだけ manifest を読み、読めない / ETag が無いと unavailable。`events_index` は fence entity なし、`event_release` は event として blocked 判定。observe は blocked をログに出すだけ）→ isolate micro-cache と Cache API（fresh は events index 180s / release 120s、stale はその 2 倍まで。events index の stale は enforce で manifest があるときだけ）→ R2 の bounded read（`PUBLIC_STATIC_JSON_MAX_OBJECT_BYTES` = 16 MiB。壊れた / 大きすぎる / 例外は miss）→ `filterPublicArtifactPayload` → events index は `items` が空なら miss → miss は `resolvePublicJsonMiss`（L486）で、D1 の operation mode、`probePublicStaticTarget`（events_index / event_release は D1 を読まず public）、`directEnqueueStaticRebuild`（server-core。active 行 SELECT + cooldown SELECT + INSERT の 3 文、競合時は最大 9 文。`public_miss` cooldown 300s、priority は static_only か event_release なら high）と Queue wake。`normalizeStaticEventsIndex` は point event を除き、`shouldUseStaticCollection` は static_only では空でも採用する。
- CURRENT の R2 artifact は `workers/json-generator/rebuild.ts` が書く（`rebuildEventsIndex` L1167: `visibility_status = 'public'` かつ非 point、`ORDER BY start_time DESC LIMIT EVENTS_INDEX_MAX_ROWS`（200）、group sections 付き）。`apps/site/scripts/produceSnapshots.ts` も同じ `rebuildTarget` を in-memory bucket に対して実行して build 時 snapshot を作る（R2 へは上げない）。MIG-0509 / MIG-0627 で producer が替わっても key と schema は変えない前提（MIG-0627 STOP「DTO を変える必要が出たら止める」）。
- 本番の guard mode は `observe`（`wrangler.toml` L51）。manifest は `visibility/blocked-entities.v1.json`（≤ 1 MiB。server-core `visibility/manifestR2.ts#readVisibilityManifestObject`）。event の非公開化は D1 更新の前に manifest へ block を書き（server-core `visibility/eventTransition.ts`）、再公開後の artifact 生成が終わるまで block を外さない。
- `apps/api` の既存部品: `routes/live/operationMode.ts#resolvePublicOperationMode(env, { allowD1 })`（CURRENT と同じ優先順位）、`routes/publicAboutStats.ts`（R2 1 回の前例）、`routes/videos/detail.ts`（rate limit / ETag の写し。本 task では触らない）。`apps/api` は `@flamenode/server-core` にまだ依存していない（MIG-0617 L1/L2 で追加）。
- `slotViewerOverlayRoutes`（MIG-0604 U01）は `/api/events` に mount され、`use("*")` で private header と session lookup を `/api/events/*` 全体に掛ける（`apps/api/src/routes/events/viewerOverlay.ts` L170 / L176、MIG-0604 work item の Notes）。
#### lead 決定（2026-10-24、Opus lead。各決定に「採らない案」を併記）
- **L1 置き場所**: 純粋な部品だけを共有 package へ移し、request の組み立ては `apps/api` に置く。U01 で `src/lib/utils/eventStatusCore.ts`（`isPointEvent` を含む。import なし）を `packages/domain/src/event/status.ts` へ（R-DOMAIN）。U02 で `src/lib/publicData/{normalize,visibility,staticEventsIndexCore,staticEventReleaseCore,publicArtifactVisibility}.ts`、`src/lib/utils/publicXUser.ts`、`src/lib/api/{publicDto,publicApi}.ts` を `packages/server-core/src/publicData/` へ（R-CORE。元の場所は re-export の bridge）。`staticEventDetailCore.ts` からは `EVENT_RELEASE_SCHEMA_VERSION` と `eventReleaseObjectKey` だけを core へ移し、detail core は core から import する。R2 read + guard + filter + normalize の組み立て（`publicSnapshot.ts`）は、呼び出し元が `apps/api` の 2 route だけなので `apps/api/src/routes/events/` に置く。根拠: D-10「境界のある純粋な `*Core.ts` だけを、各 API の task で必要になった時に抜き出す」。loader は D-10 で移さない。採らない案: (i) normalizer の写しを `apps/api` に置く（約 1,000 行の二重化。`publicAboutStats.ts` の写しは 1 関数だけ）、(ii) `apps/api` から root の `src/lib/**` を相対 import する（`apps/api` に前例が無く、`server-only` を含む木への依存方向を作る）、(iii) loader の port（D-10・`ZERO_1102.md` §4.7 に反する）、(iv) guard を server-core の新関数にする（Next は loader を使い続けるので呼び出し元が 1 つ）。
- **L2 可視性 guard（privacy）**: CURRENT と同じ規則にする。`c.env.PUBLIC_VISIBILITY_GUARD_MODE` を server-core の `resolvePublicVisibilityGuardMode` で解決する。enforce は manifest を読み、読めない・ETag が無い・壊れている・大きすぎるときは 503 `public_data_unavailable`（fail-closed）。`event_release` の event が blocked なら 404。artifact は `filterPublicArtifactPayload(targetType, payload, enforce のときだけ context)` で行を落とす。observe は manifest を読んで blocked をログに出すだけ（CURRENT と同じ JSON 形）、off は読まない。ただし `events_index` は fence entity が無いので、observe では manifest を読まない（`loader.ts` L278-L279。release と挙動が違う）。RH-015 の live mode は D1 が正本なので guard を通さない（CURRENT も normal では loader の結果を捨てる）。非公開・未公開の event が出ない保証は CURRENT と同じ: live mode は D1 の `visibility_status = 'public'`、release は D1 の gate、static_only は artifact 生成時の public 条件 + 行の marker + enforce の manifest。採らない案: (i) Hono だけ常に enforce（本番の observe と挙動が分かれ、manifest の有無で一覧全体が 503 になり得る。強化はブラッシュアップ提案）、(ii) entity ごとの KV `deny:` 参照（一覧は最大 60 件で S1 の KV 1 回を超え、writer も未実装。D-11 のリスク）。
- **L3 miss 時の再生成依頼**: Hono の GET は書かない（D1 write 0、Queue 0、`waitUntil` 0）。miss は CURRENT と同じ status で返す。code は RH-015 が CURRENT と同じ `public_data_unavailable`、RH-012 は enqueue しないので `public_data_reflecting` を返さず常に `public_data_unavailable`（記録した差）。根拠: CURRENT の miss 経路は `directEnqueueStaticRebuild` だけで 3 文（最大 9 文）+ operation mode の D1 1 文で、RH-012 の gate 1 文と合わせると S2 の 3 文を超える。匿名の公開 GET が D1 に書く経路を Hono に増やさない。`apps/api` に Queue binding を置かない D-0603-1 と同じ方針。対象の `static_rebuild_queue` / json-generator は MIG-0907 で消える。Hono route は MIG-0509 の producer 配線まで本番 Route に繋がないので、共存中の自己修復は CURRENT（Next）側の miss が続ける。採らない案: (i) server-core `directEnqueueStaticRebuild` を wake 0 で呼ぶ（S2 超過。MIG-0907 で無効になる行）、(ii) `public_build_state.requested_at` の条件付き UPDATE（1 文だが、匿名 traffic が Workers Builds の日次上限まで build を起こせる。Q2 で不採用）。
- **L4 RH-015 の live mode（DECIDED、Fable（owner-delegate）2026-10-24。D-12 を訂正）**: normal / economy / read_only は CURRENT と同じ D1 の 1 文（`LIMIT` は `MAX_PUBLIC_EVENT_LIMIT` = 60）で返し、static_only だけ R2 artifact を読む。Hono は live mode で R2 を読まない（CURRENT が読んで捨てる R2 read と miss enqueue は応答に影響しない）。根拠: CURRENT の normal は「D1 fallback」ではなく毎回 D1 が主経路で、artifact に置き換えると point event が消える、200 件で打ち切られる、同じ `start_time` の並びが変わる（`created_at DESC` が無い）、反映が artifact の再生成待ちになる、空 index で 503 になる、という D-12 に書かれていない利用者から見える差が出る。D1 1 文・`LIMIT` 60 は S2（3 文、`LIMIT` ≤ 100）に収まり、`ZERO_1102.md` §4.7 の「miss で重い処理へ fallback」にも当たらない（miss ではなく主経路）。D-09「反映の速さの方針」の 1（Island が S2 で即時に読む）とも合う。`page` は CURRENT と同じく上限を付けない（大きい `OFFSET` の D1 走査は記録した既知のリスク。T17 で `rows_read` を記録）。`OPEN_DECISIONS.md` D-12 に DECIDED として記録済み。U03 は static_only / maintenance / live mode の 3 分岐を 1 unit で実装する。採らない案: D-12 原文どおり全 mode で artifact（上の差がすべて出る）。
- **L5 Cache 層**: Hono は isolate micro-cache・Cache API・stale fallback を持たず、request ごとに R2 を読む。CURRENT の cache は fresh の間は同じ object を返すので応答の内容は変わらない。差は「R2 障害時に CURRENT は TTL の 2 倍までの stale を返せる（events index は enforce で manifest があるときだけ）が、Hono は 503」だけ（記録した差）。R2 Class B の無料枠は 10M/月で、R2 を読むのは static_only と release だけ。edge cache（`publicAboutStats.ts` の形）はブラッシュアップ提案。
- **L6 parity harness の境界**: CURRENT の本物の route handler 2 つを root の tsx（`apps/api/test/support/personalHarness.mjs#runUnderRootTsx`）で動かす。`registerHooks` で差し替えるのは次の 4 つだけ: `server-only`（空）、`@/lib/cloudflare`（`getDatabase` は node:sqlite の drizzle `sqlite-proxy`、`getEnv` は `{ BUCKET, KV, ... }` の fake、`withDatabase*`、`CloudflareBindingsUnavailableError`）、`@/lib/serverCore/nextPorts`（`nextQueueWakeHost` は Queue 送信を数えるだけ、`nextRethrowFrameworkControl` は no-op。これで `next/navigation` を読ませない）、`@opennextjs/cloudflare`（`getCloudflareContext()` は同じ fake env と `waitUntil` の収集。`publicCache.ts` と `degradedCircuitBreaker.ts` が直接 import する）。loader、manifest guard、`publicArtifactVisibility`、normalizer、operation mode、`publicApi` / `publicDto`、server-core の `directEnqueueStaticRebuild`、drizzle は本物を使う（CURRENT の queue 行が sqlite に書かれるので、Hono の 0 行と比べられる）。R2 artifact は `workers/json-generator/rebuild.ts#rebuildTarget`（`events_index` / `event_release`）を同じ sqlite と in-memory bucket に対して実行して作る（`produceSnapshots.ts` と同じ使い方）。両者は同じ fake bucket（`get` が `size` / `etag` / `json()` / `text()` / `body.cancel` を持つ。既存の `fakeBucket` には `text()` と `etag` が無いので harness で足す）と同じ fake KV を読む。mode は CURRENT が `process.env.FORCE_STATIC_ONLY` / `process.env.PUBLIC_VISIBILITY_GUARD_MODE`、Hono が `c.env` の同名値。maintenance は両者とも KV key `operation_mode:mirror`。case ごとに `resetPublicJsonIsolateCacheForTests`、`resetPublicOperationModeCacheForTests`、`resetDegradedCircuitBookkeepingForTests`、`clearPublicApiRateLimitForTests` と Hono 側の reset を呼ぶ。`react` の `cache` は tsx 下で関数として読めることを 2026-10-24 に確認した（memo するかどうかは結果に影響しない）。
#### Owned paths
- U01: `+packages/domain/src/event/status.ts`, `+packages/domain/test/eventStatus.test.mjs`、`packages/domain/package.json`（exports 1 行）、`src/lib/utils/eventStatusCore.ts`（bridge）
- U02: `+packages/server-core/src/publicData/{normalize,visibility,eventsIndexCore,eventReleaseCore,artifactVisibility,publicXUser,publicDto,publicApi}.ts`, `+packages/server-core/test/publicData*.test.mjs`、`packages/server-core/package.json`（exports）。bridge: `src/lib/publicData/{normalize,visibility,staticEventsIndexCore,staticEventReleaseCore,publicArtifactVisibility}.ts`、`src/lib/utils/publicXUser.ts`、`src/lib/api/{publicDto,publicApi}.ts`。`src/lib/publicData/staticEventDetailCore.ts`（release の 2 定数を core から import）。source を text で読む test は読み先だけを変える。
- U03〜U04: `+apps/api/src/routes/events/{publicList,publicRelease,publicSnapshot}.ts`, `+apps/api/test/eventsPublic.parity.test.mjs`, `+apps/api/test/support/publicEventsHarness.mjs`。変更: `apps/api/src/app.ts`（mount 2 行）、`apps/api/src/env.ts`（`FORCE_STATIC_ONLY?: string` の型 1 行）、`apps/api/src/routes/events/viewerOverlay.ts`（`use("*")` の 2 つを `use("/:id/slots/viewer-overlay", …)` に狭める。MIG-0604 work item の Notes のとおり。それ以外は触らない）
- U05: `docs/migration/{API_MATRIX,FILE_MIGRATION_MATRIX}.md`、本節の「記録した差」
- 触らない: `app/**`、`src/lib/publicData/loader.ts`、`workers/**`、`apps/api/src/routes/videos/**`、`STATUS.md`（merge 直前の統合だけ）
#### Micro-units
- **U01 eventStatusCore → domain**（R-DOMAIN。Sonnet。機械的）: `node scripts/find-unused-exports.mjs src/lib/utils/eventStatusCore.ts` は 2026-10-24 に `UNUSED` / `TEST_ONLY` 0 件、`LOCAL_ONLY` 2 件（`getEffectiveEventEnd` / `getEffectiveEventStart`。同じ file の関数が使うので file ごと移す）。`apps/site` の相対 import は bridge で動くので変えない。
- **U02 純粋部品 → server-core**（R-CORE。Sonnet。機械的）: L1 の 8 file を移し、元の場所を `export * from "@flamenode/server-core/publicData/<name>"` だけにする。`find-unused-exports` は 2026-10-24 に `normalize` / `visibility` / `staticEventsIndexCore` / `staticEventReleaseCore` / `publicArtifactVisibility` / `publicXUser` の全 export が `used`。`publicDto` / `publicApi` も移す前に実行し、`UNUSED` / `TEST_ONLY` は移さない。`publicArtifactVisibility` の `../staticRebuild/types` と manifest の型は core 内の相対 import にする。`eventsIndexCore` は `@flamenode/domain/event/status` から `isPointEvent` を読む。移動前後で `npm run test:unit` の件数と PASS が同じ。`node scripts/check-server-core-boundaries.mjs` が PASS。`publicApi` の module scope の rate limit Map は移動後も 1 つ（Next と Hono は別 Worker なので共有しない）。
- **U03 RH-015 + harness**（R-API。Sonnet 実装、Opus review。MIG-0617 merge 後）: L6 の harness。`publicSnapshot.ts`（L2 の guard、`readBoundedR2Json(bucket, key, MAX_PUBLIC_SNAPSHOT_OBJECT_BYTES)`（= 16 MiB。CURRENT と同じ閾値）、filter、normalize、空の `items` は miss）。`publicList.ts` の順番: rate limit → `page` / `limit` → `resolvePublicOperationMode(c.env, { allowD1: false })` → maintenance は 503 `public_data_unavailable` → static_only は artifact → live mode は D1 1 文（L4）。viewerOverlay の path を狭める。
- **U04 RH-012**（R-API。Sonnet 実装、Opus review）: `publicRelease.ts`（id の検証 → D1 gate 1 文 → maintenance → guard → R2 `eventReleaseObjectKey(id)` → filter → normalize → `event.id` の照合）。
- **U05 台帳**: `API_MATRIX.md` の RH-012 / RH-015 に Hono endpoint。`FILE_MIGRATION_MATRIX.md` の route 2 行の target を実 file に、U01 / U02 で移した file の target を bridge と core に。CPU は「未計測」（MIG-0606）。
- 小型モデル: U01 / U02 は機械的だが、Work Order は task ごとに `Model` を 1 つしか持てず、U03 / U04 は privacy と parity の判断を含むので、本 Work Order は `Model: lead` のままにする。U01 / U02 を Haiku に渡すなら、別の MIG id の small Work Order として STATUS に登録する（lead の docs PR。未実施）。
#### Test cases
| ID | 入力/操作 | 期待 |
| --- | --- | --- |
| T01 | RH-015 normal、`page` / `limit` の組（既定、`limit=61`→60、`limit=0`→60、`page=-1`→1、範囲外の page） | status・body の byte・Cache-Control・ETag が CURRENT と一致。Hono の D1 は 1 文、R2 は 0 回 |
| T02 | 同じ request に `If-None-Match` | 304 と header が一致 |
| T03 | 同じ IP から 61 回 | 61 回目が 429。`Retry-After` と `Cache-Control: no-store` が一致。endpoint ごとに別の key |
| T04 | static_only、`rebuildTarget` で作った artifact | CURRENT と一致（point event なし）。Hono の D1 は 0 文 |
| T05 | static_only、artifact なし / 壊れた JSON / 16 MiB 超 | 両者 503 `public_data_unavailable`。CURRENT は `static_rebuild_queue` に high の行 1 つ + wake 1、Hono は行 0・wake 0（`DOCUMENTED DIFFERENCE L3`） |
| T06 | static_only、`items: []` | 両者 503 `public_data_unavailable` |
| T07 | static_only × guard mode（enforce: manifest なし / ETag なし / event を block / group を block。observe: block あり。off） | 各組で CURRENT と一致（enforce は fail-closed で 503 か行を落とす。observe と off は落とさない。`events_index` は fence entity が無いので observe では manifest を読まない） |
| T08 | KV `operation_mode:mirror` が maintenance | 両 route とも 503 `public_data_unavailable` |
| T09 | normal で D1 が失敗 / `DB` なし | 503 `database_unavailable`（CURRENT と一致） |
| T10 | RH-012 public + `public_api_enabled = 1` + artifact | 200。body の byte・Cache-Control・ETag が一致。Hono の D1 は 1 文 |
| T11 | RH-012 private / `public_api_enabled = 0` / 存在しない id / 129 文字 / 不正な `%` | 404 `public, max-age=60` が一致 |
| T12 | RH-012 artifact なし | CURRENT は 503 `public_data_reflecting`（行 1 + wake 1）、Hono は 503 `public_data_unavailable`（行 0・wake 0）。`DOCUMENTED DIFFERENCE L3` |
| T13 | RH-012 artifact の `event.id` が別 | 両者 503 `public_data_unavailable` |
| T14 | RH-012 × guard mode（enforce で event が block = 再公開中の fence / manifest なし、observe で block、off） | enforce は 404 / 503 で一致、observe と off は 200 で一致（release は event の fence があるので observe でも manifest を読んでログに出す。T07 の `events_index` と違う） |
| T15 | RH-012 artifact に `visibility_status: "private"` の動画行 | 両者その行を落とし、`total` を合わせる |
| T16 | `GET /api/events` の header と session | private header なし、session lookup 0 回。`events.viewerOverlay.parity.test.mjs` は変更前と同じ件数 PASS |
| T17 | 上限ちょうどの入力（RH-015: 60 件 × 長い `explanation`、artifact 200 件 + group、1 MiB 近い manifest。RH-012: 500 動画 × 100 member） | 応答 byte と D1 文数を記録。64KB 超は D-12 の「記録した例外」。CPU は「未計測」（MIG-0606 で判定）。RH-015 live mode の大きい `page`（`OFFSET` が全 public event 数に近い）では D1 の `rows_read` も記録する |
#### Commands
```bash
# U01 / U02
npm run test --workspace=@flamenode/domain
npm run test --workspace=@flamenode/server-core
node scripts/check-server-core-boundaries.mjs
npm run typecheck && npm run test:unit
# U03 / U04
npm run build --workspace=@flamenode/api
node --test apps/api/test/eventsPublic.parity.test.mjs
node --test apps/api/test/events.viewerOverlay.parity.test.mjs
npm run typecheck && npm run test:unit && npm run check:project-docs
```
#### Ledger updates
`API_MATRIX.md` の RH-015 / RH-012 に Hono endpoint と「記録した差」への参照。`FILE_MIGRATION_MATRIX.md` は U05。STATUS は merge 直前の統合でだけ更新する。
#### 記録した差（CURRENT との差。test 名に `DOCUMENTED DIFFERENCE` を付ける）
- L3: miss で `static_rebuild_queue` の行と Queue wake を作らない。RH-012 は `public_data_reflecting` を返さない。
- L5: R2 障害時に stale cache を返さず 503 にする。
- RH-012: Hono には `DB` binding の例外が無いので `runtime_bindings_unavailable` は出ない（binding なしは `db_unavailable`）。
#### DONE checklist
- [ ] T01〜T16 が PASS
- [ ] Hono の GET が D1 / Queue に書かない（T05 / T12）
- [ ] U01 / U02 の移動で `test:unit` の件数と PASS が同じ、呼び出し側の diff が 0
- [ ] T17 の応答 byte と D1 文数を記録し、CPU は「未計測」と書いた
- [ ] 本番 Route を変更していない（MIG-0509 の producer 配線が DONE になるまで Worker Route に接続しない）
#### STOP
- loader の移植、`apps/api` から `src/lib/**` の import、L1 にない file の移動が必要になったら止める。
- GET で D1 / Queue / `waitUntil` に書く必要が出たら止める（L3、Q2）。
- harness に L6 の 4 つ以外の差し替えが要る（例: `next/*` を読む module が chain に入る）と分かったら止める。
- U02 で bridge だけでは済まず呼び出し側の変更が要る、または `UNUSED` / `TEST_ONLY` の export が出たら止める（移さない）。
- MIG-0606 の上限入力で warm max が 7ms 以上なら止める（D-12。応答の additive paging か build 時の分割を lead が決める）。
- 本番の R2（manifest の存在確認を含む）・Worker・Route・secret・Remote D1 の操作は、明示承認が出るまで止める。
#### OPEN（Fable / Yugo）
- **Q1（DECIDED 2026-10-24、Fable）**: L4 を採る。D-12 を訂正済み。
- **Q2（DECIDED 2026-10-24、Fable）**: GET は書かない（L3 のまま）。MIG-0907 の後、欠けた artifact を作り直すのは build だけ。`produceSnapshots.ts` が build ごとに全 public event の release と events index を D1 から作り直すので、MIG-0627 で (a) API が読む artifact を同じ key / schema で R2 へ差分 PUT する系統、(b) build 内の完全性検査（snapshot の public event id と R2 の release key を照合し、欠けは最大 3 回再試行、残れば build を失敗にする）、(c) `R2_ARTIFACT_CONSUMERS.md` の回復規則、を足す。GET の miss での `public_build_state` UPDATE は採らない（匿名 traffic が Workers Builds の日次上限まで build を起こせる）。
- **Q3（OPEN。Yugo の明示承認事項（remote R2 read）のまま。本番 Route の接続前）**: 本番 R2 の `visibility/blocked-entities.v1.json` の存在・ETag・size の確認（remote R2 の読み取りは明示承認事項）。observe のままなら L2 で 503 にはならないが、enforce へ切り替える前に要る。
#### Rollback
PRをrevert（U01 / U02 は bridge なので revert で戻る。U03〜U05 は Hono route を足すだけで、本番 Route・D1・secret の変更は無い）。

### MIG-0632: event export API（RH-013）の Hono 化
- **Model:** lead
- **Readiness:** NEEDS_REFINEMENT — READY（D-14-2: 依存を MIG-0614 だけにした。CPU は merge 済みの harness で自分で測る（D-13-58）。実装は Sonnet、review は Opus）
- **Recipe:** R-API, R-CORE
- **Runtime:** S2
- **Depends on:** MIG-0614 / **Decisions:** D-10 DECIDED, D-12 DECIDED, D-13-58, D-14-2
- **Verified against:** `dde6fa8` (2026-10-25)
#### Source snapshot
- route: `app/api/event-endpoints/[id]/route.ts`（450 行）。順序: rate limit（`checkPublicApiRateLimit(req, "/api/event-endpoints/:id")`）→ id decode（失敗は 404 `public, max-age=60`）→ `format`（`v5` 既定 / `new` / `legacy` / `old` / `v1`、他は 400 `invalid_format`）→ `update`（`realtime` 既定 / `scheduled` / `economy`）と `refresh`（既定 60、`EVENT_EXPORT_REFRESH_MINUTES = [15, 60, 360, 1440]`）、不正は 400 `invalid_export_options` → DB 無しは 503 → **payload cache HIT の前にも必ず D1 で公開判定**（`loadEventExportEvent`、`public_api_enabled === 1 && visibility_status === "public"`）→ scheduled は Cache API の payload（`stored_at` が refresh 窓内、trusted metadata marker `public-export-validated-v1`、無ければ JSON.parse + `assertNoForbiddenKeys`、壊れていれば削除して再生成）→ realtime は同 isolate の micro cache → `loadEventExportSnapshot` → `buildEventExportPayloadForFormat` → `assertNoForbiddenKeys`（失敗は 503 `public_payload_unavailable`）→ scheduled なら `writePublicJsonCacheBestEffort`。応答 header: `Cache-Control`（realtime `no-store`、scheduled `public, max-age=60, s-maxage=60, stale-while-revalidate=60`）、`X-FlameNode-Schema-Version`（1 / 5）、`X-FlameNode-Format`、`X-FlameNode-Update-Mode`、`X-FlameNode-Refresh-Minutes`、`X-FlameNode-Cache`（HIT / MISS / BYPASS）。
- 部品: `src/lib/api/eventExportData.ts`（423 行、drizzle、`import "server-only"`、`EVENT_EXPORT_VIDEO_IDS_IN_ARRAY_MAX = 80` :30）、`eventExportPayload.ts`（623 行、`server-only` 無し、`./publicDto.ts` だけ import）、`eventExportCache.ts`（70 行、`server-only`）、`src/lib/publicData/publicCache`（`readPublicJsonCache` / `coercePublicJsonCacheEnvelope` / `writePublicJsonCacheBestEffort` / `deletePublicJsonCaches`）、`src/lib/api/isolateMicroCache`。
- core に既にあるもの: `packages/server-core/src/publicData/{publicApi,publicDto}.ts`（`checkPublicApiRateLimit`、`publicJsonBodyResponse`、`publicJsonResponse`、`assertNoForbiddenKeys` 系）、`publicCache/delete.ts`（`deletePublicJsonCaches`）。Hono の micro cache は `apps/api/src/routes/live/microCache.ts`（TTL 15 s）。CURRENT `src/lib/api/isolateMicroCache.ts:13` も `ISOLATE_MICRO_CACHE_TTL_MS = 15_000` で同じ値なので、そのまま import する（route の comment「5秒間」は古い記述。CURRENT の code が正）。
- 共有 file（D-14-2）: `packages/server-core/src/publicCache/eventExportKeys.ts` は MIG-0603 U02a と共有。先に merge した方が `eventExportCache.ts` の `EVENT_EXPORT_REFRESH_MINUTES` / `isEventExportRefreshMinutes` / `eventExportPayloadCacheKey` をそのまま移して bridge にし、後の方は import する。
#### Owned paths
- 新規: `+apps/api/src/routes/events/export.ts`, `+apps/api/test/eventExport.parity.test.mjs`, `+packages/server-core/src/eventExport/data.ts`, `+packages/server-core/src/eventExport/payload.ts`, `+packages/server-core/src/publicCache/readWrite.ts`, `+packages/server-core/src/publicCache/eventExportKeys.ts`（D-14-2 の規則）
- 変更（bridge、R-CORE）: `src/lib/api/eventExportData.ts`, `src/lib/api/eventExportPayload.ts`, `src/lib/api/eventExportCache.ts`, `src/lib/publicData/publicCache.ts`（read / write / coerce を core から re-export）, `packages/server-core/package.json`（exports）, `apps/api/src/app.ts`（mount 1 行）, `docs/migration/API_MATRIX.md`
- 触らない: `app/**`, `apps/api/src/routes/events/{publicList,publicRelease,publicSnapshot}.ts`（MIG-0631）
#### Micro-units
- **U01 inventory**: 上の順序・header・status を表にして work item に書く。seed（`apps/api/test` の node:sqlite fixture）で v5 / legacy の応答 size と D1 文数を測る。64 KiB 超は D-12 の「記録した例外」として `API_MATRIX.md` の RH-013 行に書く。
- **U02 core 移動**（R-CORE）: golden test（CURRENT `buildEventExportPayloadForFormat` の出力 JSON と `loadEventExportSnapshot` の SQL + params）を先に commit し、`data.ts` / `payload.ts` / `readWrite.ts` へ移して byte 一致。`server-only` は bridge 側にだけ残す。
- **U03 route**: `GET /api/event-endpoints/:id`（CURRENT と同じ path）。上の順序をそのまま。Cache API は `caches.default`、write は `c.executionCtx.waitUntil`。
- **U04 parity + CPU**: CURRENT route と Hono を同じ seed で比べる（status・header・body の byte）。`scripts/benchmark-api-cpu.mjs` の `buildScenarios()` に RH-013 の上限入力（event 1、動画 500、各 member 100。MIG-0631 T17 と同じ規模）を足し、warm max を記録。7ms 以上なら additive paging の追加 unit を提案して止める（契約は変えない）。
#### Test cases
| ID | 入力/操作 | 期待 |
| --- | --- | --- |
| T01 | 正常系（v5 / legacy、realtime / scheduled） | CURRENT と status・header・body が byte 一致 |
| T02 | `format=xxx`、`refresh=7`、`update=foo` | 400 と同じ body |
| T03 | 非公開 / `public_api_enabled = 0` の event で payload cache が残っている | 404（cache を返さない） |
| T04 | trusted marker の無い壊れた cache | 削除して D1 から再生成、`X-FlameNode-Cache: MISS` |
| T05 | 禁止 key を含む payload | 503 `public_payload_unavailable` |
| T06 | 上限入力 | warm max CPU を記録（7ms 未満か、超えたら paging の追加 unit を提案） |
| T07 | CORS header（GET の応答） | CURRENT `publicJsonResponse` / `publicJsonBodyResponse` と同じ header。CURRENT は OPTIONS を export しない（route.ts の export は `GET` だけ）ので Hono も OPTIONS handler を足さない |
#### Commands
```bash
npm run build --workspace=@flamenode/api
node --test apps/api/test/eventExport.parity.test.mjs
npm run test --workspace=@flamenode/server-core
node scripts/check-server-core-boundaries.mjs
npm run check:public-api-leaks
npm run test:critical
npm run typecheck && npm run test:unit
```
#### Ledger updates
`API_MATRIX.md` の RH-013 に Hono エンドポイントと応答 size / CPU。`FILE_MIGRATION_MATRIX.md` に新規 file と bridge の行。
#### DONE checklist
- [ ] T01〜T07 が PASS
- [ ] 64 KiB 超の扱いを「記録した例外」として残し、上限入力で測った
- [ ] 本番 Route を変更していない
#### STOP
- 応答契約を変える改善が必要になったら止める（D-12）。
- `src/lib/publicData/loader.ts` の移植が必要になったら止める（D-10 共通契約）。
- 本番 Worker・Route・secret・Remote D1 の操作は明示承認が出るまで止める。
#### Rollback
PRをrevert（bridge を元に戻すだけ。本番 Route・D1・secret の変更は無い）。

### MIG-0633: event ownership / permission resolver core（D-10 R-CORE）
- **Model:** lead
- **Readiness:** NEEDS_REFINEMENT — READY（MIG-0617 DONE）。最後の owner を外せない不変条件を含むため lead（実装 Sonnet 不可、Opus が書く）
- **Recipe:** R-CORE, R-DOMAIN
- **Runtime:** S3
- **Depends on:** MIG-0613, MIG-0617 / **Decisions:** D-10 DECIDED
- **Verified against:** `a1b910b4` (2026-10-25)
#### Source snapshot
- `src/lib/auth/ownership.ts`（620 行、`server-only`、drizzle）: `canEditVideo`、`canEditEvent`（`:306`）、`resolveEventEditAuthorization`（`:316`）、`canManageXIdLinkRequests`（`:174`）、`resolveXIdLinkRequestAuthorization`（`:198`）ほか。import 先: `./ownershipCore`（bridge → `@flamenode/domain/video`）、`./permissions/permissionResolver`（88 行、pure、`./keys` / `./aliases` / `./presets` は domain の bridge）、`./approvedX`（85 行、drizzle）、`@/lib/video/generalEditPermissions`（drizzle の loader、core 部分は domain）、`@/lib/video/atomicLimits`（定数 26 行、`../event/eventLimits.ts` 12 行を re-export）。
- `src/lib/event/eventOwnership.ts`（893 行）: `remainingOperableEventOwnerSql`（`:60`、owner 0 guard、`:392`/`:457` で使用）、`create/update/delete/bulkUpsertEventStaffWithProtection`、`transferEventOwnership`（`:778`）。import: `@/lib/auth/approvedX`、`@/lib/audit/mutate`（core の bridge）、`@/lib/utils/id`、`./eventOwnershipCore`（domain の bridge）。
- 利用者: MIG-0604 U04（SA-023/024/031..034/038/039/056..068）、MIG-0603 U02c/U03b/U03c、MIG-0605 U05x、FIX-0604-1。
#### Owned paths
- 新規: `+packages/domain/src/auth/permissions/resolver.ts`, `+packages/domain/src/video/atomicLimits.ts`, `+packages/domain/src/event/limits.ts`, `+packages/server-core/src/auth/approvedX.ts`, `+packages/server-core/src/video/generalEditPermissions.ts`, `+packages/server-core/src/auth/ownership.ts`, `+packages/server-core/src/event/eventOwnership.ts`, `+packages/server-core/test/ownership.golden.test.mjs`
- 変更（bridge 化）: `src/lib/auth/permissions/permissionResolver.ts`, `src/lib/video/atomicLimits.ts`, `src/lib/event/eventLimits.ts`, `src/lib/auth/approvedX.ts`, `src/lib/video/generalEditPermissions.ts`, `src/lib/auth/ownership.ts`, `src/lib/event/eventOwnership.ts`, `packages/server-core/package.json`, `packages/domain/package.json`（exports）
- 触らない: `app/**`, `src/lib/actions/**`
#### Micro-units
- **U01 golden**: 移動前の tree で resolver（role × X 承認状態 × staff preset × permission key）と owner 0 guard の SQL 文字列 + params の golden を書く。
- **U02 move**: pure（resolver、定数）→ domain、drizzle（approvedX、generalEditPermissions loader、ownership、eventOwnership）→ server-core の順で移す。bridge の1行目 `// Compatibility bridge (MIG-0633, D-10): ...`。`server-only` は bridge 側に残す。
- **U03 boundary**: `check-server-core-boundaries.mjs` を通す。
#### Test cases
| ID | 入力/操作 | 期待 |
| --- | --- | --- |
| T01 | 最後の owner の解任 | SQL guard により拒否 |
| T02 | 権限 resolver の各 role | golden と diff 0 |
| T03 | 既存 test の件数 | 同一 |
#### Commands
```bash
npm run typecheck
npm run typecheck --workspace=@flamenode/server-core
npm run test --workspace=@flamenode/server-core
npm run test --workspace=@flamenode/domain
node scripts/check-server-core-boundaries.mjs
npm run test:critical
npm run check:event-owners
```
#### Ledger updates
`FILE_MIGRATION_MATRIX.md` に core / domain の新規行と bridge 行。
#### DONE checklist
- [ ] golden の diff 0、既存 test の件数同一、呼び出し側の diff 0
- [ ] 最後の owner の解任が core test で拒否される
- [ ] MIG-0604 / MIG-0603 / MIG-0605 の担当と FIX-0604-1 に伝えた
#### STOP
- owner 0 guard の SQL が 1 文字でも変わるなら止める。
- DB / migration / 権限緩和は上位へ。
#### Rollback
PRをrevert（bridge が元の `src/lib` 実装に戻る。DB・Route・secret の変更は無い）。

### MIG-0634: 公開 video 一覧と viewer overlay の読み取り API（RH-031, RH-032）
- **Model:** lead
- **Readiness:** NEEDS_REFINEMENT — READY（MIG-0631 DONE で reader と publicData の core が揃った。D-13-46 / 68。実装は Sonnet、review は Opus）
- **Recipe:** R-CORE, R-API
- **Runtime:** S2
- **Depends on:** MIG-0602, MIG-0614, MIG-0631 / **Decisions:** D-09 DECIDED, D-10 DECIDED, D-13-46, D-13-47
- **Verified against:** `a1b910b4` (2026-10-25)
#### Source snapshot
- RH-032 `app/api/videos/route.ts`: rate limit `"/api/videos"` → `q`（trim、100 文字）/ `sort`（`parsePublicVideoSort`、`src/lib/db/listQueries.ts:8`、pure）/ `event`（128 文字）/ `limit`（既定 24、上限 `MAX_PUBLIC_LIST_LIMIT` = 48）/ `page`（上限 `ceil(5000/limit)`）→ 2 文字未満の検索は投影を読まず 0 件 → 分岐: event → `loadPublicEventVideosPage`（`loader.ts:1367`、event base / composed artifact）、q → `loadStaticSearchVideosPage`（`:1320`、postings v1: manifest + bucket directory + 最大 `STATIC_SEARCH_POSTINGS_MAX_QUERY_PAGES` = 32 page、失敗で `search-index-lite.json`）、sort=score → `loadStaticPopularVideosPage`（`:1146`、`list/popular.json`）、他 → `loadStaticRecentVideosPage`（`:1101`、`list/recent.json`）。throw は 503 `database_unavailable`、null は 503 `static_list_unavailable`。200 は `pickKeys(PUBLIC_VIDEO_KEYS)` + `status: "public"`、`public, max-age=30, s-maxage=60, stale-while-revalidate=120`、ETag。
- RH-031 `app/api/videos/[id]/viewer-overlay/route.ts`: id 128 文字（空は 400）→ `loadStaticVideoDetail`（`videos/<id>.json`、`loader.ts:1960`）→ data なし: unavailable / reflecting / stale は 503 `viewer_overlay_unavailable`（Retry-After 3）、他は 404 → `visibility_status !== "public"` は 404 → `loadVideoViewerOverlay`（`src/lib/video/videoViewerOverlay.ts:131`、309 行: session、`fetchVideoRowByIdOrYoutube`、`canEditVideo("video.chapter_admin", resolveAdminOrEventVideoPrivilegeMode)`、private chapters、interaction 最大2行、playlist overlay `src/lib/publicData/r2EventPlaylist.ts`）。全応答 `private, no-store, no-cache, must-revalidate` + Pragma + Expires。
- 純粋部品（移動対象）: `src/lib/publicData/{staticRecentVideoCore(84),staticPopularVideoCore(46),staticVideoCardCore(68),staticSearchIndexCore(249),staticSearchPostingsCore(540),staticEventListCore(215),staticEventDetailCore(293),staticVideoDetailCore(346),staticEventPlaylistCore(84),loaderPolicy(18)}.ts`、`src/lib/video/videoViewerOverlayCore.ts`（26）。どれも `./normalize` / `./visibility`（#398 で core の bridge）か互いを import する。例外: `staticVideoCardCore.ts:1` が `@/components/video/VideoCard` の型 `VideoCardData` を、`videoViewerOverlayCore.ts:1` が `@/lib/publicData/privateVideoChapterOverlay` の型を import する。
- 既存の reader: `apps/api/src/routes/events/publicSnapshot.ts#loadPublicSnapshot` / `#readBoundedR2Json`（MIG-0631）、`packages/server-core/src/publicData/{publicApi,publicDto,artifactVisibility}.ts`、`apps/api/src/routes/live/operationMode.ts#resolvePublicOperationMode`、chapter 権限 `apps/api/src/routes/videos/chapterAccess.ts#canAdministerChapters`（D-13-47）。
#### Owned paths
- U01: `+packages/server-core/src/publicData/{recentVideoCore,popularVideoCore,videoCardCore,searchIndexCore,searchPostingsCore,eventListCore,eventDetailCore,videoDetailCore,eventPlaylistCore,loaderPolicy}.ts`, `+packages/server-core/test/publicDataVideo.test.mjs`、`packages/server-core/package.json`。bridge: 上の `src/lib/publicData/*.ts` 10 file。`apps/api/src/routes/events/publicSnapshot.ts` → `apps/api/src/lib/publicSnapshot.ts` へ移し、`publicList.ts` / `publicRelease.ts` の import 2 行を変える
- U02〜U04: `+apps/api/src/routes/videos/list.ts`, `+apps/api/src/routes/videos/viewerOverlay.ts`, `+packages/contracts/src/videoViewerOverlay.ts`, `+apps/api/test/videosPublic.parity.test.mjs`, `+apps/api/test/videoViewerOverlay.parity.test.mjs`。変更: `apps/api/src/routes/videos/index.ts`（route 2 行）, `packages/contracts/src/index.ts`
- 触らない: `src/lib/publicData/loader.ts`, `app/**`, `workers/**`, `apps/api/src/routes/videos/detail.ts`, `apps/api/src/routes/videos/chapters.ts`
#### Micro-units
- **U01 pure → core**（R-CORE）: 移す前に `node scripts/find-unused-exports.mjs <file>` を各 file で実行し、`UNUSED` / `TEST_ONLY` は移さない。`VideoCardData` は core に同じ形の型 `StaticVideoCardData` を置き、`src/components/video/VideoCard.tsx` は変えない（bridge で `satisfies` による相互代入の型検査を1行入れる）。`privateVideoChapterOverlay` の型も同じ扱い。`npm run test:unit` の件数と PASS が同じ。
- **U02 RH-032**（R-API）: `GET /api/videos`。分岐と順序は CURRENT のまま。各 artifact は `loadPublicSnapshot`（guard mode は CURRENT と同じ規則。list 系は fence entity なし）→ core の normalizer。`shouldUseStaticCollection` で空なら miss。miss は書かずに 503（D-13-46）。search postings の R2 read 回数を test で数え、CURRENT と同じ上限（32 page）で打ち切る。
- **U03 RH-031**（R-API）: `GET /api/videos/:id/viewer-overlay`。artifact gate → session（`sessionMiddleware`）→ D1 は session + 2 文以内（video 行 + 権限 facts を1文、private chapters + interaction を1文）。playlist overlay は event base artifact を `loadPublicSnapshot` で読む。
- **U04 台帳**: `API_MATRIX.md` の RH-031 / RH-032、`FILE_MIGRATION_MATRIX.md`。CPU は「未計測」（MIG-0606）。
#### Test cases
| ID | 入力/操作 | 期待 |
| --- | --- | --- |
| T01 | RH-032 recent / old / score / event / 検索（postings / lite fallback）/ 2 文字未満 | status・body の byte・Cache-Control・ETag が CURRENT と一致 |
| T02 | `limit=49`→48、`page` が上限超え | CURRENT と同じ丸め |
| T03 | 61 回 | 429、`Retry-After`、`no-store` が一致 |
| T04 | artifact なし / 壊れた JSON / 16 MiB 超 / `items: []` | 両者 503。CURRENT は queue 行 + wake、Hono は 0（`DOCUMENTED DIFFERENCE D-13-46`） |
| T05 | guard mode（enforce: manifest なし / event block、observe、off） | CURRENT と一致 |
| T06 | RH-031 未ログイン / ログイン / admin / event staff（`video.chapter_admin`）/ 非公開 video / artifact なし | CURRENT と同じ DTO と status。chapter 権限は `canAdministerChapters` |
| T07 | RH-031 の header | 全応答 private no-store、503 は Retry-After 3 |
| T08 | D1 文数 | RH-032 は 0、RH-031 は session + 2 以下 |
| T09 | 上限入力（検索 32 page、private chapters 上限、48 件 × 長い title） | 応答 byte と R2 read 回数を記録 |
#### Commands
```bash
npm run test --workspace=@flamenode/server-core
node scripts/check-server-core-boundaries.mjs
npm run build --workspace=@flamenode/api
node --test apps/api/test/videosPublic.parity.test.mjs
node --test apps/api/test/videoViewerOverlay.parity.test.mjs
node --test apps/api/test/eventsPublic.parity.test.mjs
npm run check:public-api-leaks
npm run typecheck && npm run test:unit
```
#### Ledger updates
`API_MATRIX.md` の RH-031 / RH-032 に Hono endpoint と D-13-46 の記録した差。`FILE_MIGRATION_MATRIX.md` に core と bridge の行。
#### DONE checklist
- [ ] T01〜T08 が PASS、T09 を記録
- [ ] GET が D1 / Queue に書かない
- [ ] U01 の移動で `test:unit` の件数と PASS が同じ
- [ ] 本番 Route を変更していない
#### STOP
- loader の移植、`apps/api` から `src/lib/**` の import が必要になったら止める。
- GET で D1 / Queue / `waitUntil` に書く必要が出たら止める。
- U01 で bridge だけで済まず呼び出し側の変更が要ると分かったら止める。
- 本番 R2・Route・secret の操作は明示承認まで止める。
#### Rollback
PRをrevert（U01 は bridge、U02〜U03 は route を足すだけ）。

### MIG-0635: Admin 読み取り API その C（videos/[id]・members・users/[id]/edit）
- **Model:** lead
- **Readiness:** NEEDS_REFINEMENT — READY（MIG-0624 / 0625 DONE。D-13-48〜71。実装は Sonnet、review は Opus）
- **Recipe:** R-API
- **Runtime:** S2
- **Depends on:** MIG-0624, MIG-0625 / **Decisions:** D-05 DECIDED, D-13-48, D-13-49, D-13-50
- **Verified against:** `a1b910b4` (2026-10-25)
#### Source snapshot
- `app/(admin)/admin/videos/[id]/page.tsx`（199 行）: `fetchVideoReviewDetail(db, id)`（`src/lib/admin/videoReviewDetail.ts`、282 行: stage permission 回答、software label、chapter 時刻、`formatVideoReviewAnswer`）+ moderation cases（`video_id` で `created_at DESC LIMIT 20`、`:48-61`）。`openCaseCount` と `openVoidCaseId`（`:62-66`）。`?event=` は戻り先と `review_event_id` だけ。
- `app/(admin)/admin/videos/[id]/members/page.tsx`（136 行）: video 4 列、公開 member（`is_public_member = 1`、`order_index, id`、`MAX_VIDEO_MEMBERS + 1` 件で超えたら notFound）、member に紐づく chapter（`json_each` + `instr(:legacy:/:member:)`）、`formatMemberChapterTime` / `extractVideoMemberIdFromChapterId`。
- `app/(admin)/admin/users/[id]/edit/page.tsx`（65 行）: user 1 行 + `getLinkedXUserIdsForAuthUser`（`src/lib/auth/xIdentity.ts`）。
- 手本: `apps/api/src/routes/manage/videoDetail.ts`（同じ `fetchEventVideoReviewDetail` 系を1文に畳んだ前例。`lib/videoReviewSummaries.ts` の `stagePermissionJson` / `reviewSummarySql`）、`apps/api/src/routes/adminRead/{users,videos,shared}.ts`（guard と LIMIT 定数）、`apps/api/test/adminRead.parity.test.mjs`。
- users `?view=xid` の `icon_url` は D-13-49 で記録した差（null）。
#### Owned paths
- 新規: `+apps/api/src/routes/adminRead/videoDetail.ts`, `+apps/api/src/routes/adminRead/videoMembers.ts`, `+apps/api/src/routes/adminRead/userEdit.ts`, `+apps/api/test/adminReadC.parity.test.mjs`
- 変更: `apps/api/src/routes/adminRead/index.ts`（route 3 行）, `packages/contracts/src/adminRead.ts`（schema 3 つ）, `apps/api/test/support/adminReadSeed.mjs`（seed の追加だけ）
- 触らない: `app/**`, `src/lib/actions/**`, `apps/api/src/routes/manage/**`
#### Micro-units
- **U01 videos/[id]**: `GET /api/admin-read/videos/:id`。session + 2 文（review detail を1文、moderation cases LIMIT 20 を1文）。100 行 / 64 KiB を超える面は `truncated`。
- **U02 videos/[id]/members**: `GET /api/admin-read/videos/:id/members`。session + 2 文以内。member 超過は 404（CURRENT の notFound）。
- **U03 users/[id]/edit**: `GET /api/admin-read/users/:id/edit`。session + 1 文（user + linked X を JSON 列で）。linked X は LIMIT 100（`shared.ts` の定数）。
- **U04 parity**: 実 CURRENT の loader（`fetchVideoReviewDetail`、`getLinkedXUserIdsForAuthUser`）と page の drizzle query の写しを同じ sqlite で比べる。
#### Test cases
| ID | 入力/操作 | 期待 |
| --- | --- | --- |
| T01 | 3 page の正常系 | CURRENT と DTO が一致 |
| T02 | 存在しない id / member 101 人 | 404 |
| T03 | guest / user / moderator / banned | 401 / 403（MIG-0625 と同じ body） |
| T04 | D1 文数 | session 込み 3 以下、bind 100 以下 |
| T05 | D1 失敗 | 503 `{error:"unavailable"}`（CURRENT は error page） |
#### Commands
```bash
npm run build --workspace=@flamenode/api
node --test apps/api/test/adminReadC.parity.test.mjs
node --test apps/api/test/adminRead.parity.test.mjs
npm run check:public-api-leaks
npm run typecheck
npm run test:unit
```
#### Ledger updates
`API_MATRIX.md` の Admin read 節に3行。`ROUTE_MATRIX.md` の Admin 45 担当表で3 page を MIG-0635 DONE に。D-13-49 の差を1行。
#### DONE checklist
- [ ] 3 page に endpoint と parity
- [ ] Admin 45 の担当表に TODO が残っていない（MIG-0627 の1面を除く）
#### STOP
- 権限を緩める必要が出たら止める。
- icon map（R2）を読む必要が出たら止める（D-13-49）。
#### Rollback
PRをrevert。

### MIG-0636: Personal X / Active X の API（SA-098..105）
- **Model:** lead
- **Readiness:** NEEDS_REFINEMENT — READY（MIG-0605 から分割、D-13-56 / 78 / 81。D-14-9 で規約同意と onboarding（旧 U03）を MIG-0641 へ分割。MIG-0702 と MIG-0515 が使う。実装は Sonnet、review は Opus）
- **Recipe:** R-API
- **Runtime:** S3
- **Depends on:** MIG-0602 / **Decisions:** D-03 DECIDED, D-04 DECIDED, D-0603-1 DECIDED, D-13-57, D-14-9
- **Verified against:** `a1b910b4` (2026-10-25)
#### Source snapshot
| CURRENT | ID | file |
| --- | --- | --- |
| 規約同意（**MIG-0641 へ分割**、D-14-9） | SA-074, SA-075, SA-076 | `src/lib/actions/terms.ts:51` `commitAcceptLatestTerms`, `:197` `acceptLatestTerms`（redirect、`sanitizeNextPath`）, `:293` `acceptOnboardingTerms` |
| Active X | SA-098 | `src/lib/actions/xid.ts:243` `setActiveXId`（承認済みの linked X、user の CAS 更新、監査に `actor_x_user_id`） |
| link / merge revert 申請 | SA-099, SA-100, SA-101 | `xid.ts:300`, `:558`, `:740` |
| profile / 削除 / icon | SA-102, SA-103, SA-104, SA-105 | `xid.ts:840`, `:912`, `:992`, `:1049`（`uploadXIdIcon`、`validateIconImageUpload`、R2 put、`next.config.mjs` の `serverActions.bodySizeLimit` 8mb） |
| onboarding 完了マーカー（**MIG-0641 へ分割**） | （MIG-0611 引き継ぎ） | `src/lib/auth/onboarding.ts#maybeMarkOnboardingComplete` |
- 書き込みの共通 guard: `xid.ts:147`（`writeGuard({ feature: "xid_links" })`）。static rebuild は core `buildAfterXUserPublicUpdateQueueBatch`（`packages/server-core/src/staticRebuild/hooks.ts:404`）。
- 公開画面の呼び出し元: `src/components/user/useActiveXSwitcher.ts:5`（SA-098、MIG-0515 が Island から呼ぶ）。SA-075 の `app/(public)/rules/page.tsx:3,95` は MIG-0641。
#### Owned paths
- 新規: `+apps/api/src/routes/xid/index.ts`, `+apps/api/src/routes/xid/activeX.ts`, `+apps/api/src/routes/xid/requests.ts`, `+apps/api/src/routes/xid/profile.ts`, `+apps/api/src/routes/xid/icon.ts`, `+apps/api/src/middleware/bodyLimit.ts`, `+packages/contracts/src/xid.ts`, `+apps/api/test/xid.parity.test.mjs`, `+apps/api/test/bodyLimit.test.mjs`
- 変更: `apps/api/src/app.ts`（mount 1 行）, `packages/contracts/src/index.ts`
- 触らない: `src/lib/actions/**`, `apps/api/src/middleware/writeOrigin.ts`, `apps/api/src/auth/session.ts`
#### Micro-units
- **U01 inventory + G21**: SA-098..105 の行（入力、guard option、読み、batch、監査、queue 行、post-commit）を work item に表で書く。`bodyLimit.ts` に SA ごとの上限表（SA-105 = 8 MiB = `8 * 1024 * 1024`、他は 64 KiB）と middleware を作る（Content-Length と実読み byte の両方で判定、413）。
- **U02 SA-098**: `POST /api/xid/active`（body `x_user_id`）。読み: guard の user（approved X ids を同じ文で）+ linked X 行 1 = S3 内。同じ X は「すでにこの X ID がアクティブです。」で書かない。
- **U03**: MIG-0641 へ分割（D-14-9）。
- **U04 SA-099..101**: `POST /api/xid/requests`、`POST /api/xid/requests/:id/cancel`、`POST /api/xid/merge-revert-requests`。
- **U05 SA-102..104**: `PATCH /api/xid/:xUserId/profile`、`DELETE /api/xid/:xUserId`、`PUT /api/xid/:xUserId/icon`。queue 行は同じ batch、wake 0（D-0603-1）。
- **U06 SA-105**: `POST /api/xid/:xUserId/icon/upload`（multipart、8 MiB）。R2 put は `c.env.BUCKET`、post-commit の `tryDeleteUnreferencedIcon` は CURRENT の順序。
#### Test cases
| ID | 入力/操作 | 期待 |
| --- | --- | --- |
| T01 | 二重送信（SA-098 / SA-099） | 1回だけ反映 |
| T02 | 承認待ち・manager リンクの X を Active に | CURRENT と同じ拒否 |
| T04 | 8 MiB ちょうど / 8 MiB + 1 byte の icon（G21） | 通る / 413 |
| T05 | 各 SA の監査行・queue 行 | CURRENT と field 単位で一致、wake 0（`DOCUMENTED DIFFERENCE D-0603-1`） |
| T06 | 別 origin・未ログイン・BAN | CURRENT と同じ拒否、書き込み 0 |
#### Commands
```bash
npm run build --workspace=@flamenode/api
npm run test --workspace=@flamenode/api
npm run check:x-link-dependencies
npm run check:audit-actor-x
npm run test:critical
npm run typecheck && npm run test:unit
```
#### Ledger updates
`API_MATRIX.md` の SA-098〜105 に Hono endpoint。G21 の上限表を `API_MATRIX.md` に1節。
#### DONE checklist
- [ ] U01、U02、U04〜U06 が DONE、各 SA の parity が PASS（U03 は MIG-0641）
- [ ] D-04（Active X 一斉切替）を実行していない
#### STOP
- `writeOrigin.ts` / `session.ts` を変える必要が出たら止める。
- D-03 / D-04 の本番実行が必要に見えたら止める。
- 本番 R2・secret の操作は明示承認まで止める。
#### Rollback
Phase 6 共通契約のとおり。

### MIG-0637: admin 運用の書き込み その A（cost guard・user admin、SA-016..020, SA-077..081）
- **Model:** lead
- **Readiness:** NEEDS_REFINEMENT — READY（MIG-0605 U06 と U05 の merge 部分を分割、D-13-56。D-14-10 でさらに MIG-0642 / 0643 / 0644 へ分け、本 task は cost guard と user admin。全部 `requireAdminWrite` の admin 専用。実装は Sonnet、review は Opus）
- **Recipe:** R-API
- **Runtime:** S3
- **Depends on:** MIG-0602 / **Decisions:** D-0603-1 DECIDED, D-13-41, D-14-10
- **Verified against:** `a1b910b4` (2026-10-25)
#### Source snapshot
| CURRENT | ID | file（feature key） |
| --- | --- | --- |
| cost guard | SA-016..020 | `src/lib/actions/cost-guard.ts:121,137,157,184,232`（KV mirror `writeOperationModeKvMirror`） |
| user admin | SA-077..081 | `src/lib/actions/user-admin.ts:172,195,219,286,310` |
- 分割先（D-14-10）: SA-045..049 / 051..055 → MIG-0642、SA-050 / 069..073 / 106 → MIG-0643、SA-092..097 / 110 → MIG-0644。
- 手本: `apps/api/src/routes/admin/{announcements,apiEndpoints}.ts`（admin router、`costGuardMiddleware(feature)`、core `mutateWithAudit` + `auditPreloaded`、queue は core builder で wake 0）。
#### Owned paths
- 新規: `+apps/api/src/routes/admin/costGuard.ts`, `+apps/api/src/routes/admin/users.ts`, `+packages/contracts/src/admin/ops.ts`, `+apps/api/test/adminOps.parity.test.mjs`
- 変更: `apps/api/src/routes/admin/index.ts`（route 行）, `packages/contracts/src/admin/index.ts`
- 触らない: `src/lib/actions/**`, `apps/api/src/middleware/**`, MIG-0642〜0644 の owned paths
#### Micro-units
- **U01 inventory**: SA-016..020 / 077..081 ごとに feature key、読み、batch、監査、queue 行、KV / Queue の副作用を表にする。Queue wake は 0（D-0603-1 / D-13-41）。
- **U02 cost guard SA-016..020**: KV mirror の書き込みは CURRENT の順序（post-commit）。
- **U03 user admin SA-077..081**。
- **U04〜U07**: MIG-0642 / 0643 / 0644 へ分割（D-14-10）。
- URL は `/api/admin/<面>/...`（U01 の表で確定し、PR 本文に貼る）。
#### Test cases
| ID | 入力/操作 | 期待 |
| --- | --- | --- |
| T01 | 各 SA の成功 | 監査・queue 行・対象 table が CURRENT と field 単位で一致 |
| T02 | 非 admin・別 origin・CostGuard 停止 | CURRENT と同じ拒否、書き込み 0 |
| T03 | CAS 競合 | CURRENT と同じ文言、書き込み 0 |
| T05 | wake 数 | CURRENT n 回 vs Hono 0（`DOCUMENTED DIFFERENCE`） |
#### Commands
```bash
npm run build --workspace=@flamenode/api
npm run test --workspace=@flamenode/api
npm run check:audit-actor-x
npm run test:critical
npm run typecheck && npm run test:unit
```
#### Ledger updates
`API_MATRIX.md` の SA-016〜020, 077〜081 に Hono endpoint。
#### DONE checklist
- [ ] U01〜U03 が DONE、全 SA の parity が PASS
- [ ] KV / R2 の本番操作をしていない
#### STOP
- 監査の意味を変える必要が出たら止める。
- Queue binding が必要になったら止める（owner の明示承認事項）。
#### Rollback
Phase 6 共通契約のとおり。

### MIG-0638: admin spreadsheet の書き込みと import（RH-004..008）
- **Model:** lead
- **Readiness:** NEEDS_REFINEMENT — READY（MIG-0605 U02 書き込み半分・U03 残り・U04・RH-019 を分割、D-13-56。D-14-11 で RH-002 → MIG-0645、RH-023..025 → MIG-0646、RH-027/028 → MIG-0647、RH-019 → MIG-0648 へ分け、本 task は spreadsheet。実装は Sonnet、review は Opus）
- **Recipe:** R-API, R-CORE
- **Runtime:** S2, S3
- **Depends on:** MIG-0602, MIG-0631 / **Decisions:** SP-1〜SP-6 DECIDED（`work-items/MIG-0605.md`）, D-13-56, D-14-11
- **Verified against:** `a1b910b4` (2026-10-25)
#### Source snapshot
| CURRENT | ID | file |
| --- | --- | --- |
| spreadsheet update / insert / delete | RH-004, RH-005, RH-006 | `app/api/admin/spreadsheet/data/route.ts`（166 行） |
| spreadsheet export の `page`（F-1） | RH-007 | `app/api/admin/spreadsheet/export/route.ts` |
| spreadsheet import | RH-008 | `app/api/admin/spreadsheet/import/route.ts`（200 行） |
- 分割先（D-14-11）: RH-002 → MIG-0645、RH-023..025 → MIG-0646、RH-027 / 028 → MIG-0647、RH-019 → MIG-0648。
- 既存: spreadsheet の read（`apps/api/src/routes/admin/spreadsheet/{read,catalog,registry,schemaCatalog}.ts`、#392）、media proxy の前例（`apps/api/src/routes/media/proxies.ts`）、manage icon の署名（`apps/api/src/routes/manage/icon.ts`、`AUTH_SECRET`）、R2 reader（`apps/api/src/routes/events/publicSnapshot.ts`）、core `publicData/{publicApi,publicDto,artifactVisibility}.ts`。
- Routing 条件（DECIDED）: `/api/admin/spreadsheet/*` を Hono に向けるのは U01 / U02 の merge 後（Worker Route は method で分けられない）。
#### Owned paths
- 新規: `+apps/api/src/routes/admin/spreadsheet/write.ts`, `+apps/api/src/routes/admin/spreadsheet/import.ts`, `+apps/api/test/spreadsheetWrite.parity.test.mjs`
- 変更: `apps/api/src/routes/admin/spreadsheet/read.ts`（F-1 の `page`）, `apps/api/src/app.ts`（mount 行）, `packages/contracts/src/admin/spreadsheet.ts`
- 触らない: `src/lib/actions/**`, `app/api/**`, `apps/api/src/middleware/**`
#### Micro-units
- **U01 spreadsheet 書き込み RH-004/005/006 + F-1 + F-5**: CURRENT の registry の列ポリシーと物理削除規則（read 側の `registry.ts` は読み取りの subset）を足し、core `mutateWithAudit`。
- **U02 RH-008 import**: 途中失敗で全件 rollback（MIG-0605 T03）。
- **U03〜U06**: MIG-0645 / 0646 / 0647 / 0648 へ分割（D-14-11）。
#### Test cases
| ID | 入力/操作 | 期待 |
| --- | --- | --- |
| T01 | spreadsheet の更新・追加・削除（secret 列、blocklist、owner 保護） | CURRENT と一致、監査 byte 一致 |
| T02 | spreadsheet import の途中失敗 | 全件ロールバック |
| T06 | D1 文数 | GET は S2、書き込みは S3（事前読み3 + batch 1）。超える面は記録 |
#### Commands
```bash
npm run build --workspace=@flamenode/api
npm run test --workspace=@flamenode/api
npm run test --workspace=@flamenode/server-core
node scripts/check-server-core-boundaries.mjs
npm run check:public-api-leaks
npm run test:critical
npm run typecheck && npm run test:unit
```
#### Ledger updates
`API_MATRIX.md` の RH-004〜008 に Hono endpoint。
#### DONE checklist
- [ ] U01 / U02 が DONE、全 RH の parity が PASS
- [ ] secret の値を test fixture 以外に書いていない
#### STOP
- secret（`AUTH_SECRET` などの binding）・本番 R2・Route の操作は明示承認まで止める（SP-6）。
- loader（`src/lib/publicData/loader.ts`）の移植が必要になったら止める。
#### Rollback
Phase 6 共通契約のとおり。

### MIG-0639: API CPU benchmark その A（main にある endpoint を Linux host で測る）
- **Model:** lead
- **Readiness:** NEEDS_REFINEMENT — READY（D-14-7: MIG-0606 U02 の前半を分割。D-12 の live slots 6000 枠と MIG-0631 T17 の判定をここで出す。実装は Sonnet、review は Opus）
- **Recipe:** R-BUILD
- **Runtime:** N
- **Depends on:** MIG-0602, MIG-0611, MIG-0617, MIG-0623, MIG-0624, MIG-0625, MIG-0630, MIG-0631 / **Decisions:** D-06 DECIDED, D-12 DECIDED, D-14-7
- **Verified against:** `dde6fa8` (2026-10-25)
#### Source snapshot
- harness: `scripts/benchmark-api-cpu.mjs`（#341）。`buildScenarios()`（:179）の既存 scenario は health / health deep / about-stats / software suggestions / announcements 3 / api-endpoints 2 / S4 session / BASELINE（:202-293）。判定は max（`BUDGETS_MS` S2 7 / S3 8 / S4 2、:31）、`MIN_SAMPLES = 50`（:33）、4種類 `normal` / `limit` / `invalid` / `cold`（:32）。
- MIG-0606 work item: Windows host では BASELINE の max が 7.2 / 12.5ms で予算と同じ大きさ。SA-007/008 は p50 8〜25ms で再現（`docs/migration/cloudflare/API_CPU_BENCHMARK.md` §6）。
- main にある Hono route（`apps/api/src/app.ts:24-49`）: health、about-stats、software suggestions、`/api/personal`（MIG-0611）、`/api/admin-read`（MIG-0625）、`/api/manage`（MIG-0624 / 0630）、`/api/admin/spreadsheet`（read、#392）、`/api/admin`（MIG-0602 の announcements / api-endpoints など、admin events）、`/api/live/events`（RH-020..022）、`/api/events`（RH-014 viewer overlay、RH-015 list）、`/api/event-endpoints`（RH-012 release）、`/api/videos`（RH-030 detail、SA-012..015 chapters）、`/api/account/summary`（RH-001）、`/api/google-drive-image` / `/api/youtube-thumbnail`（RH-016 / 033）。Entry の読み（MIG-0623）の mount は U01 で `app.ts` と `routes/personal/index.ts` から確定する。
- 指定の上限入力: live slots 6000 枠（`MAX_LIVE_SLOTS`、D-12）、RH-012 の 500 動画 × 100 member（MIG-0631 T17）、RH-014 own slots 100 件 / 64 KiB（D-12）、spreadsheet read の最大ページ。
#### Owned paths
- 変更: `scripts/benchmark-api-cpu.mjs`（scenario の追加だけ）, `scripts/benchmark-api-cpu.test.mjs`, `docs/migration/cloudflare/API_CPU_BENCHMARK.md`（新しい節「Linux run (MIG-0639)」）, `docs/migration/API_MATRIX.md`（測った method の値）
- 触らない: `apps/api/src/**`（遅い endpoint は担当 MIG へ返す）, `docs/migration/work-items/MIG-0606.md`
#### Micro-units
- **U01 scenarios**: 上の route の全 method に `normal` / `limit` / `invalid` の scenario を足す（cold は既存の `runCold`）。上限入力は seed 関数で作る（6000 枠の event、500 動画 × 100 member の event、100 own slots の viewer）。
- **U02 run**: Linux host（この container 相当。OS・CPU・node・wrangler の version を記録）で `--mode wrangler` を 1 回、各 50 回以上。BASELINE の max を noise として同じ表に書く。
- **U03 verdicts**: (a) live slots 6000 枠の warm max が 7ms 以上なら D-12 の additive paging を MIG-0604 の追加 unit として `API_CPU_BENCHMARK.md` と MIG-0604 の Work Order の「記録した既知の差・例外」に書く（code は直さない）。7ms 未満なら恒久例外と書く。(b) RH-012 の上限入力の warm max を MIG-0631 の行に書く。(c) 予算超過の method ごとに担当 MIG と理由。
#### Test cases
| ID | 入力/操作 | 期待 |
| --- | --- | --- |
| T01 | main の全 Hono method | 全件の測定値（p50 / p95 / p99 / max）と条件がある |
| T02 | 予算超過の method | 担当 MIG と理由がある |
| T03 | live slots 6000 枠 | D-12 の判定（paging の要否）が書いてある |
| T04 | `node scripts/benchmark-api-cpu.mjs --dry-run` | 新しい scenario を含む plan と self-check が PASS |
#### Commands
```bash
npm ci --no-audit --no-fund
node --test scripts/benchmark-api-cpu.test.mjs
node scripts/benchmark-api-cpu.mjs --dry-run
node scripts/benchmark-api-cpu.mjs --mode wrangler
npm run check:project-docs
```
#### Ledger updates
`API_CPU_BENCHMARK.md` に Linux run の表。`API_MATRIX.md` の各 method に LOCAL の max。MIG-0604 の Work Order に D-12 の判定（paging の追加 unit の要否）。
#### DONE checklist
- [ ] T01〜T04 が PASS
- [ ] 測定値を本番値と書いていない（LOCAL と host を明記）
- [ ] D-12 と MIG-0631 T17 の判定が書いてある
#### STOP
- 予算超過を直すために endpoint を書き換え始めたら止める（担当 MIG へ）。
- `--remote`、deploy、Cloudflare account の操作が必要になったら止める。
- BASELINE の max が 4ms 以上なら、S2 の判定を「判定不能」と書き、host を変えずに止めて PR に書く。
#### Rollback
PRをrevert。

### MIG-0640: like / bookmark API（SA-087）
- **Model:** lead
- **Readiness:** NEEDS_REFINEMENT — READY（D-14-8: MIG-0603 U03a を分割。手順は D-13-45 で確定済み。実装は Sonnet、review は Opus）
- **Recipe:** R-API
- **Runtime:** S3
- **Depends on:** MIG-0602 / **Decisions:** D-03 DECIDED, D-0603-1 DECIDED, D-13-45, D-14-8
- **Verified against:** `dde6fa8` (2026-10-25)
#### Source snapshot
- CURRENT: `src/lib/actions/video/interaction.ts:243`（SA-087）。guard は `interaction.ts:61-65` の `writeGuard({ requireActiveXId: false, requireApprovedActiveXId: false, feature: "like_or_bookmark" })`。公開画面の呼び出し元 `src/components/video/InteractionButton.tsx:6`。
- 手本: `apps/api/src/routes/videos/chapters.ts`（write stack、core `buildStaticRebuildQueueBatch`、`:33`）。write guard は `apps/api/src/middleware/writeOrigin.ts:103-171`（`requiredRole` / `activeX` option）。
- 読みは D-13-45 の3文（MIG-0603 Work Order の旧 U03a 記述）。batch は CURRENT と同じ: `INSERT ... WHERE EXISTS` の snapshot 条件、like のときは `videos.app_like_count` の CAS 更新、video + `list_popular` の queue 行。UNIQUE 競合は `{ok:true, active}`、その他の失敗は CURRENT の文言で 409。
#### Owned paths
- 新規: `+apps/api/src/routes/videos/interaction.ts`, `+packages/contracts/src/videoInteraction.ts`, `+apps/api/test/videoInteraction.parity.test.mjs`
- 変更: `apps/api/src/routes/videos/index.ts`（mount と write stack の option）, `packages/contracts/src/index.ts`, `docs/migration/API_MATRIX.md`
- 触らない: `src/lib/actions/**`, `apps/api/src/middleware/**`, `apps/api/src/routes/videos/{detail,chapters}.ts`
#### Micro-units
- **U01 route**: `POST /api/videos/:videoId/interaction`（body: `kind` = like|bookmark）。write stack は `writeGuardMiddleware({ requiredRole: null, activeX: { requireActiveXId: false, requireApprovedActiveXId: false, feature: "like_or_bookmark" } })`。
- **U02 parity**: 実 CURRENT action と同じ node:sqlite で `video_interactions_auth`・`videos.app_like_count`・`static_rebuild_queue`・監査を field 単位で比べる。wake 数の差は `DOCUMENTED DIFFERENCE D-0603-1`。D1 文数を test で固定。
#### Test cases
| ID | 入力/操作 | 期待 |
| --- | --- | --- |
| T01 | like / bookmark の on / off | CURRENT と同じ行・count・queue 行 |
| T02 | Active X 0 件の user | CURRENT と同じ（Auth User 単位で成功） |
| T03 | 同時実行（UNIQUE 競合） | `{ok:true}`、like count は1回だけ増える |
| T04 | 別 origin・未ログイン・BAN | CURRENT と同じ拒否、書き込み 0 |
| T05 | 非公開・存在しない video | CURRENT と同じ文言、書き込み 0 |
#### Commands
```bash
npm run build --workspace=@flamenode/api
node --test apps/api/test/videoInteraction.parity.test.mjs
npm run check:video-interactions-auth
npm run test:critical
npm run typecheck && npm run test:unit
```
#### Ledger updates
`API_MATRIX.md` の SA-087 に Hono endpoint と D-0603-1 の参照。`FILE_MIGRATION_MATRIX.md` に新規 file。
#### DONE checklist
- [ ] T01〜T05 が PASS
- [ ] wake 0 の差が test 名 `DOCUMENTED DIFFERENCE` で残っている
#### STOP
- 共有 module（`apps/api/src/middleware/**`, `apps/api/src/auth/session.ts`）を変える必要が出たら止める。
- D-03（所有する全 X への fan-out）の本番実行が必要に見えたら止める。
#### Rollback
Phase 6 共通契約のとおり。

### MIG-0641: 規約同意と onboarding の API（SA-074..076、onboarding complete）
- **Model:** lead
- **Readiness:** NEEDS_REFINEMENT — READY（D-14-9: MIG-0636 U03 を分割。guard の扱いは MIG-0636 の旧 U03 記述で確定済み。実装は Sonnet、review は Opus）
- **Recipe:** R-API
- **Runtime:** S3
- **Depends on:** MIG-0602 / **Decisions:** D-13-60, D-14-9
- **Verified against:** `dde6fa8` (2026-10-25)
#### Source snapshot
- CURRENT: `src/lib/actions/terms.ts:51` `commitAcceptLatestTerms`（SA-074、内部関数）, `:197` `acceptLatestTerms`（SA-075、redirect、`sanitizeNextPath` `src/lib/utils/next.ts:42`）, `:293` `acceptOnboardingTerms`（SA-076）。`acceptLatestTerms` / `acceptOnboardingTerms` は writeGuard ではなく `getCurrentUser` だけを使う（`terms.ts:293-297`）。onboarding 完了マーカー `src/lib/auth/onboarding.ts#maybeMarkOnboardingComplete`（X 申請済み / 承認済みのときだけの条件付き UPDATE、D-13-60）。
- Hono の TOS 検査: `apps/api/src/middleware/writeOrigin.ts:172-180`（未同意を弾く）。
- 呼び出し元: 公開 `app/(public)/rules/page.tsx:3,95`（SA-075、MIG-0515 が Island から呼ぶ）、SPA `/onboarding`（MIG-0702 U03）。
#### Owned paths
- 新規: `+apps/api/src/routes/personal/terms.ts`, `+packages/contracts/src/terms.ts`, `+apps/api/test/terms.parity.test.mjs`
- 変更: `apps/api/src/routes/personal/index.ts`（route 1 行）, `packages/contracts/src/index.ts`, `docs/migration/API_MATRIX.md`
- 触らない: `src/lib/actions/**`, `apps/api/src/middleware/writeOrigin.ts`, `apps/api/src/auth/session.ts`, MIG-0636 の owned paths
#### Micro-units
- **U01 SA-075**: `POST /api/personal/terms/accept`。redirect の代わりに `{ok, next}`、`next` は CURRENT と同じ `sanitizeNextPath`。
- **U02 SA-076**: `POST /api/personal/onboarding/terms`。
- **U03 onboarding complete**: `POST /api/personal/onboarding/complete`（D-13-60）。条件と UPDATE は `maybeMarkOnboardingComplete` と同じ。
- 3 route とも規約未同意の user が呼ぶので、`writeGuardMiddleware` の TOS 検査で弾かない mount にする。Origin 検査・banned 拒否・CostGuard は他の書き込みと同じ。SA-074 は内部関数なので URL を作らず U01 / U02 が使う。
#### Test cases
| ID | 入力/操作 | 期待 |
| --- | --- | --- |
| T01 | 二重送信 | 1回だけ反映 |
| T02 | `next` に外部 URL | CURRENT と同じ移動先に sanitize |
| T03 | 規約未同意の user が SA-076 / onboarding complete を呼ぶ | 成功 |
| T04 | banned・別 origin・未ログイン | CURRENT と同じ拒否、書き込み 0 |
| T05 | 監査行・`users` の更新 | CURRENT と field 単位で一致 |
| T06 | X 未申請の user の onboarding complete | 何も書かない（CURRENT と同じ） |
#### Commands
```bash
npm run build --workspace=@flamenode/api
node --test apps/api/test/terms.parity.test.mjs
npm run test:critical
npm run typecheck && npm run test:unit
```
#### Ledger updates
`API_MATRIX.md` の SA-074〜076 に Hono endpoint。onboarding complete の行（MIG-0611 からの引き継ぎ）に endpoint。
#### DONE checklist
- [ ] T01〜T06 が PASS
- [ ] `writeOrigin.ts` を変えていない
#### STOP
- `writeOrigin.ts` / `session.ts` を変える必要が出たら止める。
#### Rollback
Phase 6 共通契約のとおり。

### MIG-0642: admin 運用の書き込み その B（規約 version・編集可能 field・通知、SA-045..049, SA-051..055）
- **Model:** lead
- **Readiness:** NEEDS_REFINEMENT — READY（D-14-10: MIG-0637 U04 / U05 を分割。実装は Sonnet、review は Opus）
- **Recipe:** R-API
- **Runtime:** S3
- **Depends on:** MIG-0602 / **Decisions:** D-0603-1 DECIDED, D-13-41, D-14-10
- **Verified against:** `dde6fa8` (2026-10-25)
#### Source snapshot
| CURRENT | ID | file（feature key） |
| --- | --- | --- |
| notifications | SA-045..048 | `src/lib/actions/notification-admin.ts:117,140,167,234`（`admin_notifications`） |
| editable fields | SA-049 | `src/lib/actions/permissions-admin.ts`（`generalEditPermissions`） |
| terms versions | SA-051..055 | `src/lib/actions/rules.ts:59,86,119,175,230` |
- 手本: `apps/api/src/routes/admin/{announcements,apiEndpoints}.ts`（admin router、`costGuardMiddleware(feature)`、core `mutateWithAudit` + `auditPreloaded`、queue は core builder で wake 0）。
#### Owned paths
- 新規: `+apps/api/src/routes/admin/notifications.ts`, `+apps/api/src/routes/admin/permissions.ts`, `+apps/api/src/routes/admin/terms.ts`, `+packages/contracts/src/admin/termsNotifications.ts`, `+apps/api/test/adminTermsNotifications.parity.test.mjs`
- 変更: `apps/api/src/routes/admin/index.ts`（route 行）, `packages/contracts/src/admin/index.ts`（export 1 行）, `docs/migration/API_MATRIX.md`
- 触らない: `src/lib/actions/**`, `apps/api/src/middleware/**`
#### Micro-units
- **U01 inventory**: 7 SA の feature key、読み、batch、監査、queue 行、KV / R2 / Queue の副作用を work item に表で書く。URL は `/api/admin/<面>/...` で確定し PR 本文に貼る。
- **U02 terms SA-051..055 + editable fields SA-049**。
- **U03 notifications SA-045..048**（通知 wake 0、D-13-41）。
#### Test cases
| ID | 入力/操作 | 期待 |
| --- | --- | --- |
| T01 | 各 SA の成功 | 監査・queue 行・対象 table が CURRENT と field 単位で一致 |
| T02 | 非 admin・別 origin・CostGuard 停止 | CURRENT と同じ拒否、書き込み 0 |
| T03 | CAS 競合 | CURRENT と同じ文言、書き込み 0 |
| T04 | wake 数 | CURRENT n 回 vs Hono 0（`DOCUMENTED DIFFERENCE`） |
#### Commands
```bash
npm run build --workspace=@flamenode/api
npm run test --workspace=@flamenode/api
npm run check:audit-actor-x
npm run test:critical
npm run typecheck && npm run test:unit
```
#### Ledger updates
`API_MATRIX.md` の SA-045〜049, 051〜055 に Hono endpoint。
#### DONE checklist
- [ ] U01〜U03 が DONE、T01〜T04 が PASS
- [ ] KV / R2 の本番操作をしていない
#### STOP
- 監査の意味を変える必要が出たら止める。
- Queue binding が必要になったら止める（owner の明示承認事項）。
#### Rollback
Phase 6 共通契約のとおり。

### MIG-0643: admin 運用の書き込み その C（static rebuild admin・YouTube 再同期・可視性 repair、SA-050, SA-069..073, SA-106）
- **Model:** lead
- **Readiness:** NEEDS_REFINEMENT — READY（D-14-10: MIG-0637 U06 を分割。実装は Sonnet、review は Opus）
- **Recipe:** R-API
- **Runtime:** S3
- **Depends on:** MIG-0602 / **Decisions:** D-0603-1 DECIDED, D-13-41, D-14-10
- **Verified against:** `dde6fa8` (2026-10-25)
#### Source snapshot
| CURRENT | ID | file（feature key） |
| --- | --- | --- |
| visibility repair | SA-050 | `src/lib/actions/public-visibility-repair.ts:57`（`admin_static_rebuild`、R2 manifest） |
| static rebuild admin | SA-069..073 | `src/lib/actions/static-rebuild-admin.ts:371,537,553,608,661` |
| youtube resync | SA-106 | `src/lib/actions/youtube-sync-admin.ts`（`sendYoutubeSyncPendingWakeBestEffort`） |
- core: `packages/server-core/src/visibility/manifestR2.ts`（`putVisibilityManifestWithCas`）、`staticRebuild/enqueue.ts`。SA-106 の wake は 0（D-13-41。sync-jobs の cron `7,52 * * * *` が回収）。
#### Owned paths
- 新規: `+apps/api/src/routes/admin/staticRebuild.ts`, `+apps/api/src/routes/admin/visibilityRepair.ts`, `+apps/api/src/routes/admin/youtubeSync.ts`, `+packages/contracts/src/admin/staticRebuildOps.ts`, `+apps/api/test/adminStaticRebuildOps.parity.test.mjs`
- 変更: `apps/api/src/routes/admin/index.ts`（route 行）, `packages/contracts/src/admin/index.ts`（export 1 行）, `docs/migration/API_MATRIX.md`
- 触らない: `src/lib/actions/**`, `apps/api/src/middleware/**`, `packages/server-core/src/visibility/**`
#### Micro-units
- **U01 inventory**: 7 SA の feature key、読み、batch、監査、queue 行、R2 / Queue の副作用。SA-072 が R2 の shared input を読むなら件数を記録。
- **U02 static rebuild SA-069..073**。
- **U03 visibility repair SA-050**（core `putVisibilityManifestWithCas`）。
- **U04 youtube resync SA-106**（wake 0）。
#### Test cases
| ID | 入力/操作 | 期待 |
| --- | --- | --- |
| T01 | 各 SA の成功 | 監査・queue 行・manifest（fake bucket）が CURRENT と一致 |
| T02 | 非 admin・別 origin・CostGuard 停止 | CURRENT と同じ拒否、書き込み 0 |
| T03 | manifest の CAS 競合 | CURRENT と同じ文言、書き込み 0 |
| T04 | wake 数 | CURRENT n 回 vs Hono 0（`DOCUMENTED DIFFERENCE`） |
#### Commands
```bash
npm run build --workspace=@flamenode/api
npm run test --workspace=@flamenode/api
npm run check:audit-actor-x
npm run test:critical
npm run typecheck && npm run test:unit
```
#### Ledger updates
`API_MATRIX.md` の SA-050, 069〜073, 106 に Hono endpoint。
#### DONE checklist
- [ ] U01〜U04 が DONE、T01〜T04 が PASS
- [ ] 本番 R2 manifest を読み書きしていない（test は fake bucket）
#### STOP
- 本番 R2 manifest の読み書き、Queue binding が必要になったら止める（owner の明示承認事項）。
#### Rollback
Phase 6 共通契約のとおり。

### MIG-0644: admin の X merge API（SA-092..097, SA-110）
- **Model:** lead
- **Readiness:** NEEDS_REFINEMENT — READY（D-14-10: MIG-0637 U07 を分割。core `xid/merge` は MIG-0618 で DONE。実装は Sonnet、review は Opus）
- **Recipe:** R-API
- **Runtime:** S3
- **Depends on:** MIG-0602, MIG-0618 / **Decisions:** D-0603-1 DECIDED, D-14-10
- **Verified against:** `dde6fa8` (2026-10-25)
#### Source snapshot
- CURRENT: `src/lib/actions/xid-merge-admin.ts`（SA-092..097、`requireAdminWrite("xid_links")`）、`app/(admin)/admin/x-id-merges/page.tsx#run`（SA-110、page の dispatcher）。
- core: `packages/server-core/src/xid/merge.ts`（MIG-0618。SQL 変数 > 100 の修正 #376 を含む）。
#### Owned paths
- 新規: `+apps/api/src/routes/admin/xidMerges.ts`, `+packages/contracts/src/admin/xidMerges.ts`, `+apps/api/test/adminXidMerges.parity.test.mjs`
- 変更: `apps/api/src/routes/admin/index.ts`（route 行）, `packages/contracts/src/admin/index.ts`（export 1 行）, `docs/migration/API_MATRIX.md`
- 触らない: `src/lib/actions/**`, `apps/api/src/middleware/**`, `packages/server-core/src/xid/**`（MIG-0618 の所有）
#### Micro-units
- **U01 inventory**: 6 SA と SA-110 の dispatcher の入力・読み・batch・監査を表にする。
- **U02 SA-092..097**: core `xid/merge` を呼ぶ。
- **U03 SA-110**: page の dispatcher を型付き API の写像にする（action 名ごとに U02 の endpoint へ）。
#### Test cases
| ID | 入力/操作 | 期待 |
| --- | --- | --- |
| T01 | merge の実行と revert | 帰属が戻る（MIG-0605 T04） |
| T02 | 各 SA の成功 | 監査・対象 table が CURRENT と field 単位で一致 |
| T03 | 非 admin・別 origin・CostGuard 停止 | CURRENT と同じ拒否、書き込み 0 |
| T04 | 100 件を超える X の merge | SQL 変数の上限で落ちない（#376 の回帰） |
#### Commands
```bash
npm run build --workspace=@flamenode/api
node --test apps/api/test/adminXidMerges.parity.test.mjs
npm run check:audit-actor-x
npm run check:x-link-dependencies
npm run test:critical
npm run typecheck && npm run test:unit
```
#### Ledger updates
`API_MATRIX.md` の SA-092〜097, 110 に Hono endpoint。
#### DONE checklist
- [ ] U01〜U03 が DONE、T01〜T04 が PASS
#### STOP
- core `xid/merge` の挙動を変える必要が出たら止める（MIG-0618 の所有）。
- 本番 D1 で merge を実行する必要が出たら止める。
#### Rollback
Phase 6 共通契約のとおり。

### MIG-0645: legacy import の Route Handler（RH-002）
- **Model:** lead
- **Readiness:** NEEDS_REFINEMENT — READY（D-14-11: MIG-0638 U03 を分割。実装は Sonnet、review は Opus）
- **Recipe:** R-API, R-CORE
- **Runtime:** S3
- **Depends on:** MIG-0602, MIG-0631 / **Decisions:** SP-1〜SP-6 DECIDED（`work-items/MIG-0605.md`）, D-14-11
- **Verified against:** `dde6fa8` (2026-10-25)
#### Source snapshot
- CURRENT: `app/api/admin/import/legacy/route.ts`（528 行）、`src/lib/import/legacy/*`（preview store、`cpuBudget.ts`）。
#### Owned paths
- 新規: `+apps/api/src/routes/admin/legacyImport.ts`, `+apps/api/test/legacyImport.parity.test.mjs`
- 変更: `apps/api/src/app.ts`（mount 1 行）, `docs/migration/API_MATRIX.md`
- 移動（R-CORE、bridge）: `src/lib/import/legacy/*` のうち route が使う純粋関数 → `packages/server-core/src/import/legacy/`。正確な file は U01 で `find-unused-exports` と import graph から確定し PR 本文に列挙する
- 触らない: `app/api/**`, `apps/api/src/middleware/**`
#### Micro-units
- **U01 inventory**: route の method・入力・preview store・CPU budget・D1 文数を表にする。
- **U02 route**: preview store と CPU budget（`cpuBudget.ts`）は CURRENT のまま。core `mutateWithAudit`。
#### Test cases
| ID | 入力/操作 | 期待 |
| --- | --- | --- |
| T01 | preview → commit | CURRENT と同じ行と監査 |
| T02 | 途中失敗 | 全件ロールバック |
| T03 | CPU budget 超過の入力 | CURRENT と同じ応答 |
| T04 | 非 admin・別 origin | CURRENT と同じ拒否、書き込み 0 |
#### Commands
```bash
npm run build --workspace=@flamenode/api
node --test apps/api/test/legacyImport.parity.test.mjs
npm run test --workspace=@flamenode/server-core
node scripts/check-server-core-boundaries.mjs
npm run typecheck && npm run test:unit
```
#### Ledger updates
`API_MATRIX.md` の RH-002 に Hono endpoint。
#### DONE checklist
- [ ] T01〜T04 が PASS
#### STOP
- preview store の保存先や CPU budget の値を変える必要が出たら止める。
#### Rollback
Phase 6 共通契約のとおり。

### MIG-0646: media の Route Handler（RH-023..025）
- **Model:** lead
- **Readiness:** NEEDS_REFINEMENT — READY（D-14-11: MIG-0638 U04 を分割。実装は Sonnet、review は Opus）
- **Recipe:** R-API
- **Runtime:** S2
- **Depends on:** MIG-0602, MIG-0631 / **Decisions:** SP-6 DECIDED（`work-items/MIG-0605.md`）, D-14-11
- **Verified against:** `dde6fa8` (2026-10-25)
#### Source snapshot
- CURRENT: `app/api/media/[...key]/route.ts`（`src/lib/media/publicMedia.ts`、503 は `Retry-After: 30` :13）, `app/api/manage-x-icon/[...key]/route.ts`（`manageXIcon.ts`）, `app/api/slot-submission-icon/[slotId]/route.ts`（`slotSubmissionIcon.ts`）。
- 前例: `apps/api/src/routes/media/proxies.ts`（RH-016 / 033、SSRF 拒否）、manage icon の署名 `apps/api/src/routes/manage/icon.ts`（`AUTH_SECRET`）。
#### Owned paths
- 新規: `+apps/api/src/routes/media/publicMedia.ts`, `+apps/api/src/routes/media/manageXIcon.ts`, `+apps/api/src/routes/media/slotSubmissionIcon.ts`, `+apps/api/test/mediaRoutes.parity.test.mjs`
- 変更: `apps/api/src/app.ts`（mount 行）, `docs/migration/API_MATRIX.md`
- 触らない: `app/api/**`, `apps/api/src/middleware/**`, `apps/api/src/routes/media/proxies.ts`
#### Micro-units
- **U01 RH-023 public media**: R2 の bounded read、key の検査、cache header は CURRENT と同じ。
- **U02 RH-024 manage X icon**: 署名検証は `AUTH_SECRET`（無ければ CURRENT と同じ扱い）、D1 ACL。
- **U03 RH-025 slot submission icon**: D1 ACL、R2 の bounded read。
#### Test cases
| ID | 入力/操作 | 期待 |
| --- | --- | --- |
| T01 | 外部 URL・`..` を含む key | 拒否（SSRF / path traversal） |
| T02 | 署名改ざん | 403 |
| T03 | 正常系 | status・header・body が CURRENT と一致 |
| T04 | R2 不調 | CURRENT と同じ 503 + `Retry-After: 30` |
#### Commands
```bash
npm run build --workspace=@flamenode/api
node --test apps/api/test/mediaRoutes.parity.test.mjs
npm run check:public-api-leaks
npm run typecheck && npm run test:unit
```
#### Ledger updates
`API_MATRIX.md` の RH-023〜025 に Hono endpoint。
#### DONE checklist
- [ ] T01〜T04 が PASS
- [ ] secret の値を test fixture 以外に書いていない
#### STOP
- secret（`AUTH_SECRET`）の binding・本番 R2 の操作は明示承認まで止める（SP-6）。
#### Rollback
Phase 6 共通契約のとおり。

### MIG-0647: public event staff の Route Handler（RH-027, RH-028）
- **Model:** lead
- **Readiness:** NEEDS_REFINEMENT — READY（D-14-11: MIG-0638 U05 を分割。reader は MIG-0631 の `loadPublicSnapshot`。実装は Sonnet、review は Opus）
- **Recipe:** R-API, R-CORE
- **Runtime:** S2
- **Depends on:** MIG-0602, MIG-0631 / **Decisions:** D-14-11
- **Verified against:** `dde6fa8` (2026-10-25)
#### Source snapshot
- CURRENT: `app/api/public/events/[id]/staff/route.ts`（229 行、`OPTIONS` :94 と `GET` :136、`dynamic = "force-dynamic"` :22）、`src/lib/api/publicEventStaff.ts`。
- 既存: `apps/api/src/routes/events/publicSnapshot.ts`（R2 reader）、core `publicData/{publicApi,publicDto,artifactVisibility}.ts`（#398）。
#### Owned paths
- 新規: `+apps/api/src/routes/public/eventStaff.ts`, `+apps/api/test/publicEventStaff.parity.test.mjs`, `+packages/server-core/src/publicData/publicEventStaff.ts`
- 変更（bridge）: `src/lib/api/publicEventStaff.ts`, `packages/server-core/package.json`（exports）, `apps/api/src/app.ts`（mount 1 行）, `docs/migration/API_MATRIX.md`
- 触らない: `app/api/**`, `apps/api/src/routes/events/publicSnapshot.ts`（MIG-0631）
#### Micro-units
- **U01 core 移動**（R-CORE）: golden test を先に commit し `publicEventStaff.ts` を core へ移して byte 一致。
- **U02 route**: CORS の allowlist（OPTIONS :94、許可 header は `If-None-Match` だけ :26）、event base artifact と manifest の二重確認（etag の前後比較 :211）、`Access-Control-Expose-Headers: ETag, Retry-After`（:50）。
#### Test cases
| ID | 入力/操作 | 期待 |
| --- | --- | --- |
| T01 | OPTIONS（許可 / 不許可 origin） | CORS header が一致 |
| T02 | GET（公開 / 非公開 / artifact 欠損） | status と body が一致 |
| T03 | manifest の etag が読む前後で変わる（`route.ts:211`） | CURRENT と同じ応答（CURRENT は 304 を返さない。`If-None-Match` は preflight で許可するだけ、:26 / :126） |
#### Commands
```bash
npm run build --workspace=@flamenode/api
node --test apps/api/test/publicEventStaff.parity.test.mjs
npm run test --workspace=@flamenode/server-core
node scripts/check-server-core-boundaries.mjs
npm run check:public-api-leaks
npm run typecheck && npm run test:unit
```
#### Ledger updates
`API_MATRIX.md` の RH-027 / 028 に Hono endpoint。`FILE_MIGRATION_MATRIX.md` に bridge の行。
#### DONE checklist
- [ ] T01〜T03 が PASS
#### STOP
- `src/lib/publicData/loader.ts` の移植が必要になったら止める。
#### Rollback
Phase 6 共通契約のとおり。

### MIG-0648: X-user search の Route Handler（RH-019）
- **Model:** lead
- **Readiness:** NEEDS_REFINEMENT — READY（D-14-11: MIG-0638 U06 を分割。実装は Sonnet、review は Opus）
- **Recipe:** R-API, R-CORE
- **Runtime:** S2
- **Depends on:** MIG-0602, MIG-0631 / **Decisions:** D-14-11
- **Verified against:** `dde6fa8` (2026-10-25)
#### Source snapshot
- CURRENT: `app/api/internal/x-users/search/route.ts`（273 行、`requireRouteUser`）、`src/lib/video/memberSuggestion{Search,sCore,sLoader,sV2Loader,Rank,sPostingsV2}.ts`、`src/lib/publicData/staticSearchPostingsCore.ts`（MIG-0634 U01 が先に core へ移すなら import するだけ）。R2 の member-suggestions artifact を読む（MIG-0649 の表に載る読み手）。
#### Owned paths
- 新規: `+apps/api/src/routes/internal/xUsersSearch.ts`, `+apps/api/test/xUsersSearch.parity.test.mjs`
- 変更: `apps/api/src/app.ts`（mount 1 行）, `docs/migration/API_MATRIX.md`
- 移動（R-CORE、bridge）: 上の `memberSuggestion*` と `staticSearchPostingsCore.ts` → `packages/server-core/src/memberSuggestion/`。正確な file は U01 で import graph から確定し PR 本文に列挙する
- 触らない: `app/api/**`, `apps/api/src/middleware/**`
#### Micro-units
- **U01 core 移動**（R-CORE）: golden test（同じ R2 fixture での順位と応答）を先に commit し、loader と ranking を core へ移す。
- **U02 route**: `requireRouteUser` 相当は `sessionMiddleware` + `requireAuth`。
#### Test cases
| ID | 入力/操作 | 期待 |
| --- | --- | --- |
| T01 | 未ログイン | CURRENT と同じ status |
| T02 | 短い query / 長い query | CURRENT と同じ status と並び |
| T03 | artifact 欠損 | CURRENT と同じ劣化 |
| T04 | D1 文数 | S2 内（超えたら記録） |
#### Commands
```bash
npm run build --workspace=@flamenode/api
node --test apps/api/test/xUsersSearch.parity.test.mjs
npm run test --workspace=@flamenode/server-core
node scripts/check-server-core-boundaries.mjs
npm run typecheck && npm run test:unit
```
#### Ledger updates
`API_MATRIX.md` の RH-019 に Hono endpoint。`FILE_MIGRATION_MATRIX.md` に bridge の行。
#### DONE checklist
- [ ] T01〜T04 が PASS
#### STOP
- ranking の結果が1件でも CURRENT と違ったら止める。
#### Rollback
Phase 6 共通契約のとおり。

### MIG-0649: R2 artifact の読み手の棚卸しと CI 検査（MIG-0627 U01）
- **Model:** lead
- **Readiness:** NEEDS_REFINEMENT — READY（D-14-13: MIG-0627 U01 を分割。依存なし。実装は Sonnet、review は Opus）
- **Recipe:** R-REMOVE
- **Runtime:** N
- **Depends on:** — / **Decisions:** D-09 DECIDED, D-14-13
- **Verified against:** `dde6fa8` (2026-10-25)
#### Source snapshot
- 読み手の入口: CURRENT `src/lib/publicData/loader.ts` `loadPublicJson({ r2Key, ... })`（例 `sitemapSources.ts:40-64` の4 key）、`env.BUCKET.get(` / `R2_STORAGE.get(` の直接呼び、`apps/api/src/routes/events/publicSnapshot.ts`（MIG-0631 の reader）、`workers/ga-analytics/sync.ts:20` `GA4_RECENT_LIST_KEY = "list/recent.json"`。
- producer: `workers/json-generator/rebuild.ts`（`putJson(env, "<key>", ...)`、例 :1142）、server-core `visibility/*`（`visibility/blocked-entities.v1.json` など、残す側）、`workers/ga-analytics`（`analytics/trending.json`）。
- 既知の対応（MIG-0627 Source snapshot）: RH-019 member-suggestions、RH-026 `top` / `sections` / `stats.v1`、RH-028 event-base、`sitemapSources` の index、`list/recent.json`、`rules/current.json`、RH-015 static_only の `events/index.json`、RH-012 の `events/<id>/release.v1.json`。
#### Owned paths
- 新規: `+docs/migration/R2_ARTIFACT_CONSUMERS.md`, `+scripts/check-r2-artifact-consumers.mjs`, `+scripts/check-r2-artifact-consumers.test.mjs`
- 変更: `.github/workflows/migration-docs-check.yml`（step 1 つ）, `docs/migration/FILE_MIGRATION_MATRIX.md`, `package.json`（`check:r2-artifact-consumers` script 1 行）
- 触らない: 読み手・producer の code（置き換えは MIG-0627）
#### Micro-units
- **U01 table**: `R2_ARTIFACT_CONSUMERS.md` に key（または key の形 `events/<id>/release.v1.json`）ごとに producer（file:line）、読み手（file:line）、置き換え先（build 時 snapshot の key / 残す / MIG-0907 で消す）、担当 MIG を書く。
- **U02 checker**: `check-r2-artifact-consumers.mjs` が `app/`, `src/`, `apps/`, `workers/`, `packages/` の `.ts` / `.tsx` / `.mjs` から `r2Key:` の文字列リテラル、`.get("` / `.get(\`` の第1引数（BUCKET / R2 系 binding の上だけ）、`*_KEY = "` の定数を抽出し、表に無い key を列挙して exit 1。test 名で template key（`${id}` を含む）を `<id>` に正規化する規則を固定する。test dir と fixture は除外。
- **U03 CI**: workflow に `node scripts/check-r2-artifact-consumers.mjs` と test を足す。
#### Test cases
| ID | 入力/操作 | 期待 |
| --- | --- | --- |
| T01 | main の code | 表に無い読み手 0 件で exit 0 |
| T02 | fixture に表に無い `r2Key: "foo/bar.json"` | exit 1、file:line を出す |
| T03 | template key `` `events/${id}/release.v1.json` `` | `events/<id>/release.v1.json` に正規化して照合 |
#### Commands
```bash
node --test scripts/check-r2-artifact-consumers.test.mjs
node scripts/check-r2-artifact-consumers.mjs
npm run check:project-docs
```
#### Ledger updates
`R2_ARTIFACT_CONSUMERS.md` を新規作成し、MIG-0627 と MIG-0907 から link。回復規則を 1 行入れる:「欠けた artifact の再生成は次の build だけ。公開 GET は D1 / Queue / `public_build_state` に書かない」。
#### DONE checklist
- [ ] T01〜T03 が PASS、CI に入っている
- [ ] 全 key に producer と置き換え先（または「残す」）がある
#### STOP
- 読み手を書き換え始めたら止める（MIG-0627）。
#### Rollback
PRをrevert（文書・script・CI step だけ）。

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

### MIG-0607: Phase 6 Gate
- **Model:** lead
- **Readiness:** NEEDS_REFINEMENT — Phase Gate はエージェントが自動承認しない
- **Recipe:** R-EVIDENCE
- **Runtime:** N
- **Depends on:** MIG-0606, MIG-0631, MIG-0632, MIG-0634..MIG-0648 / **Decisions:** D-14-14
- **Verified against:** `a1b910b4` (2026-10-25)
#### Source snapshot
- `route-handlers/README.md` の RH-001〜033（33メソッド）。RH-010/011（Auth.js）は Phase 8 まで旧 Next。
- Phase 6 の全 task（0601〜0606, 0608, 0611〜0649）の merge 済み PR と `API_CPU_BENCHMARK.md`。
- RH-017 `/api/health/deep` の検査本体は MIG-0626 U07（D-13-59）。それまで `apps/api/src/routes/health.ts:65-77` は fail-closed の仮実装。
#### Owned paths
- 変更: `docs/migration/API_MATRIX.md`（33メソッドの移行先・fallback・テスト）, `docs/migration/STATUS.md`（承認後だけ）
#### Micro-units
- **U01 matrix**: 33メソッドすべてに Hono の場所、method 単位の routing、契約テスト、未移行の明示的な fallback を記録。SA は担当 MIG と `DOCUMENTED DIFFERENCE`（D-0603-1、D-13-41、MIG-0631 L3/L5、D-13-46、D-13-49）を一覧にする。
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
- [ ] RH-017 認証済み `/api/health/deep` が CURRENT の検査本体と一致している（MIG-0626 U07。MIG-0601 の fail-closed 仮実装が残っていない）
- [ ] 独立レビューの APPROVE と人間の Phase Gate 承認
#### STOP
- 人間の承認なしに STATUS を DONE にしない。
- Auth.js を Hono へ移したと記録しない。
#### Rollback
Gate のPRをrevert。

