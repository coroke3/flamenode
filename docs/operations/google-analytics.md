# Google Analytics（GA4）運用

> Status: Active
> Last verified: 2026-10-28 (MIG-0517 code review; production remains CURRENT until deployed)
> Verified against: `workers/ga-analytics/`, `src/components/video/VideoViewTracker.tsx`, `src/lib/publicData/trendingLoader.ts`, `app/(public)/layout.tsx`

FlameNode は GA4 で作品視聴イベントを計測し、Worker が R2 に急上昇ランキング JSON を書き込む。公開 Web は R2 のみを読み、D1 や `static_rebuild_queue` には依存しない。**同期 Worker の入力**は現在 R2 の `list/recent.json` だが、MIG-0517（PR #442）では D1 の公開作品を直接読むように変更する。PR の merge だけでは本番デプロイ済みとはみなさない。

## 構成

| 層 | 役割 |
| --- | --- |
| Web（`@next/third-parties/google`） | ページビュー計測。`NEXT_PUBLIC_GA_MEASUREMENT_ID` が設定されているときだけ有効 |
| `VideoViewTracker` | 動画詳細で 10 秒以上の視聴を `flamenode_video_view` として 1 回送信 |
| `workers/ga-analytics` | CURRENT: R2 `list/recent.json` から公開作品を取得。MIG-0517 TARGET: D1 から上限付き SELECT 1 文で公開作品を取得。どちらも GA4 Data API を集計し、`analytics/trending.json` を R2 へ PUT |
| `sync-jobs` Worker | 毎時 `:07`（UTC）の Cron 枠で `ga4-trending-sync` を YouTube metadata より先に実行。YouTube 失敗と独立（`rethrow: false`）。再生リスト同期（`:52`）とは別枠 |

## Web 側の設定

ローカルは `.dev.vars`、本番は Workers Builds の **Build Variables**（OpenNext bake-in 用。Runtime Secret だけではクライアント計測に入らない）:

```bash
NEXT_PUBLIC_GA_MEASUREMENT_ID="G-XXXXXXXXXX"
```

未設定のときは `GoogleAnalytics` コンポーネントと `VideoViewTracker` は no-op。

### 送信イベント

`flamenode_video_view`（カスタムイベント）:

| パラメータ | 内容 |
| --- | --- |
| `video_id` | FlameNode 内部 ID |
| `youtube_video_id` | YouTube 動画 ID |
| `primary_event_id` | 主イベント ID。なければ `"none"` |
| `watch_threshold_seconds` | 閾値（10） |

重複送信防止は `localStorage`（`videoViewTrackerCore`）で **6 時間** のクールダウン。同一作品はクールダウン中は再送信しない。

## Worker 側の設定

`workers/sync-jobs/wrangler.toml` の vars / secrets:

| 変数 | 用途 |
| --- | --- |
| `GA4_SYNC_ENABLED` | `"1"` のときだけ同期実行。テンプレート既定 `"0"` |
| `GA4_PROPERTY_ID` | GA4 プロパティ ID（secret 推奨） |
| `GA4_SERVICE_ACCOUNT_EMAIL` | Data API 用サービスアカウント |
| `GA4_SERVICE_ACCOUNT_PRIVATE_KEY` | PEM 秘密鍵（`\n` エスケープ可） |

ローカル `.dev.vars` には Web 用の `NEXT_PUBLIC_GA_MEASUREMENT_ID` のみ必須。Worker 用 GA4 変数はコメント例として `.dev.vars.example` に記載し、実際の同期は Worker vars/secrets で設定する。

### Phase 有効化手順

1. Google Cloud 側の準備（下記）を完了する
2. `workers/sync-jobs` の Runtime Secrets に `GA4_PROPERTY_ID` / `GA4_SERVICE_ACCOUNT_EMAIL` / `GA4_SERVICE_ACCOUNT_PRIVATE_KEY` を登録
3. Cloudflare Workers Builds の Build Variables に `GA4_SYNC_ENABLED=1` を設定（`QUEUE_*` と同様、生成 wrangler へ inject）
4. 同じ Build Variables に `NEXT_PUBLIC_GA_MEASUREMENT_ID=G-...` を設定（OpenNext bake-in と web 生成 config inject）
5. 次回 `sync-jobs` deploy 後、毎時 `:07` UTC で `ga4-trending-sync` が走る
6. Workers ログの構造化イベント（`job: ga4-trending-sync`）と R2 `analytics/trending.json` を確認

`GA4_SYNC_ENABLED=0` はGA4 API取得を停止し、ジョブの集計結果は skipped。ただしPR #680適用後はD1とR2が利用できる場合に限り、旧ランキングを現行D1公開集合で再検証し、公開撤回された行を除去する。D1失敗時はR2を更新しない。

### Build env への `GA4_SYNC_ENABLED` inject

