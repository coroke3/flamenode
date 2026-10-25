# FlameNode Phase 4 & 5 タスク仕様書（Public Astro SSG & Islands Spec）

> 状態: Active / Phase 4 & 5 実行向け仕様書
> 最終検証: 2026-10-09（`CURRENT_ROUTES.md` の Public 16 ルートおよび `ROUTE_MATRIX.md` に基づき改定）
> 対象モデル: Claude / Codex / Antigravity / GPT-5.6-luna / Gemini Flash 等の全エージェント
> 関連ドキュメント: [`README.md`](README.md), [`STATUS.md`](STATUS.md), [`CURRENT_ROUTES.md`](CURRENT_ROUTES.md), [`ROUTE_MATRIX.md`](ROUTE_MATRIX.md), [`OPEN_DECISIONS.md`](OPEN_DECISIONS.md) (D-02, D-06, D-08)
> **実行の正本:** 個別MIGの手順・停止条件・検証は本仕様書の `### MIG-XXXX:` Work Order。[`TASK_CARDS_4_5.md`](TASK_CARDS_4_5.md) は概要索引、CURRENT code/tests は実挙動の正本、[`STATUS.md`](STATUS.md) はmainへ統合済み進捗の正本。`npm run migration:next` はWork Orderと対応カードを併記し、矛盾時はLead確認までSTOP。

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
- PR #283 の変更（2026-10-16 merge済み、MIG-0401 DONE）: `apps/site/src/lib/publicDataLoader.ts`（manifest の allow/deny、generation、sha256、`{kind,id,title}` だけの strict projection）、`apps/site/src/pages/migration-fixture-poc/[id].astro`、`scripts/migration-public-snapshot.test.mjs`、`scripts/check-migration-public-poc-build.mjs`。
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
- PR #283（merge済み）の `apps/site/src/lib/publicDataLoader.ts` は manifest の allow/deny・generation・sha256 を検証し、`{ kind, id, title }` だけを返す。
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
- **Readiness:** NEEDS_REFINEMENT — MIG-0401（PR #283）は DONE。canonical/alias の出所（R2 artifact か build 時 D1 read-only か）を決める
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
- **Readiness:** NEEDS_REFINEMENT — DONE（D-13-10、2026-10-25）。記録として残す。残りの owner 手順は MIG-0509
- **Recipe:** R-BUILD
- **Runtime:** N
- **Depends on:** MIG-0404 / **Decisions:** D-06 DECIDED, D-09 DECIDED
- **Verified against:** `7a19a42` (2026-10-25)
#### Source snapshot
- merge 済み: PR #323（merge `4f90bc9d`、Head `b54f2f92`）。`apps/site/scripts/readPublicData.ts`（`buildEventsIndexData` :248、`openD1HttpReader` :364、`MAX_D1_HTTP_STATEMENTS = 19` :348）、`readPublicData.test.mjs`（18/18）、`measurePublicData.mjs`、`queue-cpu-probe/`、`docs/migration/static-delivery/BUILD_TIME_DATA.md`。
- CURRENT の比較相手: `workers/json-generator/rebuild.ts` `rebuildTarget(env, "events_index")`（T01 は同じ SQLite に両方を流して byte 比較）。
- owner 決定（2026-10-18）: 公開遅延 ≈ 60 min + build を承認、定数 52 / 1,661,539、D1 読み取りは A（read-only token）。
#### Owned paths
- 新規（merge 済み）: `apps/site/scripts/readPublicData.ts`, `apps/site/scripts/readPublicData.test.mjs`, `apps/site/scripts/measurePublicData.mjs`, `apps/site/scripts/queue-cpu-probe/worker.ts`, `apps/site/scripts/queue-cpu-probe/worker.test.mjs`, `apps/site/scripts/queue-cpu-probe/wrangler.jsonc`, `docs/migration/static-delivery/BUILD_TIME_DATA.md`
- 触らない: `workers/json-generator/**`, 本番の D1・token・deploy hook
#### Micro-units
- **U01 one family**: DONE（df555ba / 9b514ed、T01 CURRENT 一致）。
- **U02 freshness table**: DONE（`BUILD_TIME_DATA.md` §1）。
- **U03 build budget**: local 5 回 DONE（42564d8、14.25–22.66 s）。Workers Builds 5 回の再測は MIG-0509 の owner 手順。
- **U04 new and private**: DONE（§3。新規ページは CURRENT どおり 404/503）。
- **U05 page render**: D-11 で consumer は描画しないため対象外（MIG-0411 U01 で描画経路を削除）。
- **U06 list shards**: 対象外（D-13-15。全 family を build で作る）。
- **U07 queue budget**: DONE（2026-10-23 非本番 probe、`ZERO_1102.md` §1）。
#### Test cases
| ID | 入力/操作 | 期待 |
| --- | --- | --- |
| T01 | 同じ fixture を CURRENT の生成関数と新しい関数に入れる | 出力の JSON が一致（PASS） |
| T02 | 非公開・削除済みの行を含む fixture | 出力に含まれない（PASS） |
| T03 | `MAX_` 定数ちょうどの件数 | 出力できる。上限 + 1 件で失敗（PASS） |
| T04 | 同じ入力で2回 | byte 一致（PASS） |
#### Commands
```bash
node --test --experimental-strip-types apps/site/scripts/readPublicData.test.mjs
node --test --experimental-strip-types apps/site/scripts/queue-cpu-probe/worker.test.mjs
npm run check:project-docs
```
#### Ledger updates
STATUS の MIG-0409 を DONE（D-13-10 の統合 PR）。`BUILD_TIME_DATA.md` §4 U07 見出しを「DONE 2026-10-23（ZERO_1102 §1）」に、§5 の「Choosing A or B ... pending user approval」を「A 決定 2026-10-18、token 作成は MIG-0509 owner 手順」に直す。
#### DONE checklist
- [x] 1 family の出力が CURRENT と一致する test が PASS（18/18）
- [x] 全項目に「build / API」の分類があり、API の項目は担当の MIG-06xx が書いてある（§1）
- [x] build 時間の実測5回と、1日の上限・最短間隔の計算が PR にある（local。Workers Builds の再測定は MIG-0509 の owner 手順）
- [x] 新規作品と非公開化の扱いが表にある（§3）
- [x] 個別ページの1件生成の CPU: D-11 により consumer は描画しない（MIG-0411 U01）。対象外
- [x] 一覧・検索の shard CPU: D-13-15 により対象外（全 family が build）
- [x] U07 の 3条件の `exceededCpu` 件数が `ZERO_1102.md` §1 にある
#### STOP
- 本番 D1 の読み取り、token や deploy hook の作成はこの task では行わない（MIG-0509 / MIG-0410 の owner 手順）。
#### Rollback
PR #323 を revert。本番には影響しない。

### MIG-0410: deploy hook を呼ぶ build 要求の確認（Cron、D-09）
- **Model:** lead
- **Readiness:** NEEDS_REFINEMENT — コードは #325 で merge 済み。残りは owner の本番手順（0065 の確認、Deploy Hook、secret、fast-jobs deploy）と証跡の記録だけ。agent の実装 unit は無い
- **Recipe:** R-JOB
- **Runtime:** B
- **Depends on:** MIG-0409 / **Decisions:** D-09 DECIDED
- **Verified against:** `7a19a42` (2026-10-25)
#### Source snapshot
- merge 済み: PR #325（merge `64781657`）。`workers/fast-jobs/publicBuildTrigger.ts`（`decidePublicBuild`、`checkAndTriggerPublicBuild`、SELECT :138、CAS UPDATE :160、失敗時の戻し :186）、`workers/fast-jobs/index.ts:197-216`（`public-build-trigger` 段）、`migrations/0065_public_build_state.sql`。test 14/14。
- 非本番 Cron CPU は記録済み: `work-items/MIG-0410.md` の 2026-10-23 checkpoint の表（`flamenode-fast-jobs-nonprod`、warm C1–C5 p95 11–16 ms、max 14–17 ms、cold C6 max 30 ms、outbox C7 max 33 ms）。B-add（段の増分 C1→C3 max 15→17 = +2 ms ≤ 2 ms）で PASS。`ZERO_1102.md` と `PERF_HOTPATH_MATRIX.md` には未記載。
- 本番 D1: migration 0066 は 2026-10-23 に `npm run db:remote-apply`（`scripts/apply-d1-migrations.mjs` = `wrangler d1 migrations apply --remote`、未適用を番号順に全部適用）で適用済み（`PHASE_4_GATE.md` §5）。0065 の適用は文書に記録が無いが、同じ実行で先に適用されたはず。owner が read-only の一覧で確かめる。
- `public_build_state.requested_at` を書く経路はまだ無い（`rg public_build_state` は reader と schema だけ）。書くのは MIG-0509 U05。それまで本番の段は毎時 `skip`（T01 と同じ）で無害。
#### Owned paths
- 新規（merge 済み）: `workers/fast-jobs/publicBuildTrigger.ts`, `workers/fast-jobs/publicBuildTrigger.test.mjs`, `migrations/0065_public_build_state.sql`
- 変更: `docs/migration/work-items/MIG-0410.md`（証跡の記録だけ）, `docs/migration/PERF_HOTPATH_MATRIX.md`（非本番 Cron CPU 表の転記）
- 触らない: `workers/fast-jobs/wrangler.toml` の `crons`、本番の secret、本番の D1
#### Micro-units
- **U01–U04**: DONE（#325）。
- **U05 evidence**（owner 手順の後、agent が記録）: owner が STOP の手順 1–4 を終えたら、`work-items/MIG-0410.md` に (a) `wrangler d1 migrations list flamenode_db --remote` で 0065 が applied の出力、(b) hook 作成日時（URL は書かない）、(c) secret 登録の事実、(d) deploy 後最初の Cron の `public-build-trigger` counter（`skipped: 1` が期待）を書く。非本番 Cron CPU の表を `PERF_HOTPATH_MATRIX.md` に転記する。
#### Test cases
| ID | 入力/操作 | 期待 |
| --- | --- | --- |
| T01–T07 | `publicBuildTrigger.test.mjs` | PASS（merge 済み、14/14） |
| T08 | 本番 deploy 後の最初の Cron | `public-build-trigger` が `skipped: 1`、例外なし、hook 0 回（requested_at = 0） |
#### Commands
```bash
node --test --experimental-strip-types workers/fast-jobs/publicBuildTrigger.test.mjs
node --test --experimental-strip-types workers/fast-jobs/index.test.mjs
npm run check:project-docs
```
#### Ledger updates
`PERF_HOTPATH_MATRIX.md` に非本番 Cron CPU（C1–C7）を条件付きで記録。STATUS の MIG-0410 は U05 の後に DONE。
#### DONE checklist
- [x] T01〜T07 が PASS
- [x] B-add: public-build-trigger の段の増分 ≤ 2 ms（非本番、+2 ms）。fast-jobs 全体は MIG-0609 / MIG-0610
- [ ] 本番で 0065 が applied、Deploy Hook と secret が登録済み、fast-jobs が deploy 済み（owner、各明示承認）
- [ ] T08 の証跡が work item にある
#### STOP
- 以下は owner の本番手順。agent は実行しない。各手順の直前に明示承認を得る。
  1. read-only 確認: `npx wrangler d1 migrations list flamenode_db --remote`。0065 が未適用なら `npm run db:remote-apply`（D1 Time Travel bookmark を先に記録）。
  2. 公開 site の Workers Builds project（MIG-0509 の owner 手順 4 で作る）→ Settings → Build → Deploy Hooks で production branch の hook を作る。
  3. `npx wrangler secret put PUBLIC_BUILD_DEPLOY_HOOK_URL --config workers/fast-jobs/wrangler.toml`（URL を commit・log しない）。
  4. `flamenode-fast-jobs` を通常の本番経路で deploy。
- 新しい cron 式が必要に見えたら止める（Free の上限 5個）。
#### Rollback
PR #325 を revert。`public_build_state` は未使用のまま残っても害はない。secret を消すと段は no-op（T07）。

