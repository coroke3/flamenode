# 0041_event_youtube_playlist_sync.sql

> Status: Active
> Last verified: 2026-07-13
> Verified against commit: `28bd38d74a991ac9a06070a330e038c5d03ffa03`
> Source of truth: `migrations/0041_event_youtube_playlist_sync.sql`, `src/lib/db/schema.ts`

## 目的

イベント単位でYouTube再生リスト同期を有効化し、Cloudflare WorkersとYouTube Data APIの無料枠を超えない範囲で差分同期できるようにします。

## 変更内容

- `event_youtube_playlist_sync` を追加します。
  - イベントごとの再生リストID、同期方式、同期間隔、次回実行時刻を保持します。
  - 分割走査のページトークン、最終全件確認、最終同期、失敗理由を保持します。
  - 同一再生リストを複数イベントが同時管理しないよう部分unique indexを追加します。
- `event_youtube_playlist_items` を追加します。
  - YouTubeのplaylist item IDとvideo IDをイベント単位で保持します。
  - 全件JSONをイベント行へ保存せず、差分追加・削除と分割走査を可能にします。
- 両テーブルはイベント削除時にcascade削除します。

## データ損失

なし。既存テーブル・列・行は変更しません。migration適用直後は全イベントで同期無効です。

## ロールバック

1. 管理画面で全イベントの同期方式を「同期しない」にします。
2. `flamenode-sync-jobs` から再生リスト同期処理を外します。
3. `DROP TABLE event_youtube_playlist_items;` を実行します。
4. `DROP TABLE event_youtube_playlist_sync;` を実行します。

YouTube側へ既に追加された動画は自動で削除しません。必要な場合はYouTube Studioから手動で整理します。

## 検証

- `npm run check:db-schema`
- `npm run check:db-history`
- `npm run check:project-docs`
- `npm run typecheck`
- `npm run test:unit`
- 設定保存、実行予約、追加のみ、完全同期、OAuth未設定、クォータ繰越、公開予定時刻順挿入の確認
