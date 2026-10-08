# FlameNode Phase 8 & 9 タスク仕様書（Auth Migration & Next.js Retirement Spec）

> 状態: Active / Phase 8 & 9 実行向け完全仕様書
> 対象モデル: Claude / Codex / Antigravity / GPT-5.6-luna / Gemini Flash 等の全エージェント
> 関連ドキュメント: [`README.md`](README.md), [`STATUS.md`](STATUS.md), [`auth/README.md`](auth/README.md), [`ROUTING_AND_DEPLOY_PLAN.md`](ROUTING_AND_DEPLOY_PLAN.md)

このドキュメントは、認証層のネイティブ移行（Phase 8: Auth）および旧 Next.js / OpenNext の完全退役（Phase 9: Next/OpenNext Retirement）を軽量モデルでも一切迷わずに実装できるよう、全タスクの目的・作成ファイル・コード仕様・禁止事項・検証コマンドを完全に具体化した仕様書である。

---

# 1. Phase 8: Auth タスク別詳細仕様書

### 基本方針
Next.js 密結合の Auth.js から、Web Standards に準拠した Cloudflare Workers ネイティブな認証層（Hono Auth ミドルウェア / Discord OAuth）へ移行する。ユーザーの既存セッションや Discord 連携データを破壊しない。

### MIG-0801: Auth baseline fixtures/tests
- **目的**: 現行の Discord ログイン、セッション更新、Active X 解決、ロール判定の挙動を固定する回帰テストフィクスチャを作成。

### MIG-0802: Web Standard/Auth integration PoC
- **目的**: Hono 上で Discord OAuth2 PKCE フローを処理し、セッション Cookie を発行するプロトタイプを実装。

### MIG-0803: Discord/account-linking parity
- **目的**: 既存の `users`, `accounts`, `sessions` テーブルとの 100% 互換性を検証。未連携ユーザーへの Active X 登録フローと連動。

### MIG-0804: CPU/security review
- **目的**: 認証リクエスト時の D1 クエリ数を最小化し、CPU 時間 < 5ms、CSRF / セッションハイジャック防止のセキュリティ監査を実施。

### MIG-0805: production cutover proposal
- **目的**: 本番の Discord Client ID / Secret を新 Worker へ移行し、現行 Next.js との二重稼働を安全に切り替える手順書を作成。

### MIG-0806: Phase 8 Gate
- **完了条件**: 新認証システムでのログイン・ログアウト・セッション維持の合格判定。

---

# 2. Phase 9: Next/OpenNext Retirement タスク別詳細仕様書

### 基本方針
新システム（`apps/site`, `apps/app`, `apps/api`）への全トラフィック切り替えが完了し、本番での安定稼働（1102 エラー 0 件）を確認した後、旧 Next.js コードを安全に削除してモノレポ構造を完成させる。

### MIG-0901: production traffic cutover verification
- **目的**: `flamenode.net` の全トラフィックが新 Worker（Astro / Vite / Hono）で処理されていることを Cloudflare ダッシュボードで確認。`flamenode-web` へのリクエストが 0 であることを検証。

### MIG-0902: Next.js dependencies cleanup
- **目的**: ルート `package.json` から `next`, `open-next`, `@opennextjs/cloudflare` 等の Next.js 固有依存パッケージを安全に削除し、`npm ci` を再検証。

### MIG-0903: legacy app/ and src/ tree deletion
- **目的**: 新パッケージ（`packages/*`, `apps/*`）へ移行完了した旧ディレクトリ（`app/`, `src/lib/` 内の互換ブリッジ等）を安全に削除。

### MIG-0904: final repository boundary verification
- **目的**: モノレポ構造（`apps/site`, `apps/app`, `apps/api`, `packages/ui`, `packages/domain`, `packages/contracts`, `workers/*`）の依存関係が完全に閉じており、循環参照や孤立ファイルがないことを検証。

### MIG-0905: Phase 9 Gate & Migration Complete
- **完了条件**:
  - 全 432 UX 機能、全 136 FN 機能のパリティ確認完了。
  - Cloudflare Workers Free 枠での 1102 CPU 超過エラー 0 件。
  - 移行プロジェクトの完了を `STATUS.md` に記録。
