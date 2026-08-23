# YouTube再生リスト同期 運用手順

## 構成

- Workerは既存の `flamenode-sync-jobs` を使用し、Worker数を増やしません。
- Cronは毎時7分・52分に起動し、52分台だけを再生リスト同期の専用枠にします。
- 7分台は動画メタデータ同期・スコア差分再計算を維持します。
- 再生リスト同期はイベント設定の `next_sync_at` と同期間隔で実行します。
- `event_youtube_playlist_sync.enabled = 1` かつ `sync_mode != 'off'` のイベントだけを同期します。未設定イベントを自動で同期しません。
- OAuth credentialはD1/KVへ保存せず、Worker secretだけに保持します。

## Google Cloud / YouTube側

1. YouTube Data API v3を有効化します。
2. OAuth同意画面とOAuthクライアントを作成します。
3. 再生リストを所有するYouTubeチャンネルで認可し、`https://www.googleapis.com/auth/youtube` scopeのrefresh tokenを取得します。
4. イベントごとの再生リストはYouTube側で作成します。
5. 公開予定時刻順の挿入を有効にするには、再生リストの並び順をYouTube側で「手動」にします。

YouTubeのサービスアカウントではなく、再生リストを所有するチャンネルのOAuth認可を使用します。

## Worker secret

`workers/sync-jobs` で次を登録します。

```bash
npx wrangler secret put YOUTUBE_API_KEY
npx wrangler secret put YOUTUBE_OAUTH_CLIENT_ID
npx wrangler secret put YOUTUBE_OAUTH_CLIENT_SECRET
npx wrangler secret put YOUTUBE_OAUTH_REFRESH_TOKEN
```

YouTube Data APIの全処理は `YOUTUBE_DAILY_QUOTA_LIMIT` の80%を共有上限として使用します。既定設定は10,000 units/dayの80%＝8,000 unitsで、メタデータ同期と再生リスト同期をD1上で原子的に合算します。日次境界は太平洋時間です。

## FlameNode側

1. `0042_event_youtube_playlist_sync.sql` を対象D1へ適用します。
2. Workerをデプロイします。
3. `/manage/events/{eventId}/youtube-playlist` を開きます。
4. 再生リストURLまたはID、同期方式、同期間隔を保存します。
5. 管理者は全体状況を `/admin/youtube-sync/playlists`、イベント運営は担当イベントの `/manage/events/{eventId}/youtube-playlist` で確認します。一般ユーザー向けの同期状況画面は提供しません。

「次回実行へ予約」は `next_sync_at` を現在時刻へ更新する処理です。HTTPリクエスト内でYouTube APIを直接呼ぶ即時同期ではなく、次の52分台のRecovery Cronで処理されます。

## 公開playlist projectionと既存イベントのbackfill

- 公開イベントのplaylist表示は、公開visibilityをD1で1行確認した後、`events/{eventId}/playlist.v1.json` を優先します。R2が欠損・不正・不完全・読取エラーの場合だけ、D1の従来クエリへfallbackします。
- fallbackのstructured logは `event_playlist_d1_fallback` として `r2_missing`、`r2_invalid`、`r2_incomplete`、`r2_error` を記録します。payloadにはevent ID以外の個人情報を含めません。
- 既存public eventのprojection未生成分は、content-jobs Recovery Cronが `static:event-playlist-projection-repair:v1:cursor` / `static:event-playlist-projection-repair:v1:done` を使って1回10件ずつ `event_base:<eventId>` へenqueueします。playlist専用targetは追加しません。

## 同期方式

- `追加のみ`: イベントの公開作品を追加します。YouTube側だけにある項目は削除しません。
- `完全同期`: 追加に加え、イベントに存在しない再生リスト項目を定期全件確認後に削除します。
- 新規追加時は `videos.scheduled_time`、未設定時は作成日時の順に `snippet.position` を指定します。
- YouTube側が手動並び替えでない場合は末尾追加へ自動フォールバックし、`playlist_order_fallback_manual_sort_required` を管理画面へ表示します。
- 無料枠を守るため、既存項目の全件並び替えは行いません。設定変更後は新規追加分から時刻順を適用します。

## 無料枠向け上限

- 1回に処理するイベント: 最大1件
- 1イベントの全件確認: 最大3ページ（150項目）ずつ継続
- D1への走査結果保存: 20項目単位に分割
- 1回の追加・削除: 合計最大4件
- position指定が拒否された追加は、末尾追加の再試行を含め最大100 unitsとして事前判定
- 1日のYouTube全処理クォータ: 標準8,000 units（設定quotaの80%を共有）
- 全件確認: 24時間に1回。それ以外はD1の項目索引とイベント作品を比較
- metadata・score・ランキング再生成と再生リスト書込みを同一invocationで実行しません。

上限に達した処理は `deferred` として次回以降へ繰り越します。

## 障害時

- `failed`: OAuth、権限、存在しない再生リスト、APIエラーを確認します。
- `deferred`: 日次クォータまたは1回の処理上限です。通常は自動再開します。
- `scanning`: 大きな再生リストをページ分割で確認中です。
- `playlist_order_fallback_manual_sort_required`: 同期は完了していますが時刻順挿入ができていません。YouTube側の並び順を「手動」に変更します。
- YouTube書き込み後にD1更新が失敗した場合は、次回実行で全件走査から復旧し、重複追加を避けます。
- 再生リストを変更した場合は設定を保存し直すと項目索引を破棄し、全件確認から再開します。
