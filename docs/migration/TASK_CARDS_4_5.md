# Implementation cards: Phase 4 / 5 — Public SSG, Visibility, R2 fallback

> Status: Active / 15 executable MIG cards
> Authority: [STATUS.md](STATUS.md), [PHASE_4_5_SPEC.md](PHASE_4_5_SPEC.md), [ROUTE_MATRIX.md](ROUTE_MATRIX.md), [static-delivery baseline](static-delivery/README.md), [CPU baseline](cloudflare/PERFORMANCE_BASELINE.md)
> Critical: Phase4/5 visual work waits for D-08 approved HTML; nonvisual preflight must be its own dependency-compliant MIG task.

## Every Public task MUST preserve

`FILE_MIGRATION_MATRIX.md` のMIG担当ページ/loader/テスト行を先に確認し、新Astroファイル作成と共にURL/UX/FNおよびvisibility gateway・R2 consumerを同じ行へ記録する。静的生成物だけではファイルの`PARITY_VERIFIED`は付けない。

- CURRENT canonical URL/query/redirect/404/robots/canonical/OGP/thumbnail + pagination.
- `public_visibility_fences`: private/hidden/voided content is fail-closed even when a stale R2/Static Assets HTML exists. No route may leak unpublished metadata.
- Static-first request: no heavy D1, React request render, aggregate, sync, images transform, or build on public GET.
- Failures: stale/missing visibility manifest -> deny/503 per CURRENT; R2 failure -> safe unavailable + queue rebuild, never expose private DTO.
- `frontend/PUBLIC.md`, `screen-mapping/README.md`, relevant `functions/PUBLIC.md` rows need observable parity evidence for every route.

### MIG-0401 — public snapshot loader PoC

- 読む: `apps/site/astro.config.mjs`, `apps/site/src/pages/index.astro`, `static-delivery/README.md`, `src/lib/publicData/loader.ts`（CURRENT read・visibility semantics）。
- 変更: `+apps/site/src/lib/publicDataLoader.ts`をビルド時専用に追加。R2 snapshot/ローカルfixtureから明示DTOを読み込み、hash/世代/欠落/不正JSONのバリデーションを行い、安全なビルド失敗を返す。ビルド時のbindingとHTTPリクエストのbindingを混同しない。
- 試験: 公開fixture1件、private fixture1件、不正snapshot、欠落、世代ずれ。 `npm run build --workspace=@flamenode/site`。試験fixtureを個人情報で作らない。
- DONE: ビルド入出力と失敗時の挙動が再現でき、公開対象のみHTML化。URL cutoverなし。

### MIG-0402 — React Island integration

- 読む: 登録済みHTML reference、`packages/ui/src/adapters/index.tsx`, `UI_MIGRATION_GUIDE.md`、MIG-0206 approved UI。
- 変更: `+apps/site/src/components/IslandWrapper.tsx`等に必要なinteractive fragmentを追加。React AdapterはContext/Providerでrequest/Islandごとに注入、module global mutable setterをSSR共有stateにしない。
- 試験: client:visible/loadの初期HTML+hydration一致、JS無効化時の静的内容、URL/keyboard/focus、hydrate error境界。
- DONE: 登録済みHTMLと一致し、Next.js固有importなし、未移行機能は明示的に旧画面へ委譲。

### MIG-0403 — video / event / user SSG representatives

- 読む: `CURRENT_ROUTES.md`の`/[id]`, `/event/[id]`, `/user/[id]`、`screen-mapping/README.md`、`static-delivery/README.md`、MIG-0401 snapshot types。
- 変更: `+apps/site/src/pages/[id].astro`, `+apps/site/src/pages/event/[id]/index.astro`, `+apps/site/src/pages/user/[id]/index.astro`（実Astroルーティングとの競合を確認）。静的本文/OGPはbuild時生成、操作はIsland。
- 試験: representative 3 x public/private/voided/deleted/alias; metadata/canonical/OGPのCURRENT比較; snapshot公開のみ。
- DONE: 公開3代表URLのHTML・画像alt・metaの比較証拠と保留UX IDsが記録済み。

### MIG-0404 — build route-map generator

