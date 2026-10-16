# FlameNode Phase 4 & 5 タスク仕様書（Public Astro SSG & Islands Spec）

> 状態: Active / Phase 4 & 5 実行向け仕様書
> 最終検証: 2026-10-09（`CURRENT_ROUTES.md` の Public 16 ルートおよび `ROUTE_MATRIX.md` に基づき改定）
> 対象モデル: Claude / Codex / Antigravity / GPT-5.6-luna / Gemini Flash 等の全エージェント
> 関連ドキュメント: [`README.md`](README.md), [`STATUS.md`](STATUS.md), [`CURRENT_ROUTES.md`](CURRENT_ROUTES.md), [`ROUTE_MATRIX.md`](ROUTE_MATRIX.md), [`OPEN_DECISIONS.md`](OPEN_DECISIONS.md) (D-02, D-06, D-08)
> **タスク正本:** 個別タスクの実行指示（読む・変える・試す・DONE条件）の正本は [`TASK_CARDS_4_5.md`](TASK_CARDS_4_5.md) です。`npm run migration:next` がその内容を自動抽出します。本仕様書はPhase 4 & 5全体のアーキテクチャ背景と設計意図を補足します。

---

# 1. 公開画面の基本方針

1. **Astro による静的生成（SSG）+ React Islands**:
   - リクエスト時のオンデマンド SSR は原則禁止（`README.md` §8: "SSR never by default"）。
   - HTML 生成はビルド時に集中し、Workers Static Assets から配信。
   - 動的な対話要素（いいねボタン、チャプターシーク、検索フィルター等）のみ React Islands（`client:load` または `client:visible`）としてマウント。
2. **公開反映と Free 枠予算の遵守（D-06 参照）**:
   - 変更のたびに全件同期ビルドするのではなく、Queue によるデバウンス（`content-jobs` 経由の snapshot build）で反映。
   - Workers Static Assets Free上限は 20,000 files/version。CSS/JS/images/HTML/manifest/redirectを含め、MIG-0406で実ファイル数・上限余裕・build時間を測定する。
   - ファイル数超過時もSSRへ無条件移行しない。静的配信優先: Astro SSG → ビルド/QueueでR2へ事前生成したHTMLを軽量Workerで配信 → 実証済み限定SSR。R2 HTMLは数・ライフサイクル・オブジェクトread費用を別途測定。
3. **Thin Visibility Gateway**:
   - 可視性フェンス（Fail-Closed）はエッジゲートウェイ（薄い Worker）で検証し、非公開・限定公開データのキャッシュ漏洩を防止（`README.md` §8）。
4. **前提条件（D-08 参照）**:
   - Phase 4/5 の**visual/UX本実装**はユーザー提供HTMLモック（`UI_REFERENCE.md`）が正本であり、受領まではBLOCKED。**MIG-0401/0404/0405/0406の非visual性能PoCはモック非依存で先行可能**。簡易fixture画面は完成UIとして扱わず、実際の公開画面切替とPhase4 Gateは承認まで停止。

---

## 1102性能PoCとUI承認を分けた実装順

**先行性能トラック:** MIG-0105 DONE → **MIG-0401 READY** → MIG-0404 → MIG-0405 → MIG-0406。既存スナップショットと公開/非公開fixture、簡易HTMLを用いる。実ページの可視性・URLパリティを完了したとは扱わない。

**Visualトラック:** MIG-0200..0206（D-08登録済み。残るPhase 2依存・Gateは省略しない）→ MIG-0402 → MIG-0403（0404にも依存）。**MIG-0407はMIG-0403とMIG-0406の両方**に依存する。merge済み依存関係は[STATUS.md](STATUS.md)、open PRの進捗はownerのwork-itemを参照する。

性能の所有・測定・異常系・本番承認境界は[PERFORMANCE_IMPLEMENTATION_PLAN.md](PERFORMANCE_IMPLEMENTATION_PLAN.md)、経路別のsource/targetは[PERF_HOTPATH_MATRIX.md](PERF_HOTPATH_MATRIX.md)に記録。SSR削減をHono/ゲートウェイ/Queueへの単なるCPU移動で置き換えない。

# 2. Phase 4: Public PoC タスク別仕様書

### MIG-0401: Astro build-input PoC
- **Model:** lead
- **Readiness:** NEEDS_REFINEMENT — PR #283 で実装済み、独立レビュー待ち（owner の work-item `docs/migration/work-items/MIG-0401.md` は PR #283 の branch にある）
- **Recipe:** R-BUILD
- **Runtime:** N
- **Depends on:** MIG-0105 / **Decisions:** none
- **Verified against:** `aacf4fd` (2026-10-15)
#### Source snapshot
- main の `apps/site` は `astro.config.mjs`（`output: "static"`）と疎通用 `src/pages/index.astro` だけ。
- CURRENT の公開データ読み込み: `src/lib/publicData/loader.ts`（`:42,46` で `publicVisibilityManifest` / `publicVisibilityManifestCore` を import）。
- PR #283 の変更（未merge）: `apps/site/src/lib/publicDataLoader.ts`（manifest の allow/deny、generation、sha256、`{kind,id,title}` だけの strict projection）、`apps/site/src/pages/migration-fixture-poc/[id].astro`、`scripts/migration-public-snapshot.test.mjs`、`scripts/check-migration-public-poc-build.mjs`。
#### Owned paths
- PR #283 の work-item の `Owned paths` が正本（`apps/site/src/lib/publicDataLoader.ts`, `apps/site/src/pages/migration-fixture-poc/[id].astro`, `scripts/migration-public-snapshot.test.mjs`, `scripts/check-migration-public-poc-build.mjs`, `.github/workflows/migration-docs-check.yml`, `docs/migration/FILE_MIGRATION_MATRIX.md`）。
#### Micro-units
- **U01 loader**: build 時の snapshot 読み込み（PR #283 で DONE）。
- **U02 fixture SSG**: 非本番 fixture で公開1件だけが HTML になり、非公開が出ないことを確認（PR #283 で DONE）。
- 残り: 独立レビューと merge 統合（`AGENT_PROTOCOL.md` §Wake decision）。
#### Test cases
| ID | 入力/操作 | 期待 |
| --- | --- | --- |
| T01 | manifest 無し・古い世代・blocked | source を読む前に拒否 |
| T02 | `visibility: "private"` の envelope | 拒否 |
| T03 | sha256 不一致・壊れた JSON・サイズ超過 | 拒否 |
| T04 | build 出力 | 公開 fixture の HTML が1件だけ、非公開は0件 |
#### Commands
```bash
node --test --experimental-strip-types scripts/migration-public-snapshot.test.mjs
npm run build --workspace=@flamenode/site
node scripts/check-migration-public-poc-build.mjs
```
#### Ledger updates
PR #283 で `FILE_MIGRATION_MATRIX.md` に2行追加済み。merge 統合時に `STATUS.md` の MIG-0401 を DONE、MIG-0404 を READY。
#### DONE checklist
- [ ] 独立レビューの APPROVE が PR #283 にある
- [ ] CI green
#### STOP
- 本番 Route・D1・Queue に触れる変更が必要に見えたら止める。
#### Rollback
PR #283 を merge 後に revert。本番には影響しない。

### MIG-0402: shared React UI in Astro
- **Model:** lead
- **Readiness:** NEEDS_REFINEMENT — MIG-0206（Phase 2 Gate）と MIG-0401（PR #283）の merge 後、`AdapterProvider`（MIG-0203）の API で書き直す
- **Recipe:** R-UI
- **Runtime:** N
- **Depends on:** MIG-0206, MIG-0401 / **Decisions:** D-08 DECIDED
- **Verified against:** `aacf4fd` (2026-10-15)
#### Source snapshot
- `apps/site/astro.config.mjs`: `output: "static"`, `integrations: [react()]`。
- `apps/site/src/pages/index.astro`: `@flamenode/ui` の `Button` を `client:load` で1つ描画するだけ。
- `apps/site/package.json`: `react`/`react-dom` `^19.0.0`。`packages/ui/package.json` の peerDependencies は `^18.3.1 || ^19.0.0`、devDependencies の `@types/react` は `^18.3.0`（型の版ずれ）。
- `packages/ui/src/adapters/index.tsx` の可変グローバル setter は MIG-0203 で Context 化される前提。
#### Owned paths
- 新規: `+apps/site/src/components/IslandWrapper.tsx`, `+apps/site/src/components/SiteAdapterProvider.tsx`
- 変更: `apps/site/src/pages/index.astro`（疎通用 Button を IslandWrapper 経由に置き換えるだけ。トップ画面の実装は MIG-0506）
- 触らない: `packages/ui/src/**`（部品の不足は Phase 2 へ差し戻す）
#### Micro-units
- **U01 provider**: Island ごとに `AdapterProvider` で Link/Image/Navigator を注入する `SiteAdapterProvider` を作る。モジュールグローバルを書き換えない。検証: `rg -n "setLinkComponent|setImageComponent|setNavigatorAdapter" apps/site` が0件。
- **U02 hydration**: `client:load` と `client:visible` の両方で1部品ずつ描画し、初期HTMLとハイドレーション後のDOMが一致することを確認。検証: `npm run build --workspace=@flamenode/site` が成功し、`apps/site/dist/index.html` に部品の初期HTMLが入っている。
- **U03 error boundary**: Island の例外で静的本文が消えない境界を入れる。
#### Test cases
| ID | 入力/操作 | 期待 |
| --- | --- | --- |
| T01 | JS 無効で表示 | 静的本文とリンクが読める |
| T02 | 同じページに Island 2つ | Adapter が互いに混ざらない |
| T03 | Island 内で例外 | 静的本文は残り、エラー表示になる |
| T04 | `apps/site` の import | `next/*` が0件 |
#### Commands
```bash
npm run build --workspace=@flamenode/ui
npm run build --workspace=@flamenode/site
npm run typecheck
npm run check:project-docs
```
#### Ledger updates
`FILE_MIGRATION_MATRIX.md` に `apps/site/src/components/*` 行を追加（TARGET_SKELETON）。CURRENT page 行は変えない。
#### DONE checklist
- [ ] Island が Context 経由で Adapter を受け取る
- [ ] JS 無効でも静的本文が読める
- [ ] `apps/site` に `next/*` import が無い
#### STOP
- `packages/ui` の部品を変える必要が出たら止める（Phase 2）。
- 実データの読み込みが必要になったら止める（MIG-0403）。
#### Rollback
PRをrevert。

