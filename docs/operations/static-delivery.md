# Static Delivery

## Visibility fence lifecycle

When an event, video, event group, or listable X user changes from public to a
non-public status, the D1 mutation is paired with an R2 blocked-visibility
manifest entry before the transaction. Re-publication keeps that block in
`release_pending` until the static artifact rebuild has completed. The
generator then removes only the matching token with an ETag/CAS check. This
keeps D1 authoritative and avoids serving stale public JSON during either
transition.
The video detail projection also filters event references against the same
manifest, so an event that is being withdrawn is not shown from a stale video
artifact while its event projections are rebuilding.
The `video_visibility_update` queue reason is retained when active queue rows
are merged, so a competing enqueue cannot prevent the release worker from
clearing the matching promotion fence.
Event ID rename also writes an old-ID tombstone before the D1 key migration
and queues an explicit composed-artifact cleanup. The tombstone is retained
for a 24-hour safety window, matching the maximum bounded stale fallback.
After that window, an ID can be reused only when
the rename-cleanup queue targets are all done, tracked artifacts are deleted,
canonical R2 objects are absent, and the manifest entry is removed by a
token-checked mutation together with the new event/rename. This prevents a
stale object from becoming public while allowing an old ID to be recovered
after deletion has actually completed.
The read-only `check:public-visibility-fences --remote` check covers video,
event, event-group, and X-user fences. A matching `release_pending` row with
its manifest entry is an expected promotion window; a missing entry, token
mismatch, or released row that still appears in the manifest is reported for
follow-up. Use `npm run check:public-visibility-fences -- --remote --strict`
before an enforce rollout; strict mode returns a non-zero exit for a missing
or malformed manifest and for any reported consistency issue, while the
default remote check remains informational.

R2 manifest writes use conditional PUTs. A first producer uses
`If-None-Match: *`; if another producer wins that create race, the latest
manifest is re-read, the mutation is reapplied, and the write is retried with
the latest ETag. Manifest read/write size guards use UTF-8 bytes (not
JavaScript string length), and a failed conditional PUT is never treated as
success.
Users-index-v2 manifest reads intentionally bypass Cache API: saving one R2 GET
does not justify weakening the commit-point freshness and visibility checks.
Worker Logs are the source of truth for production CPU/R2 cost; local tests do
not establish p95/p99 CPU.
Deep health skips the manifest probe in `off`, reports missing/unavailable or
malformed state as a non-blocking degraded check in `observe`, and makes it a
blocking degraded result in `enforce`. The tracked default remains `observe`;
switching to `enforce` is a separate configuration deployment after the
strict remote check and bootstrap verification.
In `enforce`, a missing `BUCKET` binding is a binding-unavailable failure, not
an empty manifest; an existing bucket with no manifest object remains the
bootstrap/empty-manifest case described below.
Member suggestions rebuilds restore the previous manifest when tracking the
new manifest fails, so a failed tracking write cannot expose a missing index.

Before switching to `enforce`, bootstrap a missing manifest once with
`npm run cf:bootstrap-visibility -- --confirm-bootstrap --bucket <bucket>`.
The command refuses to overwrite an existing or malformed manifest; it only
creates the canonical empty schema when the object is absent.

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

R2の読み込みPromiseはrequestをまたぐmodule-global状態へ保存しない。各呼び出しは、そのrequestのCloudflare bindingだけで完結させる。重複読み込みの抑制とstale復旧はCache APIで行い、metadataと本文が同一Server Component request内で同じ詳細JSONを要求する場合はReactのrequest-local cacheで重複取得を抑える。top.jsonが正規化できないmissではslot-statsを追加取得せず、slot統計の障害をtop本体のmiss処理へ混ぜない。

`static_json_with_live_overlay` では、R2の一覧JSONが空でもD1へ公開作品が追加済みの可能性があるため、空のcollectionをsemantic missとして扱い degraded D1 へ進める。`static_json_only` と `maintenance` では、空の静的JSONをそのまま利用するか、D1 fallback しない。

