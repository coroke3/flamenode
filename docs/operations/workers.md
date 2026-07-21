# Worker 運用

> Status: Active
> Last verified: 2026-07-21
> Verified against commit: `47e6cee`
> Source of truth: `wrangler.toml`、`workers/*/wrangler.toml`、`scripts/cloudflare-*.mjs`、`/admin/workers`、`/admin/youtube-quota`

Webは`flamenode-web`（OpenNext + Workers Static Assets）、背景処理は`flamenode-fast-jobs`、`flamenode-content-jobs`、`flamenode-sync-jobs`の3本とする。Git連携は`flamenode-web`のWorkers Buildsだけに置き、1回のBuildからWeb→fast→content→sync→smokeの順でdeployする。Cron Workerを個別にGit連携しない。

静的アセットは`run_worker_first = false`でWorkerより先に配信し、不要なWeb invocationを発生させない。Workers FreeのHTTP/Cron CPU上限は各invocation 10msで、Cloudflare公式も認証・SSR等を10〜20msになり得る処理としている。FreeでWebの安定動作を保証せず、実測で`exceededCpu`が継続する場合は最適化後も無理にFreeへ留めずPaidへ移行する。Cronは長時間jobを作らず固定batchへ分割する。

公式制限: https://developers.cloudflare.com/workers/platform/limits/

| Worker | Cron | 上限 |
| --- | --- | --- |
| `fast-jobs` | 5分 | 通知最大6件、Discord外部request最大12件、DM cache KV書込最大2件。締切リマインダーはleaseで1時間間隔 |
| `content-jobs` | 15分 | 静的queue 1 target。cleanupはleaseで1時間間隔 |
| `sync-jobs` | 15分（7/22/37/52分） | metadata外部API最大8件、playlist専用実行最大12件（同一invocationでは両方を実行しない）、score最大150件 |

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
- YouTube候補は`pending`、開催中期限、通常期限の最大3 queryへ分離し、`videos`全体を15分ごとに走査しない。
- YouTube APIのレスポンスは`fields`で必要なID・視聴数・公開状態・長さだけ取得する。
- Discordは固定rate値を仮定せず、`Retry-After`、`X-RateLimit-Remaining`、`X-RateLimit-Reset-After`、global/scope headersを解釈する。
- Discord 429は同一invocationで再試行せず、outboxの`next_attempt_at`へ反映する。global 429は別routeへの後続呼出しにも適用する。
- Discordのglobal/route cooldownは匿名化キーでKVへ最大2件/runだけ保存し、別isolateにも共有する。読取は1 invocation内でキーごとに1回へ集約する。
- Discord DM channel IDはisolateへ全件、KVへ最大2件/run・576件/dayの範囲で30日cacheし、通常配送を2 requestから1 requestへ削減する。
- 401/403/404を同じ認証・宛先のまま繰り返さず、復旧不能なものはdead-letterへ移す。
- 外部画像proxyは同一キーの同時missを1 fetchへまとめ、ETag/304、negative cache、stale返却を使用する。
- metadata保存は10件単位のbulk upsertとする。
- スコアは1 SQLで最大150件更新し、作品ごとのUPDATE loopを禁止する。
- 静的生成は1 invocationで1 targetだけ処理する。
- JSON生成対象は必ずSQL側の`LIMIT`を持ち、無制限全件取得を行わない。
- 初回backlog処理中も通知を独立Workerで維持する。

YouTube metadata同期だけの理論最大は、15分ごとに通常4 unitsとして384 units/day、全batchで1回再試行した場合でも768 units/dayである。残り予算は他のYouTube API処理と共有し、合計8,000 units/dayを超えない。

静的再生成queueのcanonical targetは`top`、`events_index`、`event`、`video`、`user`、`list_recent`、`list_popular`、`search_index`だけである。旧別名・未知値のruntime正規化やno-op成功処理は行わず、有限retry後に`failed`として運用画面へ残す。

`/admin/workers`はWorkerとqueueを集約し、`/admin/youtube-quota`は日次設定値、80%上限、推定使用量、残り予算を表示する。APIキー本体は管理画面やD1へ保存・表示しない。

各jobは1行の構造化ログへ`worker`、`job`、`run_id`、成否、処理・skip・失敗件数、duration、外部API呼出数、job本体が把握したD1変更行数、inline retry回数、quota停止、40桁commit SHAを記録する。quota理由は固定内部コードだけを許可し、ユーザーID、動画ID、Secret、外部レスポンス本文は常時ログへ出さない。

監視時は次を確認する。

- quota予算切れまたはquota cooldown中はYouTube同期が`skipped`になる。
- FlameNode台帳はアプリ内利用の推定値であり、Google Cloud Consoleの実quotaを正本として確認する。
- Discord rate limit時は通知が`pending`へ戻り、`next_attempt_at`以降に再処理される。
- CPU時間、`exceededCpu`、D1日次使用量はCloudflare Dashboardを正本とする。
- WebのSSR/Authと各CronのCPU時間をWorker別に確認し、4 Workerのcommit世代が一致することを確認する。

Cloudflare Dashboardで`exceededCpu`、D1 rows read/written、Worker requests、queue滞留を確認する。CronのCPU超過が継続する場合はYouTubeの1回batch数を4から下げる。WebのAuth/SSRまたはCronが10msを継続的に超える場合、Free枠で安定運用できるとは扱わずPaid移行を判断する。D1の現行料金・無料枠は https://developers.cloudflare.com/d1/platform/pricing/ を正本とし、数値をこの文書へ重複固定しない。
