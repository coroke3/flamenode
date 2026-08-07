# Static Delivery

> Status: Active
> Last verified: 2026-07-31
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

### Kill switch / static-only / circuit breaker

- `PUBLIC_DEGRADED_D1_ENABLED`（`wrangler.toml` / `.dev.vars`）: 明示 `0` / `false` / `no` / `off` で R2 ミス後の degraded D1 を無効化する。未設定時は有効。
- `FORCE_STATIC_ONLY` または運用モードが `static_json_only` のときは degraded D1 に進まず、Unavailable または静的 JSON のみ。
- R2 miss が 1 分あたり 20 件以上（`degradedCircuitBreakerCore.ts`）のとき、KV サーキットが open になり degraded D1 を一時停止する。Cache API の stale エントリは引き続き返す。R2 ヒットが 3 回連続すると自動解除する。

### Cache TTL（Cache API / R2 max-age）

| データ | Cache API TTL（秒） | 反映目標 |
| --- | ---: | --- |
| 動画詳細 | 180 | 30秒以内（再生成側） |
| イベント詳細 | 120 | 1分以内 |
| ユーザー詳細 | 60 | 1分以内 |
| 新着一覧 | 180 | 3分以内 |
| 検索インデックス | 300 | 5分以内 |
| ランキング / top | 600 | 10分以内 |
| top slot-stats | 600 | 10分以内（`top.json` と同値） |
| users/index | 600 | — |
| 利用規約 | 3600 | — |
| blocklist / random pool | 600 | — |

正本定数: `src/lib/publicData/publicJsonCacheTtl.ts`（web）、`workers/shared/staticR2CacheControl.ts`（R2 PUT）。

ミス時のみ `operation_mode` を解決（`FORCE_STATIC_ONLY` > isolate 短時間キャッシュ > KV 複製 > D1）。解決不能時は `static_only` へ倒し、`normal` へは倒さない。cost-guard で mode 変更時は D1 成功後に KV 複製を更新し、KV 失敗は成功扱いにしない。

## 観測と UI

公開 layout の `CostGuardBanner` は `source` 省略（= public）で、D1 の `system_settings` を読まず env / isolate / KV のみ参照する。admin layout は `source="admin"` で D1 正本を読む。

公開主要ページは `PublicMetricsShell` 内で `runWithPublicRequestMetrics` を使い、構造化ログ（`public_request_metrics`）を出す。D1 への永続化はしない。`degraded_d1` 時は同じ ALS スコープ内の `PublicDegradedBanner`（`role="status"`）が簡易表示を知らせる。

## 静的再生成と Projection

静的再生成は Queue Consumer / Recovery Cron の各 invocation で **1 target** だけ処理する（`workers/json-generator/queuePolicy.ts` の `MAX_QUEUE_ITEMS_PER_RUN` = 1）。Recovery Cron は毎時最大 `CONTENT_JOBS_RECOVERY_MAX_TARGETS`（3）件まで排水する。D1 statement は `workers/shared/d1Budget.ts` の soft limit（40）で停止する。表示用ポリシー正本は `src/lib/operationMode/policy.ts` の `STATIC_REBUILD_ITEMS_PER_RUN` と一致させる。

コード deploy（`BUILD_COMMIT_SHA` 変化）時は、Recovery Cron が `list_recent`、`list_popular`、`search_index`、`users_index`、`top`、`top_slot_stats`、`recommend`、`events_index`、`youtube_related_blocklist`、`random_video_pool` の global target を `deploy_generator_change` / high で enqueue する。`rebuildTop` も `top/slot-stats.v1.json` を同時更新するが、`top_slot_stats` を別途 enqueue して欠損時の保険とする（冪等）。KV `static:last_generator_commit` で同一 commit の重複 enqueue を抑止する。

Admin Spreadsheetのうち `videos`、`video_youtube_metadata`、`video_events`、`video_members`、`video_chapters`、`x_users` の変更は、対象の動画詳細・関連動画共有JSON・クリエイター投影をplannerで導出し、data mutation・preview nonce消費・監査・`static_rebuild_queue`を同じD1 atomic batchへ入れる。1回のapplyは11行までとし、plannerは最大16 target（`SPREADSHEET_STATIC_REBUILD_TARGET_LIMIT`）、queue helperは最大4 statementに収める。いずれかを超える場合はデータを書かず、行を分割して再実行する。

