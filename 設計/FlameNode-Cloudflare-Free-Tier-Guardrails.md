# FlameNode Cloudflare 無料枠・課金抑制設計

## 1. 目的

FlameNode を Cloudflare の無料枠を中心に運用し、従量課金が発生しにくい構成にする。使用量が危険水位に近づいた場合は、サイト機能を段階的に自動停止し、管理者が手動で停止・解除・一時許可できるようにする。

## 2. 前提となる Cloudflare 無料枠

2026-05-10 時点の Cloudflare 公式ドキュメントを基準にする。実装前には最新の公式値を再確認する。

| サービス | 無料枠・注意点 | FlameNodeでの扱い |
| :--- | :--- | :--- |
| Workers / Pages Functions | Workers Free は 100,000 requests/day、CPU 10ms/invocation、Cron Triggers 5個/account。Pages Functions も Workers 枠を消費する。 | 動的処理を極力減らし、公開ページは静的生成・R2/KVキャッシュを優先する。 |
| Pages Static Assets | 静的アセットリクエストは無料・無制限扱い。Functions を呼ばないルートに寄せる。 | トップ、一覧、イベント詳細、静的JSONは可能な限り静的配信にする。 |
| D1 | Free は rows read 5,000,000/day、rows written 100,000/day、storage 5GB total。 | フルスキャン禁止、インデックス必須、一覧は事前生成 JSON を優先する。 |
| Durable Objects | Free でも SQLite backend の Durable Objects を利用できる。Requests 100,000/day、Duration 13,000 GB-s/day、SQLite rows read 5,000,000/day、rows written 100,000/day が目安。 | 閲覧数の短期集約先に使う。ただし1再生ごとに Worker/DO request は消費するため、バースト時はサンプリングまたは停止する。 |
| R2 Standard | Free は storage 10GB-month、Class A 1,000,000/month、Class B 10,000,000/month、egress free。 | 動画本体は保存せず YouTube 埋め込み。R2 はアイコン画像、静的JSON、軽量エクスポートに限定する。 |
| Workers KV | Free は reads 100,000/day、writes/deletes/list 1,000/day、storage 1GB。 | 高頻度更新には使わず、機能フラグ・軽量キャッシュ・ガード状態の保存に限定する。 |
| Queues | Free は 10,000 operations/day、メッセージ保持24時間。通常1メッセージの配送に write/read/delete の3操作がかかる。 | YouTube 同期や通知のキューに使う場合は1日約3,000件程度を安全圏にし、重い一括投入は避ける。 |

## 3. 基本方針

- **静的ファースト**: 公開閲覧導線は Pages Static Assets、R2 に書き出した JSON、HTTP Cache を優先し、Functions を呼ぶ回数を減らす。
- **D1を読ませすぎない**: 一覧、トップ、おすすめ、イベント作品一覧は定期生成された JSON を読む。D1 は投稿、編集、管理、検索の確定処理に絞る。
- **R2に置きすぎない**: YouTube 動画本体は保存しない。作品サムネイルも保存せず YouTube サムネイル URL を利用する。Cloudflare にアップロードする画像はアイコン画像のみとし、元ファイルは1ファイル8MBまでに制限する。
- **KVに書きすぎない**: KV は低頻度のフラグとキャッシュに限定する。アクセスログや詳細な分析は D1 に逐次書かず、サンプリングまたは集計済み保存にする。
- **Cronを絞る**: Cron は最大5個の無料枠を意識し、JSON生成、スコア更新、使用量監視、クリーンアップを可能な限り統合する。
- **サードパーティ動画活用**: 動画再生は YouTube iframe を使い、FlameNode 側では再生開始イベントなど最小限の計測に留める。

## 3-1. 無料枠に収まりそうかの評価

現在の設計は「小〜中規模のコミュニティイベントを静的配信中心で運用する」前提なら無料枠に収まる可能性が高い。ただし、動画詳細ページの再生開始イベント、検索、管理画面の一括インポート、YouTube 同期、R2 の静的JSON/アイコン配信が増えると無料枠を超えやすい。

安全圏の目安は以下とする。固定値ではなく、管理画面のコストガードしきい値で調整できる。

