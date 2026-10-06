# FlameNode AI作業コンテキスト

> Status: Active
> Last verified: 2026-10-06
> Verified against commit: `99591f7b3387b6b33d113f2685d6b31e38085fdc`
> Source of truth: `AGENTS.md`、現行コード/test、`src/lib/db/schema.ts`、`migrations/`
> Migration source of truth: `docs/migration/README.md`

規範・優先順位・不変条件・モデル停止条件の正本は [`AGENTS.md`](../AGENTS.md)。
この文書は **タスクごとに次に読むものを1つ選ぶための索引** とする。

## 最小手順

1. 依頼を1文で言い換える。
2. 下表から該当行を1つ選ぶ。
3. 対象コードと関連testを直接読む。
4. migration taskだけ `docs/migration/README.md` と `docs/migration/STATUS.md` を読む。
5. 推測で埋めず、変更はphase内の最小差分にする。

禁止:
- source/archive/Historicalの一括読込
- migrationと無関係な作業にmigration文書を持ち込む
- redesign mockをproduction仕様そのものと誤認する

## タスク別読取表

| タスク | 最初に読む | 次に確認する正本 |
| --- | --- | --- |
| 一般実装・不具合 | 対象ファイル | 関連test、`package.json` |
| **新基盤移行・architecture** | **`docs/migration/README.md` → `STATUS.md`** | 現行route/binding/test、Cloudflare設定 |
| **`/flamenode-migration` / `/loop`** | **`.claude/commands/flamenode-migration.md`** | `docs/migration/STATUS.md`、該当matrix |
| **UI再設計をproductionへ移植** | **`docs/migration/README.md`** | `docs/design-redesign/README.md` のReview order、対象mock |
| **Public Astro/SSG/Island移行** | **`docs/migration/README.md`** | `docs/operations/static-delivery.md`、`ROUTE_MATRIX.md` |
| **Private SPA移行** | **`docs/migration/README.md`** | 現行dashboard/entry/manage/admin、auth/permission test |
| **Hono API / Server Action移行** | **`docs/migration/README.md`** | `API_MATRIX.md`、現行Action/Route Handler、contract test |
| **Worker Route / Custom Domain切替** | **`docs/migration/README.md`** | Cloudflare実設定、wrangler、rollback gate |
| **Auth移行** | **`docs/migration/README.md`** | `src/lib/auth/`、account linking、session/permission test |
| DB・migration | `docs/database/README.md`、`docs/operations/migrations.md` | `src/lib/db/schema.ts`、`migrations/`、change-log |
| DB正本移行・旧データ変換 | `docs/database/canonical-migration-plan.md` | migration、fixture、検証script |
| 認証・権限・owner（非移行） | 関連Active | `src/lib/auth/`、権限判定、contract test |
| 公開API・DTO | 対象Route Handler | `src/lib/api/publicDto.ts`、契約test |
| Worker・Cron・Queue | `docs/operations/workers.md` | `workers/`、各`wrangler.toml`、worker test |
| YouTube同期 | `docs/operations/youtube-playlist-sync.md` | 同期Worker、quotaコード |
| UI・フォーム（非移行） | `docs/operations/ui-acceptance.md` | 対象page/component、CSS、test |
| 公開静的・degraded D1 | `docs/operations/static-delivery.md` | `src/lib/publicData/loader.ts`、visibility関連 |
| 監査・復元 | `docs/operations/audit-and-restore.md` | mutation、audit helper、復元test |
| ローカル起動 | `LOCAL.md` | `package.json`、`.dev.vars.example` |
| デプロイ | `DEPLOY.md` | `package.json` の `cf:*`、`scripts/cloudflare-*.mjs` |
| 過去仕様 | `docs/historical/README.md` | 必要資料1件だけ |

旧形式インポートは通常ランタイムの互換ではない。管理者専用境界 `/admin/import`、`/api/admin/import/legacy`、`src/lib/import/legacy/` に限定する。

## Migration taskの分類

移行作業では必ず次を区別する。

- `CURRENT`: 現在productionで動いている実装
- `TARGET`: 移行後に目指す構成
- `BRIDGE`: 移行期間だけ存在する互換層
- `REMOVABLE`: parity確認後に削除する旧実装

PR説明・TODO・STATUSでは必要に応じてこの分類を使う。

## UI移行

デザインは `docs/design-redesign/` と `/dev/redesign` を参照するが、productionの機能・権限・API・DB副作用は現行test/コードを正本とする。

## Framework移行

framework APIをbusiness logicへ侵入させない。

- `packages/domain` から Next / Astro / Hono / React Router をimportしない
- `packages/contracts` はHTTP frameworkに依存しない
- public projectionとprivate/auth dataを混ぜない
- Next Server ActionをHonoへ移す前にdomain serviceを抽出する

## `/loop` との組合せ

- 1 iteration = `STATUS.md` の1 MIG task
- iteration開始時にtaskを`IN_PROGRESS`
- iteration終了時に`DONE` / `REVIEW` / `BLOCKED`
- STATUS更新無しで次iterationへ進まない
- Phase Gateは自動承認しない
- production操作が必要になったら停止する

## 変更手順

1. 対象route/機能を決める。
2. 現行testから維持契約を固定する。
3. migration phaseとtaskを確認する。
4. framework-neutral層を先に作る。
5. 新経路をshadow/parallelで実装する。
6. parityを検査する。
7. routeを限定切替する。
8. rollback可能性を確認する。
9. 旧経路削除は別PRにする。
10. `STATUS.md` を更新する。

## 検査の選び方

| 変更 | 実行 |
| --- | --- |
| Markdownのみ | `npm run check:docs`、`npm run check:project-docs` |
| TypeScript / UI | typecheck、lint、関連test、必要ならbuild |
| Astro/Public | 上記 + static build + SEO/route/visibility acceptance |
| React SPA | 上記 + navigation/auth/permission acceptance |
| Hono API | 上記 + contract/integration + CPU計測対象確認 |
| Worker | 上記 + `npm run test:workers` |
| DB / 権限 / API | 上記 + 関連check/integration |
| route切替 | smoke + rollback確認 + production操作は明示依頼時のみ |
| release影響 | `verify:fast`、必要ならfull/build/Cloudflare関連check |

## 完了判定

「新コードが動く」だけでは完了にしない。
`docs/migration/STATUS.md` のtask acceptanceと `docs/migration/README.md` のPhase Gateを満たした時だけ進める。