`scripts/cloudflare-production.mjs` が `materializeProductionConfigs` 時に Build Variables から `GA4_SYNC_ENABLED` を `"0"` / `"1"` に正規化して `sync-jobs` 生成 TOML へ注入する。`QUEUE_DISPATCH_ENABLED` 等と同じ扱い。テンプレート `wrangler.toml` は常に `"0"` を維持する。

`GA4_SYNC_ENABLED=1` で deploy する場合は、Remote Secret preflight で GA4 関連 secrets の登録も必須になる。

### 同期フロー

1. CURRENT（PR #442 の本番デプロイ前）は R2 `list/recent.json` から公開作品を読む。MIG-0517 TARGET（本番デプロイ後）は D1 の `videos` を公開条件で1回の上限付き SELECT（最大5,001件を取得して5,000件超は失敗）し、既存 generator と同じ `scheduled_time DESC`・ID タイブレークで並べる。非公開・まとめ作品は除外し、非公開イベント情報は付与しない。公開作品0件でも空の有効な `trending.json`（`items: []`、`schema_version: 1`）を PUT する（CURRENT も空リストで空を書く）
2. GA4 Data API `runReport` で 2 / 5 / 7 / 30 日の `flamenode_video_view` を `video_id` 別に集計。リクエストの dimension は `customEvent:video_id` のみ指定し、複数の名前付き date range に対して Data API がレスポンスへ自動追加する `dateRange` 列を使用する（`dateRange` 自体を dimension 指定すると 400）
3. `rankTrendingItems` で決定的にソート（`views_2d` → `views_5d` → `views_7d` → `views_30d` → `video_id`）し、`rank` / `video_id` を付与
4. R2 `analytics/trending.json` へ PUT（スキーマ version 1、最大 200 件）

R2 JSON 例:

```json
{
  "schema_version": 1,
  "generated_at": 1700000000,
  "source": "ga4",
  "ranking_rule": ["views_2d_desc","views_5d_desc","views_7d_desc","views_30d_desc","video_id_asc"],
  "windows": {
    "views_2d": { "start_date": "2026-07-30", "end_date": "2026-07-31" },
    "views_5d": { "start_date": "2026-07-27", "end_date": "2026-07-31" },
    "views_7d": { "start_date": "2026-07-25", "end_date": "2026-07-31" },
    "views_30d": { "start_date": "2026-07-02", "end_date": "2026-07-31" }
  },
  "items": []
}
```

**障害時の書込み契約（MIG-0517 / Draft PR #680）**: 旧説明の「GA4失敗・公開作品0件なら常に前回成功分を保持する」は、このPRの実装とは一致しない。以下は `workers/ga-analytics/sync.ts` と `recentFromD1.ts` の**候補実装**の挙動であり、本番反映済みという意味ではない。

| 条件 | R2 `analytics/trending.json` の扱い | 同期結果・制約 |
| --- | --- | --- |
| D1が正常で公開対象0件、GA4同期有効かつ設定正常 | `items: []` の有効なランキングをPUT（GA4 API呼出しなし） | 正常終了。旧公開動画の残存を避ける |
| D1正常、GA4 API失敗（500/429/不正JSON等） | 旧R2を現行D1公開一覧と照合。表示項目・公開IDが一致する場合だけ保持し、変更があれば現行公開項目で再生成してPUT（不正な旧R2は空で置換） | GA4失敗は失敗として記録・再throw。R2再書込みは保証されない |
| GA4の認証・KV設定不足、または `GA4_SYNC_ENABLED=0` | D1とR2が使えるときは同じ公開失効修復を試行（GA4 API呼出しなし） | 設定不足はfailed、明示無効化はskipped。修復失敗は `privacy_repair_failed` で記録 |
| D1読み取り失敗・不完全な結果・公開候補5,000件超 | 安全な公開許可リストを確定できず、R2を書き換えない | **旧R2は残り得る。公開撤回は保証されない** |
| R2読み取り／書込み失敗 | 修復完了と判定しない。旧オブジェクトが残る可能性がある | 公開失効の成功を保証しない。ログへprovider例外本文を含めない |

D1は読み取り専用。正常な修復試行は公開一覧D1 SELECTを1回、既存R2 GETを最大1回、差分があればR2 PUTを1回行う。実運用のCPU/D1/R2予算は非本番の計測と承認が必要。**R2 PUT成功は公開ページからの失効成功を意味しない**。Cache API（最大300秒）、Next ISR、CDN、TARGET Astroビルド済みHTMLの失効は別途検証・設計する。

**windows メタデータ**: JSON の `windows` 日付は同期時刻の UTC 日付を参考値として出力する。GA4 `runReport` の集計境界はプロパティのタイムゾーン設定に従う。

### R2 JSON の `schema_version`

公開側 `normalizeStaticTrending` は **`schema_version` が number の `1` であること** を必須とする。欠落・文字列 `"1"`・他バージョンは不正扱いで `data=null`（表示は空または前回キャッシュ）。`items` が空でも `generated_at` と `schema_version: 1` があれば有効。

## 公開表示

