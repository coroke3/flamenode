# 0040_free_tier_background_jobs.sql

> Status: Active
> Date: 2026-07-13

## 目的

Cloudflare Workers無料枠の1実行上限内で、通知・YouTube同期・スコア更新を停止させずに運用する。全件カーソル巡回を期限駆動と差分更新へ置き換え、外部APIとD1クエリを固定上限にする。

## 変更内容

- `user.discord_dm_channel_id`を追加し、Discord DMチャンネル作成APIの毎回呼び出しを避ける。
- `videos.trending_view_count_24h`と`videos.score_dirty_at`を追加する。
- `video_youtube_metadata.next_sync_at`と`consecutive_failures`を追加する。
- YouTube同期期限、dirtyスコア、通知dispatch向けindexを追加する。
- YouTube統計またはスコア入力値の変更時に`score_dirty_at`を設定するtriggerを追加する。

## データ損失

なし。既存の公開作品は初回差分再計算対象、既存YouTubeメタデータは初回期限到来済みとしてbackfillする。

## ロールバック

追加したindexとtriggerを削除する。SQLite/D1で追加列を除去する必要がある場合は、migration適用前backupから手動復元する。

## 検証

- active migrationを空SQLiteへ順番に適用する。
- `check:db-schema`と`check:db-history`を実行する。
- Worker unit tests、typecheck、Cloudflare設定検査を実行する。
- YouTube同期が1 API呼び出し、スコア更新が集合SQL、通知が固定件数で完了することを確認する。
