# Implementation cards: Phase 6 / 7 — Hono APIs and dual private SPAs

> Status: Active / 14 executable MIG cards
> Authoritative inventories: [RH method ledger](route-handlers/README.md), [SA execution units](server-actions/README.md), [UX/FN](FEATURE_CATALOG.md), [permissions baseline](auth/README.md), [Active X migration](ACTIVE_X_MIGRATION_PLAN.md)
> Migrations do NOT replace system behavior: Transport(Hono) → typed DTO/authz → domain policy → D1 adapter/transaction + post-commit effects.
> Work Order: 実装手順の正本は各Phase仕様書の `### MIG-XXXX:` 節（Model / Readiness付き）。このカードは要約。小型モデルは `Model: small` かつ `READY_FOR_SMALL_MODEL` のWork Orderだけを実行する（[IMPLEMENTATION_RUNBOOK.md](IMPLEMENTATION_RUNBOOK.md)）。

## Common acceptance for each RH-*/SA-* endpoint

**現コードの注意:** `apps/api/src/index.ts` の `GET /health` はPoC skeleton。既存NextのRH-018は `GET /api/health`。Cloudflare入口のpath routingを決める前に、HTTP method/URL/DTO/status/auth/cacheが一致すると判断しない。実際の非本番Workerとブラウザから試験する。

`FILE_MIGRATION_MATRIX.md`で各旧Route Handler/Server Actionと新Hono/SPAのファイル接続を追跡する。33 RHメソッドと110 SAは`route-handlers`/`server-actions` ledgerのIDに紐付ける。2 SPAのバンドルとroot path・assetは別行で管理し、未作成の`apps/ops`を完成扱いにしない。

Before writing code, capture one row for every impacted RH/SA (actual current source method, URL+method/Action signature, viewer/owner/admin permission, input validation, success+error JSON/status, cache/headers/CORS, rate limit, D1 reads/writes, audit, queue wake, retry and tests). After migration, test the **same row with old and new handlers**. Never treat an endpoint as complete just because its handler file exists. For all 33 RH methods, keep RH-010/011 Auth.js on legacy Next until Phase 8 and route only completed Hono paths, not catch-all `/api/*`. Permissions and owner count are always enforced server-side.

## Hono migration cards

### MIG-0601 — bounded low-risk GET

- 読む: `route-handlers/README.md` RH-017,018,026,029; `app/api/health/route.ts`, `app/api/health/deep/route.ts`, CURRENT about-stats, software suggestion handlers; `apps/api/src/index.ts`。
- 変更: HonoのURL+HTTP methodをCURRENTに合わせ、DTO/status/Cache-Control/ETagを固定。deep healthはWORKER_ADMIN_TOKENを必要とし、公開healthは内部情報を返さない。情報取得はR2-firstとbounded D1 fallback。
- 試験: success/401/403/404/503、missing token/invalid token、stale R2、quota/CPU、production secretがresponse/traceに無い。
- DONE: RH-017/018/026/029の契約比較テストをPR記録、旧Handlerはまだ削除しない。

### MIG-0608 — Hono read-only session resolution

- 読む: `src/lib/auth/index.ts`（`session: { strategy: "database" }`）, `src/lib/auth/{currentUser,session,requestAuthContext}.ts`, `src/lib/db/schema.base.ts` の `session`/`user`, MIG-0801 baseline fixtures。
- 変更: `+apps/api/src/auth/session.ts` に cookie → D1 `session` → `user` の読み取り専用解決と Hono middleware を追加。cookie の発行・更新・削除、login/callback/logout（RH-010/011）は Phase 8 まで旧 Next のまま。
- 試験: 旧Next発行cookieで同一利用者、期限切れ/削除済み/改ざん/BAN、sessionTokenがログに出ないこと、request単位の解決（module global無し）。
- DONE: MIG-0602以降の認証付きHono APIが旧Nextのsessionを読める証跡と独立レビュー。独自token/署名を作っていない。

### MIG-0611 — Personal read APIs

- 読む: `PHASE_6_SPEC.md` の MIG-0611 Work Order、`app/(auth)/{dashboard,dashboard/library,dashboard/settings,onboarding}/page.tsx`, `src/lib/auth/{currentUser,onboarding,resolveActiveXId}.ts`。
- 変更: `+apps/api/src/routes/personal/*` に `/api/personal/{session,dashboard,library,settings,onboarding}` の GET を追加。全応答 `Cache-Control: private, no-store`、GET 中の書き込みなし。DTO は `+packages/contracts/src/personal/*`。
- 試験: CURRENT の loader と同じ seed（node:sqlite + 全 migration）で行・順序・件数が一致、401/403/no-store、paging、D1 statement 数。
- DONE: 5 endpoint の parity テストと独立レビュー。`maybeMarkOnboardingComplete` は MIG-0702 の POST へ引き継ぎ。