### MIG-0403: representative video/user/event SSG
- **Model:** lead
- **Readiness:** NEEDS_REFINEMENT — MIG-0402 と MIG-0404 の merge 後。snapshot の DTO は MIG-0401 の `PublicSnapshot`（`kind/id/title` のみ）なので、代表画面に必要な項目への拡張を先に決める
- **Recipe:** R-PAGE
- **Runtime:** S0
- **Depends on:** MIG-0402, MIG-0404 / **Decisions:** D-02 DECIDED, D-08 DECIDED
- **Verified against:** `aacf4fd` (2026-10-15)
#### Source snapshot
- CURRENT: `app/(public)/[id]/page.tsx`, `app/(public)/event/[id]/page.tsx`, `app/(public)/user/[id]/page.tsx`。データは `src/lib/publicData/loader.ts`、可視性は `src/lib/publicData/publicArtifactVisibility.ts`。
- PR #283（未merge）の `apps/site/src/lib/publicDataLoader.ts` は manifest の allow/deny・generation・sha256 を検証し、`{ kind, id, title }` だけを返す。
- 表示部品は MIG-0205 の `packages/ui/src/screens/*`。
- `optimize/free-tier-1102-blockers.md`（共有フォルダ）のローカル計測: `/{作品ID}` 15.5〜21ms、`/event/{id}` 16〜21ms、`/user/{id}` 16〜19ms を毎回SSR（Free の上限 10ms 超）。
#### Owned paths
- 新規: `+apps/site/src/pages/[id].astro`, `+apps/site/src/pages/event/[id]/index.astro`, `+apps/site/src/pages/user/[id]/index.astro`（代表 fixture のみ。実データ全件の生成は Phase 5）
- 変更: `apps/site/src/lib/publicDataLoader.ts`（DTO 拡張。PR #283 merge 後）
- 触らない: `app/(public)/**`, 本番 Route
#### Micro-units
- **U01 DTO**: 代表3画面に必要な項目を `PublicSnapshot` に追加。非公開項目を通さない strict projection を保つ。検証: PR #283 のテスト（`scripts/migration-public-snapshot.test.mjs`）に項目追加分のケースを足して PASS。
- **U02 pages**: 3ページを fixture から生成。OGP/canonical/title を CURRENT と同じ規則で出す。検証: build 出力の `<head>` を CURRENT の同じ fixture の出力と比較してPRに貼る。
- **U03 states**: public / private / voided / deleted / alias の fixture で、private と deleted が HTML にならないことを確認。
#### Test cases
| ID | 入力/操作 | 期待 |
| --- | --- | --- |
| T01 | private fixture | HTML が生成されない |
| T02 | alias の fixture | canonical が正規IDを指す |
| T03 | OGP 画像・title | CURRENT と同じ規則 |
| T04 | `[id].astro` と `event/`, `user/` | Astro のルート競合なし（固定ルートが優先） |
#### Commands
```bash
npm run build --workspace=@flamenode/site
node --test --experimental-strip-types scripts/migration-public-snapshot.test.mjs
npm run typecheck
```
#### Ledger updates
`FILE_MIGRATION_MATRIX.md` の `app/(public)/[id]/page.tsx`, `event/[id]/page.tsx`, `user/[id]/page.tsx` 行の evidence に代表 fixture の比較結果を記録（state は IN_PROGRESS のまま。全件移行は Phase 5）。
#### DONE checklist
- [ ] 代表3画面の HTML・画像 alt・meta の比較がPRにある
- [ ] private/deleted が HTML にならない
- [ ] 未対応の UX ID が次MIG付きで記録されている
#### STOP
- request 時の描画（SSR）が必要に見えたら止める。
- DTO に非公開項目を入れる必要が出たら止める。
#### Rollback
PRをrevert。本番には影響しない。

### MIG-0404: route-map generator（**0401の直後、0403を待たない**）
- **Model:** lead
- **Readiness:** NEEDS_REFINEMENT — MIG-0401（PR #283）の merge 後。canonical/alias の出所（R2 artifact か build 時 D1 read-only か）を決める
- **Recipe:** R-BUILD
- **Runtime:** N
- **Depends on:** MIG-0401 / **Decisions:** D-02 DECIDED
- **Verified against:** `aacf4fd` (2026-10-15)
#### Source snapshot
- 作品IDの解決: `src/lib/db/videoIdLookup.ts:18` `resolveVideoPrimaryKey`, `:53` `fetchVideoRowByIdOrYoutube`（request 時に D1 を読む）。
- `/groups/[slug]` は `src/lib/eventGroupRoutes.ts:5-7` `eventGroupPublicHref` で `/event#event-group-{slug}` を返す。
- 可視性: `src/lib/db/schema.base.ts:1044-1045` `public_visibility_fences` テーブル。
- 公開 artifact の生成側: `workers/json-generator/`（`publicProjection.test.mjs` 等）。
#### Owned paths
- 新規: `+apps/site/src/lib/routeMap.ts`, `+scripts/migration-route-map.test.mjs`
- 触らない: `src/lib/db/videoIdLookup.ts`（CURRENT の解決は維持）, `workers/json-generator/**`（artifact 追加が必要なら別PR）
#### Micro-units
- **U01 table**: canonical ID・alias・旧URL redirect を明示した表を build 時に作る関数。入力は fixture。検証: `node --test --experimental-strip-types scripts/migration-route-map.test.mjs`。
- **U02 collision**: root slug が `about`, `rules`, `event`, `user`, `list`, `recommend`, `trending`, `groups`, `admin`, `manage`, `dashboard`, `entry`, `api`, `auth`, `maintenance` 等の固定ルートや asset path と衝突したら build を失敗させる。
- **U03 metrics**: manifest の bytes・件数・lookup の CPU（p99）を測ってPRに記録。
#### Test cases
| ID | 入力/操作 | 期待 |
| --- | --- | --- |
| T01 | 作品IDが `event` | build 失敗 |
| T02 | 同じ slug が2件 | build 失敗 |
| T03 | X ID の rename | 旧IDが新IDへ redirect |
| T04 | `..%2F` を含むID | 拒否 |
| T05 | 未知のURL | 404 |
#### Commands
```bash
node --test --experimental-strip-types scripts/migration-route-map.test.mjs
npm run build --workspace=@flamenode/site
npm run typecheck
```
#### Ledger updates
`FILE_MIGRATION_MATRIX.md` の Future files 表に `apps/site/src/lib/routeMap.ts` を追加。`PERF_HOTPATH_MATRIX.md` の root video 行に manifest の測定値を記録。
#### DONE checklist
- [ ] request 時に D1 を読まずに lookup できる manifest と世代/hash がある
- [ ] 衝突・重複・encoding のテストがPASS
- [ ] bytes・件数・lookup CPU の測定値がPRにある
#### STOP
- request 時の D1 全件探索が必要に見えたら止める。
- Cloudflare の Route に `/:id` を登録する設計になったら止める。
#### Rollback
PRをrevert。

### MIG-0405: visibility gateway
- **Model:** lead
- **Readiness:** NEEDS_REFINEMENT — MIG-0404 の manifest 形式と、gateway を `apps/site` 内に置くか独立 Worker にするか（`cloudflare/TOPOLOGY.md`）を決めてから
- **Recipe:** R-GATEWAY
- **Runtime:** S1
- **Depends on:** MIG-0404 / **Decisions:** D-02 DECIDED
- **Verified against:** `aacf4fd` (2026-10-15)
#### Source snapshot
- CURRENT の可視性判定: `src/lib/publicData/publicArtifactVisibility.ts`（テスト `publicArtifactVisibility.test.mjs`）、`public_visibility_fences`（`src/lib/db/schema.base.ts:1044`）、検査 `npm run check:public-visibility-fences`。
- CPU 目標: gateway p50<1.5ms, p95<3ms, p99<5ms（`TASK_CARDS_4_5.md` MIG-0405）に加え、**最大値 < 5ms**（`ZERO_1102.md` §3 の S1。合否は最大値で判定）。
- 本番 Route / Custom Domain の変更は明示承認事項（`CLAUDE.md`）。
#### Owned paths
- 新規: `+apps/site/src/gateway/index.ts`, `+apps/site/src/gateway/visibility.ts`, `+scripts/migration-gateway.test.mjs`
- 触らない: `wrangler.toml`（本番設定）, 本番 Route
#### Micro-units
- **U01 decision**: manifest を読み、allow なら静的 asset、deny/unknown/stale なら fail-closed（404 か 503）を返す純粋関数。検証: テストで全分岐。
- **U02 worker**: 非本番の Worker として組み立て、`wrangler dev` で動かす。検証: ローカルで CPU を測りPRに記録。
- **U03 abnormal**: manifest 不達・古い世代・R2 失敗で非公開データを返さないことを確認。
#### Test cases
| ID | 入力/操作 | 期待 |
| --- | --- | --- |
| T01 | 公開→非公開の直後 | 非公開ページを返さない |
| T02 | manifest が読めない | fail-closed |
| T03 | `/api/auth/*` | gateway を通らない |
| T04 | 非公開 source のページ | `noindex` かつ返さない |
| T05 | CPU | p99<5ms（ローカル測定値として記録。本番値と書かない） |
#### Commands
```bash
node --test --experimental-strip-types scripts/migration-gateway.test.mjs
npm run build --workspace=@flamenode/site
npm run check:public-visibility-fences
npm run typecheck
```
#### Ledger updates
`FILE_MIGRATION_MATRIX.md` の `apps/site/src/gateway/**` を IN_PROGRESS。`PERF_HOTPATH_MATRIX.md` に測定値（ローカル）を記録。
#### DONE checklist
- [ ] 不明・古い・失敗のすべてで fail-closed
- [ ] 本番 Route を変更していない
- [ ] CPU の測定値と測定条件がPRにある
#### STOP
- 本番 Route / Custom Domain の変更が必要に見えたら止める（明示承認事項）。
- request 時の HTML 組み立てや D1 全件走査が必要に見えたら止める。
#### Rollback
PRをrevert。非本番のみなので本番の戻しは不要。

