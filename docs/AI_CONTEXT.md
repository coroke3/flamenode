# FlameNode AI作業コンテキスト

> Status: Active
> Last verified: 2026-07-25
> Verified against commit: `dc46eefa`
> Source of truth: `AGENTS.md`, `src/lib/db/schema.ts`, `migrations/`, `package.json`, `wrangler.toml`

規範・優先順位・不変条件・モデル停止条件の正本は [`AGENTS.md`](../AGENTS.md)。この文書は **タスク別の次の1件** だけを示す。

## 最小手順

1. 依頼を1文で言い換える。
2. 下表から読む文書を最大3件（`AGENTS.md` + この行の「最初に読む」+ 必要なら Active 1件）。
3. 対象コードと test を直接読む。
4. 推測で埋めず正本を確認する。変更は最小にする。

禁止: `source/`、`archive/`、完了済み phase、Historical の一括読込。同一内容を複数文書から集めない。

## タスク別読取表

| タスク | 最初に読む | 次に確認する正本 |
| --- | --- | --- |
| 一般実装・不具合 | 対象ファイル | 関連 test、`package.json` |
| DB・migration | `docs/database/README.md`、`docs/operations/migrations.md` | `src/lib/db/schema.ts`、`migrations/`、`docs/database/change-log.md` |
| DB正本移行・旧データ変換 | `docs/database/canonical-migration-plan.md` | `migrations/0043_db_canonical_migration.sql`、fixture、検証 script |
| 認証・権限・owner | 関連 Active（必要時） | `src/lib/auth/`、権限判定、integration test |
| 公開API・DTO | — | Route Handler、`src/lib/api/publicDto.ts`、契約 test |
| Worker・Cron・Queue | `docs/operations/workers.md` | `workers/`、`src/lib/queues/wakeBudget.ts`、各 `wrangler.toml`、worker test |
| YouTube同期 | `docs/operations/youtube-playlist-sync.md` | 同期 Worker、quota コード |
| UI・フォーム | `docs/operations/ui-acceptance.md` | 対象 page/component、CSS、test |
| 公開静的・degraded D1 | `docs/operations/static-delivery.md` | `src/lib/publicData/loader.ts`、`degradedPolicy.ts` |
| 監査・復元 | `docs/operations/audit-and-restore.md` | mutation、audit helper、復元 test |
| ローカル起動 | `LOCAL.md`（§1–6 まで） | `package.json`、`.dev.vars.example` |
| デプロイ | `DEPLOY.md`（§1–4） | `package.json` の `cf:*`、`scripts/cloudflare-*.mjs`。初回準備だけ `docs/operations/deploy-setup-report.md` |
| 過去仕様の調査 | `docs/historical/README.md` | 必要な資料 **1件だけ** |

旧形式インポートは通常ランタイムの互換ではない。管理者専用境界 `/admin/import`、`/api/admin/import/legacy`、`src/lib/import/legacy/` に限定する。詳細は `docs/operations/legacy-import.md`。

## 変更手順

1. 対象と非対象を決める。
2. 既存 test から維持すべき挙動を確認する。
3. 最小差分で変更する。
4. 該当 Active 文書だけ更新する。
5. 下の検査を選び実行する。
6. 変更・検査・未実行理由・残課題を短く報告する。

## 検査の選び方

| 変更 | 実行 |
| --- | --- |
| Markdownのみ | `npm run check:docs`、`npm run check:project-docs` |
| TypeScript / UI | `typecheck`、`lint`、関連 test、必要なら `build` |
| Worker | 上記 + `npm run test:workers` |
| DB / 権限 / API | 上記 + 関連 check・integration |
| release 影響 | `verify:fast`、必要なら `cf:build` / OpenNext / Cloudflare 関連 check |

全一覧は `AGENTS.md` §検査 または `package.json`。