### MIG-0602 — low-risk write commands

- 読む: SA-004..008（announcements / API endpoints。SA-009..010 は MIG-0629、SA-011 は MIG-0616、SA-035..037 は MIG-0604、SA-016..020 は MIG-0605 の所有）, CURRENT actions, `src/lib/audit/mutate.ts`, `API_MATRIX.md`。
- 変更: Hono Zod input検証、session userのpolicy判定、D1 write transaction + audit outboxを同一業務サービスへ委譲。新APIだけのvalidationを作って旧Nextと意味を分けない。
- 試験: unauthorized/forbidden/banned、invalid body、CAS lost update、audit write failure→rollback、post-commit queue exactly-once-ish/idempotent retry、same-origin check。
- DONE: SA unitごとに同一requestで旧/新statusとDB副作用・監査・Queue結果が一致。

### MIG-0603 — video read/overlay/edit/chapters
- 読む: `PHASE_6_SPEC.md` の MIG-0603 Work Order（D-13-40〜66）、SA-001..003/043/044/040..042/082..089 の実 action、core `visibility/videoTransition.ts`。
- 変更: U02a Hono 可視性 host、U02b admin 可視性 + moderation、U03a いいね。U02c / U03b / U03c は MIG-0633 の後。RH-031/032 は MIG-0634。
- 試験: 権限の相互混入拒否、公開→非公開の fence と補償、voided の case、いいねの競合、wake 0 の記録した差。
- DONE: 全 unit と Final audit、権限判定の全件一致。

### MIG-0604 — event / slot APIs
- 読む: SA-021..039, SA-056..068、MIG-0633 の core。
- 変更: U04（非 admin の event 権限と owner 0 guard は core を使う）。RH-012/015 は MIG-0631（DONE）、RH-013 は MIG-0632。
- 試験: 最後の owner の解任拒否、同時予約、playlist と post-commit。
- DONE: U04 と Final audit。MIG-0633 DONE まで着手しない。

### MIG-0605 — Auth User / Active X / Admin / remaining RH（親）
- 読む: `PHASE_6_SPEC.md` の MIG-0605 Work Order、D-03 / D-04、`xid-admin.ts`。
- 変更: SA-090/091（MIG-0633 の後）、D-03 fan-out dry-run script、D-04 checkpoint 文書、RH-001..033 の担当表。残りは MIG-0636 / 0637 / 0638（SA-043/044 は MIG-0603）。
- 試験: 権限の無い staff の拒否、dry-run の規則、担当表に空欄なし。
- DONE: 上の unit と Final audit。本番 backfill を実行しない。

### MIG-0606 — API CPU/security budgets
- 読む: `API_CPU_BENCHMARK.md`、`scripts/benchmark-api-cpu.mjs`、各 task の上限入力。
- 変更: `buildScenarios()` に残りのメソッドと上限入力、静かな host で U02。
- 試験: 全メソッドの max、予算超過の担当 MIG。
- DONE: 依存 task 全部の DONE 後に測定値を記録（RH-013 は MIG-0632）。

### MIG-0609 — background job CPU measurement (D-09)

- 読む: `PHASE_6_SPEC.md` の MIG-0609 Work Order、`ZERO_1102.md` §5。
- 変更: `scripts/benchmark-api-cpu.mjs` に Cron / Queue consumer の入口、`+docs/migration/cloudflare/BACKGROUND_CPU.md`。
- 試験: 残る job すべての p50/p95/max（4種類の入力、各 50回以上）。
- DONE: 予算を超える job ごとに、max < 8ms にする上限の計算がある。

### MIG-0610 — split background jobs under 8ms (D-09)

- 読む: `PHASE_6_SPEC.md` の MIG-0610 Work Order、`IMPLEMENTATION_RECIPES.md` R-JOB、`BACKGROUND_CPU.md`。
- 変更: Cron を doorbell の enqueue だけにする、`max_batch_size`、予算を超えた job の `MAX_` 定数と続きの enqueue。
- 試験: 上限ちょうど / 上限 + 1 / 2回目の doorbell / 外部 API の失敗 / Queue の1日の message 数。
- DONE: 全 job の非本番 max < 8ms。遅れが延びる場合はユーザーの承認がある。

