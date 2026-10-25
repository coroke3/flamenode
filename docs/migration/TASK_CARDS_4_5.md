# Implementation cards: Phase 4 / 5 — Public SSG, Visibility, R2 fallback

> Status: Active / 15 executable MIG cards
> Authority: [STATUS.md](STATUS.md), [PHASE_4_5_SPEC.md](PHASE_4_5_SPEC.md), [ROUTE_MATRIX.md](ROUTE_MATRIX.md), [static-delivery baseline](static-delivery/README.md), [CPU baseline](cloudflare/PERFORMANCE_BASELINE.md)
> Critical: HTML mock is registered (MIG-0200 DONE, D-08 DECIDED, 2026-10-13); Phase4/5 **visual** work is gated by the STATUS chain, not missing HTML: MIG-0402 waits for MIG-0206 (Phase 2 Gate) + MIG-0401, Phase 5 visual routes wait for MIG-0407. **0401→0404→0405→0406は非visual性能PoCとして既存MIGを順序変更し先行可能**。元のMIG IDs・状態正本はSTATUS、詳細なP0/P1測定計画はPERFORMANCE_IMPLEMENTATION_PLAN.md。
> Work Order: 実装手順の正本は各Phase仕様書の `### MIG-XXXX:` 節（Model / Readiness付き）。このカードは要約。小型モデルは `Model: small` かつ `READY_FOR_SMALL_MODEL` のWork Orderだけを実行する（[IMPLEMENTATION_RUNBOOK.md](IMPLEMENTATION_RUNBOOK.md)）。

## Every Public task MUST preserve

`FILE_MIGRATION_MATRIX.md` のMIG担当ページ/loader/テスト行を先に確認し、新Astroファイル作成と共にURL/UX/FNおよびvisibility gateway・R2 consumerを同じ行へ記録する。静的生成物だけではファイルの`PARITY_VERIFIED`は付けない。

- CURRENT canonical URL/query/redirect/404/robots/canonical/OGP/thumbnail + pagination.
- `public_visibility_fences`: private/hidden/voided content is fail-closed even when a stale R2/Static Assets HTML exists. No route may leak unpublished metadata.
- Static-first request: no heavy D1, React request render, aggregate, sync, images transform, or build on public GET.
- Failures: stale/missing visibility manifest -> deny/503 per CURRENT; R2 failure -> safe unavailable + queue rebuild, never expose private DTO.
- `frontend/PUBLIC.md`, `screen-mapping/README.md`, relevant `functions/PUBLIC.md` rows need observable parity evidence for every route.

### MIG-0401 — public snapshot loader PoC

- **先行タスク:** MIG-0105 DONEでREADY。approved HTML不要。fixtureに正常/非公開/欠損/破損/旧世代を含め、ビルド入力データの容量・処理時間・生成件数を出力する。デザイン作業や本番用HTML完成は非対象。性能計測が存在しない場合は「未計測」と記す。


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

- **先行タスク:** MIG-0401の後に実施。**MIG-0403は前提にしない**。fixture由来のcanonical/alias mappingが実データと整合し、リクエスト時D1全件探索・大JSONパースを行わない設計を確認。manifest bytes/entries/lookup CPU p99を証跡化する。


- 読む: `ROUTE_MATRIX.md`, `CURRENT_ROUTES.md`, CURRENT alias resolver, static projection manifest。
- 変更: `+apps/site/src/lib/routeMap.ts`等を生成。canonical/aliases/legacy redirectの**明示的**route tableをsnapshotからビルド時に決定し、公開/非公開変化時の無効化を扱う。
- 試験: root slugと`/event`/`/user`/`/admin`の衝突、duplicate slug、X ID rename、redirect、404、path traversal/encoding、未知URL。
- DONE: HTTP gatewayがlookupするための小さな固定manifestと世代/hashが確定、request時D1 lookup不要。

### MIG-0405 — visibility gateway (D-02 path Route)

- **非本番CPU Gate:** HTTP requestは可視性/manifest lookup/静的assetまたは既存R2 HTML選択だけ。D1全件走査・同期SSR/HTML組立・外部画像変換・巨大JSONパース・Queue bulk起動は禁止。stale manifest/visibility unknown/R2 failureはfail-closed。Gateway p50<1.5ms, p95<3ms, p99<5msをPoCで検証し、最高値/異常系と `exceededCpu` も追う。