### MIG-0406: CPU/build benchmark + bounded public fallback
- **Model:** lead
- **Readiness:** NEEDS_REFINEMENT — MIG-0405 の後。実データ件数での見積もり（作品・ユーザー・イベント数）を D1 の read-only 集計か既存 artifact から得る方法を決めてから
- **Recipe:** R-BUILD
- **Runtime:** N
- **Depends on:** MIG-0405 / **Decisions:** D-06 DECIDED
- **Verified against:** `aacf4fd` (2026-10-15)
#### Source snapshot
- Workers Static Assets の上限 20,000 files/version（本仕様 §1-2）。
- CURRENT の rebuild: `workers/json-generator/queue.ts`, `workers/json-generator/rebuild.ts`（`PERF_HOTPATH_MATRIX.md` の static rebuild Queue 行）。
- 計測の基準: `cloudflare/PERFORMANCE_BASELINE.md`、`PERF_HOTPATH_MATRIX.md`。
#### Owned paths
- 新規: `+scripts/check-public-site-build-budget.mjs`, `+scripts/check-public-site-build-budget.test.mjs`
- 新規（PoC）: `+apps/site/src/gateway/r2Html.ts`（R2 の事前生成 HTML を返すだけ。request 中に描画しない）
- 触らない: `workers/json-generator/**`, 本番 Queue / Worker 設定（変更が必要なら OPT 系の別PRとして提案のみ）
#### Micro-units
- **U01 budget preflight**: `apps/site/dist` の実ファイル数を種類別（HTML/JS/CSS/font/画像/redirect/その他）に数え、警告値と上限で失敗させる。検証: 19,999 / 20,000 / 20,001 の fixture でテスト。
- **U02 R2 fallback**: 上限を超える分の HTML を R2 から返す PoC。可視性確認の後に R2 GET だけを行い、R2 が読めないときは 503 と再生成 enqueue（非本番）。
- **U03 measure**: family ごとに CPU p50/p95/p99/max、cache hit/miss、R2/D1 read を測り `PERF_HOTPATH_MATRIX.md` の形式で記録。
#### Test cases
| ID | 入力/操作 | 期待 |
| --- | --- | --- |
| T01 | 20,001 files | preflight が失敗 |
| T02 | R2 の HTML が古い世代 | 返さない |
| T03 | R2 の HTML が壊れている | 返さない、503 |
| T04 | 非公開化された作品の R2 HTML | 返さない |
#### Commands
```bash
node --test scripts/check-public-site-build-budget.test.mjs
npm run build --workspace=@flamenode/site
node scripts/check-public-site-build-budget.mjs
```
#### Ledger updates
`FILE_MIGRATION_MATRIX.md` の `scripts/check-public-site-build-budget.mjs` を IN_PROGRESS。`PERF_HOTPATH_MATRIX.md` の各 family 行に測定値と条件。
#### DONE checklist
- [ ] ファイル数の内訳と上限までの余裕がPRにある
- [ ] R2 fallback の異常系がすべて fail-closed
- [ ] 測定値に条件（ローカル/非本番、sample interval、version）が付いている
- [ ] 「1102=0 を保証」とは書いていない
#### STOP
- 本番 Queue や Worker の設定変更が必要になったら止める（提案のみ）。
- SSR を採用したくなったら止める（独立レビューと実測の合格が条件）。
#### Rollback
PRをrevert。

### MIG-0409: build 時に D1 から公開データを作る PoC と build 時間の予算（D-09）
- **Model:** lead
- **Readiness:** NEEDS_REFINEMENT — MIG-0404 の merge 後。build 環境が D1 を読む方法（D1 の read-only API token か、build 前の `wrangler d1 export`）を決め、token の作成についてユーザーの承認を得てから
- **Recipe:** R-BUILD
- **Runtime:** N
- **Depends on:** MIG-0404 / **Decisions:** D-06 DECIDED, D-09 DECIDED
- **Verified against:** `96f20dc` (2026-10-15)
#### Source snapshot
- CURRENT の公開データは `workers/json-generator` が D1 から作って R2 に書く。入口は `workers/json-generator/queue.ts:122` → `optimizedRebuild.ts:862` → `rebuild.ts:330`。主な key は `top.json`（`rebuild.ts:1076`）、`list/recent.json`（`:1142`）、`list/popular.json`（`:1164`）、`events/index.json`（`:1189`）、`search-index-lite.json`（`:1482`）、`recommend.json`（`:3564`）。
- CURRENT の読み手: `src/lib/publicData/loader.ts`（`events/index.json` :1064、`list/recent.json` :1113、`top.json` :1733 ほか）。
- 再生成のきっかけ: `src/lib/staticRebuild/enqueue.ts:122`（`static_rebuild_queue` に1行）と `src/lib/queues/wakeStaticRebuildQueueAfterCommit.ts:13`。
- CURRENT の鮮度: 公開ページの ISR は 30〜300秒（`app/(public)/event/[id]/slots/page.tsx:32` の `revalidate = 30`、`app/(public)/page.tsx:53` の `120`、`app/(public)/recommend/page.tsx:27` の `300`）。
- 上限: Workers Builds（Free）は月 3,000分・同時1・1回 20分。Static Assets は1 version 20,000 files。出典は `OPEN_DECISIONS.md` の D-09 節と `ZERO_1102.md` §1。
#### Owned paths
- 新規: `+apps/site/scripts/readPublicData.ts`（build 時に D1 を読む。`LIMIT` は `MAX_` 定数）、`+apps/site/scripts/readPublicData.test.mjs`、`+docs/migration/static-delivery/BUILD_TIME_DATA.md`
- 触らない: `workers/json-generator/**`（CURRENT はそのまま動かす。比較の相手として読むだけ）、`src/lib/publicData/**`、本番の D1・token・deploy hook
#### Micro-units
- **U01 one family**: `events/index.json` と同じ内容を、build 時に D1（ローカル D1 の fixture）から作る純粋関数と CLI。CURRENT の生成関数に同じ fixture を入れた出力と、key 順を揃えて一致することを test で確かめる。
- **U02 freshness table**: `BUILD_TIME_DATA.md` に、公開データの項目ごとに「build で作る」「Queue で1件ずつ作る（作品・ユーザー・イベントの個別ページ、MIG-0411）」「Island が API（S2）で読む」のどれかを表にする。CURRENT の `revalidate` と、どの操作で変わるかを列にし、build の間隔（U03）より速く変わる項目（枠の空き、いいね数、viewer overlay）は API にする。
- **U03 build budget**: 合成データ（作品 3,000、イベント 20、各イベントの枠 120。`ZERO_1102.md` §3 の参考表と同じ条件）で `apps/site` を build し、時間を5回測る。次の式で1日の build 上限と最短の間隔を出し、表に書く: `データ build の上限/日 = floor((3,000 × 0.8 − コード push の build 分/月) ÷ build 1回の分 ÷ 30)`。コード push の分は直近30日の main への merge 数 × build 1回の分で見積もり、根拠の URL を付ける。
- **U04 new and private**: 次の2つの扱いを決め、表に書く。(a) R2 HTML ができる前の新しい作品の URL: MIG-0411 の Queue が作るまでの数分間、静的な共通 shell HTML を返し、中身は Island が API で読む案を既定にし、gateway（MIG-0405）で動くかを確かめる。(b) build の後に非公開になったもの: 更新 API が同じ request で書く拒否 entry（KV の key）を gateway が読む。KV の反映に最大 60秒かかることを書く。
- **U05 page render**: 作品・ユーザー・イベントについて、次の2つの CPU を種類ごとに測る（MIG-0411 の形を決めるため）。(a) ページ全体を `experimental_AstroContainer.renderToString` で HTML にする。(b) ページのデータだけを JSON にし、HTML は title・canonical・OGP を入れた最小の `<head>` と固定の本体（JSON を読んで Island が描く）にする。CURRENT は (b) に近く、イベント・ユーザーの JSON 1件の生成で 6〜11ms かかっている（`ZERO_1102.md` §3 の背景処理の参考表）。費用の大半は D1 の行を DTO にして stringify する部分なので、(a) と (b) の差と内訳（D1 結果の処理 / DTO / stringify / HTML）を分けて記録する。
- **U06 list shards**: 一覧（新着・人気）と検索索引を、件数の上限（`MAX_` 定数）付きの shard に分け、1件の更新で変わる shard だけを作り直す形の CPU を測る。CURRENT は全体の作り直しで 129〜178ms（一覧）、350ms〜1.6秒（検索索引）かかる（`ZERO_1102.md` §3 の背景処理の参考表）。shard 1つが max < 8ms なら、その family は build ではなく Queue に分類する（`OPEN_DECISIONS.md` D-09「反映の速さの方針」の3）。
- **U07 queue budget**: Queue consumer の CPU 上限を非本番で確かめる（`ZERO_1102.md` §1 の食い違い）。CPU を 20ms / 100ms / 1秒使う consumer を非本番の Worker に置き、各 50 message 送って `exceededCpu` の件数を記録する。結果を `ZERO_1102.md` §1 に出典付きで書く。20ms で止まるなら `B` の 8ms を確定とし、1秒でも止まらないなら一覧・検索の shard の上限を見直す案を PR に書く（決めるのは lead とユーザー）。
#### Test cases
| ID | 入力/操作 | 期待 |
| --- | --- | --- |
| T01 | 同じ fixture を CURRENT の生成関数と新しい関数に入れる | 出力の JSON が一致 |
| T02 | 非公開・削除済みの行を含む fixture | 出力に含まれない |
| T03 | `MAX_` 定数ちょうどの件数 | 出力できる。上限 + 1 件で build が失敗する |
| T04 | 同じ入力で2回 build | 出力の byte が一致 |
#### Commands
```bash
node --test --experimental-strip-types apps/site/scripts/readPublicData.test.mjs
npm run build --workspace=@flamenode/site
npm run check:project-docs
```
#### Ledger updates
`FILE_MIGRATION_MATRIX.md` の Future files 表に `apps/site/scripts/readPublicData.ts` を追加。`PERF_HOTPATH_MATRIX.md` に build 時間（合成データ、5回）を条件付きで記録。
#### DONE checklist
- [ ] 1 family の出力が CURRENT と一致する test が PASS
- [ ] 全項目に「build / API」の分類があり、API の項目は担当の MIG-06xx が書いてある
- [ ] build 時間の実測5回と、1日の上限・最短間隔の計算が PR にある
- [ ] 新規作品と非公開化の扱いが表にある
- [ ] 個別ページの種類ごとの1件生成の CPU（max）が PR にある
- [ ] 一覧・検索の shard 1つの作り直しの CPU（max）と、各 family を「API / Queue 1件 / Queue 分割 / build」のどれにしたかが PR にある
- [ ] U07 の Queue consumer の 3条件それぞれの `exceededCpu` 件数が `ZERO_1102.md` §1 にある
#### STOP
- 最短間隔が CURRENT の鮮度（30〜300秒）より大きく延びるので、計算した「公開までの最大の遅れ」を PR とスレッドでユーザーに示し、承認を得るまで MIG-0410 の定数を決めない。
- 非公開化に 60秒を超える遅れが出る設計になったら止める。
- 本番 D1 の読み取り、token や deploy hook の作成が必要になったら止める（明示承認事項）。
- U07 の非本番 Worker と Queue を作る前に止め、作る resource 名と消す手順を示して承認を得る（Cloudflare の設定変更）。
#### Rollback
PRをrevert。本番には影響しない。