### MIG-0612 — shared server core scaffold (D-10)

- 読む: `OPEN_DECISIONS.md` D-10、`IMPLEMENTATION_RECIPES.md` R-CORE、`scripts/check-domain-imports.mjs`。
- 変更: `+packages/server-core`（足場と `src/ports.ts`）、`+scripts/check-server-core-boundaries.mjs`、docs。実装コードは動かさない。
- 試験: fixture の禁止 import / `process.env` / `getCloudflareContext` を検出、domain→server-core の逆依存を検出。
- DONE: 境界検査が CI で動く。`src/lib/**` の diff が 0。

### MIG-0613 — audit mutation core (D-10)

- 読む: `PHASE_6_SPEC.md` の MIG-0613 Work Order、`src/lib/audit/**`、`src/lib/queues/**`。
- 変更: 先に golden test、次に `packages/server-core/src/{audit,queues}/**` へ移動し `src/lib/**` は bridge。`nextPorts.ts` が env / KV / Queue / `waitUntil` を供給。
- 試験: golden（SQL + params + `audit_logs`）の一致、既存 test の件数同一、wake の失敗系。
- DONE: golden の diff 0、呼び出し側の diff 0。

### MIG-0614 — static rebuild / notifications / visibility fence / public cache core (D-10)

- 読む: `PHASE_6_SPEC.md` の MIG-0614 Work Order。
- 変更: `packages/server-core/src/{staticRebuild,notifications,visibility,publicCache}/**`、`src/lib/**` は bridge。`loader.ts` は移さない。
- 試験: golden、R2 / cache の失敗系。
- DONE: golden の diff 0、既存 test の件数同一。

### MIG-0615 — visibility transition planners (D-10)

- 読む: `PHASE_6_SPEC.md` の MIG-0615 Work Order。
- 変更: video / event / xUser の可視性遷移を core へ。`unstable_rethrow` は `RethrowFrameworkControl` で注入。
- 試験: golden（公開↔非公開、補償、post commit）、framework 例外の再 throw。
- DONE: golden の diff 0。

### MIG-0616 — audit restore core (D-10)

- 読む: `PHASE_6_SPEC.md` の MIG-0616 Work Order（lead 決定 1〜4 と Core API）、`src/lib/audit/restore.ts`、harness の手本 `src/lib/serverCore/visibilityTransitionGolden.execution.test.mjs`。
- 変更: restore.ts を `packages/server-core/src/audit/restore.ts` へ（`AuditRestoreHost` = manifest / `VideoPublicCacheKeyHost` / cache delete / export cache / wake loader）、旧 file は bridge。video bridge の key host を `nextVideoPublicCacheKeyHost` に切り出して共有。`nextPorts.ts` と呼び出し側は変えない。
- 試験: 移動前に golden（入口の拒否、期限、capability、strategy 別、競合、events / videos の可視性、YouTube eligibility、CAS rollback と補償、後処理の失敗）。source を読む test 5 件は read 先だけを変える。
- DONE: golden の diff 0、既存 test の件数同一、呼び出し側の diff 0。

### MIG-0617 — replace apps/api Option A copy (D-10)

- 読む: `PHASE_6_SPEC.md` の MIG-0617 Work Order（lead 決定 L1〜L3、2026-10-24）、MIG-0602 の `apps/api` 実装。
- 変更: 監査・wake の写しを core の呼び出しに置き換えて削除。`apps/api` は typecheck のみ（noEmit）、drizzle を middleware で 1 回作る、core の `mutateWithAudit` に optional `preloaded`。fake D1 に `.raw()`。
- 試験: MIG-0602 の既存 test、写しと core の SQL + params の一致、`wrangler deploy --dry-run` の bundle size。
- DONE: 写しの呼び出しが 0、`routes/**` から drizzle の直接 import が 0。

### MIG-0618 — xid merge core (D-10)

- 読む: `PHASE_6_SPEC.md` の MIG-0618 Work Order。
- 変更: X ID merge を core へ。
- 試験: golden（merge の SQL + params、監査行、owner 保護）。
- DONE: golden の diff 0。

### MIG-0619 — edge policy parity in the public gateway

