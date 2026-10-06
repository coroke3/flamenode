# FlameNode AI作業コンテキスト

> Status: Active
> Last verified: 2026-10-06
> Source of truth: `AGENTS.md`、現行コード/test、`src/lib/db/schema.ts`、`migrations/`
> Migration source of truth: `docs/migration/README.md`

規範・優先順位・不変条件の正本は [`AGENTS.md`](../AGENTS.md)。
この文書は**タスクごとに次に読むものを選ぶ索引**。

## 最小手順

1. 依頼を1文で固定する。
2. 下表から該当行を選ぶ。
3. 対象code/testを直接読む。
4. migration taskは `AGENT_PROTOCOL.md` と `STATUS.md` を読む。
5. UI/routeなら `FRONTEND_FEATURES.md`、backendなら `BACKEND_OPTIMIZATION.md` を追加で読む。
6. phase/task内の最小差分にする。

禁止:

- source/archive/Historicalの一括読込
- migrationと無関係な作業へmigration文書を持ち込む
- redesign mockをproduction機能仕様そのものと誤認する
- backend共通化をLOC削減として進める

## タスク別読取表

| タスク | 最初に読む | 次に確認する正本 |
| --- | --- | --- |
| 一般実装・不具合 | 対象ファイル | 関連test、`package.json` |
| **新基盤移行 / 継続実行** | **`docs/migration/AGENT_PROTOCOL.md` → `STATUS.md`** | `README.md`、対象ledger/matrix/code/test |
| **UI再設計 / frontend route移行** | **`FRONTEND_FEATURES.md`** | `FUNCTION_INVENTORY.md`、`ROUTE_MATRIX.md`、design-redesign、code/test |
| **既存フロント機能棚卸し** | **`FRONTEND_FEATURES.md`** | `docs/design-redesign/ROUTE_INVENTORY.md`、対象page/component、function ledger |
| **既存backend棚卸し / 共通化検討** | **`BACKEND_OPTIMIZATION.md`** | `FUNCTION_INVENTORY.md`、対象actions/APIs/jobs/tests |
| **Public Astro/SSG/Island移行** | **`FRONTEND_FEATURES.md` + `AGENT_PROTOCOL.md`** | `ROUTE_MATRIX.md`、static-delivery、visibility関連 |
| **Private SPA移行** | **`FRONTEND_FEATURES.md` + `AGENT_PROTOCOL.md`** | `ROUTE_MATRIX.md`、現行dashboard/entry/manage/admin、auth/permission test |
| **Hono API / Server Action移行** | **`BACKEND_OPTIMIZATION.md` + `AGENT_PROTOCOL.md`** | `API_MATRIX.md`、対象function ledger、現行Action/Route Handler/test |
| **Worker/Queue/job移行** | **`BACKEND_OPTIMIZATION.md` + `AGENT_PROTOCOL.md`** | `functions/PLATFORM_API_JOBS.md`、workers、wrangler、test |
| **Worker Route / Custom Domain切替** | **`AGENT_PROTOCOL.md`** | Cloudflare実設定、`GIT_WORKFLOW.md`、rollback gate |
| **Auth移行** | **`FRONTEND_FEATURES.md` + `BACKEND_OPTIMIZATION.md`** | `src/lib/auth/`、account linking、session/permission test |
| DB・migration | `docs/database/README.md`、`docs/operations/migrations.md` | schema、migrations、change-log |
| DB正本移行・旧データ変換 | `docs/database/canonical-migration-plan.md` | migration、fixture、検証script |
| 認証・権限・owner（非移行） | 関連Active | `src/lib/auth/`、権限判定、contract test |
| 公開API・DTO（非移行） | 対象Route Handler | `src/lib/api/publicDto.ts`、契約test |
| Worker・Cron・Queue（非移行） | `docs/operations/workers.md` | `workers/`、wrangler、worker test |
| YouTube同期 | `docs/operations/youtube-playlist-sync.md` | 同期Worker、quotaコード |
| UI・フォーム（非移行） | `docs/operations/ui-acceptance.md` | 対象page/component、CSS、test |
| 公開静的・degraded D1 | `docs/operations/static-delivery.md` | publicData loader、visibility関連 |
| 監査・復元 | `docs/operations/audit-and-restore.md` | mutation、audit helper、復元test |
| ローカル起動 | `LOCAL.md` | `package.json`、`.dev.vars.example` |
| デプロイ | `DEPLOY.md` | `package.json` の `cf:*`、Cloudflare scripts |
| 過去仕様 | `docs/historical/README.md` | 必要資料1件だけ |

