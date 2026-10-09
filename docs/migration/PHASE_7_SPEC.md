# FlameNode Phase 7 タスク仕様書（Private SPA Spec）

> 状態: Active / Phase 7 実行向け仕様書
> 最終検証: 2026-10-09（`CURRENT_ROUTES.md` の Personal 6, Entry 3, Manage 12, Admin 45 に基づき改定）
> 対象モデル: Claude / Codex / Antigravity / GPT-5.6-luna / Gemini Flash 等の全エージェント
> 関連ドキュメント: [`README.md`](README.md), [`STATUS.md`](STATUS.md), [`CURRENT_ROUTES.md`](CURRENT_ROUTES.md), [`UI_MIGRATION_GUIDE.md`](UI_MIGRATION_GUIDE.md), [`ROUTING_AND_DEPLOY_PLAN.md`](ROUTING_AND_DEPLOY_PLAN.md), [`OPEN_DECISIONS.md`](OPEN_DECISIONS.md) (D-05)

---

# 1. Private SPA の基本方針

1. **React + Vite による SPA (Single Page Application)**:
   - `apps/app` は純粋なクライアントサイド SPA としてビルドされ、Cloudflare Workers Static Assets から静的配信。
   - ルーティングは `react-router-dom` を使用し、ブラウザ遷移で高速に動作。
2. **デザイン適用戦略（案A）の遵守**:
   - 管理・マイページ・登録画面はデザイン全面刷新を行わず、現行の UI/コンポーネント資産（`packages/ui`）を流用して移行効率を最大化。
   - `@flamenode/ui` のアダプター（`setLinkComponent`, `setNavigatorAdapter`）に `react-router-dom` を注入。
3. **SPA ルーティング・ベースパス（D-05 参照）**:
   - `apps/app` は `/dashboard/*`, `/entry/*`, `/manage/*`, `/admin/*`, `/onboarding` を担当。
   - アセットディレクトリは `/_app_assets/*` を使用し、他 Worker との衝突を防止。

---

# 2. Phase 7 タスク別詳細仕様書（実ルート対応）

### MIG-0701: dashboard read-only（Personal 参照系画面）
- **対象画面** (`CURRENT_ROUTES.md` Personal 6 ルート):
  - `/dashboard`（マイページ・状態把握）
  - `/dashboard/library`（保存・いいね・自作品・共同編集一覧、Active X 主体で表示）
  - `/dashboard/settings`（プロフィール・X ID 連携設定）
  - `/dashboard/youtube-playlists`（互換リダイレクト）
- **仕様**: Hono API からデータをフェッチし、現行 UI コンポーネントで描画。

### MIG-0702: dashboard mutations（Personal 更新系機能）
- **対象機能**:
  - プロフィール編集・Active X 切り替え（SA-098〜105）
  - **Active X 登録・連携モーダル**: 未連携ユーザーがいいね/ブックマークを試みた際の誘導モーダルを完全実装。
  - 通知一覧・既読化操作

### MIG-0703: entry（Entry 画面群）
- **対象画面** (`CURRENT_ROUTES.md` Entry 3 ルート):
  - `/entry`（ログイン・条件確認・投稿種別選択）
  - `/entry/slotted`（枠確保済み作品提出）
  - `/entry/unslotted`（枠なし作品通常登録）
  - `/dashboard/edit/[id]`, `/dashboard/edit/[id]/permissions`（作品情報・共同編集権限編集）
- **仕様**: 作品編集権限判定（PR #265 一本化ロジック）を厳格に適用。

### MIG-0704: manage（Manage イベント運営画面群）
- **対象画面** (`CURRENT_ROUTES.md` Manage 12 ルート):
  - `/manage`（担当イベント一覧）
  - `/manage/events/[id]`（イベント基本設定）
  - `/manage/events/[id]/audience`（観客・参加者情報）
  - `/manage/events/[id]/edit`（イベント設定編集）
  - `/manage/events/[id]/slots`（スロットタイムテーブル編集）
  - `/manage/events/[id]/staff`（スタッフ・オーナー権限管理）
  - `/manage/events/[id]/videos`, `.../videos/[videoId]`（イベント提出作品管理・審査）
  - `/manage/events/[id]/youtube-playlist`（再生リスト連携）
  - `/manage/notifications`（通知障害確認・再試行）
  - `/manage/x-link-requests`（X 連携リクエスト審査）
- **仕様**: オーナー 0 人禁止の不変条件（FN-X-001）を防御。

### MIG-0705: admin（Admin 全体管理者画面群）
- **対象画面** (`CURRENT_ROUTES.md` Admin 45 ルート):
  - `/admin`（ダッシュボード）
  - `/admin/announcements/*`（お知らせ管理）
  - `/admin/api-endpoints`（エンドポイント設定）
  - `/admin/audit/*`（監査ログ・復元）
  - `/admin/cost-guard`（運用モード・コストガード）
  - `/admin/event-groups/*`（イベントグループ管理）
  - `/admin/events/*`（全イベント管理）
  - `/admin/health/*`, `/admin/security`（ヘルス・セキュリティ診断）
  - `/admin/import`（レガシーインポート）
  - `/admin/moderation`（モデレーション管理）
  - `/admin/notifications`（全体通知再試行）
  - `/admin/permissions/simulator`（権限シミュレータ）
  - `/admin/rules/*`（利用規約管理）
  - `/admin/spreadsheet`（DB テーブル閲覧・安全編集）
  - `/admin/static-builds`（静的ビルド再生成管理）
  - `/admin/users/*`（ユーザー検索・詳細・BAN・ロール付与）
  - `/admin/videos/*`（全動画管理・メンバー編集）
  - `/admin/workers`（Worker 稼働状態監視）
  - `/admin/x-id-merges`（X ID 統合・差し戻し）
  - `/admin/x-link-requests`（X 連携申請処理）
  - `/admin/youtube-quota`, `/admin/youtube-sync/*`（YouTube クォータ・同期管理）

### MIG-0706: Phase 7 Gate
- **完了条件**: 全 Personal (6), Entry (3), Manage (12), Admin (45) 画面の SPA 移行完了、全 Server Action の Hono 移行完了、ロールバック安全性実証。
