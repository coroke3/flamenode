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

### MIG-0602 — low-risk write commands

- 読む: SA-004..008（announcements / API endpoints。SA-009..010 は MIG-0629、SA-011 は MIG-0616、SA-035..037 は MIG-0604、SA-016..020 は MIG-0605 の所有）, CURRENT actions, `src/lib/audit/mutate.ts`, `API_MATRIX.md`。
- 変更: Hono Zod input検証、session userのpolicy判定、D1 write transaction + audit outboxを同一業務サービスへ委譲。新APIだけのvalidationを作って旧Nextと意味を分けない。
- 試験: unauthorized/forbidden/banned、invalid body、CAS lost update、audit write failure→rollback、post-commit queue exactly-once-ish/idempotent retry、same-origin check。
- DONE: SA unitごとに同一requestで旧/新statusとDB副作用・監査・Queue結果が一致。

### MIG-0603 — video read/overlay/edit/chapters

- 読む: RH-030..032、SA-001..003/012..015/040..042/082..089と実actions、`auth/README.md` privilege-mode + D-03 rules。
- 変更: `GET /api/videos`, `/:id`, `/:id/viewer-overlay`を現行URLに保ち、writeは各Action相当の狭いcommandへ。公開summaryとprivate viewer overlayを別DTO/cacheにする。Active X主体の選択は1件、既存fan-outは別backfill。
- 試験: normal/event/admin permissionの相互混入拒否、owner+collab+staff、chapterコメント残存、visibility revoke→stale static deny、like race/duplicate、rebuild Queue post-commit。
- DONE: RH-030/031/032と該当SA/UX/FNのbefore-after matrixおよび403/404の漏洩防止を実証。

### MIG-0604 — event / slot APIs

- 読む: RH-012..015, RH-020..022, SA-021..039, SA-056..068, `background-jobs/README.md`, `CURRENT_ROUTES.md`。
- 変更: event list/live viewer/slotted mutations/playlist/owner commandsを型付きサービスへ移行。対象RH-012,013 external export契約・version/format/legacy/CORSも取りこぼさない。slot owner/CAS/予約人数制限はDB transactionで強制。
- 試験: schedule full/empty/expired, double reservation, removing last operable owner forbidden, public/private event on live endpoint, export v5+legacy, replay/notify/outbox/error retry。
- DONE: RH-012..015/020..022・対象SAの仕様/CPU/Queue/permission parity。高リスク操作は独立レビュー。

### MIG-0605 — Auth User / Active X / Admin / remaining RH

- 読む: RH-001..009,016,019,023..025,027..028,033とSA-016..020/043..055/069..081/090..106、`ACTIVE_X_MIGRATION_PLAN.md`, `auth/README.md`。
- 変更: account summary, admin spreadsheet, signed/private media, CORS OPTIONS, public event staff, thumbnail proxy, X/account link/merge, moderation, notification, cost guardなどの**各契約**を漏れなく移行。RH番号で漏れを管理。D-03 fan-outは承認済み全owner-X、D-04一括切替のdry-runと運用別PRを分離。
- 試験: every RH method/CORS/SSRF/header/cache, row-level admin/spreadsheet auth, X owner vs manager, session identity, merge+revert atomicity, 0X/multiX/duplicate, audit/notification/rebuild, public DTO allowlist。
- DONE: 書き込み元と共有Xの重複件数を検証、対象RH/SAに「旧コード不要」と断言する前に全シナリオがE2E合格。本番backfill実行しない。

### MIG-0606 — API CPU/security budgets

- 読む: `cloudflare/PERFORMANCE_BASELINE.md`, `scripts/cloudflare-verify-fast.mjs`, runtime trace, route request inventory。
- 変更: ステージ環境でメソッド別p50/p95/p99/request count/wall+CPU/D1 rows_read/read_bytesを書き出す測定スクリプト・fixtureを整備。CPU heavy処理をQueue移譲、SQL bound/index見直し。
- 試験: large pagination/invalid input/rate limit/banned, D1 unavailable, R2/cache cold/miss, concurrent writes。Free 10ms/request前提でmutation p95<8ms/read p95<5ms目標（実際の1102=0を別監視）。
- DONE: すべての公開/private endpointのCPUの実測・最大ケース・修正とerror rate、閾値逸脱時のBLOCKED理由を記録。

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

- 読む: `PHASE_6_SPEC.md` の MIG-0616 Work Order、audit の restore.ts。
- 変更: restore.ts を core へ、旧 file は bridge。
- 試験: golden（strategy 別、CAS 競合、YouTube eligibility）。
- DONE: golden の diff 0。

### MIG-0617 — replace apps/api Option A copy (D-10)

- 読む: `PHASE_6_SPEC.md` の MIG-0617 Work Order、MIG-0602 の `apps/api` 実装。
- 変更: 監査・wake の写しを core の呼び出しに置き換えて削除。fake D1 に `.raw()`。
- 試験: MIG-0602 の既存 test、写しと core の SQL + params の一致。
- DONE: 写しの呼び出しが 0。

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