- 読む: `static-delivery/README.md`, `cloudflare/TOPOLOGY.md`, `ROUTING_AND_DEPLOY_PLAN.md`, `ROUTE_MATRIX.md`。
- 変更: `+apps/site/src/gateway/`または新薄WorkerにD1/R2 visibility manifest検証→allowならStatic Asset/R2 HTML配信の順序を実装。Custom Domain+Routeの重ね合わせは**承認済み非本番PoCのみ**。root slugをCloudflare`/:id`パターンと誤解しない。
- 試験: public→private直後、古いHTML、edge cache、manifest不達、alias、新旧fallback、`/api/auth/*`保護、private sourceページがindexされないこと。
- DONE: unauthorized/unknownはfail-closed、production route変更無し、PoC URL/CPU/logとrollback準備が記録済み。

### MIG-0406 — output budget / 1102 / R2 prebuilt HTML fallback

- **性能トラックの判定単位:** [PERF_HOTPATH_MATRIX.md](PERF_HOTPATH_MATRIX.md)の各family、従来Web vs 新Gateway vs content queueでCPU p50/p95/p99/max, `exceededCpu`/`exceededMemory`/`canceled`, version, sampleInterval, cache hit/miss, R2/D1 readsを**分別**。正規化したpath familyと同窓比較なしに「90%改善」と書かない。画像proxy OPT-016とjob OPT-008/015は**独立の後続実装PR候補**として所有者・依存を報告し、勝手にproduction queue/scriptを変えない。


- 読む: `PHASE_4_5_SPEC.md`, `cloudflare/PERFORMANCE_BASELINE.md`, `static-delivery/README.md`, build出力、D-06。
- 変更: `+scripts/check-public-site-build-budget.mjs`のような**出力実ファイルカウント**とwarn/hard-fail preflightを追加。上限超過時にはビルド/QueueでHTMLをR2に事前保存するfallback serviceのPoCを追加。request経路はvisibility確認後R2 GETのみでHTML返却する。
- 試験: 20,000 asset境界の上下、大量dynamic slug、R2 partial upload/old generation/stale/private/corrupt HTML, fallback 404/503/rebuild enqueue; worker p50/p95/p99・tail spike・1102 countの**実測**。
- DONE: 1 version当たりfileの内訳（HTML/JS/CSS/font/redirect/etc）、R2 cost/build時間、CPU/headroom、SEO/OGP/cache parity evidence。SSR採用は独立reviewと現実測定合格時だけ。Free 10ms中の1102=0を`機械的に保証`と書かない。

### MIG-0409 — build-time public data from D1 + build budget (D-09)

- 読む: `PHASE_4_5_SPEC.md` の MIG-0409 Work Order、`static-delivery/BUILD_TIME_DATA.md`。
- 変更: なし（DONE、#323 `4f90bc9d`）。
- 試験: `readPublicData.test.mjs`、`queue-cpu-probe/worker.test.mjs`。
- DONE: D-13-10（2026-10-25）。Workers Builds 再測と token は MIG-0509 の owner 手順。

### MIG-0410 — deploy-hook build scheduler (D-09)

- 読む: `PHASE_4_5_SPEC.md` の MIG-0410 Work Order、`work-items/MIG-0410.md` の owner 手順と 2026-10-23 の非本番表。
- 変更: 証跡の記録だけ（work item、`PERF_HOTPATH_MATRIX.md`）。コードは #325 で merge 済み。
- 試験: T01〜T07（merge 済み）、T08 = 本番 deploy 後の最初の Cron が `skipped: 1`。
- DONE: B-add（+2 ms）PASS 済み。owner の本番手順（0065 確認、Deploy Hook、secret、deploy）と T08 の記録。

### MIG-0411 — per-page Queue consumer: DELETE + tracker close (D-09, D-11)

- 読む: `PHASE_4_5_SPEC.md` の MIG-0411 Work Order、`OPEN_DECISIONS.md` D-11、`apps/site/src/gateway/pageRenderQueue.ts`、`r2Html.ts`。
- 変更: `renderPublicPage.ts` / `.measure.mjs` を削除、`pageRenderQueue.ts` は可視性の列だけ読む、`r2Html.ts` の send 失敗の P2、`pageRenderRecovery.ts` + fast-jobs の回復段。
- 試験: T01〜T08（excluded / delete / CAS / 重複 / R2 失敗 / send 失敗 / Cron 回復 / renderPublicPage 0 件）。
- DONE: 描画経路なし、bundle 再計測、Queue 見積り ≤ 50%、DELETE 経路の B-new（非本番は承認後）。Queue 作成と binding は owner。

