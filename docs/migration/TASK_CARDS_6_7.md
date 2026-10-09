# Implementation cards: Phase 6 / 7 — Hono APIs and dual private SPAs

> Status: Active / 13 executable MIG cards
> Authoritative inventories: [RH method ledger](route-handlers/README.md), [SA execution units](server-actions/README.md), [UX/FN](FEATURE_CATALOG.md), [permissions baseline](auth/README.md), [Active X migration](ACTIVE_X_MIGRATION_PLAN.md)
> Migrations do NOT replace system behavior: Transport(Hono) → typed DTO/authz → domain policy → D1 adapter/transaction + post-commit effects.

## Common acceptance for each RH-*/SA-* endpoint

Before writing code, capture one row for every impacted RH/SA (actual current source method, URL+method/Action signature, viewer/owner/admin permission, input validation, success+error JSON/status, cache/headers/CORS, rate limit, D1 reads/writes, audit, queue wake, retry and tests). After migration, test the **same row with old and new handlers**. Never treat an endpoint as complete just because its handler file exists. For all 33 RH methods, keep RH-010/011 Auth.js on legacy Next until Phase 8 and route only completed Hono paths, not catch-all `/api/*`. Permissions and owner count are always enforced server-side.

## Hono migration cards

### MIG-0601 — bounded low-risk GET

- 読む: `route-handlers/README.md` RH-017,018,026,029; `app/api/health/route.ts`, `app/api/health/deep/route.ts`, CURRENT about-stats, software suggestion handlers; `apps/api/src/index.ts`。
- 変更: HonoのURL+HTTP methodをCURRENTに合わせ、DTO/status/Cache-Control/ETagを固定。deep healthはWORKER_ADMIN_TOKENを必要とし、公開healthは内部情報を返さない。情報取得はR2-firstとbounded D1 fallback。
- 試験: success/401/403/404/503、missing token/invalid token、stale R2、quota/CPU、production secretがresponse/traceに無い。
- DONE: RH-017/018/026/029の契約比較テストをPR記録、旧Handlerはまだ削除しない。

### MIG-0602 — low-risk write commands

- 読む: SA-004..008, SA-035..037, announcements/templates/API endpoints CURRENT actions, `src/lib/audit/mutate.ts`, `API_MATRIX.md`。
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
- 試験: `npm run build --workspace=@flamenode/app`, `npm run build --workspace=@flamenode/ops` + CSS/JSに相互混入なし、bare/deep URL/browser back, no session, owner0防止、slot concurrency、staff editing, notification retry।
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