- 読む: `PHASE_6_SPEC.md` の MIG-0619 Work Order、`middleware.ts`、`src/lib/auth/canonicalHostRedirect.ts`、`src/lib/operationMode/middlewareMaintenance.ts`。
- 変更: gateway に canonical host 308 と maintenance redirect（同じ allowlist）、`/maintenance` の静的 page。
- 試験: host × path × query の表、mode × path の表、health 除外、workers.dev 設定、既存 contract test の再利用。
- DONE: 全表が CURRENT middleware と一致し、本番 Route を変更していない。

### MIG-0620 — static asset Cache-Control parity

- 読む: `PHASE_6_SPEC.md` の MIG-0620 Work Order、`work-items/MIG-0620.md` の Table、`public/_headers`。
- 変更: `apps/site/public/_headers`（`/_astro`、favicon、png/webp/svg）、`apps/app/public/_headers`（`/_personal_assets`）。`/_ops_assets` は MIG-0704 U01（D-13-4）。
- 試験: `assetHeaders.test.mjs`（prefix ごとの Cache-Control、HTML が immutable にならない）。
- DONE: PR #351（merge `e8ac0020`）、5/5、Opus APPROVE on `50712610`。

### MIG-0621 — robots.txt and sitemap.xml

- 読む: `PHASE_6_SPEC.md` の MIG-0621 Work Order、`app/robots.ts`、`app/sitemap.ts`。
- 変更: Astro endpoint で robots.txt（byte 一致）と sitemap.xml（公開可視性 manifest から）。
- 試験: robots の byte 比較、sitemap の URL 集合と manifest の一致、静的 entry。
- DONE: 最初の公開 cutover の前に PASS。

### MIG-0622 — ledger completeness checker

- 読む: `PHASE_6_SPEC.md` の MIG-0622 Work Order、`FILE_MIGRATION_MATRIX.md`、`scripts/check-migration-file-progress.mjs`。
- 変更: 行が無い tracked file で CI を落とす検査と、不足行の追加。
- 試験: 行無し file で失敗、除外一覧で成功、現在の main で PASS。
- DONE: G11 の file すべてに行があり、CI に組み込まれている。

### MIG-0623 — Entry page read APIs

- 読む: `PHASE_6_SPEC.md` の MIG-0623 Work Order、`app/(auth)/entry/**`、`app/(manage)/dashboard/edit/[id]/**`、MIG-0611 の実装。
- 変更: `/entry` `/entry/slotted` `/entry/unslotted` の 3 ルートの読み取り endpoint と DTO（`/dashboard/edit/[id]` と `/permissions` は MIG-0630）。
- 試験: 実 loader と Hono の parity（`node:sqlite`）、失敗時の同一性、D1 3文以下、private no-store、LIMIT <= 100 / response <= 64 KiB（paging と byte 上限）。
- DONE: 3ルートで parity PASS。edit 2 ルートは MIG-0630 で DONE にする。

### MIG-0624 — Manage page read APIs

- 読む: `PHASE_6_SPEC.md` の MIG-0624 Work Order、`app/(manage)/manage/**`、MIG-0611 の実装。
- 変更: Manage 12ルートの読み取り endpoint と DTO、API 側の権限確認。
- 試験: 実 loader と Hono の parity、route × role、D1 3文以下。
- DONE: 12ルートの parity と権限が PASS。

### MIG-0625 — Admin read APIs part A
- 読む: `work-items/MIG-0625.md` の U01 表。
- 変更: なし（DONE、範囲を縮小。残りは MIG-0635 / MIG-0604 U04 / MIG-0705）。
- 試験: 済み。
- DONE: 済み。

### MIG-0626 — Admin read APIs part B
- 読む: `PHASE_6_SPEC.md` の MIG-0626 Work Order（D-13-51 / 73 / 80）、`healthChecks.ts`、`integrityChecks.ts`、`deepHealth.ts`。
- 変更: 3 つの check file と deepHealth を server-core へ（bridge）、check id ごとの endpoint、RH-017 の本体。
- 試験: check id ごとの CURRENT 一致、admin 以外の拒否、RH-017 の token と body。
- DONE: Admin 45（MIG-0627 の1面を除く）と RH-017。

### MIG-0627 — R2 artifact consumers to build-time snapshots

- 読む: `PHASE_6_SPEC.md` の MIG-0627 Work Order、`workers/json-generator/**`、`src/lib/publicData/sitemapSources`。
- 変更: R2 artifact の読み手を build 時 snapshot へ、`R2_ARTIFACT_CONSUMERS.md`。
- 試験: `rg` で R2 get key の読み手と producer 一覧の突き合わせ、置き換え後の DTO の同一性。
- DONE: 全 artifact に置き換え先があり、MIG-0907 が参照できる。