| 指標 | 無料枠上の主なネック | 安全圏の運用目安 |
| :--- | :--- | :--- |
| 公開ページ閲覧 | Workers/Pages Functions 100,000 requests/day | トップ、一覧、イベント詳細は静的アセットまたはR2 JSON配信に寄せ、Functions を呼ぶ閲覧を1日3万回未満に抑える。 |
| 動画再生開始イベント | Workers request と Durable Object request の両方を消費 | 通常時も6時間セッション重複排除を行い、`economy` では50%サンプリング、`read_only` では新規計測停止。 |
| D1 reads | 5,000,000 rows/day | 一覧・おすすめ・関連動画で D1 を直接集計しない。検索はインデックス必須、広範囲検索は `economy` で停止。 |
| D1 writes | 100,000 rows/day | 再生ごとの直接書き込みは禁止。投稿、編集、いいね、コメント、CSVを `read_only` で止める。 |
| Durable Objects | request 100,000/day、duration、SQLite rows | 集約オブジェクトを短時間で休眠可能にし、1再生1永続書き込みを避ける。未反映カウントは24時間だけ保持。 |
| KV writes | 1,000 writes/day | ガード状態や低頻度フラグに限定し、閲覧ログや逐次カウントに使わない。 |
| R2 Class B | 10,000,000/month | 作品サムネイルは YouTube を使い、R2 はアイコンと静的JSONに限定。JSONはHTTP Cacheを長めにする。 |
| R2 storage | 10GB-month | Cloudflareにアップロードする画像はアイコンのみ、元ファイル8MB、保存前に250x250 WebPへ圧縮。 |
| Queues | 10,000 operations/day | 1メッセージ約3操作として、同期・通知キューは通常1日3,000件程度を上限目安にする。 |
| Cron | 5 triggers/account | JSON生成、スコア更新、YouTube同期、使用量監視、クリーンアップをまとめ、Cron数を増やさない。 |

無料枠で最も危ない順は、1. Workers/Pages Functions requests、2. Durable Object requests、3. D1 rows written、4. KV writes、5. R2 Class B operations、6. Queues operations とする。D1 rows read はインデックスと静的JSONで抑えられるが、検索や管理画面の未制限一覧があると急増するため、全一覧に `limit` と cursor を必須にする。

## 4. 使用量ガードの段階

`system_settings.cost_guard_mode` で現在の制限状態を管理する。

| モード | 発動目安 | 停止・制限する機能 |
| :--- | :--- | :--- |
| `normal` | 通常 | 全機能を通常運用する。 |
| `economy` | 目安70%到達 | パーソナライズ推薦、詳細分析、即時スコア再計算、重い検索を抑制する。閲覧数計測は既定50%サンプリングにする。 |
| `read_only` | 目安85%到達 | 新規投稿、CSVインポート、アイコン画像アップロード、コメント投稿、チャプター/チャプターマーカー作成、いいね、ブックマーク、閲覧数イベントの新規書き込みを停止する。閲覧は継続する。管理者の一時許可は30分で自動終了し、30分単位で延長できる。 |
| `static_only` | 目安95%到達 | Functions を必要とする公開動的機能を停止し、R2/Pages の静的JSONと静的ページ中心に切り替える。 |
| `maintenance` | 管理者判断または上限超過寸前 | 管理者以外はメンテナンス画面を表示する。管理者は復旧操作のみ可能。 |

発動目安は固定値ではなく、管理画面で変更できる。

停止順序は、まず検索のフルスキャン系を停止し、次に動的推薦、リアルタイムスコア再計算、YouTube同期を落とす。Discord通知キューは運営対応に必要なため優先し、YouTube同期キューより先に処理する。使用量取得に失敗した場合は、楽観的に通常運用へ戻さず、保守的に `economy` へ遷移する。

## 5. 自動停止対象

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

Durable Object が危険水位に入った場合は即停止ではなく、閲覧数計測を10%サンプリングへ下げる。`read_only` 以上では新規計測を止め、止めた閲覧数イベントは後から補完しない。サンプリング中の公開表示値は、通常時の推定に近づけるため補正値として表示する。

## 6. データ設計

### 6-1. system_settings 拡張

`system_settings` に以下を追加する。

- **cost_guard_mode**: text DEFAULT `"normal"` (`normal`, `economy`, `read_only`, `static_only`, `maintenance`)
- **auto_cost_guard_enabled**: integer DEFAULT 1
- **cost_guard_thresholds_json**: text (JSON Object)
- **disabled_features_json**: text (JSON Array)
- **cost_guard_reason**: text | null
- **cost_guard_updated_by_user_id**: text | null
- **cost_guard_updated_at**: integer | null
- **cost_guard_exception_until**: integer | null (管理者一時許可の終了時刻。既定30分)
- **cost_guard_exception_features_json**: text (JSON Array / 一時許可する機能)

`cost_guard_thresholds_json` の例:

```json
{
  "workers_requests_daily_ratio": { "economy": 0.70, "read_only": 0.85, "static_only": 0.95 },
  "d1_rows_read_daily_ratio": { "economy": 0.70, "read_only": 0.85, "static_only": 0.95 },
  "d1_rows_written_daily_ratio": { "economy": 0.60, "read_only": 0.80, "static_only": 0.92 },
  "durable_object_requests_daily_ratio": { "economy": 0.65, "read_only": 0.80, "static_only": 0.92 },
  "r2_class_a_monthly_ratio": { "economy": 0.70, "read_only": 0.85, "static_only": 0.95 },
  "r2_class_b_monthly_ratio": { "economy": 0.70, "read_only": 0.85, "static_only": 0.95 },
  "r2_storage_monthly_ratio": { "economy": 0.70, "read_only": 0.85, "static_only": 0.95 },
  "kv_writes_daily_ratio": { "economy": 0.60, "read_only": 0.80, "static_only": 0.92 },
  "queues_operations_daily_ratio": { "economy": 0.60, "read_only": 0.80, "static_only": 0.92 }
}
```

