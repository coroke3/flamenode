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
#### Rules
- Static rebuild enqueue in Hono writes (D-0603-1): write the `static_rebuild_queue` row(s) in the same D1 batch as the mutation, byte-identical to CURRENT `buildStaticRebuildQueueBatch` (target_type / target_id / reason / priority / requested_by_user_id, active-row UPSERT merge rule). Send no Queue wake, add no Queue binding, no `waitUntil` fetch, no direct drain, no deploy-hook call. Each slice must (1) list the targets and reasons it enqueues in its work item, (2) assert the queue row field-by-field against the real CURRENT action in a node:sqlite parity test, (3) record one `DOCUMENTED DIFFERENCE D-0603-1` test showing CURRENT wake count vs 0, (4) reference D-0603-1 in the route file comment. Fan-out that needs more than the S3 pre-read budget (e.g. SA-087 `list_popular` prefetch) is a separate blocker, not covered by D-0603-1.
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
- **Readiness:** NEEDS_REFINEMENT — MIG-0602 と MIG-0305 の merge 後、U04 は MIG-0633（ownership core）の DONE 待ち。micro-unit の正本は [`TASK_MICRO_UNITS.md`](TASK_MICRO_UNITS.md) MIG-0604
- **Recipe:** R-API
- **Runtime:** S2, S3
- **Depends on:** MIG-0602, MIG-0305, MIG-0633 / **Decisions:** none
- **Verified against:** `aacf4fd` (2026-10-15)
#### Source snapshot
| CURRENT | ID | file |
| --- | --- | --- |
| event list | RH-015（MIG-0631 へ移管） | `app/api/events/route.ts` |
| slot viewer overlay | RH-014 | `app/api/events/[id]/slots/viewer-overlay/route.ts` |
| live slots / submissions / summary | RH-020..022 | `app/api/live/events/[id]/{slots,submissions,summary}/route.ts` |
| event export | RH-012（MIG-0631 へ移管）, RH-013（MIG-0632 へ移管） | `app/api/event-endpoints/[id]/route.ts`, `app/api/event-endpoints/[id]/release/route.ts` |
| event / staff / template / playlist | SA-021..039 | `src/lib/actions/event-*.ts`, `event-youtube-playlist.ts` |
| slot | SA-056..068 | `src/lib/actions/slot*.ts` |
- 公開画面の `src/components/event/SlotGrid.tsx:15` が `@/lib/actions/slot` を直接呼ぶ。Phase 5 の枠 Island はこの MIG の API を使う。
#### Owned paths
- 新規: `+apps/api/src/routes/events/*.ts`, `+apps/api/src/routes/live/*.ts`, `+packages/contracts/src/event*.ts`
- 触らない: `src/lib/actions/**`, `app/api/events/**`, `app/api/live/**`
#### Micro-units
- U01〜U04 と Final audit は [`TASK_MICRO_UNITS.md`](TASK_MICRO_UNITS.md) MIG-0604 のとおり。
- U01 残り RH-015 と U03 RH-012 は MIG-0631（live mode は D1、static_only と release は R2 artifact。L1〜L6）へ、RH-013 は MIG-0632 へ、U04 の非 admin 権限・owner 0 guard は MIG-0633（ownership core）の後に MIG-0604 で実装。B5 は MIG-0617 で解消（Option A に restore_strategy は足さない）。
#### 記録した既知の差・例外（lead 決定。挙動を変える改善ではなく S2 制約との衝突）
- live slots の `MAX_LIVE_SLOTS = 6000` は ZERO_1102 S2（LIMIT は名前付き定数 100 以下 / 応答 64KB 以下）を超える。CURRENT（`liveApi.ts`）が同じ 6000 件上限・`truncated` を持つため、挙動を保つ目的で変えない。6000 枠の実測応答は約 890 KiB（`public_name`、UUID 形式 id・表示名付き）/ 約 615 KiB（匿名）。5 秒 cache と 15 秒 isolate micro-cache は CURRENT と同じ。ページング化（応答契約の変更）は owner 判断として保留し、MIG-0604 では行わない。owner-delegate 決定（D-12、2026-10-24）: 例外として承認。MIG-0606 の 6000 枠入力で warm max を測り、7ms 以上のときだけ後続 unit で additive paging を足す。
- RH-014（viewer overlay）は本人の枠を LIMIT 100 / JSON 64 KiB で打ち切り、超過時は CURRENT の `authUnavailable` 形（`loggedIn: true`）で fail-closed にする。CURRENT は無制限。本人の枠の読み取り失敗は CURRENT では 200 の `authUnavailable` 形だが、event 行と同じ statement で読むため 503 になる。どちらも S2（statement 3 つ以内）のための差で、`work-items/MIG-0604.md` の Known differences に記録した。`operatorOverrideAllowed` が常に false なのは CURRENT の挙動（event 行を `visibility_status` 無しで select）の再現で、修正は挙動変更として別に扱う。own-slots 100 / 64 KiB の fail-closed、503 への差、ORDER BY の明示、pending 100 件は D-12 で承認（ページング不要）。

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
`API_MATRIX.md` の RH-014, 020〜022 と SA-021〜039, 056〜068 に Hono エンドポイント。RH-012 / RH-015 は MIG-0631、RH-013 は MIG-0632 の Ledger（2026-10-24 に移管。本 task の DONE 条件から除く）。
#### DONE checklist
- [ ] U01（RH-014）、U02、U04 と Final audit が DONE。RH-012 / RH-015 は MIG-0631、RH-013 は MIG-0632 の DONE で満たす（二重所有を避けるため本 task の条件に含めない。B4 の ownership port は MIG-0633、B5 は MIG-0617 で解消）
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
- **U05 body size 上限（coverage gap G21）**: `next.config.mjs` の `serverActions.bodySizeLimit` は 8mb（対象は SA-105 `uploadXIdIcon` と SA-086〜089 の form）。Hono 側の上限は RH-008 / RH-002 だけが書かれているため、SA ごとの上限を表にして middleware（MIG-0603 の共通 middleware と同じ場所）で強制する。
- **U07 inline Server Action（G22）**: 次を表の明示行にする。SA-107（entry の `discordSignInInline`、return-to の sanitize。担当は MIG-0703 と MIG-0802）、SA-108 / SA-109（api-endpoints page の wrapper。型付き API に写す）、SA-110（x-id-merges の run dispatcher）。
#### Test cases
| ID | 入力/操作 | 期待 |
| --- | --- | --- |
| T01 | account summary の未ログイン | CURRENT と同じ `no-store` 応答 |
| T02 | media proxy に外部URL | SSRF 拒否 |
| T03 | spreadsheet import の途中失敗 | 全件ロールバック |
| T04 | X merge の revert | 帰属が戻る |
| T05 | 上限超過の body、ちょうど 8MB の body（G21） | 超過は Next と同じ拒否、8MB ちょうどは通る |
| T06 | SA-107 の return-to に危険な URL（G22） | 同じ移動先に sanitize される |
| T07 | SA-108 / SA-109 の wrapper（G22） | 型付き API に写り、エラーの写像が CURRENT と同じ |
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
  | 日替わりの top 並び（coverage gap G18） | `workers/content-jobs/index.ts:30` の `ensureDailyTopNostalgicShuffle` | 1日1回。build 時へ移すか、1回の上限を測って決める（U02 で seed と日付を固定した出力を CURRENT と比べる） |
  | static rebuild queue の処理（G18） | `workers/content-jobs/index.ts` の rebuild queue 処理 | MIG-0907 で消すまでの現行値を測る |
  | wake queue の consumer 3つ（G18） | `max_batch_size = 10` | batch 10 件を 8ms 未満に収める（T01 の入力に含める） |

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
- **Readiness:** NEEDS_REFINEMENT — 実装前に CURRENT の `public/_headers` の値を測り、新 prefix ごとの値を表にする
- **Recipe:** R-GATEWAY
- **Runtime:** S0, S1
- **Depends on:** MIG-0405 / **Decisions:** D-02 DECIDED
- **Verified against:** `c5a62b4d` (2026-10-23)
#### Source snapshot
- G04 `public/_headers`: `/_next/static` immutable 1年、`/favicon.ico` 1日、png / webp / svg は `max-age=86400` と `stale-while-revalidate=604800`。
- `apps/site/src/gateway/routeShards.ts:90` が `_headers` を設定と呼ぶが、新しい file を所有する task が無い。新 prefix `/_astro/`, `/_personal_assets/`, `/_ops_assets/`, `/brand/` に Cache-Control の定義が無い。
#### Owned paths
- 新規: `+apps/site/public/_headers`, `+apps/site/src/gateway/assetHeaders.test.mjs`
- 変更: `public/_headers`（CURRENT。`/_next/static` は MIG-0904 まで残す）
#### Micro-units
- **U01 spec**: 現行 `_headers` の各ルールと新 prefix の値を表にする（hash 付き名前は immutable、`/brand/` は現行 png と同じ）。
- **U02 file**: 新 Worker の assets に `_headers` を置く。
- **U03 test**: 各 prefix の Cache-Control を検査する test（wrangler dev または fixture）。
#### Test cases
| ID | 入力/操作 | 期待 |
| --- | --- | --- |
| T01 | `/_astro/*`, `/_personal_assets/*`, `/_ops_assets/*` | hash 付きは immutable 1年 |
| T02 | `/brand/*`, `/favicon.ico` | 現行と同じ値 |
| T03 | HTML | immutable にならない |
#### Commands
```bash
node --test apps/site/src/gateway/assetHeaders.test.mjs
npm run build --workspace=@flamenode/site
npm run check:project-docs
```
#### Ledger updates
`FILE_MIGRATION_MATRIX.md` に `public/_headers` の行。
#### DONE checklist
- [ ] 全 prefix の Cache-Control が表と一致
- [ ] HTML に immutable が付いていない
#### STOP
- 本番 Route の変更が必要に見えたら止める。
#### Rollback
PRをrevert。

