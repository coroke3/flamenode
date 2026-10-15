# FlameNode Phase 6 タスク仕様書（Hono API Spec）

> 状態: Active / Phase 6 実行向け仕様書
> 最終検証: 2026-10-09（`route-handlers/README.md` の RH-001〜RH-033 および `API_MATRIX.md` に基づき改定）
> 対象モデル: Claude / Codex / Antigravity / GPT-5.6-luna / Gemini Flash 等の全エージェント
> 関連ドキュメント: [`README.md`](README.md), [`STATUS.md`](STATUS.md), [`API_MATRIX.md`](API_MATRIX.md), [`route-handlers/README.md`](route-handlers/README.md), [`CODE_QUALITY.md`](CODE_QUALITY.md), [`OPEN_DECISIONS.md`](OPEN_DECISIONS.md) (D-01, D-02)
> **タスク正本:** 個別タスクの実行指示（読む・変える・試す・DONE条件）の正本は [`TASK_CARDS_6_7.md`](TASK_CARDS_6_7.md) です。`npm run migration:next` がその内容を自動抽出します。本仕様書はPhase 6全体のアーキテクチャ背景と設計意図を補足します。

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
- 変更: `apps/api/src/index.ts`（route 登録のみ）
- 触らない: `app/api/**`（本番切替まで旧実装を維持）
#### Micro-units
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
#### STOP
- 認証が必要になったら止める（MIG-0608 の後）。
- 本番 Route の変更が必要に見えたら止める。
#### Rollback
Phase 6 共通契約のとおり。

### MIG-0608: Hono read-only session resolution（Auth.js database session 互換）
- **Model:** lead
- **Readiness:** NEEDS_REFINEMENT — MIG-0801 の baseline テスト（cookie 名・属性・期限・失効）が入ってから。高リスク（認証）なので小型モデルに渡さない
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
- **Depends on:** MIG-0603, MIG-0604, MIG-0605 / **Decisions:** D-06 DECIDED
- **Verified against:** `aacf4fd` (2026-10-15)
#### Source snapshot
- 予算: 単純 read p95 < 5ms、mutation p95 < 8ms、上限 10ms（Free）。基準は `cloudflare/PERFORMANCE_BASELINE.md`。
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
- [ ] 31メソッドの測定値と条件が記録されている
- [ ] 測定値を本番値と書いていない
#### STOP
- 予算超過を直すためにエンドポイントを書き換え始めたら止める（担当MIGへ）。
#### Rollback
PRをrevert。

### MIG-0607: Phase 6 Gate
- **Model:** lead
- **Readiness:** NEEDS_REFINEMENT — Phase Gate はエージェントが自動承認しない
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
- [ ] 独立レビューの APPROVE と人間の Phase Gate 承認
#### STOP
- 人間の承認なしに STATUS を DONE にしない。
- Auth.js を Hono へ移したと記録しない。
#### Rollback
Gate のPRをrevert。
