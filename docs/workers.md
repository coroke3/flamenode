# Workers

FlameNodeは本番で3つのCron Workerだけをdeployする。Workers FreeはWorker数100、Cron Trigger数5のため、1 Workerへ統合すること自体に無料枠節約効果はない。処理障害の分離と、1実行当たりのCPU・D1 query・subrequest予算を優先して3 Workerを維持する。

Workers FreeのCPU上限はHTTP/Cronともに10msである。ネットワーク、KV、D1の待機時間はCPU時間へ含まれないが、JSON解析・直列化・配列処理は含まれる。このため、重い処理を長時間実行せず、小さい固定batchへ分割する。

| Worker | Cron | 主な責務 | 1実行上限 |
|---|---:|---|---:|
| `fast-jobs` | `*/5 * * * *` | 締切リマインダー、通知配送 | 通知6件、Discord外部request最大12、DM cache KV書込最大2 |
| `content-jobs` | `*/15 * * * *` | 静的JSON再生成、retention cleanup | target 1件 |
| `sync-jobs` | `7,22,37,52 * * * *` | YouTube同期、スコア差分再計算 | YouTube最大200件・外部request最大8、score 150件 |

旧standalone Worker entrypointは共有モジュールとして残すが、直接deployしない。

## 実行予算

- `fast-jobs`: 通知は最大6件。1件当たりD1 claim、KV DM channel cache、Discord最大2 request、完了更新を含めて50 subrequests以内に収める。DM channelはisolateへ全件cacheし、KVへの永続化だけを1実行2件に制限する。
- `content-jobs`: 1 targetだけ生成する。cleanupはleaseにより1時間に1回だけ実行する。静的生成中のD1 queryは`withSerializedD1`で直列化し、同時接続枠を浪費しない。
- `sync-jobs`: YouTube `videos.list`は50 IDずつ最大4 requestを逐次実行する。各requestの再試行は最大1回で、外部request budgetは最大8に固定する。
- YouTube metadata保存は10件単位のbulk upsertとし、1 SQLの100 bindings上限に収める。最大200件でも20 write statementsに固定する。
- `youtube-sync`: `pending`、開催中期限、通常期限を最大3 queryへ分け、既存indexから合計200件だけ取得する。15分ごとの全作品走査を行わない。
- `score-recalc`: 変更済みまたは24時間以上未更新の公開作品を1 SQLで最大150件更新する。KV cursorと1作品1 queryを使わない。
- D1のrows writtenには更新table rowに加えてindex entryも含まれるため、scoreの理論最大を14,400作品/日に抑え、他jobの書込み余地を確保する。
- Cron重複排除はD1 `worker_leases`を正本とし、無制限loop、全件読込、処理全体の即時retryは禁止する。

## YouTube単一キーと日次quota予算

- APIキーは`YOUTUBE_API_KEY`の1つだけを登録する。副キー、ローテーション、quota迂回は実装しない。
- Google Cloud Consoleの日次quotaは`YOUTUBE_DAILY_QUOTA_LIMIT`へ設定する。未設定・不正値は10,000 units/dayとして扱う。
- FlameNodeの上限は設定quotaの80%とする。標準10,000 units/dayなら8,000 units/dayで停止し、残り20%を手動対応・計上差・他用途の安全余裕として残す。
- `external_api_quota_usage`へ太平洋時間の日付単位で使用量を保存する。quota予約はD1 UPSERTの条件で原子的に行い、並行Workerでも上限を超えない。
- Workerは最大再試行分を先に予約し、実際に外部requestを行わなかった分だけ処理後に返却する。ネットワーク失敗を含む実行済みrequestは消費扱いのまま残す。
- この台帳は再生リスト同期の高quota処理とも共有する。日次上限まで無意味なrequestを発生させるものではなく、必要な処理がある場合だけ最大80%まで使用できる設計とする。
- 再生リスト同期はOAuth tokenをisolate内で期限付き再利用し、一覧取得はpartial response、D1保存はbatchで処理する。1実行の外部requestは最大12に固定する。
- quota系403を受けた場合はKVへ1時間cooldownを保存し、後続Cronの無駄な呼出しを止める。

