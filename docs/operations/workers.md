# Worker 運用

> Status: Active
> Last verified: 2026-07-25
> Verified against commit: `dc46eefa`
> Source of truth: `wrangler.toml`、`workers/*/wrangler.toml`、`scripts/cloudflare-*.mjs`、`/admin/workers`、`/admin/youtube-quota`

**AI:** Worker / Queue / Recovery Cron の運用正本。予算・メッセージ形は `src/lib/queues/wakeBudget.ts`。軽量は調査のみ。Queue flag・binding・Cron・quota 変更は上位。実 Cloudflare 操作は明示依頼時のみ。

Webは`flamenode-web`（OpenNext + Workers Static Assets）、背景処理は`flamenode-fast-jobs`、`flamenode-content-jobs`、`flamenode-sync-jobs`の3本とする。Git連携は`flamenode-web`のWorkers Buildsだけに置き、1回のBuildからcontent→fast→sync→web→smokeの順でdeployする。Cron Workerを個別にGit連携しない。

静的アセットは`run_worker_first = false`でWorkerより先に配信し、不要なWeb invocationを発生させない。Workers FreeのHTTP/Cron CPU上限は各invocation 10msで、Cloudflare公式も認証・SSR等を10〜20msになり得る処理としている。admin SSR（一覧クエリの相関サブクエリやヘッダ用X ID読取など）はFree 10msを超えやすいため、一覧は`LIMIT`付きの単純クエリへ寄せ、`public/logo.png`や`favicon.ico`など静的favicon/logoをWorkerへ落とさない。FreeでWebの安定動作を保証せず、実測で`exceededCpu`が継続する場合は最適化後も無理にFreeへ留めずPaidへ移行する。Cronは長時間jobを作らず固定batchへ分割する。

公式制限: https://developers.cloudflare.com/workers/platform/limits/

| Worker | Recovery Cron | Queue | 上限 |
| --- | --- | --- | --- |
| `fast-jobs` | 毎時0分 | `flamenode-notification-wake`（consumer/producer） | 通知最大6件、Discord外部request最大12件、DM cache KV書込最大2件。締切リマインダーはleaseで1時間間隔 |
| `content-jobs` | 毎時15分 | `flamenode-static-rebuild-wake` | Queue Consumer + Recovery。静的queue 1 target。cleanupはleaseで日次 |
| `sync-jobs` | 毎時7分・52分 | `flamenode-youtube-sync-wake` | metadata外部API最大8件、playlist専用実行最大12件（同一invocationでは両方を実行しない）、score最大150件 |

## Cloudflare Queues（wake ドアベル）

業務データは載せない。D1 が処理正本、Queue は「処理可能」を知らせるドアベルのみとする。メッセージ schema・free tier 予算の正本は `src/lib/queues/wakeBudget.ts`、feature flag 名は同ファイルの `QUEUE_FEATURE_FLAG_NAMES` を参照する。

| Queue | binding | DLQ | 用途 |
| --- | --- | --- | --- |
| `flamenode-notification-wake` | `NOTIFICATION_WAKE_QUEUE` | `flamenode-notification-dlq` | 通知 outbox の drain |
| `flamenode-static-rebuild-wake` | `STATIC_REBUILD_WAKE_QUEUE` | `flamenode-static-rebuild-dlq` | 静的 JSON 再生成 |
| `flamenode-youtube-sync-wake` | `YOUTUBE_SYNC_WAKE_QUEUE` | `flamenode-youtube-sync-dlq` | YouTube pending 同期 |

- `flamenode-web` は3 Queue すべてへ **producer** のみ持つ（`wrangler.toml`）。
- 各 Cron Worker は対応 Queue の **consumer**（`max_concurrency = 1`、`max_batch_timeout = 1`）と、継続 wake 用 **producer** を持つ。
- Consumer 設定: `max_batch_size = 10`、`max_retries = 3`。通知・静的は `retry_delay = 60`、YouTube は `retry_delay = 300`。
- Recovery Cron は Queue wake が届かなかった場合の安全網。通常運用では Queue 駆動を優先し、Cron は補助とする。`QUEUE_DISPATCH_ENABLED` / `QUEUE_CONTINUATION_ENABLED` が `"0"` のときも、Recovery は `processStaticRebuildQueue` を最大 `CONTENT_JOBS_RECOVERY_MAX_TARGETS`（3）回までループし、1 Cron あたり最大3 target まで排水する（`MAX_QUEUE_ITEMS_PER_RUN` は1のまま）。D1 statement は invocation 内で `D1_QUERY_SOFT_LIMIT`（40）に達したら早期停止し continuation wake を送る。これは invocation 内の D1 安全装置であり、`operation_mode` を自動変更しない（CostGuard 手動のみ。Guardrails §4-0）。