### MIG-0621: robots.txt の byte parity と sitemap.xml（公開可視性 manifest から）
- **Model:** lead
- **Readiness:** NEEDS_REFINEMENT — MIG-0509 の後。sitemap の URL 集合を公開可視性 manifest から作る形にする
- **Recipe:** R-PAGE
- **Runtime:** S0, B
- **Depends on:** MIG-0509 / **Decisions:** D-09 DECIDED
- **Verified against:** `c5a62b4d` (2026-10-23)
#### Source snapshot
- G09 `app/robots.ts`: disallow は `/api/`, `/admin/`, `/manage/`, `/dashboard/`, `/entry`, `/onboarding`, `/dev/`, `/maintenance`。sitemap と host を出す。`app/sitemap.ts`: revalidate 3600、URL は R2 index（`src/lib/publicData/sitemapSources`）から、静的 entry は `buildStaticSitemapStaticEntries`。
- gateway `routeShards.ts:95` は `/robots.txt` を allowlist しているが file も生成も無い。`/sitemap.xml` は allowlist されていない。MIG-0907 が `sitemapSources` の R2 index の producer を消す。
- Phase 5 の MIG-0501 は robots / sitemap を Phase 9 に回している。最初の公開 cutover の前に必要なので、この task が所有する。
#### Owned paths
- 新規: `+apps/site/src/pages/robots.txt.ts`, `+apps/site/src/pages/sitemap.xml.ts`, `+apps/site/src/pages/robotsSitemap.test.mjs`
- 変更: `apps/site/src/gateway/routeShards.ts`（`/sitemap.xml` を allowlist）
- 触らない: `app/robots.ts`, `app/sitemap.ts`（本番切替まで）
#### Micro-units
- **U01 robots**: 現行の出力を fixture にして byte 比較。
- **U02 sitemap**: build 時の公開可視性 manifest から URL 集合を作る。静的 entry は現行と同じ。
- **U03 allowlist**: gateway の allowlist と route map の衝突検査。
#### Test cases
| ID | 入力/操作 | 期待 |
| --- | --- | --- |
| T01 | robots.txt | 現行と byte 一致 |
| T02 | sitemap.xml の URL 集合 | 公開可視性 manifest の公開集合と一致。非公開が0件 |
| T03 | 静的 entry | `buildStaticSitemapStaticEntries` と一致 |
| T04 | `/sitemap.xml` と `/robots.txt` | gateway が通す |
#### Commands
```bash
node --test apps/site/src/pages/robotsSitemap.test.mjs
npm run build --workspace=@flamenode/site
npm run check:public-visibility-fences
npm run check:project-docs
```
#### Ledger updates
`FILE_MIGRATION_MATRIX.md` に `app/robots.ts`, `app/sitemap.ts`, `src/lib/publicData/sitemapSources.ts` の行。`ROUTE_MATRIX.md` に2行。
#### DONE checklist
- [ ] robots が byte 一致、sitemap の URL 集合が manifest と一致
- [ ] 最初の公開 cutover の前に DONE（MIG-0508 の依存）
#### STOP
- 本番 Route の変更が必要に見えたら止める。
- sitemap の revalidate（3600秒）を build 頻度より厳しくする必要が出たら止める。
#### Rollback
PRをrevert。

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
- **Readiness:** NEEDS_REFINEMENT — MIG-0611（PR #333）の merge 後に形を確定してから
- **Recipe:** R-API
- **Runtime:** S2
- **Depends on:** MIG-0601, MIG-0608 / **Decisions:** D-05 DECIDED
- **Verified against:** `c5a62b4d` (2026-10-23)
#### Source snapshot
- G13 `app/(admin)/admin/**` の `page.tsx`（35 / 45 が db / auth / publicData を直接 import）。Phase 6 の API 一覧に読み取り endpoint が無い。
- この task の対象: users、videos、events、moderation（通報・審査）、それらの詳細と一覧。残りは MIG-0626。
- `(admin)/layout.tsx`: manage と同じ redirect に加え、admin 以外は `/dashboard`（G12）。
#### Owned paths
- 新規: `+apps/api/src/routes/adminRead/users.ts`, `+apps/api/src/routes/adminRead/videos.ts`, `+apps/api/src/routes/adminRead/events.ts`, `+apps/api/src/routes/adminRead/moderation.ts`, `+packages/contracts/src/adminRead.ts`, `+apps/api/test/adminRead.parity.test.mjs`
- 触らない: `app/**`, `src/lib/actions/**`
#### Micro-units
- **U01 inventory**: 該当 page の loader を全件列挙（`CURRENT_ROUTES.md` の Admin 45 のうち users / videos / events / moderation）。MIG-0626 との分担表を PR に貼る。
- **U02 contract** → **U03 routes**（admin 権限、`private, no-store`）→ **U04 parity**。
#### Test cases
| ID | 入力/操作 | 期待 |
| --- | --- | --- |
| T01 | 対象 page の正常系 | CURRENT loader と DTO が一致 |
| T02 | route × role（guest, user, staff, owner, admin） | admin 以外を拒否 |
| T03 | D1 statement 数 | 1 endpoint あたり3件以下 |
| T04 | response | private, no-store。secret・token を含まない |
#### Commands
```bash
npm run build --workspace=@flamenode/api
node --test apps/api/test/adminRead.parity.test.mjs
npm run check:public-api-leaks
npm run typecheck
npm run test:unit
```
#### Ledger updates
`API_MATRIX.md` に行。admin の page 行の target。
#### DONE checklist
- [ ] 担当範囲の page すべてに endpoint と parity
- [ ] MIG-0626 との分担に漏れが無い
#### STOP
- 権限を緩める必要が出たら止める。
#### Rollback
PRをrevert。

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

