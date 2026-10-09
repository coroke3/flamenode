# Implementation cards: Phase 8 / 9 — Auth compatibility and Next.js retirement

> Status: Active / 12 executable MIG cards
> Contracts: [Auth baseline](auth/README.md), [Phase8/9 SPEC](PHASE_8_9_SPEC.md), [Git approval policy](GIT_WORKFLOW.md), [Routing plan](ROUTING_AND_DEPLOY_PLAN.md), [migration STATUS](STATUS.md)
> D-07=A: keep Auth.js / @auth/core / D1 database session. **Never invent custom OAuth, new credentials, cookie naming or token protocol.**

## Phase 8: Auth.js compatibility

認証/旧Next撤去の各MIGは`FILE_MIGRATION_MATRIX.md`の旧→新Provider/consumerと切替承認証拠を同一PRへ残す。legacy pathがまだ存在する時は`RETIRED`にせず、Session互換やCloudflare実測無しに`CUTOVER`へ進めない。

### MIG-0801 — baseline fixtures for sessions and account linking

- 読む: `auth/README.md`, `src/lib/auth/`のCURRENT実装+tests、Auth.js `user`/`account`/`session`テーブル、`app/api/auth/[...nextauth]/route.ts`。
- 変更: 非本番固定fixturesを用意し、Discordのlogin/callback/logout、existing session resume、banned/role/owner、X linking/merge/edit mode、CSRF、cookie attributesをcharacterization testsにする。実token/secretはfixtureへ入れない。
- 試験: valid/expired/revoked session, duplicate Discord accounts, unknown user, banned, 0X/multiX, wrong host/callback/query。
- DONE: 旧Nextの挙動・cookie名・table schema・CSRF/statesがbaselineテストで再実行可能。

### MIG-0802 — Hono @auth/core PoC

- 読む: Phase8 spec, auth config/adapter/CSRF/callback code、`apps/api/src/index.ts`、MIG-0801 fixtures。
- 変更: Honoの薄いWeb Request/Response adapterから`@auth/core`を利用。**既存D1 session lookup + cookie名/属性とDiscord OAuth provider契約**を優先。Auth Userは認証、Active Xは活動主体として分離。app内で独自OAuth code exchangeを作らない。
- 試験: 旧Next発行cookie→Hono読取、Hono発行cookie→旧Next読取、logout両方向、session refresh/expiry、PKCE/CSRF、redirect/callback origin、複数X/権限/禁止user。
- DONE: 双方の非本番runtimeを同じsessionで相互利用し、既存ログインを強制無効化しない。PoCに失敗した場合はAuth切替をBLOCKEDとして旧Workerを維持。

### MIG-0803 — Discord + account-linking transaction parity

- 読む: `auth/README.md`, `src/lib/auth/`のlink Discord atomically実装/テスト、x link requests、role/permission。
- 変更: provider callbackのuser/account reconciliation・CAS、transaction boundaries、X owner/manager linkingとapproval statusを新Auth adapterから同等に呼べるようにする。エラーは安全な結果型へ。
- 試験: concurrent login/link, existing account belongs to another user, invalid state token, callback replay, cancelled approval, banned/ToS pending。
- DONE: account重複/乗っ取りを防ぐ旧/新双方向同等テストとaudit records、secret leakage 0。

### MIG-0804 — Auth CPU/permission/security review

- 読む: `cloudflare/PERFORMANCE_BASELINE.md`, `auth/README.md`, D1 adapter/cookie/CSRF/permissions baseline, security E2E。
- 変更: request hot pathのD1 queries/CPU減らす。Cacheにsession secretや認可resultを混在させない。callbackでのopen redirect防止、per-request context、audit。
- 試験: cookie tamper, expiry, CSRF, wrong host, revoked/BAN immediate effect, SSRF redirect, D1 failure fail-closed, CPU p95<9msとtail measurement、1102=0。
- DONE: security checklist/実測値/情報漏洩テストとレビューがそろい、未解決の高リスク差分なし。

### MIG-0805 — proposed production auth cutover (NO automatic operation)

- 読む: `ROUTING_AND_DEPLOY_PLAN.md`, current Cloudflare/Discord config（秘密は表示しない）、Auth Session baseline and production monitoring。
- 変更: **手順書のみ**。before→during→afterの`/api/auth/*`と`/auth/complete` path切替、Cookie/session continuity、D1 binding、Discord callback URL=同一origin、元Workerへのtraffic rollbackを記録。
- 試験: 同一hostnameの非本番E2E、failed rollback rehearsal、sign-in/out/browser session、resource budget。
- DONE: cutover proposal + risk/approver/monitor thresholds/evidence。**本番Route/Discord設定変更は別途明示承認なしで実行禁止**。

### MIG-0806 — Phase 8 Gate