## 外部APIガード

| 外部処理 | Provider上限への対応 | FlameNode側の固定上限・削減策 |
|---|---|---|
| YouTube Data API `videos.list` | 1 requestあたり1 quota unit。無効requestも最低1 unit。既定10,000 units/day、太平洋時間0時reset | 単一キー。1 Cron最大4 batch・200 ID、再試行込み外部request最大8。日次8,000 unitsの共有予算。必要な`fields`だけ取得 |
| Discord Bot/Webhook | per-route limitは可変。`X-RateLimit-*`と`Retry-After`を正本にする | 1 Cron最大12 external requests。inline retryなし。DM channel IDをisolate/KVへ30日cacheし、通常配送を1 requestへ削減 |
| Google Drive画像 / YouTube thumbnail | 公開画像originの固定quota値へ依存しない | 同一キーの同時missを1 fetchへ集約。ETag/304再検証、negative cache、stale返却、単一objectサイズ上限 |
| Cloudflare Worker subrequest | Freeは1 invocation 50、同時outgoing connection 6 | YouTubeは最大8 requestを逐次実行し、42 request以上の余裕を残す。D1も別途50 query未満に固定 |

Providerの429/503を受けた場合、同一invocationで無制限に再試行しない。Providerが返す待機時間を短期cooldownへ反映し、後続Cronへ繰り越す。固定値をproviderの実レート上限として仮定しない。

## 大規模データ時の処理能力

| 処理 | 最大処理量 | 1万件の初回処理目安 |
|---|---:|---:|
| YouTube同期 | 200件/15分 = 19,200件/日 | 約12時間30分 |
| スコア差分更新 | 150件/15分 = 14,400件/日 | 約16時間40分 |
| 静的JSON target | 1件/15分 = 96件/日 | 優先度順。global targetは重複排除 |
| 通知 | 6件/5分 = 1,728件/日 | 通常は5分以内 |

上記はqueue滞留、外部API障害、Cloudflare側throttleがない場合の理論上限であり、保証値ではない。静的JSONが未生成または古い間もD1正本とlive APIを利用できる構成を維持する。

## 更新頻度

| データ | 反映目標 |
|---|---:|
| 通知 | 5分以内。Provider cooldown中は`Retry-After`後のCronへ繰り越し |
| 投稿・管理画面の確定結果 | 即時（D1正本） |
| live API | CDN cache 5秒、stale 30秒 |
| 静的JSON | queue先頭から15分ごとに1 target |
| 開催中イベントのYouTube情報 | 1時間以上古い対象を優先 |
| 通常作品のYouTube情報 | 24時間以上古い対象を順次 |
| スコア | 変更済み対象を15分ごとに最大150件 |

Queue targetはcanonical値だけを受理する。旧別名や未知値は成功扱いにせず、有限retry後に`failed`として可視化する。

## 監視

`/admin/workers`でCron・queue・backlogを確認し、`/admin/youtube-quota`で太平洋時間のquota日、設定値、80%上限、推定使用量、残り予算を確認する。APIキー本体は保存・表示しない。

アプリのquota台帳はFlameNodeが予約・実行した処理だけを表す。Google Cloud Console外の利用やProvider側の実計上を完全には取得できないため、最終的なquota残量はGoogle Cloud Consoleを正本とする。

## 公式上限

- Workers limits: https://developers.cloudflare.com/workers/platform/limits/
- Cron Triggers: https://developers.cloudflare.com/workers/configuration/cron-triggers/
- D1 limits: https://developers.cloudflare.com/d1/platform/limits/
- D1 pricing: https://developers.cloudflare.com/d1/platform/pricing/
- YouTube quota: https://developers.google.com/youtube/v3/determine_quota_cost
- YouTube API Terms: https://developers.google.com/youtube/terms/api-services-terms-of-service
- Discord rate limits: https://docs.discord.com/developers/topics/rate-limits