### MIG-0628 — new Worker deploy + smoke chain

- 読む: `PHASE_6_SPEC.md` の MIG-0628 Work Order、`wrangler.toml`、`scripts/cloudflare-production.mjs`、`scripts/smoke-cloudflare.mjs`。
- 変更: 新 Worker の `wrangler.toml`、CI の dry-run、smoke list、手順書。
- 試験: Worker ごとの `wrangler deploy --dry-run`、env key の和集合、smoke list の網羅。
- DONE: dry-run が CI で PASS、実 deploy・Route・secret は未実行（明示承認まで停止）。
### MIG-0629 — admin audit settings + restore dry-run APIs
- 読む: `audit-admin.ts`、core `settings.ts` / `restore.ts`、`routes/admin/announcements.ts`。
- 変更: `POST /api/admin/audit/settings`、`POST /api/admin/audit/dry-run`、core `updateAuditLogSettings` の省略可能な `preloaded`。
- 試験: 別 origin、非 admin、監査 byte 一致、dry run の書き込み 0 と host 不使用。
- DONE: SA-009/010 の parity。dry run の 6 文は記録した例外。

### MIG-0630 — Video edit page read APIs (/dashboard/edit/[id] + permissions)

- 読む: `PHASE_6_SPEC.md` の MIG-0630 Work Order、`app/(auth)/dashboard/edit/[id]/**`、MIG-0623 の paging / byte 上限の形。
- 変更: edit 2 ルートの読み取り endpoint と DTO、API 側の所有者 / 共同編集者の権限確認。
- 試験: 実 loader と Hono の parity、他人の作品・存在しない id、D1 3文以下、LIMIT <= 100 / response <= 64 KiB。
- DONE: 2ルートの parity と権限が PASS。

### MIG-0631 — public event list / release from build-time snapshot (RH-015, RH-012)

- 読む: `PHASE_6_SPEC.md` の MIG-0631 Work Order（lead 決定 L1〜L6。Q1 / Q2 は Fable が 2026-10-24 に決定、Q3 は Yugo の明示承認事項）、`app/api/events/route.ts`、`app/api/event-endpoints/[id]/release/route.ts`、`apps/api/src/routes/live/operationMode.ts`。
- 変更: U01 `eventStatusCore` を domain へ、U02 純粋部品 8 file を server-core へ（bridge）、U03 RH-015（live mode は D1 1 文、static_only は R2 artifact、MIG-0617 の後）、U04 RH-012（D1 gate 1 文 + R2 release）。GET は D1 / Queue に書かない。
- 試験: CURRENT の本物の handler との parity（差し替えは `server-only`・`@/lib/cloudflare`・`nextPorts`・`@opennextjs/cloudflare` だけ）、guard mode × artifact 欠損の 503 / 404、rate limit と ETag、viewer-overlay の header が一覧に掛からないこと。
- DONE: T01〜T16 PASS、記録した差（miss で queue 行なし、stale なし）を残す。loader は移植しない。

### MIG-0632 — event export API (RH-013)

- 読む: `PHASE_6_SPEC.md` の MIG-0632 Work Order、`eventExportData` / `eventExportPayload` / `eventExportCache`。
- 変更: RH-013 の Hono route（D1 読み + publicCache R2）。
- 試験: CORS・format / v5 + legacy・refresh minutes の parity、上限入力の max CPU。
- DONE: 応答が CURRENT と一致し、64KB 超を D-12 の記録した例外として残す。

### MIG-0633 — event ownership / permission resolver core
- 読む: `ownership.ts`、`eventOwnership.ts`、`permissionResolver.ts`、`approvedX.ts`、`generalEditPermissions.ts`、`atomicLimits.ts`。
- 変更: pure は domain、drizzle は server-core、src は bridge。
- 試験: golden、最後の owner の解任拒否、既存 test の件数。
- DONE: golden diff 0、呼び出し側 diff 0、利用 task に通知。

### MIG-0607 — Phase 6 API Gate
- 読む: RH-001..033、`API_MATRIX.md`、0601..0606・0611..0638 の PR。
- 変更: RH 行ごとの担当と記録した差の一覧。RH-010/011 は Phase 8。
- 試験: 旧 Next → Hono の E2E、RH-017 の本体（MIG-0626 U07）。
- DONE: 独立 review と人間の Gate 承認後だけ。