旧形式インポートは通常ランタイムの互換ではない。管理者専用境界 `/admin/import`、`/api/admin/import/legacy`、`src/lib/import/legacy/` に限定する。

## Migration classification

- `CURRENT`: 現在productionで動く実装
- `TARGET`: 移行後構成
- `BRIDGE`: 移行期間のみ存在する互換層
- `REMOVABLE`: parity確認後に削除する旧実装

## UI migration

Visual sourceは `docs/design-redesign/` と `/dev/redesign`。
Functional sourceはCURRENT code/test + `FRONTEND_FEATURES.md` + `FUNCTION_INVENTORY.md`。

画面の見た目だけ完成しても機能parity完了ではない。
Loading/error/empty/forbidden/pending/retry/query/history/responsiveも機能の一部。

## Backend migration / optimization

`BACKEND_OPTIMIZATION.md` を正本にする。

- CURRENT実装を機械的に移植しない
- framework concernとdomain ruleを分離する
- 同じ意味の処理だけを共通化する
- permission/failure/audit semanticsが違えば別実装を維持する
- HTTP同期CPUを必要最小化する
- Queue/R2/post-commitへ安全に移せる処理を検討する
- LOC削減は成果指標にしない
- frontend UX/機能維持が最優先

最適化がfrontend挙動変更を要求する場合は自動採用せず、`UX_IMPACT_REVIEW_REQUIRED`としてユーザーへ具体的影響を提示する。

## Framework移行

- `packages/domain` から Next / Astro / Hono / React Routerをimportしない
- `packages/contracts` はHTTP frameworkへ依存しない
- public projectionとprivate/auth dataを混ぜない
- Next Server ActionをHonoへ移す前にdomain serviceを抽出する

## Continuous execution

詳細は `docs/migration/AGENT_PROTOCOL.md`。

- 1 iteration = 1 MIG task
- owner/IN_PROGRESSを記録
- 終了はDONE/REVIEW/BLOCKED
- STATUS/inventory/matrix更新なしで次へ進まない
- Phase Gateを自動承認しない
- production操作が必要なら停止
- Git運用は `docs/migration/GIT_WORKFLOW.md`

## 変更手順

1. MIG taskと対象route/function/capabilityを決める。
2. CURRENT code/testから維持契約を固定。
3. frontend observable stateを固定。
4. backend side effectsを固定。
5. optimization reviewを行う。
6. framework-neutral層を先に作る。
7. 新経路をshadow/parallelで実装。
8. parity検査。
9. rollback確認。
10. STATUSと該当ledger/matrix更新。

## 検査

| 変更 | 実行 |
| --- | --- |
| Markdownのみ | `npm run check:docs`、`npm run check:project-docs` |
| TypeScript / UI | typecheck、lint、関連test、必要ならbuild |
| Astro/Public | static build + SEO/route/visibility/UX acceptance |
| React SPA | navigation/auth/permission/state acceptance |
| Hono API | contract/integration + CPU計測 |
| Worker | `npm run test:workers` + relevant integration |
| DB / 権限 / API | related check/integration |
| route切替 | smoke + rollback、production操作は明示依頼時のみ |

## 完了判定

「新コードが動く」だけでは完了にしない。
`STATUS.md` のtask acceptance、frontend capability parity、function parity、Phase Gateを満たした時だけ次へ進む。