### MIG-0411: 個別ページを1件ずつ Queue で R2 HTML に作り直す（ISR 相当、D-09）
- **Model:** lead
- **Readiness:** NEEDS_REFINEMENT — MIG-0405 / MIG-0409 DONE で着手可。描画経路の削除（D-11 follow-up A）は test の書き換えに判断が要るため lead。Queue 作成・binding・stylesheet 設定は owner 手順
- **Recipe:** R-JOB, R-GATEWAY
- **Runtime:** B, S1
- **Depends on:** MIG-0405, MIG-0409 / **Decisions:** D-06 DECIDED, D-09 DECIDED, D-11 DECIDED
- **Verified against:** `7a19a42` (2026-10-25)
#### Source snapshot
- merge 済み: PR #326（merge `45edac4f`、Head `5f46ab33`）。本番 D1 に 0066 を 2026-10-23 適用済み（bookmark `000040fb-00000000-0000510d-0fe59f1506fe91415c0e0c0f10c1f92d`）。Queue・R2・binding は未作成。
- consumer: `apps/site/src/gateway/pageRenderQueue.ts` `processPageRender` :193-277。公開の行は `PAGE_BODY_FORMAT[kind] === "excluded"` で `excluded_kind` に終わる（:264）。描画は :266-276（`renderPublicPage`、`parseStylesheets(env.PUBLIC_PAGE_STYLESHEETS)`、`r2.put`）。`ENTITY_SQL` :154-170 は描画用の列も読む。`isPublicRow` :173。`recoverPendingPageRenders` :327-344（未配線）。
- `apps/site/src/gateway/renderPublicPage.ts`: `PAGE_BODY_FORMAT` :56（3種とも `excluded`）、`PageRenderEntityKind` :44、`PublicPageRow` :63。React / UI / `publicPages.ts` を読み込む。
- gateway: `index.ts` `GatewayEnv.REBUILD_QUEUE` :43、`PUBLIC_PAGE_STYLESHEETS` :52、`queue()` :284-298（:294 で stylesheet を渡す）。
- P2（未修正）: `apps/site/src/gateway/r2Html.ts` `requestRebuild` :55-80。:68-69 で `recentRebuilds` に key を入れてから `queue.send`、:79 で reject を握りつぶすため、send が失敗するとその isolate では 60 秒間（`REBUILD_INTERVAL_MS` :46）同じ key の再要求が出ない。`queue.send` が同期 throw すると :79 の前で例外が上がる。
- D-11: consumer の本番の役割は DELETE + tracker close。D-13-13 により build は R2 に HTML を書かないので、R2 の HTML は存在せず、gateway の `rebuild-page` は Assets と R2 の両方に無いときだけ出る。
#### Owned paths
- 新規: `+apps/site/src/gateway/pageRenderRecovery.ts`（`recoverPendingPageRenders` を移す。import 0）, `+workers/fast-jobs/pageRenderRecovery.test.mjs`
- 変更: `apps/site/src/gateway/pageRenderQueue.ts`, `apps/site/src/gateway/pageRenderQueue.test.mjs`, `apps/site/src/gateway/index.ts`, `apps/site/src/gateway/r2Html.ts`, `scripts/migration-gateway.test.mjs`, `workers/fast-jobs/index.ts`, `docs/migration/FILE_MIGRATION_MATRIX.md`, `docs/migration/static-delivery/BUILD_TIME_DATA.md`
- 削除: `apps/site/src/gateway/renderPublicPage.ts`, `apps/site/src/gateway/renderPublicPage.measure.mjs`
- 触らない: `workers/fast-jobs/wrangler.toml`（producer binding は owner 手順）、`workers/json-generator/**`、本番の Queue・R2・D1
#### Micro-units
- **U01 render path removal（D-11 follow-up A）**: `renderPublicPage.ts` と `renderPublicPage.measure.mjs` を消す。`PageRenderEntityKind` を `pageRenderQueue.ts` に移し、`PAGE_BODY_FORMAT` は使わない（公開の行は常に `finish({ action: "excluded_kind", ... })`）。`ENTITY_SQL` は可視性の列だけにする（video: `id, visibility_status` / user: `id, approval_status`（`lower(id) = ?` は維持）/ event: `id, visibility_status`）。`PageRenderEnv` と `GatewayEnv` から `PUBLIC_PAGE_STYLESHEETS` を消し、`index.ts:294` から渡さない。`pageRenderQueue.test.mjs` の byte-equal characterization と `MECHANICS_FORMAT` 上書きの test を「公開 = `excluded_kind`、R2 put 0 回」「非公開・revoke・not_routed = delete」に置き換える。gateway の dry-run bundle（`wrangler deploy --dry-run`、#326 で 577 KiB / 107 KiB gzip）を測り直して PR に書く。
- **U02 P2 fix**: `requestRebuild` で `queue.send` の同期 throw と reject の両方を捕まえ、失敗時は `recentRebuilds.get(key) === now` のときだけ `recentRebuilds.delete(key)` する（次の訪問で再要求できる）。`migration-gateway.test.mjs` の F-02 test（:305）に「send が reject → 同じ isolate の次の要求で send が再び呼ばれる」「同期 throw でも 503 のまま」を足す。
- **U03 recovery module + Cron host（D-13-21）**: `recoverPendingPageRenders` と `MAX_RECOVERY_DOORBELLS` を `pageRenderRecovery.ts`（import 0、型は structural）へ移し、`pageRenderQueue.ts` から re-export する。`workers/fast-jobs/index.ts` の `Env` に `PAGE_RENDER_QUEUE?: { send(body: unknown): Promise<void> }` を足し、`public-build-trigger` 段（:197-216）の直後に同じ形の `page-render-recovery` 段を足す（binding が無ければ D1 0 statement で `skipped: 1`、あれば SELECT 1本 + doorbell ≤ 5）。binding 名は fast-jobs 側の producer で、gateway 側は `REBUILD_QUEUE`（D-13-20）。
- **U04 B-new 計測（local）**: DELETE 経路（not_public → `r2.delete` → CAS）と excluded 経路を `pageRenderQueue.test.mjs` で n=200 回し、local の max を PR に書く（workerd ではない）。非本番 Worker での計測は STOP の承認後。
- **U05 docs**: `BUILD_TIME_DATA.md` §6 の Queue 見積りを「doorbell ≤ 1,460 + recovery ≤ 120 + gateway miss（Assets にも R2 にも無いときだけ、D-13-13）」に直し、35,000/日の項を削る。`FILE_MIGRATION_MATRIX.md` の `renderPublicPage.ts` / `renderPublicPage.measure.mjs` 行（:674-675）を削除済みにする。
#### Test cases
| ID | 入力/操作 | 期待 |
| --- | --- | --- |
| T01 | 公開の作品の doorbell | `excluded_kind`、R2 put 0 回、tracker が閉じる |
| T02 | 公開→非公開 | R2 delete 1 回、gateway が 404（deny） |
| T03 | 処理中に同じ作品が再更新 | CAS が外れ `conflict_newer_request`、次の message で処理 |
| T04 | 同じ doorbell が2回 | 2回目は `skipped_up_to_date` |
| T05 | R2 delete が失敗 | retry、`rendered_version` が進まない |
| T06 | gateway の send が reject / 同期 throw | 503 のまま。次の要求で再送される（U02） |
| T07 | fast-jobs Cron、binding 無し / pending 3 行 | D1 0 statement / SELECT 1本 + send 3 回 |
| T08 | `rg -n "renderPublicPage\|PUBLIC_PAGE_STYLESHEETS" apps/site/src` | 0 件 |
#### Commands
```bash
node --test --experimental-strip-types apps/site/src/gateway/pageRenderQueue.test.mjs
node --test --experimental-strip-types scripts/migration-gateway.test.mjs
node --test --experimental-strip-types workers/fast-jobs/index.test.mjs workers/fast-jobs/pageRenderRecovery.test.mjs
npm run build --workspace=@flamenode/site
npm run typecheck
npm run check:project-docs
```
#### Ledger updates
`FILE_MIGRATION_MATRIX.md`: 削除 2 file、`pageRenderRecovery.ts` 追加。`BUILD_TIME_DATA.md` §6。`PERF_HOTPATH_MATRIX.md` に DELETE 経路の local max（条件付き）。
#### DONE checklist
- [ ] T01〜T08 が PASS
- [ ] D-11: 描画経路なし（DELETE + tracker close のみ）、bundle の再計測が PR にある
- [ ] 1日の message 見積りが Queue 無料枠の 50% 以下（D-13-13 後の式で `BUILD_TIME_DATA.md` §6）
- [ ] B-new: DELETE 経路の warm max < 8 ms を非本番 Worker で確認（owner 承認の後。未承認の間は local 値と「未計測」を書く）
- [ ] owner 手順 1–3 の証跡が work item にある
#### STOP
- owner 手順（agent は実行しない。各手順の直前に明示承認）:
  1. `npx wrangler queues create flamenode-page-renders`。
  2. gateway の wrangler 設定（MIG-0628 の deploy chain）に `queues.producers = [{ binding = "REBUILD_QUEUE", queue = "flamenode-page-renders" }]`、`queues.consumers = [{ queue = "flamenode-page-renders", max_batch_size = 1, max_concurrency = 1, max_retries = 3 }]`、`DB` / `R2_STORAGE` / `VISIBILITY_KV`。`PUBLIC_PAGE_STYLESHEETS` は U01 後は不要。
  3. `workers/fast-jobs/wrangler.toml` に `[[queues.producers]] queue = "flamenode-page-renders" binding = "PAGE_RENDER_QUEUE"` を足して deploy（Queue が無い状態で足すと deploy が失敗する）。
- 非本番 Worker / Queue での B-new 計測は、作る resource 名と消す手順を示して承認を得てから。
- doorbell を S3 の更新経路に配線する作業は MIG-0614 U06 の担当。ここでは触らない。
#### Rollback
PR を revert。0066 の表は残っても害はない。Queue 未作成の間は本番の挙動は変わらない。

### MIG-0407: Phase 4 Gate（**0403 + 0406 両方の証跡が必要**）
- **Model:** lead
- **Readiness:** NEEDS_REFINEMENT — Phase Gate はエージェントが自動承認しない
- **Recipe:** R-EVIDENCE
- **Runtime:** N
- **Depends on:** MIG-0403, MIG-0406（2026-10-23 owner 判断で MIG-0410 / MIG-0411 を依存から外した。D-09 系の本番手順は PHASE_4_GATE.md §5 の承認時持ち越し） / **Decisions:** D-02 DECIDED, D-06 DECIDED, D-08 DECIDED, D-09 DECIDED
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
| `/rules` | SA-075 `acceptLatestTerms`（`app/(public)/rules/page.tsx:3,95`） | MIG-0636 |
| `/event/[id]/slots` | SA-056〜068（`src/components/event/SlotGrid.tsx:15`） | MIG-0604 |
| `/[id]` | SA-087 いいね（`src/components/video/InteractionButton.tsx:6`）, SA-012〜 チャプター（`ChapterComposer.tsx:7`）, SA-001/040 状態変更（`VideoStatusForm.tsx:7-8`） | MIG-0603 |
| 公開ヘッダー（全ルート） | SA-098 `setActiveXId`（`src/components/user/useActiveXSwitcher.ts:5`） | MIG-0636 |
| ログイン状態を使う Island 全般 | session の読み取り | MIG-0608 |

- 各MIG共通のコマンド: `npm run build --workspace=@flamenode/site`, `node scripts/check-public-site-build-budget.mjs`, `npm run check:public-visibility-fences`, `npm run typecheck`, `npm run check:project-docs`。
- 各MIG共通の Rollback: PRをrevert。本番 Route を切り替えた後の戻しは `ROUTING_AND_DEPLOY_PLAN.md` の手順（旧 Next Worker へ Route を戻す）で、その実行も明示承認事項。

### MIG-0501: fixed/static routes
- **Model:** small
- **Readiness:** READY_FOR_SMALL_MODEL — #340 で /about・/rules・shell・404/503 は merge 済み。残りは brand 資産の複製、/maintenance の layout 差し替え、画面確認、証跡の記録だけ。gateway の 404/503 は MIG-0512、/rules 同意 form は MIG-0510
- **Recipe:** R-PAGE
- **Runtime:** S0
- **Depends on:** MIG-0407 / **Decisions:** D-02 DECIDED, D-06 DECIDED, D-08 DECIDED, D-13-2, D-13-25, D-13-27, D-13-28, D-13-29, D-13-30
- **Verified against:** `7a19a42` (2026-10-25)
#### Source snapshot
- merge 済み（#340）: `apps/site/src/pages/about.astro`, `rules.astro`, `404.astro`（→ `dist/404.html`）, `503.astro`（→ `dist/503/index.html`）, `apps/site/src/layouts/PublicLayout.astro`, `apps/site/src/lib/pageHead.ts`, `aboutStats.ts`, `rulesLoader.ts`。試験は `scripts/migration-fixed-routes.test.mjs`, `scripts/migration-public-shell.test.mjs`。
- `PublicLayout.astro:63-70` と `pageHead.ts:8,26` は `/brand/flamenode-*.png|svg`, `/favicon.ico`, `/manifest.webmanifest` を参照するが、`apps/site/public/` には `_headers`, `_redirects`, `fonts/` しか無い。CURRENT は `public/brand/`（10 file）, `public/favicon.ico`, `public/manifest.webmanifest`, `public/logo.png`。
- `apps/site/src/pages/maintenance.astro:8-19` は `PublicPage.astro`（header 無し、`data-theme=dark` 固定）。CURRENT `app/(public)/maintenance/page.tsx` は `app/(public)/layout.tsx`（PublicHeader / PublicFooter）の中。
- about-stats の配線: `scripts/migration-snapshot-producers.test.mjs:130-142`（CURRENT RH-026 の数と deep-equal）, `:323-335`（実 build の `/about`）, `scripts/migration-public-shell.test.mjs:161`。
- mock: `docs/migration/mock/screenshots/About.*.jpg`, `Rules.*.jpg`, `Maintenance.*.jpg`。
#### Owned paths
- 新規: `+apps/site/public/brand/flamenode-apple-touch-icon.png`, `+apps/site/public/brand/flamenode-favicon.svg`, `+apps/site/public/brand/flamenode-icon-192.png`, `+apps/site/public/brand/flamenode-icon-32.png`, `+apps/site/public/brand/flamenode-icon-512.png`, `+apps/site/public/brand/flamenode-icon-maskable-512.png`, `+apps/site/public/brand/flamenode-mark.png`, `+apps/site/public/brand/flamenode-mark.svg`, `+apps/site/public/brand/flamenode-social-card.png`, `+apps/site/public/brand/flamenode-wordmark.svg`, `+apps/site/public/favicon.ico`, `+apps/site/public/manifest.webmanifest`, `+apps/site/public/logo.png`
- 変更: `apps/site/src/pages/maintenance.astro`, `scripts/migration-public-shell.test.mjs`, `docs/migration/work-items/MIG-0501.md`, `docs/migration/FILE_MIGRATION_MATRIX.md`（3行）
- 触らない: `apps/site/src/gateway/index.ts`, `apps/site/src/gateway/routeShards.ts`（MIG-0512）, `app/**`, `public/**`（複製元）, `apps/site/public/_headers`（MIG-0620）
#### Micro-units
- **U01 brand 資産（gap 5, D-13-30）**: CURRENT の13 file を byte 同一で複製し、`scripts/migration-public-shell.test.mjs` に test「G05: brand assets are CURRENT public/ files byte for byte」を足す（13 file それぞれで `fs.readFileSync("public" + f).equals(fs.readFileSync(path.join(DIST, f)))`、`{ skip }` は既存 test と同じ）。
```bash
mkdir -p apps/site/public/brand
cp public/brand/flamenode-apple-touch-icon.png public/brand/flamenode-favicon.svg public/brand/flamenode-icon-192.png public/brand/flamenode-icon-32.png public/brand/flamenode-icon-512.png public/brand/flamenode-icon-maskable-512.png public/brand/flamenode-mark.png public/brand/flamenode-mark.svg public/brand/flamenode-social-card.png public/brand/flamenode-wordmark.svg apps/site/public/brand/
cp public/favicon.ico public/manifest.webmanifest public/logo.png apps/site/public/
cmp public/manifest.webmanifest apps/site/public/manifest.webmanifest && echo same
```
  期待: `same`。site build 後 `dist/brand/` に10 file、`dist/favicon.ico` がある。
- **U02 /maintenance を PublicLayout へ（gap 7, D-13-27）**: `maintenance.astro` を `404.astro` と同じ形にする。`import PublicLayout from "../layouts/PublicLayout.astro"`、`import { buildPageHead } from "../lib/pageHead.ts"`、`const head = buildPageHead({ path: "/maintenance", title: "メンテナンス中", noIndex: true })`、本文は今の `<StaticScreen screen={MaintenanceView} props={{}} />` をそのまま `<PublicLayout head={head} currentPath="/maintenance">` で包む。`PublicPage` と `buildPageMetadata` の import を消す。`scripts/migration-public-shell.test.mjs` の G08（:35）と G06（:77）の route 配列へ `"maintenance/index.html"` を足し、冒頭コメント（:2）の「/maintenance is MIG-0619-owned (PublicPage, no JS)」を「/maintenance uses PublicLayout (D-13-27)」に直す。
```bash
npm run build --workspace=@flamenode/ui && npm run build --workspace=@flamenode/site
grep -c 'name="robots" content="noindex, nofollow"' apps/site/dist/maintenance/index.html
REQUIRE_BUILT=1 node --test --test-concurrency=1 --experimental-strip-types scripts/migration-public-shell.test.mjs scripts/migration-fixed-routes.test.mjs
```
  期待: grep が `1`、test は 0 fail / 0 skipped。
