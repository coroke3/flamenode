# FlameNode Active X データ移行詳細計画書（Active X Data Migration Plan）

> 状態: Active / データ移行設計書
> 最終検証: 2026-10-09（実スキーマ `src/lib/db/schema.canonical.ts` および `0052_video_interactions_auth_expand.sql` に基づき改定）
> 関連ドキュメント: [`PRODUCT_REQUIREMENTS.md`](PRODUCT_REQUIREMENTS.md), [`README.md`](README.md), [`STATUS.md`](STATUS.md), [`OPEN_DECISIONS.md`](OPEN_DECISIONS.md) (D-03, D-04)

## 1. 移行の背景と目的

CURRENT 実装では、動画への「いいね」「ブックマーク（保存）」が `video_interactions_auth`（Auth User 単位）に記録されています（`src/lib/actions/video/interaction.ts`）。
TARGET アーキテクチャ（[`PRODUCT_REQUIREMENTS.md`](PRODUCT_REQUIREMENTS.md)）では、**「認証主体 = Auth User」「行動・創作・インタラクション主体 = Active X」** として分離され、いいね・ブックマークの所有主体は Active X（`video_interactions`）へ戻します（`CURRENT_DIVERGENCE` の解消）。

既存 D1 には `video_interactions`（`x_user_id` 単位）と `video_interactions_auth`（`auth_user_id` 単位）が**両方定義済み**です。
新テーブルを新設するのではなく、既存の `video_interactions` を正本として位置づけ直し、安全にデータをバックフィル・切替する手順を定義します。

---

## 2. 対象テーブルとスキーマ構造（実コード基準）

### 1. 現在の書き込み正本: `video_interactions_auth`
```sql
CREATE TABLE video_interactions_auth (
  auth_user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  video_id TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  interaction_type TEXT NOT NULL CHECK (interaction_type IN ('like', 'bookmark')),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (auth_user_id, video_id, interaction_type)
);
CREATE INDEX video_interactions_auth_video_type_idx
  ON video_interactions_auth (video_id, interaction_type, created_at);
```

### 2. 移行先正本: `video_interactions`
```sql
CREATE TABLE video_interactions (
  x_user_id TEXT NOT NULL REFERENCES x_users(id) ON DELETE CASCADE,
  video_id TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  interaction_type TEXT NOT NULL CHECK (interaction_type IN ('like', 'bookmark')),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (x_user_id, video_id, interaction_type)
);
CREATE INDEX video_interactions_video_type_idx
  ON video_interactions (video_id, interaction_type, created_at);
```

※ 新たな `video_interactions_x` テーブルや `is_liked`, `is_bookmarked` フラグ列は作りません。

---

## 3. ユーザー状態ごとのマッピング方針（D-03 参照）

1. **承認済み Active X を所持しているユーザー (`users.active_x_user_id != null`)**:
   - `users.active_x_user_id` をキーとして、`video_interactions` へ移行（`INSERT OR IGNORE`）。
2. **承認済み X を複数所持し、`active_x_user_id` が未定のユーザー**:
   - [`OPEN_DECISIONS.md`](OPEN_DECISIONS.md) D-03 の判断待ち。
   - 推奨: `link_role = 'owner'` の最古の承認済み X ID を優先、またはユーザーの次回明示選択まで保留。
3. **Active X を未所持・未連携の一般ユーザー**:
   - データを削除せず、`video_interactions_auth` にそのまま保持する。
   - ユーザーが次回ログイン時または操作時に「Active X 登録・連携モーダル」を通じて名義を登録・承認された時点で、自動的に `video_interactions` へコピーする。
4. **重複いいね（異なる Auth User が同一 X ID に紐づいている場合）**:
   - 主キー `(x_user_id, video_id, interaction_type)` により 1 件に集約。
   - `videos.app_like_count` の実数ズレが発生する場合は、バッチ完了後に再集計を実行。

---

## 4. Cloudflare D1 Free 枠の制限遵守とバッチ設計

Cloudflare D1 Free 枠制限:
- **1日の行書き込み上限**: 100,000 行/日
- **1回の `db.batch()` ステートメント上限**: 50 ステートメント

### バックフィルバッチ仕様 (`scripts/migrate-interactions-to-active-x.mjs`)
1. **チャンクサイズ**: 1 バッチ最大 40 件の INSERT（50 ステートメント制限にマージンを確保）。
2. **安全弁**: 1 回のバッチ実行で最大 5,000 件まで処理し、日次 100,000 行上限を確実に下回る設計。
3. **べき等性**: `INSERT OR IGNORE INTO video_interactions ...` を用い、再実行安全性を保証。
4. **監査ログ**: バッチ実行ログおよび除外件数は標準出力・レポートへ出力。

---

## 5. 移行フェーズと実行順序

| Step | タイミング | 作業内容 |
|---|---|---|
| **Step 1** | Phase 3 (Domain) | `packages/domain` 内で `video_interactions` を対象とする interaction サービスの型・シグネチャを設計 |
| **Step 2** | Phase 6 (Hono API) | バックフィルスクリプトの作成・dry-run 検証、および本番バックフィル（要ユーザー承認） |
| **Step 3** | Phase 7 (Private SPA) | `system_settings` のフラグにより、書き込み・読み込み正本を `video_interactions` へ一括切替（D-04 参照）。未連携モーダル稼働 |
| **Step 4** | Phase 9 (Retirement) | 整合性検証期間を経て、旧 `video_interactions_auth` の安全な廃止 |

---

## 6. ロールバック手順

- 移行期間中は `video_interactions_auth` のデータを物理削除しない。
- 不整合発生時は、`system_settings` の feature flag を戻すことで、即座に旧 `video_interactions_auth` 参照へフェイルバック可能とする。