Spreadsheet planner（`src/lib/admin/spreadsheet/staticRebuildPlan.ts`）は mutation の before/after だけから target を導出し、同一 apply 内では `Map` で `targetType:targetId` を dedupe する。`videos` の CREATE または `visibility_status` 変更では、動画詳細 `video` に加え `random_video_pool:global`、`youtube_related_blocklist:global`、`list_recent:global`、`list_popular:global`、`search_index:global` へ fan-out する（public 作品 CREATE の例: 上記6 target）。タイトルや intro だけの UPDATE は `video` だけ。1 apply で public 作品を3行 CREATE すると 18 target となり 16 上限を超えるため、行の分割が必要になる。

Creator Projection（`workers/json-generator`）は公開用カード・詳細 JSON を R2 に書き、一覧は `list/recent.json` / `list/popular.json`、検索は `search-index-lite.json`、クリエイター索引は `users/index.json` を正本とする。`users_index` 再生成時に `users/public-x-icon-map.v1.json`（entries形式）と `users/pickup-creators.v1.json`（top/recommend の Creator 棚用、最大60件）も同時出力する。`top` / `recommend` の Creator 棚は通常時この pickup artifact を読み、欠損・破損時のみ D1 projection へ fallback する。登録ユーザーは icon 欠損時も `source: none` とし、historical icon は表示用に保持する。公開ページのXアイコン補完は fresh/stale Cacheを含む共有icon map → R2 `users/index.json` → 詳細JSON埋め込み値の順で解決し、entry 欠損や `source: video` のときだけ index で `registered` / `none` へ昇格を試みる。この補完経路からD1へは降りない。`users/index.json` 補完ではアイコンなしの公開プロフィールも `source: none` として保持し、古い動画詳細JSONでもプロフィールリンクを復元しつつ、画像欠損時は共通デフォルトアイコンへ切り替える。

`top.json` は新着最大100件と、生成時点で公開から3年以上経過した作品を `scheduled_time` 昇順で最大200件プールする。懐かし棚は YouTube API 同期済みで `public` / `unlisted` と確認された作品だけを `nostalgic_pool` に入れ、生成時と Recovery Cron の UTC 日次処理で Fisher-Yates シャッフル後 `nostalgic` 最大20件を R2 へ書き込む（KV `static:top_nostalgic_shuffle_day` で同日の重複更新を抑止）。トップ表示時は `nostalgic` をそのまま使い、リクエストごとの再シャッフルはしない。新着 loop 棚はシャッフル元プール100件のうち最大40件だけをDOMへ載せ、注目・ピックアップ・新着・懐かしの4棚は1行の連続ループとし、流れる向きを左・右・左・右で交互にする。トップの hero 用 `slot_stats` は対象イベント最大3件に限定する。`rebuildTop` は `top.json` と補助 artifact `top/slot-stats.v1.json`（`top_slot_stats:global`）を同時更新する。枠の reserve/release 等では `top.json` 全体ではなく artifact だけを更新する。公開 loader は `generated_at` が新しい方の `slot_stats` を採用する（欠損・破損時は `top.json.slot_stats` へ fallback）。YouTube 公開可否の変化時は `top` も `youtube_related_blocklist` / `random_video_pool` と同時に再生成予約する。

関連動画の非公開除外は `youtube/related-blocklist.v1.json`、補完候補は `videos/random-pool.v1.json` を用いる。どちらも読み込みは fresh Cache → R2 → stale Cache（最大24h）→ unavailable とし、状態を捨てない。必要な共有JSONがunavailableのときは関連動画セクションを障害表示へ分離し、空blocklist・正常な0件へ倒さない。