### MIG-0634 — public video list + video viewer overlay (RH-031, RH-032)
- 読む: `PHASE_6_SPEC.md` の MIG-0634 Work Order（D-13-46 / 68）、`app/api/videos/route.ts`、`app/api/videos/[id]/viewer-overlay/route.ts`、`apps/api/src/routes/events/publicSnapshot.ts`。
- 変更: video 一覧系の純粋部品を server-core へ（bridge）、`GET /api/videos`、`GET /api/videos/:id/viewer-overlay`。loader は移植しない。
- 試験: 分岐ごとの byte 一致、guard mode、miss の 503（書かない）、overlay の権限と header。
- DONE: T01〜T08 PASS、GET が書かない。

### MIG-0635 — Admin read APIs part C
- 読む: `app/(admin)/admin/videos/[id]/page.tsx`、`.../members/page.tsx`、`users/[id]/edit/page.tsx`、`videoReviewDetail.ts`。
- 変更: 3 endpoint と DTO。icon_url は記録した差（D-13-49）。
- 試験: CURRENT loader と一致、admin 以外の拒否、D1 3 文以下。
- DONE: Admin 45 の担当表に TODO なし（MIG-0627 の1面を除く）。

### MIG-0636 — Personal X / Active X APIs
- 読む: `xid.ts`、G21。
- 変更: SA-098..105 の endpoint、body 上限 middleware（規約同意と onboarding は MIG-0641、D-14-9）。
- 試験: 二重送信、承認待ち X、8 MiB の境界、監査と queue 行の一致。
- DONE: SA-098..105 の parity。MIG-0702 / MIG-0515 が使える。

### MIG-0637 — admin ops writes A (cost guard, user admin)
- 読む: `cost-guard.ts`、`user-admin.ts`。
- 変更: admin router の下に cost guard と user admin の route。queue は同じ batch、wake 0（残りは MIG-0642 / 0643 / 0644、D-14-10）。
- 試験: 各 SA の監査・KV mirror の順序、拒否、CAS 競合。
- DONE: SA-016..020 / 077..081 の parity。

### MIG-0638 — admin spreadsheet writes / import
- 読む: spreadsheet data / import の CURRENT handler、`apps/api/src/routes/admin/spreadsheet/*`。
- 変更: spreadsheet の書き込みと import（残りの RH は MIG-0645〜0648、D-14-11）。
- 試験: 全件 rollback、secret 列・blocklist・owner 保護、監査 byte 一致。
- DONE: RH-004..008 の parity。spreadsheet の Routing は本 task の merge 後。

### MIG-0639 — API CPU benchmark part A
- 読む: `scripts/benchmark-api-cpu.mjs`、`API_CPU_BENCHMARK.md`、`work-items/MIG-0606.md`、D-12。
- 変更: main にある Hono method の scenario と上限入力、Linux run の表。
- 試験: dry-run の self-check、全 method の測定値、BASELINE の noise。
- DONE: D-12（live slots 6000）と MIG-0631 T17 の判定、超過の担当 MIG。

### MIG-0640 — like / bookmark API
- 読む: `src/lib/actions/video/interaction.ts`、`apps/api/src/routes/videos/chapters.ts`、D-13-45。
- 変更: `POST /api/videos/:videoId/interaction`。
- 試験: on / off、Active X 0 件、UNIQUE 競合、拒否。
- DONE: SA-087 の parity、wake 0 の DOCUMENTED DIFFERENCE。

### MIG-0641 — terms acceptance + onboarding APIs
- 読む: `terms.ts`、`onboarding.ts#maybeMarkOnboardingComplete`、`writeOrigin.ts:172-180`。
- 変更: `POST /api/personal/terms/accept`、`/onboarding/terms`、`/onboarding/complete`。
- 試験: `next` の sanitize、未同意の user が呼べる、banned の拒否。
- DONE: SA-074..076 と onboarding complete の parity。

### MIG-0642 — admin ops writes B (terms versions, editable fields, notifications)
- 読む: `rules.ts`、`permissions-admin.ts`、`notification-admin.ts`。
- 変更: admin router の下に3つの route。
- 試験: 監査・queue 行の一致、拒否、CAS 競合、wake 0。
- DONE: SA-045..049 / 051..055 の parity。

### MIG-0643 — admin ops writes C (static rebuild, YouTube resync, visibility repair)
- 読む: `static-rebuild-admin.ts`、`youtube-sync-admin.ts`、`public-visibility-repair.ts`、core `manifestR2.ts`。
- 変更: admin router の下に3つの route。
- 試験: manifest の CAS（fake bucket）、拒否、wake 0。
- DONE: SA-050 / 069..073 / 106 の parity。