- **U03 画面確認（gap 6, D-13-28）**: 下の block を1回で実行し、6 route × 2 幅の png を mock と見比べ、差を (a)(b)(c) に分ける（mock 名: about→About, rules→Rules, maintenance→Maintenance。404/503 は mock 無し、(c) 判定の対象外で崩れだけ見る）。
```bash
OUT=$(mktemp -d); SHOTS=$(mktemp -d)
(cd apps/site && node ../../node_modules/astro/astro.js build --outDir "$OUT")
python3 -m http.server 4329 --bind 127.0.0.1 --directory "$OUT" >/dev/null 2>&1 & SERVER=$!
sleep 1
for r in about rules maintenance 503; do
  playwright screenshot --full-page --color-scheme=dark --wait-for-timeout=800 --viewport-size=390,844 "http://127.0.0.1:4329/$r/" "$SHOTS/$r.mobile.png"
  playwright screenshot --full-page --color-scheme=dark --wait-for-timeout=800 --viewport-size=1440,900 "http://127.0.0.1:4329/$r/" "$SHOTS/$r.desktop.png"
done
playwright screenshot --full-page --color-scheme=dark --viewport-size=390,844 "http://127.0.0.1:4329/404.html" "$SHOTS/404.mobile.png"
playwright screenshot --full-page --color-scheme=dark --viewport-size=1440,900 "http://127.0.0.1:4329/404.html" "$SHOTS/404.desktop.png"
kill $SERVER; ls -la "$SHOTS"
```
  期待: png が10枚（各 0 byte 超）。(c) が0件。(c) があれば STOP。
- **U04 about-stats の配線確認（gap 1, D-13-29）**: コードは変えない。下を実行し、結果を work item の Validation に書く。
```bash
REQUIRE_BUILT=1 node --test --test-concurrency=1 --experimental-strip-types scripts/migration-snapshot-producers.test.mjs
```
  期待: 「loaders accept the output: about-stats equals CURRENT RH-026 counts…」と「e2e: astro build reads the produced snapshots…」が pass、0 skipped。
- **U05 記録**: work item の Parity gaps を書き換える: 1 → 閉（U04 証跡）、2 → MIG-0510、3 → MIG-0507、4 → そのまま（`rules/error.tsx` 相当は build 失敗で代替）、5 → 閉（U01）、6 → 閉（U03）、7 → 閉（U02）。G10 の「gateway は plain-text」は MIG-0512 へ移したと書く。Ledger updates を反映。

#### Test cases
| ID | 入力/操作 | 期待 |
| --- | --- | --- |
| T01 | build 出力の brand 13 file | CURRENT `public/` と byte 同一 |
| T02 | `/maintenance` の HTML | `PublicLayout` の header・theme bootstrap・site JSON-LD があり、robots は `noindex, nofollow`。G10/G23 の文言 test は pass のまま |
| T03 | 390 / 1440 の画面確認 | (c) の差が0件 |
| T04 | about-stats の producer → loader → build | `migration-snapshot-producers.test.mjs` の2 test が pass |
| T05 | 既存の fixed-route / shell test | 0 fail / 0 skipped |
#### Commands
PR の前に repo root で全部 pass させる。
```bash
npm ci
npm run build --workspace=@flamenode/ui
npm run build --workspace=@flamenode/site
REQUIRE_BUILT=1 node --test --test-concurrency=1 --experimental-strip-types scripts/migration-fixed-routes.test.mjs scripts/migration-public-shell.test.mjs scripts/migration-snapshot-producers.test.mjs
node --test --experimental-strip-types apps/site/src/gateway/edgePolicy.test.mjs apps/site/src/gateway/assetHeaders.test.mjs
node scripts/check-public-site-build-budget.mjs
npm run check:public-visibility-fences
npm run typecheck
npm run check:project-docs
npm run check:migration-work-items
```
#### Ledger updates
- `FILE_MIGRATION_MATRIX.md`: `app/(public)/about/page.tsx` → `PARITY_VERIFIED`（target の先頭 `+` を外す。`PR#`, `SHA=`, `TEST=` 上の REQUIRE_BUILT コマンド, `CI=` この PR の run URL）。`app/(public)/rules/page.tsx` → `IN_PROGRESS` のまま、証跡を更新し「同意 form は MIG-0510」と書く。`app/(public)/maintenance/page.tsx` → `PARITY_VERIFIED` のまま、target に `PublicLayout (D-13-27)` と書き、証跡をこの PR にする。
- `docs/migration/work-items/MIG-0501.md`: Owned paths に U01 の13 file、`maintenance.astro` を足す。
#### DONE checklist
- [ ] brand 13 file が dist にあり byte 同一（T01）
- [ ] `/maintenance` が PublicLayout（T02）
- [ ] 画面確認の (c) が0件で、PR 本文に route × 幅 × 分類がある（T03）
- [ ] about-stats の証跡が work item にある（T04）
- [ ] 本番 Route・Custom Domain・Remote D1・secret に触れていない
#### STOP
- `apps/site/src/gateway/**` を変える必要が出たら止める（MIG-0512）。
- 画面確認で (c) の差が出たら直さず止めて lead へ返す。
- `/rules` の同意 form・`next`・`?error=` を足す必要が出たら止める（MIG-0510）。
- 本番 Route の切替（`/about` を先行させる場合も）は owner の明示承認事項。PR では行わない。
#### Rollback
PR を revert。brand 資産は複製なので CURRENT に影響しない。本番 Route を切り替えた後の戻しは Phase 5 共通契約のとおり。

### MIG-0502: event routes
- **Model:** lead
- **Readiness:** NEEDS_REFINEMENT — #355 で U01〜U07 は merge 済み。残りは EventRecruitCard と accent theme の移植（見た目と状態の parity 判断）、IME guard、重複 key の記録、画面確認。決定は全部ここに書いた。予約 Island は MIG-0510、icon map は MIG-0511、release 404 と slots の fence は MIG-0512
- **Recipe:** R-PAGE
- **Runtime:** S0
- **Depends on:** MIG-0407 / **Decisions:** D-02 DECIDED, D-06 DECIDED, D-08 DECIDED, D-11 DECIDED, D-13-2, D-13-3, D-13-25, D-13-28, D-13-31, D-13-32, D-13-33, D-13-37, D-13-39
- **Verified against:** `7a19a42` (2026-10-25)
#### Source snapshot
- merge 済み: `apps/site/src/pages/event/index.astro`, `event/[id]/index.astro`, `event/[id]/slots.astro`, `event/[id]/release.astro`, `apps/site/src/lib/eventData.ts`, `eventIndex.ts`, `eventDetail.ts`, `eventSlots.ts`, `eventRelease.ts`, `liveSlots.ts`, `apps/site/src/components/EventDetailIsland.ts`（`fetchLiveSlots` で RH-020 の数を入れる、:19-33）, `packages/ui/src/screens/EventsIndexView.tsx`, `EventSlotsView.tsx`, `EventReleaseView.tsx`, `EventDetailView.tsx`。試験は `scripts/migration-event-routes.test.mjs`。
- CURRENT `/event/[id]`: accent `app/(public)/event/[id]/page.tsx:176-178`（`buildAccentVars(event.accent_color, "dark")` を root の style）、EventRecruitCard `:269-277`（status ≠ ended、CTA は 投稿期間→`/entry` 作品を提出する / 受付中→`/event/{id}/slots` 枠を確保する / 枠あり→枠表へ）。`/slots` の accent は `slots/page.tsx:218`。部品 `src/components/layout/EventRecruitCard.tsx`（463行）。
- 移植済みの recruit card: `packages/ui/src/screens/TopView.tsx:20-35`（`TopRecruit`）, `:85`（`Recruit`、export されていない）, `apps/site/src/lib/topData.ts:77,90,104`（`recruitState`, `recruitCountdown`, `toRecruit`）。group の accent は `eventIndex.ts:252-253` で済み。
- `/event` 検索 form は素の `<form>`（`EventsIndexView.tsx:121-169`）。CURRENT は `ImeSafeGetForm`（`app/(public)/event/EventIndexView.tsx:7,264`）。
- 重複 key: `eventIndex.ts:98` は `params.get("q")`（最初の値）。CURRENT `EventIndexView.tsx:172` は `rawParams.q?.trim()` で配列だと TypeError。
- snapshot の key は producer 済み: `scripts/migration-snapshot-producers.test.mjs:336`（`event/public-event/index.html`）。
- mock: `docs/migration/mock/screenshots/Events.*`, `EventDetail.*`, `EventSlots.*`, `EventRelease.*`。
#### Owned paths
- 変更: `packages/ui/src/screens/TopView.tsx`（`Recruit` を `RecruitCard` として export するだけ）, `packages/ui/src/screens/EventDetailView.tsx`, `packages/ui/src/screens/EventSlotsView.tsx`, `packages/ui/src/screens/EventsIndexView.tsx`, `apps/site/src/lib/eventDetail.ts`, `apps/site/src/lib/eventSlots.ts`, `scripts/migration-event-routes.test.mjs`, `docs/migration/work-items/MIG-0502.md`, `docs/migration/FILE_MIGRATION_MATRIX.md`（event 5行）
- 触らない: `app/(public)/event/**`, `app/api/live/**`, `apps/site/src/gateway/**`（MIG-0512）, `apps/site/src/lib/topData.ts`（MIG-0506 の file。model の計算は `eventDetail.ts` に置き、`recruitState` / `recruitCountdown` は import だけ）
#### Micro-units
- **U01 accent（gap 2 の前半, D-13-31）**: `buildEventDetailData` と `buildEventSlotsModel` に `accentStyle?: Record<string, string>` を足す（`accent_color?.trim()` が空でなければ `buildAccentVars(accent_color, "dark")`、`eventIndex.ts:252` と同じ形）。`EventDetailView` / `EventSlotsView` の root `div` に `style={accentStyle}`。test: accent ありの fixture `autumn-collab-2026` の HTML の root に `--event-accent` があり、`past-event-2020`（null）には無い。
- **U02 recruit card（gap 2 の後半, D-13-31）**: `TopView.tsx` で `export { Recruit as RecruitCard }`。`eventDetail.ts` で `TopRecruit` を作る（`recruitState(event, live?.available ?? null, now)`、`recruitCountdown`、CTA は CURRENT `:274-275` の3分岐）。`EventDetailView` は status ≠ ended のときだけ metrics の後に `<RecruitCard event={recruit} primary />` を出す。build の HTML では `slotFilled` / `slotTotal` が null（`–`）、Island が RH-020 の結果で埋める（満枠は Island 後だけ）。ruler は描かない（top と同じ divergence を work item の表へ）。test: 受付中・開始前・終了の3 fixture で表示の有無と見出し、CTA を CURRENT の文言と照合。
- **U03 IME guard（gap 4, D-13-39）**: `EventsIndexView.tsx:121` の `<form role="search" method="get" action="/event" className="wrap-row ev-srch">` と `:169` の `</form>` を `ImeSafeGetForm` に替える（import は `CreatorsView.tsx:5` と同じ）。属性は変えない。
- **U04 重複 key（gap 5, D-13-32）**: `scripts/migration-event-routes.test.mjs` に `parseEventsQuery("?q=a&q=b&status=open&status=ended").q === "a"`、`.status === "open"` を足し、work item の CURRENT_DIVERGENCE 表に「重複 key: CURRENT は TypeError で error 画面、static は最初の値」を書く。
- **U05 画面確認（gap 6）**: 共通の手順で route `event/`, `event/autumn-collab-2026/`, `event/autumn-collab-2026/slots/`, `event/autumn-collab-2026/release/`（fixture build、snapshot env 無し）。mock: Events / EventDetail / EventSlots / EventRelease。
```bash
OUT=$(mktemp -d); SHOTS=$(mktemp -d)
(cd apps/site && node ../../node_modules/astro/astro.js build --outDir "$OUT")
python3 -m http.server 4329 --bind 127.0.0.1 --directory "$OUT" >/dev/null 2>&1 & SERVER=$!
sleep 1
for r in event event/autumn-collab-2026 event/autumn-collab-2026/slots event/autumn-collab-2026/release; do
  n=$(echo "$r" | tr '/' '_')
  playwright screenshot --full-page --color-scheme=dark --wait-for-timeout=800 --viewport-size=390,844 "http://127.0.0.1:4329/$r/" "$SHOTS/$n.mobile.png"
  playwright screenshot --full-page --color-scheme=dark --wait-for-timeout=800 --viewport-size=1440,900 "http://127.0.0.1:4329/$r/" "$SHOTS/$n.desktop.png"
done
kill $SERVER; ls -la "$SHOTS"
```
  期待: png 8枚。live API は static server に無いので枠は劣化表示（T05 と同じ）。(c) が0件。
- **U06 記録**: Parity gaps: 1 → MIG-0510、2 → 閉（icon は MIG-0511）、3 → D-13-37、4 → 閉、5 → 閉（divergence）、6 → 閉、7 → producer は閉（`migration-snapshot-producers.test.mjs:336`）、release の 404 status は MIG-0512、8・9・11〜13 → 情報として残す、10 → D-11。
#### Test cases
| ID | 入力/操作 | 期待 |
| --- | --- | --- |
| T01 | accent ありの event と無い event | 前者の root style に `--event-accent`、後者に無い（`/event/[id]` と `/slots`） |
| T02 | 受付中・開始前・終了の event | recruit card は前2つだけ。見出し・CTA が CURRENT `EventRecruitCard` / `page.tsx:274-275` と一致 |
| T03 | live API が満枠を返す | Island 後に満枠表示。build の HTML には枠数が無い |
| T04 | `/event` 検索 form | `ImeSafeGetForm` の `data-fn-ime-composing` 契約が有効、送信 URL は今と同じ |
| T05 | `?q=a&q=b` | `q=a` |
| T06 | 既存の event route test | 0 fail / 0 skipped |
| T07 | 画面確認 | (c) が0件 |
#### Commands
PR の前に repo root で全部 pass させる。
```bash
npm ci
npm run build --workspace=@flamenode/ui
npm run test --workspace=@flamenode/ui
npm run build --workspace=@flamenode/site
REQUIRE_BUILT=1 node --test --test-concurrency=1 --experimental-strip-types scripts/migration-event-routes.test.mjs scripts/migration-top-route.test.mjs scripts/migration-public-shell.test.mjs
node scripts/check-public-site-build-budget.mjs
npm run check:public-visibility-fences
npm run typecheck
npm run check:project-docs
```
#### Ledger updates
`FILE_MIGRATION_MATRIX.md`: `app/(public)/event/page.tsx`, `app/(public)/event/~query/page.tsx`, `app/(public)/event/[id]/release/page.tsx` → `PARITY_VERIFIED`（target の `+` を外す。release の route 404 status は MIG-0512 の行で証跡）。`app/(public)/event/[id]/page.tsx` → `IN_PROGRESS`（icon map は MIG-0511）。`app/(public)/event/[id]/slots/page.tsx` → `IN_PROGRESS`（予約は MIG-0510）。
#### DONE checklist
- [ ] T01〜T07 pass
- [ ] 枠のライブ表示と予約状態が静的 HTML に含まれていない
- [ ] 非公開イベントの HTML が0件
- [ ] `topCssScope` / `eventsCssScope` lint が pass（`npm run test --workspace=@flamenode/ui`）
#### STOP
- recruit card のために `topData.ts` を変える必要が出たら止める（MIG-0506 の file）。
- 枠の状態を request 時に描画する必要が出たら止める。
- 予約・解放・延長・viewer overlay を足す必要が出たら止める（MIG-0510）。
- 本番 Route の変更は明示承認事項。
#### Rollback
Phase 5 共通契約のとおり。

