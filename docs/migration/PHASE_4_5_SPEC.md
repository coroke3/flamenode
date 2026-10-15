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

### MIG-0407: Phase 4 Gate（**0403 + 0406 両方の証跡が必要**）
- **Model:** lead
- **Readiness:** NEEDS_REFINEMENT — Phase Gate はエージェントが自動承認しない
- **Recipe:** R-EVIDENCE
- **Runtime:** N
- **Depends on:** MIG-0403, MIG-0406 / **Decisions:** D-02 DECIDED, D-06 DECIDED, D-08 DECIDED
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

### MIG-0508: Phase 5 Gate
- **Model:** lead
- **Readiness:** NEEDS_REFINEMENT — Phase Gate はエージェントが自動承認しない
- **Recipe:** R-EVIDENCE
- **Runtime:** N
- **Depends on:** MIG-0507, MIG-0607 / **Decisions:** D-02 DECIDED, D-06 DECIDED, D-08 DECIDED
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
- [ ] 独立レビューの APPROVE と人間の Phase Gate 承認
- [ ] 旧 Next の Auth/API/非公開経路に触れていない
#### STOP
- 人間の承認なしに STATUS を DONE にしない。
#### Rollback
Gate 文書のPRをrevert。