### MIG-0644 — admin X merge APIs
- 読む: `xid-merge-admin.ts`、`x-id-merges/page.tsx#run`、core `xid/merge.ts`。
- 変更: `apps/api/src/routes/admin/xidMerges.ts`。
- 試験: merge と revert、100 件超の X、拒否。
- DONE: SA-092..097 / 110 の parity。

### MIG-0645 — legacy import Route Handler
- 読む: `app/api/admin/import/legacy/route.ts`、`src/lib/import/legacy/*`。
- 変更: `apps/api/src/routes/admin/legacyImport.ts`、純粋関数の core 移動。
- 試験: preview → commit、途中失敗の全件 rollback、CPU budget。
- DONE: RH-002 の parity。

### MIG-0646 — media Route Handlers
- 読む: media 3 route と `publicMedia.ts` / `manageXIcon.ts` / `slotSubmissionIcon.ts`、`apps/api/src/routes/media/proxies.ts`。
- 変更: media 3 route。
- 試験: SSRF・path traversal、署名改ざん、503 + `Retry-After: 30`。
- DONE: RH-023..025 の parity。

### MIG-0647 — public event staff Route Handler
- 読む: `app/api/public/events/[id]/staff/route.ts`、`publicEventStaff.ts`、`publicSnapshot.ts`。
- 変更: `apps/api/src/routes/public/eventStaff.ts`、`publicEventStaff.ts` の core 移動。
- 試験: OPTIONS の allowlist、GET の公開 / 非公開 / 欠損、manifest etag の前後比較。
- DONE: RH-027 / 028 の parity。

### MIG-0648 — X-user search Route Handler
- 読む: `app/api/internal/x-users/search/route.ts`、`memberSuggestion*`。
- 変更: `apps/api/src/routes/internal/xUsersSearch.ts`、loader と ranking の core 移動。
- 試験: 未ログイン、短い / 長い query の並び、artifact 欠損。
- DONE: RH-019 の parity。

### MIG-0649 — R2 artifact consumer inventory + CI checker
- 読む: MIG-0627 Work Order、`loadPublicJson` の呼び出し、`workers/json-generator/rebuild.ts` の `putJson`。
- 変更: `R2_ARTIFACT_CONSUMERS.md`、`scripts/check-r2-artifact-consumers.mjs` と test、CI step。
- 試験: 表に無い key で exit 1、template key の正規化。
- DONE: 全 key に producer と置き換え先、CI に入っている。

## Private SPA common constraints (D-05)

**Personal SPA = `apps/app`: `/dashboard`, `/entry`, `/onboarding`, `/_personal_assets/*`. Ops SPA = `+apps/ops` at MIG-0704: `/manage`, `/admin`, `/_ops_assets/*`.** CSS/JS chunks別、Cookie同一origin、認可はHono+旧Authと一致。現在`apps/ops`は未作成なのでビルド成功を要求するのはMIG-0704以降だけ。cross-SPA遷移は通常HTTP navigation。UIはCURRENT見た目を踏襲（公開HTMLの新visualをprivateへ無理に適用しない）。

### MIG-0701 — Personal dashboard GET screens

- 読む: `PHASE_7_SPEC.md` の MIG-0701 Work Order、`work-items/MIG-0701.md`、`app/layout.tsx`、`app/(auth)/layout.tsx`、`src/styles/globals.css:7-10`、4つの CSS module。
- 変更: CURRENT の global CSS 6 file を `apps/app/src/styles/current/` へそのまま copy、4 module を `apps/app/scripts/portCssModule.mjs` で `dash-` / `onb-` / `settings-` / `vcard-` に変換、`main.tsx` に CURRENT と同じ順で import、`index.html` に noindex と theme bootstrap、`router.tsx` に personal surface wrapper、`public/_headers` に HTML の no-store。
- 試験: `apps/app/test/styles.test.mjs`（drift、変換、class の定義、import 順）、`document.test.mjs`（noindex、theme、no-store、wrapper）、既存54件。
- DONE: 5ルートの本文と CSS が CURRENT と一致。header / footer / CostGuardBanner は FIX-0701-1、browser 確認は MIG-0706 の smoke。

### MIG-0702 — Personal dashboard mutations