### MIG-0410: deploy hook を呼ぶ build 要求の確認（Cron、D-09）
- **Model:** lead
- **Readiness:** NEEDS_REFINEMENT — MIG-0409 で build 間隔と1日の上限をユーザーが承認した後。値が決まれば下の関数と test をそのまま書けるので、lead が値を埋めて READY_FOR_SMALL_MODEL にする
- **Recipe:** R-JOB
- **Runtime:** B
- **Depends on:** MIG-0409 / **Decisions:** D-09 DECIDED
- **Verified against:** `96f20dc` (2026-10-15)
#### Source snapshot
- Deploy Hook: branch ごとの URL に `POST` すると build と deploy が走る。最初の build が始まる前の重複は省かれる。Worker ごとに 10回/分まで（`OPEN_DECISIONS.md` D-09 節の出典）。
- Cron Trigger は Free で account あたり 5個まで。CURRENT は4個（`workers/content-jobs/wrangler.toml:12`、`workers/fast-jobs/wrangler.toml:12`、`workers/sync-jobs/wrangler.toml:12` の2個）。新しい cron 式は足さず、`flamenode-fast-jobs` の毎時の Cron（`workers/fast-jobs/index.ts:114` の `runJob`）に1段足す。
- schema の置き場所: MIG-0308 が DONE なら `packages/db/src/schema/`、まだなら `src/lib/db/schema.base.ts` と drizzle の migration。
#### Owned paths
- 新規: `+workers/fast-jobs/publicBuildTrigger.ts`, `+workers/fast-jobs/publicBuildTrigger.test.mjs`, `+drizzle/<次の番号>_public_build_state.sql`
- 変更: `workers/fast-jobs/index.ts`（Cron に1段足すだけ）、schema の file（上の Source snapshot のどちらか1つ）
- 触らない: `workers/fast-jobs/wrangler.toml` の `crons`、本番の secret、本番の D1
#### Micro-units
- **U01 table**: 1行だけの表を足す。
  ```sql
  CREATE TABLE public_build_state (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    requested_at INTEGER NOT NULL DEFAULT 0,
    last_hook_at INTEGER NOT NULL DEFAULT 0,
    hooks_day TEXT NOT NULL DEFAULT '',
    hooks_today INTEGER NOT NULL DEFAULT 0
  );
  INSERT INTO public_build_state (id) VALUES (1);
  ```
  `requested_at` は公開データが最後に変わった時刻（ms）、`last_hook_at` は deploy hook を最後に呼んだ時刻（ms）、`hooks_day` は `hooks_today` を数えている UTC の日付（`YYYY-MM-DD`）。
- **U02 decision**: 純粋関数 `decidePublicBuild({ requestedAt, lastHookAt, hooksDay, hooksToday, now })` を書く。戻り値は `"trigger"` か `"skip"`。`requestedAt <= lastHookAt` なら skip、`now - lastHookAt < MIN_BUILD_INTERVAL_MS` なら skip、同じ UTC 日で `hooksToday >= MAX_DATA_BUILDS_PER_DAY` なら skip、それ以外は trigger。2つの定数は MIG-0409 で承認された値にし、上に計算式を1行で書く。
- **U03 handler**: D1 から1行読む → `decidePublicBuild` → trigger なら条件付き UPDATE（`WHERE id = 1 AND last_hook_at = ?`）で `last_hook_at` と回数を更新し、`changes()` が 1 のときだけ `fetch(env.PUBLIC_BUILD_DEPLOY_HOOK_URL, { method: "POST" })`。URL が無い環境では何もしない。D1 は2 statement まで。
- **U04 wire**: `workers/fast-jobs/index.ts` の Cron に1段足す。他の段の順番と lease は変えない。
  ```bash
  node --test --experimental-strip-types workers/fast-jobs/publicBuildTrigger.test.mjs
  ```
  期待: 下の T01〜T07 がすべて pass。
#### Test cases
| ID | 入力/操作 | 期待 |
| --- | --- | --- |
| T01 | 前回の hook の後に変更なし | skip、fetch 0回 |
| T02 | 変更あり、前回から `MIN_BUILD_INTERVAL_MS` 未満 | skip |
| T03 | 変更あり、間隔を満たす | trigger、fetch 1回、`last_hook_at` が更新 |
| T04 | 同じ日に `MAX_DATA_BUILDS_PER_DAY` 回呼んだ後 | skip |
| T05 | UTC の日付が変わった | 回数が 0 から数え直される |
| T06 | 2つの invocation が同時に trigger と判断 | 条件付き UPDATE により fetch は1回だけ |
| T07 | hook の URL が未設定 | 何もしない、例外なし |
#### Commands
```bash
node --test --experimental-strip-types workers/fast-jobs/publicBuildTrigger.test.mjs
npm run test:unit
npm run typecheck
```
#### Ledger updates
`FILE_MIGRATION_MATRIX.md` に `workers/fast-jobs/publicBuildTrigger.ts` を追加。`background-jobs/README.md` の Cron の表に1段を追記。
#### DONE checklist
- [ ] T01〜T07 が PASS
- [ ] 段を足した後の fast-jobs Cron 1回の CPU 最大値を非本番で測り、8ms 未満（`ZERO_1102.md` §5）
- [ ] 本番の D1 に表を作っていない、hook の URL を登録していない
#### STOP
- 本番の D1 migration、secret（hook の URL）の登録、本番 Worker の deploy は明示承認事項なので止める。
- 新しい cron 式が必要に見えたら止める（Free の上限 5個）。
#### Rollback
PRをrevert。表は未使用のまま残っても害はない（本番に作るのは承認後）。

### MIG-0411: 個別ページを1件ずつ Queue で R2 HTML に作り直す（ISR 相当、D-09）
- **Model:** lead
- **Readiness:** NEEDS_REFINEMENT — MIG-0405（gateway）と MIG-0409（1ページ生成の CPU 計測）の merge 後。計測で max < 8ms を満たしたページの種類だけを対象にする
- **Recipe:** R-JOB, R-PAGE
- **Runtime:** B, S1
- **Depends on:** MIG-0405, MIG-0409 / **Decisions:** D-06 DECIDED, D-09 DECIDED
- **Verified against:** `6dd695a` (2026-10-16)
#### Source snapshot
- 要件: 作品個別ページは ISR / On-Demand（`docs/migration/PRODUCT_REQUIREMENTS.md` の「Astro SSG Build Trigger & Free Tier Budget」）。D-06 の②（R2 に保存した事前生成 HTML を gateway が返す）。D-09 の 2026-10-16 改訂。
- CURRENT の鮮度: `/[id]`・`/user/[id]`・`/event/[id]/slots` は `revalidate = 30`、`/event/[id]` は `60`（`app/(public)/[id]/page.tsx:65`、`app/(public)/user/[id]/page.tsx:9`、`app/(public)/event/[id]/slots/page.tsx:32`、`app/(public)/event/[id]/page.tsx:61`）。
- 1ページの生成: `experimental_AstroContainer.renderToString`（`node_modules/astro/dist/container/index.d.ts:150`、`:227`、astro 5.18.2）。
- Next の ISR 再生成は 16〜71ms だった（`docs/operations/workers.md:12`）。Queue consumer も 10ms の上限として扱う（`ZERO_1102.md` §1）。
- 仕事の正本は D1、Queue は doorbell（`background-jobs/README.md`）。Queue の無料枠は1日 10,000 operations（`OPEN_DECISIONS.md` D-09 節）。
#### Owned paths
- 新規: `+apps/site/src/gateway/renderPublicPage.ts`, `+apps/site/src/gateway/pageRenderQueue.ts`, `+apps/site/src/gateway/pageRenderQueue.test.mjs`, `+drizzle/<次の番号>_public_page_renders.sql`
- 変更: `apps/site/src/gateway/index.ts`（`queue` handler を足す）、schema の file（MIG-0410 と同じ規則で置き場所を選ぶ）
- 触らない: `workers/json-generator/**`、本番の Queue・R2・D1
#### Micro-units
- **U01 table**: 再生成の要求を持つ表を足す。
  ```sql
  CREATE TABLE public_page_renders (
    entity TEXT NOT NULL CHECK (entity IN ('video', 'user', 'event')),
    entity_id TEXT NOT NULL,
    requested_at INTEGER NOT NULL,
    rendered_at INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (entity, entity_id)
  );
  ```
  更新 API（S3）は同じ `batch` で `INSERT ... ON CONFLICT DO UPDATE SET requested_at = excluded.requested_at` を1つ足し、doorbell を1つ enqueue する。