- 読む: `PHASE_6_SPEC.md` の MIG-0620 Work Order、`public/_headers`、`apps/site/src/gateway/routeShards.ts`。
- 変更: 新 Worker の `_headers`（`/_astro` `/_personal_assets` `/_ops_assets` `/brand`）。
- 試験: prefix ごとの Cache-Control、HTML が immutable にならないこと。
- DONE: 全 prefix が表と一致。

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
- 変更: 5ルートの読み取り endpoint と DTO。
- 試験: 実 loader と Hono の parity（`node:sqlite`）、失敗時の同一性、D1 3文以下、private no-store。
- DONE: 5ルートすべてで parity PASS。

### MIG-0624 — Manage page read APIs

- 読む: `PHASE_6_SPEC.md` の MIG-0624 Work Order、`app/(manage)/manage/**`、MIG-0611 の実装。
- 変更: Manage 12ルートの読み取り endpoint と DTO、API 側の権限確認。
- 試験: 実 loader と Hono の parity、route × role、D1 3文以下。
- DONE: 12ルートの parity と権限が PASS。

### MIG-0625 — Admin read APIs part A

- 読む: `PHASE_6_SPEC.md` の MIG-0625 Work Order、`app/(admin)/admin/**`（users / videos / events / moderation）、MIG-0611 の実装。
- 変更: 対象 page の読み取り endpoint と DTO、admin 権限。
- 試験: 実 loader と Hono の parity、admin 以外の拒否、D1 3文以下。
- DONE: 担当範囲の parity PASS、MIG-0626 との分担に漏れが無い。

### MIG-0626 — Admin read APIs part B

- 読む: `PHASE_6_SPEC.md` の MIG-0626 Work Order、MIG-0625 の分担表、`app/(admin)/admin/**` の残り。
- 変更: settings / audit / ops / 残りの読み取り endpoint と DTO。
- 試験: Admin 45 の網羅、parity、admin 以外の拒否、外部診断失敗の劣化。
- DONE: Admin 45 の全 page に read endpoint がある。

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

- 読む: SA-009..010（`src/lib/actions/audit-admin.ts`）, `mutate.ts`, `API_MATRIX.md`, `work-items/MIG-0602.md` Decision（MIG-0602 の分割）。
- 変更: MIG-0602 の `writeGuardMiddleware` + `costGuardMiddleware` と raw-D1 `mutateWithAudit` を再利用し、SA-009 を strict 監査 1 batch で、SA-010 を既定の admin read guard 下の読み取りで実装。
- 試験: 別 origin、非 admin、設定更新の監査が CURRENT と byte 一致、dry run の書き込み 0、CAS/競合。
- DONE: SA-009/010 の旧/新 status・DB 副作用・監査が一致。SA-011 は MIG-0616 で個別実装。

### MIG-0607 — Phase 6 API Gate

- 読む: RH-001..033全method、`API_MATRIX.md`, SA-001..110相当契約、0601..0606のPR。
- 変更: RH行ごとに担当Hono/旧Auth/legacy fallbackと契約実行ログを列挙。Auth.js RH-010/011の2メソッドはPhase8へ残す。その他31メソッドは移行先とtest evidenceが必要。
- 試験: 旧Next→新HonoのE2E, same-origin auth, method OPTIONS, authn/authz, no1121/1102, DTO, cache/Queue/media/CSRF, CPU。
- DONE: 独立reviewと人間Gate承認後のみPhase 7/8関係タスクを更新。未移行を0と偽らない。

## Private SPA common constraints (D-05)

**Personal SPA = `apps/app`: `/dashboard`, `/entry`, `/onboarding`, `/_personal_assets/*`. Ops SPA = `+apps/ops` at MIG-0704: `/manage`, `/admin`, `/_ops_assets/*`.** CSS/JS chunks別、Cookie同一origin、認可はHono+旧Authと一致。現在`apps/ops`は未作成なのでビルド成功を要求するのはMIG-0704以降だけ。cross-SPA遷移は通常HTTP navigation。UIはCURRENT見た目を踏襲（公開HTMLの新visualをprivateへ無理に適用しない）。

### MIG-0701 — Personal dashboard GET screens

- 読む: `CURRENT_ROUTES.md` Personal 6、`frontend/AUTH_PERSONAL_ENTRY.md`、`screen-mapping/README.md`、`apps/app/src/{App,main}.tsx`。
- 変更: `apps/app`のroot Routerに`/dashboard`, `/dashboard/library`, `/dashboard/settings`, `/dashboard/youtube-playlists`と旧リダイレクトを実装。認証loading/banned/not linked state、Hono read DTO、React Query採用時は限定scopeキャッシュ。
- 試験: 0X/1X/multiX, Active X library表示、Discord logged out/role changes, direct reload/back/forward, private cache no-store, `/_personal_assets/*`。
- DONE: Personal 6 route mapping、担当UX/FNと既存仕様の全stateが確認済み。

### MIG-0702 — Personal dashboard mutations

- 読む: SA-098..105, active-X link modal flow, `ACTIVE_X_MIGRATION_PLAN.md`, mutation status/error semantics。
- 変更: profile settings, selected Active X, account link, like/bookmark command等をHono APIと接続。未連携の場合はモーダルで登録/承認の導線を提供、元のAuth User履歴は保持。
- 試験: duplicate submit, approval pending, revoked link, manager-only, 0X, multiX, D-03の履歴fan-out結果、D-04の一斉cutover/負荷/ロールバック。通知の`既読化`はCURRENTで未実装のため勝手に新規追加しない（参照契約の状態を調べる）。
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
