# Phase 4 Acceptance Gate: Public SSG, Gateway & Free-Tier PoC Audit (MIG-0407)

> Gate Status: **APPROVED** — 人間（Yugo / GitHub coroke3）が 2026-10-23T09:47:32Z にプロジェクトスレッドで「フェーズ4のgateを承認します」と承認（message ref `cmsg_01AJzh3ov5j8ZhPEfvz4FDRV6E3GxpZmzc8G1U8Q4StkYS`）。承認時点の証跡は §5。代表画面の目視確認は個別記録なし（owner が個別の目視記録なしで承認）。
> Task: MIG-0407（Recipe R-EVIDENCE, Runtime N）  
> Work Order: [`PHASE_4_5_SPEC.md`](../PHASE_4_5_SPEC.md) `### MIG-0407`  
> Decisions: D-02 DECIDED, D-06 DECIDED, D-08 DECIDED, D-09 DECIDED  
> Last verified: 2026-10-23  
> Verified against commit: `34730b822d8145b55d1956dd699b10436533a27a`（origin/main）

エージェントは Gate を承認しない。この文書は判定材料の一覧であり、署名は人間（Yugo）の行為である。2026-10-23 に Yugo が承認し、エージェントはその事実を §5 に記録しただけである。§1〜§4 は承認前（main `34730b82`）時点の判定材料として残す。

---

## 1. 前提: Phase 4 タスクの統合状態（2026-10-23 時点、main `34730b82`）

| Task | 対象 / スコープ | 所有パス | 実装状況 | main 統合状態 |
| :--- | :--- | :--- | :--- | :--- |
| **MIG-0401** | Public snapshot loader & fixture PoC | `apps/site/src/lib/publicDataLoader.ts`, `apps/site/src/pages/migration-fixture-poc` | 実装完了 | **merge 済み**（`03972deb`, PR #283） |
| **MIG-0404** | Build-time route-map generator | `apps/site/src/lib/routeMap.ts` | 実装完了 | **merge 済み**（`62b8dad7`, PR #305） |
| **MIG-0405** | Thin visibility gateway Worker | `apps/site/src/gateway/**` | 実装完了 | **merge 済み**（`b8817d6e`, PR #313） |
| **MIG-0406** | CPU benchmark & capacity verification | `PERF_HOTPATH_MATRIX.md`, `scripts/check-public-site-build-budget.*` | 実装完了 | **merge 済み**（`1e435c4d`, PR #314） |
| **MIG-0409** | Build-time public data from D1 (D-09) | `apps/site/scripts/readPublicData.ts`, `apps/site/src/lib/BUILD_TIME_DATA.md` | U01/02/04 完了、U03/U07 は owner の Cloudflare 操作待ち（work-item 参照） | **merge 済み**（`4f90bc9d`, PR #323） |
| **MIG-0410** | Deploy hook build scheduler Cron (D-09) | `workers/fast-jobs/publicBuildTrigger.ts`, `migrations/0065_*.sql` | 実装完了（13/13 PASS） | **merge 済み**（`64781657`, PR #325）。本番手順（0065 適用・Deploy Hook・secret・fast-jobs deploy）は別途 owner 承認待ち |
| **MIG-0411** | Queue ISR per-page regeneration (D-09) | `apps/site/src/gateway/pageRenderQueue.ts`, `migrations/0066_*.sql` | 実装完了（15/15 PASS） | **merge 済み**（`45edac4f`, PR #326、最終 Head `5f46ab33`）。本番 D1 に migration 0066 を 2026-10-23 に適用済み（Time Travel bookmark `000040fb-00000000-0000510d-0fe59f1506fe91415c0e0c0f10c1f92d`）。Queue 作成・gateway binding・producer 配線・workerd CPU は未了 |
| **MIG-0402** | Shared React UI in Astro via Islands | `apps/site/src/components/IslandWrapper.ts`, `SiteAdapterProvider.ts` | 実装完了（8/8 PASS） | **merge 済み**（`7573ff67`, PR #324） |
| **MIG-0403** | Representative video/event/user SSG | `apps/site/src/pages/[id].astro`, `event/[id]`, `user/[id]` | 実装完了（4/4 PASS） | **merge 済み**（`68424cbc`, PR #327） |

→ **前提状態:** MIG-0401, 0402, 0403, 0404, 0405, 0406, 0409, 0410, 0411 の 9 件が `main` にマージ済み（MIG-0411 は code のみ。本番の Queue・binding・CPU 計測は owner 手順として未了）。なお STATUS.md の MIG-0409/0410/0411/0407 行は未更新（STATUS.md は merge 直前の統合でのみ更新する運用）。

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

> 注意: 以下の Gateway CPU 等の数値は**ローカル計測**（Node 22 + Assets/KV モック、`scripts/migration-gateway.test.mjs` T05。`wrangler dev` では workerd が request 単位の CPU を報告しない）であり、本番 Cloudflare での実測ではない。出典: [`PERF_HOTPATH_MATRIX.md`](../PERF_HOTPATH_MATRIX.md) の `/:id` 行（local p99 0.25–0.47ms）。「< 1.5ms」は目標予算（p50 < 1.5ms、`PERFORMANCE_IMPLEMENTATION_PLAN.md`）に対する上界。本番 1102=0 の確認は未実施で、Phase 5 以降の nonprod / shadow 計測で行う。