`/admin/static-builds` は両objectについて、R2 `head` による実体の有無、公開ローダーの `fresh` / `stale` / `unavailable`、`generated_at`、blocklist件数またはrandom pool件数を表示する。binding欠損・`head`失敗は「確認不可」とし、管理者write guardを通る個別再生成キューに加え、両方まとめて投入する操作を提供する。R2 object が欠けている場合は `content-jobs` Recovery Cron が high 優先度で両 target を自動 enqueue する。YouTube 関連の `youtube_related_blocklist` / `random_video_pool` に加え、`users/index.json` / `users/public-x-icon-map.v1.json` / `users/pickup-creators.v1.json` のいずれかが欠けているときは `users_index:global` を high で enqueue する（`rebuildUsersIndex` が3つを再生成する）。`top/slot-stats.v1.json` が欠けているときは `top_slot_stats:global` を high で enqueue する（`rebuildTopSlotStats` が artifact を再生成する）。

管理画面の users / top 診断セクションでは、`users/pickup-creators.v1.json` と `top/slot-stats.v1.json` についても同様に R2 `head`、公開ローダーの `fresh` / `stale` / `unavailable`、`generated_at`、件数（`creators.length` / `items.length`）を表示する。pickup artifact の再生成は `users_index:global`、slot-stats artifact は `top_slot_stats:global` を個別キュー投入する。

主な公開 artifact:

| 用途 | R2 key | target_type |
| --- | --- | --- |
| トップ | `top.json` | `top` |
| トップ hero slot_stats | `top/slot-stats.v1.json` | `top_slot_stats` |
| 作品一覧（新着） | `list/recent.json` | `list_recent` |
| 作品一覧（人気） | `list/popular.json` | `list_popular` |
| 検索索引 | `search-index-lite.json` | `search_index` |
| イベント一覧 | `events/index.json` | `events_index` |
| イベント詳細 | `events/{id}.json` | `event` |
| クリエイター一覧 | `users/index.json` | `users_index` |
| Creator 棚（top/recommend） | `users/pickup-creators.v1.json` | `users_index` |
| クリエイター詳細 | `users/{id}.json` + `users/{id}/works\|collabs/p{n}.json` | `user` |
| おすすめ | `recommend.json` | `recommend` |
| 利用規約 | `rules/current.json` | `rules` |
| 公開非表示マニフェスト | `visibility/blocked-entities.v1.json` | 初回非公開化まで欠落可（deep health / artifact SLO は bootstrap-ok）。存在時は shape・鮮度を検査 |
| サイトマップ | 上記索引から動的生成 | — |

`list/recent.json` と `list/popular.json` は COUNTABLE 公開作品を最大 5000 件（`STATIC_LIST_MAX_ITEMS`）まで `items` に載せる。`total` は DB の全件数と `items.length` の小さい方とし、ページングが `items` を超えない。`search-index-lite.json` の `videos` も同上限。put 前に `STATIC_LIST_MAX_OBJECT_BYTES`（8MiB）でサイズガードする。users 側の 500 件上限は現状維持。

`/list?event=` は専用 R2 key を持たず、degraded D1 の bounded 一覧（`fetchDegradedEventListPage`、LIMIT 24 + ページング）で補う。

## スコア再計算とランキング再生成

`sync-jobs` の score-recalc は毎時最大 150 件を 1 SQL で更新する。metadata / video の dirty は即時優先し、それ以外は **72 時間**（`SCORE_FORCE_REFRESH_SEC`）以上 `score_updated_at` が古い公開作品を age-only で強制 refresh する。

score 更新が 1 件以上あった invocation だけ、`ranking-rebuild-enqueue` が `top` / `list_popular` / `recommend` の global target を `score_recalc` / normal で enqueue する。KV `ranking:last-score-rebuild` で throttle する。

| 開催中イベント | throttle 間隔 |
| --- | ---: |
| あり（`events/index.json` または D1 fallback） | 1 時間（3600 秒） |
| なし | 3 時間（10800 秒） |

`events/index.json` も D1 も読めないときは safe default（開催中あり扱い）とし throttle をかけない。enqueue 成功時に KV マーカーを更新し、static rebuild wake を送る。`users_index` が in-flight のときは `list_popular` のみ enqueue し、KV マーカーは更新しない（フル target の throttle を維持する）。
