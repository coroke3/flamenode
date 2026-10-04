# FlameNode Cloudflare 無料枠・課金抑制設計

> Status: Active
> Last verified: 2026-10-04

## 1. 目的

FlameNode を Cloudflare の無料枠を中心に運用し、従量課金が発生しにくい構成にする。Webは `flamenode-web`（OpenNext）と Workers Static Assets、デプロイは Workers Builds を現行正本とする。使用量は運用者が Cloudflare Dashboard で確認し、必要な場合に管理画面からサイト機能を段階的に制限・解除・一時許可する。

## 2. 前提となる Cloudflare 無料枠

2026-10-04 に Cloudflare 公式値を再確認した。Free の値はプラットフォーム制限であり、FlameNode の内部目標とは区別する。

| サービス | 公式 Free 枠 | 期間・補足 |
| :--- | :--- | :--- |
| Workers | 100,000 requests、HTTP/Cron CPU 10ms/invocation、128MB memory、50 subrequests/request、Cron 5 triggers/account | request と CPU は別の制限。CPU超過はError 1102になり得る。 |
| Workers Static Assets | 静的アセット requests は無料・無制限 | `run_worker_first=false` で対象アセットは Worker を迂回する。 |
| D1 | rows read 5,000,000、rows written 100,000、5GB/account、500MB/database、50 queries/Worker invocation | rows は返却行でなく読み取り・書き込み対象行数。 |
| R2 Standard | 10GB-month、Class A 1,000,000、Class B 10,000,000、internet egress 無料 | すべて月次。`DeleteObject` 等はFree operations。Infrequent Accessはこの無料枠の対象外。 |
| Workers KV | reads 100,000、writes 1,000、deletes 1,000、list 1,000、storage 1GB | 操作は日次でUTC 00:00にリセット。存在しないkeyのreadも1 operation。 |
| Queues | 10,000 operations、retention 24時間 | 日次。各64KB chunkのwrite/read/deleteが各1 operation。retryはread、DLQ移送はwriteを追加。 |
| Workers Logs | 200,000 log events、retention 3日 | 日次。過剰なログを出さない。 |
| Durable Objects | FlameNodeの現行Worker設定にbindingなし | 現行FlameNode使用量は0として扱い、過去のDO閲覧数集約案を運用実績として扱わない。 |