Detail/event/user/rules loaders opt into `cacheMode: "r2_first"` when a
freshness-sensitive projection is required. They read R2 before Cache API and
may use only a bounded-age Cache envelope when R2 is unavailable; raw legacy
Cache payloads without `stored_at` are not accepted as stale fallback. The
existing visibility fence guard still runs first, and an enforce-mode manifest
read failure is reported as `unavailable`. `cacheMode: "bypass"` remains
available for strict callers and skips both Cache API reads and writes. All
public artifact reads also pass through a pure target-type visibility filter
before normalization, so explicit private rows in stale artifacts cannot be
rendered. X-user rows use the canonical public-listable approval set
(`approved`, `pending`, and `imported`); unknown or rejected markers are
filtered. Large approved-X authorization predicates use one JSON1 bind while
preserving the old NULL semantics.

If an R2 miss reaches the degraded path while the Cloudflare D1 binding is
unavailable, the loader records the binding failure and returns the bounded
`unavailable` result instead of allowing a public document/API request to
surface a 500. The next static rebuild or health check can recover the missing
artifact once the binding is available again.

Public video artifacts contain public chapters only. An authenticated video
viewer may receive a separate private-chapter overlay after the normal
ownership and approved-X checks; overlay failure is fail-closed for private
rows and does not replace usable public static detail.

### Kill switch / static-only / circuit breaker

- `PUBLIC_DEGRADED_D1_ENABLED`（`wrangler.toml` / `.dev.vars`）: 明示 `0` / `false` / `no` / `off` で R2 ミス後の degraded D1 を無効化する。未設定時は有効。
- `FORCE_STATIC_ONLY` または運用モードが `static_json_only` のときは degraded D1 に進まず、Unavailable または静的 JSON のみ。
- R2 miss が 1 分あたり 20 件以上（`degradedCircuitBreakerCore.ts`）のとき、KV サーキットが open になり degraded D1 を一時停止する。Cache API の stale エントリは引き続き返す。R2 ヒットが 3 回連続すると自動解除する。これは静的配信の fail-closed 安全装置であり、Cloudflare 使用量に基づく CostGuard の自動 `operation_mode` 変更ではない。

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

ミス時のみ `operation_mode` を解決（`FORCE_STATIC_ONLY` > isolate 短時間キャッシュ > KV 複製 > D1）。解決不能時は `normal` を維持し、`static_only` へ自動遷移しない。KV/D1 の一時的な binding 障害で公開の live overlay や degraded fallback まで機能制限されないようにするためである。`static_only` / `maintenance` への変更は CostGuard の明示操作だけが行い、書き込み側は従来どおり D1 正本の write guard で停止する。cost-guard で mode 変更時は D1 成功後に KV 複製を更新し、KV 失敗は成功扱いにしない。Edge middleware の maintenance redirect は別の5秒isolate cacheとKVの30秒 `cacheTtl` を使い、KV障害時は短時間だけ fail-open して500化を防ぐ。これは認可境界ではなく運用停止リダイレクトのためのbounded-staleである。

## 観測と UI

公開 layout の `CostGuardBanner` は `source` 省略（= public）で、D1 の `system_settings` を読まず env / isolate / KV のみ参照する。公開側のKVミラーはisolate内で30秒だけ共有し、modeとreason取得の重複readを抑える。admin layout は `source="admin"` で D1 正本を読む。

R2 hit時の degraded circuit は、通常の公開リクエストごとにKVを読むのではなく、isolate内の30秒probeを使う。openを確認したisolateだけが3 hit到達時にKVを再確認してcloseする。R2 miss時のopen判定とmiss counter更新は従来どおり行い、KV障害は公開配信を停止させない。

公開主要ページは `PublicMetricsShell` 内で `runWithPublicRequestMetrics` を使い、構造化ログ（`public_request_metrics`）を出す。D1 への永続化はしない。`degraded_d1` 時は同じ ALS スコープ内の `PublicDegradedBanner`（`role="status"`）が簡易表示を知らせる。

## 静的再生成と Projection

静的再生成は Queue Consumer / Recovery Cron の各 invocation で **1 target** だけ処理する（`workers/json-generator/queuePolicy.ts` の `MAX_QUEUE_ITEMS_PER_RUN` = 1）。Recovery Cron は毎時最大 `CONTENT_JOBS_RECOVERY_MAX_TARGETS`（3）件まで排水する。D1 statement は `workers/shared/d1Budget.ts` の soft limit（40）で停止する。表示用ポリシー正本は `src/lib/operationMode/policy.ts` の `STATIC_REBUILD_ITEMS_PER_RUN` と一致させる。

