# YouTube再生リスト同期 運用手順

## 構成

- Workerは既存の `flamenode-sync-jobs` を使用し、Worker数を増やしません。
- Cronは毎時7分・52分に起動し、52分台だけを再生リスト同期のRecovery枠にします。
- 7分台は動画メタデータ同期・スコア差分再計算を維持します。
- 設定保存・手動同期予約では、D1の `next_sync_at` を先に現在時刻へ更新した後、`YOUTUBE_SYNC_WAKE_QUEUE` に `youtube_playlist_sync` のドアベルをbest-effort送信します。
- Queueが無効・binding不足・送信失敗の場合も予約状態はD1に残るため、次の52分台Cronが回収します。
- 再生リスト同期はイベント設定の `next_sync_at` と同期間隔で実行します。
- `event_youtube_playlist_sync.enabled = 1` かつ `sync_mode != 'off'` のイベントだけを同期します。未設定イベントを自動で同期しません。
- OAuth credentialはD1/KVへ保存せず、Worker secretだけに保持します。

## 稼働可能判定

コード上は、次の条件が揃えば再生リスト同期を実行できます。

- `flamenode-sync-jobs` が現行commitでデプロイ済み
- Cronが `7 * * * *` / `52 * * * *`
- `DB` / `KV` / `YOUTUBE_SYNC_WAKE_QUEUE` / `STATIC_REBUILD_WAKE_QUEUE` bindingが存在
- `event_youtube_playlist_sync` / `event_youtube_playlist_items` / `external_api_quota_usage` がRemote D1に存在
- `YOUTUBE_API_KEY` / `YOUTUBE_OAUTH_CLIENT_ID` / `YOUTUBE_OAUTH_CLIENT_SECRET` / `YOUTUBE_OAUTH_REFRESH_TOKEN` のsecret名が登録済み
- refresh tokenを発行したGoogleアカウントが対象再生リストを編集できる

Queue即時経路を利用するには、さらに `QUEUE_DISPATCH_ENABLED=1` / `QUEUE_YOUTUBE_SYNC_ENABLED=1` が必要です。これらが無効でも52分台Cronによる同期は維持されます。

`cf:deploy-production` のproduction preflightはRemote D1のruntime schemaと `sync-jobs` の必須secret名をfail-closedで検査するため、同スクリプトを通して最新commitが正常デプロイ済みなら、Cloudflare側のテーブル・binding・secret名不足は原則として除外できます。ただしrefresh tokenの失効、YouTube Data APIの無効化、対象再生リストの所有権・編集権限は最初の実API同期まで確定できません。

コード側の回帰確認は `src/lib/youtubePlaylistReadiness.contract.test.mjs`、`workers/sync-jobs/index.test.mjs`、`workers/youtube-playlist-sync/index.test.mjs`、`workers/youtube-playlist-sync/slotOrder.contract.test.mjs`、`workers/youtube-playlist-sync/orderRepair.test.mjs`、`workers/youtube-playlist-sync/orderRepair.contract.test.mjs` を使用します。

## Google Cloud / YouTube側

1. YouTube Data API v3を有効化します。
2. OAuth同意画面とOAuthクライアントを作成します。
3. 再生リストを所有するYouTubeチャンネルで認可し、`https://www.googleapis.com/auth/youtube` scopeのrefresh tokenを取得します。
4. イベントごとの再生リストはYouTube側で作成します。
5. 投稿枠順のposition指定・既存項目の順序補正を有効にするには、再生リストの並び順をYouTube側で「手動」にします。

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

1. `0042_event_youtube_playlist_sync.sql` を含む現行までの全migrationを対象D1へ適用します。今回の投稿枠順・既存順序補正には追加migrationはありません。
2. Workerをデプロイします。
3. `/manage/events/{eventId}/youtube-playlist` を開きます。
4. 再生リストURLまたはID、同期方式、同期間隔を保存します。
5. 管理者は全体状況を `/admin/youtube-sync/playlists`、イベント運営は担当イベントの `/manage/events/{eventId}/youtube-playlist` で確認します。一般ユーザー向けの同期状況画面は提供しません。

「今すぐ同期を予約」はHTTPリクエスト内でYouTube APIを直接呼びません。まず `next_sync_at` を現在時刻へcommitし、全件確認状態をリセットしてからQueue wakeを送ります。Queue consumerはdueイベントだけを最大1件処理し、remote membershipと投稿枠順を再確認します。Webリクエスト内でYouTube APIを呼ばないため、Web WorkerのCPU/外部API時間を増やしません。Queue経路が利用できなければ52分台Recovery Cronへ自動フォールバックします。

## 公開playlist projectionと既存イベントのbackfill

- 公開イベントのplaylist表示は、公開visibilityをD1で1行確認した後、`events/{eventId}/playlist.v1.json` を優先します。R2が欠損・不正・不完全・読取エラーの場合だけ、D1の従来クエリへfallbackします。
- fallbackのstructured logは `event_playlist_d1_fallback` として `r2_missing`、`r2_invalid`、`r2_incomplete`、`r2_error` を記録します。payloadにはevent ID以外の個人情報を含めません。
- 既存public eventのprojection未生成分は、content-jobs Recovery Cronが `static:event-playlist-projection-repair:v1:cursor` / `static:event-playlist-projection-repair:v1:done` を使って1回10件ずつ `event_base:<eventId>` へenqueueします。playlist専用targetは追加しません。

## 同期方式と投稿枠順

