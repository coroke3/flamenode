# Phase 4 Acceptance Gate: Public SSG, Gateway & Free-Tier PoC Audit (MIG-0407)

> Gate Status: **NOT MET / BLOCKED** — 判定前（Phase 4 未マージPR、ユーザー判断事項、人間の Phase Gate 承認が未達）  
> Task: MIG-0407（Recipe R-EVIDENCE, Runtime N）  
> Work Order: [`PHASE_4_5_SPEC.md`](../PHASE_4_5_SPEC.md) `### MIG-0407`  
> Decisions: D-02 DECIDED, D-06 DECIDED, D-08 DECIDED, D-09 DECIDED  
> Last verified: 2026-10-19（Head: `389e469b6574fb664b9f70b1665bbbb589e3f740`）

エージェントは Gate を承認しない。この文書は判定材料の一覧であり、承認は PR #328 に人間（Yugo）が明示的に記録する。前提条件や証跡が未達の項目は「未達」とし、該当タスクの統合後に再評価する。

---

## 1. 前提: Phase 4 タスクの統合状態（2026-10-19 時点）

| Task | 対象 / スコープ | 所有パス | 実装状況 | main 統合状態 |
| :--- | :--- | :--- | :--- | :--- |
| **MIG-0401** | Public snapshot loader & fixture PoC | `apps/site/src/lib/publicDataLoader.ts`, `apps/site/src/pages/migration-fixture-poc` | 実装完了 | **merge 済み**（`36bf4c67`, PR #283） |
| **MIG-0404** | Build-time route-map generator | `apps/site/src/lib/routeMap.ts` | 実装完了 | **merge 済み**（`c3203081`, PR #305） |
| **MIG-0405** | Thin visibility gateway Worker | `apps/site/src/gateway/**` | 実装完了 | **merge 済み**（`b8817d6e`, PR #313） |
| **MIG-0406** | CPU benchmark & capacity verification | `PERF_HOTPATH_MATRIX.md`, `scripts/check-public-site-build-budget.*` | 実装完了 | **merge 済み**（`1e435c4d`, PR #314） |
| **MIG-0409** | Build-time public data from D1 (D-09) | `apps/site/scripts/readPublicData.ts`, `apps/site/src/lib/BUILD_TIME_DATA.md` | U01/02/04 完了、U03/05/06/07 は判断待ち | **未 merge**（PR #323, Head `403ba308`, BLOCKED） |
| **MIG-0410** | Deploy hook build scheduler Cron (D-09) | `workers/fast-jobs/publicBuildTrigger.ts`, `migrations/0065_*.sql` | 実装完了（13/13 PASS） | **未 merge**（PR #325, Head `2d64b8fe`, Stack on #323） |
| **MIG-0411** | Queue ISR per-page regeneration (D-09) | `apps/site/src/gateway/pageRenderQueue.ts`, `migrations/0066_*.sql` | 実装完了（15/15 PASS） | **未 merge**（PR #326, Head `ae309ece`, Stack on #325） |
| **MIG-0402** | Shared React UI in Astro via Islands | `apps/site/src/components/IslandWrapper.ts`, `SiteAdapterProvider.ts` | 実装完了（8/8 PASS） | **未 merge**（PR #324, Head `290fea0e`, Stack on #321） |
| **MIG-0403** | Representative video/event/user SSG | `apps/site/src/pages/[id].astro`, `event/[id]`, `user/[id]` | 実装完了（4/4 PASS） | **未 merge**（PR #327, Head `06f7a563`, Stack on #324） |

→ **前提状態:** MIG-0401, 0404, 0405, 0406 の 4 件が `main` にマージ済み。MIG-0402, 0403, 0409, 0410, 0411 の 5 件は open PR の段階であり、`main` への統合は **未達**。

---

## 2. Dual Gate 判定項目とエビデンス（Work Order U01）

### Track A: Visual & UX Evidence（画面・表現・可視性）

