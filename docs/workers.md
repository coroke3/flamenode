# Workers

FlameNodeは本番で3つのCron Workerだけをdeployする。Workers FreeはWorker数100、Cron Trigger数5のため、1 Workerへ統合すること自体に無料枠節約効果はない。処理障害の分離と、1実行当たりのCPU・D1 query・subrequest予算を優先して3 Workerを維持する。

Workers FreeのCPU上限はHTTP/Cronともに10msであり、Cron間隔を1時間以上にしても増えない。ネットワーク、KV、D1の待機時間はCPU時間へ含まれないが、JSON解析・直列化・配列処理は含まれる。このため、重い処理を長時間実行せず、小さい固定batchへ分割する。

| Worker | Cron | 主な責務 | 1実行上限 |
|---|---:|---|---:|
| `fast-jobs` | `*/5 * * * *` | 締切リマインダー、通知配送 | 通知6件 |
| `content-jobs` | `*/15 * * * *` | 静的JSON再生成、retention cleanup | target 1件 |
| `sync-jobs` | `7,22,37,52 * * * *` | YouTube同期、スコア差分再計算 | YouTube 50件、score 160件 |

旧standalone Worker entrypointは共有モジュールとして残すが、直接deployしない。

## 実行予算

- `fast-jobs`: 通知は最大6件。1件当たりD1 claim、Discord最大2 request、完了更新を行っても50 subrequests以内に収める。
- `content-jobs`: 1 targetだけ生成する。cleanupはleaseにより1時間に1回だけ実行する。静的生成中のD1処理は`withSerializedD1`で直列化し、同時接続枠を浪費しない。
- `sync-jobs`: YouTube `videos.list`は最大50 IDを1 requestで取得する。D1保存は8件単位のbulk upsertにまとめる。
- `score-recalc`: 変更済みまたは24時間以上未更新の公開作品を1 SQLで最大160件更新する。KV cursorと1作品1 queryを使わない。
- Cron重複排除はD1 `worker_leases`を正本とし、無制限loop、全件読込、処理全体の即時retryは禁止する。

## 大規模データ時の処理能力

| 処理 | 最大処理量 | 1万件の初回処理目安 |
|---|---:|---:|
| YouTube同期 | 50件/15分 = 4,800件/日 | 約2.1日 |
| スコア差分更新 | 160件/15分 = 15,360件/日 | 約15.7時間 |
| 静的JSON target | 1件/15分 = 96件/日 | 優先度順。global targetは重複排除 |
| 通知 | 6件/5分 = 1,728件/日 | 通常は5分以内 |

上記はqueue滞留、外部API障害、Cloudflare側throttleがない場合の理論上限であり、保証値ではない。静的JSONが未生成または古い間もD1正本とlive APIを利用できる構成を維持する。

## 更新頻度

| データ | 反映目標 |
|---|---:|
| 通知 | 5分以内 |
| 投稿・管理画面の確定結果 | 即時（D1正本） |
| live API | CDN cache 5秒、stale 30秒 |
| 静的JSON | queue先頭から15分ごとに1 target |
| 開催中イベントのYouTube情報 | 1時間以上古い対象を優先 |
| 通常作品のYouTube情報 | 24時間以上古い対象を順次 |
| スコア | 変更済み対象を15分ごとに最大160件 |

Queue targetはcanonical値だけを受理する。旧別名や未知値は成功扱いにせず、有限retry後に`failed`として可視化する。

## 監視

`/admin/workers`で次を確認する。

- Cronごとの最終開始、最終成功、最終失敗、lease、直近エラー
- 通知・静的JSON・YouTube・スコアのbacklogと理論解消時間
- processing固着、failed件数、global静的JSONの最終生成時刻
- 現在の`operation_mode`

CPU時間、`exceededCpu`、D1の日次使用量、YouTube API quotaはCloudflare DashboardおよびGoogle Cloud Consoleを正本とする。

## 公式上限

- Workers limits: https://developers.cloudflare.com/workers/platform/limits/
- Cron Triggers: https://developers.cloudflare.com/workers/configuration/cron-triggers/
- D1 limits: https://developers.cloudflare.com/d1/platform/limits/
- D1 pricing: https://developers.cloudflare.com/d1/platform/pricing/
- YouTube quota: https://developers.google.com/youtube/v3/determine_quota_cost