コード deploy（`BUILD_COMMIT_SHA` 変化）時は、Recovery Cron が `list_recent`、`list_popular`、`search_index`、`users_index`、`top_recommended`、`top_latest`、`top_nostalgic`、`top_events`、`top_announcements`、`top_stats`、`top_slot_stats`、`recommend_core`、`events_index`、`youtube_related_blocklist`、`random_video_pool` の global target を `deploy_generator_change` / high で enqueue する。各 top section producer 成功後は follow-up で `top` composer が enqueue される。`recommend_core` 成功後も follow-up で `recommend` composer が enqueue される。KV `static:last_generator_commit` で同一 commit の重複 enqueue を抑止する。

Admin Spreadsheetのうち `videos`、`video_youtube_metadata`、`video_events`、`video_members`、`video_chapters`、`x_users` の変更は、対象の動画詳細・関連動画共有JSON・クリエイター投影をplannerで導出し、data mutation・preview nonce消費・監査・`static_rebuild_queue`を同じD1 atomic batchへ入れる。1回のapplyは11行までとし、plannerは最大16 target（`SPREADSHEET_STATIC_REBUILD_TARGET_LIMIT`）、queue helperは最大4 statementに収める。いずれかを超える場合はデータを書かず、行を分割して再実行する。

Spreadsheet planner（`src/lib/admin/spreadsheet/staticRebuildPlan.ts`）は mutation の before/after だけから target を導出し、同一 apply 内では `Map` で `targetType:targetId` を dedupe する。`videos` の CREATE または `visibility_status` 変更では、動画詳細 `video` に加え `random_video_pool:global`、`youtube_related_blocklist:global`、`list_recent:global`、`list_popular:global`、`search_index:global` へ fan-out する（public 作品 CREATE の例: 上記6 target）。タイトルや intro だけの UPDATE は `video` だけ。1 apply で public 作品を3行 CREATE すると 18 target となり 16 上限を超えるため、行の分割が必要になる。

Creator Projection（`workers/json-generator`）は公開用カード・詳細 JSON を R2 に書き、一覧は `list/recent.json` / `list/popular.json`、検索は `search-index-lite.json`、クリエイター索引は `users/index.json` を正本とする。`users_index` 再生成時に `users/public-x-icon-map.v1.json`（entries形式）と `users/pickup-creators.v1.json`（top/recommend の Creator 棚用、最大60件）も同時出力する。`users_index` の v2 page/search の `static_artifacts` 追跡は、D1 の100 bind制限を超えないよう12行（84 bind）単位のmulti-row UPSERTにまとめる。`top` / `recommend` の Creator 棚は通常時この pickup artifact を読み、欠損・破損時のみ D1 projection へ fallback する。登録ユーザーは icon 欠損時も `source: none` とし、historical icon は表示用に保持する。公開ページのXアイコン補完は fresh/stale Cacheを含む共有icon map → R2 `users/index.json` → 詳細JSON埋め込み値の順で解決し、entry 欠損や `source: video` のときだけ index で `registered` / `none` へ昇格を試みる。この補完経路からD1へは降りない。`users/index.json` 補完ではアイコンなしの公開プロフィールも `source: none` として保持し、古い動画詳細JSONでもプロフィールリンクを復元しつつ、画像欠損時は共通デフォルトアイコンへ切り替える。
`member_suggestions` は履歴クエリに主キーのタイブレークを付けて同時刻行の順序を固定する。R2 の index/manifest を公開する前に各オブジェクトを `static_artifacts` へ追跡し、追跡失敗時は今回生成した未公開キーだけを削除して旧世代を壊さない。loader は manifest の `total` と index 件数が一致しない世代を無効として扱う。
内部候補検索はこのR2 indexだけを読み、bucket単位の短命isolate cache（30秒）を使う。検索前の包含一致／fuzzy長さ窓フィルタでrank計算をboundedにし、APIの既存DTO（`id` / `x_name`）は変更しない。cacheは別bucketへ跨がず、manifest/indexの件数検証後だけ投入する。
公開 `/user?q=` と `/list?q=` は generation 固有の `postings-v1` R2 索引を優先する。query の 1/2/3 文字 gram から最小 posting を選び、directory が指す bounded page だけを読むため、検索 corpus 全体の JSON parse/filter/sort は request time に行わない。1文字などの高頻度 gram が明示したページ上限を超える場合はページを途中で切らず、旧 `search-lite.v1.json` / `search-index-lite.json` または degraded 経路へ安全に fallback する。旧 artifact は索引欠損・世代不一致時の互換 fallback として残し、欠損 posting を部分結果として返さない。users v2 の同一 generation で tracking rows と対象 R2 object の存在確認が揃っている通常 rebuild は immutable objects の PUT を省略し、repair/miss/visibility/deploy 系 reason では強制再生成する。対象 object 数が大きく R2 の全件確認を安全な subrequest 範囲で完了できない場合も skip せず、通常 rebuild で自己修復する。

