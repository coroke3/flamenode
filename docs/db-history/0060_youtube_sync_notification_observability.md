# 0060_youtube_sync_notification_observability.sql

> Status: Active
> Migration: 0060_youtube_sync_notification_observability.sql
> Date: 2026-08-24
> Type: structural/additive
> Data loss: none
> Rollback: 検証済みバックアップから復元。新規列・テーブル・indexは手動削除
> Change log: docs/database/change-log.d/0060_youtube_sync_notification_observability.md
> Source of truth: `migrations/0060_youtube_sync_notification_observability.sql`, `src/lib/db/schema.ts`

## 目的

YouTube playlist 同期を run_id で追跡し、設定行の lease と履歴を保存する。運営障害の状態を通知重複なしで管理できるようにし、既存 notification_outbox を dm/channel の両ルートへ段階的に対応させる。

## 変更内容

- `event_youtube_playlist_sync` に試行時刻、run_id、所要時間、pending trigger、実行 lease を追加。
- `event_youtube_playlist_sync_runs` と `ops_incident_state` を追加。
- `notification_outbox` を recipient nullable / `delivery_route` / `correlation_id` 対応へ再構築。
- 既存行の全フィールド、status、attempt、lease、retry、event、dedupe、created_at をコピーし、既存 webhook 行のみ channel に backfill。

## データ損失

なし。既存 notification_outbox の行と配送状態は削除せず同一IDでコピーする。

## データ保全

既存行は同一IDで一度だけコピーする。migration適用前にD1バックアップと件数・dedupe・FK検査を行う。channel行は recipient_user_id NULL を許可するが、dm行は引き続き recipient を必須とする。

## ロールバック

本番で dispatcher の route-aware 読み取りを確認してから段階的に戻す。障害時はmigration適用前バックアップから復元し、Queueを止めた状態で `foreign_key_check`、件数、active dedupeを再検査する。runtime DDLによる復元は行わない。

## 検証

- `npm run check:db-schema`
- `npm run check:db-migration`
- notification dispatcher の channel/DM/orphan 回帰テスト
- playlist lease/run history の競合テスト