- **U02 render**: `renderPublicPage(entity, row)` は、R-PAGE のページ component を `renderToString` で HTML にする純粋な関数にする。入力の行は `LIMIT` 付きの query（`MAX_` 定数）で読む。
- **U03 consumer**: 1 message で1ページだけ処理する（`max_batch_size = 1`）。手順: `requested_at > rendered_at` の行を1つ読む → 公開なら HTML を作り R2 の `pages/<entity>/<id>.html` に PUT、非公開・削除済みなら R2 から消す → 条件付き UPDATE（`WHERE requested_at = ?`）で `rendered_at` を進める。処理の途中で新しい更新が来た行は、条件が外れて次の message で作り直される。
- **U04 recovery**: 既存の Cron（新しい cron 式は足さない。R-JOB）に、未処理の行があれば doorbell を1つ enqueue する段を足す。D1 は1 statement。
- **U05 measure**: 作品・ユーザー・イベントのそれぞれで、上限ちょうどの入力（関連作品・枠の数が最大のページ）の CPU を `ZERO_1102.md` §5 の方法で測る。max ≥ 8ms の種類は対象から外し、MIG-0509 の build に回す（PR に記録）。
#### Test cases
| ID | 入力/操作 | 期待 |
| --- | --- | --- |
| T01 | 公開の作品を更新 | その作品の R2 HTML だけが作り直される |
| T02 | 公開→非公開 | R2 HTML が消え、gateway が 404 を返す（拒否 entry は MIG-0409 U04 の形） |
| T03 | 生成中に同じ作品がもう一度更新 | 2回目の更新が次の message で反映される |
| T04 | 同じ doorbell が2回 | 2回目は何もしない |
| T05 | R2 の PUT が失敗 | `rendered_at` が進まず、次の Cron が拾う |
| T06 | 上限ちょうどのページ | 非本番の max < 8ms |
#### Commands
```bash
node --test --experimental-strip-types apps/site/src/gateway/pageRenderQueue.test.mjs
npm run build --workspace=@flamenode/site
npm run typecheck
```
#### Ledger updates
`FILE_MIGRATION_MATRIX.md` に新規 file を追加。`PERF_HOTPATH_MATRIX.md` に1ページ生成の CPU を種類別に記録。`BUILD_TIME_DATA.md` の表で、個別ページを「Queue」に分類。
#### DONE checklist
- [ ] T01〜T06 が PASS
- [ ] 種類ごとの max CPU と、対象から外した種類が PR にある
- [ ] 1日の message 数の見積もりが Queue の無料枠の 50% 以下
- [ ] 本番の D1・Queue・R2 に触れていない
#### STOP
- 1ページの生成が 8ms を切らない種類しか無い場合は止めて、計測値をユーザーに示す。
- MIG-0409 U05 の (a) が 8ms を超え (b) だけが収まる種類は、本文を JS で描くことになり、JS なしの閲覧と検索エンジンが読む本文が CURRENT と変わる（挙動の変更）。実装前に計測値と影響をユーザーに示し、承認を得る。JSON は gateway を通して返し（拒否 entry の確認のため）、R2 の公開 bucket から直接配らない。
- 非公開化が R2 HTML の削除を待つ設計になったら止める（拒否 entry で即時に止める）。
- 本番の migration・Queue の作成・deploy は明示承認事項なので止める。
#### Rollback
PRをrevert。個別ページは build 時の HTML（MIG-0509）に戻る。

### MIG-0407: Phase 4 Gate（**0403 + 0406 両方の証跡が必要**）
- **Model:** lead
- **Readiness:** NEEDS_REFINEMENT — Phase Gate はエージェントが自動承認しない
- **Recipe:** R-EVIDENCE
- **Runtime:** N
- **Depends on:** MIG-0403, MIG-0406, MIG-0410, MIG-0411 / **Decisions:** D-02 DECIDED, D-06 DECIDED, D-08 DECIDED, D-09 DECIDED
- **Verified against:** `aacf4fd` (2026-10-15)
#### Source snapshot
- MIG-0401〜0406 の merge 済みPRと各PRの測定値・比較証跡。
#### Owned paths
- 新規: `+docs/migration/design/PHASE_4_GATE.md`
- 変更: `docs/migration/STATUS.md`（承認後の merge 統合時だけ）
#### Micro-units
- **U01 evidence**: 代表3画面の表示・ハイドレーション・可視性、build 時間、ファイル数 preflight、R2 HTML の異常系、CPU 測定を1つの文書にまとめる。
- **U02 review**: 独立レビューと人間の Phase Gate 承認を依頼。
#### Test cases
| ID | 入力/操作 | 期待 |
| --- | --- | --- |
| T01 | MIG-0403 の証跡 | 代表3画面の比較がある |
| T02 | MIG-0406 の証跡 | CPU とファイル数の測定がある |
| T03 | 性能だけ PASS | Gate を通さない |
#### Commands
```bash
npm run build --workspace=@flamenode/site
node scripts/check-public-site-build-budget.mjs
npm run check:project-docs
```
#### Ledger updates
承認後に `STATUS.md` の MIG-0407 を DONE、MIG-0501 を READY。
#### DONE checklist
- [ ] MIG-0409 の「公開までの最大の遅れ」をユーザーが承認している
- [ ] 独立レビューの APPROVE
- [ ] 人間の Phase Gate 承認
- [ ] CI green
#### STOP
- 人間の承認なしに STATUS を DONE にしない。
#### Rollback
Gate 文書のPRをrevert。

---

# 3. Phase 5: Public Migration タスク別仕様書（実ルート対応）

対象は `CURRENT_ROUTES.md` の **Public 16 ルート**（VISUAL_SCREEN 13 + COMPAT_REDIRECT 3）。

| Route | Class | 移行先 Astro パス | 備考 / 主なアクション |
|---|---|---|---|
| `/about` | VISUAL_SCREEN | `apps/site/src/pages/about.astro` | サービス説明 |
| `/rules` | VISUAL_SCREEN | `apps/site/src/pages/rules.astro` | 規約・ルール |
| `/event` | VISUAL_SCREEN | `apps/site/src/pages/event/index.astro` | イベント一覧・絞込 |
| `/event/[id]` | VISUAL_SCREEN | `apps/site/src/pages/event/[id]/index.astro` | イベント詳細・募集状況 |
| `/event/[id]/release` | VISUAL_SCREEN | `apps/site/src/pages/event/[id]/release.astro` | 公開順連続閲覧 |
| `/event/[id]/slots` | VISUAL_SCREEN | `apps/site/src/pages/event/[id]/slots.astro` | 公開枠状況確認 |
| `/groups` | COMPAT_REDIRECT | `apps/site/public/_redirects`（307） | `/event` への互換リダイレクト |
| `/groups/[slug]` | COMPAT_REDIRECT | `apps/site/public/_redirects`（307） | `/event#event-group-{slug}` への互換リダイレクト |
| `/user` | VISUAL_SCREEN | `apps/site/src/pages/user/index.astro` | クリエイター検索・探索 |
| `/user/[id]` | VISUAL_SCREEN | `apps/site/src/pages/user/[id]/index.astro` | クリエイタープロフィール・作品 |
| `/user/[id]/portfolio` | VISUAL_SCREEN | `apps/site/src/pages/user/[id]/portfolio.astro` | ポートフォリオ閲覧 |
| `/list` | VISUAL_SCREEN | `apps/site/src/pages/list.astro` | 作品一覧・検索（Island 連動） |
| `/recommend` | VISUAL_SCREEN | `apps/site/src/pages/recommend.astro` | おすすめ作品 |
| `/trending` | VISUAL_SCREEN | `apps/site/src/pages/trending.astro` | 注目・ランキング |
| `/` | VISUAL_SCREEN | `apps/site/src/pages/index.astro` | トップ棚・急上昇・お知らせ |
| `/[id]` | VISUAL_SCREEN | `apps/site/src/pages/[id].astro` | 動画再生・詳細・チャプター（最後） |

**本番移行順の性能優先案:** 最初の安全確認をMIG-0501 `/about`/`/rules`、次にMIG-0504 `/user/*`、MIG-0505 `/list`/検索、次にMIG-0502 `/event/*`とMIG-0506 `/`、最後にMIG-0507 `/:id` とする。MIG-0503互換redirectは対象URLの切替と同時に扱う。**タスク依存・ページ権限・Phase Gateを飛ばす順序変更ではない**。

### Phase 5 共通契約（MIG-0501〜0508）

