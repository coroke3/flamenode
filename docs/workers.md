# Workers

FlameNodeは本番で3つのCron Workerだけをdeployする。Workers FreeはWorker数100、Cron Trigger数5のため、1 Workerへ統合すること自体に無料枠節約効果はない。処理障害の分離と1実行あたりのD1/subrequest予算を優先し、3 Workerを維持する。

| Worker | Cron | 主な責務 | Free plan上の理由 |
|---|---:|---|---|
| `fast-jobs` | `*/5 * * * *` | 締切リマインダーenqueue、通知配送 | リアルタイム性が必要。通知は最大6件に固定 |
| `content-jobs` | `0 * * * *` | 静的JSON再生成、retention cleanup | 1時間以上のCron CPU枠を利用 |
| `sync-jobs` | `30 * * * *` | YouTube同期、スコア差分再計算 | 1時間以上のCron CPU枠を利用 |

旧standalone Worker entrypointは共有モジュールとして残すが、直接deployしない。

```bash
cd workers/fast-jobs && wrangler deploy && cd ../..
cd workers/content-jobs && wrangler deploy && cd ../..
cd workers/sync-jobs && wrangler deploy && cd ../..
```

## 実行上限

- `fast-jobs`: 通知は1回最大6件。1件あたりD1 claim/完了更新とDiscord最大2 requestを使っても50 subrequests以内に収める。
- `content-jobs`: 静的再生成queueはbounded件数のみ処理し、cleanupは1時間に1回。
- `sync-jobs`: YouTube APIは50 ID × 最大4 batch（最大200作品）。D1保存は8件単位のbulk upsert。
- `score-recalc`: 変更済みまたは24時間以上未更新の公開作品を1 SQLで最大500件更新する。ID cursor/KV writeは使わない。
- Cron重複排除はD1 `worker_leases`を正本とし、Worker全体の無制限ループは禁止する。

## 更新頻度

| データ | 反映目標 |
|---|---:|
| 通知 | 5分以内 |
| 投稿・管理画面の確定結果 | 即時（D1正本） |
| live API | CDN cache 5秒、stale 30秒 |
| 静的JSON | 通常1時間以内 |
| 開催中イベントのYouTube情報 | 対象優先、最短約1時間 |
| 通常作品のYouTube情報 | 24時間以上古いものから順次 |
| スコア | 変更後1時間以内を目標、全件は差分batchで循環 |

## 静的JSON target

| Target | Output |
|---|---|
| `top` | `top.json` |
| `list_recent` | `list/recent.json` |
| `list_popular` | `list/popular.json` |
| `events_index` | `events/index.json` |
| `event` | `events/{id}.json` |
| `video` | `videos/{id}.json` |
| `user` | `users/{id}.json` |
| `search_index` | `search-index-lite.json` |

Queue targetはcanonical値だけを受理する。旧別名や未知値は成功扱いにせず、有限retry後に`failed`として可視化する。

`content-jobs`は`system_settings.operation_mode`に従う。Cloudflare使用量はDashboardで確認し、`/admin/cost-guard`から手動でmodeを変更する。

| Mode | Queue behavior |
|---|---|
| `normal` | bounded件数を処理し、stale queueを有限件数だけ救済 |
| `economy` | 最大1件。`search_index` / `list_popular`はhigh priority以外skip |
| `read_only` | `event`、`video`、`user`のみ処理 |
| `static_only` | high priorityのみ処理 |
| `maintenance` | queue処理停止 |