### Feature flags（デフォルト無効）

| 変数 | 意味 |
| --- | --- |
| `QUEUE_DISPATCH_ENABLED` | Web 等からの wake 送信 |
| `QUEUE_CONTINUATION_ENABLED` | Consumer invocation からの継続 wake |
| `QUEUE_YOUTUBE_SYNC_ENABLED` | YouTube sync wake の有効化 |

template は `"0"`。本番有効化手順は後述「Queue feature flags（本番有効化）」。

### Queue リソース作成（初回のみ）

実 Cloudflare 上で Queue を作成する。本番 deploy 前に以下を手動実行する（ID は Dashboard で確認）。

```sh
npx wrangler queues create flamenode-notification-wake
npx wrangler queues create flamenode-notification-dlq
npx wrangler queues create flamenode-static-rebuild-wake
npx wrangler queues create flamenode-static-rebuild-dlq
npx wrangler queues create flamenode-youtube-sync-wake
npx wrangler queues create flamenode-youtube-sync-dlq
```

binding 名・consumer 設定は tracked `wrangler.toml` / `workers/*/wrangler.toml` が正本。`npm run check:cloudflare-template` と production config 検証が欠落を fail-closed する。

### Free tier 予算（内部運用上限）

`QUEUE_FREE_TIER_BUDGET`（`wakeBudget.ts`）の要点:

- 全 Queue 合計の通常メッセージ目標: 2,000/day
- Queue operations（send+receive+ack）目標: 6,000/day、再試行・DLQ 用余裕: 4,000/day
- メッセージ上限 1,024 bytes、consumer 同時実行 1、継続 wake は invocation あたり最大 1 回

推計スクリプト: `npm run estimate:queue-budget`（`scripts/estimate-queue-budget.mjs`）。

job lockはD1の`worker_leases`、queue/outboxの取得はlease tokenと期限を使う。各Cronは固定上限、最大retry、dead-letterを守る。副作用endpointはPOST・Bearer・`WORKER_ADMIN_TOKEN`が揃わない限り拒否し、`/health`は副作用を持たない。

全4 Workerの`BUILD_COMMIT_SHA`は同一でなければならない。公開healthはservice名とcommitだけを安全に返し、secret、resource ID、ユーザーデータ、詳細exceptionを返さない。production deployはcommit SHA、remote secret名、binding、D1 schemaをfail-closedで検査し、途中失敗後のWorkerを続けてdeployしない。

## YouTube単一キー設定

`sync-jobs`へ登録するAPIキーは1つだけとする。

```sh
npx wrangler secret put YOUTUBE_API_KEY --config workers/sync-jobs/wrangler.toml
```

副キーは使用しない。以前`YOUTUBE_API_KEY_SECONDARY`を登録していた環境では、次でsecret自体も削除する。

```sh
npx wrangler secret delete YOUTUBE_API_KEY_SECONDARY --config workers/sync-jobs/wrangler.toml
```

Google Cloud Consoleの日次quotaが標準10,000以外の場合は、`workers/sync-jobs/wrangler.toml`の`YOUTUBE_DAILY_QUOTA_LIMIT`を同じ値へ更新する。FlameNodeは設定値の80%だけを使用可能予算とする。

## 日次quota予算

- 標準10,000 units/dayの場合、FlameNode上限は8,000 units/dayとする。
- quota日はYouTubeと同じ太平洋時間0時で切り替える。
- `external_api_quota_usage`へ`provider='youtube'`とquota日を複合主キーとして使用量を保存する。
- API実行前に最大再試行分まで原子的に予約する。D1 UPSERTの条件で上限超過する予約を拒否する。
- 実際に外部requestを行わなかった予約分だけ返却する。開始済みrequestは成功・失敗にかかわらず使用扱いとする。
- 日次予算を使い切った場合、同期は失敗扱いにせず次回quota日まで`skipped`として繰り越す。
- 20%の余裕は手動処理、Google側との計上差、将来の再生リスト同期などのために残す。
- 日次予算まで無意味にAPIを呼ぶ設計ではない。処理対象が存在する場合だけ最大80%まで利用する。
- YouTube quota 枯渇時の `skipped` / KV cooldown は外部 API 安全装置であり、CostGuard の `operation_mode` 自動遷移ではない。

