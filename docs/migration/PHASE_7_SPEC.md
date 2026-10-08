# FlameNode Phase 7 タスク仕様書（Private SPA Spec）

> 状態: Active / Phase 7 実行向け完全仕様書
> 対象モデル: Claude / Codex / Antigravity / GPT-5.6-luna / Gemini Flash 等の全エージェント
> 関連ドキュメント: [`README.md`](README.md), [`STATUS.md`](STATUS.md), [`UI_MIGRATION_GUIDE.md`](UI_MIGRATION_GUIDE.md), [`ROUTING_AND_DEPLOY_PLAN.md`](ROUTING_AND_DEPLOY_PLAN.md)

このドキュメントは、管理・ダッシュボード画面の移行（Phase 7: Private React SPA）を軽量モデルでも一切迷わずに実装できるよう、全タスクの目的・作成ファイル・コード仕様・禁止事項・検証コマンドを完全に具体化した仕様書である。

---

# 1. Private SPA の基本方針

1. **React + Vite による SPA (Single Page Application)**:
   - `apps/app` は純粋なクライアントサイド SPA としてビルドされ、Cloudflare Workers Static Assets または Pages から静的配信される。
   - ルーティングは `react-router-dom` を使用し、ブラウザ遷移で高速に動作する。
2. **デザイン適用戦略（案A）の遵守**:
   - 管理画面はデザイン刷新を行わず、現行の UI/コンポーネント資産（`packages/ui`）をそのまま流用して移行効率を最優先とする。
   - `packages/ui` のアダプター（`setLinkComponent`, `setNavigatorAdapter`）に `react-router-dom` を注入して動作させる。
3. **アセット隔離と名前空間**:
   - `apps/app/vite.config.ts` で `base: "/dashboard/"`, `assetsDir: "_app_assets"` を設定し、他 Worker との衝突を完全に防止する。

---

# 2. Phase 7 タスク別詳細仕様書

### MIG-0701: dashboard read-only（ダッシュボード参照系）
- **対象画面**:
  - `/dashboard`（マイページ・投稿作品一覧）
  - `/dashboard/events`（参加中イベント一覧）
  - `/dashboard/library`（保存・いいねした作品一覧）
- **仕様**:
  - Active X 主体でライブラリを表示。
  - Hono API からデータを TanStack Query でフェッチ。

### MIG-0702: dashboard mutations（ダッシュボード更新系）
- **対象機能**:
  - プロフィール編集
  - **Active X 登録・連携モーダル**: 未連携ユーザーがいいね/ブックマーク/投稿を試みた際に表示される誘導モーダルを完全実装。
  - 通知一覧・既読化操作

### MIG-0703: entry（作品提出・枠確保画面）
- **対象画面**:
  - `/dashboard/entry/[eventId]`（枠取得・連続枠選択）
  - `/dashboard/edit/[id]`（作品情報編集・YouTube URL 入力・チャプター編集）
- **仕様**: PR #265 で一本化した作品編集権限判定に準拠。

### MIG-0704: manage（イベント運営管理画面）
- **対象画面**:
  - `/manage/events/[id]`（イベント基本設定）
  - `/manage/events/[id]/slots`（スロットタイムテーブル編集）
  - `/manage/events/[id]/collaborators`（スタッフ権限管理）
- **仕様**: オーナー 0 人禁止の不変条件をクライアントおよび API で防御。

### MIG-0705: admin（全体管理者画面）
- **対象画面**:
  - `/admin/x-users`（Active X 申請一覧・承認/却下）
  - `/admin/x-users/merge`（X ID 統合・7日間差し戻し機能）
  - `/admin/moderation`（通報・モデレーション管理）
  - `/admin/system`（Cloudflare 利用量・クォータモニタリング）

### MIG-0706: Phase 7 Gate
- **完了条件**: 全管理画面の SPA 化完了、全 Server Action の Hono API 切り替え完了、ロールバック安全性の実証。