- 読む: SA-098..105, active-X link modal flow, `ACTIVE_X_MIGRATION_PLAN.md`, mutation status/error semantics。
- 変更: profile settings, selected Active X, account link, like/bookmark command等をHono APIと接続。未連携の場合はモーダルで登録/承認の導線を提供、元のAuth User履歴は保持。
- 試験: duplicate submit, approval pending, revoked link, manager-only, 0X, multiX, D-03の履歴fan-out結果、D-04の一斉cutover/負荷/ロールバック。通知の`既読化`はCURRENTで未実装のため勝手に新規追加しない（参照契約の状態を調べる）。
- 引き継ぎ（MIG-0611）: `/onboarding` 到達時の `maybeMarkOnboardingComplete`（`onboarding_completed_at` の条件付き UPDATE）は GET API が書かないため、明示的な POST として実装する。
- DONE: 既存のprofile/edit/like/notification UXを消さずに旧/新状態を再現。D-04本番切替自体は別承認。

### MIG-0703 — submission / edit / entry routes

- 読む: `CURRENT_ROUTES.md` Entry 3、`/dashboard/edit/[id]`/permissions, SA-086..089, permissions baseline。
- 変更: `/entry`, `/entry/slotted`, `/entry/unslotted`, `/dashboard/edit/:id`, `/dashboard/edit/:id/permissions`をPersonalに入れる。existing form validation、YouTube ID重複停止、枠確保/期限、custom answersとstaff/collab privilegeを保持。
- 試験: slotted/non slotted, already submitted, invalid url, upload/thumbnail/proxy failure, owner/collab/forbidden, edit timeout, back/refresh。
- DONE: form states/actionsとBackend副作用をSA IDごとに照合し、privilege modeの安全性とURL互換を確認。

### MIG-0704 — create Ops SPA + Manage screens

- 読む: `CURRENT_ROUTES.md` Manage 12、`frontend/MANAGE_ADMIN.md`, `packages/ui`, `apps/app/{package.json,vite.config.ts}`。
- 変更手順: (1)`+apps/ops/package.json` (`@flamenode/ops`), `+apps/ops/index.html`, `+apps/ops/tsconfig.json`, `+apps/ops/vite.config.ts` (`base:'/'`, `assetsDir:'_ops_assets'`)。`+apps/ops/src/{main,App}.tsx` Routerとerror boundary。(2)shared UI/contracts importとpackage-lock/npm ci。(3)`+flamenode-ops` Worker/static assets bindingは別MIG/PoCで契約テスト（本番route変更なし）。(4) Manage12画面をCURRENTから移植。
- 試験: `npm run build --workspace=@flamenode/app`, `npm run build --workspace=@flamenode/ops` + CSS/JSに相互混入なし、bare/deep URL/browser back, no session, owner0防止、slot concurrency、staff editing, notification retry。
- DONE: **別build/manifest/bindings** と同一cookie、owner/staff role権限、管理機能12のstate/UX/FNが揃う。

### MIG-0705 — Admin 45 surfaces on Ops SPA

- 読む: `CURRENT_ROUTES.md` Admin 45, `frontend/MANAGE_ADMIN.md`, `route-handlers/README.md`, `server-actions/README.md`, existing admin source/test。
- 変更: `apps/ops`にadmin lazy route chunksを設け、audit/spreadsheet/moderation/merge/health/cost guard/event/video/YouTube/admin operationsを旧UIと等価に移す。dangerous actionsには確認/CSRF/permission/strict audit、発行Tokenをブラウザへ漏らさない。
- 試験: user/admin/moderator/owner/guest permission matrix; table edit/export/import atomicity; audit restore; X merge/revert; Cloudflare worker diagnostics; 403/no-store; CSS/JS bundle isolation。
- DONE: Admin 45 route全件とそれらが所有するUX/FN IDの対応を示し、destructive/privileged operationsは独立レビューに通す。

### MIG-0706 — Phase 7 Gate (2 SPAs)

- 読む: Personal6/Entry3/Manage12/Admin45=66対象routeと`ROUTE_MATRIX.md`, two SPA build outputs, all Phase7 PR。
- 変更: **Personal+Opsの独立entrypoint/build・asset prefix・Worker Route**と同一origin cookie/CSRFを確認したmatrixを追加。
- 試験: `npm run build --workspace=@flamenode/app`, `@flamenode/ops`、direct/deep/root reload、cross-SPA navigation、guest/banned/revoked permission、Hono DTO、response/cache/404、mobile/keyboard、旧Nextフォールバック。
- DONE: all66 routes/related UX/FN parity; no remaining needed legacy SA; split-build CI PASS; independent review and human phase Gate approval. **Missing Ops bundle cannot be marked DONE**.