### MIG-0503: group compat routes
- **Model:** small
- **Readiness:** READY_FOR_SMALL_MODEL — #357 で `_redirects` と gateway の 307 は merge 済み。D-13-34 で source-read の証跡を受け入れたので、残りは証跡の記録と ledger だけ
- **Recipe:** R-PAGE
- **Runtime:** S0
- **Depends on:** MIG-0407 / **Decisions:** D-02 DECIDED, D-13-34
- **Verified against:** `7a19a42` (2026-10-25)
#### Source snapshot
- CURRENT: `app/(public)/groups/page.tsx:3-5`（`redirect("/event")`、307）、`app/(public)/groups/[slug]/page.tsx`（`/event#event-group-{slug}`, `src/lib/eventGroupRoutes.ts:5-7`）。
- 新: `apps/site/public/_redirects`（4行）と gateway `apps/site/src/gateway/index.ts:150-157`（`groupCompatRedirect`）, `:210-214`（307、query を落とす、`Cache-Control: no-store, private`）。
- 試験: `scripts/migration-group-routes.test.mjs`, `apps/site/src/gateway/edgePolicy.test.mjs`（"group compat redirects" 表）, local smoke `scripts/migration-groups-redirects.wrangler-smoke.mjs`。
- work item の Findings 表: gateway 経由は全行 CURRENT と一致。T03 は同じ URL（`%20` と空白）として同等。
#### Owned paths
- 変更: `docs/migration/work-items/MIG-0503.md`, `docs/migration/FILE_MIGRATION_MATRIX.md`（3行）
- 触らない: `apps/site/public/_redirects`, `apps/site/src/gateway/index.ts`, `app/(public)/groups/**`
#### Micro-units
- **U01 証跡の実行と記録**: 下を実行し、結果を work item の Validation に書く。Parity gaps 1 は「gateway が前提（ROUTING_AND_DEPLOY_PLAN の構成）なので閉」、2 は「D-13-34 で source-read を受け入れ。`/groups/` の 308→307 の2段は1段の307になる。最終 URL は同じ」と書く。
```bash
npm ci
npm run build --workspace=@flamenode/ui && npm run build --workspace=@flamenode/site
REQUIRE_BUILT=1 node --test --test-concurrency=1 --experimental-strip-types scripts/migration-group-routes.test.mjs
node --test --experimental-strip-types apps/site/src/gateway/edgePolicy.test.mjs
grep -c "^/groups" apps/site/dist/_redirects
```
  期待: 2つの test が 0 fail / 0 skipped、grep が `4`。
- **U02 ledger と状態**: Ledger updates を反映し、work item を `State: DONE`（Owner / Branch / PR はこの PR のもの）にする。
#### Test cases
| ID | 入力/操作 | 期待 |
| --- | --- | --- |
| T01 | `/groups`（gateway） | 307、`Location: /event` |
| T02 | `/groups/spring`（gateway） | 307、`Location: /event#event-group-spring` |
| T03 | `/groups/a%20b` | `/event#event-group-a%20b`（CURRENT の `a b` と同じ URL、D-13-34） |
| T04 | `/groups?x=1`（gateway） | 307、`Location: /event`（query を落とす） |
#### Commands
PR の前に repo root で全部 pass させる。
```bash
REQUIRE_BUILT=1 node --test --test-concurrency=1 --experimental-strip-types scripts/migration-group-routes.test.mjs
node --test --experimental-strip-types apps/site/src/gateway/edgePolicy.test.mjs
npm run check:project-docs
npm run check:migration-work-items
```
#### Ledger updates
`FILE_MIGRATION_MATRIX.md` の `app/(public)/groups/page.tsx`, `app/(public)/groups/[slug]/page.tsx`, `apps/site/public/_redirects` → `PARITY_VERIFIED`（target の先頭 `+` を外し、gateway `apps/site/src/gateway/index.ts` を併記。`TEST=` は上の2コマンド、`CI=` この PR の run URL）。
#### DONE checklist
- [ ] T01〜T04 が test で pass
- [ ] groups 用の画面を新しく作っていない
- [ ] work item に D-13-34 と T03 の同等判断が書かれている
#### STOP
- 307 以外になる、または fragment が落ちる test 結果が出たら止める。
- owner step（任意、agent は実行しない）: 本番 CURRENT に対して `curl -sI https://flamenode.net/groups`、`/groups/`、`/groups/spring`、`/groups/a%20b`、`/groups?x=1`、`/groups/spring?x=1` の status と `location` を記録すると、source-read の証跡を実測で置き換えられる。
#### Rollback
PR を revert（文書だけ）。

### MIG-0504: user routes
- **Model:** small
- **Readiness:** READY_FOR_SMALL_MODEL — #352 で U01〜U05 は merge 済み。残りは T03 の CURRENT 準拠への書き換え、HTML 量の試験、画面確認、記録。icon map は MIG-0511、`/user/index.json` の gateway は MIG-0512
- **Recipe:** R-PAGE
- **Runtime:** S0
- **Depends on:** MIG-0407 / **Decisions:** D-02 DECIDED, D-03 DECIDED, D-06 DECIDED, D-08 DECIDED, D-11 DECIDED, D-13-3, D-13-25, D-13-28, D-13-35, D-13-36
- **Verified against:** `7a19a42` (2026-10-25)
#### Source snapshot
- merge 済み: `apps/site/src/pages/user/index.astro`, `user/index.json.ts`, `user/[id]/index.astro`, `user/[id]/portfolio.astro`, `apps/site/src/lib/userData.ts`, `userViews.ts`（`buildSectionPages` :75-94、`USER_STATIC_DISPLAY_MAX_PAGES` = 15 :34-35、`USER_WORKS_DISPLAY_PAGE_SIZE` = 8 :31）, `apps/site/src/components/CreatorProfileIsland.ts`, `UsersIndexIsland.ts`。試験は `scripts/migration-user-routes.test.mjs`（`buildSectionPages` の使い方は :239-259）。
- CURRENT `app/(public)/user/[id]/UserProfilePage.tsx:115,148` は `normalizeXId`、未公開・不明は `notFound()`（:228, :242, :305, :307）。旧 ID の redirect は無い。
- gateway の大小文字畳み込み: `apps/site/src/gateway/routeShards.ts:44-48`、test `scripts/migration-gateway.test.mjs:175-184`。
- producer 済み: `scripts/migration-snapshot-producers.test.mjs:147-177, 328-332`。
- mock: `docs/migration/mock/screenshots/Creators.*`, `Creator.*`, `Portfolio.*`。fixture の user: `miku_producer`, `long_list`, `minimal_user`（`apps/site/src/lib/userFixtures.ts`）。
#### Owned paths
- 変更: `scripts/migration-user-routes.test.mjs`, `docs/migration/work-items/MIG-0504.md`, `docs/migration/FILE_MIGRATION_MATRIX.md`（user 5行）, `docs/migration/PHASE_4_5_SPEC.md`（この order の T03 行だけ、D-13-35）
- 触らない: `apps/site/src/gateway/**`（MIG-0512）, `app/(public)/user/**`, `src/lib/x/**`（icon map は MIG-0511）
#### Micro-units
- **U01 T03 と gap 1 の記録（D-13-35）**: T03 を「不明・merge 済みの X ID → CURRENT と同じ 404」に変える。gap 1 は「大小文字と `@` は gateway が畳む（routeShards.ts:44-48 と gateway test :175）。旧 ID の redirect は CURRENT に無い」と書いて閉じる。コードは変えない。
```bash
node --test --experimental-strip-types scripts/migration-gateway.test.mjs --test-name-pattern="normalizeXId"
```
  期待: 1 test pass。
- **U02 HTML 量（gap 3, D-13-36）**: `scripts/migration-user-routes.test.mjs` に test「G-size: profile Island props stay under 256 KiB at 15+15 display pages」を足す。`card = (i) => ({ id: "w" + i, title: "あ".repeat(100), youtube_video_id: "AAAAAAAAAAA", display_name: "い".repeat(30) })`。section は `{ total: 120, pageSize: 24, items: 24 件 }`、extra は `new Map([[2..5, { page, total: 120, pageSize: 24, generatedAt: null, items: 24 件 }]])`。`views.buildSectionPages(section, extra, 8, 24)` を works と collabs の両方に使う。`Buffer.byteLength(JSON.stringify({ works, collabs }), "utf8") <= 262144` を assert し、値を `console.log` する。`pages.length === 15` と全 page が非 null であることも assert する。
```bash
node --test --experimental-strip-types scripts/migration-user-routes.test.mjs --test-name-pattern="G-size"
```
  期待: pass し、log の byte 数を work item に書く。超えたら STOP。
- **U03 画面確認（gap 5）**: 共通の手順で `user/`, `user/miku_producer/`, `user/miku_producer/portfolio/`, `user/long_list/`（fixture build）。mock: Creators / Creator / Portfolio。
```bash
OUT=$(mktemp -d); SHOTS=$(mktemp -d)
(cd apps/site && node ../../node_modules/astro/astro.js build --outDir "$OUT")
python3 -m http.server 4329 --bind 127.0.0.1 --directory "$OUT" >/dev/null 2>&1 & SERVER=$!
sleep 1
for r in user user/miku_producer user/miku_producer/portfolio user/long_list; do
  n=$(echo "$r" | tr '/' '_')
  playwright screenshot --full-page --color-scheme=dark --wait-for-timeout=800 --viewport-size=390,844 "http://127.0.0.1:4329/$r/" "$SHOTS/$n.mobile.png"
  playwright screenshot --full-page --color-scheme=dark --wait-for-timeout=800 --viewport-size=1440,900 "http://127.0.0.1:4329/$r/" "$SHOTS/$n.desktop.png"
done
kill $SERVER; ls -la "$SHOTS"
```
  期待: png 8枚。(c) が0件。
- **U04 記録**: Parity gaps: 1 → 閉（U01）、2 → MIG-0511、3 → 閉（U02 の値）、4 → MIG-0512、5 → 閉（U03）、6 → MIG-0605 media routes（MIG-0508 経由）、7 → D-11。producer の証跡（`migration-snapshot-producers.test.mjs:147-177, 328-332`）を Validation に書く。
#### Test cases
| ID | 入力/操作 | 期待 |
| --- | --- | --- |
| T01 | 未承認・却下・merge 済みの X | page が無い（gateway 404）。既存の T01 snapshot loader test |
| T02 | 非公開作品を持つユーザー | 非公開作品が HTML に含まれない（既存） |
| T03 | 不明・merge 済みの X ID | CURRENT と同じ 404（D-13-35）。大小文字と `@` は gateway test で 200 |
| T04 | 15+15 page の最大 profile | props ≤ 262,144 byte |
| T05 | 既存の query key・JSON-LD test | 0 fail / 0 skipped |
| T06 | 画面確認 | (c) が0件 |
#### Commands
PR の前に repo root で全部 pass させる。
```bash
npm ci
npm run build --workspace=@flamenode/ui
npm run build --workspace=@flamenode/site
REQUIRE_BUILT=1 node --test --test-concurrency=1 --experimental-strip-types scripts/migration-user-routes.test.mjs scripts/migration-snapshot-producers.test.mjs
node --test --experimental-strip-types scripts/migration-gateway.test.mjs
node scripts/check-public-site-build-budget.mjs
npm run check:public-visibility-fences
npm run typecheck
npm run check:project-docs
```
#### Ledger updates
`FILE_MIGRATION_MATRIX.md`: `app/(public)/user/page.tsx`, `app/(public)/user/~query/page.tsx` → `PARITY_VERIFIED`（target の `+` を外す。gateway の `/user/index.json` は MIG-0512 の行）。`app/(public)/user/[id]/page.tsx`, `app/(public)/user/[id]/paged/page.tsx`, `app/(public)/user/[id]/portfolio/page.tsx` → `IN_PROGRESS`（icon map は MIG-0511）。`PERF_HOTPATH_MATRIX.md` の `/user/*` 行に U02 の byte 数。
#### DONE checklist
- [ ] T01〜T06 pass
- [ ] 非公開作品が HTML に含まれない
- [ ] T03 が CURRENT 準拠に書き換わっている
#### STOP
- props が 262,144 byte を超えたら止める（lead が per-page JSON を決める）。
- D-03（Active X fan-out）のロジックを表示側へ持ち込む必要が出たら止める。
- gateway を変える必要が出たら止める（MIG-0512）。
#### Rollback
Phase 5 共通契約のとおり。

### MIG-0505: list/discover routes
- **Model:** small
- **Readiness:** READY_FOR_SMALL_MODEL — #344 で /list の初期表示・/recommend・/trending・key の規則は merge 済み。残りは画面確認用の fixture の切り出し、画面確認、記録。ListFilterIsland は MIG-0510
- **Recipe:** R-PAGE
- **Runtime:** S0
- **Depends on:** MIG-0407 / **Decisions:** D-02 DECIDED, D-06 DECIDED, D-08 DECIDED, D-13-2, D-13-28, D-13-37
- **Verified against:** `7a19a42` (2026-10-25)
#### Source snapshot
- merge 済み: `apps/site/src/pages/list.astro`, `recommend.astro`, `trending.astro`, `apps/site/src/lib/listQuery.ts`, `listingData.ts`, `videoCards.ts`, `packages/ui/src/screens/ListView.tsx`, `RecommendView.tsx`, `TrendingView.tsx`。試験は `scripts/migration-list-discover.test.mjs`。
- 画面確認用の data: `scripts/migration-list-discover.test.mjs:110-138`（`envelope`, `row`, `writeSnapshot`, `fixture`）。snapshot env が無い build は空の表示になり、比べられない。
- producer 済み: `scripts/migration-snapshot-producers.test.mjs:130-142`, `:334`。
- mock: `docs/migration/mock/screenshots/Videos.*`（`/list`）, `Recommend.*`, `Trending.*`。
#### Owned paths
- 新規: `+scripts/fixtures/listingSnapshotFixture.mjs`
- 変更: `scripts/migration-list-discover.test.mjs`, `docs/migration/work-items/MIG-0505.md`, `docs/migration/FILE_MIGRATION_MATRIX.md`（4行）
- 触らない: `apps/site/src/pages/list.astro`（ListFilterIsland は MIG-0510）, `app/(public)/list/**`, `app/api/videos/**`
#### Micro-units
- **U01 fixture の切り出し**: `scripts/migration-list-discover.test.mjs:110-138` の `envelope`, `row`, `writeSnapshot`, `fixture` をそのまま `scripts/fixtures/listingSnapshotFixture.mjs` へ移して export する。`export function writeFixtureSnapshot(dir) { return writeSnapshot(dir, fixture()); }` を足す。test は import に替える。挙動は変えない。
```bash
REQUIRE_BUILT=1 node --test --test-concurrency=1 --experimental-strip-types scripts/migration-list-discover.test.mjs
```
  期待: 移す前と同じ件数が pass、0 skipped。