- `追加のみ`: イベントの公開作品を追加します。YouTube側だけにある手動追加項目は削除しません。
- `完全同期`: イベント外の項目を定期全件確認後に削除し、同じイベント作品が重複登録されている場合も2件目以降を削除します。
- 同期対象作品は `video_events` に加えて `videos.primary_event_id` も参照します。旧データや移行データで片方だけが存在しても同期対象から落としません。
- 基準順は **提出済みの投稿枠順** です。時刻枠は最初の `slots.start_time`、カウント枠や同時刻のtie-breakは `slots.sort_order` を使用します。
- 連続枠で1作品が複数枠を使用する場合は、その作品が使用する最初の提出済み枠を基準位置にします。
- 投稿枠がない公開作品は、投稿枠付き作品の後ろに `videos.scheduled_time`、未設定時は作成日時順で並べます。
- 新規追加時はYouTubeの `snippet.position` を上記基準順から算出します。途中の枠作品が後から追加された場合も、そのpositionへ挿入するため後続項目はYouTube側で後ろへずれます。
- full scan完了後または「今すぐ同期を予約」後は、YouTube側の実際の項目順も確認し、イベント作品の相対順が投稿枠順と異なる場合は既存項目を少量ずつposition更新して自己修復します。
- 既存順序補正は1 invocationあたり最大2件です。残りがある場合は `playlist_order_repair_continuing` として次回へ繰り越し、1回のWorkerやYouTube quotaへ負荷を集中させません。
- 順序確認は1 invocationあたり最大8ページ（400項目）です。これを超える巨大再生リストは `playlist_order_repair_scan_limit_exceeded` を記録し、推測で既存項目を移動しません。新規追加時の投稿枠position指定は維持されます。
- 対象作品の欠落・重複などで安全な移動先を一意に決められない場合は `playlist_order_repair_ambiguous_remote_items` とし、誤った並び替えを行いません。
- YouTube側が手動並び替えでない場合は、新規追加は末尾追加へフォールバックし、既存順序補正も停止して `playlist_order_fallback_manual_sort_required` を管理画面へ表示します。

## Cloudflare / D1 最適化

- 投稿枠順の取得はD1側でYouTube ID重複排除と順序決定を行い、Worker側で全作品を再sortしません。
- `video_events` は `video_events_event_video_idx(event_id, video_id)`、`videos` は `videos_primary_event_idx(primary_event_id)`、`slots` は既存のイベント・動画検索indexを利用します。今回の同期順変更のためだけに新しいschema migrationは追加しません。
- 外部APIは1 invocationあたり12 subrequestの固定budget、再生リスト追加・削除・既存位置更新は合計最大4 mutation、うち既存順序補正は最大2件に制限しています。
- full scanは最大3ページずつ継続、既存順序のlive snapshotは最大8ページで停止し、Workerの長時間化とYouTube quota急増を防ぎます。
- Queueは業務状態を持たないドアベルとして使い、D1の `next_sync_at` / scan stateを正本にします。Queue失敗で予約状態を失わないため、52分Cronから復旧できます。
- D1の一時的な接続切断は限定的にretryしますが、overload・CPU・memory・storage timeoutは同一invocation内でblind retryせず、負荷増幅を避けます。
- Web Worker側はSmart Placementを利用し、静的assetsは `run_worker_first=false` でWorkerを通さずedge配信する構成を維持します。

## 無料枠向け上限

- 1回に処理するイベント: 最大1件
- 1イベントの全件確認: 最大3ページ（150項目）ずつ継続
- D1への走査結果保存: 20項目単位に分割
- 1回の再生リストmutation: 追加・削除・既存位置更新の合計最大4件
- 既存位置更新: 1回最大2件、1件50 units
- 既存順序確認: 最大8ページ（400項目）、1ページ1 unit
- position指定が拒否された新規追加は、末尾追加の再試行を含め最大100 unitsとして事前判定
- 1日のYouTube全処理クォータ: 標準8,000 units（設定quotaの80%を共有）
- 全件確認: 原則24時間に1回。「今すぐ同期を予約」はremote順を再確認するためfull scan状態を明示的にリセットします。
- metadata・score・ランキング再生成と再生リスト書込みはQueue内でも別wakeとして分離し、片方の失敗で成功済みのもう片方を再試行しません。

上限に達した処理は `deferred` として次回以降へ繰り越します。

## 障害時

- `failed`: OAuth、権限、存在しない再生リスト、APIエラーを確認します。
- `deferred`: 日次クォータまたは1回の処理上限です。通常は自動再開します。
- `scanning`: 大きな再生リストをページ分割で確認中です。
- `playlist_mutation_batch_continuing`: 追加・削除のmutation上限に達したため、次回へ継続します。
- `playlist_order_repair_continuing`: 既存項目の投稿枠順補正が残っているため、次回へ継続します。
- `playlist_order_repair_request_budget`: 外部request budgetを使い切る前に停止し、次回へ継続します。
- `playlist_order_repair_quota_deferred`: YouTube日次quotaの余裕不足です。次の通常同期まで既存順序補正を待ちます。
- `playlist_order_repair_scan_limit_exceeded`: 再生リストが順序確認上限を超えています。誤移動防止のため既存項目は動かしません。
- `playlist_order_repair_ambiguous_remote_items`: 対象動画の欠落・重複などで安全な順序補正ができません。完全同期または再スキャン後の状態を確認します。
- `playlist_order_fallback_manual_sort_required`: 投稿枠位置への挿入・既存位置更新ができていません。YouTube側の並び順を「手動」に変更します。
- Queue送信失敗: D1の `next_sync_at` が残るため、操作自体は成功扱いとし52分台Cronで回収します。
- YouTube書き込み後にD1更新が失敗した場合は、次回実行で全件走査から復旧し、重複追加を避けます。
- 再生リストを変更した場合は設定を保存し直すと項目索引を破棄し、全件確認から再開します。
