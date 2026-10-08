# 外部検索なしで使う実装・共通化パターン

同じ保証を保つ局所変更を行うための手引き。codeは例をそのまま増殖させず、対象pathの既存helperとtestを優先する。
file名は2026-10-04のcheckoutで存在を確認した入口。移動していたら該当directoryだけをローカル検索する。すべてを一括読込しない。

## A. 対象fileとtestを絞る

| 問題 | 読む候補（repository相対path） |
| --- | --- |
| 公開読取、cache miss、degraded fallback | `src/lib/publicData/loader.ts`、`degradedPolicy.ts`、同directoryの関連test |
| D1 statement/rows予算 | `workers/shared/d1Budget.ts`、`d1Budget.test.mjs` |
| KV mirror | `src/lib/operationMode/kvMirror.ts`、同directoryの関連test |
| Queue claim/retry/lease | `workers/json-generator/queue.ts`、`queue.test.mjs` |
| 共有sourceとranking生成 | `workers/json-generator/optimizedRebuild.ts`、`optimizedRebuild.contract.test.mjs` |
| users v2の世代/manifest/GC | `workers/json-generator/usersIndexV2Artifacts.ts`、`usersIndexV2Artifacts.test.mjs` |
| wake budget | `src/lib/queues/wakeBudget.ts`、同directoryの関連test |
| Queue予算の既存計算 | `scripts/estimate-queue-budget.mjs`（`npm run estimate:queue-budget`） |

Windowsでは `npm.cmd` を使う。たとえば対象がpublic loaderなら以下のように絞る。

```powershell
git status --short
git diff -- src/lib/publicData/loader.ts
rg --files src/lib/publicData
rg -n 'loadPublic|cache|fallback' src/lib/publicData/loader.ts
```

full sourceや全docsを先に集めない。参照を追うときだけcallerへ進み、問題条件→1つの実装→関連testの順に読む。
未参照削除の確認はidentifierをapp/src/workers/scripts/config等へ検索し、dynamic import、route/framework export、文字列参照、公開exportも確かめる。testだけの利用も保証の検証なら即削除しない。

## B. D1: query countと走査量を別々に削減する

1. 同じschema/dataの既存local fixtureでSQLと `EXPLAIN QUERY PLAN` を実行する。Remote D1は明示指示がない限り使わない。
2. N+1を集合queryや既存batchへ置き換え、projection・cursor・適切な条件/indexを検討する。戻り順、重複、null、権限範囲を維持する。
3. unchanged UPDATEを条件付きにする際はaudit・updated_at・retry token等、必要なwriteを省略しない。
4. 新indexはread削減とwrite/storageを比較する。必要な新migrationとして扱い、適用済みSQLを編集しない。

D1の `first()` はmetaを返さず、SQLにLIMITを自動追加もしない。計測には同じstatementを `all()` で1回だけ実行してmetaと最初のrowを使う。既存 `withD1Budget()` を優先する。

```typescript
const result = await statement.all<Row>(); // statementは既存budgetの対象
const row = result.results[0] ?? null;
// result.meta.rows_read / rows_writtenを利用する。
// meta欠損を0で計測成功とせず、first()との二重実行をしない。
```

batchのround trip削減とquery/rows削減は異なる。既存budgetでstatementを実行前に予約し、metaを失うraw/exec/session等の迂回を復活させない。
大きいIN集合はbind上限を守り、既存JSON1等を検討するが、JSON走査/parse CPUも予算に入れる。

## C. R2/KV: writeを省くための余分なreadを増やさない

- 同じrequestのR2 objectは可能なら1回read/parseし、同じpublic projectionをcallerへ共有する。認証/tenant/visibilityが異なる結果は共用しない。
- 内容hashやsource versionが既にある場合は既存dedupeを利用する。単純にPUTの前へHEAD/GETを追加するとCPU/Class Bが増えるので、変更率とbytesで比較する。
- PUTを省略しても、生成成功を示すD1 trackingや必要な鮮度記録を省略しない。保証が違うdedupe helperを無理に統合しない。
- KV mirrorは、既知の変更/version情報から不要writeを減らす。全requestで比較用GETを増やさない。source更新・miss・stale・write failureを検証する。
- TTL、cacheTtl、同期間隔を変えて鮮度を落とす案は機能提案。cache追加はkey/bytes/TTL/evictionと共有範囲まで実装・予算化する。