- **U02 画面確認（gap 5）**: fixture の snapshot env で build し、`list/`, `recommend/`, `trending/` を撮る。mock: Videos / Recommend / Trending。
```bash
SNAP=$(mktemp -d); OUT=$(mktemp -d); SHOTS=$(mktemp -d)
node --experimental-strip-types -e 'import("./scripts/fixtures/listingSnapshotFixture.mjs").then((m) => { const e = m.writeFixtureSnapshot(process.argv[1]); console.log(Object.entries(e).map(([k, v]) => k + "=" + v).join(" ")); })' "$SNAP" > "$SNAP/env.txt"
(cd apps/site && env $(cat "$SNAP/env.txt") node ../../node_modules/astro/astro.js build --outDir "$OUT")
python3 -m http.server 4329 --bind 127.0.0.1 --directory "$OUT" >/dev/null 2>&1 & SERVER=$!
sleep 1
for r in list recommend trending; do
  playwright screenshot --full-page --color-scheme=dark --wait-for-timeout=800 --viewport-size=390,844 "http://127.0.0.1:4329/$r/" "$SHOTS/$r.mobile.png"
  playwright screenshot --full-page --color-scheme=dark --wait-for-timeout=800 --viewport-size=1440,900 "http://127.0.0.1:4329/$r/" "$SHOTS/$r.desktop.png"
done
kill $SERVER; ls -la "$SHOTS"
```
  期待: png 6枚。thumbnail は `/api/youtube-thumbnail/...` が static server に無いので代替タイル（gap 3）で、(b) とする。filter・並び替え UI が無いのは MIG-0510 の範囲で (a) とする。(c) が0件。
- **U03 記録**: Parity gaps: 1 → MIG-0510、2 → 閉（producer）、3 → MIG-0605 media routes（MIG-0508 経由）、4 → D-13-37、5 → 閉。work item の key 表の「owner of the dynamic case」列を `MIG-0507` から `MIG-0510` に直す。
#### Test cases
| ID | 入力/操作 | 期待 |
| --- | --- | --- |
| T01 | fixture の切り出し後の list-discover test | 前と同じ件数が pass |
| T02 | 結果0件（snapshot 無し build） | empty 表示（既存） |
| T03 | 非公開・voided の row | HTML に出ない（既存） |
| T04 | 画面確認 | (c) が0件 |
#### Commands
PR の前に repo root で全部 pass させる。
```bash
npm ci
npm run build --workspace=@flamenode/ui
npm run build --workspace=@flamenode/site
REQUIRE_BUILT=1 node --test --test-concurrency=1 --experimental-strip-types scripts/migration-list-discover.test.mjs scripts/migration-snapshot-producers.test.mjs
node scripts/check-public-site-build-budget.mjs
npm run typecheck
npm run check:project-docs
```
#### Ledger updates
`FILE_MIGRATION_MATRIX.md`: `app/(public)/recommend/page.tsx`, `app/(public)/trending/page.tsx` → `PARITY_VERIFIED`（target の `+` を外す）。`app/(public)/list/page.tsx`, `app/(public)/list/~query/page.tsx` → `IN_PROGRESS`（ListFilterIsland は MIG-0510）。`PERF_HOTPATH_MATRIX.md` の `/list` 行は変えない。
#### DONE checklist
- [ ] T01〜T04 pass
- [ ] request 時に D1 を読まない（`list.astro` に変更なし）
- [ ] work item の key 表の owner が MIG-0510
#### STOP
- 検索・filter・page 送りを足す必要が出たら止める（MIG-0510）。
- 検索を request 時の SSR で行う必要が出たら止める。
#### Rollback
Phase 5 共通契約のとおり。

### MIG-0506: root/top route
- **Model:** small
- **Readiness:** READY_FOR_SMALL_MODEL — #350 で静的な top は merge 済み、棚の Island は MIG-0507 #356 で merge 済み。残りは fixture の切り出し、画面確認、shuffle と時計の決定の記録。検索帯は MIG-0510
- **Recipe:** R-PAGE
- **Runtime:** S0
- **Depends on:** MIG-0407 / **Decisions:** D-02 DECIDED, D-06 DECIDED, D-08 DECIDED, D-13-2, D-13-28, D-13-37, D-13-38
- **Verified against:** `7a19a42` (2026-10-25)
#### Source snapshot
- merge 済み: `apps/site/src/pages/index.astro`（`loadTopForBuild` と `mountTopShelves` の script）, `apps/site/src/lib/topData.ts`（`loadTopForBuild` :203-218、shuffle :160-161）, `packages/ui/src/screens/TopView.tsx`。棚の Island: `apps/site/src/components/TopShelfIsland.ts`, `mountTopShelves.ts`（MIG-0507 U09）、試験 `scripts/migration-top-shelf.test.mjs`。
- 画面確認用の data: `scripts/migration-top-route.test.mjs:62-91`（`row`, `nowSec`, `topPayload`, `trendingPayload`, `envelope`, `writeSnapshot`）。`ev` と `D` は :26-27。
- producer 済み: `scripts/migration-snapshot-producers.test.mjs:130-142`, `:334`。
- mock: `docs/migration/mock/screenshots/Main.*`。
#### Owned paths
- 新規: `+scripts/fixtures/topSnapshotFixture.mjs`
- 変更: `scripts/migration-top-route.test.mjs`, `docs/migration/work-items/MIG-0506.md`, `docs/migration/FILE_MIGRATION_MATRIX.md`（1行）
- 触らない: `apps/site/src/pages/index.astro`, `apps/site/src/lib/topData.ts`, `packages/ui/src/screens/TopView.tsx`（MIG-0502 が export を1行足す）, `app/(public)/page.tsx`
#### Micro-units
- **U01 fixture の切り出し**: `migration-top-route.test.mjs` の `D`, `ev`, `row`, `nowSec`, `topPayload`, `trendingPayload`, `envelope`, `writeSnapshot` をそのまま `scripts/fixtures/topSnapshotFixture.mjs` へ移して export する。`export function writeFixtureSnapshot(dir) { return writeSnapshot(dir); }` を足す。test は import に替える（`NOW` は test に残す）。挙動は変えない。
```bash
REQUIRE_BUILT=1 node --test --test-concurrency=1 --experimental-strip-types scripts/migration-top-route.test.mjs
```
  期待: 移す前と同じ件数が pass、0 skipped。
- **U02 画面確認（gap 6）**: fixture の snapshot env で build し、`/` を撮る。mock: Main。
```bash
SNAP=$(mktemp -d); OUT=$(mktemp -d); SHOTS=$(mktemp -d)
node --experimental-strip-types -e 'import("./scripts/fixtures/topSnapshotFixture.mjs").then((m) => { const e = m.writeFixtureSnapshot(process.argv[1]); console.log(Object.entries(e).map(([k, v]) => k + "=" + v).join(" ")); })' "$SNAP" > "$SNAP/env.txt"
(cd apps/site && env $(cat "$SNAP/env.txt") node ../../node_modules/astro/astro.js build --outDir "$OUT")
python3 -m http.server 4329 --bind 127.0.0.1 --directory "$OUT" >/dev/null 2>&1 & SERVER=$!
sleep 1
playwright screenshot --full-page --color-scheme=dark --wait-for-timeout=1500 --viewport-size=390,844 "http://127.0.0.1:4329/" "$SHOTS/root.mobile.png"
playwright screenshot --full-page --color-scheme=dark --wait-for-timeout=1500 --viewport-size=1440,900 "http://127.0.0.1:4329/" "$SHOTS/root.desktop.png"
kill $SERVER; ls -la "$SHOTS"
```
  期待: png 2枚。検索帯が無いのは MIG-0510 の範囲で (a) とする。thumbnail の代替タイルは (b)。(c) が0件。
- **U03 記録**: Parity gaps: 1 → 閉（MIG-0507 U09、`scripts/migration-top-shelf.test.mjs`）、2 → 閉（producer）、3 → D-13-37、4 → 閉（D-13-38、CURRENT も再生成ごとに shuffle）、5 → MIG-0605 media routes（MIG-0508 経由）、6 → 閉。CURRENT_DIVERGENCE 表の検索帯の行を「MIG-0510」に直す。
#### Test cases
| ID | 入力/操作 | 期待 |
| --- | --- | --- |
| T01 | desktop/mobile の棚 | `scripts/migration-top-shelf.test.mjs` が pass（ループ・キーボード・reduced motion） |
| T02 | snapshot が古い/欠落 | 既存 test のとおり build 失敗、または前世代を使った劣化表示 |
| T03 | fixture の切り出し後の top-route test | 前と同じ件数が pass |
| T04 | 画面確認 | (c) が0件 |
#### Commands
PR の前に repo root で全部 pass させる。
```bash
npm ci
npm run build --workspace=@flamenode/ui
npm run build --workspace=@flamenode/site
REQUIRE_BUILT=1 node --test --test-concurrency=1 --experimental-strip-types scripts/migration-top-route.test.mjs scripts/migration-top-shelf.test.mjs scripts/migration-snapshot-producers.test.mjs
node scripts/check-public-site-build-budget.mjs
npm run typecheck
npm run check:project-docs
```
#### Ledger updates
`FILE_MIGRATION_MATRIX.md` の `app/(public)/page.tsx` → `IN_PROGRESS` のまま（検索帯は MIG-0510）。証跡をこの PR にする。
#### DONE checklist
- [ ] T01〜T04 pass
- [ ] 同時アクセスで重い rebuild を起動しない（`index.astro` に変更なし）
#### STOP
- 検索帯を足す必要が出たら止める（MIG-0510）。
- request 時の rebuild が必要に見えたら止める。
#### Rollback
Phase 5 共通契約のとおり。

### MIG-0507: `/[id]` video catch-all
- **Model:** lead
- **Readiness:** NEEDS_REFINEMENT — MIG-0511（アイコン projection）DONE の後。残りは playlist link、browser 確認、Final audit。Island（like / chapter / 状態 / overlay / Active X）は MIG-0510、sign-out は Phase 8（D-13-18）
- **Recipe:** R-PAGE, R-GATEWAY
- **Runtime:** S0, S1
- **Depends on:** MIG-0407, MIG-0511 / **Decisions:** D-02 DECIDED, D-03 DECIDED, D-04 DECIDED, D-06 DECIDED, D-08 DECIDED, D-11 DECIDED
- **Verified against:** `7a19a42` (2026-10-25)
#### Source snapshot
- merge 済み: PR #356（merge `d2fcda05`）。`apps/site/src/pages/[id].astro`、`apps/site/src/lib/videoPage.ts`（`buildVideoPages` :44、`playlistUrl: null` :93、`loadVideoPagesForBuild` :149）、`VideoPageIsland.ts`、`VideoPlayer.ts`、`AccountMenu.ts`、`TopShelfIsland.ts`。U01/U02/U03（player）/U05/U06/U08/U09 済み。
- CURRENT: `app/(public)/[id]/page.tsx`。playlist :120-128（`scheduled_time > now` かつ primary event、`loadPublicEventYoutubePlaylistIdR2Only` = `events/<id>/base.v1.json` の `event.youtube_playlist_id`、`src/lib/publicData/r2EventPlaylist.ts:124`）。href :237-239。
- build 側の playlist 値: `snapshot/event-detail/<id>.json` の `event.youtube_playlist_id`（`apps/site/src/lib/eventDetail.ts:101` が同じ値を読む）。`produceSnapshots.ts:338-341` が全公開 event について作る。
- 移した残り: like / bookmark / chapter composer / 状態 form / viewer overlay → MIG-0510 U02。`/list` Island → MIG-0510 U01。Active X 切替 → MIG-0510 U05。アイコン projection → MIG-0511。sign-out → Phase 8（D-13-18）。
#### Owned paths
- 変更: `apps/site/src/lib/videoPage.ts`, `scripts/migration-video-page.test.mjs`, `docs/migration/PERF_HOTPATH_MATRIX.md`
- 触らない: `app/(public)/[id]/**`, `app/api/videos/**`, Cloudflare の Route 設定
#### Micro-units
- **U10 playlist（D-13-17）**: `loadVideoPagesForBuild` で manifest の `event-detail` key から primary event の payload を読み（`loadEventPayloadSnapshot`、`publicDataLoader.ts:381`。fixture 時は `eventFixtures.ts`）、`extractYoutubePlaylistId(event.youtube_playlist_id ?? "")` が値を返し `video.scheduled_time > now` のとき `primaryEvent.playlistUrl = "https://www.youtube.com/playlist?list=" + encodeURIComponent(id)`。primary event の snapshot が無い・非公開なら null。
- **U11 Final audit**: Cloudflare に `/:id` glob Route が無いこと（gateway が route shard で解決）、route-map 衝突 test（T01）、gateway の `/:id` local p99（`PERF_HOTPATH_MATRIX.md` の `/:id` 行）を PR に並べる。
- **U12 browser 確認**: 390px / 1440px で `/[id]`（YouTube あり / なし、member あり）を mock と比べ、スクリーンショットを PR に付ける（人間または browser を持つ agent）。
#### Test cases
| ID | 入力/操作 | 期待 |
| --- | --- | --- |
| T01 | `/event`, `/admin`, `/api`, `/user`, `/dashboard` と同じ作品ID | 固定ルートが優先、build で衝突を検出（PASS 済み） |
| T02 | 作品の公開→非公開、非公開→公開 | 可視性フェンスどおり（PASS 済み） |
| T05 | OGP・共有サムネイル | CURRENT と一致（PASS 済み） |
| T06 | VideoObject / Person の JSON-LD | deep-equal（PASS 済み） |
| T07 | view tracker | 閾値秒で1回、6時間 cooldown（PASS 済み） |
| T08 | primary event に playlist、`scheduled_time` が build 時刻より後 / 前 | link あり / なし |
| T09 | primary event の snapshot が manifest に無い | link なし、build は成功 |
#### Commands
```bash
REQUIRE_BUILT=1 node --test --test-concurrency=1 --experimental-strip-types scripts/migration-video-page.test.mjs
node --test --experimental-strip-types scripts/migration-route-map.test.mjs
npm run build --workspace=@flamenode/site
node scripts/check-public-site-build-budget.mjs
npm run check:public-visibility-fences
npm run typecheck
```
#### Ledger updates
`FILE_MIGRATION_MATRIX.md` の `app/(public)/[id]/page.tsx` は IN_PROGRESS のまま（Island は MIG-0510）。`PERF_HOTPATH_MATRIX.md` の root video 行に U11 の証跡。
#### DONE checklist
- [ ] U01〜U03、U05、U06、U10、U11、U12 が DONE（U04 like/bookmark は MIG-0510 U02）
- [ ] MIG-0511 のアイコン projection が `/[id]` に入っている（MIG-0511 T03）
- [ ] Cloudflare に `/:id` の glob Route を登録する設計になっていない
- [ ] 衝突と gateway p99 の結果が PR にある
#### STOP
- `/:id` を Cloudflare Route に直接登録する必要が出たら止める。
- Active X の切替（D-04）を本MIGで実行する必要が出たら止める（MIG-0510 U05）。
- 本番の path Route 切替は MIG-0510 U02 DONE と人間の明示承認の後（Phase 5 共通契約）。
#### Rollback
Phase 5 共通契約のとおり。