posting manifest は空の bucket directory を生成せず、非空 bucket の一覧を持つ。これにより小規模 generation の R2 object 数と同世代検証の subrequest を抑えつつ、未知・欠損 shard は従来どおり全体検索へ部分結果を返さず fallback する。
users v2 の stale artifact cleanup は R2 bulk delete と JSON1 UPDATE を 1 invocation 500行以内に制限し、`hasMore` を既存 static rebuild wake に返して排水を継続する。`deleted_at` の physical purge は24時間の安全期間後、live manifest/object key を除外して bounded に実施する。current manifest generation は cleanup/purge の対象外である。

`top.json` は section producer が R2 に書いた `top/sections/*.v1.json` と `top/slot-stats.v1.json`、`users/pickup-creators.v1.json` を composer（`top:global`）が読み込んで合成する。新着最大100件と、公開から3年以上経過した作品を最大200件プールする懐かし棚は `top_nostalgic` producer が担当する。懐かし棚は YouTube API 同期済みで `public` / `unlisted` と確認された作品だけを `nostalgic_pool` に入れ、JST 日次境界で ID 抽選し `nostalgic` 最大20件を保持する（KV `static:top_nostalgic_shuffle_day` は新日付の抽選成功時のみ更新）。同日中は selected IDs を維持し title/icon/youtube/visibility を再評価する。トップ表示時は `nostalgic` をそのまま使い、リクエストごとの再シャッフルはしない。hero 用 `slot_stats` は `top_slot_stats` producer が `top/slot-stats.v1.json` に書き、composer が `top.json` へ合成する。枠の reserve/release 等では `top_slot_stats` のみを更新し follow-up で `top` composer を enqueue する。公開 loader は `generated_at` が新しい方の `slot_stats` を採用する（欠損・破損時は `top.json.slot_stats` へ fallback）。YouTube 公開可否の変化時は必要な top section と `youtube_related_blocklist` / `random_video_pool` を同時に再生成予約する。

`events/{id}.json` は `event_base` / `event_slots` producer が R2 に書いた `events/{id}/base.v1.json` と `events/{id}/slots.v1.json` を composer（`event:{id}`）が読み込んで合成する。composer は required section 欠損時に throw し旧 JSON を保持する。枠変更では `event_slots` と `top_slot_stats` のみを更新し、イベント metadata 変更では `event_base`（必要なら `top_events`）を更新する。公開 loader は `events/{id}/slots.v1.json` が `events/{id}.json` より新しいとき slots / slots_summary を overlay する。

関連動画の非公開除外は `youtube/related-blocklist.v1.json`、補完候補は `videos/random-pool.v1.json` を用いる。どちらも読み込みは fresh Cache → R2 → stale Cache（最大24h）→ unavailable とし、状態を捨てない。必要な共有JSONがunavailableのときは関連動画セクションを障害表示へ分離し、空blocklist・正常な0件へ倒さない。

`/admin/static-builds` は両objectについて、R2 `head` による実体の有無、公開ローダーの `fresh` / `stale` / `unavailable`、`generated_at`、blocklist件数またはrandom pool件数を表示する。binding欠損・`head`失敗は「確認不可」とし、管理者write guardを通る個別再生成キューに加え、両方まとめて投入する操作を提供する。R2 object が欠けている場合は `content-jobs` Recovery Cron が high 優先度で両 target を自動 enqueue する。YouTube 関連の `youtube_related_blocklist` / `random_video_pool` に加え、`users/index.json` / `users/public-x-icon-map.v1.json` / `users/pickup-creators.v1.json` のいずれかが欠けているときは `users_index:global` を high で enqueue する（`rebuildUsersIndex` が3つを再生成する）。`top/slot-stats.v1.json` が欠けているときは `top_slot_stats:global` を high で enqueue する（`rebuildTopSlotStats` が artifact を再生成する）。

