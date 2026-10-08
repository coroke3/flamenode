# FlameNode Phase 6 タスク仕様書（Hono API Spec）

> 状態: Active / Phase 6 実行向け完全仕様書
> 対象モデル: Claude / Codex / Antigravity / GPT-5.6-luna / Gemini Flash 等の全エージェント
> 関連ドキュメント: [`README.md`](README.md), [`STATUS.md`](STATUS.md), [`API_MATRIX.md`](API_MATRIX.md), [`CODE_QUALITY.md`](CODE_QUALITY.md)

このドキュメントは、バックエンド HTTP API 移行（Phase 6: Hono API）を軽量モデルでも一切迷わずに実装できるよう、全タスクの目的・作成ファイル・コード仕様・禁止事項・検証コマンドを完全に具体化した仕様書である。

---

# 1. Hono API の基本方針

1. **薄いトランスポート層（Thin Adapter）**:
   - `apps/api` は HTTP 入出力（リクエストパース、Zod バリデーション、レスポンス成形、ステータスコード）のみを担当する。
   - ビジネスロジック・権限判定・D1 トランザクションはすべて `packages/domain` へ委譲する。
2. **共有 Zod 契約（`packages/contracts`）**:
   - リクエストボディおよびレスポンス DTO は `packages/contracts` の Zod スキーマで型定義する。
   - 内部テーブルのカラムをそのまま漏洩（DB Leak）させず、明示的 DTO のみを返す。
3. **有界な CPU 時間（< 10ms）と非同期委譲**:
   - HTTP リクエスト内で行う処理量は厳格に制限する。重い生成・同期・集約処理は即座に Queue または Durable Object へ委譲し、HTTP は 202 Accepted または軽量な結果を返す。

---

# 2. Phase 6 タスク別詳細仕様書

### MIG-0601: low-risk reads（低リスク参照系 API）
- **エンドポイント**:
  - `GET /api/v1/software`（ソフトウェア一覧）
  - `GET /api/v1/software/:id`
  - `GET /api/v1/health`（ヘルスチェック）
- **作成ファイル**: `apps/api/src/routes/software.ts`, `apps/api/src/routes/health.ts`
- **仕様**: `packages/domain` の `getSoftwareList` を呼び出し、明示的 DTO を返却。

### MIG-0602: low-risk mutations（低リスク更新系 API）
- **エンドポイント**:
  - `POST /api/v1/notifications/read`（通知既読化）
  - `POST /api/v1/software`（管理者用ソフトウェア追加）
- **仕様**: 認証ミドルウェアで Auth User を特定し、Zod バリデーション後に `packages/domain` を実行。

### MIG-0603: video APIs（動画管理・編集 API）
- **エンドポイント**:
  - `PATCH /api/v1/videos/:id`（作品メタデータ更新）
  - `POST /api/v1/videos/:id/status`（公開状態遷移・承認・却下）
  - `POST /api/v1/videos/:id/chapters`（チャプター追加・更新）
- **仕様**:
  - `canEditVideo` による権限源ごとの厳格な認可。
  - チャプター削除時は浮遊コメントとして論理保持。
  - 更新後は静的再生成 Queue へ wake イベントを送信。

### MIG-0604: event/slot APIs（イベント・枠予約 API）
- **エンドポイント**:
  - `POST /api/v1/events`
  - `PATCH /api/v1/events/:id`
  - `POST /api/v1/events/:id/slots/reserve`（枠予約）
  - `POST /api/v1/events/:id/slots/release`（枠解放）
- **仕様**: 連続枠上限（`validateSlotReservationLimit`）およびオーナー不変条件の厳格検証。

### MIG-0605: user/X/admin APIs（ユーザー・Active X・管理 API）
- **エンドポイント**:
  - `POST /api/v1/users/active-x`（Active X 申請・連携）
  - `POST /api/v1/admin/x-users/:id/approve`（X ID 承認・却下）
  - `POST /api/v1/admin/x-users/merge`（X ID 統合・差し戻し）
- **仕様**: `ACTIVE_X_MIGRATION_PLAN.md` に従い、未連携ユーザーへのモーダル誘導データを提供。

### MIG-0606: API CPU benchmark
- **目的**: 全エンドポイントについて、Cloudflare Workers Free 枠の 10ms 制限を下回ることを自動ベンチマークテストで測定・検証。

### MIG-0607: Phase 6 Gate
- **完了条件**: 全 33 個の Route Handler の Hono 化完了、全 API 契約テスト合格、CPU 時間 < 10ms 証明。
