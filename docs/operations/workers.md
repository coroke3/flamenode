# Worker 運用

> Status: Active
> Last verified: 2026-07-13
> Verified against commit: `1f8e91e`
> Source of truth: `workers/fast-jobs`、`workers/content-jobs`、`workers/sync-jobs`、`/admin/workers`

Deploy対象は`flamenode-fast-jobs`、`flamenode-content-jobs`、`flamenode-sync-jobs`の3本だけとする。Workers FreeはWorker数100、Cron Trigger数5であり、Workerを1本へ統合してもrequest、CPU、D1消費は減らないため、障害分離を優先して3本を維持する。

Workers FreeのCPU上限はCron間隔にかかわらず10msである。1時間以上のCronで15分CPUを使えるのはPaid planだけなので、Free運用では長時間jobを作らず、15分単位の固定batchへ分割する。

| Worker | Cron | 上限 |
| --- | --- | --- |
| `fast-jobs` | 5分 | 通知最大6件、Discord外部request最大12件、DM cache KV書込最大2件。締切リマインダーはleaseで1時間間隔 |
| `content-jobs` | 15分 | 静的queue 1 target。cleanupはleaseで1時間間隔 |
| `sync-jobs` | 15分（7/22/37/52分） | YouTube最大50件・最大2 quota units、score最大150件 |

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
- 使用中キー、直近切替、回避期限、障害理由は共有KVの`youtube-api:key-status:v1`へ秘密値を含めず保存し、`/admin/youtube-api-keys`で確認する。
- `quotaExceeded`、`dailyLimitExceeded`、`rateLimitExceeded`では副キーへ切り替えない。複数projectのquotaを合算・迂回する用途には使用しない。
- quota不足時はGoogle Cloud Consoleで実測し、quota extension申請または同期頻度の調整で対応する。
- 共通request budgetは2のまま維持する。credential障害は同一キーで再試行せず、主キー失敗1回と副キー成功1回を上限内に収める。

無料枠と外部API上限に対する安全条件は以下とする。

- 1 Worker invocationのD1 query/subrequestを50未満に保つ。
- 静的JSON生成中のD1 queryは`withSerializedD1`で直列化する。D1はdatabase単位で逐次処理されるため、多数のqueryを`Promise.all`で同時開始しない。
- YouTube同期は50 IDを1 API requestにまとめる。失敗時retryまたはcredential障害時の副キー切替を含めても最大2 request / 2 quota unitsとする。
- YouTube quota系403を受けた場合はKVへ1時間cooldownを保存し、後続Cronの無駄な呼出しを止める。
- YouTube候補は`pending`、開催中期限、通常期限の最大3 queryへ分離し、`videos`全体を15分ごとに走査しない。
- YouTube APIのレスポンスは`fields`で必要なID・視聴数・公開状態・長さだけ取得する。
- Discordは固定rate値を仮定せず、`Retry-After`、`X-RateLimit-Remaining`、`X-RateLimit-Reset-After`、global/scope headersを解釈する。
- Discord 429は同一invocationで再試行せず、outboxの`next_attempt_at`へ反映する。global 429は別routeへの後続呼出しにも適用する。
- Discord DM channel IDはisolateへ全件、KVへ最大2件/run・576件/dayの範囲で30日cacheし、通常配送を2 requestから1 requestへ削減する。
- 401/403/404を同じ認証・宛先のまま繰り返さず、復旧不能なものはdead-letterへ移す。
- 外部画像proxyは同一キーの同時missを1 fetchへまとめ、ETag/304、negative cache、stale返却を使用する。
- 外部画像はGoogle Drive 8MB、YouTube thumbnail 2MBを1 object上限とし、大きすぎるレスポンスをisolateへ保持しない。
- metadata保存は8件単位のbulk upsertとする。
- スコアは1 SQLで最大150件更新し、作品ごとのUPDATE loopを禁止する。
- D1のrows writtenはtable rowだけでなくindex entryも含むため、スコア更新を理論最大14,400作品/日に抑え、YouTube・通知・静的queue用の余裕を残す。
- 静的生成は1 invocationで1 targetだけ処理する。
- JSON生成対象は必ずSQL側の`LIMIT`を持ち、無制限全件取得を行わない。
- 初回backlog処理中も通知を独立Workerで維持する。

YouTube `videos.list`の理論最大消費は、15分ごとに最大2 unitsとして192 units/dayである。通常成功時は1 requestだけなので96 units/dayとなる。Provider側障害時も上限を超えて再試行しない。

静的再生成queueのcanonical targetは`top`、`events_index`、`event`、`video`、`user`、`list_recent`、`list_popular`、`search_index`だけである。旧別名・未知値のruntime正規化やno-op成功処理は行わず、有限retry後に`failed`として運用画面へ残す。

`/admin/workers`は`worker_leases`、通知outbox、静的再生成queue、YouTube metadata、score更新時刻、static artifact履歴を読み取り専用で集約する。YouTube APIキーの主副状態は`/admin/youtube-api-keys`で確認する。

監視時は次を確認する。

- YouTube quota cooldown中はYouTube同期がskippedになる。Google Cloud Consoleのquotaを正本として確認する。
- 主キーがcredential障害の場合は副キーへ切り替わり、主キーは6時間回避される。APIキー本体は管理画面やKVへ保存・表示しない。
- Discord rate limit時は通知が`pending`へ戻り、`next_attempt_at`以降に再処理される。global 429は同一isolate内の全routeを停止する。
- Discord DM cacheのKV永続化は最大2件/runであり、超過分はisolate cacheのみを使う。通知配送自体は停止しない。
- 画像proxyは`x-fn-media-cache`の`stale`、`fallback`増加を確認する。
- CPU時間、`exceededCpu`、アカウント全体のD1日次使用量、YouTube API quotaはアプリDBだけでは正確に取得できないため、Cloudflare DashboardとGoogle Cloud Consoleを正本とする。

Cloudflare Dashboardで`exceededCpu`、D1 rows read/written、Worker requests、queue滞留を確認する。CPU超過が継続するtargetは、件数上限をさらに下げるかpayloadをページ分割する。Free枠で任意規模を無制限に保証することはできず、D1 500MB/databaseまたはCPU 10msが恒常的な制約になった段階でPaid移行を判断する。