### MIG-0509: 全公開データの生成を build 時へ移す（D-09）
- **Model:** lead
- **Readiness:** NEEDS_REFINEMENT — MIG-0409 DONE で着手可。lead 決定は D-13-11〜D-13-15 で済み。D1 / R2 の token、Workers Builds project、本番の実データ計測は owner 手順
- **Recipe:** R-BUILD
- **Runtime:** N
- **Depends on:** MIG-0409 / **Decisions:** D-06 DECIDED, D-09 DECIDED, D-11 DECIDED
- **Verified against:** `7a19a42` (2026-10-25)
#### Source snapshot
- merge 済み pre-work: PR #354（merge `419fae28`）。`apps/site/scripts/produceSnapshots.ts`（`produceSnapshots` :255、`writeSnapshotDir` :395、CLI `main` :457 は `--sqlite` / `--sql-dump` だけで Cloudflare に接続しない、`DEFAULT_MAX_REMOTE_STATEMENTS = 200` :144、`limitedDb` :148）、`batchedUserReader.ts`、`mirrorTables.ts`、`scripts/migration-snapshot-producers.test.mjs`（C' parity、e2e astro build :323）。Phase 5 の全 page が読む snapshot kind を作る。
- D1 REST reader: `apps/site/scripts/readPublicData.ts` `openD1HttpReader` :364（`maxStatements` option :378、env 名 `D1_HTTP_ENV` :350）。
- trending: `produceSnapshots` は `trending` 入力が無いと作らず、`/trending` と `/` の build が fail closed（`main` :476-478）。GA4 の出力は R2 `analytics/trending.json`（`workers/ga-analytics/sync.ts`）。
- 配信: gateway は Assets を先に読み、404 のときだけ R2（`apps/site/src/gateway/index.ts:159-184`）。D-13-13 で詳細 HTML は Assets のまま。
- build 要求の記録先 `public_build_state.requested_at` を書く経路は無い（`workers/fast-jobs/publicBuildTrigger.ts:138` が読むだけ）。CURRENT の static rebuild の enqueue は `packages/server-core/src/staticRebuild/enqueue.ts` `buildStaticRebuildQueueBatch` :85（`src/lib/staticRebuild/enqueue.ts` は 32 行の bridge）。
- GA4 同期の入力: `workers/ga-analytics/sync.ts:20` `GA4_RECENT_LIST_KEY = "list/recent.json"`（R2）。
#### Owned paths
- 新規: `+apps/site/scripts/buildPublicSite.ts`, `+apps/site/scripts/readR2Object.ts`, `+scripts/migration-build-public-site.test.mjs`
- 変更: `apps/site/scripts/produceSnapshots.ts`, `apps/site/package.json`（`build:public` script）, `scripts/migration-snapshot-producers.test.mjs`, `packages/server-core/src/staticRebuild/enqueue.ts`, `workers/ga-analytics/sync.ts`, `.github/workflows/migration-docs-check.yml`（test 1 行）, `docs/migration/static-delivery/BUILD_TIME_DATA.md`
- 触らない: `workers/json-generator/**`（MIG-0907 まで動かす）、`apps/site/src/gateway/**`、本番の D1・R2・token・Workers Builds 設定
#### Micro-units
- **U01 D1 API mode**: `produceSnapshots.ts` の `main` に `--d1-api` を足す。`openD1HttpReader({ accountId, databaseId, token, maxStatements: DEFAULT_MAX_REMOTE_STATEMENTS })`（D-13-12、env は `D1_HTTP_ENV`）を `db` にし `mode: "batched"` に固定。`--sqlite` / `--sql-dump` と排他。test: `readPublicData.test.mjs` と同じ fake `/query` endpoint を同じ seed の SQLite に向け、`--d1-api` と `--sqlite --batched` の snapshot と manifest が byte 一致、statement 数 ≤ 200、token が log に出ない。
- **U02 trending from R2（D-13-14）**: `readR2Object.ts` に `readR2Json({ accountId, bucket, key, token, fetchFn, maxBytes })` を書く（`GET /client/v4/accounts/<account>/r2/buckets/<bucket>/objects/<key>`、15 s timeout、2 MiB 上限、token を log に出さない、404 は null）。`main` に `--trending-r2` を足し `analytics/trending.json` を `trending` に渡す（env: `FLAMENODE_R2_READ_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`）。
- **U03 build entry**: `buildPublicSite.ts` = `produceSnapshots` → `writeSnapshotDir(<tmp>)` → 返った env を足して `astro build` を子 process で実行 → `node scripts/check-public-site-build-budget.mjs`。`report`（keys / bytes / d1Statements / elapsedMs）と build の所要時間を JSON 1 行で stdout に出す。`apps/site/package.json` に `"build:public": "node --experimental-strip-types scripts/buildPublicSite.ts"`。CI dry-run: `scripts/migration-build-public-site.test.mjs` が seed SQLite で `--sqlite` 経路を通し、dist に `/user/creator_a/` と `/[id]` の page ができることを確かめる（REQUIRE_BUILT step に1行足す）。
- **U04 owner 手順の文書**: `BUILD_TIME_DATA.md` §2 と §5 に Workers Builds の設定（build command `npm run build:public --workspace=@flamenode/site -- --d1-api --trending-r2 --generation $WORKERS_CI_COMMIT_SHA`、変数）と token 作成を書く。wrangler の deploy 設定は MIG-0628。
- **U05 request mark**: `buildStaticRebuildQueueBatch` の batch に `UPDATE public_build_state SET requested_at = MAX(requested_at, ?) WHERE id = 1` を1つ足す（公開データを変える enqueue と同じ batch。S3 の D1 statement +1）。server-core の golden test を意図的に更新し PR に理由を書く。
- **U06 GA4 input**: `workers/ga-analytics/sync.ts` の入力を R2 `list/recent.json` から D1 の `LIMIT` 付き query（CURRENT `list_recent` と同じ並びと上限）へ。出力 `analytics/trending.json`（最大 200 件、`workers/ga-analytics/ranking.ts:29`）は変えない。CURRENT の `list/recent.json` と同じ入力集合になる test。
#### Test cases
| ID | 入力/操作 | 期待 |
| --- | --- | --- |
| T01 | `--d1-api`（fake endpoint）と `--sqlite --batched` | snapshot・manifest が byte 一致、statement ≤ 200 |
| T02 | 非公開・削除済み | どの snapshot にも無い（既存 visibility test） |
| T03 | 公開データを変える enqueue | `requested_at` が更新される |
| T04 | 公開データを変えない更新 | `requested_at` が変わらない |
| T05 | `rg -n "env\.(BUCKET\|R2)" apps/site/src/pages apps/site/src/lib` | 0 件 |
| T06 | `buildPublicSite.ts --sqlite <seed>` | dist に user / video / event の page、budget check PASS |
| T07 | trending の R2 読み取りが 404 / 401 | 404 = trending 無し（fail closed の build エラー）、401 = 終了コード 1、token が出力に無い |
| T08 | GA4 同期の入力 | CURRENT `list/recent.json` と同じ id 集合と順序 |
#### Commands
```bash
REQUIRE_BUILT=1 node --test --test-concurrency=1 --experimental-strip-types scripts/migration-snapshot-producers.test.mjs scripts/migration-build-public-site.test.mjs
node --test --experimental-strip-types apps/site/scripts/readPublicData.test.mjs
npm run build --workspace=@flamenode/site
node scripts/check-public-site-build-budget.mjs
npm run test:unit
npm run typecheck
```
#### Ledger updates
`FILE_MIGRATION_MATRIX.md` に新規 3 file。`BUILD_TIME_DATA.md` §2（Workers Builds 実測）、§5（token）、§6（R2 PUT 0、D-13-13）。
#### DONE checklist
- [ ] T01〜T08 が PASS
- [ ] `apps/site` が R2 artifact を読まない（T05）
- [ ] build が R2 に書かない（D-13-13）。Static Assets の file 数が 20,000 の 80% 以下（実データ、owner 手順 5 の後）
- [ ] Workers Builds 5 回の実測で 52 / 1,661,539 ms を再導出（owner 手順 5。D-11 再検討条件 1: 1 build ≥ 4 min なら止める）
- [ ] build 時間が MIG-0409 で承認した範囲内
#### STOP
- owner 手順（agent は実行しない。各手順の直前に明示承認）:
  1. API token `flamenode-build-read`: Account → D1 → Read と Workers R2 Storage → Read のみ、FlameNode account のみ（`BUILD_TIME_DATA.md` §5 手順 1）。
  2. 信頼できる shell で `SELECT 1` を `/query` に1回（§5 手順 2）。Read token が拒否されたら止めて lead に報告。D1 Edit に広げない。
  3. 本番 D1 で 0065 が applied であることの read-only 確認（MIG-0410 STOP 1）。**U05 の merge はこれが済むまで止める**（未適用だと全ての編集の batch が失敗する）。
  4. Workers Builds project を作り、build command と変数（`CLOUDFLARE_ACCOUNT_ID`, `FLAMENODE_D1_DATABASE_ID`, `FLAMENODE_D1_READ_TOKEN`, `FLAMENODE_R2_READ_TOKEN`）を登録。
  5. 5 回 build して所要時間・D1 statement 数・file 数を work item に貼る。
- family の出力が CURRENT と一致しない理由が CURRENT の不具合に見えたら、直さずに PR に書く。privacy に関わる場合は止める。
- build 時間が承認した値を超えたら止める。
#### Rollback
PR を revert。CURRENT の json-generator は動いたままなので公開ページは変わらない。U05 を revert すると `requested_at` が更新されなくなるだけ（MIG-0410 の段は skip）。

### MIG-0510: Phase 5 の操作 Island を Phase 6 の API につなぐ
- **Model:** lead
- **Readiness:** NEEDS_REFINEMENT — 各 unit は対応する Hono API が DONE になってから。API の URL と DTO は担当 task の merge 後に確定するので、unit ごとに lead が API 契約を写してから着手（D-13-24）
- **Recipe:** R-PAGE, R-UI
- **Runtime:** S0
- **Depends on:** MIG-0603, MIG-0604, MIG-0634, MIG-0636 / **Decisions:** D-03 DECIDED, D-04 DECIDED, D-06 DECIDED, D-08 DECIDED
- **Verified against:** `7a19a42` (2026-10-25)
#### Source snapshot
- Phase 5 共通契約（`PHASE_4_5_SPEC.md` の表）: 公開画面の mutation は Server Action 直呼び。ルートの本番切替は API の DONE 後。
- **U01 `/list` + top search band**: CURRENT `app/(public)/list/ListIndexView.tsx`（`ImeSafeGetForm` :275-303、`AutoSubmitSelect`、`Pagination`）、`app/(public)/list/~query/page.tsx`。apps/site `pages/list.astro`（既定 view だけ、:5 が `ListFilterIsland` を予告）、`lib/listQuery.ts`（key 規則、MIG-0505）。top の search band は mock にあり未実装（`work-items/MIG-0506.md:38`）。API: RH-032 `GET /api/videos`（`app/api/videos/route.ts`、Hono 化は MIG-0634）。
- **U02 `/[id]` 操作**: CURRENT `src/components/video/InteractionButton.tsx`（SA-087）、`VideoInteractionActions.tsx`、`ChapterComposer.tsx`（SA-012..015）、`ChapterCommentPanel.tsx`、`VideoStatusForm.tsx`（SA-001 / SA-040）、`VideoViewerUtilityDock.tsx`（`?playlist=` dock）。API: SA-012..015 は Hono に merge 済み（#393、`apps/api/src/routes/videos/chapters.ts:604-607`: `POST /api/videos/:videoId/chapters`、`/bulk`、`PUT` / `DELETE /api/videos/chapters/:chapterId`）。SA-087 と SA-001/040 は MIG-0603 U03 / U02（未実装）、RH-031 viewer overlay（`app/api/videos/[id]/viewer-overlay/route.ts`）は MIG-0634。apps/site `components/VideoPageIsland.ts`（静的表示だけ）。
- **U03 `/event/[id]/slots`**: CURRENT `src/components/event/SlotGrid.tsx`（SA-056..068）、`app/(public)/event/[id]/slots/EventSlotsViewerPanel.tsx`（RH-014）。RH-014 は Hono に merge 済み（#391、`apps/api/src/routes/events/viewerOverlay.ts`、`GET /api/events/:id/slots/viewer-overlay`）。予約系 SA は MIG-0604 U04（MIG-0633 待ち）。apps/site `components/EventSlotsIsland.ts`。
- **U04 `/rules`**: CURRENT `app/(public)/rules/page.tsx:43-96`（`next` は `sanitizeNextPath` `src/lib/utils/next.ts:42`、`?error=` の3 code :54-59、form :95 が SA-075 `acceptLatestTerms`）。apps/site `pages/rules.astro`（form 無し）。API は MIG-0605（未実装）。
- **U05 Active X 切替**: CURRENT `src/components/user/useActiveXSwitcher.ts`（SA-098 `setActiveXId`）、`XIdSwitcher.tsx`。apps/site `components/AccountMenu.ts:25,34,82-104`（`switchActiveX` を注入すれば動く。site は渡していない）、`SiteHeader.ts`。API は MIG-0605（未実装）。
#### Owned paths
- 新規: `+apps/site/src/components/ListFilterIsland.ts`, `+apps/site/src/components/VideoInteractionIsland.ts`, `+apps/site/src/components/RulesConsentIsland.ts`, `+apps/site/src/lib/publicApi.ts`, `+scripts/migration-public-islands.test.mjs`
- 変更: `apps/site/src/pages/list.astro`, `apps/site/src/pages/index.astro`, `apps/site/src/pages/rules.astro`, `apps/site/src/components/VideoPageIsland.ts`, `apps/site/src/components/EventSlotsIsland.ts`, `apps/site/src/components/SiteHeader.ts`, `packages/ui/src/screens/ListView.tsx`, `packages/ui/src/screens/TopView.tsx`, `packages/ui/src/screens/VideoDetailView.tsx`, `packages/ui/src/screens/EventSlotsView.tsx`, `packages/ui/src/screens/RulesView.tsx`
- 触らない: `app/**`, `src/components/**`, `apps/api/**`（API は 06xx の担当）
#### Micro-units
- **U01 list**（MIG-0634 RH-032 DONE 後）: `ListFilterIsland` が `location.search` を `lib/listQuery.ts` で正規化し RH-032 を呼ぶ。検索・並び・view・event filter・chip・reset・pagination・deep link を CURRENT `ListIndexView.tsx` と同じ key で。top の search band は `/list?q=` への GET form（JS なしでも動く）。
- **U02 video**（MIG-0603 U02/U03 と MIG-0634 RH-031 DONE 後）: like / bookmark（Active X 0件・複数の 403 / 202 / modal 誘導）、chapter composer（SA-012..015、merge 済み API）、chapter comments、状態 form、viewer overlay、`?playlist=` dock。
- **U03 slots**（MIG-0604 U04 DONE 後）: 予約・解除・延長（SA-056..068）と viewer panel（RH-014、merge 済み）。
- **U04 rules**（MIG-0636 の SA-075 API DONE 後）: 同意 form、`next`（`sanitizeNextPath`）、`?error=` の3 code の文言を CURRENT と同じに。
- **U05 Active X**（MIG-0636 の SA-098 API DONE 後）: `SiteHeader` から `AccountMenu` に `switchActiveX` を渡す。
#### Test cases
| ID | 入力/操作 | 期待 |
| --- | --- | --- |
| T01 | `/list?q=..&sort=..&page=2&event=..&view=..` | CURRENT と同じ結果・key・空表示 |
| T02 | like、Active X 0件 / 複数 | CURRENT と同じ 403 / 202 / modal |
| T03 | chapter 作成・更新・削除・一括 | API の 200/400/403/404/409/413 を CURRENT の表示に |
| T04 | 枠の予約・解除・延長、競合 | CURRENT と同じ結果と再取得 |
| T05 | `/rules?next=/x&error=concurrent_update` | CURRENT の文言、同意後に `/x` |
| T06 | Active X 切替の成功 / 失敗 | 楽観更新と rollback（`AccountMenu` の既存 test と同じ） |
| T07 | JS なし | 静的表示が残り、何もしない control は出ない |
#### Commands
```bash
node --test --experimental-strip-types scripts/migration-public-islands.test.mjs scripts/migration-account-island.test.mjs scripts/migration-islands.test.mjs
REQUIRE_BUILT=1 node --test --test-concurrency=1 --experimental-strip-types scripts/migration-list-discover.test.mjs scripts/migration-video-page.test.mjs scripts/migration-event-routes.test.mjs scripts/migration-fixed-routes.test.mjs
npm run build --workspace=@flamenode/site
npm run typecheck
```
#### Ledger updates
`FILE_MIGRATION_MATRIX.md` に新規 file。`work-items/MIG-0505.md` / `MIG-0507.md` / `MIG-0502.md` / `MIG-0501.md` の該当 Parity gap を「MIG-0510 Uxx で解消」に。
#### DONE checklist
- [ ] U01〜U05 が DONE、T01〜T07 が PASS
- [ ] 各 Island が呼ぶ API は全て Hono の DONE task のもの（Server Action を呼ばない）
- [ ] browser 確認（390px / 1440px）が PR にある
#### STOP
- 必要な API が無い・契約が CURRENT と違うときは、その unit を止めて担当の 06xx に返す（新しい公開 API をこの task で作らない）。
- Active X の本番切替（D-04）は別承認。
#### Rollback
PR を revert。静的表示に戻る（Island 以前と同じ）。

