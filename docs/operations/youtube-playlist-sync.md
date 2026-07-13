# YouTube再生リスト同期 運用手順

## 構成

- Workerは既存の `flamenode-sync-jobs` を使用し、Worker数を増やしません。
- Cronは1時間ごとに起動します。
- 動画メタデータ同期とスコア再計算はD1 leaseで12時間間隔を維持します。
- 再生リスト同期はイベント設定の `next_sync_at` と同期間隔で実行します。
- OAuth credentialはD1/KVへ保存せず、Worker secretだけに保持します。

## Google Cloud / YouTube側

1. YouTube Data API v3を有効化します。
2. OAuth同意画面とOAuthクライアントを作成します。
3. 再生リストを所有するYouTubeチャンネルで認可し、`https://www.googleapis.com/auth/youtube` scopeのrefresh tokenを取得します。
4. イベントごとの再生リストはYouTube側で作成します。

YouTubeのサービスアカウントではなく、再生リストを所有するチャンネルのOAuth認可を使用します。

## Worker secret

`workers/sync-jobs` で次を登録します。

```bash
npx wrangler secret put YOUTUBE_API_KEY
npx wrangler secret put YOUTUBE_OAUTH_CLIENT_ID
npx wrangler secret put YOUTUBE_OAUTH_CLIENT_SECRET
npx wrangler secret put YOUTUBE_OAUTH_REFRESH_TOKEN
```

任意で1日あたりの再生リスト同期用クォータ上限を設定できます。既定は4500、設定可能な上限は8000です。

```toml
[vars]
YOUTUBE_PLAYLIST_DAILY_QUOTA_UNITS = "4500"
```

## FlameNode側

1. `0004_event_youtube_playlist_sync.sql` を対象D1へ適用します。
2. Workerをデプロイします。
3. `/manage/events/{eventId}/youtube-playlist` を開きます。
4. 再生リストURLまたはID、同期方式、同期間隔を保存します。

## 同期方式

- `追加のみ`: イベントの公開・限定公開作品を追加します。YouTube側だけにある項目は削除しません。
- `完全同期`: 追加に加え、イベントに存在しない再生リスト項目を定期全件確認後に削除します。
- 並び順の更新は行いません。YouTube側の手動並び替えを維持します。

## 無料枠向け上限

- 1回に処理するイベント: 最大2件
- 1イベントの全件確認: 最大3ページ（150項目）ずつ継続
- 1回の追加・削除: 合計最大8件
- 1日の再生リスト同期クォータ: 既定4500 units
- 全件確認: 24時間に1回。それ以外はD1の項目索引とイベント作品を比較

上限に達した処理は `deferred` として次回以降へ繰り越します。

## 障害時

- `failed`: OAuth、権限、存在しない再生リスト、APIエラーを確認します。
- `deferred`: 日次クォータまたは1回の処理上限です。通常は自動再開します。
- `scanning`: 大きな再生リストをページ分割で確認中です。
- 再生リストを変更した場合は設定を保存し直すと項目索引を破棄し、全件確認から再開します。