- 各MIGの成果は「`apps/site` のページ実装 + 非本番での parity 証跡」まで。**本番の path Route 切替（D-02）は各MIGの DONE 後に人間の明示承認を得て別操作として行う**。PR内で本番 Route・Custom Domain・Remote D1 を変更しない。
- 公開データは MIG-0401 の build snapshot（manifest allow/deny・generation・sha256）から読む。request 時の SSR・D1 読み取りを追加しない（D-06）。
- 視覚の正本は `UI_REFERENCE.md` の登録 mock、機能の正本は `frontend/PUBLIC.md` と `functions/` の該当 UX/FN 行。
- **公開画面の mutation は Server Action を直接呼んでいる**（2026-10-15 確認）。Astro の Island からは呼べないため、ルートごとの本番切替は下表の Hono API が DONE になるまで行わない。ページ実装と非本番 parity は先行してよい。MIG-0508（Phase 5 Gate）は MIG-0607（Phase 6 Gate）に依存する。

| ルート | 呼んでいる Server Action（呼び出し元） | 必要な API の MIG |
| --- | --- | --- |
| `/rules` | SA-075 `acceptLatestTerms`（`app/(public)/rules/page.tsx:3,95`） | MIG-0605 |
| `/event/[id]/slots` | SA-056〜068（`src/components/event/SlotGrid.tsx:15`） | MIG-0604 |
| `/[id]` | SA-087 いいね（`src/components/video/InteractionButton.tsx:6`）, SA-012〜 チャプター（`ChapterComposer.tsx:7`）, SA-001/040 状態変更（`VideoStatusForm.tsx:7-8`） | MIG-0603 |
| 公開ヘッダー（全ルート） | SA-098 `setActiveXId`（`src/components/user/useActiveXSwitcher.ts:5`） | MIG-0605 |
| ログイン状態を使う Island 全般 | session の読み取り | MIG-0608 |

- 各MIG共通のコマンド: `npm run build --workspace=@flamenode/site`, `node scripts/check-public-site-build-budget.mjs`, `npm run check:public-visibility-fences`, `npm run typecheck`, `npm run check:project-docs`。
- 各MIG共通の Rollback: PRをrevert。本番 Route を切り替えた後の戻しは `ROUTING_AND_DEPLOY_PLAN.md` の手順（旧 Next Worker へ Route を戻す）で、その実行も明示承認事項。

### MIG-0501: fixed/static routes
- **Model:** lead
- **Readiness:** NEEDS_REFINEMENT — MIG-0407（Phase 4 Gate）通過後。`/about` の統計（RH-026）を build snapshot から出すか Island で API を読むかを決める
- **Recipe:** R-PAGE
- **Runtime:** S0
- **Depends on:** MIG-0407 / **Decisions:** D-02 DECIDED, D-06 DECIDED, D-08 DECIDED
- **Verified against:** `aacf4fd` (2026-10-15)
#### Source snapshot
- `app/(public)/about/page.tsx` と `app/(public)/about/AboutStats.tsx`（統計は `GET /api/public/about-stats` = RH-026, `app/api/public/about-stats/route.ts`）。
- `app/(public)/rules/page.tsx:13` は規約を `loadStaticRulesPage`（`src/lib/publicData/loader.ts`）で読み、`:95` でログイン利用者向けの同意 form（SA-075 `acceptLatestTerms`）を出す。`app/(public)/rules/error.tsx` あり。
- mock: `docs/migration/mock/site/About.html`、規約は `pages.json` の `Rules /rules`。
- `app/robots.ts`, `app/sitemap.ts`（`src/lib/publicData/sitemapSources` を使う）。
#### Owned paths
- 新規: `+apps/site/src/pages/about.astro`, `+apps/site/src/pages/rules.astro`
- 触らない: `app/(public)/about/**`, `app/(public)/rules/**`（本番切替まで現行のまま）, `app/robots.ts`, `app/sitemap.ts`（Phase 9 まで）
#### Micro-units
- **U01 /about**: mock に合わせて実装。統計は U00 の決定に従う。検証: build 出力の `<head>`（title/description/canonical/OGP）を CURRENT と比較。
- **U02 /rules**: 規約の現行版を build 時に取り込み、版番号と施行日を CURRENT と同じに表示。検証: 同上。
#### Test cases
| ID | 入力/操作 | 期待 |
| --- | --- | --- |
| T01 | JS 無効 | 本文が読める |
| T02 | 規約の取得に失敗した build | build が失敗する（空の規約ページを出さない） |
| T03 | スマホ幅のナビ | MIG-0203 の header で開閉できる |
| T04 | canonical/OGP | CURRENT と一致 |
#### Commands
```bash
npm run build --workspace=@flamenode/site
npm run typecheck
npm run check:project-docs
```
#### Ledger updates
`FILE_MIGRATION_MATRIX.md` の `app/(public)/about/page.tsx`, `app/(public)/rules/page.tsx` を IN_PROGRESS（非本番 parity 済み）。本番切替後に CUTOVER。`ROUTE_MATRIX.md` の2行に証跡。
#### DONE checklist
- [ ] 2ルートの UX 状態と SEO の比較がPRにある
- [ ] 本番 Route を変更していない
#### STOP
- 本番 Route の変更が必要に見えたら止める（明示承認事項）。
- `/rules` の同意フォーム（SA-075）は MIG-0605 の API が無いと動かない。それまで `/rules` の本番切替を提案しない（`/about` は先行可）。
#### Rollback
Phase 5 共通契約のとおり。

### MIG-0502: event routes
- **Model:** lead
- **Readiness:** NEEDS_REFINEMENT — MIG-0501 の後。micro-unit の正本は [`TASK_MICRO_UNITS.md`](TASK_MICRO_UNITS.md) MIG-0502
- **Recipe:** R-PAGE
- **Runtime:** S0
- **Depends on:** MIG-0501 / **Decisions:** D-02 DECIDED, D-06 DECIDED, D-08 DECIDED
- **Verified against:** `aacf4fd` (2026-10-15)
#### Source snapshot
- CURRENT: `app/(public)/event/page.tsx`, `app/(public)/event/~query/page.tsx`（query 用の技術的な双子。同名ページは作らない）, `app/(public)/event/[id]/page.tsx`, `app/(public)/event/[id]/release/page.tsx`, `app/(public)/event/[id]/slots/page.tsx`。
- 枠のライブ表示は `GET /api/live/events/[id]/slots`（RH-020, `app/api/live/events/[id]/slots/route.ts`）と viewer overlay（RH-014, `app/api/events/[id]/slots/viewer-overlay/route.ts`）。
- PR #202 で `/event/[id]` と `/slots` と `/release` を ISR 化済み（`optimize/free-tier-1102-blockers.md`）。
#### Owned paths
- 新規: `+apps/site/src/pages/event/index.astro`, `+apps/site/src/pages/event/[id]/index.astro`, `+apps/site/src/pages/event/[id]/release.astro`, `+apps/site/src/pages/event/[id]/slots.astro`
- 触らない: `app/(public)/event/**`, `app/api/live/**`（API は Phase 6）
#### Micro-units
- U01〜U04 は [`TASK_MICRO_UNITS.md`](TASK_MICRO_UNITS.md) MIG-0502 のとおり。枠の数・overlay は Island で既存 API を読む（静的HTMLに焼かない）。
#### Test cases
| ID | 入力/操作 | 期待 |
| --- | --- | --- |
| T01 | 開催前・開催中・終了イベント | 表示が CURRENT と一致 |
| T02 | 枠が満席・空き | Island の表示が CURRENT と一致 |
| T03 | 非公開イベント | HTML を生成しない |
| T04 | `/event?…` の filter・再読込・戻る | CURRENT と同じ結果 |
| T05 | live API の失敗 | 静的本文は残り、劣化表示 |
#### Commands
```bash
npm run build --workspace=@flamenode/site
node scripts/check-public-site-build-budget.mjs
npm run check:public-visibility-fences
npm run typecheck
```
#### Ledger updates
`FILE_MIGRATION_MATRIX.md` の event 5行（`~query` を含む）を IN_PROGRESS。`ROUTE_MATRIX.md` の4ルートに証跡。
#### DONE checklist
- [ ] U01〜U04 が全部 DONE
- [ ] 枠のライブ表示が静的HTMLに含まれていない
- [ ] 非公開イベントの HTML が0件
#### STOP
- 枠の状態を request 時に描画する必要が出たら止める。
- 本番 Route の変更が必要に見えたら止める。
#### Rollback
Phase 5 共通契約のとおり。

### MIG-0503: group compat routes
- **Model:** small
- **Readiness:** NEEDS_REFINEMENT — MIG-0501 の後。Workers Static Assets の `_redirects` で 307 と `:slug` 置換が出せることを非本番で確認したら、lead がコード例を追記して READY_FOR_SMALL_MODEL にする
- **Recipe:** R-PAGE
- **Runtime:** S0
- **Depends on:** MIG-0501 / **Decisions:** D-02 DECIDED
- **Verified against:** `aacf4fd` (2026-10-15)
#### Source snapshot
- `app/(public)/groups/page.tsx:3-5`: `redirect("/event")`（Next の `redirect()` は 307）。
- `app/(public)/groups/[slug]/page.tsx`: `redirect(eventGroupPublicHref(slug))`。`src/lib/eventGroupRoutes.ts:5-7` は `/event#event-group-${slug}` を返す（slug をエンコードしない）。
- `apps/site/astro.config.mjs` は `output: "static"`。Astro の `redirects` 設定は static 出力では meta refresh の HTML になり、30x にならない。
#### Owned paths
- 新規: `+apps/site/public/_redirects`（または同等の静的 redirect 設定）
- 触らない: `app/(public)/groups/**`, `src/lib/eventGroupRoutes.ts`
#### Micro-units
- **U01 redirects**: `/groups` → `/event`（307）、`/groups/:slug` → `/event#event-group-:slug`（307）。新しい画面は作らない。検証: 非本番で `curl -sI` の status と `Location` を記録。
#### Test cases
| ID | 入力/操作 | 期待 |
| --- | --- | --- |
| T01 | `/groups` | 307、`Location: /event` |
| T02 | `/groups/spring` | 307、`Location: /event#event-group-spring` |
| T03 | `/groups/a%20b` | CURRENT と同じ `Location` |
| T04 | `/groups?x=1` | CURRENT と同じ query の扱い |
#### Commands
```bash
npm run build --workspace=@flamenode/site
npm run check:project-docs
```
#### Ledger updates
`FILE_MIGRATION_MATRIX.md` の `app/(public)/groups/page.tsx` と `app/(public)/groups/[slug]/page.tsx` の target を `apps/site/public/_redirects` に更新し IN_PROGRESS。
#### DONE checklist
- [ ] 4ケースの status と `Location` が CURRENT と一致
- [ ] groups 用の画面を新しく作っていない
#### STOP
- 307 以外になる、または fragment が落ちる場合は止めて lead へ返す。
#### Rollback
Phase 5 共通契約のとおり。