世代artifactは必要objectとtrackingを整えてからmanifestを最後に公開する。固定keyへの複数PUTをatomic publishと見なさない。
部分失敗では旧manifestの参照先、current/in-progress/retry世代を壊さない。成功済み未tracking objectの回収、曖昧なPUT成功、manifest公開後のcleanupを既存の失敗testで確かめる。
GCのpagination/cursor/継続上限は現在のcodeから選び、manifest状態が不明なら削除の安全を断定しない。

## D. CPU/memory: 再計算と同時bufferを減らす

- metadata/pageで同じloaderを呼ぶ場合は、入力・権限境界が一致するrequest内共有を使う。global cacheと混同しない。
- 全件sort→sliceを複数回行う箇所は同じordering/keyの計算を共有する。top-kや差分生成を使うなら同点/順序/最大件数を維持する。
- projectionに不要な巨大列を読まず、JSON parse/stringifyやTextEncoder/hashの重複を避ける。hash dedupeのCPUと削減するPUT数を同時評価する。
- streamingが可能なら全bodyのbufferを避ける。stream/bodyは原則1回消費し、不要clone/配列spreadの複製を減らす。
- 大きい独立I/Oは現在の接続・memory・statement予算内のbounded並列度にする。for-ofによる逐次処理も候補。Promise.all化は操作総量やCPU仕事量を減らさない。
- 1 invocationを分割するなら未処理分の継続、CAS/lease、retry、Queue ops上限まで設計する。処理件数上限で残りを捨てたり永久再enqueueしたりしない。

依存を追加した巨大framework、無制限memoize、Paid用cpu_msで1102を隠す案は採用しない。既存runtimeだけで局所profile/benchmarkし、local timingは本番CPUと分ける。

## E. 共通化とコード整理の判断

| 候補 | 判断基準 |
| --- | --- |
| 同一処理の重複 | 入出力・副作用・失敗/権限が一致する共通部分を1つへ抽出する |
| 共通component/helper | 複数callerの実需、安定した責務、明確な引数がある。既存の適切なものを再利用する |
| 1 callerのwrapper | 業務の意味や境界を表さず、単なる型/値移送ならinlineを検討する |
| 別業務に似たcode | owner/visibility/audit/transaction/rollback等が違うなら別実装を維持する |
| dead code | static/dynamic/framework/config/export/testの参照と保証を確認できたものだけ削除する |

まずpureなprojection/validationや同じ手順の共通部分を抽出し、caller固有の認証・transaction・error mappingはcaller側に残す。
追加optionやconditionalが増えるだけなら共通化しない。巨大BaseComponent、万能repository、plugin機構、多層wrapperを目的化しない。
変更は意味のある責務ごとに小さく行い、API/SQL/DTO/エラー型を暗黙に変えない。duplicate validationでもtrust boundaryが異なる場合は保持する。
行数に加えて、重複実行数、I/O、runtime bytes/CPU、分岐と修正箇所を比較する。LOCは結果の補助値としてのみ記録する。

## F. UX改善を伴うフロント変更

着手前に「どの操作で何が不便か」と期待する改善を1文にする。
例: 二重送信、表示済みlogin状態のちらつき、loading不明、error後の操作不能、keyboard操作の不一致。
その問題に関係するcomponent/hookのみを変更し、同じ操作を共通化することで不一致を直す。見た目が似た画面全体の統合は行わない。
利用者への情報、入力項目、権限、submit/audit、副作用、公開APIは維持する。
変更前後の操作を対象test/再現手順で比較し、loading/error/empty、keyboard/focus、必要なviewportで確認する。環境がなければ未確認と記録し、架空のbrowser検証を報告しない。
UX効果を説明できないフロント整理やcomponent化は候補提示に留める。

## G. 最小限の検証と引継ぎ

- Markdownのみ: `npm.cmd run check:docs`、`npm.cmd run check:project-docs`。
- 通常code: `npm.cmd run typecheck`、`npm.cmd run lint`、関連test。
- Worker: 関連Workers testとbudget/duplicate/retry/failureの検証。
- DB/権限/API: 関連固有check、integration、local SQL実行と必要なcontract検証。
- 節目: `npm.cmd run verify:fast`。releaseや広い影響では必要な `verify:full` 等。

正確なscript名は必要な分だけpackage.jsonで確認する。既存testを維持し、修正の失敗条件やresource操作数が確認できるtestを選ぶ。
textや実装の形だけを追うtest、無条件full suite連打、新しいtest基盤の追加は避ける。
local D1 path未解決などの環境失敗は設定/既存fixtureで解決し、Remote migrationへ切り替えない。依存不足を推測で最新package導入に置き換えない。
metricsや環境がない場合でも実装と検証可能な範囲を進め、未実施のCI/deploy/本番改善はLOOP STATEに区別して残す。
