# Static Delivery

> Status: Active
> Last verified: 2026-07-27
> Verified against: `src/lib/publicData/`, `src/lib/admin/staticSharedInputDiagnostics.ts`, `app/(public)/`, `app/(admin)/admin/static-builds/`, `workers/json-generator/`, `wrangler.toml`

**AI:** 公開静的 JSON / degraded D1 / Cache の仕様。正本コードは `src/lib/publicData/loader.ts`。軽量モデルは調査・文書修正まで。loader・権限・公開 DTO 変更は中位以上。

D1が正本で、R2 JSONは公開配信キャッシュです。`public`だけを一覧・検索・R2・公開APIへ出し、`limited`は直接詳細だけ、その他は権限者以外へ出さない。artifactのkey、hash、version、source更新時刻を追跡し、非公開化やYouTube ID変更時は旧keyを削除する。

## 公開データの取得順

公開ローダー (`src/lib/publicData/loader.ts`) は次の順で試す。

1. **Cache API**（isolate 内・TTL は loader ごと）
2. **R2** の静的 JSON（ヒット時は D1 / enqueue を呼ばない）
3. **degraded D1**（`static_json_with_live_overlay` かつ kill switch 有効時のみ）
4. **Unavailable**（空表示・メッセージ。`maintenance` / `static_json_only` / kill switch 無効時は D1 に進まない）

R2の読み込みPromiseはrequestをまたぐmodule-global状態へ保存しない。各呼び出しは、そのrequestのCloudflare bindingだけで完結させる。重複読み込みの抑制とstale復旧はCache APIで行う。

`static_json_with_live_overlay` では、R2の一覧JSONが空でもD1へ公開作品が追加済みの可能性があるため、空のcollectionをsemantic missとして扱い degraded D1 へ進める。`static_json_only` と `maintenance` では、空の静的JSONをそのまま利用するか、D1 fallback しない。

### Kill switch / static-only

- `PUBLIC_DEGRADED_D1_ENABLED`（`wrangler.toml` / `.dev.vars`）: 明示 `0` / `false` / `no` / `off` で R2 ミス後の degraded D1 を無効化する。未設定時は有効。
- `FORCE_STATIC_ONLY` または運用モードが `static_json_only` のときは degraded D1 に進まず、Unavailable または静的 JSON のみ。

ミス時のみ `operation_mode` を解決（`FORCE_STATIC_ONLY` > isolate 短時間キャッシュ > KV 複製 > D1）。解決不能時は `static_only` へ倒し、`normal` へは倒さない。cost-guard で mode 変更時は D1 成功後に KV 複製を更新し、KV 失敗は成功扱いにしない。

## 観測と UI

公開 layout の `CostGuardBanner` は `source` 省略（= public）で、D1 の `system_settings` を読まず env / isolate / KV のみ参照する。admin layout は `source="admin"` で D1 正本を読む。

公開主要ページは `PublicMetricsShell` 内で `runWithPublicRequestMetrics` を使い、構造化ログ（`public_request_metrics`）を出す。D1 への永続化はしない。`degraded_d1` 時は同じ ALS スコープ内の `PublicDegradedBanner`（`role="status"`）が簡易表示を知らせる。

## 静的再生成と Projection

静的再生成は `content-jobs` が **1 target / 15分** で処理する。表示用ポリシー正本は `src/lib/operationMode/policy.ts` の `STATIC_REBUILD_ITEMS_PER_RUN`（= `workers/json-generator/queuePolicy.ts` の `MAX_QUEUE_ITEMS_PER_RUN`）と一致させる。

Admin Spreadsheetのうち `videos`、`video_youtube_metadata`、`video_events`、`video_members`、`video_chapters`、`x_users` の変更は、対象の動画詳細・関連動画共有JSON・クリエイター投影をplannerで導出し、data mutation・preview nonce消費・監査・`static_rebuild_queue`を同じD1 atomic batchへ入れる。1回のapplyは11行までとし、plannerは最大16 target、queue helperは最大4 statementに収める。いずれかを超える場合はデータを書かず、行を分割して再実行する。

Creator Projection（`workers/json-generator`）は公開用カード・詳細 JSON を R2 に書き、一覧は `list/recent.json` / `list/popular.json`、検索は `search-index-lite.json`、クリエイター索引は `users/index.json` を正本とする。`users_index` 再生成時に `users/public-x-icon-map.v1.json`（entries形式）も同時出力する。トップの hero 用 `slot_stats` は対象イベント最大 3 件に限定する。

関連動画の非公開除外は `youtube/related-blocklist.v1.json`、補完候補は `videos/random-pool.v1.json` を用いる。どちらも読み込みは fresh Cache → R2 → stale Cache（最大24h）→ unavailable とし、状態を捨てない。必要な共有JSONがunavailableのときは関連動画セクションを障害表示へ分離し、空blocklist・正常な0件へ倒さない。

`/admin/static-builds` は両objectについて、R2 `head` による実体の有無、公開ローダーの `fresh` / `stale` / `unavailable`、`generated_at`、blocklist件数またはrandom pool件数を表示する。binding欠損・`head`失敗は「確認不可」とし、既存の管理者write guardを通る個別再生成キューだけを提供する。

主な公開 artifact:

| 用途 | R2 key | target_type |
| --- | --- | --- |
| トップ | `top.json` | `top` |
| 作品一覧（新着） | `list/recent.json` | `list_recent` |
| 作品一覧（人気） | `list/popular.json` | `list_popular` |
| 検索索引 | `search-index-lite.json` | `search_index` |
| イベント一覧 | `events/index.json` | `events_index` |
| イベント詳細 | `events/{id}.json` | `event` |
| クリエイター一覧 | `users/index.json` | `users_index` |
| クリエイター詳細 | `users/{id}.json` + `users/{id}/works\|collabs/p{n}.json` | `user` |
| おすすめ | `recommend.json` | `recommend` |
| 利用規約 | `rules/current.json` | `rules` |
| サイトマップ | 上記索引から動的生成 | — |

`/list?event=` は専用 R2 key を持たず、degraded D1 の bounded 一覧（`fetchDegradedEventListPage`、LIMIT 24 + ページング）で補う。
