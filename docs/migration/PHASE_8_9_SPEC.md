# FlameNode Phase 8 & 9 タスク仕様書（Auth Migration & Next.js Retirement Spec）

> 状態: Active / Phase 8 & 9 実行向け仕様書
> 最終検証: 2026-10-09（`auth/README.md` の認証ベースラインおよび `OPEN_DECISIONS.md` D-07 に基づき改定）
> 対象モデル: Claude / Codex / Antigravity / GPT-5.6-luna / Gemini Flash 等の全エージェント
> 関連ドキュメント: [`README.md`](README.md), [`STATUS.md`](STATUS.md), [`auth/README.md`](auth/README.md), [`OPEN_DECISIONS.md`](OPEN_DECISIONS.md) (D-02, D-07)

---

# 1. Phase 8: Auth タスク別詳細仕様書

### 基本方針（D-07 参照）
`README.md` §13: 「自前 auth protocol を新規実装しない」。
Next.js 固有のラッパーから Web Standards 準拠の Auth.js（`@auth/core` 等）と既存 D1 database session アダプターを継続利用し、既存の `user`, `account`, `session` テーブルおよび Cookie 契約を 100% 維持する。移行時に全ユーザーが強制ログアウトされる事態を防止。

### MIG-0801: Auth baseline fixtures/tests
- **目的**: 現行の Discord ログイン、セッション復元、Active X 解決、ロール判定の挙動を固定する回帰テストフィクスチャを作成。

### MIG-0802: Web Standard/Auth integration PoC
- **目的**: Hono 上で `@auth/core` を稼働させ、既存の D1 `session` テーブル・Cookie トークンを正しく検証・読み書きできることを検証。

### MIG-0803: Discord/account-linking parity
- **目的**: `linkDiscordAccountAtomically`（`auth/README.md`）の不可分性・CAS 更新・重複拒否・べき等性契約を 100% 保持。

### MIG-0804: CPU/security review
- **目的**: 認証リクエスト時の D1 クエリ数を最小化し、CPU 時間（auth-heavy p95 < 9ms）、CSRF 防止、安全なリダイレクト（`/auth/complete`）を検証。

### MIG-0805: production cutover proposal
- **目的**: 本番の Discord Client ID / Secret、コールバック URL（`https://flamenode.net/api/auth/callback/discord`）を新 Worker へ移行する手順書を作成（**要ユーザー明示承認**）。

### MIG-0806: Phase 8 Gate
- **完了条件**: 新認証システムでの既存セッション継続、ログイン・ログアウト・アカウント連携の合格判定。

---

# 2. Phase 9: Next/OpenNext Retirement タスク別詳細仕様書

### 基本方針
新システム（`apps/site`, `apps/app`, `apps/api`）への全トラフィック切り替えが完了し、本番での安定稼働（1102 エラー 0 件）を確認した後、旧 Next.js コードを安全に削除してモノレポ構造を完成させる。

### MIG-0901: residual dependency inventory
- **目的**: `flamenode-web`（旧 Next.js）へのリクエストが 0 であることを Cloudflare ダッシュボードで確認。未移行ルートや未移行 Server Action が 0 件であることを検証。

### MIG-0902: rollback observation window
- **目的**: ロールバック待機期間（最低1週間等）を設け、本番での障害やデータ不整合がないことを継続監視。

### MIG-0903: remove legacy Server Actions/routes
- **目的**: `src/lib/actions/` および `app/api/` の旧 Server Action / Route Handler 実装を削除し、互換ブリッジを外す。

### MIG-0904: remove OpenNext/Next deploy path
- **目的**: ルート `package.json` から `next`, `open-next`, `@opennextjs/cloudflare` 等を削除し、`flamenode-web` のデプロイ設定を退役。

### MIG-0905: final architecture/docs consolidation
- **目的**: モノレポ構造（`apps/*`, `packages/*`, `workers/*`）が完全に自立していることを検証し、ドキュメントを最終更新。

### MIG-0906: Final Gate & Migration Complete
- **完了条件**:
  - 全 432 UX 機能、全 136 FN 機能のパリティ確認完了。
  - Cloudflare Workers Free 枠での 1102 CPU 超過エラー 0 件。
  - 移行プロジェクトの完了を `STATUS.md` に記録。