- 読む: `ROUTE_MATRIX.md`, `CURRENT_ROUTES.md`, CURRENT alias resolver, static projection manifest。
- 変更: `+apps/site/src/lib/routeMap.ts`等を生成。canonical/aliases/legacy redirectの**明示的**route tableをsnapshotからビルド時に決定し、公開/非公開変化時の無効化を扱う。
- 試験: root slugと`/event`/`/user`/`/admin`の衝突、duplicate slug、X ID rename、redirect、404、path traversal/encoding、未知URL。
- DONE: HTTP gatewayがlookupするための小さな固定manifestと世代/hashが確定、request時D1 lookup不要。

### MIG-0405 — visibility gateway (D-02 path Route)

- 読む: `static-delivery/README.md`, `cloudflare/TOPOLOGY.md`, `ROUTING_AND_DEPLOY_PLAN.md`, `ROUTE_MATRIX.md`。
- 変更: `+apps/site/src/gateway/`または新薄WorkerにD1/R2 visibility manifest検証→allowならStatic Asset/R2 HTML配信の順序を実装。Custom Domain+Routeの重ね合わせは**承認済み非本番PoCのみ**。root slugをCloudflare`/:id`パターンと誤解しない。
- 試験: public→private直後、古いHTML、edge cache、manifest不達、alias、新旧fallback、`/api/auth/*`保護、private sourceページがindexされないこと。
- DONE: unauthorized/unknownはfail-closed、production route変更無し、PoC URL/CPU/logとrollback準備が記録済み。

### MIG-0406 — output budget / 1102 / R2 prebuilt HTML fallback

- 読む: `PHASE_4_5_SPEC.md`, `cloudflare/PERFORMANCE_BASELINE.md`, `static-delivery/README.md`, build出力、D-06。
- 変更: `+scripts/check-public-site-build-budget.mjs`のような**出力実ファイルカウント**とwarn/hard-fail preflightを追加。上限超過時にはビルド/QueueでHTMLをR2に事前保存するfallback serviceのPoCを追加。request経路はvisibility確認後R2 GETのみでHTML返却する。
- 試験: 20,000 asset境界の上下、大量dynamic slug、R2 partial upload/old generation/stale/private/corrupt HTML, fallback 404/503/rebuild enqueue; worker p50/p95/p99・tail spike・1102 countの**実測**。
- DONE: 1 version当たりfileの内訳（HTML/JS/CSS/font/redirect/etc）、R2 cost/build時間、CPU/headroom、SEO/OGP/cache parity evidence。SSR採用は独立reviewと現実測定合格時だけ。Free 10ms中の1102=0を`機械的に保証`と書かない。

### MIG-0407 — Phase 4 Gate

- 読む: 0401..0406のPRとCPU/visibility test、D-02/D-06/D-08 evidence。
- 変更: STATUS gate checklist、Public artifact manifest shape、Open issuesを記録。
- 試験: HTML mock visual acceptance、３代表route、no private leak、budget preflight、R2 HTMLの再配信/故障、ブラウザhydration。
- DONE: 独立review・人間Phase Gate承認までBLOCKED/REVIEW、後続0501 READY化はレビュー後。

### MIG-0501 — fixed pages /about & /rules

- 読む: CURRENT `/about` / `/rules`、`ROUTE_MATRIX.md`とUX IDs、登録済みHTML。
- 変更: `+apps/site/src/pages/about.astro`, `+apps/site/src/pages/rules.astro`。ビルド時HTML/metadata/static assets、既存規約版へのリンク/利用条件を維持。
- 試験: head/canonical/OGP、mobile nav、旧URL、空/不達時、no JSによる閲覧、robots/sitemap。
- DONE: 2ルートのUX stateとSEOを証拠に、対象pathのみnonprodで移行確認。

### MIG-0502 — event page family

- 読む: CURRENT `/event`, `/event/[id]`, `/event/[id]/release`, `/event/[id]/slots`、`functions/PUBLIC.md`, `background-jobs/README.md`。
- 変更: `+apps/site/src/pages/event/index.astro`, `+apps/site/src/pages/event/[id]/{index,release,slots}.astro`。static HTMLとlive slot/overlay Island分離、private eventはvisibility gateway。
- 試験: forthcoming/ongoing/finished event, full/empty slots, release order, current event, no access, Queue reflection lag, role-based slot overlay。
- DONE: canonical/UX/FN、live API cache TTLとエラー時の表示、R2世代と現行表記一致。

