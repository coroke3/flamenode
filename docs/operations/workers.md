# Worker 運用

> Status: Active
> Last verified: 2026-07-13
> Verified against: `agent/cloudflare-free-tier-scale`
> Source of truth: `workers/fast-jobs`、`workers/content-jobs`、`workers/sync-jobs`

Deploy対象は`flamenode-fast-jobs`、`flamenode-content-jobs`、`flamenode-sync-jobs`の3本だけとする。Workers FreeはWorker数100、Cron Trigger数5であり、Workerを1本へ統合してもrequest・CPU・D1消費は減らないため、障害分離を優先して3本を維持する。

| Worker | Cron | 上限 |
| --- | --- | --- |
| `fast-jobs` | 5分 | 通知最大6件。締切リマインダーはleaseで1時間間隔 |
| `content-jobs` | 1時間 | 静的queueはbounded。cleanupも1時間単位 |
| `sync-jobs` | 1時間 | YouTube最大200件、score最大500件 |

1時間未満CronはFree planでCPU 10ms上限になるため、静的JSON生成・cleanup・YouTube同期・スコア計算を5分/15分Cronへ入れない。リアルタイム性が必要な通知だけを5分Workerに残す。

job lockはD1の`worker_leases`、queue/outboxの取得はlease tokenと期限を使う。各Cronは固定上限、最大retry、dead-letterを守る。副作用endpointはPOST・Bearer・`WORKER_ADMIN_TOKEN`が揃わない限り拒否し、`/health`は副作用を持たない。

静的再生成queueのcanonical targetは`top`、`events_index`、`event`、`video`、`user`、`list_recent`、`list_popular`、`search_index`だけである。旧別名・未知値のruntime正規化やno-op成功処理は行わず、有限retry後に`failed`として運用画面へ残す。
