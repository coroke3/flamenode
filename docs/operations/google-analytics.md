# Google Analytics（GA4）運用

> Status: Active
> Last verified: 2026-08-01
> Verified against: `workers/ga-analytics/`, `src/components/video/VideoViewTracker.tsx`, `src/lib/publicData/trendingLoader.ts`, `app/(public)/layout.tsx`

FlameNode は GA4 で作品視聴イベントを計測し、Worker が R2 に急上昇ランキング JSON を書き込む。公開 Web は R2 のみを読み、D1 や `static_rebuild_queue` には依存しない。

## 構成

| 層 | 役割 |
| --- | --- |
| Web（`@next/third-parties/google`） | ページビュー計測。`NEXT_PUBLIC_GA_MEASUREMENT_ID` が設定されているときだけ有効 |
| `VideoViewTracker` | 動画詳細で 10 秒以上の視聴を `flamenode_video_view` として 1 回送信 |
| `workers/ga-analytics` | GA4 Data API で期間別視聴数を取得し、`analytics/trending.json` を R2 へ PUT |
| `sync-jobs` Worker | 毎時 `:07`（UTC）の Cron 枠で `ga4-trending-sync` を YouTube metadata より先に実行。YouTube 失敗と独立（`rethrow: false`）。再生リスト同期（`:52`）とは別枠 |

## Web 側の設定

`.dev.vars` / 本番 Runtime Variables:

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
4. 次回 `sync-jobs` deploy 後、毎時 `:07` UTC で `ga4-trending-sync` が走る
5. Workers ログの構造化イベント（`job: ga4-trending-sync`）と R2 `analytics/trending.json` を確認

`GA4_SYNC_ENABLED=0` のままでは同期は skipped。表示は前回 JSON または空状態。

### Build env への `GA4_SYNC_ENABLED` inject

`scripts/cloudflare-production.mjs` が `materializeProductionConfigs` 時に Build Variables から `GA4_SYNC_ENABLED` を `"0"` / `"1"` に正規化して `sync-jobs` 生成 TOML へ注入する。`QUEUE_DISPATCH_ENABLED` 等と同じ扱い。テンプレート `wrangler.toml` は常に `"0"` を維持する。

`GA4_SYNC_ENABLED=1` で deploy する場合は、Remote Secret preflight で GA4 関連 secrets の登録も必須になる。

### 同期フロー

1. R2 から `list/recent.json` を読む（公開作品メタの正本）
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

**fail-closed**: GA4 失敗・`list/recent.json` 欠損時は R2 を上書きしない。前回成功分が残る。

**windows メタデータ**: JSON の `windows` 日付は同期時刻の UTC 日付を参考値として出力する。GA4 `runReport` の集計境界はプロパティのタイムゾーン設定に従う。

### R2 JSON の `schema_version`

公開側 `normalizeStaticTrending` は **`schema_version` が number の `1` であること** を必須とする。欠落・文字列 `"1"`・他バージョンは不正扱いで `data=null`（表示は空または前回キャッシュ）。`items` が空でも `generated_at` と `schema_version: 1` があれば有効。

## 公開表示

| 画面 | データ源 | 表示条件 |
| --- | --- | --- |
| トップ「FlameNodeで注目」 | `loadStaticTrending()` | データありかつ `items.length > 0` かつ 24 時間以内。上位 12 件・順位順。`isDegraded` の外 |
| `/trending` 急上昇ランキング | 同上 | 上位 50 件。4 期間の視聴数と JST 最終更新。空・stale でも 404/500 にしない |
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

- Worker 契約: `workers/ga-analytics/*.test.mjs`
- 正規化・stale: `src/lib/publicData/staticTrendingCore.test.mjs`
- ローダー（D1 非参照）: `src/lib/publicData/trendingLoader.test.mjs`
- UI 契約: `npm run check:ui-acceptance`

同期失敗時は Cloudflare Workers ログの `ga4-trending-sync` 構造化イベントを確認（`service` / `job` / `enabled` / `result` / `generated_at` / `ga_rows` / `matched_videos` / `ranked_videos` / `r2_written` / `duration_ms` / `external_api_calls` など。secret は含まれない）。`GA4_SYNC_ENABLED` が `0` の場合は `result: "skipped"` となり、表示は前回 JSON または空状態になる。`ENABLED=1` だが secrets / R2 / KV が欠落している場合は `result: "failed"`, `error_name: "config_missing"` で R2 は更新しない。

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
| **429** | Core クォータ超過 | 同期頻度を下げるかクォータ増枠を検討。`GA4_SYNC_ENABLED=0` で一時停止し、既存 `analytics/trending.json` を維持（fail-closed） |

いずれも同期失敗時は R2 を上書きしない。ログの `result: "failed"` と `error` サマリを確認する。