### MIG-0511: 公開 X アイコン map を build 時の snapshot にする
- **Model:** small
- **Readiness:** READY_FOR_SMALL_MODEL — 入力（CURRENT の users_index 生成物）と規則（CURRENT `loadPublicXIconMapV1` の index 補完）と3つの consumer の差し込み位置が全て下に書いてある
- **Recipe:** R-BUILD, R-PAGE
- **Runtime:** N, S0
- **Depends on:** MIG-0407, MIG-0409 / **Decisions:** D-06 DECIDED, D-09 DECIDED
- **Verified against:** `7a19a42` (2026-10-25)
#### Source snapshot
- CURRENT の読み手: `src/lib/publicData/staticSharedInputsLoader.ts` `loadPublicXIconMapOptional` :375（V2 → V1 → users/index 補完。V1 の補完 :243-285: entry が無いか `source === "video"` の id は、users/index にあれば `{ icon_url: user.icon_url ?? existing?.icon_url ?? null, source: user.icon_url ? "registered" : "none" }`、`registered` / `none` は残す）。V2 は V1 の shard（`workers/json-generator/publicIconV2Artifacts.ts` `rebuildPublicIconV2FromLegacyArtifact`）なので結果は V1 + 補完と同じ。
- CURRENT の生成物: `users_index` target が `users/index.json` と `users/public-x-icon-map.v1.json`（`PUBLIC_X_ICON_MAP_OBJECT_KEY`）を同じ `sources` から作る（`workers/json-generator/rebuild.ts:3220-3259`）。`produceSnapshots.ts:271` が `users_index` を既に実行しているので、両方が `objects` に入っている。
- 判定関数: `src/lib/publicData/publicIconProjection.ts` `resolveProjectedIcon` :31、`hasProjectedPublicProfile` :51、`normalizePublicXIconMap` :103、`publicXIconEntriesToMap` :140、`normalizePublicIconUrl` :21。
- consumer（CURRENT → apps/site）:
  - `/[id]`: `app/(public)/[id]/page.tsx:228-233`（creatorHref = `creator_has_public_profile || hasProjectedPublicProfile`）、:554-565（member の icon と has_public_profile）。apps/site は `videoPage.ts:54`（creatorHref）、:101（member iconUrl）、:104（member profileHref）。
  - `/event/[id]`: `app/(public)/event/[id]/page.tsx:368-372`（video の creator icon）、:436-446（staff の icon と has_public_profile）。apps/site は `eventDetail.ts:128-130`（staff）、:138（video creator icon）を `detail` から読むので、`detail` を build 時に投影する（`EventDetailIsland` も同じ `detail` を使う）。
  - `/user/[id]/portfolio`: `app/(public)/user/[id]/portfolio/page.tsx:51-56,104`（icon = `normalizePublicIconUrl(user.icon_url) ?? resolveProjectedIcon({ xUserId: user.id, iconMap, legacyIconUrl: null })`、og:image も同じ）、:204-214（works の icon）。apps/site は `userViews.ts:186-197`（`buildPortfolioHead`）と `pages/user/[id]/portfolio.astro`。`/user/[id]` は CURRENT が空 map（`UserProfilePage.tsx:283`）なので変えない。
- 失敗時: CURRENT は map が読めなければ空 map（Optional）。D-13-23。
#### Owned paths
- 新規: `+apps/site/src/lib/publicIconMap.ts`, `+scripts/migration-public-icon-map.test.mjs`
- 変更（他 task の Owned paths。work item の Owned paths には書かない）: `apps/site/src/lib/publicDataLoader.ts`, `apps/site/scripts/produceSnapshots.ts`, `apps/site/src/lib/videoPage.ts`, `apps/site/src/lib/userViews.ts`, `apps/site/src/pages/event/[id]/index.astro`, `apps/site/src/pages/user/[id]/portfolio.astro`, `scripts/migration-snapshot-producers.test.mjs`
- 変更: `docs/migration/FILE_MIGRATION_MATRIX.md`
- 触らない: `src/lib/publicData/**`, `workers/json-generator/**`, `apps/site/src/lib/eventDetail.ts`, `apps/site/src/pages/user/[id]/index.astro`, `app/**`
#### Micro-units
- **U01 loader + projection**: `publicDataLoader.ts` の `loadAboutStatsSnapshot`（:357）の下に足す。
  ```ts
  export const PUBLIC_X_ICON_MAP_KEY = "snapshot/public-x-icon-map/current.json";
  export async function loadPublicXIconMapPayload(source: SnapshotSource, options: SnapshotLoadOptions): Promise<unknown> {
    const metrics = options.metrics ?? newSnapshotBuildMetrics();
    const payload = await readVerifiedPayload(source, PUBLIC_X_ICON_MAP_KEY, options, metrics, /^snapshot\/public-x-icon-map\/current\.json$/);
    metrics.accepted += 1;
    return payload;
  }
  ```
  `apps/site/src/lib/publicIconMap.ts` を作る（import は `src/lib/publicData/publicIconProjection.ts`、`src/lib/publicData/staticUsersIndexCore.ts`、`src/lib/utils/xid.ts`、`./publicDataLoader.ts`、`./snapshotEnv.ts` だけ）:
  ```ts
  export function projectPublicXIconMap(v1: unknown, usersIndex: unknown): PublicXIconMapPayload | null {
    const primary = normalizePublicXIconMap(v1);
    const index = usersIndex && typeof usersIndex === "object" ? normalizeStaticUsersIndex(usersIndex as StaticUsersIndexPayload) : null;
    if (!index) return primary;
    const entries: Record<string, PublicXIconEntry> = { ...(primary?.entries ?? {}) };
    for (const user of index.items) {
      const xId = normalizeXId(user.x_id);
      if (!xId) continue;
      const existing = entries[xId];
      if (existing?.source === "registered" || existing?.source === "none") continue;
      entries[xId] = { icon_url: user.icon_url ?? existing?.icon_url ?? null, source: user.icon_url ? "registered" : "none" };
    }
    return { schema_version: 1, generated_at: primary?.generated_at ?? index.generatedAt ?? 0, entries };
  }
  export async function loadPublicXIconMapForBuild(env: Record<string, string | undefined> = process.env): Promise<Map<string, PublicXIconEntry>>
  ```
  `loadPublicXIconMapForBuild`: `snapshotAccessFromEnv(env)` が null、または `manifest.allowedKeys` に `PUBLIC_X_ICON_MAP_KEY` が無いときは `new Map()`。あれば `publicXIconEntriesToMap(normalizePublicXIconMap(await loadPublicXIconMapPayload(...)))`。例外は全て捕まえて `console.warn("[icon-map] empty: snapshot ... unavailable (<code>)")` と `new Map()`（`aboutStats.ts` と同じ形）。同じ file に次の2つも書く。
  ```ts
  export function projectEventDetailIcons(detail: StaticEventDetail, iconMap: ReadonlyMap<string, PublicXIconEntry>): StaticEventDetail {
    return {
      ...detail,
      publicStaff: detail.publicStaff.map((m) => ({ ...m,
        icon_url: resolveProjectedIcon({ xUserId: m.x_user_id, iconMap, legacyIconUrl: m.icon_url }),
        has_public_profile: (m.has_public_profile ?? false) || hasProjectedPublicProfile({ xUserId: m.x_user_id, iconMap }) })),
      publicVideos: detail.publicVideos.map((v) => ({ ...v,
        creator_icon_url: resolveProjectedIcon({ xUserId: v.creator_x_user_id, iconMap, legacyIconUrl: v.creator_icon_url }) })),
    };
  }
  export function portfolioIconUrl(user: { id: string; icon_url: string | null }, iconMap: ReadonlyMap<string, PublicXIconEntry>): string | null {
    return cachedGoogleImageUrl(normalizePublicIconUrl(user.icon_url) ?? resolveProjectedIcon({ xUserId: user.id, iconMap, legacyIconUrl: null }));
  }
  ```
  ```bash
  node --test --experimental-strip-types scripts/migration-public-icon-map.test.mjs
  ```
  期待: T01, T02 が pass。
- **U02 producer**: `produceSnapshots.ts` の `add(USERS_INDEX_KEY, objects.get("users/index.json"));`（:290）の直後に1行足す。
  ```ts
  add(PUBLIC_X_ICON_MAP_KEY, projectPublicXIconMap(objects.get(PUBLIC_X_ICON_MAP_OBJECT_KEY), objects.get("users/index.json")) ?? undefined);
  ```
  import: `PUBLIC_X_ICON_MAP_KEY` は `../src/lib/publicDataLoader.ts`、`projectPublicXIconMap` は `../src/lib/publicIconMap.ts`、`PUBLIC_X_ICON_MAP_OBJECT_KEY` は `../../../src/lib/publicData/publicIconProjection.ts`。`scripts/migration-snapshot-producers.test.mjs` に T08 を足す（同じ file :148 の `cur` env と同じ形で `rebuildTarget(cur, "users_index", "global")` を独立に実行し、`objects.get("users/public-x-icon-map.v1.json")` と `objects.get("users/index.json")` から `projectPublicXIconMap` した `entries` と、produced の `byKey.get(PUBLIC_X_ICON_MAP_KEY).payload.entries` を `deepEqual`。`generated_at` は比べない）。
  ```bash
  REQUIRE_BUILT=1 node --test --test-concurrency=1 --experimental-strip-types scripts/migration-snapshot-producers.test.mjs
  ```
  期待: 既存の全 test と T08 が pass（manifest の `allowedKeys` に `snapshot/public-x-icon-map/current.json` が入り、C' parity の byte 一致も保たれる）。
- **U03 `/[id]`**: `videoPage.ts` の `buildVideoPages` に第4引数 `iconMap: ReadonlyMap<string, PublicXIconEntry> = new Map()` を足し、3箇所を替える。
  - :54 → `const creatorHref = creatorId !== "anonymous" && ((video.creator_has_public_profile ?? false) || hasProjectedPublicProfile({ xUserId: creatorId, iconMap })) ? \`/user/${creatorId}\` : null;`
  - :101 → `iconUrl: cachedGoogleImageUrl(resolveProjectedIcon({ xUserId: m.x_user_id, iconMap, legacyIconUrl: m.icon_url ?? null })),`
  - :104 → `profileHref: m.x_user_id && ((m.has_public_profile ?? false) || hasProjectedPublicProfile({ xUserId: m.x_user_id, iconMap })) ? \`/user/${m.x_user_id}\` : null,`
  - `loadVideoPagesForBuild`（:149）の先頭で `const iconMap = await loadPublicXIconMapForBuild(env);` とし、:156 と :159 の `buildVideoPages(...)` に `now, iconMap` を渡す。creator のアイコン（:70）は CURRENT も投影しない（`page.tsx:226`）ので変えない。
  ```bash
  node --test --experimental-strip-types scripts/migration-public-icon-map.test.mjs
  ```
  期待: T03 が pass。
- **U04 `/event/[id]`**: `pages/event/[id]/index.astro` の `getStaticPaths` で `const iconMap = await loadPublicXIconMapForBuild();` を1回呼び、`props: { detail: projectEventDetailIcons(detail, iconMap) }` にする。`eventDetail.ts`、`release.astro`、`slots.astro` は変えない（CURRENT は `/event/[id]` だけが投影する）。
  ```bash
  node --test --experimental-strip-types scripts/migration-public-icon-map.test.mjs
  ```
  期待: T04 が pass。
- **U05 portfolio**: `userViews.ts` の `buildPortfolioHead(profile)` を `buildPortfolioHead(profile, iconMap: ReadonlyMap<string, PublicXIconEntry> = new Map())` にし、`image` を `portfolioIconUrl(user, iconMap)` にする。`portfolio.astro` の `getStaticPaths` で map を1回読み `props: { entry, iconMap }` で渡し、`head = buildPortfolioHead(profile, iconMap)`、`iconUrl: portfolioIconUrl(profile.user, iconMap)`、works は `profile.works.items.slice(0, PORTFOLIO_WORK_LIMIT).map((v) => toScreenVideoCard({ ...v, icon_url: resolveProjectedIcon({ xUserId: v.creator_x_user_id, iconMap, legacyIconUrl: v.icon_url }) }))`。`buildCreatorHeader` と `/user/[id]` は変えない。
  ```bash
  node --test --experimental-strip-types scripts/migration-public-icon-map.test.mjs
  REQUIRE_BUILT=1 node --test --test-concurrency=1 --experimental-strip-types scripts/migration-user-routes.test.mjs scripts/migration-event-routes.test.mjs scripts/migration-video-page.test.mjs
  ```
  期待: T05 が pass。既存の route test も全て pass（snapshot env なしの fixture build では map が空で、出力は変わらない）。
