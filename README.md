# FlameNode

> 映像（フレーム）の結節点（ノード）。YouTube 埋め込みを利用した動画プラットフォーム。

イベント参加手続き、スロット確保、投稿審査、振り返り上映、第三者イベント開催を一体で扱う、Cloudflare ネイティブな動画アーカイブサイトです。

詳細な仕様・設計は [`設計/`](./設計) 配下のドキュメントを参照してください。

## 技術スタック

- **フレームワーク**: Next.js 15 (App Router) + React 19 + TypeScript
- **DB**: Cloudflare D1 (SQLite) + Drizzle ORM
- **ストレージ**: Cloudflare R2
- **キャッシュ**: Cloudflare KV
- **背景処理**: Cloudflare Workers (Cron Triggers) + Durable Objects
- **認証**: Auth.js (NextAuth v5) + Discord OAuth
- **スタイル**: 純粋 CSS (`src/styles/globals.css` のグローバルユーティリティ + 各コンポーネント `*.module.css`) と CSS カスタムプロパティ。Tailwind は使用しない。Light / Dark / System を `data-theme` で切替。

## ディレクトリ構成

```
app/                 # Next.js App Router
  (public)/          # 公開エリア (ログイン不要)
  (auth)/            # ユーザーエリア (要 Discord ログイン)
  (admin)/           # 運営エリア
  api/               # Route Handlers / Auth.js / Webhooks
src/
  components/        # React コンポーネント
  actions/           # Server Actions
  lib/               # DB, 認証, 外部連携, ユーティリティ
  hooks/             # カスタムフック
  types/             # TypeScript 型定義
workers/             # Cloudflare Workers (Cron, Durable Objects)
migrations/          # Drizzle マイグレーション
設計/                 # 設計仕様 (Single Source of Truth)
```

## 開発手順

```sh
# 依存関係インストール
npm install

# .dev.vars を用意
cp .dev.vars.example .dev.vars

# 開発サーバ
npm run dev

# DB マイグレーション (D1)
npm run db:generate
npm run db:migrate

# 型チェック
npm run typecheck

# プロダクションビルド
npm run build
```

## 実装済み機能 (v0.1)

- 公開エリア
  - トップページ (横スクロール棚 / 開催中イベントバンド / おすすめ・最新・クリエイター・イベントセクション)
  - 作品一覧 `/list` (検索・並び替え・ページング) と `/search` リダイレクト
  - 作品詳細 `/[id]` (独自 YouTube プレイヤー、チャプター/コメントタブ、関連動画レール)
  - イベント `/event`, `/event/[id]` (期間・スタッフ・スロット・作品グリッド)
  - クリエイタープロフィール `/user/[id]`
  - 利用規約 `/rules`、メンテナンス `/maintenance`、おすすめ `/recommend`
- 認証エリア (Discord OAuth + Auth.js)
  - エントリー `/entry`
  - ダッシュボード `/dashboard` (アクティブスロット / マイギャラリー / X ID 連携状況)
  - 投稿 `/dashboard/post`、スロット提出 `/dashboard/post/slotted`、編集 `/dashboard/edit/[id]`
  - 設定 `/dashboard/settings`
- 管理エリア (`role === "admin"` ガード)
  - 総合ダッシュボード `/admin` (要対応タスク・コストガード状態)
  - 作品 / ユーザー / イベント / お知らせ / 規約 / 履歴 / コストガード / レガシーインポート
- Server Actions: 自由投稿 / スロット提出 / コストガード切替
- Cloudflare Workers: `json-generator`, `cleanup`, `youtube-sync`, `score-recalc`, `notification-dispatcher`

## デザイン原則 (要旨)

- 作品優先・高密度。装飾より作品サムネイルとカードの並びを優先する。
- 黄色 (`#FFD400`) を主アクセントとし、CTA・選択中・フォーカス・アクティブ X ID に統一して使う。
- イベント別アクセントカラーが設定されている場合はそれを優先。
- ライト / ダーク両対応。同じ配置・密度で実装する。
- 絵文字は UI に使わない。Font Awesome / Lucide / Material Symbols 等の正規 SVG アイコンを使う。

設計の Single Source of Truth は `設計/FlameNode-Design.md` および `設計/FlameNode-Design-System.md`、各ページ設計図 (`設計/設計app/**/*.md`) です。
