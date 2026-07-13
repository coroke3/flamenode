# Worker 運用

> Status: Active
> Last verified: 2026-07-13
> Source of truth: `workers/background-jobs`

Deploy対象は`flamenode-background-jobs` 1本だけです。同一Workerに`*/5 * * * *`と`0 * * * *`の2 Cronを設定し、`ScheduledEvent.cron`でレーンを分けます。job lockはD1の`worker_leases`、queue/outboxの取得はlease tokenと期限を使います。

## 5分レーン

- Discord通知: 毎回最大6件。
- 締切リマインダー生成: 毎時最大3件。
- 新規・開催中YouTube同期: UTCの5、15、25、35、45、55分に最大50件。上限300件/時。
- 通常YouTube同期の滞留解消: UTCの20、40分に最大50件。1時間レーンと合わせて上限150件/時。
- 高優先度静的JSON: UTCの10、30、50分に最大1件。通知の送信・失敗が4件以上あった実行では見送る。

各5分invocationではYouTube API系列または静的再生成の片方だけを動かします。YouTube APIは最大50 IDを1リクエストへまとめ、失敗時を含めても最大3回の外部requestに固定します。開催中判定は公開イベントかつ`start_time`到来済みを必須とし、時刻未設定の常設イベントを高速同期対象にしません。

## 1時間レーン

- 通常YouTube同期: 期限到来順に最大50件、API 1系列、D1集合UPSERT 1回。
- スコア: dirtyまたは7日以上未検証の公開作品を最大200件、集合UPDATE 1回。
- 通常静的JSON: 最大1件。6時間ごとのcleanup時刻は実行しない。
- cleanup: 6時間ごと。通知・監査ログ等を既存の小分け上限で処理。

YouTubeの次回同期間隔は、開催中・公開後24時間を1時間、7日以内を6時間、30日以内を24時間、180日以内を3日、それより古い作品を30日とします。新規・ID変更は常に最優先です。これにより、アクティブ作品の更新を優先しながら、長期保管作品のD1書込みとYouTube quotaを抑えます。

Worker全体を1つのleaseで塞がず、通知、静的生成、YouTube同期、スコア、cleanupごとにleaseを分離します。各ジョブは固定上限、最大retry、dead-letterを守ります。副作用endpointはPOST・Bearer・`WORKER_ADMIN_TOKEN`が揃わない限り拒否し、`/health`は副作用を持ちません。

静的再生成queueのcanonical targetは`top`、`events_index`、`event`、`video`、`user`、`list_recent`、`list_popular`、`search_index`だけです。旧別名・未知値のruntime正規化やno-op成功処理は行わず、有限retry後に`failed`として運用画面へ残します。

## Deploy順

1. D1 backupを取得する。
2. `0040_free_tier_background_jobs.sql`までmigrationを適用する。
3. `npm run workers:deploy:verified`で新Workerを先にdeployする。この時点では旧3 Workerを残す。
4. 新Workerへ`DISCORD_BOT_TOKEN`、`YOUTUBE_API_KEY`、`WORKER_ADMIN_TOKEN`を`wrangler secret put`で設定する。
5. `BACKGROUND_JOBS_URL`を指定してsmoke testを行い、通知・YouTube・静的生成のjob logを確認する。
6. 問題がないことを確認してから`DELETE_LEGACY_WORKERS=1 npm run workers:deploy:verified`を実行し、旧3 Workerを削除する。
