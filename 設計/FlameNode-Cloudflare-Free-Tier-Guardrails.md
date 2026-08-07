# FlameNode Cloudflare 無料枠・課金抑制設計

> Status: Active
> Last verified: 2026-08-07

## 1. 目的

FlameNode を Cloudflare の無料枠を中心に運用し、従量課金が発生しにくい構成にする。Webは `flamenode-web`（OpenNext）と Workers Static Assets、デプロイは Workers Builds を現行正本とする。使用量は運用者が Cloudflare Dashboard で確認し、必要な場合に管理画面からサイト機能を段階的に制限・解除・一時許可する。

## 2. 前提となる Cloudflare 無料枠

2026-05-10 時点の Cloudflare 公式ドキュメントを基準にする。実装前には最新の公式値を再確認する。

| サービス | 無料枠・注意点 | FlameNodeでの扱い |
| :--- | :--- | :--- |
| Workers | Workers Free は 100,000 requests/day、CPU 10ms/invocation、Cron Triggers 5個/account。 | 動的処理を極力減らし、公開ページは静的生成・R2/KVキャッシュを優先する。 |
| Workers Static Assets | 静的アセットリクエストは無料・無制限扱い。`run_worker_first`を全体へ適用せず、公開アセットをWorker invocationなしで配信する。 | `_next/static`などビルド時に固定できるファイルを `.open-next/assets` から配信する。 |
| D1 | Free は rows read 5,000,000/day、rows written 100,000/day、storage 5GB total。 | フルスキャン禁止、インデックス必須、一覧は事前生成 JSON を優先する。 |
| Durable Objects | Free でも SQLite backend の Durable Objects を利用できる。Requests 100,000/day、Duration 13,000 GB-s/day、SQLite rows read 5,000,000/day、rows written 100,000/day が目安。 | 閲覧数の短期集約先に使う。ただし1再生ごとに Worker/DO request は消費するため、バースト時はサンプリングまたは停止する。 |
| R2 Standard | Free は storage 10GB-month、Class A 1,000,000/month、Class B 10,000,000/month、egress free。 | 動画本体は保存せず YouTube 埋め込み。R2 はアイコン画像、静的JSON、軽量エクスポートに限定する。 |
| Workers KV | Free は reads 100,000/day、writes/deletes/list 1,000/day、storage 1GB。 | 高頻度更新には使わず、Worker cursor・機能フラグ・軽量キャッシュに限定する。 |
| Queues | Free は 10,000 operations/day、メッセージ保持24時間。通常1メッセージの配送に write/read/delete の3操作がかかる。 | YouTube 同期や通知のキューに使う場合は1日約3,000件程度を安全圏にし、重い一括投入は避ける。 |

## 3. 基本方針

- **静的ファースト**: 公開閲覧導線は Workers Static Assets、R2 に書き出した JSON、HTTP Cache を優先し、Web Worker を呼ぶ回数を減らす。
- **D1を読ませすぎない**: 一覧、トップ、おすすめ、イベント作品一覧は定期生成された JSON を読む。D1 は投稿、編集、管理、検索の確定処理に絞る。
- **R2に置きすぎない**: YouTube 動画本体は保存しない。作品サムネイルも保存せず YouTube サムネイル URL を利用する。Cloudflare にアップロードする画像はアイコン画像のみとし、元ファイルは1ファイル8MBまでに制限する。
- **KVに書きすぎない**: KV は低頻度のフラグとキャッシュに限定する。アクセスログや詳細な分析は D1 に逐次書かず、サンプリングまたは集計済み保存にする。
- **Cronを絞る**: Cron は最大5個の無料枠を意識し、JSON生成、スコア更新、YouTube同期、クリーンアップを3本の統合 Workerへまとめる。
- **サードパーティ動画活用**: 動画再生は YouTube iframe を使い、FlameNode 側では再生開始イベントなど最小限の計測に留める。

## 3-1. 無料枠に収まりそうかの評価

現在の設計は「小〜中規模のコミュニティイベントを静的配信中心で運用する」前提なら無料枠に収まる可能性が高い。ただし、動画詳細ページの再生開始イベント、検索、管理画面の一括インポート、YouTube 同期、R2 の静的JSON/アイコン配信が増えると無料枠を超えやすい。

安全圏の目安は以下とする。アプリが使用量やしきい値を収集・判定するものではなく、運用者が Cloudflare Dashboard を確認するときの判断材料とする。

**§3-1 表の economy / read_only 列は、管理者が `/admin/cost-guard` で手動設定した mode の効果を記述する。** 使用量 collector や自動しきい値判定は存在せず、Cloudflare 使用量を理由に `operation_mode` が自動遷移することはない。Durable Object による閲覧数サンプリング（economy 時 50%、read_only 時停止）は設計意図であり、使用量収集 Worker から自動起動されるものではない。

