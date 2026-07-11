# Static Delivery

> Status: Active
> Last verified: 2026-07-11
> Verified against commit: `src/lib/publicData/`, `workers/json-generator/`, `static_artifacts`

D1が正本で、R2 JSONは公開配信キャッシュです。`public`だけを一覧・検索・R2・公開APIへ出し、`limited`は直接詳細だけ、その他は権限者以外へ出さない。artifactのkey、hash、version、source更新時刻を追跡し、非公開化やYouTube ID変更時は旧keyを削除する。