### MIG-0407 — Phase 4 Gate

- **独立両Gate:** MIG-0403の承認済み実HTMLによる3画面UX/可視性/SEO証跡 **AND** MIG-0406のCPU/R2/Queue/容量証跡が揃うまでREVIEW/DONEにしない。性能トラックのPASSで視覚/UX受入をDONEにしない。移行後web `exceededCpu` **90%以上削減は達成目標であり予測/合格の自動保証ではない**。


- 読む: 0401..0406のPRとCPU/visibility test、D-02/D-06/D-08 evidence。
- 変更: STATUS gate checklist、Public artifact manifest shape、Open issuesを記録。
- 試験: HTML mock visual acceptance、３代表route、no private leak、budget preflight、R2 HTMLの再配信/故障、ブラウザhydration。
- DONE: 独立review・人間Phase Gate承認までBLOCKED/REVIEW、後続0501 READY化はレビュー後。

### MIG-0501 — fixed pages /about & /rules (+ /maintenance shell)

- 読む: `PHASE_4_5_SPEC.md` MIG-0501、`work-items/MIG-0501.md`、Phase 5 共通契約の画面確認手順、`app/(public)/maintenance/page.tsx`、`public/brand/`。
- 変更: `apps/site/public/` へ CURRENT の brand 13 file を複製、`apps/site/src/pages/maintenance.astro` を PublicLayout へ、`scripts/migration-public-shell.test.mjs`。gateway は MIG-0512、/rules 同意 form は MIG-0510。
- 試験: brand の byte 同一、/maintenance の head と shell、390/1440 の画面確認、about-stats の producer→build。
- DONE: /about は PARITY_VERIFIED、/rules は MIG-0510 待ちの IN_PROGRESS、画面確認の (c) が0件。

### MIG-0502 — event page family

- 読む: `PHASE_4_5_SPEC.md` MIG-0502、`work-items/MIG-0502.md`、CURRENT `app/(public)/event/[id]/page.tsx:176-277`、`src/components/layout/EventRecruitCard.tsx`、`TopView.tsx`。
- 変更: `EventDetailView` / `EventSlotsView` に accent、`RecruitCard`（TopView の export）を `/event/[id]` へ、`/event` 検索を `ImeSafeGetForm` へ、重複 key の test。予約は MIG-0510、icon map は MIG-0511、release 404 と slots の fence は MIG-0512。
- 試験: accent の有無、受付中・開始前・終了の recruit card、満枠は Island 後だけ、`?q=a&q=b`、390/1440。
- DONE: event 5行のうち index・~query・release は PARITY_VERIFIED、detail と slots は MIG-0511 / MIG-0510 待ち。

### MIG-0503 — group compatibility redirects

- 読む: `work-items/MIG-0503.md` の Findings、D-13-34。
- 変更: 文書と ledger だけ（`_redirects` と gateway の 307 は merge 済み）。
- 試験: `migration-group-routes.test.mjs`、`edgePolicy.test.mjs` の group 表、dist の `_redirects` 4行。
- DONE: groups 2行と `_redirects` を PARITY_VERIFIED。CURRENT を実際に動かした比較は任意の owner step。

### MIG-0504 — user and portfolio pages

- 読む: `work-items/MIG-0504.md`、CURRENT `UserProfilePage.tsx`（`notFound()`）、`routeShards.ts:44-48`。
- 変更: T03 を CURRENT 準拠に書き換え、`migration-user-routes.test.mjs` に props の量の test。icon map は MIG-0511、`/user/index.json` の gateway は MIG-0512。
- 試験: 大小文字と `@`（gateway test）、15+15 page の props ≤ 256 KiB、390/1440。
- DONE: /user は PARITY_VERIFIED、/user/[id]・paged・portfolio は MIG-0511 待ち。

### MIG-0505 — /list /recommend /trending

- 読む: `work-items/MIG-0505.md`、`scripts/migration-list-discover.test.mjs`。
- 変更: listing の fixture を `scripts/fixtures/listingSnapshotFixture.mjs` へ切り出し、画面確認、key 表の owner を MIG-0510 に。
- 試験: list-discover test が前と同じ件数、390/1440（fixture の snapshot）。
- DONE: recommend・trending は PARITY_VERIFIED、list は ListFilterIsland（MIG-0510）待ち。