| 画面 | データ源 | 表示条件 |
| --- | --- | --- |
| トップ「FlameNodeで注目」 | `loadStaticTrending()` | データありかつ `items.length > 0` かつ 24 時間以内。上位 12 件・順位順。`TopLoopShelf`（他棚と同じ幅・交互スクロール） |
| `/trending` 急上昇ランキング | 同上 | 上位 30 件。直近2日間の視聴急増で順位。各作品に1週間の視聴回数（views_7d）のみ表示。2日/5日/30日の期間別視聴数は出さない。JST 最終更新。空・stale でも 404/500 にしない |
| `/recommend`「人気作品」 | `recommend.json`（既存） | 表示名のみ変更。算出ロジックは従来どおり |

### stale 判定（`staticTrendingCore`）

- `generated_at` から `ageSeconds` を算出（`items` が空でも `generated_at` あれば有効）
- **3 時間超**: `stale=true`（`/trending` で注意メッセージ）
- **24 時間超**: `tooOldForHome=true`（トップの「FlameNodeで注目」を非表示）

R2 miss や JSON 不正時は `data=null`。トップ全体や他セクションは失敗しない。

## Google Cloud 側の準備

1. GA4 プロパティを作成し、Measurement ID を Web に設定
2. カスタムイベント `flamenode_video_view` を有効化
3. **カスタムディメンション** を登録:
   - 表示名: **FlameNode Video ID**
   - イベントパラメータ: `video_id`
   - スコープ: **イベント**
4. サービスアカウントを作成し、GA4 プロパティへ **閲覧者** 以上を付与
5. Data API（Google Analytics Data API）を有効化

## 検査・障害時

- Worker 契約: `workers/ga-analytics/*.test.mjs`。MIG-0517 の D1 取得の境界・非公開除外は `recentFromD1.test.mjs`
- 正規化・stale: `src/lib/publicData/staticTrendingCore.test.mjs`
- ローダー（D1 非参照）: `src/lib/publicData/trendingLoader.test.mjs`
- UI 契約: `npm run check:ui-acceptance`

Cloudflare Workers の ga4-trending-sync 構造化ログで result / r2_written / privacy_rewrite_on_ga4_failure / privacy_rewrite_on_config_failure / privacy_rewrite_on_disabled / privacy_repair_error を確認する。PR #680適用後はGA4 API失敗・設定不備・明示無効化でも、D1が現在の公開行を正しく取得できればR2にプライバシー修正が書き込まれることがある。D1/R2が使えない場合や再書込みに失敗した場合、公開失効の成功は保証されない。ログには任意のprovider例外本文を含めず、固定コード privacy_repair_failed を用いる。

複数 named dateRange の `runReport` では、GA4 が返す `rowCount` が「主ディメンション件数」になり、`rows` が `video_id × dateRange` に展開されることがある。同期実装は `rowCount` と `rows.length` の一致を要求せず、ページが満杯のあいだだけ offset で継続する。

### Data API Core クォータ

GA4 Data API（Core）には時間・日次のトークンクォータがある。

| 確認方法 | 内容 |
| --- | --- |
| [Google Cloud Console](https://console.cloud.google.com/) → APIs & Services → Google Analytics Data API → **Quotas** | プロジェクト単位の上限・使用量 |
| `runReport` レスポンスの `propertyQuota` | `returnPropertyQuota: true` 時。`tokensPerHour` / `tokensPerDay` / `concurrentRequests` 等の `consumed` / `remaining` |

同期 Worker は最終ページの `propertyQuota` を構造化ログへ含める（例: `quota_tokens_per_hour_remaining`, `quota_tokens_per_day_remaining`）。秘密情報はログしない。

### 403 / 429 時の対応

| HTTP | 想定原因 | 対応 |
| --- | --- | --- |
| **403** | 権限不足・API 未有効化・プロパティ ID 誤り | サービスアカウントの GA4 閲覧権限と Data API 有効化を確認。修正まで `GA4_SYNC_ENABLED=0` で同期停止可 |
| **429** | Core クォータ超過 | 同期頻度を下げるかクォータ増枠を検討。GA4_SYNC_ENABLED=0 で一時停止できるが、PR #680 適用後は旧R2ランキングを無条件には維持せず、D1公開集合により公開撤回済み行を除去する場合がある |

PR #680 適用後は、GA4 API障害・設定不足・明示無効化でも、D1公開状態を検証した上でR2を上書きする場合がある。未来時刻が300秒を超える旧generated_atを持つランキングは保持しない。PR #680 の公開ローダーは `generated_at` が現在より300秒を超えて未来のR2 JSONを正規化段階で拒否し、純粋stale判定も非表示相当にする。GA4 writer側も同じ300秒の閾値を共有する。Cache APIの300秒キャッシュ、Next ISR（トップ120秒・/trending 300秒）、CDN、TARGET build-time snapshotは別経路なので、writer側の再書込みだけでは即時の公開撤回は保証できない。
