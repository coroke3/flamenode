# Worker 運用

> Status: Active
> Last verified: 2026-07-13
> Verified against commit: `8b08f09`
> Source of truth: `workers/fast-jobs`、`workers/content-jobs`、`workers/sync-jobs`、`/admin/workers`

Deploy対象は`flamenode-fast-jobs`、`flamenode-content-jobs`、`flamenode-sync-jobs`の3本だけとする。Workers FreeはWorker数100、Cron Trigger数5であり、Workerを1本へ統合してもrequest、CPU、D1消費は減らないため、障害分離を優先して3本を維持する。

Workers FreeのCPU上限はCron間隔にかかわらず10msである。1時間以上のCronで15分CPUを使えるのはPaid planだけなので、Free運用では長時間jobを作らず、15分単位の固定batchへ分割する。

| Worker | Cron | 上限 |
| --- | --- | --- |
| `fast-jobs` | 5分 | 通知最大6件。締切リマインダーはleaseで1時間間隔 |
| `content-jobs` | 15分 | 静的queue 1 target。cleanupはleaseで1時間間隔 |
| `sync-jobs` | 15分（7/22/37/52分） | YouTube最大50件、score最大150件 |

job lockはD1の`worker_leases`、queue/outboxの取得はlease tokenと期限を使う。各Cronは固定上限、最大retry、dead-letterを守る。副作用endpointはPOST・Bearer・`WORKER_ADMIN_TOKEN`が揃わない限り拒否し、`/health`は副作用を持たない。

## YouTube APIキー冗長化

`sync-jobs`には主キーと副キーをsecretとして登録できる。

```sh
npx wrangler secret put YOUTUBE_API_KEY --config workers/sync-jobs/wrangler.toml
npx wrangler secret put YOUTUBE_API_KEY_SECONDARY --config workers/sync-jobs/wrangler.toml
```

- `YOUTUBE_API_KEY`は既存互換の主キー。
- `YOUTUBE_API_KEY_SECONDARY`は任意の副キー。主キーの失効、API未有効化、key restriction不整合などcredential固有の障害時だけ切り替える。
- 同一値を2回登録した場合は重複排除する。
- credential障害になったキーは6時間回避し、その後に再確認する。
- 使用中キー、直近切替、回避期限、障害理由は共有KVの`youtube-api:key-status:v1`へ秘密値を含めず保存し、`/admin/workers`で確認する。
- `quotaExceeded`、`dailyLimitExceeded`、`rateLimitExceeded`では副キーへ切り替えない。複数projectのquotaを合算・迂回する用途には使用しない。
- quota不足時はGoogle Cloud Consoleで実測し、quota extension申請または同期頻度の調整で対応する。
- 429と5xxは同じキーで最大2回再試行する。credential障害から副キーへ切り替わる場合でも、1 Cronの外部requestは最大3回に抑える。

無料枠での主要な安全条件は以下とする。

- 1 Worker invocationのD1 query/subrequestを50未満に保つ。
- 静的JSON生成中のD1 queryは`withSerializedD1`で直列化する。D1はdatabase単位で逐次処理されるため、多数のqueryを`Promise.all`で同時開始しない。
- YouTube同期は50 IDを1 API requestにまとめる。通常は最大2 request、credential障害時の副キー切替を含めても最大3 requestとする。
- YouTube候補は`pending`、開催中期限、通常期限の最大3 queryへ分離し、`videos`全体を15分ごとに走査しない。
- metadata保存は8件単位のbulk upsertとする。
- スコアは1 SQLで最大150件更新し、作品ごとのUPDATE loopを禁止する。
- D1のrows writtenはtable rowだけでなくindex entryも含むため、スコア更新を理論最大14,400作品/日に抑え、YouTube・通知・静的queue用の余裕を残す。
- 静的生成は1 invocationで1 targetだけ処理する。
- JSON生成対象は必ずSQL側の`LIMIT`を持ち、無制限全件取得を行わない。
- 初回backlog処理中も通知を独立Workerで維持する。

静的再生成queueのcanonical targetは`top`、`events_index`、`event`、`video`、`user`、`list_recent`、`list_popular`、`search_index`だけである。旧別名・未知値のruntime正規化やno-op成功処理は行わず、有限retry後に`failed`として運用画面へ残す。

`/admin/workers`は`worker_leases`、通知outbox、静的再生成queue、YouTube metadata、score更新時刻、static artifact履歴、YouTube APIキー状態を読み取り専用で集約する。停止、直近失敗、processing固着、backlog、理論解消時間を表示し、既存の各管理画面へ誘導する。CPU時間、`exceededCpu`、アカウント全体のD1日次使用量、YouTube API quotaはアプリだけでは正確に取得できないため、Cloudflare DashboardとGoogle Cloud Consoleを正本とする。

Cloudflare Dashboardで`exceededCpu`、D1 rows read/written、Worker requests、queue滞留を確認する。CPU超過が継続するtargetは、件数上限をさらに下げるかpayloadをページ分割する。Free枠で任意規模を無制限に保証することはできず、D1 500MB/databaseまたはCPU 10msが恒常的な制約になった段階でPaid移行を判断する。
