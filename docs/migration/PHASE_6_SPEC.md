# FlameNode Phase 6 タスク仕様書（Hono API Spec）

> 状態: Active / Phase 6 実行向け仕様書
> 最終検証: 2026-10-09（`route-handlers/README.md` の RH-001〜RH-033 および `API_MATRIX.md` に基づき改定）
> 対象モデル: Claude / Codex / Antigravity / GPT-5.6-luna / Gemini Flash 等の全エージェント
> 関連ドキュメント: [`README.md`](README.md), [`STATUS.md`](STATUS.md), [`API_MATRIX.md`](API_MATRIX.md), [`route-handlers/README.md`](route-handlers/README.md), [`CODE_QUALITY.md`](CODE_QUALITY.md), [`OPEN_DECISIONS.md`](OPEN_DECISIONS.md) (D-01, D-02)

---

# 1. Hono API の基本方針

1. **薄いトランスポート層（Thin Adapter）**:
   - `apps/api` は HTTP 入出力（リクエストパース、Zod バリデーション、レスポンス成形、ステータスコードマッピング）のみを担当。
   - ビジネスロジック・権限判定方針を`packages/domain`に共通化する。**D1 binding/session/request context/SQL実行・監査commitはapplication service/DB adapter側**で管理し、transaction境界・post-commit Queueを維持。`packages/domain`から旧`src/**`へのimportは禁止し、schema型はMIG-0308後の`@flamenode/db`から参照する。
2. **共有 Zod 契約（`packages/contracts`）**:
   - リクエストボディおよびレスポンス DTO は `packages/contracts` で型定義。
   - D1 テーブルのカラムをそのまま漏洩させず、明示的 DTO のみを返却（`check:public-api-leaks` 準拠）。
3. **有界な CPU 時間（< 10ms）と非同期委譲**:
   - HTTP リクエスト内で行う処理量は厳格に制限。重い処理・再生成は Queue（`fast-jobs`, `content-jobs`, `sync-jobs`）へ委譲。
4. **URL 体系の維持**:
   - 新規の独自プレフィックス（`/api/v1` 等）を勝手に作らず、CURRENT の `/api/*` パス構造（RH-001〜RH-033）を原則維持。

---

# 2. Phase 6 タスク別詳細仕様書（実 API 対応）

### MIG-0601: low-risk reads（低リスク参照系 API）
- **対象**:
  - `GET /api/health` (RH-018)
  - `GET /api/health/deep` (RH-017, WORKER_ADMIN_TOKEN 認証)
  - `GET /api/public/about-stats` (RH-026, R2 静的アーティファクト参照)
  - `GET /api/software/suggestions` (RH-029, ソフトウェア候補)
- **仕様**: `packages/domain` または静的キャッシュから DTO を返却。
- **検証**: 単体テスト + CPU 時間実測。

### MIG-0602: low-risk mutations（低リスク更新系 API）
- **対象**:
  - 単一テーブル更新、監査ログ記録、軽量な更新処理（announcements, api-endpoints, settings 等のドメイン呼び出し）。
- **仕様**: 認証ミドルウェアで Auth User を特定し、Zod バリデーション後に `packages/domain` を実行。

### MIG-0603: video APIs（動画・チャプター API）
- **対象**:
  - `GET /api/videos` (RH-032)
  - `GET /api/videos/:id` (RH-030)
  - `GET /api/videos/:id/viewer-overlay` (RH-031, セッション依存オーバーレイ)
  - 動画・チャプター更新エンドポイント（SA-012〜015, SA-087, SA-089 を受ける Hono エンドポイント）
- **仕様**:
  - `canEditVideo`（PR #265 一本化ロジック）による厳格な認可。
  - チャプター削除時のコメント論理保持（浮遊コメント化）。
  - 更新後の静的再生成 Queue wake 送信。

### MIG-0604: event/slot APIs（イベント・枠 API）
- **対象**:
  - `GET /api/events` (RH-015)
  - `GET /api/live/events/:id/slots` (RH-020)
  - `GET /api/live/events/:id/submissions` (RH-021)
  - `GET /api/live/events/:id/summary` (RH-022)
  - `GET /api/events/:id/slots/viewer-overlay` (RH-014)
  - 枠予約・解放・イベント設定変更（SA-021〜039, SA-056〜068 を受ける Hono エンドポイント）
- **仕様**: オーナー 0 人禁止不変条件、連続枠上限の厳格検証。

### MIG-0605: user/X/admin APIs（ユーザー・X・管理 API）
- **対象**:
  - `GET /api/account/summary` (RH-001, presence / detail モード)
  - `GET /api/internal/x-users/search` (RH-019)
  - `GET /api/admin/spreadsheet/*` (RH-003〜009)
  - Active X 切り替え・連携・X ID マージ・モデレーション（SA-043〜055, SA-090〜106）
- **仕様**: `ACTIVE_X_MIGRATION_PLAN.md` に従い、未連携ユーザーへのモーダル誘導データを提供。

### MIG-0606: API CPU benchmark
- **目的**: 全エンドポイントについて、Cloudflare Workers Free 枠の CPU 時間 < 10ms（単純 read < 5ms, mutation < 8ms）を自動測定・検証。

### MIG-0607: Phase 6 Gate
- **完了条件**: RH-010/011（Auth.js GET/POST）はPhase 8まで現行Next側に維持し、**残り31メソッド**をHonoまたは同等の明示的な互換経路へ移行する。33メソッドすべてに移行先・HTTP method単位のルーティング・契約テスト・未移行の明示的なフォールバックを記録し、CPU予算を確認する。Phase 8前にAuth.jsをHonoへ一括移行したと誤判定しない。
