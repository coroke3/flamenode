# Worker 運用

> Status: Active
> Last verified: 2026-07-13
> Verified against commit: `7a4e430`
> Source of truth: `workers/fast-jobs`、`workers/content-jobs`、`workers/sync-jobs`

Deploy対象は`flamenode-fast-jobs`、`flamenode-content-jobs`、`flamenode-sync-jobs`の3本だけとする。Workers FreeはWorker数100、Cron Trigger数5であり、Workerを1本へ統合してもrequest、CPU、D1消費は減らないため、障害分離を優先して3本を維持する。

Workers FreeのCPU上限はCron間隔にかかわらず10msである。1時間以上のCronで15分CPUを使えるのはPaid planだけなので、Free運用では長時間jobを作らず、15分単位の固定batchへ分割する。

| Worker | Cron | 上限 |
| --- | --- | --- |
| `fast-jobs` | 5分 | 通知最大6件。締切リマインダーはleaseで1時間間隔 |
| `content-jobs` | 15分 | 静的queue 1 target。cleanupはleaseで1時間間隔 |
| `sync-jobs` | 15分（7/22/37/52分） | YouTube最大50件、score最大250件 |

job lockはD1の`worker_leases`、queue/outboxの取得はlease tokenと期限を使う。各Cronは固定上限、最大retry、dead-letterを守る。副作用endpointはPOST・Bearer・`WORKER_ADMIN_TOKEN`が揃わない限り拒否し、`/health`は副作用を持たない。

無料枠での主要な安全条件は以下とする。

- 1 Worker invocationのD1 query/subrequestを50未満に保つ。
- YouTube同期は50 IDを1 API requestにまとめる。
- metadata保存は8件単位のbulk upsertとする。
- スコアは1 SQLで最大250件更新し、作品ごとのUPDATE loopを禁止する。
- 静的生成は1 invocationで1 targetだけ処理する。
- JSON生成対象は必ずSQL側の`LIMIT`を持ち、無制限全件取得を行わない。
- 初回backlog処理中も通知を独立Workerで維持する。

静的再生成queueのcanonical targetは`top`、`events_index`、`event`、`video`、`user`、`list_recent`、`list_popular`、`search_index`だけである。旧別名・未知値のruntime正規化やno-op成功処理は行わず、有限retry後に`failed`として運用画面へ残す。

Cloudflare Dashboardで`exceededCpu`、D1 rows read/written、Worker requests、queue滞留を確認する。CPU超過が継続するtargetは、件数上限をさらに下げるかpayloadをページ分割する。Free枠で任意規模を無制限に保証することはできず、D1 500MB/databaseまたはCPU 10msが恒常的な制約になった段階でPaid移行を判断する。