#### Test cases
| ID | 入力/操作 | 期待 |
| --- | --- | --- |
| T01 | `projectPublicXIconMap`: v1 `registered` / v1 `none`（index に icon あり）/ v1 `video` + index icon あり / v1 に無し + index icon 無し / index が null / 両方 null | そのまま / そのまま / `registered`（index の icon）/ `{ icon_url: null, source: "none" }` / v1 のまま / null |
| T02 | `loadPublicXIconMapForBuild`: env 無し / manifest に key 無し / 正しい envelope / sha256 改ざん | 空 Map / 空 Map / entries の Map / 空 Map + warn 1 回 |
| T03 | `buildVideoPages(FIXTURE_VIDEO_DETAIL_PAYLOADS["vid-bbb"] に public_members 1件（x_user_id "member_a"、icon_url "https://example.com/old.png"、has_public_profile false）を足したもの, ..., map{member_a: {icon_url: "https://example.com/new.png", source: "registered"}})` | member の iconUrl = `cachedGoogleImageUrl("https://example.com/new.png")`、profileHref = `/user/member_a`。空 map では old.png と null |
| T04 | `projectEventDetailIcons`: staff と video creator の id が map に `none` / 無し | `none` = icon は entry の値、has_public_profile true / 無し = 元の値のまま |
| T05 | `portfolioIconUrl`: user.icon_url あり / null + map `registered` / null + map 無し | user.icon_url / map の icon / null |
| T06 | snapshot env なしの `npm run build --workspace=@flamenode/site` | 既存の route test が全て pass（出力不変） |
| T07 | `rg -n "loadPublicXIconMapOptional" apps/site` | 0 件（CURRENT の R2 reader を使わない） |
| T08 | producer 出力と CURRENT `users_index` 生成物の投影 | `entries` が deep-equal |
#### Commands
```bash
node --test --experimental-strip-types scripts/migration-public-icon-map.test.mjs
REQUIRE_BUILT=1 node --test --test-concurrency=1 --experimental-strip-types scripts/migration-snapshot-producers.test.mjs scripts/migration-user-routes.test.mjs scripts/migration-event-routes.test.mjs scripts/migration-video-page.test.mjs
npm run build --workspace=@flamenode/site
npm run check:public-visibility-fences
npm run typecheck
npm run check:project-docs
```
期待: すべて終了コード 0。
#### Ledger updates
`FILE_MIGRATION_MATRIX.md` に `apps/site/src/lib/publicIconMap.ts`（HELPER、MIG-0511）と `scripts/migration-public-icon-map.test.mjs`（TEST）を追加。`src/lib/publicData/staticSharedInputsLoader.ts` の行に「public build consumer: MIG-0511」と書く。
#### DONE checklist
- [ ] T01〜T08 が PASS
- [ ] 3 consumer（`/[id]`、`/event/[id]`、`/user/[id]/portfolio`）が map を使い、`/user/[id]` は空 map のまま
- [ ] map が無い・壊れているとき build は成功し、icon は snapshot の値（D-13-23）
- [ ] 本番の D1・R2 に触れていない
#### STOP
- `src/lib/publicData/**` や `workers/json-generator/**` を変えたくなったら止める（CURRENT は変えない）。
- `produceSnapshots.ts` を MIG-0509 の open PR が同時に変えていたら、その PR の merge を待って rebase する（2つの PR で同じ行を変えない）。
- T08 が一致しないときは CURRENT の規則（`staticSharedInputsLoader.ts:243-285`）を読み直し、`projectPublicXIconMap` を変える前に lead に報告する。
#### Rollback
PR を revert。map が無いと consumer は snapshot の icon に戻る（MIG-0511 以前と同じ出力）。

### MIG-0512: public gateway: HTML 404/503 + Retry-After, entity sub-page fence, build-file allowlist
- **Model:** lead
- **Readiness:** NEEDS_REFINEMENT — 可視性の fence（security）を変えるので lead が実行する。決定は D-13-25 / D-13-26 / D-13-33 に全部書いた
- **Recipe:** R-GATEWAY
- **Runtime:** S1
- **Depends on:** MIG-0405, MIG-0619 / **Decisions:** D-06 DECIDED, D-09 DECIDED, D-11 DECIDED, D-13-25, D-13-26, D-13-33
- **Verified against:** `7a19a42` (2026-10-25)
#### Source snapshot
- `apps/site/src/gateway/index.ts:58-71`: `textResponse`、`unavailable()` = text 503、`notFound()` = text 404。`Retry-After` は無い。`dist/404.html` / `dist/503/index.html`（MIG-0501 #340）は使われていない。
- `index.ts:147, 219-226`: `/event/{id}/slots` は visibility も KV の `deny:` も通らずに Assets へ渡る。build 後に非公開にした event の枠表が見える（R-GATEWAY「build の後に非公開へ変わったものは…拒否 entry で止める」に反する）。
- `routeShards.ts:56-70` `routeKeyFromPath` は `/event/x/release` を `event/x/release`、`/user/x/portfolio` を `user/x/portfolio` にする。route map（`apps/site/src/lib/routeMap.ts:151-157` `entityKey`）にはその key が無いので、build 済みの release と portfolio は gateway 経由ではどれも 404 になる。
- `routeShards.ts:91-98`: `PUBLIC_ASSET_FILES` と `PUBLIC_ASSET_PREFIXES = ["/_astro/", "/brand/"]`。`/fonts/FlameNodeSans.otf`（`PublicLayout.astro` の preload）と `/user/index.json`（`UsersIndexIsland`、MIG-0504）は route lookup に落ちて 404 になる。`fonts` は `routeMap.ts:93` で予約済み。
- CURRENT: `app/not-found.tsx`（404 本文）、`app/error.tsx`（503 本文の元）。retryable な 503 は `Retry-After: 30`（`app/api/public/about-stats/route.ts:17`）。
- 試験: `scripts/migration-gateway.test.mjs`（`createEnv` :25-91、text 本文の assert は :527）。
#### Owned paths
- 変更: `apps/site/src/gateway/index.ts`, `apps/site/src/gateway/routeShards.ts`, `scripts/migration-gateway.test.mjs`
- 新規: `+docs/migration/work-items/MIG-0512.md`
- 共有の注意: `docs/migration/work-items/MIG-0411.md`（BLOCKED）は Owned paths に `apps/site/src/gateway/index.ts` を comma 区切りで持つ。この task は `fetch()` だけを変え、`queue()`（:284-297）は変えない。PR に書く。
- 触らない: `apps/site/src/gateway/edgePolicy.ts`, `visibility.ts`, `r2Html.ts`, `pageRenderQueue.ts`, `apps/site/src/pages/**`
#### Micro-units
- **U01 HTML の 404/503（D-13-26）**: `notFoundPage(env, url, method)` と `unavailablePage(...)` を足す。`env.ASSETS.fetch(new Request(new URL("/404", url.origin), { redirect: "manual" }))`（503 は `"/503/"`）が 200 なら、その本文を status 404 / 503 で返す。header は `Content-Type: text/html; charset=utf-8`, `Cache-Control: no-store, private`, `X-Robots-Tag: noindex, nofollow`、503 は `Retry-After: 30`。HEAD は本文 null。ASSETS が無い、throw した、200 でないときは今の text の応答に戻す（503 の text にも `Retry-After: 30` を付ける）。使う場所: `fetch()` の page の経路（`deny`, `unavailable`, `servePage` の 503, shard / KV の欠落）。使わない場所: `/api/auth`（`forwardToAuth` は text のまま）、405。
- **U02 sub-page の fence（D-13-25, D-13-33）**: `/^\/(event)\/([^/]+)\/(release|slots)\/?$/` と `/^\/(user)\/([^/]+)\/(portfolio)\/?$/` に合う path は、親の path（`/event/{id}`, `/user/{id}`）で `evaluateVisibility` を通す。`serve` → release と portfolio は `ASSETS.fetch(/${decision.key}/${sub}/)`（directory 形、manual）、slots は今と同じく元の request を manual で渡す（`_redirects` の 0 枠 307 を保つ）。応答: 200/304 はそのまま、slots の 30x はそのまま、404 は `notFoundPage`（R2 には落とさない）、それ以外は `unavailablePage`。`redirect` → `targetPath` に `?` か `#` があれば 404、無ければ `${targetPath}/${sub}` へ同じ status、query は `redirectLocation`。`deny` → 404、`unavailable` → 503。今の `EVENT_SLOTS_PATH` の直通の分岐（:219-226）は消す。
- **U03 build file と font の許可**: `routeShards.ts` に `export const BUILD_OUTPUT_FILES: ReadonlySet<string> = new Set(["/user/index.json"])` を足し、`fixedPublicPath` で `PUBLIC_ASSET_FILES` の次に見る。`PUBLIC_ASSET_PREFIXES` に `"/fonts/"` を足す。`/user/creator-alpha` が素通りしない test（:485-505）は pass のまま。
#### Test cases
| ID | 入力/操作 | 期待 |
| --- | --- | --- |
| T01 | 不明な id、`pages` に `/404` あり | 404、本文は `/404` の HTML、`text/html`、noindex、no-store |
| T02 | shard 欠落、`pages` に `/503/` あり / 無し | 503 + `Retry-After: 30`、本文は HTML / text |
| T03 | `/api/auth/*`、AUTH_ORIGIN 無し | 503 の text（今のまま） |
| T04 | 公開 event の `/event/e/release`（asset あり / 無し） | 200 / 404 |
| T05 | KV `deny:event:e` の `/event/e/slots` と `/event/e/release` | 404（asset があっても） |
| T06 | 0 枠 event の `/event/e/slots` | Assets の 307 `Location: /event/e` がそのまま返る |
| T07 | `/user/Mixed_Case/portfolio`、`deny:user:mixed_case` | 200（`/user/mixed_case/portfolio/`）、deny 後は 404 |
| T08 | event の alias の `/event/alias/release?x=1` | alias の status で `Location: /event/canonical/release?x=1` |
| T09 | `/user/index.json`, `/fonts/FlameNodeSans.otf` | shard も KV も読まずに 200。`/fonts/../x`, `/fonts/.x` は 404 |
| T10 | HEAD の 404 / 503 | 本文なし、status と header は GET と同じ |
| T11 | 既存の gateway test（`pages` に `/404` が無い） | 全部 pass（text に戻る） |
#### Commands
PR の前に repo root で全部 pass させる。
```bash
node --test --experimental-strip-types scripts/migration-gateway.test.mjs
node --test --experimental-strip-types apps/site/src/gateway/edgePolicy.test.mjs apps/site/src/gateway/pageRenderQueue.test.mjs apps/site/src/gateway/assetHeaders.test.mjs
node --test --experimental-strip-types scripts/migration-route-map.test.mjs
npm run typecheck
npm run check:project-docs
npm run check:migration-work-items
```
#### Ledger updates
`FILE_MIGRATION_MATRIX.md` の `apps/site/src/gateway/index.ts` / `routeShards.ts` の行（無ければ MIG-0405 の行）の証跡にこの PR を足す。`ROUTE_MATRIX.md` の `/event/[id]/release`, `/event/[id]/slots`, `/user/[id]/portfolio` の行に「gateway sub-page fence: MIG-0512」と証跡を書く。
#### DONE checklist
- [ ] T01〜T11 pass
- [ ] slots・release・portfolio が親の `deny:` で 404 になる
- [ ] request ごとの読み取りは route shard 1つ + KV 1回 + Assets/R2 の object 1つのまま（ZERO_1102 S1、`fetch()` の `calls` で確認）
- [ ] 本番 Route・Worker・KV・Queue に触れていない
#### STOP
- route map（`routeMap.ts`）に sub-page の key を足す必要が出たら止める（MIG-0404 の契約変更）。
- 1 request で KV を2回以上読む必要が出たら止める。
- 本番の Worker・Route・Custom Domain・KV の変更は owner の明示承認事項。PR では行わない。
#### Rollback
PR を revert。fetch の分岐だけなので data の戻しは無い。

### MIG-0508: Phase 5 Gate
- **Model:** lead
- **Readiness:** NEEDS_REFINEMENT — Phase Gate はエージェントが自動承認しない
- **Recipe:** R-EVIDENCE
- **Runtime:** N
- **Depends on:** MIG-0501..MIG-0507, MIG-0509..MIG-0512, MIG-0621, MIG-0607 / **Decisions:** D-02 DECIDED, D-06 DECIDED, D-08 DECIDED, D-09 DECIDED, D-11 DECIDED
- **Verified against:** `7a19a42` (2026-10-25)
#### Source snapshot
- `CURRENT_ROUTES.md` の Public 16 ルート（VISUAL_SCREEN 13 + COMPAT_REDIRECT 3）と `ROUTE_MATRIX.md`。
- MIG-0501〜0507、0509〜0512 の merge 済み PR と work item。
#### Owned paths
- 新規: `+docs/migration/design/PHASE_5_GATE.md`
- 変更: `docs/migration/ROUTE_MATRIX.md`（16ルートの disposition と証跡）, `docs/migration/STATUS.md`（承認後だけ）
#### Micro-units
- **U01 matrix**: 16ルートすべてに legacy→new の対応、URL・スクリーンショット・テスト・rollback の証跡を付ける。公開系 UX の取りこぼしを数える（MIG-0510 の Island を含む）。
- **U02 build**: MIG-0509 の Workers Builds 実測と file 数、icon map（MIG-0511）が本番データで入ったことを記録。
- **U03 review**: 独立レビューと人間の Phase Gate 承認を依頼。
#### Test cases
| ID | 入力/操作 | 期待 |
| --- | --- | --- |
| T01 | 16ルート × 公開/非公開/alias | すべて期待どおり |
| T02 | SEO/OGP | CURRENT と一致 |
| T03 | 直接再読込・スマホ・キーボード | 16ルートで問題なし |
| T04 | 操作 Island（like / chapter / 予約 / 同意 / Active X） | Hono API で CURRENT と同じ結果 |
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
- [ ] 公開データがすべて build 時に作られている（MIG-0509）、icon map も（MIG-0511）
- [ ] 操作 Island が Phase 6 API につながっている（MIG-0510）
- [ ] 独立レビューの APPROVE と人間の Phase Gate 承認
- [ ] 旧 Next の Auth/API/非公開経路に触れていない
#### STOP
- 人間の承認なしに STATUS を DONE にしない。
#### Rollback
Gate 文書の PR を revert。