### MIG-0627: R2 artifact の読み手を build 時 snapshot に置き換える（MIG-0907 の前提）
- **Model:** lead
- **Readiness:** NEEDS_REFINEMENT — MIG-0509 の後。`rg` で R2 の get key を全件数え、producer 一覧と突き合わせてから
- **Recipe:** R-REMOVE
- **Runtime:** B
- **Depends on:** MIG-0509 / **Decisions:** D-09 DECIDED
- **Verified against:** `c5a62b4d` (2026-10-23)
#### Source snapshot
- G14 R2 artifact の producer（`workers/json-generator`）と consumer: RH-019 member-suggestions artifact、RH-026 `top` / `sections` / `stats.v1`、RH-028 event-base、`sitemapSources` の index、`ga-analytics` の `list/recent.json`、MIG-0611 の `rules/current.json`。
- MIG-0907 T02 は「R2 artifact は書かれない」とするが、生き残る Hono / worker の読み手が何に置き換わるかを書く task が無い（GA4 だけは `PHASE_4_5_SPEC.md` の MIG-0509 が扱う）。
- MIG-0631 の Hono 読み手 2 件（2026-10-24、MIG-0631 Q2 で Fable が決定）: RH-015 static_only の `events/index.json`、RH-012 の `events/<id>/release.v1.json`。両者とも GET は D1 / Queue / `public_build_state` に書かない（MIG-0631 L3）。MIG-0907 の後、欠けた artifact を作り直すのは build だけ（`apps/site/scripts/produceSnapshots.ts` が build ごとに全 public event の release と events index を D1 から作り直す）。
- `visibility/blocked-entities.v1.json` は残す側（producer は server-core `visibility/eventTransition.ts` などの S3 経路で、json-generator ではない）。
#### Owned paths
- 新規: `+docs/migration/R2_ARTIFACT_CONSUMERS.md`
- 変更: 読み手の file（棚卸しで確定。1 PR は1系統）。build の artifact publish と完全性検査の file（U04 / U05 で確定）
#### Micro-units
- **U01 inventory**: R2 の get key を `rg` で全件列挙し、producer、読み手、置き換え先（build 時 snapshot）を表にする。
- **U02 replace**: 読み手を1系統ずつ build 時 snapshot へ。DTO は変えない。
- **U03 gate**: MIG-0907 の U01 が参照できる状態（読み手0件）を確認。
- **U04 API artifact publish**: API が読む artifact（MIG-0631 の 2 種）を build が同じ key / schema で R2 へ差分 PUT する（変わった object だけ）。PUT 件数を build log に出し、`BUILD_TIME_DATA.md` §6 に月間 Class A の見積りを書く（無料枠の 80% 以下）。
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
`R2_ARTIFACT_CONSUMERS.md` を新規作成し、MIG-0907 から link。回復規則を 1 行入れる:「欠けた artifact の再生成は次の build だけ。公開 GET は D1 / Queue / `public_build_state` に書かない」。
#### DONE checklist
- [ ] 全 artifact に置き換え先がある
- [ ] MIG-0907 が依存として参照できる
#### STOP
- 本番 R2 の書き込みや削除が必要になったら止める（明示承認事項）。
- build 用の R2 write credential が要ると分かったら止める（secret。Yugo の承認事項）。
- artifact の DTO を変える必要が出たら止める。
#### Rollback
PRをrevert。