### MIG-0503 — group compatibility redirects

- 読む: CURRENT `/groups`, `/groups/[slug]`, `CURRENT_ROUTES.md`。
- 変更: 従来仕様の`/event`および`/event#event-group-{slug}`へredirectする静的/edge routingを追加。redirect status、query/fragment/URL encode扱いを既存に揃える。
- 試験: 旧bookmark, target anchor, 404, invalid slug, percent encoded/path traversal, query。
- DONE: 互換URLは残り、新たな別画面を作って重複させない。

### MIG-0504 — user and portfolio pages

- 読む: CURRENT `/user`, `/user/[id]`, `/user/[id]/portfolio`, X ID alias/approval/visibility。
- 変更: `+apps/site/src/pages/user/{index,[id]/index,[id]/portfolio}.astro`。クリエイター索引/作品/portfolioをsnapshotで配信、非公開作品を事前HTMLへ含めない。
- 試験: approved/unapproved/merged/rejected X、alias redirect、禁止表示、作品公開↔非公開、プロフィールOGP。
- DONE: 旧user URL互換、visual + feature parity、D-03が表示名義のロジックへ不用意に介入していない。

### MIG-0505 — /list /recommend /trending

- 読む: CURRENT3ルート、public DTO/cursor、`frontend/PUBLIC.md`の検索/ソート/filter/empty UX。
- 変更: `+apps/site/src/pages/{list,recommend,trending}.astro`。first paint静的、client query/filter Isands、ランキング/R2 artifactをbuild snapshotで反映。
- 試験: sort/filter/query/cache canonical, pagination, empty/broken thumbnails, dynamic refresh lag, public-only DTO。`/list/~query`、`/user/~query`、`/user/[id]/paged`は旧Nextの技術的renderer。新Astroに同名ページを複製する前提とせず、logical URLへのquery/deep-link/back-forward parity試験で代替してから旧技術URLを退役する。
- DONE: URL/queryと検索戻り操作がCURRENT同等、CPU budgetではrequest時D1大量集計なし。

### MIG-0506 — root/top /

- 読む: CURRENT top page, hover/scroll shelf component, static projection freshness / public site metadata。
- 変更: `apps/site/src/pages/index.astro`をmock target + Public top snapshotで置換。スクロール棚と軽いIslandだけ許可、同時リクエスト時に重いrebuildを起動しない。
- 試験: desktop/mobile shelves, keyboard, news links, reload, R2 missing/stale, ranking freshness, cache, OGP。
- DONE: top root URLの機能一覧・SEO・操作履歴をスクリーン/E2Eで固定。

### MIG-0507 — video root slug /[id] final cutover

- 読む: `CURRENT_ROUTES.md`, `ROUTE_MATRIX.md`, `frontend/PUBLIC.md`, current player/chapter/like/overlay code, `ACTIVE_X_MIGRATION_PLAN.md`。
- 変更: root slugのresolveを固定ルートやasset pathより後に適用。静的作品情報 + player/chapters/Active X like/bookmark Islandを組み込み、既存APIの状態/403/202/503/リトライを維持。
- 試験: collision with /event,/admin,/api,/user,/dashboard, unknown slug, video private→public and reverse, banned, 0X/複数X, chapter, editing, video canonical/OGP & share thumbnail。
- DONE: LAST route migrationとして全Public UX/FN、SEO/OGP、visibility/cache/dynamic path parity。catch-all RouteをそのままCloudflareへ登録禁止。

### MIG-0508 — Phase 5 Gate

- 読む: 0501..0507の各PR、Public 16 Route matrix、432 UX台帳内のpublic該当部分。
- 変更: Route Matrix全件にlegacy→new disposition・根拠（URL/screenshot/test/rollback）を付け、公開pageまわりの残機能漏れを数える。
- 試験: public+private+alias across 16 routes, SEO/OGP, direct reload, mobile/a11y, no1102/nonprod, deny-first for static.
- DONE: 人間Phase Gate承認+独立review必須、旧Next Workerの未移行Auth/API/private経路には触れない。
