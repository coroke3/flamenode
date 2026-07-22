# Static Delivery

> Status: Active
> Last verified: 2026-07-22
> Verified against commit: `src/lib/publicData/`, `workers/json-generator/`, `static_artifacts`

D1が正本で、R2 JSONは公開配信キャッシュです。`public`だけを一覧・検索・R2・公開APIへ出し、`limited`は直接詳細だけ、その他は権限者以外へ出さない。artifactのkey、hash、version、source更新時刻を追跡し、非公開化やYouTube ID変更時は旧keyを削除する。

`static_json_with_live_overlay`では、R2の一覧JSONが空でもD1へ公開作品が追加済みの可能性があるため、空のcollectionをsemantic missとして扱いD1正本へfallbackする。`static_json_only`と`maintenance`では、空の静的JSONをそのまま利用する。