### MIG-0506 — root/top /

- 読む: `work-items/MIG-0506.md`、`scripts/migration-top-route.test.mjs`、`scripts/migration-top-shelf.test.mjs`。
- 変更: top の fixture を `scripts/fixtures/topSnapshotFixture.mjs` へ切り出し、画面確認、shuffle と時計の決定（D-13-37/63）を記録。
- 試験: top-route と top-shelf test、390/1440（fixture の snapshot）。
- DONE: 画面確認の (c) が0件。`/` の ledger は検索帯（MIG-0510）待ちの IN_PROGRESS。

### MIG-0507 — video root slug /[id] final cutover

- 読む: `PHASE_4_5_SPEC.md` の MIG-0507 Work Order、`work-items/MIG-0507.md`、CURRENT `app/(public)/[id]/page.tsx`。
- 変更: `apps/site/src/lib/videoPage.ts`（playlist link を build 時の event-detail snapshot から）。
- 試験: T08/T09 playlist、既存 T01〜T07、browser 390px / 1440px。
- DONE: U10〜U12 と Final audit。icon projection の確認は MIG-0511 T03 と MIG-0508（D-14-6）。Island は MIG-0513 / 0515、sign-out は Phase 8。catch-all Route を Cloudflare に登録しない。

### MIG-0509 — all public data generated at build time (D-09)

- 読む: `PHASE_4_5_SPEC.md` の MIG-0509 Work Order、`work-items/MIG-0509.md`、`static-delivery/BUILD_TIME_DATA.md` §2 / §5 / §6。
- 変更: `produceSnapshots.ts` の `--d1-api` / `--trending-r2`、`+apps/site/scripts/buildPublicSite.ts`、`+apps/site/scripts/readR2Object.ts`、`build:public` script、server-core の request mark、GA4 同期の入力。
- 試験: `--d1-api` と `--sqlite --batched` の byte 一致、`requested_at` の有無、build entry の dry-run、GA4 入力の一致。
- DONE: build が R2 に書かない（D-13-13）、Workers Builds 5 回の実測（owner）、file 数と build 時間が予算内。

### MIG-0508 — Phase 5 Gate

- 読む: 0501..0507 と 0509..0515 の各PR、Public 16 Route matrix、432 UX台帳内のpublic該当部分。
- 変更: Route Matrix全件にlegacy→new disposition・根拠（URL/screenshot/test/rollback）を付け、公開pageまわりの残機能漏れを数える。
- 試験: public+private+alias across 16 routes, SEO/OGP, direct reload, mobile/a11y, no1102/nonprod, deny-first for static、操作 Island。
- DONE: 人間Phase Gate承認+独立review必須、旧Next Workerの未移行Auth/API/private経路には触れない。

### MIG-0511 — public X icon map projection at build time

- 読む: `PHASE_4_5_SPEC.md` の MIG-0511 Work Order、CURRENT `src/lib/publicData/staticSharedInputsLoader.ts:243-285,375`、`publicIconProjection.ts`。
- 変更: `+apps/site/src/lib/publicIconMap.ts`、`publicDataLoader.ts` の loader、`produceSnapshots.ts` に1行、`videoPage.ts` / `userViews.ts` / `event/[id]/index.astro` / `portfolio.astro` の差し込み。
- 試験: `scripts/migration-public-icon-map.test.mjs` T01〜T07、producer T08（CURRENT `users_index` 生成物と deep-equal）。
- DONE: 3 consumer が map を使い、map が無くても build は成功し出力は従来どおり。

### MIG-0510 — `/list` filter Island + top search band on RH-032

- 読む: `PHASE_4_5_SPEC.md` の MIG-0510 Work Order と Phase 5 共通契約、CURRENT `ListIndexView.tsx`、MIG-0634 の merge 後の RH-032 route。
- 変更: `+ListFilterIsland.ts`、`+lib/publicApi.ts`、`list.astro` / `index.astro`、`ListView.tsx` / `TopView.tsx`。
- 試験: list の query・key・空表示、top の GET form（JS なし）、RH-032 の 503。
- DONE: Hono の RH-032 で CURRENT と同じ結果、Server Action を呼ばない、browser 確認。

### MIG-0513 — `/[id]` interaction Islands on Phase 6 APIs

