# External API Limits

> Status: Active
> Last verified: 2026-07-14
> Source of truth: `workers/shared/externalApi.ts`、`workers/youtube-sync/index.ts`、`workers/youtube-playlist-sync/index.ts`、`workers/notification-dispatcher/dispatch.ts`、`src/lib/media/externalImageProxy.ts`

外部サービスのrate limit値をアプリ側で固定推測せず、Providerが返すquota・rate limit・Retry-Afterを優先する。全処理は1回のWorker invocation内で固定予算を持ち、無制限retry、無制限並列、全件再取得を禁止する。

| Provider / endpoint | 1実行予算 | 待機・復旧 | 重複削減 |
| --- | ---: | --- | --- |
| YouTube Data API `videos.list` | 50 ID、通常1 request、最大2 quota units | 429/5xxは最大1回retry。quota系403はKVへ1時間cooldown | `fields`で必要列だけ取得。期限到来50件だけ選択 |
| YouTube playlist / OAuth | 1実行最大12 external requests、mutation最大4 | quota予約後に実行。401時はtoken cacheを破棄し次回Cronで再取得 | OAuth tokenをisolate内で期限付き再利用。playlist responseは`fields`で縮小 |
| Discord DM / Webhook | 通知6件、最大12 external requests、DM cache KV書込最大2 | rate headersとRetry-Afterを`next_attempt_at`へ反映。global 429は全routeへ適用 | DM channel IDをisolateへ全件、KVへ最大576件/dayの範囲で30日cacheし、通常配送を1 request化 |
| Google Drive public image | requestごと最大1 upstream fetch | 失敗・Retry-Afterをnegative cacheへ保存しstaleを返す | 同一キーの同時missを1本へ集約。ETag/304再検証 |
| YouTube thumbnail | requestごと最大1 upstream fetch | 失敗・Retry-Afterをnegative cacheへ保存しstaleを返す | 同一キーの同時missを1本へ集約。ETag/304再検証 |

## Provider別詳細

### YouTube Data API

- `videos.list`は1 requestへ最大50 IDをまとめる。
- 1 Cronで通常1 quota unit、retryが発生しても最大2 quota unitsとする。
- 15分間隔のため通常96 units/day、全回で1回retryしても最大192 units/dayとなる。
- quota系403を受けた場合、同じCronや直後のCronで呼び続けない。
- APIキー、quota error本文、URL queryをログへ出さない。
- 再生リスト同期はOAuth access tokenをisolate内で期限付き再利用し、Cronごとのtoken endpoint呼出しを避ける。
- 再生リスト一覧・追加はpartial responseを使用し、1実行の外部requestを最大12に固定する。
- 再生対象の重複排除はSQLの`GROUP BY`で行い、スキャン結果のD1保存は複数statementを`batch`へまとめる。

### Discord

- `X-RateLimit-Remaining`が0の場合、`X-RateLimit-Reset-After`までrouteを停止する。
- 429は`Retry-After`またはJSONの`retry_after`を使用する。
- `X-RateLimit-Global`、`X-RateLimit-Scope: global`、JSONの`global`を検出した場合、全Discord routeを停止する。
- 429をその場でretryせず、通知outboxの次回実行時刻へ反映する。
- DM channel IDはisolate cacheへ必ず保存する。KVへのput/deleteは1実行最大2件とし、5分Cronで最大576 writes/dayへ抑える。
- KV予算を使い切った場合も通知配送は継続し、そのisolate内ではchannel IDを再利用する。
- 401/403/404は同じ認証・宛先のまま繰り返さずdead-letterへ送る。ただしcache済みDM channelの404だけはcacheを削除して次回再作成する。

### 外部画像

- Google Drive画像は1 object 8MB、YouTube thumbnailは2MBを上限とする。
- cache総量24MB、最大600件をisolate単位で保持する。
- 新鮮なcache、negative cache、stale cache、in-flight共有の順で判定する。
- `Content-Length`または実受信bytesが上限を超えた場合はcacheせずfallbackを返す。
- staleが利用可能ならupstream障害時も従来の画像を返す。

## 監視

- `/admin/workers`でjobの失敗、最終成功時刻、stale lease、queue滞留を確認する。
- YouTube quota cooldown中はYouTube同期がskippedになる。
- Discord rate limit時は通知が`pending`へ戻り、`next_attempt_at`以降に再処理される。
- Discord DM cacheのKV予算超過は配送失敗ではなく、cross-isolate cache永続化だけを見送る。
- 画像proxyは`x-fn-media-cache`で`hit`、`miss`、`stale`、`coalesced`、`fallback`を区別する。
