# Worker 運用

> Status: Active
> Last verified: 2026-07-11
> Verified against commit: `5f48e0f` + working tree
> Source of truth: `workers/fast-jobs`, `workers/content-jobs`, `workers/sync-jobs`

deploy対象は `flamenode-fast-jobs`、`flamenode-content-jobs`、`flamenode-sync-jobs` の3本だけです。job lockはD1の`worker_leases`、queue/outboxの取得はlease tokenと期限を使う。

各Cronは固定上限、cursor、最大retry、dead-letterを守る。副作用endpointはPOST・Bearer・`WORKER_ADMIN_TOKEN`が揃わない限り拒否し、`/health`は副作用を持たない。

静的再生成queueのcanonical targetは`top`、`events_index`、`event`、`video`、
`user`、`list_recent`、`list_popular`、`search_index`だけである。旧別名・未知値の
runtime正規化やno-op成功処理は行わず、有限retry後に`failed`として運用画面へ残す。