- 読む: `PHASE_4_5_SPEC.md` の MIG-0513 Work Order、CURRENT `InteractionButton.tsx` / `ChapterComposer.tsx` / `VideoStatusForm.tsx` / `VideoViewerUtilityDock.tsx`。
- 変更: `+VideoInteractionIsland.ts`、`VideoPageIsland.ts`、`VideoDetailView.tsx`。
- 試験: like の Active X 0 / 複数、chapter の各 status、状態 form の権限、JS なし。
- DONE: MIG-0603 / 0634 / 0640 の API で CURRENT と同じ結果、browser 確認。

### MIG-0514 — `/event/[id]/slots` reservation Island

- 読む: `PHASE_4_5_SPEC.md` の MIG-0514 Work Order、CURRENT `SlotGrid.tsx` / `EventSlotsViewerPanel.tsx`。
- 変更: `EventSlotsIsland.ts`、`EventSlotsView.tsx`。
- 試験: 予約・解除・延長、同時予約で負けた側、RH-014 の fail-closed、JS なし。
- DONE: MIG-0604 U04 の API で CURRENT と同じ結果、browser 確認。

### MIG-0515 — `/rules` consent + header Active X switch

- 読む: `PHASE_4_5_SPEC.md` の MIG-0515 Work Order、CURRENT `rules/page.tsx:43-96`、`useActiveXSwitcher.ts`。
- 変更: `+RulesConsentIsland.ts`、`rules.astro`、`SiteHeader.ts`、`RulesView.tsx`。
- 試験: `next` の sanitize、`?error=` の3 code、Active X の楽観更新と rollback、JS なし。
- DONE: MIG-0636 / 0641 の API で CURRENT と同じ結果、D-04 を実行していない。

### MIG-0516 — public build request mark (MIG-0509 U05)
- 読む: `PHASE_4_5_SPEC.md` の MIG-0516 Work Order、`packages/server-core/src/staticRebuild/enqueue.ts:85`、`workers/fast-jobs/publicBuildTrigger.ts:138,160`。
- 変更: `buildStaticRebuildQueueBatch` に `public_build_state.requested_at` の `MAX` 更新 1 文、golden test。
- 試験: 公開データを変える / 変えない enqueue、古い時刻で戻らない。
- DONE: T01〜T03、merge は owner の 0065 read-only 確認の後。

### MIG-0517 — GA4 sync input from D1 (MIG-0509 U06)
- 読む: `workers/ga-analytics/sync.ts:20,151,249-266`、`workers/json-generator/optimizedRebuild.ts:651,669-678`。
- 変更: `+workers/ga-analytics/recentFromD1.ts`、`loadRecentListPayload` の中身。
- 試験: `list/recent.json` と同じ id 集合と順序、非公開を含まない、0 件で同期しない。
- DONE: ga-analytics が R2 の `list/recent.json` を読まない。

### MIG-0518 — `/[id]` chapter composer + `?playlist=` dock Islands
- 読む: `ChapterComposer.tsx`、`ChapterCommentPanel.tsx`、`VideoViewerUtilityDock.tsx`、`videoViewerOverlayClient.ts:267`、`apps/api/src/routes/videos/{chapters,viewerOverlay}.ts`。
- 変更: `+VideoChapterIsland.ts`、`+VideoUtilityDockIsland.ts`、`+apps/site/src/lib/viewerOverlay.ts`、`VideoPageIsland.ts` の mount。
- 試験: chapter の 200/400/403/404/409/413、overlay の権限、`?playlist=`、JS なし。
- DONE: T01〜T04 と 390px / 1440px の browser 確認。

### MIG-0512 — public gateway error pages and sub-page fence

- 読む: `PHASE_4_5_SPEC.md` MIG-0512、`apps/site/src/gateway/index.ts`、`routeShards.ts`、`visibility.ts`、R-GATEWAY。
- 変更: `index.ts` の 404/503 を build の HTML + `Retry-After: 30` に、`/event/{id}/release|slots` と `/user/{id}/portfolio` を親の fence に通す、`routeShards.ts` に `/user/index.json` と `/fonts/`。
- 試験: 公開 / 非公開 / 不明 / alias / manifest 欠落 / 古い HTML が残った非公開（sub-page も）、HEAD、既存の text への後退。
- DONE: build 後に非公開にした event の枠表・release と user の portfolio が 404、request ごとの読み取り回数は変わらない。