### MIG-0628: 新 Worker の deploy と smoke の連鎖
- **Model:** lead
- **Readiness:** NEEDS_REFINEMENT — 実装前に Worker 別の binding 表（D1 / KV / R2 / Queue / vars）を lead が確定する。本物の deploy・Route・secret の操作は含めず、明示承認まで止まる
- **Recipe:** R-EVIDENCE
- **Runtime:** N
- **Depends on:** MIG-0405, MIG-0606 / **Decisions:** D-02 DECIDED
- **Verified against:** `c5a62b4d` (2026-10-23)
#### Source snapshot
- G15 Workers Builds は `flamenode-web` にだけ attach されている。`scripts/cloudflare-production.mjs` と `scripts/smoke-cloudflare.mjs` は Worker 4つと `/rebuild`, `/process-queue`, `/health` を固定で持つ（`smoke-cloudflare.mjs:399`）。新 Worker（gateway/site, api, personal, ops）の `wrangler.toml` は `apps/*` に無く、build trigger、binding 注入、smoke の担当が無い。`TOPOLOGY.md` は CURRENT だけ。
- G16 `wrangler.toml`（flamenode-web）の binding: `DB`, `KV`, `BUCKET`, `ASSETS`, `WORKER_SELF_REFERENCE`、queue producer 3、vars `PUBLIC_DEGRADED_D1_ENABLED`, `PUBLIC_VISIBILITY_GUARD_MODE`, queue flags、placement smart、`nodejs_compat`、`global_fetch_strictly_public`。Hono Worker（`apps/api/src/env.ts`）は変更系の parity のためこれらを持つ。
#### Owned paths
- 新規: `+apps/site/wrangler.toml`, `+apps/api/wrangler.toml`, `+apps/app/wrangler.toml`, `+apps/ops/wrangler.toml`, `+docs/migration/cloudflare/NEW_WORKER_DEPLOY.md`
- 変更: `scripts/smoke-cloudflare.mjs`, `scripts/cloudflare-production.mjs`, `.github/workflows/migration-docs-check.yml`（dry-run の追加）
- 触らない: 本番 Worker・Route・Custom Domain・secret・Remote D1（操作しない）
#### Micro-units
- **U01 binding 表**: Worker ごとの binding と vars を `NEW_WORKER_DEPLOY.md` に書く（CURRENT の `wrangler.toml` と対応付け）。
- **U02 wrangler files**: 上の4つ。id は placeholder で、実 id は承認後に注入する。
- **U03 dry-run**: CI で `wrangler deploy --dry-run` を Worker ごとに実行。
- **U04 smoke**: 移行済み path を覆う smoke list と、commit SHA の収束検査（CURRENT と同じ方式）。
- **U05 手順書**: 実 deploy・Route・secret の手順を書く。実行は owner の明示承認後。
#### Test cases
| ID | 入力/操作 | 期待 |
| --- | --- | --- |
| T01 | 4 Worker の `wrangler deploy --dry-run` | 全て PASS |
| T02 | `apps/api/src/env.ts` の key | 移行済み SA が必要な key の和集合と一致 |
| T03 | smoke list | 移行済み path をすべて含む |
| T04 | 変更系 mutation の enqueue（MIG-0602 T03） | Queue binding 経由で動く |
#### Commands
```bash
npx wrangler deploy --dry-run --config apps/site/wrangler.toml
npx wrangler deploy --dry-run --config apps/api/wrangler.toml
npm run check:project-docs
```
#### Ledger updates
`cloudflare/TOPOLOGY.md` に target の Worker 表を追記（CURRENT と区別）。
#### DONE checklist
- [ ] dry-run が CI で PASS
- [ ] 実 deploy・Route・secret を実行していない
- [ ] MIG-0805 の前提として参照できる
#### STOP
- 本番 Worker・Route・Custom Domain・secret・Remote D1 の操作は明示承認が出るまで止める。
#### Rollback
PRをrevert。
### MIG-0629: admin audit settings + restore dry-run APIs（監査設定・dry-run API）
- **Model:** lead
- **Readiness:** NEEDS_REFINEMENT — 決定 M1〜M3 は 2026-10-24 に済み。MIG-0616 は DONE。MIG-0617 が DONE になった後に READY（それまで着手しない）
- **Recipe:** R-API
- **Runtime:** S3
- **Depends on:** MIG-0602, MIG-0616, MIG-0617 / **Decisions:** D-01 DECIDED, D-10 DECIDED
- **Verified against:** `aacf4fd` (2026-10-15)
#### Source snapshot
| CURRENT | ID | file |
| --- | --- | --- |
| audit settings update | SA-009 | `src/lib/actions/audit-admin.ts#updateAuditLogSettingsAction` |
| audit dry run | SA-010 | `src/lib/actions/audit-admin.ts#getAuditLogDryRun` |
- MIG-0602 の分割で移動（2026-10-23）。SA-011（audit restore）は MIG-0616 で個別実装。ガードは MIG-0602 の `writeGuardMiddleware` + `costGuardMiddleware` を再利用する。
#### lead 決定（2026-10-24、Fable（owner-delegate）2026-10-24、Yugo の standing instruction「検討事項は推奨で進めて」に基づく。Yugo には事後に伝える）
- **M1 SA-010 の実装の置き場**: Depends に MIG-0616 と MIG-0617 を追加する。SA-010 は core の `restoreAuditLog(db, { dry_run: true })` を呼ぶ。8 adapter と capability の写しは作らない（D-10）。
- **M2 guard**: SA-009 / SA-010 とも `POST` + `writeGuardMiddleware` + `costGuardMiddleware("admin_permissions")`。CURRENT は両方 `requireAdminWrite("admin_permissions")` で、read guard にすると CostGuard の拒否が消えて parity を失う。下の U02 の「既定の admin read guard」は撤回。
- **M3 順序**: MIG-0617 の後に実装する。SA-009 を Option A で先に書かない（二度書きの回避）。
#### Owned paths
- 新規: `+apps/api/src/routes/admin/audit*.ts`、`+packages/contracts/src/admin/audit*.ts`
- 触らない: `src/lib/actions/**`
#### Micro-units
- **U01 audit settings**: SA-009。`updateAuditLogSettings` と同じ strict 監査（`system_settings` 更新 + 監査 1 件を 1 batch）。
- **U02 dry run**: SA-010。書き込み 0（core の `restoreAuditLog` を `dry_run: true` で呼ぶ）。guard は M2 のとおり `POST` + writeGuard + CostGuard `admin_permissions`。
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
- **L2 可視性 guard（privacy）**: CURRENT と同じ規則にする。`c.env.PUBLIC_VISIBILITY_GUARD_MODE` を server-core の `resolvePublicVisibilityGuardMode` で解決する。enforce は manifest を読み、読めない・ETag が無い・壊れている・大きすぎるときは 503 `public_data_unavailable`（fail-closed）。`event_release` の event が blocked なら 404。artifact は `filterPublicArtifactPayload(targetType, payload, enforce のときだけ context)` で行を落とす。observe は manifest を読んで blocked をログに出すだけ（CURRENT と同じ JSON 形）、off は読まない。RH-015 の live mode は D1 が正本なので guard を通さない（CURRENT も normal では loader の結果を捨てる）。非公開・未公開の event が出ない保証は CURRENT と同じ: live mode は D1 の `visibility_status = 'public'`、release は D1 の gate、static_only は artifact 生成時の public 条件 + 行の marker + enforce の manifest。採らない案: (i) Hono だけ常に enforce（本番の observe と挙動が分かれ、manifest の有無で一覧全体が 503 になり得る。強化はブラッシュアップ提案）、(ii) entity ごとの KV `deny:` 参照（一覧は最大 60 件で S1 の KV 1 回を超え、writer も未実装。D-11 のリスク）。
- **L3 miss 時の再生成依頼**: Hono の GET は書かない（D1 write 0、Queue 0、`waitUntil` 0）。miss は CURRENT と同じ status で返す。code は RH-015 が CURRENT と同じ `public_data_unavailable`、RH-012 は enqueue しないので `public_data_reflecting` を返さず常に `public_data_unavailable`（記録した差）。根拠: CURRENT の miss 経路は `directEnqueueStaticRebuild` だけで 3 文（最大 9 文）+ operation mode の D1 1 文で、RH-012 の gate 1 文と合わせると S2 の 3 文を超える。匿名の公開 GET が D1 に書く経路を Hono に増やさない。`apps/api` に Queue binding を置かない D-0603-1 と同じ方針。対象の `static_rebuild_queue` / json-generator は MIG-0907 で消える。Hono route は MIG-0509 の producer 配線まで本番 Route に繋がないので、共存中の自己修復は CURRENT（Next）側の miss が続ける。採らない案: (i) server-core `directEnqueueStaticRebuild` を wake 0 で呼ぶ（S2 超過。MIG-0907 で無効になる行）、(ii) `public_build_state.requested_at` の条件付き UPDATE（1 文だが、匿名 traffic が Workers Builds の日次上限まで build を起こせる。Q2 で不採用）。
- **L4 RH-015 の live mode（DECIDED、Fable（owner-delegate）2026-10-24。D-12 を訂正）**: normal / economy / read_only は CURRENT と同じ D1 の 1 文（`LIMIT` は `MAX_PUBLIC_EVENT_LIMIT` = 60）で返し、static_only だけ R2 artifact を読む。Hono は live mode で R2 を読まない（CURRENT が読んで捨てる R2 read と miss enqueue は応答に影響しない）。根拠: CURRENT の normal は「D1 fallback」ではなく毎回 D1 が主経路で、artifact に置き換えると point event が消える、200 件で打ち切られる、同じ `start_time` の並びが変わる（`created_at DESC` が無い）、反映が artifact の再生成待ちになる、空 index で 503 になる、という D-12 に書かれていない利用者から見える差が出る。D1 1 文・`LIMIT` 60 は S2（3 文、`LIMIT` ≤ 100）に収まり、`ZERO_1102.md` §4.7 の「miss で重い処理へ fallback」にも当たらない（miss ではなく主経路）。D-09「反映の速さの方針」の 1（Island が S2 で即時に読む）とも合う。`OPEN_DECISIONS.md` D-12 に DECIDED として記録済み。U03 は static_only / maintenance / live mode の 3 分岐を 1 unit で実装する。採らない案: D-12 原文どおり全 mode で artifact（上の差がすべて出る）。
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
| T07 | static_only × guard mode（enforce: manifest なし / ETag なし / event を block / group を block。observe: block あり。off） | 各組で CURRENT と一致（enforce は fail-closed で 503 か行を落とす。observe と off は落とさない） |
| T08 | KV `operation_mode:mirror` が maintenance | 両 route とも 503 `public_data_unavailable` |
| T09 | normal で D1 が失敗 / `DB` なし | 503 `database_unavailable`（CURRENT と一致） |
| T10 | RH-012 public + `public_api_enabled = 1` + artifact | 200。body の byte・Cache-Control・ETag が一致。Hono の D1 は 1 文 |
| T11 | RH-012 private / `public_api_enabled = 0` / 存在しない id / 129 文字 / 不正な `%` | 404 `public, max-age=60` が一致 |
| T12 | RH-012 artifact なし | CURRENT は 503 `public_data_reflecting`（行 1 + wake 1）、Hono は 503 `public_data_unavailable`（行 0・wake 0）。`DOCUMENTED DIFFERENCE L3` |
| T13 | RH-012 artifact の `event.id` が別 | 両者 503 `public_data_unavailable` |
| T14 | RH-012 × guard mode（enforce で event が block = 再公開中の fence / manifest なし、observe で block、off） | enforce は 404 / 503 で一致、observe と off は 200 で一致 |
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
- **Readiness:** NEEDS_REFINEMENT — MIG-0606 の harness と同時期。応答が 64KB を超える見込みのため D-12 の例外手続きで精緻化してから
- **Recipe:** R-API
- **Runtime:** S2
- **Depends on:** MIG-0614, MIG-0606 / **Decisions:** D-10 DECIDED, D-12 DECIDED
- **Verified against:** `2b4504c2` (2026-10-24)
#### Source snapshot
- `eventExportData` / `eventExportPayload` / `eventExportCache`（約 1100 行）は D1 読み + publicCache R2 + isolate micro-cache。loader（RH-012 / RH-015）には依存しないので MIG-0631 とは独立。
- CORS・format / v5・refresh minutes の契約を維持する。
#### Owned paths
- 新規: `+apps/api/src/routes/events/export.ts`, `+apps/api/test/eventExport.parity.test.mjs`
- 触らない: `app/**`, `src/lib/**`
#### Micro-units
- **U01 inventory**: 応答 size、D1 statement 数、cache の層を表にする。64KB 超は D-12 の「記録した例外」型で扱う。
- **U02 route**: D1 読み + publicCache R2。
- **U03 parity**: CURRENT と Hono を比べる。MIG-0606 の上限入力で max CPU を測る。
#### Test cases
| ID | 入力/操作 | 期待 |
| --- | --- | --- |
| T01 | 正常系 | CURRENT と応答が byte 一致 |
| T02 | CORS / format / refresh minutes | CURRENT と同じ |
| T03 | 上限入力 | warm max CPU を記録（7ms 未満か、超えたら additive paging を追加 unit にする） |
#### Commands
```bash
npm run build --workspace=@flamenode/api
node --test apps/api/test/eventExport.parity.test.mjs
npm run typecheck
npm run test:unit
```
#### Ledger updates
`API_MATRIX.md` の RH-013 に Hono エンドポイント。
#### DONE checklist
- [ ] RH-013 の応答が CURRENT と一致
- [ ] 64KB 超の扱いを「記録した例外」として残し、MIG-0606 で測った
- [ ] 本番 Route を変更していない
#### STOP
- 応答契約を変える改善が必要になったら止める（D-12）。
- 本番 Worker・Route・secret・Remote D1 の操作は明示承認が出るまで止める。
#### Rollback
PRをrevert（Hono route を足すだけで、本番 Route・D1・secret の変更は無い）。