| 項目 / 制約 | Free Tier 上限 | 測定値 / 設計値 | 状態 |
| :--- | :--- | :--- | :--- |
| **Worker CPU per Request** | 10ms (Hard max) | Gateway: **< 1.5ms**（ローカル計測）, Static Assets: **0ms**（直配信） | **達成** (< 15% 予算) |
| **Static Asset Ingress** | N/A | `run_worker_first = false`（静的アセット直配信を維持） | **達成** |
| **Cron Triggers** | 5 triggers / account | **4 / 5 使用中**（新規 Cron trigger 追加なし） | **達成** |
| **Queue Operations / 日** | 10,000 ops / 日 | 6,000 通常 / 4,000 予備（MIG-0411 1 msg/invocation 境界） | **達成** |
| **D1 Queries per Request** | 50 queries / invocation | Gateway: **0 queries**, SSG 配信: **0 queries** | **達成** |
| **Site Build Time** | 15 分 / run | 代表 6 ページを 5.45s でビルド完了（`check-public-site-build-budget.mjs`） | **達成** |

---

## 3. 未達項目とユーザー（Yugo）の決定事項

Phase 4 Gate を承認・通過するために、以下の判断とマージが必要です：

1. **Phase 4 open PR のマージ**:
   - PR #326（MIG-0411）は merge 済み（PR #323/#324/#325/#327 も main 統合済み）。残るのは本番 Queue 作成・gateway binding・workerd CPU 計測の owner 承認。
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

- [x] Phase 4 の全実装タスク（MIG-0401〜0406, 0409〜0411）が `main` に merge 済みであること（MIG-0411 / PR #326 は 2026-10-23 に merge。本番 Queue・binding・workerd CPU は別項目として未了）
- [x] ユーザー判断事項（D1 取得方式、遅延定数、ISR 描画方式）が合意・反映されていること（2026-10-18 に Yugo が決定。`work-items/MIG-0409.md`（owner decisions applied）と `work-items/MIG-0411.md`「Yugo decisions」の項目1。Queue 作成・binding・Cron 割り当て（項目2〜3）は未了で、§5 の Accepted deferrals）
- [x] Fail-closed 公開可視性が検証済みであること（非公開データ漏洩 0 件）
- [x] Free Tier 予算制約（CPU < 10ms、Cron ≤ 5、Queue ≤ 10,000）が検証済みであること（ローカル計測・設計上限の範囲。workerd / 本番 CPU と Queue メッセージ量 F-02 は未検証で、§5 の Accepted deferrals）
- [x] `apps/site` から Next.js への依存漏洩が 0 件であること
- [ ] 代表3画面の目視レビューが完了し、人間（Yugo）が外観を承認していること（owner の承認文言は Gate 全体への承認で、目視確認を個別に指すものではない。approved by owner without separate visual-check record）
- [x] **人間の Phase Gate 承認**: Yugo が 2026-10-23T09:47:32Z に承認（§5）

---

## 5. 人間の Gate 承認記録（2026-10-23）

- 承認者: Yugo（人間 / GitHub coroke3）。2026-10-23T09:47:32Z、プロジェクトスレッドで「フェーズ4のgateを承認します」。message ref `cmsg_01AJzh3ov5j8ZhPEfvz4FDRV6E3GxpZmzc8G1U8Q4StkYS`。
- 承認時点の証跡: Phase 4 の全実装タスクが main に merge 済み（MIG-0411 は PR #326 `45edac4f`）、本番 D1 に migration 0066 を適用済み、PR #328 merge 済み（dbaec7dd）。
- **Accepted deferrals at approval**（承認はこれらの解消を意味しない。各 work item で追跡する）:
  - Gateway / Queue の本番配線（Queue `flamenode-page-renders` の作成、bindings、Deploy Hook、secrets）は owner の手順待ち。
  - MIG-0409: U07 は DONE（2026-10-23 の非本番 probe、ZERO_1102 §1）、U03（Workers Builds 5 回の再計測）は DEFERRED で追跡先は MIG-0509（`work-items/MIG-0409.md` の micro-unit 表）。MIG-0409 自体は BLOCKED のまま。CPU 計測はローカルと非本番 probe のみ（workerd の page render / 本番 1102=0 は未確認）。
  - Queue メッセージ量 F-02（最悪ケース約 35,000 msgs/day）は未決。
  - `_ops_assets` prefix の扱い（MIG-0620）は未決。
  - migration 0066 は 2026-10-23 に本番へ適用済み（Time Travel bookmark `000040fb-00000000-0000510d-0fe59f1506fe91415c0e0c0f10c1f92d`）。
  - 代表3画面の目視確認は個別記録なし（approved by owner without separate visual-check record）。
- **依存の変更:** MIG-0407 の依存は owner 判断で MIG-0403 と MIG-0406 のみに戻した（MIG-0410 / MIG-0411 は D-09 追加時に足されたもの）。MIG-0409 / 0410 / 0411 は BLOCKED のまま。
- 本記録は Phase 5 の着手を許可するが、本番 cutover・Worker Route・Custom Domain・Remote D1・secret 操作の承認を含まない。Phase 5 Gate（MIG-0508）は別途必要。
