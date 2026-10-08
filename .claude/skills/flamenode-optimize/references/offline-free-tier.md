# Cloudflare無料枠: オフライン実装基準

確認日: **2026-10-04**。Skill改良時に公式資料を確認したsnapshot。通常のSkill実行では外部リンクを開かず、この資料と現行コード・設定・testを使う。
以下は将来も不変な契約値ではない。保存済みの新しい公式証拠があれば照合し、矛盾や不明点は記録する。資料更新を依頼されるまで外部検索を必須にせず、確認できる内部改善を進める。
対象アカウントの実plan・消費済み利用量は別情報。未取得をFree確認済み/使用量0と扱わない。

## A. Workers / CPU / memory

[公式Workers Limits](https://developers.cloudflare.com/workers/platform/limits/) のFree列とCPU/memory/subrequest節を確認。

| resource | 保存した基準 | 実装上の扱い |
| --- | --- | --- |
| HTTP CPU | 10 ms / invocation | I/O待ちを除く。wall timeと比較しない |
| Cron CPU | 10 ms / invocation（Free列） | Paidのinterval別30秒/15分CPUを流用しない |
| memory | 128 MB / isolate | 複数requestとglobal cacheが共有する予算 |
| Worker request | 100,000 / day、UTC日次reset | account全体で集計。超過は1102とは別の1027 |
| subrequest | 50 / invocation、内部serviceは1,000 | redirectも数える。D1固有の50 queries制限は別途適用 |
| 同時接続 | headers待ち最大6 / invocation | fetch、R2/KV等を含む。無制限Promise.allを避ける |
| startup | 1秒 | module初期化の重い処理を調べる |

Queue consumerは別handler。Queuesの一般説明にはCPU 30秒/default・最大5分があるがFree適用が明記されないため、これを無料枠で使えるCPU予算と断定しない。
plan/versionに対応する保存済み根拠がなければ `Queue CPUのFree適用値未確認` とする。Cron/Queueの15分wall timeをCPU予算へ読み替えない。
bundle/gzip・Static Assets等は現行repositoryのbudget check/config/build結果も確認する。旧資料の上限を根拠なく設定へ書き込まない。

## B. D1

[公式Pricing](https://developers.cloudflare.com/d1/platform/pricing/) / [Limits](https://developers.cloudflare.com/d1/platform/limits/)。

| resource | Free snapshot |
| --- | --- |
| rows_read | 5,000,000 / day |
| rows_written | 100,000 / day |
| storage | 合計5 GB / account、500 MB / database |
| query | 50 / Worker invocation |
| SQL/bind/row | SQL 100,000 bytes、bind 100個 / query、row/string/BLOB 2,000,000 bytes |

日次枠はUTC日次reset。read/write枠超過でqueryが失敗し、storage上限で追加write等が失敗し得る。
rows_readは走査量であり返却件数ではない。LIMITやSELECT列削減だけで走査量削減を主張しない。
indexはread削減とwrite/storage費用が交換になる。batchでも含まれるstatement数や各query制限は残る。
D1 metaでrows_read/rows_writtenを計測し、未取得を0として予算を通さない。

## C. R2

[公式Pricing](https://developers.cloudflare.com/r2/pricing/)。

| resource | 無料利用量snapshot |
| --- | --- |
| Standard storage | 10 GB-month / month |
| Class A | 1,000,000 operations / month |
| Class B | 10,000,000 operations / month |
| egress | 無料。操作数や他serviceの費用とは別 |

Standardの無料利用量。Infrequent Accessには適用されない。無料利用量を超えると課金され得るため、D1/KVのFree硬い停止上限と区別する。
Class AにはPUT/LISTやmultipart各操作、Class BにはGET/HEADが含まれる。DELETEは無料操作だがWorker CPU、D1 tracking、LIST費用は残る。
storageはGB-monthで評価し、object数とbytes、現行/処理中/旧世代を分ける。調査LISTもClass A。巨大prefixを毎iterationで再inventoryしない。

## D. KV

[公式Pricing](https://developers.cloudflare.com/kv/platform/pricing/) / [Limits](https://developers.cloudflare.com/kv/platform/limits/) / [Consistency](https://developers.cloudflare.com/kv/concepts/how-kv-works/)。

| resource | Free snapshot |
| --- | --- |
| read | 100,000 keys / day |
| write / delete | それぞれ1,000 keys / day |
| list | 1,000 requests / day |
| storage | 1 GB / account |
| 同一key write | 1 / second |
| key / metadata / value | 512 bytes / 1,024 bytes / 25 MiB |
| cacheTtl | 最小30秒（この確認日時点） |

日次枠はUTC日次reset。各操作の超過で同種の操作が失敗し得る。read/write/deleteはkey単位。bulk readの1 API callを1 key readと数えず、null/404のmissも操作に含める。
内部serviceのinvocation上限はbulk API call数と区別する。KVはeventual consistencyで、変更や新規keyは他地点へ60秒以上かかる場合がある。即時反映を保証しない。
強いlock/CAS、権限正本、即時公開停止の保証にKVを使わない。cacheTtl/expirationを延ばして鮮度契約を勝手に変えない。

## E. Queue / Cron

[公式Queues Pricing](https://developers.cloudflare.com/queues/platform/pricing/) / [Limits](https://developers.cloudflare.com/queues/platform/limits/)。

| resource | Free snapshot / 共通制限 |
| --- | --- |
| operations | 10,000 / day（Free） |
| message保持 | 24時間、変更不可（Free） |
| 課金単位 | 64 KBごとのwrite/read/delete。KBは1,000 bytes、内部metadata約100 bytesを加味 |
| message / batch | 128 KB（metadata込み）、consumer batch最大100 messages |
| wall time | consumer/Cron 15分。CPUとは別 |

小さいmessageの通常deliveryはwrite/read/deleteの約3 ops。batch化してもmessageごとの操作数は消えない。
retryは追加read、DLQ転送は追加writeを生み、DLQ consumerの処理も別途数える。再enqueue/follow-up/cleanup continuationも加算する。
既存のwake/DLQ/Recovery Cronを自動停止せず、no-op時の不要I/Oや重複enqueueを内部最適化する。

## F. 予算と改善前後の計算

```text
D1 read/day = Σ(シナリオ別request数 × rows_read/request) + rebuild + cron + cleanup + audit/診断
D1 write/day = mutation + queue state/lease + artifact tracking + audit + cleanup
R2 A/month = PUT + LIST + multipart等（正常・retry・GC・診断を含む）
R2 B/month = GET + HEAD（hit/miss/degraded/retryを分ける）
KV/day = read/write/deleteはkey数、LISTはrequest数を独立集計
Queue ops = write units + read units + delete units + DLQ/follow-up等
size units = ceil((payload bytes + metadata bytes) / 64,000)
許容実行回数 = floor((枠 - 他機能の消費 - 予約余裕) / 1回のresource消費)
```

入力には通常、cold/warm、cache hit/miss、最大件数/bytes、同時実行、障害/retryを使う。CPUは1 invocationの上限、memoryはisolateの共有上限であり、日次平均へならして適合判定しない。
予測にはデータ量・アクセス数・更新頻度・retry率を明記し、未取得値があれば無料枠適合を断定しない。accountを他アプリと共有する場合はその消費も残す。
per-requestを減らしてbackgroundやKV writeを増やした案は、全resource予算を更新して比較する。

## G. Error 1102の切り分けと完了条件

[公式Errors](https://developers.cloudflare.com/workers/observability/errors/) とWorkers LimitsのCPU/memory節を根拠にする。1102はCPUだけと決めつけず、outcome `exceededCpu` / `exceededMemory` で原因を確認する。
集計の `exceededResources` を1102やCPU超過の正確な件数へ変換しない。HTTP/Cron/Queue、Worker/version、route、期間、母数、samplingをそろえる。

- CPU: SSR/RSC、重複loader、全件sort/filter、JSON parse/stringify、hash/圧縮、regex、module初期化を対象pathでprofileする。
- memory: 全object buffering、配列/文字列の複製、無制限isolate cache、大きいJSONの同時処理、response cloneを調べる。
- I/O: D1/R2/KV待ちを含むwall timeをCPU時間と混同しない。sleep、timeout延長、waitUntilやQueue移動はCPU予算を増やさない。
- 計測: 利用可能なCPU p50/p95/p99/最大、memory情報とエラー率を前後比較する。ローカルの経過時間はCloudflare CPUの実測ではない。
- 完了: localで原因を修正した段階は `軽減策実装済み・本番未確認`。本番解消は許可されたdeploy versionで代表負荷・十分な期間/母数を観測して判断する。小さいsampleの0件だけで保証しない。

本番情報が使えないローカルLLMでも、再現test、操作数のfixture、local query plan、対象処理の相対benchmarkで実装を進められる。取得していない本番数値を生成しない。