| 項目 | 結果 | 証跡 / 詳細 |
| :--- | :--- | :--- |
| **代表3画面のプリレンダリング** | **実装完了 / 目視判定待ち** | Astro SSG により静的 HTML を出力。`@[id].astro` (Video), `@event/[id]/index.astro` (Event), `@user/[id]/index.astro` (Creator) が `@flamenode/ui` 画面コンポーネントを内包。**人間の画面目視確認が必要** |
| **Canonical URL & OGP 整合** | **達成** | `scripts/migration-ssg-representatives.test.mjs` にて各代表画面の canonical（エイリアス動画の正規化含む）および OGP 属性の出力を検証（4/4 PASS） |
| **Fail-Closed 公開可視性** | **達成** | 非公開・下書き・削除済み・凍結データ（`private-video-hidden`, `draft-secret-event`, `suspended-user` 等）が SSG 出力（`dist/`）に一切含まれないことをテストで検証 |
| **URL サニタイズ** | **達成** | `publicDataLoader.ts` にて `javascript:`, `data:`, `vbscript:`, `//` 等の危険プロトコルを fail-closed で遮断 |
| **Framework 漏洩 0 件** | **達成** | `apps/site` 配下に `next` / `next/*` の import が 0 件であることを `IslandWrapper.test.mjs` (T04) で検証 |

### Track B: Performance & Cloudflare Free-Tier Budget（性能・容量・予算）

| 項目 / 制約 | Free Tier 上限 | 測定値 / 設計値 | 状態 |
| :--- | :--- | :--- | :--- |
| **Worker CPU per Request** | 10ms (Hard max) | Gateway: **< 1.5ms**, Static Assets: **0ms**（直配信） | **達成** (< 15% 予算) |
| **Static Asset Ingress** | N/A | `run_worker_first = false`（静的アセット直配信を維持） | **達成** |
| **Cron Triggers** | 5 triggers / account | **4 / 5 使用中**（新規 Cron trigger 追加なし） | **達成** |
| **Queue Operations / 日** | 10,000 ops / 日 | 6,000 通常 / 4,000 予備（MIG-0411 1 msg/invocation 境界） | **達成** |
| **D1 Queries per Request** | 50 queries / invocation | Gateway: **0 queries**, SSG 配信: **0 queries** | **達成** |
| **Site Build Time** | 15 分 / run | 代表 6 ページを 5.45s でビルド完了（`check-public-site-build-budget.mjs`） | **達成** |

---

## 3. 未達項目とユーザー（Yugo）の決定事項

Phase 4 Gate を承認・通過するために、以下の判断とマージが必要です：

1. **Phase 4 open PR のマージ**:
   - PR #321（Phase 2 Gate）承認・マージ後、PR #324（MIG-0402）および PR #327（MIG-0403）をマージする。
   - PR #323（MIG-0409）、PR #325（MIG-0410）、PR #326（MIG-0411）を順次マージする。
2. **MIG-0409 D1 ビルドデータ取得方式の決定**:
   - Option A（読み取り専用 API トークン）vs Option B（`wrangler d1 export` スナップショット）。
   - 最大公開遅延とデバウンス定数の承認（`MIN_BUILD_INTERVAL_MS = 480_000`, `MAX_DATA_BUILDS_PER_DAY = 180`）。
3. **MIG-0411 描画形式の決定**:
   - Option B（最小 HTML head シェル + クライアント側 JS 描画）を許容するか、Option A（`renderToString` による完全静的テキスト出力）を要求するか。
   - 本番 Queue の作成承認および未処理リカバリ用 Cron の割り当て。
4. **代表3画面の目視確認**:
   - `apps/site` で出力された代表 3 画面の見た目が registered mock と整合しているかを目視判定する。
5. **Phase 4 Gate の人間署名**:
   - 上記がすべて解決した段階で、本 PR #328 に人間が Gate 承認コメントを記録する。

---

## 4. Gate チェックリスト

- [ ] Phase 4 の全実装タスク（MIG-0401〜0406, 0409〜0411, 0402, 0403）が `main` に merge 済みであること
- [ ] ユーザー判断事項（D1 取得方式、遅延定数、ISR 描画方式）が合意・反映されていること
- [x] Fail-closed 公開可視性が検証済みであること（非公開データ漏洩 0 件）
- [x] Free Tier 予算制約（CPU < 10ms、Cron ≤ 5、Queue ≤ 10,000）が検証済みであること
- [x] `apps/site` から Next.js への依存漏洩が 0 件であること
- [ ] 代表3画面の目視レビューが完了し、人間（Yugo）が外観を承認していること
- [ ] **人間の Phase Gate 承認**: PR #328 に人間による Gate 承認が記録されていること