管理画面の users / top 診断セクションでは、`users/pickup-creators.v1.json` と `top/slot-stats.v1.json` についても同様に R2 `head`、公開ローダーの `fresh` / `stale` / `unavailable`、`generated_at`、件数（`creators.length` / `items.length`）を表示する。pickup artifact の再生成は `users_index:global`、slot-stats artifact は `top_slot_stats:global` を個別キュー投入する。

主な公開 artifact:

| 用途 | R2 key | target_type |
| --- | --- | --- |
| トップ（composer） | `top.json` | `top` |
| トップ注目棚 | `top/sections/recommended.v1.json` | `top_recommended` |
| トップ新着棚 | `top/sections/latest.v1.json` | `top_latest` |
| トップ懐かし棚 | `top/sections/nostalgic.v1.json` | `top_nostalgic` |
| トップイベント棚 | `top/sections/events.v1.json` | `top_events` |
| トップお知らせ棚 | `top/sections/announcements.v1.json` | `top_announcements` |
| トップ統計 | `top/sections/stats.v1.json` | `top_stats` |
| トップ hero slot_stats | `top/slot-stats.v1.json` | `top_slot_stats` |
| 作品一覧（新着） | `list/recent.json` | `list_recent` |
| 作品一覧（人気） | `list/popular.json` | `list_popular` |
| 検索索引 | `search-index-lite.json` | `search_index` |
| イベント一覧 | `events/index.json` | `events_index` |
| イベント詳細 base | `events/{id}/base.v1.json` | `event_base` |
| イベント詳細 slots | `events/{id}/slots.v1.json` | `event_slots` |
| イベント詳細（composer） | `events/{id}.json` | `event` |
| クリエイター一覧 | `users/index.json` | `users_index` |
| Creator 棚（top/recommend） | `users/pickup-creators.v1.json` | `users_index` |
| クリエイター詳細 | `users/{id}.json` + `users/{id}/works\|collabs/p{n}.json` | `user` |
| おすすめコア | `recommend/core.v1.json` | `recommend_core` |
| おすすめ | `recommend.json` | `recommend` |
| 利用規約 | `rules/current.json` | `rules` |
| 公開非表示マニフェスト | `visibility/blocked-entities.v1.json` | 初回非公開化まで欠落可（deep health / artifact SLO は bootstrap-ok）。存在時は shape・鮮度を検査 |
| サイトマップ | 上記索引から動的生成 | — |

`list/recent.json` と `list/popular.json` は COUNTABLE 公開作品を最大 5000 件（`STATIC_LIST_MAX_ITEMS`）まで `items` に載せる。`total` は DB の全件数と `items.length` の小さい方とし、ページングが `items` を超えない。`search-index-lite.json` の `videos` も同上限。put 前に `STATIC_LIST_MAX_OBJECT_BYTES`（8MiB）でサイズガードする。users 側の 500 件上限は現状維持。

`/list?event=` は専用 R2 key を持たず、degraded D1 の bounded 一覧（`fetchDegradedEventListPage`、LIMIT 24 + ページング）で補う。

## スコア再計算とランキング再生成

`sync-jobs` の score-recalc は毎時最大 150 件を 1 SQL で更新する。metadata / video の dirty は即時優先し、それ以外は **72 時間**（`SCORE_FORCE_REFRESH_SEC`）以上 `score_updated_at` が古い公開作品を age-only で強制 refresh する。

score 更新が 1 件以上あった invocation だけ、`ranking-rebuild-enqueue` が `top` / `list_popular` / `recommend_core` の global target を `score_recalc` / normal で enqueue する。KV `ranking:last-score-rebuild` で throttle する。

| 開催中イベント | throttle 間隔 |
| --- | ---: |
| あり（`events/index.json` または D1 fallback） | 1 時間（3600 秒） |
| なし | 3 時間（10800 秒） |

`events/index.json` も D1 も読めないときは safe default（開催中あり扱い）とし throttle をかけない。enqueue 成功時に KV マーカーを更新し、static rebuild wake を送る。`users_index` が in-flight のときは `list_popular` のみ enqueue し、KV マーカーは更新しない（フル target の throttle を維持する）。
