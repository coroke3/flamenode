# FlameNode

> Status: Active
> Last verified: 2026-07-13
> Verified against commit: `agent/free-tier-background-worker`
> Source of truth: `src/lib/db/schema.ts`, `migrations/` active path, `docs/README.md`, `package.json`

> 映像（フレーム）の結節点（ノード）。YouTube 埋め込みを利用した動画プラットフォーム。

イベント参加手続き、スロット確保、投稿審査、振り返り上映、第三者イベント開催を一体で扱う、Cloudflare ネイティブな動画アーカイブサイトです。

- 現行文書の索引: [`docs/README.md`](./docs/README.md)
- 設計仕様: [`設計/`](./設計) 配下
- ローカル動作手順: [`LOCAL.md`](./LOCAL.md)
- デプロイ手順: [`DEPLOY.md`](./DEPLOY.md)
- 運用手順: [`docs/operations/README.md`](./docs/operations/README.md)
- DB変更履歴の正本: [`docs/database/change-log.md`](./docs/database/change-log.md)
- migration詳細索引: [`docs/db-history/README.md`](./docs/db-history/README.md)
- AIエージェント向けガイド: [`AGENTS.md`](./AGENTS.md)

## 技術スタック

- **フレームワーク**: Next.js 15 (App Router) + React 19 + TypeScript
- **DB**: Cloudflare D1 (SQLite) + Drizzle ORM
- **ストレージ / キャッシュ**: Cloudflare R2 / KV
- **背景処理**: Cloudflare Workers（`background-jobs` 1本、5分・1時間の2 Cron）
- **認証**: Auth.js (NextAuth v5) + Discord OAuth
- **スタイル**: CSS ModulesとCSSカスタムプロパティ。Tailwindは使用しない。Light / Dark / Systemを切り替える。
- **ホスティング**: Cloudflare Pages + `@cloudflare/next-on-pages`

## ディレクトリ構成

```text
app/                 # Next.js App Router
  (public)/          # 公開エリア
  (auth)/            # ログイン利用者エリア
  (manage)/          # イベント運営エリア
  (admin)/           # サイト管理エリア
  api/               # Route Handlers / Auth.js
src/
  components/        # Reactコンポーネント
  lib/               # DB、認証、権限、Server Actions、通知、公開DTO
  styles/            # CSS
workers/             # background-jobs入口と共有処理module
migrations/          # active D1 migration。旧本文はhistorical配下
scripts/             # 運用・検査script
設計/                 # 製品・UI設計
```

## 最短ローカル起動

```sh
npm ci
cp .dev.vars.example .dev.vars
npm run db:local-apply
npm run dev
```

詳細は [`LOCAL.md`](./LOCAL.md) を参照してください。DB変更時は自動生成へ戻さず、schema、追加migration、DB変更履歴、詳細文書、テストを同時に更新します。

## 必須検査

```sh
npm run typecheck
npm run lint
npm run test:unit
npm run test:workers
npm run test:integration
npm run build
npm run pages:build
npm run check:pages-output
npm run check:cloudflare-template
npm run check:db-schema
npm run check:db-legacy
npm run check:event-owners
npm run check:ui-acceptance
npm run check:public-api-leaks
npm run check:docs
npm run check:db-history
npm run check:project-docs
```

## 主な機能

- **公開エリア**: トップ、作品一覧、作品詳細、イベント、クリエイタープロフィール、規約・お知らせ
- **ユーザーエリア**: `/entry`のイベント参加・2系統投稿、スロット提出、作品編集、X ID連携、ライブラリ
- **イベント運営** `/manage`: 審査、枠、参加者、スタッフ、通知。`permission_preset`を権限正本とする
- **サイト管理** `/admin`: 作品、ユーザー、イベント、規約、監査・復元、通知、legacy import、DB spreadsheet
- **背景処理**: 静的JSON、YouTube同期、score、通知、cleanupを1 Worker内のbounded jobとして処理

## デザイン原則

- 作品優先・高密度。作品カードの情報量を増やさない。
- ライムを正式アクセントとし、イベント別accentがある画面ではcontrastを確保して併用する。
- Light / Dark / Systemで同じ配置と操作を維持する。
- UIへ絵文字を使わず、既存のSVGアイコンを使用する。