出典: [Workers Limits](https://developers.cloudflare.com/workers/platform/limits/), [Workers Pricing](https://developers.cloudflare.com/workers/platform/pricing/), [Static Assets billing](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/), [D1 Pricing](https://developers.cloudflare.com/d1/platform/pricing/), [D1 Limits](https://developers.cloudflare.com/d1/platform/limits/), [R2 Pricing](https://developers.cloudflare.com/r2/pricing/), [KV Pricing](https://developers.cloudflare.com/kv/platform/pricing/), [Queues Pricing](https://developers.cloudflare.com/workers/platform/pricing/)。

## 3. 基本方針

- **静的ファースト**: 公開閲覧導線は Workers Static Assets、R2 に書き出した JSON、HTTP Cache を優先し、Web Worker を呼ぶ回数を減らす。
- **D1を読ませすぎない**: 一覧、トップ、おすすめ、イベント作品一覧は定期生成された JSON を読む。D1 は投稿、編集、管理、検索の確定処理に絞る。
- **R2に置きすぎない**: YouTube 動画本体は保存しない。作品サムネイルも保存せず YouTube サムネイル URL を利用する。Cloudflare にアップロードする画像はアイコン画像のみとし、元ファイルは1ファイル8MBまでに制限する。
- **KVに書きすぎない**: KV は低頻度のフラグとキャッシュに限定する。アクセスログや詳細な分析は D1 に逐次書かず、サンプリングまたは集計済み保存にする。
- **Cronを絞る**: Cron は最大5個の無料枠を意識し、JSON生成、スコア更新、YouTube同期、クリーンアップを3本の統合 Workerへまとめる。
- **サードパーティ動画活用**: 動画再生は YouTube iframe を使い、FlameNode 側では再生開始イベントなど最小限の計測に留める。

## 3-1. FlameNode 内部の安全目標

Cloudflare Dashboard のactual usageを運用者が確認する。アプリ内collector、自動しきい値判定、自動CostGuard遷移は作らない。**`economy` / `read_only`等は管理者が明示的に選ぶmodeであり、Cloudflare使用量を理由に自動変更しない。**

| 指標 | FlameNode内部目標（公式値ではない） |
| :--- | :--- |
| 日次quota | normalは概ね50〜60%以下、busy dayは70%前後以内を目標とし、残りをevent/deploy/failure用に残す。 |
| CPU | 代表route/jobごとにcold/warmを分けて測定し、p99は8ms以下、実測maxは10ms未満を採用ゲートとする。上限引き上げはしない。 |
| R2 monthly | 月次actual + 残日数予測でpressureを算出する。月次quotaを `quota / 30` のhard daily limitへ変換しない。 |
| Queue | 現行設計のnormal target 6,000 operations/day（60%）、retry/DLQ reserve 4,000（40%）を維持する。 |
| Cron | 現在4 triggers/account。5つ目の追加は既定で拒否し、既存Workerへの統合とCPU費用を先に検討する。 |
| Cache / artifact | CacheはCPU節約だけで評価せず、R2/KV operationとmemory retentionも一緒に測る。公開JSON isolate cacheは24件、serialized payloadの保守的なUTF-8 byte上界合計1MiB、単一128KiB、TTL 30秒で制限し、read/write時に期限切れをpruneする。unbounded cache、giant JSON、全artifact再生成はしない。 |

## 3-2. Free Tier Budget ledger（2026-10-04）

実測期間は**完了済みUTC日 2026-10-01〜10-03の3日間**。requests、D1、KV、Queue、Workers Logsは日次actual、R2 A/Bはbucket実測を起点に月末まで外挿した参考値、R2 storageは10-03時点のsnapshot。これらはCloudflare側の一時分析であり、アプリへのusage collector / 永続保存は行っていない。

| Resource | Free limit / period | Current actual | Projection / normalized pressure | Headroom / major consumers |
| :--- | :--- | :--- | :--- | :--- |
| Workers requests | 100,000/account/day | Account peak 4,573/day、FlameNode peak 4,459/day | 最近の最大日を据え置くと4.6% | 約95.4%。HTML/APIはWorker、`run_worker_first=false`対象の静的ファイルはWorkerを迂回。 |
| Worker CPU | 10ms/HTTPまたはCron invocation | Web Worker p50 19.3ms、p95 891.9ms、p99 1,267.7ms、max 2,010ms | p99 pressure 12,677%、max 20,100%。Free採用条件未達 | headroomなし。最優先risk。実測runtimeの`usageModel`は`standard`で、契約planがFreeである証明にはならない。 |
| Worker memory | 128MB/isolate | web p50 42.1MiB、p95 73.7MiB、p99 85.4MiB、max 93.4MiB | max 73.0% | max時約34.6MiB。CPU優先だが、大きなartifactやcacheを追加しない。 |
| Worker subrequests | 50/request | Web 11,026 invocation中1,573、平均0.143/invocation | 最大値/route別分布は取得できず、pressure未算定 | 平均値はhard-limit headroomを示さない。R2/KV/D1/HTTP fetchのper-request maxを未計測。 |
| D1 rows read | 5,000,000/account/day | `flamenode_db` peak 434,788/day | 最大日据え置き8.7% | 約91.3%。公開一覧・静的生成とYouTube同期候補選定がQuery Insights上位。 |
| D1 rows written | 100,000/account/day | `flamenode_db` peak 9,731/day | 最大日据え置き9.7% | 約90.3%。投稿/編集、queue/artifact tracking、sync metadata。 |
| D1 storage | 500MB/database、5GB/account | `flamenode_db` 50,585,600 bytes（約50.6MB） | DB単位約10.1% | 約449MB/database。残り3 DBは小容量。schema migrationなし。 |
| R2 Class A | 1,000,000/account/month | `flamenode-storage` peak 814/day、MTD 1,951 | MTD + 28日×3日平均 = 約20,160（約2.0%） | bucket計算上約98%。他bucket operationsを含むaccount-wide actualは未取得。 |
| R2 Class B | 10,000,000/account/month | `flamenode-storage` peak 7,962/day、MTD 18,939 | MTD + 28日×3日平均 = 約195,703（約2.0%） | bucket計算上約98%。他bucket operationsを含むaccount-wide actualは未取得。 |
| R2 Standard storage | 10GB-month/account | 10-03 snapshotで全account約1.39GB、FlameNode約1.34GB | snapshotが月内一定なら約13.9% | snapshot上約8.61GB。月間GB-month actualは日平均storageで別途確認。 |
| KV reads | 100,000/account/day | peak 5,251/day | 5.3% | 約94.7%。低頻度mode/cursor/cache用途。missもoperation。 |
| KV writes | 1,000/account/day | peak 168/day | 16.8% | 約83.2%。日次quotaでは現状もっとも高いKV圧力。per-request counter/writeは禁止。 |
| KV delete / list | 各1,000/account/day | peak delete 7/day、list 0/day | delete 0.7%、list 0% | headroom大。KV storage使用量は今回未取得。 |
| Queue operations | 10,000/account/day | peak 544/day across six queues | 5.4% | 約94.6%。2,000 normal messages ×3 ops=6,000、retry/DLQ reserve=4,000。 |
| Cron triggers | 5/account | 4 triggers（daily schedule countは計96 runs） | 80% of trigger slots | 1 trigger slot。CPU per Cron runは別計測が必要。 |
| Workers Logs | 200,000/account/day、3-day retention | account peak 6,471 events/day | 3.2% | 約96.8%。route/job詳細を増やしすぎず必要な範囲でsampling。 |
| Workers Static Assets | static requests free/unlimited | build output filesは静的assetsから配信 | quota pressureなし | `_next/static`等の固定ファイルに使用。Worker-firstへ戻さない。 |
| Durable Objects | FlameNode bindingなし | usageなし | 0 | 現行FlameNodeの実リソースとして計上しない。 |

R2 Class A/Bは3日だけのbucket実測からの短期外挿であり、月末予測の信頼性は低い。R2のfree quotaはaccount-wideだが他bucketのClass A/B使用量を含められていないので、表のheadroomはFlameNode bucketだけの参考値。KV storage・per-request subrequest max・Cron CPUも未計測として扱う。

Cloudflare Observabilityのweb CPUログでは`/entry`の1 raw-URL group（73 invocation）でp95 1,344ms / max 1,652ms、event-detailの1 raw-URL group（13 invocation）でp95 1,412msを観測した。IDを含むraw URLは保存・共有せず、これらのpXXは全IDを統合したroute-wide percentileではない。cold/warm分離も未取得。3日間のWorker outcomeにWeb `exceededResources` 587件、content-jobs 4件があるが、これは全件をError 1102と断定できる分類ではない。`exceededCpu` outcomeも観測されており、CPU limitを含むresource failureは実在する。

追加のread-only GraphQL測定（2026-10-03 01:30〜2026-10-04 01:30 UTC）では、`flamenode-web` に4,028 invocation、`exceededResources` 364（9.0%）、success 3,628、client-disconnected 36を観測。successのCPU p50/p95/p99は20.8 / 740.1 / 1,163.9ms。直近約5時間（2026-10-03 20:41〜2026-10-04 01:30 UTC）にも153 `exceededResources` / 868 invocationsを観測した。CPU制限超過ログは `/user/[id]`・動画詳細・`/list` など複数routeに分散し、単一routeだけを原因と断定できない。したがってFree CPU採用ゲートは未達で、本番反映・Free-ready判定を保留する。今回のrequest-local重複loader抑制は軽減仮説であり、反映後のcold/warm route別CPU再計測が必要。

## 3-3. D1 Query Insights（3日分の頻度×rows_read）

Cloudflare `d1QueriesAdaptiveGroups`でparameterを含まないSQL形状を集計した順位。Cloudflare billable daily analyticsは同じ3日でrows read 1,108,195 / rows written 24,711だった一方、Query Insightsの集計合計は1,327,072 / 18,582で一致しない。このためQuery Insightsは相対順位・候補抽出にだけ使い、quota pressureの分子にはbillable analyticsを使う。

| 順位 | SQL形状/担当 | rows_read / 3日 | 実行 / 3日 | 平均read / 実行 |
| :--- | :--- | ---: | ---: | ---: |
| 1 | 公開video projection/list生成（`workers/json-generator/rebuild.ts`の候補） | 340,319 | 135 | 2,521 |
| 2 | default YouTube sync eligibility（`workers/youtube-sync/index.ts`） | 269,356 | 100 | 2,694 |
| 3 | 公開video projectionの別SQL形状（同 generator query family） | 188,210 | 199 | 946 |
| 4 | active event YouTube sync eligibility（`workers/youtube-sync/index.ts`） | 152,590 | 88 | 1,734 |
| 5 | score update subquery（`workers/sync-jobs` / `workers/score-recalc`） | 65,237 | 43 | 1,517 |

順位1〜4が優先監査対象。今回、Remote D1や`EXPLAIN QUERY PLAN`は実行しておらず、schema/indexを変更していない。Read rowsは全体の8.7% peak/day、writes 9.7% peak/dayであるため、追加indexのwrite amplificationを正当化する具体的なquery-plan証拠が得られるまでindex追加は保留する。

## 3-4. Route/job cost model と失敗伝播

| route/job | Worker / D1 / R2 / KV / Queue model | 証拠と未計測 |
| :--- | :--- | :--- |
| `/`, `/list`, `/search` | 動的HTML/APIは1 HTTP requestごとに最大1 Worker invocation。固定assetsは0 invocation。公開JSONはCache/R2-first、正常hitではdegraded D1を呼ばない。 | page view単位のbrowser API追加分との相関は未取得。route別のR2 B/KV/D1をledgerから分離できない。 |
| `/event/[id]`, `/user/[id]`, `/{videoId}` | 1 HTML requestごとにWorker invocation。R2 static artifactがfreshならD1 fallbackなし。event detailのmetadata/page loaderを今回request内memoizeし、重複処理を避ける。 | icon/shardのR2 GET数、cold/warm CPU、route-wide pXXは未取得。 |
| `/entry` | dynamic/auth route。session/onboarding確認に加えてactive event/available slot/reserved slotをD1照会。 | CPU group p95がFree limitを大幅に超える。Free-readyとは判定しない。 |
| submit/edit/like/comment | mutationごとにWorker/D1 writes。Static rebuild targetはD1にcoalesceし、同一requestのqueue kind wakeは1回。1 mutationあたりtarget上限256、100-row bulk upsertなのでqueue登録は最大3 D1 statement。 | targetごとのgenerated artifact数、実PUT数、操作ごとのrows_writtenは未集計。 |
| Static rebuild | 1 invocationで1 target、D1 40 statements/25k rows-read soft budget、Queue continuation最大1 wake/invocation。hash一致artifactはR2 PUTをskip。 | 256 target mutationの全完了では最大256 delivery / 768 Queue opsの保守model（continuation enabled）。各targetのR2 PUT数は固定でない。 |
| deploy rebuild | generator hash unchangedならglobal enqueue/KV updateをskip。hash変更時はglobal 16 targets。 | object数/R2 PUT数はbuild内容に依存し、CIだけでは算出不可。 |
| YouTube sync / score update | `sync-jobs`にCron 2本（45分間隔）; Sync candidate queriesがQuery Insightsの上位。Queue consumerはbatch 10、concurrency 1、max_retries 3、DLQ設定。 | Cron CPU、jobごとのD1/R2/Queue日次内訳は未取得。 |
| notification | batch 10、concurrency 1、max_retries 3、DLQ。通常配送はsend/read/deleteの3 ops。 | 実運用のfailure率/DLQ移送数は未取得。 |

R2 public missのfailure pathは、Cache/R2 miss → visibility/public-target probe → public targetだけcooldown 300秒でtarget enqueue → mode許可時だけbounded D1 degraded fetch。event detail missの対象は`event_base`と`event_slots`の2 targetまで。missing/not-public random IDsはdegraded D1をskipし、KV circuit miss writeも行わない。これはfailure amplificationを抑える現行動作だが、burst時の実際のrequest/statement総数は未計測。

通常の公開miss loaderでは、このrequestが新しいcoalesced static-rebuild rowをinsertした場合にだけdegraded D1 payload fetchを許可する。active/cooldown/unknown probeは反復payload fetchをしない。static rebuild rowのprocessing leaseは16分とし、Cloudflare Queue/Cron invocationの15分上限より長くする。Queue consumerはstale rowをreconcileせず、Recovery Cronだけが期限切れを回復する。Recovery Cronと手動HTTP endpointは共通のrenewable `content-jobs` Cron leaseを使うため、手動処理中にRecoveryが同じrowを再claimしない。hard termination後の再処理はRecoveryまで遅れるが、現行Worker経路では旧処理と新処理が同一targetを同時publishしない。

Users index v2は `0, 1, 8, 9, 24, 25, 120, 121, 500` 件のscore/works/name各page列について、total・重複なし・欠落なし・generation一致をtestする。event base listも同じ件数で8件pageを横断し、順序とtotalを検証する。現行のuser/event pageはServer Componentのページ要求で取得するため、client-side progressive appendのrace/unmount状態は持たない。個別user profileのworks/collabsは別の静的artifact契約で最大120件（24件×5 artifact pages）に制限され、121件以上を全件表示する要件とは区別する。

## 3-5. Traffic scenario projection

| Scenario | Projection | 判定/残る根拠 |
| :--- | :--- | :--- |
| Normal day | 観測されたaccount Worker requestsは最大4,573/day、D1 read 434,788/day、write 9,731/day、KV write 168/day、Queue 544 ops/day。 | 日次quotaではheadroomがある。CPUは10ms基準を大幅超過し、Free plan steady stateの停止条件を満たさない。 |
| Event day | 4,573 requests/dayを5〜10倍とする単純stressで22,865〜45,730/day（22.9〜45.7%）。全D1 workloadまで10倍ならpeak read 4.35M/day（87%）となる仮定上限。 | 日次集計であり1-hour burstではない。D1を実際に何倍するか未測定。CPU超過が先にfailする。 |
| Deploy day | hash同一ならglobal rebuild enqueue 0。hash変更なら16 target。 | 3日actualからdeploy時R2 A/PUT/CPUを予測できない。Workers Buildsの順序/verify/smoke完了前にFree-readyと判定しない。 |
| Failure day | 2,000 normal messages + 150 messageが各3 retryのqueue推計は6,900 operations/day（69%）。max retry 3で無限再試行なし、失敗はDLQ/failed状態へ収束。 | 2 operation/retryはFlameNode保守モデル。Cloudflare実usageのDLQ/retry分布は未測定。4,000 operations reserveを下回るfailure countで運用する。 |
| Crawler burst | account daily requestsは直近最大4,573。random missing/unlisted IDではdegraded D1 fallbackとKV circuit writeをしない。 | 1-hour burst、R2/CPU/requests max、異常path率は不明。public miss/error load testを別に実施する。 |

## 4. 使用量ガードの段階

`system_settings.operation_mode` で現在の制限状態を管理する。使用量collectorや自動しきい値判定は持たず、管理者が理由を入力して手動変更する。

### 4-0. 自動 CostGuard 禁止（不変条件）

- FlameNode は Cloudflare 使用量を理由として `operation_mode` を**自動変更しない**。
- 無料枠使用量によるユーザー向け機能制限は、管理者の手動操作（`/admin/cost-guard`）のみ。
- D1 budget / YouTube API quota / Discord 429 バックオフ / ExternalRequestBudget / Queue batch 上限は**ランタイム安全装置**であり、機能制限（CostGuard）ではない。これらは `operation_mode` を書き換えない。
- `auto_cost_guard_enabled` / `cost_guard_thresholds_json` / `cost_usage_snapshots` は最終 schema に存在しない。新たな自動しきい値を発明しない。

| モード | 手動選択の運用目安 | 停止・制限する機能 |
| :--- | :--- | :--- |
| `normal` | 通常 | 全機能を通常運用する。 |
| `economy` | 目安70%到達 | パーソナライズ推薦、詳細分析、即時スコア再計算、重い検索を抑制する。閲覧イベントは現行実装でCloudflare Worker/D1へ書き込まないため、Free枠の抑制対象として数えない。 |
| `read_only` | 目安85%到達 | 新規投稿、CSVインポート、アイコン画像アップロード、コメント投稿、チャプター/チャプターマーカー作成、いいね、ブックマークを停止する。閲覧は継続する。現行のブラウザGAイベントは `operation_mode` で停止しない。管理者の機能別一時許可は厳密に15分で自動終了する。 |
| `static_only` | 目安95%到達 | Worker を必要とする公開動的機能を停止し、R2/Workers Static Assets の静的JSONと静的ページ中心に切り替える。 |
| `maintenance` | 管理者判断 | 管理者以外はメンテナンス画面を表示する。管理者は復旧操作のみ可能。通常モード変更とは別の専用操作で切り替える。 |

表の比率は運用判断の目安であり、DBにしきい値として保存せず、自動遷移にも使用しない。

制限する場合は、まず検索のフルスキャン系を止め、次に動的推薦、リアルタイムスコア再計算、YouTube同期を抑制する。Discord通知キューは運営対応に必要なため、YouTube同期キューより優先する。使用量を取得するアプリ内処理はなく、モードが自動遷移することはない。

## 5. モード別停止対象

### 5-1. 書き込み系

以下は課金・無料枠消費に直結しやすいため、`read_only` 以上で停止する。

- 新規投稿
- 作品編集
- コメント投稿
- 時間付きコメント投稿
- チャプター/チャプターマーカー作成・編集
- いいね、ブックマーク
- X ID 統合申請
- アイコン画像アップロード
- CSV インポート
- 旧形式エクスポートの再生成
- イベントスロット一括生成

### 5-2. 読み込み系

以下は `economy` 以上で軽量化する。

- おすすめ作品のリアルタイム計算
- 関連動画の複雑な再計算
- 検索の広範囲スキャン
- 管理ダッシュボードのリアルタイム統計
- YouTube API / OGP 同期
閲覧トラッカーの現行実装は、プレイヤー再生時間が可視状態で10秒を超え、ブラウザのlocalStorage cooldownを満たしたときにGAイベントを送る。これはブラウザ側の計測であり、FlameNodeのWorker/D1書込みやDurable Object集約ではない。`operation_mode`によるGAイベントのsampling・停止は実装されていないため、Cloudflareのresource guardrailとして扱わない。

## 6. データ設計

### 6-1. system_settings

コストガードは `system_settings` の次の列を正本とする。

- **operation_mode**: text DEFAULT `"normal"` (`normal`, `economy`, `read_only`, `static_only`, `maintenance`)
- **disabled_features_json**: text (JSON Array / 手動停止する機能)
- **cost_guard_reason**: text | null
- **cost_guard_updated_by_user_id**: text | null
- **cost_guard_updated_at**: integer | null
- **cost_guard_exception_until**: integer | null (管理者一時許可の終了時刻。設定時刻から厳密に15分)
- **cost_guard_exception_features_json**: text (JSON Array / 一時許可する機能)

`auto_cost_guard_enabled` と `cost_guard_thresholds_json` は最終schemaに存在しない。旧列fallbackや二重書き込みも行わない。

### 6-2. 使用量確認（D1スナップショットなし）

Cloudflare 使用量は Cloudflare Dashboard を運用者が確認する。アプリ内に実測collectorや信頼できる推定器がないため、`cost_usage_snapshots` テーブルは最終schemaに存在せず、KVにも使用量履歴を保存しない。

## 7. 管理画面

`/admin/cost-guard` に手動コストガードパネルを置く。

- 現在の `operation_mode`
- 現在の停止機能（表示のみ。編集は admin spreadsheet import）
- 前回の変更理由・変更者・変更時刻
- 手動モード変更
- 15分の機能別一時許可と明示解除
- 直近の監査ログ
- メンテナンス専用の移行・解除操作

管理者は以下を実行できる。

- `normal` へ戻す
- `economy` / `read_only` / `static_only` へ手動変更する
- 専用操作で `maintenance` へ移行・解除する
- `disabled_features_json`（停止機能リスト）を `/admin/cost-guard` で更新する（admin spreadsheet からは編集不可）
- 許可リスト内の機能を1〜8件選び、15分だけ一時的に許可する

モード変更、メンテナンス変更、一時許可、例外解除は理由入力と確認文字列を要求し、完全な before / after を監査ログへ残す。一時許可は設定時刻から厳密に15分で終了し、任意時間への変更や自動延長は行わない。

## 7-1. 記録と通知

- 自動遷移や自動Discord DMは行わない。
- 管理者による変更は監査ログへ記録し、`/admin/cost-guard` で確認できるようにする。
- Cloudflare 使用量の警告は Cloudflare 側の通知設定を利用し、FlameNodeのDBへ推定値を取り込まない。

## 7-2. 静的JSON生成頻度

- 通常時はトップ、一覧、イベント詳細、おすすめ、関連動画の静的 JSON を1時間ごとに生成する。
- イベント開催中、受付中、または公開直後のイベントは、対象イベントの JSON だけ5〜10分ごとに生成する。
- `static_only` では新規生成より既存 JSON 配信を優先し、生成処理自体が無料枠を圧迫する場合は停止する。
- R2 Class B が増えすぎた場合、ビルド時に固定できる公開ファイルは Workers Static Assets へ寄せる。更新されるJSONはR2のままHTTP Cacheと生成頻度を調整し、直近3世代だけを保持する。

## 8. ルート別の軽量化

| ルート | 無料枠対策 |
| :--- | :--- |
| `/` | R2 に書き出したトップ用 JSON を使用。D1 直接集計を避ける。 |
| `/list` | ページング済み JSON を優先する。汎用分類ラベル別インデックスは作らない。 |
| `/event/[id]` | イベント別作品一覧 JSON をR2へ事前生成する。 |
| `/[id]` | 作品詳細だけD1取得を許可。関連動画は事前計算キャッシュを優先する。 |
| `/search` | economy 以上では完全一致・前方一致のみ。広範囲検索は停止する。 |
| `/recommend` | economy 以上では静的おすすめ JSON のみ返す。 |
| `/dashboard/*` | read_only 以上では保存ボタンを無効化する。 |
| `/admin/import` | read_only 以上では実行不可。プレビューだけ許可するかは管理者設定に従う。 |

`static_only` 中もログインページと最小限のセッション検証は残す。`maintenance` 中はトップや各作品の事前生成済み静的HTML/JSONだけ閲覧可能にし、動的APIは管理者復旧操作を除いて止める。機能制限中バナーは全画面上部に目立つ形で表示する。

## 9. 実装時の注意

- D1 クエリはインデックス前提にし、`SELECT *` と未制限一覧取得を避ける。
- 一覧 API は必ず `limit` と `cursor` を持つ。
- Cloudflare にアップロードする画像はアイコン画像のみ。作品サムネイルは YouTube サムネイルを使う。
- 動画プレイヤーのチャプター点プレビュー用に、フレーム画像やプレビュー画像を Cloudflare/R2 に生成・保存しない。必要な場合でも YouTube 由来の低コスト手段に限定し、未対応時はテキストプレビューで代替する。
- アイコン画像はアップロード前にクライアント側で 250x250 WebP へ圧縮し、元ファイルが1ファイル8MBを超えたら拒否する。
- R2 のアイコン配信には `Cache-Control: public, max-age=86400, stale-while-revalidate=604800` を付与する。
- 古いアイコンは月次ワーカーで最大200KB程度の WebP へ圧縮し、上書き置換する。8MB上限は新規アップロード時の元ファイル制限として扱う。
- R2 の `ListObjects` は Class A 操作なので、一覧表示に使わない。必要な一覧はD1または事前生成JSONに持つ。
- KV の `list` と大量 write は避ける。
- KV書き込みが危険水位に入った場合、D1へ退避して二重に枯渇させるのではなく、即時ログや軽量フラグ更新をオンメモリまたは破棄へ切り替える。
- 現行の閲覧トラッカーは `VideoViewTracker` からGAへイベントを送るブラウザ計測であり、`POST /api/videos/[id]/view`、Durable Object集約、CronからのD1反映は存在しない。新たな内部view counterを追加する場合は、Worker/D1/Queueの計測・quota budget・重複排除・失敗時の挙動を別途設計し、1再生1 D1 writeを避ける。
- `VideoViewTracker` は可視状態での再生時間10秒、ブラウザlocalStorageの動画単位6時間cooldownを使う。これはGA計測のブラウザ側重複抑制で、Cloudflare resource guardrailや `operation_mode` によるsampling/停止ではない。
- Cron は統合し、1回の処理で JSON 生成、古い一時ファイル削除をまとめる（使用量チェックや自動 mode 変更は含めない）。
- 月間の D1 読み書き、または Workers 要求が無料枠の80%を常に超える状態が2か月続いた場合、有料化または構成見直しの判断ラインにする。

## 10. 参照元

- Cloudflare Workers Limits: https://developers.cloudflare.com/workers/platform/limits/
- Cloudflare Workers Pricing: https://developers.cloudflare.com/workers/platform/pricing/
- Cloudflare Workers Static Assets Billing and limitations: https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/
- Cloudflare D1 Pricing: https://developers.cloudflare.com/d1/platform/pricing/
- Cloudflare R2 Pricing: https://developers.cloudflare.com/r2/pricing/
- Cloudflare Workers KV Limits: https://developers.cloudflare.com/kv/platform/limits/
- Cloudflare Queues Pricing: https://developers.cloudflare.com/queues/platform/pricing/
- Cloudflare Cron Triggers: https://developers.cloudflare.com/workers/configuration/cron-triggers/
