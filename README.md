# FlameNode

> Status: Active
> Last verified: 2026-07-14
> Verified against commit: `6dbe07a`
> Source of truth: `src/lib/db/schema.ts`, `migrations/`, `docs/README.md`, `package.json`

YouTube埋め込みを使い、イベント参加、枠確保、投稿審査、上映、アーカイブを一体で扱うCloudflareネイティブな動画プラットフォーム。

## 最初に読む

- AI作業: [`AGENTS.md`](AGENTS.md) → [`docs/AI_CONTEXT.md`](docs/AI_CONTEXT.md)の該当タスク行
- 文書索引: [`docs/README.md`](docs/README.md)
- ローカル起動: [`LOCAL.md`](LOCAL.md)
- デプロイ: [`DEPLOY.md`](DEPLOY.md)
- 運用: [`docs/operations/README.md`](docs/operations/README.md)
- DB変更履歴: [`docs/database/change-log.md`](docs/database/change-log.md)

長い資料やHistorical文書を先に一括読込せず、対象コードと関連testを優先する。

## 現行構成

| 領域 | 構成 |
| --- | --- |
| Web | Next.js 15 App Router、React 19、TypeScript |
| Hosting | Cloudflare Pages + `@cloudflare/next-on-pages` |
| Data | D1 + Drizzle ORM、R2、KV |
| Background | Cron Worker 3本: `fast-jobs` / `content-jobs` / `sync-jobs` |
| Auth | Auth.js v5 + Discord OAuth |
| UI | CSS Modules + CSS custom properties。Tailwind不使用 |

## 主要ディレクトリ

```text
app/          # public / auth / manage / admin / API
src/          # components / lib / styles
workers/      # Cron Worker 3本と共有module
migrations/   # active D1 migration
scripts/      # 検査・運用script
docs/         # Active運用文書と履歴索引
設計/         # 製品・UI設計
```

## 最短ローカル起動

```sh
npm ci
cp .dev.vars.example .dev.vars
npm run db:local-apply
npm run dev
```

詳細とPowerShell手順は[`LOCAL.md`](LOCAL.md)を参照する。

## 不変条件

- DB正本は`src/lib/db/schema.ts`。既適用migration本文を変更しない。
- `event_staff.permission_preset = 'owner'`をイベント代表者の正本とする。
- 権限はUIだけでなくServer ActionまたはRoute Handlerで検証する。
- 公開APIは明示DTOだけを返す。
- 旧列fallback、二重書込み、runtime DDLをActive codeへ戻さない。
- Pages、D1、R2、KV、Cron Worker 3本の構成を維持する。

## 主な機能

- 公開: トップ、作品、イベント、クリエイター、規約・告知
- ユーザー: イベント参加、2系統投稿、枠提出、作品編集、X ID、ライブラリ
- 運営 `/manage`: 審査、枠、参加者、スタッフ、通知
- 管理 `/admin`: 作品、ユーザー、イベント、監査・復元、import、DB運用
- 背景処理: 静的JSON、YouTube同期、score、通知、cleanup

## 検査

変更種別ごとの検査は[`docs/AI_CONTEXT.md`](docs/AI_CONTEXT.md)を使う。全検査一覧は[`AGENTS.md`](AGENTS.md)に集約する。
