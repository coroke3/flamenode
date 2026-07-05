# FlameNode

> 映像（フレーム）の結節点（ノード）。YouTube 埋め込みを利用した動画プラットフォーム。

イベント参加手続き、スロット確保、投稿審査、振り返り上映、第三者イベント開催を一体で扱う、Cloudflare ネイティブな動画アーカイブサイトです。

- 設計仕様 (SSoT): [`設計/`](./設計) 配下 (`FlameNode-Design.md`, `FlameNode-Design-System.md`, `設計app/**/*.md`)
- ローカル動作手順: [`LOCAL.md`](./LOCAL.md) / デプロイ手順: [`DEPLOY.md`](./DEPLOY.md)
- 運用手順: [`docs/operations.md`](./docs/operations.md) / 実装状況・残タスク: [`docs/implementation-backlog.md`](./docs/implementation-backlog.md)
- AI エージェント向けガイド: [`AGENTS.md`](./AGENTS.md)

## 技術スタック

- **フレームワーク**: Next.js 15 (App Router) + React 19 + TypeScript
- **DB**: Cloudflare D1 (SQLite) + Drizzle ORM（D1 が正本。R2/KV の静的 JSON は配信用キャッシュ）
- **ストレージ / キャッシュ**: Cloudflare R2 / KV
- **背景処理**: Cloudflare Workers (Cron 3本: `fast-jobs` / `content-jobs` / `sync-jobs`) + Durable Objects
- **認証**: Auth.js (NextAuth v5) + Discord OAuth
- **スタイル**: 純粋 CSS (`src/styles/globals.css` のグローバルユーティリティ + 各コンポーネント `*.module.css`) と CSS カスタムプロパティ。Tailwind は使用しない。Light / Dark / System を `data-theme` で切替。

## ディレクトリ構成

```
app/                 # Next.js App Router
  (public)/          # 公開エリア (ログイン不要)
  (auth)/            # ユーザーエリア (要 Discord ログイン)
  (manage)/          # イベント運営エリア (event_staff 権限)
  (admin)/           # 運営エリア (role === "admin")
  api/               # Route Handlers / Auth.js / Webhooks
src/
  components/        # React コンポーネント
  lib/               # DB, 認証, 権限, Server Actions, 通知, publicData, ユーティリティ
  styles/            # グローバル CSS
workers/             # Cloudflare Workers (統合3本 + import 用モジュール)
migrations/          # D1 マイグレーション
scripts/             # 運用・検査スクリプト
instrumentation.ts   # ローカル dev 時に Miniflare で D1/R2/KV を自動起動
設計/                 # 設計仕様 (Single Source of Truth)
```

## 開発手順

```sh
npm install
cp .dev.vars.example .dev.vars   # シークレットを記入 (LOCAL.md 参照)

npm run dev          # 開発サーバ (Miniflare が D1/R2/KV を自動起動、migration も冪等 apply)
npm run typecheck    # 型チェック
npm run build        # プロダクションビルド
npm run test:unit    # 単体テスト (node:test)

npm run db:local-apply  # ローカル D1 へ migration 適用
# スキーマ変更時は手動 SQL migration を作成 (docs/operations.md §1 参照。db:generate は現在使わない)
```

## 主な機能

- **公開エリア**: トップ / 作品一覧 `/list` / 作品詳細 (独自 YouTube プレイヤー、チャプターコメント) / イベント `/event` / クリエイタープロフィール `/user/[id]` / 規約・お知らせ
- **ユーザーエリア** (Discord OAuth): ダッシュボード、イベント参加・投稿 `/entry`、スロット提出、作品編集、X ID 連携申請、ライブラリ (いいね・セーブ)
- **運営エリア** `/manage`: イベントスタッフ向けの受信箱・スロット運営・メンバー管理 (permission_mask による細分権限)
- **管理エリア** `/admin`: 作品 / ユーザー / イベント / お知らせ / 規約 / 監査ログ / 通知 / コストガード / health・security チェック / レガシーインポート / DB スプレッドシート
- **背景処理**: 静的 JSON 再生成 (R2/KV 配信)、YouTube 同期、スコア再計算、通知ディスパッチ、TTL クリーンアップ

## デザイン原則 (要旨)

- 作品優先・高密度。装飾より作品サムネイルとカードの並びを優先する。
- 黄色 (`#FFD400`) を主アクセントとし、CTA・選択中・フォーカス・アクティブ X ID に統一して使う。イベント別アクセントカラーがあればそれを優先。
- ライト / ダーク両対応。同じ配置・密度で実装する。
- 絵文字は UI に使わない。正規 SVG アイコン (Lucide 等) を使う。