## Worker外部呼び出し予算

- YouTube `videos.list`は1 requestへ最大50 IDをまとめる。
- 1 Cronで最大4 batch、200作品まで処理する。
- 各batchは初回1回と再試行1回までとし、外部requestは最大8件に固定する。
- API requestは逐次実行し、同時outgoing connectionを増やさない。
- Cloudflare Workers Freeの50 subrequestsに対して、metadata同期の外部APIは最大8件、playlist専用実行は最大12件だけ使用する。同一invocationで両方を実行しない。
- D1は候補抽出最大3 query、quota予約・返却、metadata最大20 write statements、score・lease等を含めても1 invocation 50 query未満に収める。
- metadataのbulk upsertは10件単位とし、10列×10行＝100 bindingsでD1の1 query上限へ合わせる。

無料枠と外部API上限に対する安全条件は以下とする。

- 静的JSON生成中のD1 queryは`withSerializedD1`で直列化する。多数のqueryを`Promise.all`で同時開始しない。
- YouTube quota系403を受けた場合はKVへ1時間cooldownを保存し、後続Cronの無駄な呼出しを止める。
- YouTube候補は`pending`、開催中期限、通常期限の最大3 queryへ分離し、`videos`全体を毎時 Cron で走査しない。
- YouTube APIのレスポンスは`fields`で必要なID・視聴数・公開状態・長さだけ取得する。
- Discordは固定rate値を仮定せず、`Retry-After`、`X-RateLimit-Remaining`、`X-RateLimit-Reset-After`、global/scope headersを解釈する。
- Discord 429は同一invocationで再試行せず、outboxの`next_attempt_at`へ反映する。global 429は別routeへの後続呼出しにも適用する。429 バックオフと KV cooldown は配送 runtime safety であり、`operation_mode` や停止機能リストを自動更新しない。
- Discordのglobal/route cooldownは匿名化キーでKVへ最大2件/runだけ保存し、別isolateにも共有する。読取は1 invocation内でキーごとに1回へ集約する。
- Discord DM channel IDはisolateへ全件、KVへ最大2件/run・48件/dayの範囲で30日cacheし、通常配送を2 requestから1 requestへ削減する。
- 401/403/404を同じ認証・宛先のまま繰り返さず、復旧不能なものはdead-letterへ移す。
- 外部画像proxyは同一キーの同時missを1 fetchへまとめ、ETag/304、negative cache、stale返却を使用する。
- metadata保存は10件単位のbulk upsertとする。
- YouTube metadataの`synced_at`は最後にpublic/unlistedとして正常取得した時刻。`failed`時の再同期期限は`updated_at`を使う。
- private / missing ではview_count・duration・公開時synced_atを上書きしない。適格性変更時と日次整合で`youtube_related_blocklist`を再生成する。
- スコアは1 SQLで最大150件更新し、作品ごとのUPDATE loopを禁止する。72時間以上未更新の公開作品は age-only で強制 refresh する（`SCORE_FORCE_REFRESH_SEC`）。
- score 更新後は `ranking-rebuild-enqueue` が `top` / `list_popular` / `recommend_core` を throttle 付きで enqueue する（開催中イベントあり 1h / なし 3h。KV `ranking:last-score-rebuild`）。
- 静的生成は1 invocationで1 targetだけ処理する。deploy 後の `BUILD_COMMIT_SHA` 変化時は Recovery Cron が共有 global target を high enqueue する（`static:last_generator_commit` で重複抑制）。
- JSON生成対象は必ずSQL側の`LIMIT`を持ち、無制限全件取得を行わない。
- 初回backlog処理中も通知を独立Workerで維持する。

YouTube metadata同期だけの理論最大は、sync-jobs 1回あたり通常4 units（全batchで1回再試行した場合は最大8 units）。残り予算は他のYouTube API処理と共有し、合計8,000 units/dayを超えない。

静的再生成queueのcanonical targetは`top`、`top_slot_stats`、`events_index`、`event_base`、`event_slots`、`event`、`video`、`user`、`users_index`、`list_recent`、`list_popular`、`search_index`、`recommend_core`、`recommend`、`rules`、`youtube_related_blocklist`、`random_video_pool`だけである。旧別名・未知値のruntime正規化やno-op成功処理は行わず、有限retry後に`failed`として運用画面へ残す。