- 読む: 0801..0805 merged PR, RH-010/011 route matrix, Auth User identity, session/CSRF results。
- 変更: auth/cookie/session/OAuth/permission/Active X/callback/Logout全契約の証跡をPhase Gateにまとめる。
- 試験: legacy-to-Hono session continuity, both SPA paths same-origin, no forced relogin, per-role constraints, Auth CPU tail + 1102。
- DONE: 独立review+人間Phase Gate承認。実際の本番切替結果は操作と分離して記録し、未実施なら本番稼働済みと書かない。

## Phase 9: keep rollback until observed stable

### MIG-0901 — evidence-based residual dependency inventory

- 読む: `CURRENT_ROUTES.md`, `ROUTE_MATRIX.md`, `API_MATRIX.md`, RH/SA ledgers, actual Worker request metrics, Cloudflare route ownership。
- 変更: 全path/methodの新ownerと旧Next残存利用、asset URL/cron/Queue/auth callback、unknown 404をリスト化。非本番から根拠無しに「旧リクエスト0」と言わない。
- 試験: real request logs in observation window, default route fallback cases, robots/sitemap, admin private/API, `/_next/*` accesses。
- DONE: undocumented legacy usages=0であり、本番traffic切替はすでに承認・実行済みの証跡が存在する。

### MIG-0902 — rollback/stability observation window

- 読む: previous cutover approval, `ROUTING_AND_DEPLOY_PLAN.md`, incident metrics, Active X reconcile/late writes。
- 変更: 観測開始終了と指標・責任者・CI/Route/D1 backup/rollback可能な旧deploy versionを記録。最低7日を候補とし、実観測のある期間だけカウント。
- 試験: old/live user sessions, 404/403/500, latency/cpu/1102, stale privacy, Queue backlog, aggregate counts, emergency routing + X rollback drill。
- DONE: 期間中の未解決severity高障害なし、rollback手順演習成功。非本番の経過時間で本番の観測を偽らない。

### MIG-0903 — remove legacy actions/handlers (only after stable)

- 読む: `src/lib/actions/`, `app/api/`, all RH/SA ledger rows, plugin/cron/CLI imports, authorized rollback version。
- 変更: new codeと同一契約を持つ旧Server Action/Route handlerだけを段階削除。互換URL/cache/error/redirectが残る場合はbridgeを保持。unrelated auth/audit/worker logicを削除しない。
- 試験: static import graph, unit/integration/worker tests, public/private E2E, all RH/SA method ownership and no broken imports。
- DONE: 旧Nextにしか存在しない機能が0件、退役対象列挙と確実なrevert方法がありCI成功。

### MIG-0904 — remove Next/OpenNext build and deploy path

- 読む: `package.json`, `wrangler.toml`, `workers/*/wrangler.toml`, `scripts/cloudflare-production.mjs`等のbuild/deploy chainとcurrent production metrics。
- 変更: new Astro/Personal/Ops/API独立デプロイ確認後、Next dependencies/old deploy scriptsを削除する。共有Cloudflare worker/Queue/job scriptを巻き込まない。lockfileをnpm ciで更新。
- 試験: all workspace builds, imports, CI/test/unit/integration, Wrangler compatible config, cost/CPU/visibility, rollback-old-worker archive。
- DONE: build/deploy paths全件新runtimeへ向き、legacy Workerを停止してもPVSF user operationsが落ちない証拠。

### MIG-0905 — final docs, UX/FN parity, operations

- 読む: 全migration PR, `FEATURE_CATALOG.md`, `FRONTEND_FEATURES.md`, `FUNCTION_INVENTORY.md`, `CURRENT_ROUTES.md`, `OPEN_DECISIONS.md`。
- 変更: CURRENT/TARGET labelingを現構成に再統合し、破棄した旧設計の参照を剥がす。runbook、failure recovery、SLO、DB schema/deploy、X link/owner、Static Assets/SSR例外を運用に反映。
- 試験: docs link/CI/checker、432 UX/136 FNの全ID disposition、Auth/Queue/R2/D1/Cloudflare docsと実環境一致。
- DONE: 未来のagentが「既に廃止したNext」をCURRENTと誤認しない、所有者/操作手順が明示される。

### MIG-0906 — final approval gate

- 読む: 0901..0905 PRと実観測期間、作成/廃止されたWorker一覧、D1/Active X reconciliation。
- 変更: 最終監査・移行証跡（新旧差/UX+FN/full route+API/invariants/incident/rollback）を記録しSTATUSを完成へ。
- 試験: user/owner/admin all permissions, public privacy, SSG+R2, no unverified SSR, Auth.js session, worker CPU+1102, domain/DB schema, Queue and OAuth across prod。
- DONE: **人間による最終移行完了承認**まで`DONE`にしない。missing evidence→BLOCKED with exact owner and next action; no extrapolation.
