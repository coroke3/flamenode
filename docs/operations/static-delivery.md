# Static Delivery

> Status: Active
> Last verified: 2026-07-22
> Verified against commit: `src/lib/publicData/`, `workers/json-generator/`, `static_artifacts`

D1が正本で、R2 JSONは公開配信キャッシュです。`public`だけを一覧・検索・R2・公開APIへ出し、`limited`は直接詳細だけ、その他は権限者以外へ出さない。artifactのkey、hash、version、source更新時刻を追跡し、非公開化やYouTube ID変更時は旧keyを削除する。

`static_json_with_live_overlay`では、R2の一覧JSONが空でもD1へ公開作品が追加済みの可能性があるため、空のcollectionをsemantic missとして扱いD1正本へfallbackする。`static_json_only`と`maintenance`では、空の静的JSONをそのまま利用する。

公開ローダー (`src/lib/publicData/loader.ts`) は static-first で動く。

1. R2 から JSON を試す（ヒット時は D1 / enqueue を呼ばない）
2. ミス時のみ `operation_mode` を解決（`FORCE_STATIC_ONLY` > isolate 短時間キャッシュ > KV 複製 > D1）
3. 解決不能時は `static_only` へ倒し、`normal` へは倒さない
4. cost-guard で mode 変更時は D1 成功後に KV 複製を更新し、KV 失敗は成功扱いにしない

静的再生成は `content-jobs` が **1 target / 15分** で処理する。表示用ポリシー正本は `src/lib/operationMode/policy.ts` の `STATIC_REBUILD_ITEMS_PER_RUN`（= `workers/json-generator/queuePolicy.ts` の `MAX_QUEUE_ITEMS_PER_RUN`）と一致させる。

主な公開 artifact:

| 用途 | R2 key | target_type |
| --- | --- | --- |
| トップ | `top.json` | `top` |
| 作品一覧（新着） | `list/recent.json` | `list_recent` |
| 作品一覧（人気） | `list/popular.json` | `list_popular` |
| 検索索引 | `search-index-lite.json` | `search_index` |
| イベント一覧 | `events/index.json` | `events_index` |
| クリエイター一覧 | `users/index.json` | `users_index` |
| 利用規約 | `rules/current.json` | `rules` |
| サイトマップ | 上記索引から動的生成 | — |