`content-jobs`（json-generator）は Queue Consumer で wake 駆動し、Recovery Cron は1時間ごとに failed/expired 回復と pending 処理を行う。`src/lib/operationMode/policy.ts`の`STATIC_REBUILD_ITEMS_PER_RUN`と`workers/json-generator/queuePolicy.ts`の`MAX_QUEUE_ITEMS_PER_RUN`は同じ値（1）を正本とする。

`/admin/workers`はWorkerとqueueを集約し、`/admin/youtube-quota`は日次設定値、80%上限、推定使用量、残り予算を表示する。APIキー本体は管理画面やD1へ保存・表示しない。

## Discord 通知（DM + Forum Webhook）

利用者向け DM と運営 Forum 通知を分離する。outbox の `type` はどちらも既存のまま（Webhook は常に `discord_webhook`）。振り分けは payload の `webhook_target`（`account` / `event` / `system`）。

| 経路 | Secret / binding | 配送先 | 主な種別 |
| --- | --- | --- | --- |
| DM（Bot） | `DISCORD_BOT_TOKEN` | `user.discord_id` | welcome、X ID、作品/枠、締切、強制解放 |
| ACCOUNT Forum | `DISCORD_WEBHOOK_URL_FORUM_ACCOUNT` | アカウント系 Forum | 初回ログイン、X ID 申請/取消/承認/却下 |
| EVENT Forum | `DISCORD_WEBHOOK_URL_FORUM_EVENT` | イベント系 Forum | 枠確保、作品登録（枠/自由/未所属） |
| SYSTEM Forum | `DISCORD_WEBHOOK_URL_FORUM_SYSTEM` | システム系 Forum | DM 最終失敗 `@here` |
| Legacy Webhook | `DISCORD_WEBHOOK_URL` | 旧単一チャンネル | `webhook_target` 無しの pending 行のみ |

- outbox の `type=discord_webhook` だけが Webhook 経路。それ以外は Bot DM。
- Forum 投稿は Webhook 1 request（`thread_name` + `content`）。Bot で thread を別作成しない。
- Discord API へ送る JSON は allow-list のみ（`webhook_target` / `video_id` / `event_id` / `url` 等の内部メタは除去）。
- `webhook_target` 指定時に対応 Forum Secret が無い場合は配送失敗（他 Forum / DM へフォールバックしない）。
- `discord_recipient_missing` は永久失敗（無限再試行しない）。
- 最終失敗（`dead_letter`）時のみ SYSTEM Forum へ `@here` 通知。dedupe: `delivery_failed_alert:{outbox_id}`。再試行途中では送らない。`discord_webhook` 自体の dead_letter では再通知しない（再帰防止）。
- 文面テンプレート正本: `src/lib/notifications/templates/`。本番 Secret は `flamenode-fast-jobs` に設定する。

### Queue feature flags（本番有効化）

`QUEUE_DISPATCH_ENABLED` 等はデフォルト `"0"`。本番で通知 wake を有効化する場合は次を両方行う。

1. `flamenode-web` と各 Cron Worker の Runtime Variables を `"1"` にする（即時反映）
2. Workers Builds の Build Variables にも同名 `"1"` を登録する（次回 deploy で `"0"` に戻さない）

ロールバックは `"0"` へ戻すだけでよい。

各jobは1行の構造化ログへ`worker`、`job`、`run_id`、成否、処理・skip・失敗件数、duration、外部API呼出数、job本体が把握したD1変更行数、inline retry回数、quota停止、40桁commit SHAを記録する。quota理由は固定内部コードだけを許可し、ユーザーID、動画ID、Secret、外部レスポンス本文は常時ログへ出さない。

監視時は次を確認する。

- quota予算切れまたはquota cooldown中はYouTube同期が`skipped`になる。
- FlameNode台帳はアプリ内利用の推定値であり、Google Cloud Consoleの実quotaを正本として確認する。
- Discord rate limit時は通知が`pending`へ戻り、`next_attempt_at`以降に再処理される。
- CPU時間、`exceededCpu`、D1日次使用量はCloudflare Dashboardを正本とする。
- WebのSSR/Authと各CronのCPU時間をWorker別に確認し、4 Workerのcommit世代が一致することを確認する。

Cloudflare Dashboardで`exceededCpu`、D1 rows read/written、Worker requests、queue滞留を確認する。CronのCPU超過が継続する場合はYouTubeの1回batch数を4から下げる。WebのAuth/SSRまたはCronが10msを継続的に超える場合、Free枠で安定運用できるとは扱わずPaid移行を判断する。D1の現行料金・無料枠は https://developers.cloudflare.com/d1/platform/pricing/ を正本とし、数値をこの文書へ重複固定しない。