| 指標 | 無料枠上の主なネック | 安全圏の運用目安 |
| :--- | :--- | :--- |
| 公開ページ閲覧 | Workers 100,000 requests/day | トップ、一覧、イベント詳細は静的アセットまたはR2 JSON配信に寄せ、Web Worker を呼ぶ閲覧を1日3万回未満に抑える。 |
| 動画再生開始イベント | Workers request と Durable Object request の両方を消費 | 通常時も6時間セッション重複排除を行い、`economy` では50%サンプリング、`read_only` では新規計測停止。 |
| D1 reads | 5,000,000 rows/day | 一覧・おすすめ・関連動画で D1 を直接集計しない。検索はインデックス必須、広範囲検索は `economy` で停止。 |
| D1 writes | 100,000 rows/day | 再生ごとの直接書き込みは禁止。投稿、編集、いいね、コメント、CSVを `read_only` で止める。 |
| Durable Objects | request 100,000/day、duration、SQLite rows | 集約オブジェクトを短時間で休眠可能にし、1再生1永続書き込みを避ける。未反映カウントは24時間だけ保持。 |
| KV writes | 1,000 writes/day | Worker cursorや低頻度フラグに限定し、閲覧ログや逐次カウントに使わない。 |
| R2 Class B | 10,000,000/month | 作品サムネイルは YouTube を使い、R2 はアイコンと静的JSONに限定。JSONはHTTP Cacheを長めにする。 |
| R2 storage | 10GB-month | Cloudflareにアップロードする画像はアイコンのみ、元ファイル8MB、保存前に250x250 WebPへ圧縮。 |
| Queues | 10,000 operations/day | 1メッセージ約3操作として、同期・通知キューは通常1日3,000件程度を上限目安にする。 |
| Cron | 5 triggers/account | JSON生成、スコア更新、YouTube同期、クリーンアップを3本の統合 Workerへまとめ、Cron数を増やさない。 |

無料枠で最も危ない順は、1. Workers requests、2. Durable Object requests、3. D1 rows written、4. KV writes、5. R2 Class B operations、6. Queues operations とする。D1 rows read はインデックスと静的JSONで抑えられるが、検索や管理画面の未制限一覧があると急増するため、全一覧に `limit` と cursor を必須にする。

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
| `economy` | 目安70%到達 | パーソナライズ推薦、詳細分析、即時スコア再計算、重い検索を抑制する。閲覧数計測は既定50%サンプリングにする。 |
| `read_only` | 目安85%到達 | 新規投稿、CSVインポート、アイコン画像アップロード、コメント投稿、チャプター/チャプターマーカー作成、いいね、ブックマーク、閲覧数イベントの新規書き込みを停止する。閲覧は継続する。管理者の機能別一時許可は厳密に15分で自動終了する。 |
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
- 閲覧数イベントの新規書き込み
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
- 詳細な内部閲覧数計測

Durable Object が危険水位に入った場合は即停止ではなく、閲覧数計測を10%サンプリングへ下げる（**管理者が economy mode を手動設定している場合の設計意図**）。`read_only` 以上では新規計測を止め、止めた閲覧数イベントは後から補完しない。サンプリング中の公開表示値は、通常時の推定に近づけるため補正値として表示する。

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
- admin spreadsheet import で `disabled_features_json` を更新する（cost-guard UI では編集しない）
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
- 内部閲覧数は `POST /api/videos/[id]/view` から D1 を直接更新しない。Durable Object を正の短期集約先として動画ID・時間帯単位でプールし、Cron Worker が1時間ごとに D1 へバルク反映する。KV 時間帯バケットは主経路にせず、緊急時のフォールバックに留める。どの方式でも1再生1書き込みは禁止する。未反映カウントは24時間保持し、反映できないまま期限を迎える場合は管理者通知と監査ログに残す。
- 内部閲覧数や推薦シグナルは全件保存せず、6時間セッション単位の重複排除とサンプリングを行う。`economy` 以上では既定50%サンプリングにし、`read_only` 以上では新規計測を書き込まない。`read_only` 中に止めた閲覧数イベントは後から補完しない。
- Cron は統合し、1回の処理で JSON 生成、古い一時ファイル削除をまとめる（使用量チェックや自動 mode 変更は含めない）。
- 月間の D1 読み書き、または Workers 要求が無料枠の80%を常に超える状態が2か月続いた場合、有料化または構成見直しの判断ラインにする。

## 10. 参照元

- Cloudflare Workers Limits: https://developers.cloudflare.com/workers/platform/limits/
- Cloudflare Workers Pricing: https://developers.cloudflare.com/workers/platform/pricing/
- Cloudflare Workers Static Assets Billing and limitations: https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/
- Cloudflare D1 Pricing: https://developers.cloudflare.com/d1/platform/pricing/
- Cloudflare Durable Objects Pricing: https://developers.cloudflare.com/durable-objects/platform/pricing/
- Cloudflare R2 Pricing: https://developers.cloudflare.com/r2/pricing/
- Cloudflare Workers KV Limits: https://developers.cloudflare.com/kv/platform/limits/
- Cloudflare Queues Pricing: https://developers.cloudflare.com/queues/platform/pricing/