### MIG-0504: user routes
- **Model:** lead
- **Readiness:** NEEDS_REFINEMENT — MIG-0501 の後。micro-unit の正本は [`TASK_MICRO_UNITS.md`](TASK_MICRO_UNITS.md) MIG-0504
- **Recipe:** R-PAGE
- **Runtime:** S0
- **Depends on:** MIG-0501 / **Decisions:** D-02 DECIDED, D-03 DECIDED, D-06 DECIDED, D-08 DECIDED
- **Verified against:** `aacf4fd` (2026-10-15)
#### Source snapshot
- CURRENT: `app/(public)/user/page.tsx`, `app/(public)/user/~query/page.tsx`, `app/(public)/user/[id]/page.tsx`, `app/(public)/user/[id]/paged/page.tsx`, `app/(public)/user/[id]/portfolio/page.tsx`。
- `PERF_HOTPATH_MATRIX.md` の P0 行: `/user/*` は sampling 重み付きで約640件の `exceededCpu`。
- X ID の alias・承認・merge の扱いは `ACTIVE_X_MIGRATION_PLAN.md` と `auth/README.md`。
#### Owned paths
- 新規: `+apps/site/src/pages/user/index.astro`, `+apps/site/src/pages/user/[id]/index.astro`, `+apps/site/src/pages/user/[id]/portfolio.astro`
- 触らない: `app/(public)/user/**`
#### Micro-units
- U01〜U03 は [`TASK_MICRO_UNITS.md`](TASK_MICRO_UNITS.md) MIG-0504 のとおり。`~query` と `paged` は同名ページを作らず、論理URLの query/ページ送り parity で代替する。
#### Test cases
| ID | 入力/操作 | 期待 |
| --- | --- | --- |
| T01 | 未承認・却下・merge 済みの X | CURRENT と同じ表示または redirect |
| T02 | 非公開作品を持つユーザー | 非公開作品が HTML に含まれない |
| T03 | 旧 X ID | 新IDへ redirect |
| T04 | プロフィールの OGP | CURRENT と一致 |
#### Commands
```bash
npm run build --workspace=@flamenode/site
node scripts/check-public-site-build-budget.mjs
npm run check:public-visibility-fences
npm run typecheck
```
#### Ledger updates
`FILE_MIGRATION_MATRIX.md` の user 5行を IN_PROGRESS。`ROUTE_MATRIX.md` の3ルートと `PERF_HOTPATH_MATRIX.md` の `/user/*` 行に証跡。
#### DONE checklist
- [ ] U01〜U03 が全部 DONE
- [ ] 非公開作品が HTML に含まれない
- [ ] 旧 user URL が互換で動く
#### STOP
- D-03（Active X fan-out）のロジックを表示側へ持ち込む必要が出たら止める。
#### Rollback
Phase 5 共通契約のとおり。

### MIG-0505: list/discover routes
- **Model:** lead
- **Readiness:** NEEDS_REFINEMENT — MIG-0501 の後。検索・並び替えを Island で既存 API（RH-032 `GET /api/videos`）から読むか、build 時の検索 projection にするかを決める
- **Recipe:** R-PAGE
- **Runtime:** S0
- **Depends on:** MIG-0501 / **Decisions:** D-02 DECIDED, D-06 DECIDED, D-08 DECIDED
- **Verified against:** `aacf4fd` (2026-10-15)
#### Source snapshot
- CURRENT: `app/(public)/list/page.tsx`, `app/(public)/list/~query/page.tsx`, `app/(public)/recommend/page.tsx`, `app/(public)/trending/page.tsx`。
- `optimize/free-tier-1102-blockers.md`: `/list` は毎回SSRで 21〜47ms、`/recommend` と `/trending` は ISR 返却で 4〜7ms（ローカル計測）。
- 作品一覧 API: `app/api/videos/route.ts`（RH-032）。
#### Owned paths
- 新規: `+apps/site/src/pages/list.astro`, `+apps/site/src/pages/recommend.astro`, `+apps/site/src/pages/trending.astro`, `+apps/site/src/components/ListFilterIsland.tsx`
- 触らない: `app/(public)/list/**`, `app/(public)/recommend/**`, `app/(public)/trending/**`, `app/api/videos/**`
#### Micro-units
- **U01 /list**: 最初の表示は静的、検索・filter・並び替えは Island。URL の query 形式は CURRENT と同じ。
- **U02 /recommend, /trending**: build snapshot のランキングで静的生成。
- **U03 deep link**: `/list?…` の再読込・戻る・共有URLが CURRENT と同じ結果になることを確認。
#### Test cases
| ID | 入力/操作 | 期待 |
| --- | --- | --- |
| T01 | `/list?q=…&sort=…&page=2` を直接開く | CURRENT と同じ結果 |
| T02 | 結果0件 | empty 表示 |
| T03 | サムネイルの取得失敗 | 代替表示 |
| T04 | Island の API 失敗 | 静的な最初の表示は残る |
#### Commands
```bash
npm run build --workspace=@flamenode/site
node scripts/check-public-site-build-budget.mjs
npm run typecheck
```
#### Ledger updates
`FILE_MIGRATION_MATRIX.md` の list/recommend/trending 4行を IN_PROGRESS。`PERF_HOTPATH_MATRIX.md` の `/list` 行に証跡。
#### DONE checklist
- [ ] U01〜U03 が全部 DONE
- [ ] request 時に D1 の大量集計をしていない
#### STOP
- 検索を request 時の SSR で行う必要が出たら止める。
#### Rollback
Phase 5 共通契約のとおり。

### MIG-0506: root/top route
- **Model:** lead
- **Readiness:** NEEDS_REFINEMENT — MIG-0505 の後。トップの snapshot（棚・お知らせ・急上昇）の項目を確定してから
- **Recipe:** R-PAGE
- **Runtime:** S0
- **Depends on:** MIG-0505 / **Decisions:** D-02 DECIDED, D-06 DECIDED, D-08 DECIDED
- **Verified against:** `aacf4fd` (2026-10-15)
#### Source snapshot
- CURRENT: `app/(public)/page.tsx`。棚の部品は `src/components/layout/TopLoopShelf.tsx`, `src/components/layout/Shelf.tsx`（契約テスト `topLoopShelf.contract.test.mjs`, `shelfLoop.contract.test.mjs`）。
- mock: `docs/migration/mock/site/Main.html`。
- `optimize/free-tier-1102-blockers.md`: `/` は ISR 返却で 5〜7ms（ローカル）。
#### Owned paths
- 変更: `apps/site/src/pages/index.astro`（疎通用の内容をトップ画面に置き換える）
- 新規: `+apps/site/src/components/TopShelfIsland.tsx`（hover/scroll の棚だけ）
- 触らない: `app/(public)/page.tsx`, `src/components/layout/TopLoopShelf.tsx`
#### Micro-units
- **U01 static**: トップの本文・お知らせ・棚の中身を snapshot から静的生成。
- **U02 shelf**: 棚の hover/scroll を Island で実装し、`topLoopShelf.contract.test.mjs` の契約（ループ・キーボード）と同じ挙動にする。
#### Test cases
| ID | 入力/操作 | 期待 |
| --- | --- | --- |
| T01 | desktop/mobile の棚 | スクロール・キーボード操作が CURRENT と一致 |
| T02 | snapshot が古い/欠落 | build 失敗、または前世代を使い劣化表示（空ページを出さない） |
| T03 | お知らせのリンク | CURRENT と一致 |
| T04 | OGP | CURRENT と一致 |
#### Commands
```bash
npm run build --workspace=@flamenode/site
node scripts/check-public-site-build-budget.mjs
npm run typecheck
```
#### Ledger updates
`FILE_MIGRATION_MATRIX.md` の `app/(public)/page.tsx` を IN_PROGRESS。
#### DONE checklist
- [ ] U01・U02 が DONE
- [ ] 同時アクセスで重い rebuild を起動しない
#### STOP
- request 時の rebuild が必要に見えたら止める。
#### Rollback
Phase 5 共通契約のとおり。