### MIG-0633: event ownership / permission resolver core（D-10 R-CORE）
- **Model:** lead
- **Readiness:** NEEDS_REFINEMENT — MIG-0617 が DONE になった後に READY。Sonnet 不可（最後の owner を外せない不変条件を含むため lead）
- **Recipe:** R-CORE
- **Runtime:** S3
- **Depends on:** MIG-0613, MIG-0617 / **Decisions:** D-10 DECIDED
- **Verified against:** `2b4504c2` (2026-10-24)
#### Source snapshot
- 対象: `src/lib/auth/ownership.ts` と permissions resolver、`src/lib/event/eventOwnership.ts`（`remainingOperableEventOwnerSql` の owner 0 guard）。
- 境界のある純粋部分だけを `packages/server-core/src/event/ownership` に移し、Next 側は bridge の re-export にする（呼び出し側の変更 0）。
- MIG-0604 U04（SA-023/024/031..034/038/039/056..068 の非 admin 権限と owner 0 guard）の前提。FIX-0604-1（lead 追跡の follow-up、MIG id ではない）の前提でもある。
#### Owned paths
- 新規: `+packages/server-core/src/event/ownership/**`
- 変更: `src/lib/auth/ownership.ts`, `src/lib/event/eventOwnership.ts`（bridge 化）, `packages/server-core/package.json`（exports）
- 触らない: `app/**`, `src/lib/actions/**`
#### Micro-units
- **U01 golden**: 移動前の tree で resolver と owner 0 guard の golden を書く。
- **U02 move**: core へ移し、bridge の 1 行目に `// Compatibility bridge (MIG-0633, D-10): ...` を書く。
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
node scripts/check-server-core-boundaries.mjs
npm run test:critical
```
#### Ledger updates
`FILE_MIGRATION_MATRIX.md` に core の新規行。
#### DONE checklist
- [ ] golden の diff 0、既存 test の件数同一、呼び出し側の diff 0
- [ ] 最後の owner の解任が core test で拒否される
- [ ] FIX-0604-1 の前提として MIG-0604 の担当に伝えた
#### STOP
- owner 0 guard の SQL が 1 文字でも変わるなら止める。
- DB / migration / 権限緩和は上位へ。
#### Rollback
PRをrevert（bridge が元の `src/lib` 実装に戻る。DB・Route・secret の変更は無い）。

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
- **Depends on:** MIG-0606, MIG-0631, MIG-0632 / **Decisions:** none
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
