# FlameNode Active X データ移行詳細計画書（Active X Data Migration Plan）

> 状態: Active / データ移行・バッチ設計正本
> 関連ドキュメント: [`PRODUCT_REQUIREMENTS.md`](PRODUCT_REQUIREMENTS.md), [`README.md`](README.md), [`STATUS.md`](STATUS.md)

## 1. 移行の背景と目的

CURRENT 実装では、動画への「いいね」「ブックマーク（保存）」等のインタラクションが一部 `auth_user_id`（Discord アカウント）単位で記録されています。
TARGET アーキテクチャでは、**「認証主体 = Auth User」「行動・創作・インタラクション主体 = Active X」** として明確に分離されます。

本計画書は、既存のインタラクションデータを無停止かつ Cloudflare Free 枠の制限内で安全に Active X 主体へ移行するための手順を定義します。

---

## 2. 移行対象データとマッピング方針

### 対象テーブル
- `video_interactions_auth`（CURRENT: `auth_user_id`, `video_id`, `is_liked`, `is_bookmarked`, `updated_at`）

### ターゲット構造
- `video_interactions_x`（TARGET: `x_user_id`, `video_id`, `is_liked`, `is_bookmarked`, `actor_auth_user_id`, `updated_at`）
  - 主キー: `(video_id, x_user_id)`
  - 監査追跡: `actor_auth_user_id` を保持（Dual Attribution 構造）

### ユーザー状態ごとのマッピング規則
1. **承認済み Active X を所持しているユーザー**:
   - `users.active_x_user_id` が存在する場合、その `active_x_user_id` をキーとして新テーブルへ直接移行する。
2. **Active X を未所持・未連携の一般ユーザー**:
   - データは破棄せず、退避テーブル `video_interactions_unlinked_stash`（またはステータスフラグ）に保持する。
   - ユーザーが次回ログイン時または操作時に「Active X 登録・連携モーダル」を通じて名義を登録・承認された時点で、自動的に `video_interactions_x` へ引き継ぐ。

---

## 3. Cloudflare Free 枠の制限遵守とバッチ分割設計

Cloudflare D1 Free 枠には以下の厳格な制限があります：
- **1日の行書き込み上限**: 100,000 行/日
- **1回の `db.batch()` ステートメント上限**: 50 ステートメント

### バッチ実行仕様 (`scripts/migrate-interactions-to-active-x.mjs`)
1. **チャンクサイズ**: 1 バッチあたり最大 40 件の UPDATE/INSERT（50 ステートメント制限に余裕を持たせる）。
2. **進捗管理**: `migration_checkpoints` テーブルに `last_processed_auth_user_id` を記録し、中断・再開（Resume）を可能にする。
3. **安全弁（Circuit Breaker）**: 1 回の実行で最大 5,000 行まで処理し、日次 100,000 行制限を絶対に超えないよう自動停止する。
4. **べき等性（Idempotency）**: `INSERT OR REPLACE` または `ON CONFLICT DO UPDATE` を使用し、重複実行されてもデータが二重化しないことを保証する。

---

## 4. 移行フェーズと実行順序

| Step | タイミング | 作業内容 |
|---|---|---|
| **Step 1** | Phase 3 (Domain) | 新スキーマのマイグレーション DDL 適用および Domain/D1 書き込み二重化（Dual Write）の準備 |
| **Step 2** | Phase 6 (Hono API) | 過去データのバックフィルバッチスクリプト実行（`dry-run` 検証後に本番適用） |
| **Step 3** | Phase 7 (Private SPA) | UI 表示を Active X 単位のライブラリ（`/dashboard/library`）へ完全切り替え。未連携モーダルの稼働開始 |
| **Step 4** | Phase 9 (Retirement) | 旧 `video_interactions_auth` テーブルの安全な廃止 |

---

## 5. ロールバック手順

- 移行期間中は旧 `video_interactions_auth` テーブルのデータを物理削除しない。
- 万が一新スキーマまたはバッチ処理に不整合が生じた場合は、即座に feature flag を切り替えて旧 `auth_user_id` 参照へフェイルバック可能とする。
