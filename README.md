# FlameNode

> Status: Active
> Last verified: 2026-10-06
> Verified against commit: `99591f7b3387b6b33d113f2685d6b31e38085fdc`
> Source of truth: `src/lib/db/schema.ts`, `migrations/`, `docs/README.md`, `package.json`

YouTube埋め込みを使い、イベント参加、枠確保、投稿審査、上映、アーカイブを一体で扱うCloudflareネイティブな動画プラットフォーム。

## 最初に読む

- AI作業: [`AGENTS.md`](AGENTS.md) → [`docs/AI_CONTEXT.md`](docs/AI_CONTEXT.md)の該当タスク行
- **プラットフォーム移行**: [`docs/migration/README.md`](docs/migration/README.md) → [`docs/migration/STATUS.md`](docs/migration/STATUS.md)
- 文書索引: [`docs/README.md`](docs/README.md)
- ローカル起動: [`LOCAL.md`](LOCAL.md)
- デプロイ: [`DEPLOY.md`](DEPLOY.md)
- 運用: [`docs/operations/README.md`](docs/operations/README.md)
- DB変更履歴: [`docs/database/change-log.md`](docs/database/change-log.md)

長い資料やHistorical文書を先に一括読込せず、対象コードと関連testを優先する。

## 現行production構成

> この表は **CURRENT**。移行後TARGETではない。移行仕様は `docs/migration/README.md` を正本とする。

| 領域 | 構成 |
| --- | --- |
| Web | Next.js 15 App Router、React 19、TypeScript |
| Hosting | Cloudflare Workers + Workers Static Assets + `@opennextjs/cloudflare` (OpenNext) |
| Data | D1 + Drizzle ORM、R2、KV |
| Background | Queue 6本（wake 3 + DLQ 3）+ Recovery Cron 3本: `fast-jobs` / `content-jobs` / `sync-jobs` |
| CI/CD | Cloudflare Workers Builds。現行は`main`の単一BuildからWeb→Cron 3本を固定順deploy |
| Auth | Auth.js v5 + Discord OAuth |
| UI | CSS Modules + CSS custom properties。Tailwind不使用 |

## 移行TARGET

段階移行中。詳細・Phase・Acceptance Gateは [`docs/migration/README.md`](docs/migration/README.md)、現在地は [`docs/migration/STATUS.md`](docs/migration/STATUS.md) を正本とする。

要約:

- Public: Astro SSG + React Islands
- Public request: thin visibility gateway + Static Assets
- Private UI: React + Vite SPA
- API: Hono
- Data: D1 authoritative / R2 projection / Queue generation
- Jobs: 現行fast/content/sync Workersを原則維持
- URL: `flamenode.net` を維持し、Worker Routesで段階切替
- Next/OpenNext: parity・rollback・auth確認後にのみ撤去

移行タスクの標準入口:

```text
/flamenode-migration
```

反復実行:

```text
/loop /flamenode-migration
```

## 主要ディレクトリ

### CURRENT

```text
app/          # public / auth / manage / admin / API
src/          # components / lib / styles
workers/      # background Workerと共有module
migrations/   # active D1 migration
scripts/      # 検査・運用script
docs/         # Active運用文書と履歴索引
設計/         # 製品・UI設計
```

### TARGET boundary

実ディレクトリはPhase単位で追加する。先に既存コードを一括移動しない。

```text
apps/site
apps/app
apps/api
packages/ui
packages/domain
packages/contracts
packages/public-data
workers/*
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
- 権限はUIだけでなくserver境界で検証する。
- 公開APIは明示DTOだけを返す。
- 旧列fallback、二重書込み、runtime DDLをActive codeへ戻さない。
- **移行完了までは**現行`flamenode-web` + OpenNext + Workers Static Assetsをrollback可能なproduction経路として維持する。
- 新Publicはrequest-time SSRを原則禁止し、visibility fail-closedを維持する。
- D1/R2/Queue/Authを「移行のためだけ」に不要に書き直さない。
- 本番D1 migrationは自動適用せず、read-only preflight後に運用者が明示適用する。
- production deploy、Worker Route、Custom Domain、Remote D1、secret変更は明示承認なしで実行しない。

## 主な機能

- 公開: トップ、作品、イベント、クリエイター、規約・告知
- ユーザー: イベント参加、2系統投稿、枠提出、作品編集、X ID、ライブラリ
- 運営 `/manage`: 審査、枠、参加者、スタッフ、通知
- 管理 `/admin`: 作品、ユーザー、イベント、監査・復元、import、DB運用
- 背景処理: 静的JSON、YouTube同期、score、通知、cleanup

## 検査

変更種別ごとの検査は[`docs/AI_CONTEXT.md`](docs/AI_CONTEXT.md)を使う。全検査一覧は[`AGENTS.md`](AGENTS.md)に集約する。