### 6-2. cost_usage_snapshots

使用量監視のために日次・時間帯別のスナップショットを保存する。

- **id**: text (Primary Key)
- **captured_at**: integer NOT NULL
- **source**: text (`cloudflare_dashboard`, `graphql_analytics`, `estimated_local`)
- **workers_requests_today**: integer DEFAULT 0
- **pages_functions_requests_today**: integer DEFAULT 0
- **d1_rows_read_today**: integer DEFAULT 0
- **d1_rows_written_today**: integer DEFAULT 0
- **r2_storage_gb_month_estimate**: real DEFAULT 0
- **r2_class_a_month**: integer DEFAULT 0
- **r2_class_b_month**: integer DEFAULT 0
- **durable_object_requests_today**: integer DEFAULT 0
- **durable_object_duration_gb_s_today**: real DEFAULT 0
- **kv_reads_today**: integer DEFAULT 0
- **kv_writes_today**: integer DEFAULT 0
- **queues_operations_today**: integer DEFAULT 0
- **guard_mode_after_check**: text
- **created_at**: integer NOT NULL DEFAULT (unixepoch())

Cloudflare 公式メトリクスの取得ができない場合でも、アプリ側の推定カウンタを `estimated_local` として保存し、保守的に停止判断する。

## 7. 管理画面

`/admin` に「コストガード」パネルを追加する。

- 現在の `cost_guard_mode`
- 自動ガード ON/OFF
- 各サービスの使用率
- 発動理由
- 手動モード変更
- 一時解除時間（既定30分、30分単位で延長）
- 機能別停止トグル
- しきい値編集
- 直近のガード履歴
- Discord DM 通知の送信状況
- 一時許可・延長理由の入力欄
- 有料化判断ラインに近い指標の2か月推移

管理者は以下を実行できる。

- `normal` へ戻す
- `read_only` へ強制移行
- `maintenance` へ強制移行
- 特定機能だけ停止する
- CSV インポートやエクスポートなど重い処理を30分だけ一時的に許可する

`read_only` 中の一時許可・延長は理由入力を必須にし、30分で自動終了する。30分単位の延長は可能だが、二人確認は必須にしない。迅速な復旧を優先し、単独の管理者操作で戻せるようにする。

## 7-1. 通知

- `economy`, `read_only`, `static_only`, `maintenance` へ自動遷移した場合、管理者へ Discord DM を送る。
- 管理画面にも同内容の通知を残し、Discord DM が失敗しても管理者が確認できるようにする。
- 通知には、現在モード、超過しそうな指標、停止された機能、一時許可の有無、推奨操作を含める。

## 7-2. 静的JSON生成頻度

- 通常時はトップ、一覧、イベント詳細、おすすめ、関連動画の静的 JSON を1時間ごとに生成する。
- イベント開催中、受付中、または公開直後のイベントは、対象イベントの JSON だけ5〜10分ごとに生成する。
- `static_only` では新規生成より既存 JSON 配信を優先し、生成処理自体が無料枠を圧迫する場合は停止する。
- R2 Class B が増えすぎた場合、静的JSONは Pages Static Assets へ寄せる。JSONは直近3世代のみ保持し、古い世代は自動削除する。

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
- Cron は統合し、1回の処理で JSON 生成、古い一時ファイル削除、使用量チェックをまとめる。
- 月間の D1 読み書き、または Pages Functions 要求が無料枠の80%を常に超える状態が2か月続いた場合、有料化または構成見直しの判断ラインにする。

## 10. 参照元

- Cloudflare Workers Limits: https://developers.cloudflare.com/workers/platform/limits/
- Cloudflare Workers Pricing: https://developers.cloudflare.com/workers/platform/pricing/
- Cloudflare Pages Functions Pricing: https://developers.cloudflare.com/pages/functions/pricing/
- Cloudflare D1 Pricing: https://developers.cloudflare.com/d1/platform/pricing/
- Cloudflare Durable Objects Pricing: https://developers.cloudflare.com/durable-objects/platform/pricing/
- Cloudflare R2 Pricing: https://developers.cloudflare.com/r2/pricing/
- Cloudflare Workers KV Limits: https://developers.cloudflare.com/kv/platform/limits/
- Cloudflare Queues Pricing: https://developers.cloudflare.com/queues/platform/pricing/