### MIG-0507: `/[id]` video catch-all
- **Model:** lead
- **Readiness:** NEEDS_REFINEMENT — MIG-0502〜0506 の後で最後に行う。micro-unit の正本は [`TASK_MICRO_UNITS.md`](TASK_MICRO_UNITS.md) MIG-0507
- **Recipe:** R-PAGE, R-GATEWAY
- **Runtime:** S0, S1
- **Depends on:** MIG-0502, MIG-0503, MIG-0504, MIG-0505, MIG-0506 / **Decisions:** D-02 DECIDED, D-03 DECIDED, D-04 DECIDED, D-06 DECIDED, D-08 DECIDED
- **Verified against:** `aacf4fd` (2026-10-15)
#### Source snapshot
- CURRENT: `app/(public)/[id]/page.tsx`。ID 解決は `src/lib/db/videoIdLookup.ts:18,53`。
- 操作系の部品: `src/components/video/YoutubePlayer.tsx`, `ChapterTabs.tsx`, `ChapterCommentPanel.tsx`, `VideoInteractionActions.tsx`, `InteractionButton.tsx`。
- 操作 API: `app/api/videos/[id]/route.ts`（RH-030）, `app/api/videos/[id]/viewer-overlay/route.ts`（RH-031）。
- いいね/ブックマークの主体は Active X（`ACTIVE_X_MIGRATION_PLAN.md`）。
#### Owned paths
- 新規: `+apps/site/src/pages/[id].astro`（MIG-0403 の代表版を全件版へ）, `+apps/site/src/components/VideoPlayerIsland.tsx`, `+apps/site/src/components/VideoInteractionIsland.tsx`
- 触らない: `app/(public)/[id]/**`, `app/api/videos/**`, Cloudflare の Route 設定
#### Micro-units
- U01〜U04 と Final audit は [`TASK_MICRO_UNITS.md`](TASK_MICRO_UNITS.md) MIG-0507 のとおり。root slug の解決は MIG-0404 の route map を使い、固定ルートと asset path の後に適用する。
#### Test cases
| ID | 入力/操作 | 期待 |
| --- | --- | --- |
| T01 | `/event`, `/admin`, `/api`, `/user`, `/dashboard` と同じ作品ID | 固定ルートが優先、build で衝突を検出 |
| T02 | 作品の公開→非公開、非公開→公開 | 可視性フェンスどおり |
| T03 | Active X 0件・複数のユーザーがいいね | CURRENT と同じ 403/202/モーダル誘導 |
| T04 | YouTube の埋め込み失敗 | CURRENT と同じ劣化表示 |
| T05 | OGP・共有サムネイル | CURRENT と一致 |
#### Commands
```bash
npm run build --workspace=@flamenode/site
node --test --experimental-strip-types scripts/migration-route-map.test.mjs
node scripts/check-public-site-build-budget.mjs
npm run check:public-visibility-fences
npm run typecheck
```
#### Ledger updates
`FILE_MIGRATION_MATRIX.md` の `app/(public)/[id]/page.tsx` を IN_PROGRESS。`PERF_HOTPATH_MATRIX.md` の root video 行に証跡。
#### DONE checklist
- [ ] U01〜U04 と Final audit が DONE
- [ ] Cloudflare に `/:id` の glob Route を登録する設計になっていない
- [ ] 衝突と CPU p99 のテスト結果がPRにある
#### STOP
- `/:id` を Cloudflare Route に直接登録する必要が出たら止める。
- Active X の切替（D-04）を本MIGで実行する必要が出たら止める（別承認）。
#### Rollback
Phase 5 共通契約のとおり。

### MIG-0509: 全公開データの生成を build 時へ移す（D-09）
- **Model:** lead
- **Readiness:** NEEDS_REFINEMENT — MIG-0501〜0507 の merge 後。MIG-0409 の分類表で「build」とした family を1つずつ micro-unit に分けてから。「Queue」とした個別ページは MIG-0411 の仕組みで作り、この task では build に入れない
- **Recipe:** R-BUILD
- **Runtime:** N
- **Depends on:** MIG-0507 / **Decisions:** D-06 DECIDED, D-09 DECIDED
- **Verified against:** `96f20dc` (2026-10-15)
#### Source snapshot
- CURRENT の R2 artifact と生成箇所: `workers/json-generator/rebuild.ts`（`top.json` :1076、`list/*.json` :1142・:1164、`events/*` :1189・:1978〜2326、`search-index-lite.json` :1482、検索 posting :1626、`videos/{id}.json` :3186、`users/*` :3236〜3730、`rules/current.json` :3501、`recommend*.json` :3539・:3564）。
- 生成を起こすだけの段（build へ移すと不要になる）: `workers/content-jobs/index.ts:201`（deploy 後の全体再生成）、`:211〜269`（不足 artifact の補充）、`:303`（event playlist の backfill）、`:318`（top の日替わり）、`workers/sync-jobs/index.ts:205`（score 後の人気順の再生成）。
- GA4 の人気順は `workers/ga-analytics/sync.ts:156` が R2 の `list/recent.json` を読み、`:206` で `analytics/trending.json` を書く。
- build 要求の記録先: MIG-0410 の `public_build_state.requested_at`。CURRENT の再生成の入口は `src/lib/audit/mutate.ts:472`、`src/lib/staticRebuild/enqueue.ts:327`、`src/lib/staticRebuild/directEnqueue.ts:172`。
#### Owned paths
- 新規: `+apps/site/scripts/readPublicData/<family>.ts`（family ごとに1 file）と同名の `*.test.mjs`
- 変更: `apps/site/src/lib/publicDataLoader.ts`（読み先を R2 artifact から build 時の D1 読み取りへ）、`workers/ga-analytics/sync.ts`（入力を R2 の `list/recent.json` から D1 の `LIMIT` 付き query へ）、`src/lib/audit/mutate.ts`（`requested_at` の更新を1行足す）
- 触らない: `workers/json-generator/**`（CURRENT の Next が読む間は動かす。消すのは MIG-0907）
#### Micro-units
- **U01..Unn family**: MIG-0409 の表で「build」とした family ごとに1 unit。各 unit は U01 of MIG-0409 と同じ形（CURRENT の生成関数と同じ fixture で出力が一致する test）で作り、`publicDataLoader.ts` の読み先を切り替える。
- **Unn+1 request mark**: 公開データを変える CURRENT の更新が、static rebuild の enqueue と同じ場所で `public_build_state.requested_at` も更新するようにする（新旧の両方が動く期間のため）。
- **Unn+2 GA4**: GA4 の同期 job の入力を D1 の query に変える。出力（`analytics/trending.json`、最大 200件。`workers/ga-analytics/ranking.ts:29`）は変えない。
#### Test cases
| ID | 入力/操作 | 期待 |
| --- | --- | --- |
| T01 | family ごとの fixture | CURRENT の artifact と一致 |
| T02 | 非公開・削除済み | どの family の出力にも含まれない |
| T03 | 公開データを変える更新 | `requested_at` が更新される |
| T04 | 公開データを変えない更新（下書きなど） | `requested_at` が変わらない |
| T05 | `rg -n "env\.(BUCKET\|R2)" apps/site/src` | 0件（`apps/site` が R2 artifact を読まない） |
#### Commands
```bash
node --test --experimental-strip-types apps/site/scripts/readPublicData/*.test.mjs
npm run build --workspace=@flamenode/site
node scripts/check-public-site-build-budget.mjs
npm run test:unit
```
#### Ledger updates
`FILE_MIGRATION_MATRIX.md` の各 family の行を BRIDGED にし、PR・SHA・test を記入。`BUILD_TIME_DATA.md` の表に移した PR を記入。
#### DONE checklist
- [ ] 「build」に分類した全 family の一致 test が PASS
- [ ] `apps/site` が R2 artifact を読まない
- [ ] build 時間が MIG-0409 で承認した値の範囲内（5回の実測）
#### STOP
- family の出力が CURRENT と一致しない理由が CURRENT の不具合に見えたら、直さずに PR の「ブラッシュアップ提案」に書く（`CODE_QUALITY.md`）。privacy に関わる場合は止めて報告する。
- build 時間が承認した値を超えたら止める。
#### Rollback
PRをrevert。CURRENT の json-generator は動いたままなので、公開ページは影響を受けない。

### MIG-0508: Phase 5 Gate
- **Model:** lead
- **Readiness:** NEEDS_REFINEMENT — Phase Gate はエージェントが自動承認しない
- **Recipe:** R-EVIDENCE
- **Runtime:** N
- **Depends on:** MIG-0507, MIG-0509, MIG-0607 / **Decisions:** D-02 DECIDED, D-06 DECIDED, D-08 DECIDED, D-09 DECIDED
- **Verified against:** `aacf4fd` (2026-10-15)
#### Source snapshot
- `CURRENT_ROUTES.md` の Public 16 ルート（VISUAL_SCREEN 13 + COMPAT_REDIRECT 3）と `ROUTE_MATRIX.md`。
- MIG-0501〜0507 の merge 済みPR。
#### Owned paths
- 新規: `+docs/migration/design/PHASE_5_GATE.md`
- 変更: `docs/migration/ROUTE_MATRIX.md`（16ルートの disposition と証跡）, `docs/migration/STATUS.md`（承認後だけ）
#### Micro-units
- **U01 matrix**: 16ルートすべてに legacy→new の対応、URL・スクリーンショット・テスト・rollback の証跡を付ける。公開系 UX の取りこぼしを数える。
- **U02 review**: 独立レビューと人間の Phase Gate 承認を依頼。
#### Test cases
| ID | 入力/操作 | 期待 |
| --- | --- | --- |
| T01 | 16ルート × 公開/非公開/alias | すべて期待どおり |
| T02 | SEO/OGP | CURRENT と一致 |
| T03 | 直接再読込・スマホ・キーボード | 16ルートで問題なし |
#### Commands
```bash
npm run build --workspace=@flamenode/site
node scripts/check-public-site-build-budget.mjs
npm run check:public-visibility-fences
npm run check:project-docs
```
#### Ledger updates
承認後に `STATUS.md` の MIG-0508 を DONE。
#### DONE checklist
- [ ] 16ルートの証跡が揃っている
- [ ] 公開データがすべて build 時に作られている（MIG-0509）
- [ ] 独立レビューの APPROVE と人間の Phase Gate 承認
- [ ] 旧 Next の Auth/API/非公開経路に触れていない
#### STOP
- 人間の承認なしに STATUS を DONE にしない。
#### Rollback
Gate 文書のPRをrevert。
