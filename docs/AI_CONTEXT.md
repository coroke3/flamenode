# FlameNode AI作業コンテキスト

> Status: Active
> Last verified: 2026-10-07
> Source of truth: `AGENTS.md`、CURRENT code/test、`src/lib/db/schema.ts`、`migrations/`
> Migration source of truth: `docs/migration/README.md`

規範・優先順位・不変条件の正本は [`AGENTS.md`](../AGENTS.md)。
この文書は**タスクごとに次に読むものを選ぶ索引**。

## 最小手順

1. 依頼を1文で固定する。
2. 下表から該当行を選ぶ。
3. 対象CURRENT code/testを直接読む。
4. migration taskは `AGENT_PROTOCOL.md`、`STATUS.md`、`GIT_WORKFLOW.md` を読む。
5. UI/routeは `CURRENT_ROUTES.md` + `FRONTEND_FEATURES.md`、backendは `FUNCTION_INVENTORY.md` + `BACKEND_OPTIMIZATION.md` を追加で読む。
6. 既存設計との照合が必要なら `PRODUCT_REQUIREMENTS.md`、実装なら `CODE_QUALITY.md` を読む。
7. phase/task内の最小で一貫した差分にする。

禁止:

- source/archive/Historicalの一括読込
- migrationと無関係な作業へmigration文書を持ち込む
- `docs/design-redesign/` または `app/(redesign)` を新UI正本として使う
- backend共通化をLOC削減として進める
- chat historyをmigration progressの正本にする

## タスク別読取表

| タスク | 最初に読む | 次に確認する正本 |
| --- | --- | --- |
| 一般実装・不具合 | 対象ファイル | 関連test、`package.json` |
| **新基盤移行 / 継続実行** | **`docs/migration/MIGRATION_START_HERE.md` → STATUS該当行** | `AGENT_PROTOCOL.md`・該当TASK_CARD 1件・FILE_MIGRATION_MATRIX owner行・CURRENT code/test（全README/台帳を投入しない） |
| **UI再設計 / frontend route移行** | **`CURRENT_ROUTES.md` + `FRONTEND_FEATURES.md`** | 対象`frontend/*.md`、`FUNCTION_INVENTORY.md`、`UI_REFERENCE.md`、code/test |
| **既存フロント機能棚卸し** | **`FRONTEND_FEATURES.md`** | `CURRENT_ROUTES.md`、対象page/component、active operations/docs |
| **既存backend棚卸し / 共通化検討** | **`FUNCTION_INVENTORY.md` + `BACKEND_OPTIMIZATION.md`** | 対象actions/APIs/jobs/tests、`PRODUCT_REQUIREMENTS.md` |
| **既存設計/要件照合** | **`PRODUCT_REQUIREMENTS.md`** | CURRENT code/test、必要なactive design文書1件 |
| **移行先実装** | **`CODE_QUALITY.md` + `AGENT_PROTOCOL.md`** | affected UX/FN、対象code/test |
| **Public Astro/SSG/Island移行** | **`FRONTEND_FEATURES.md` + `AGENT_PROTOCOL.md`** | `CURRENT_ROUTES.md`、`ROUTE_MATRIX.md`、static-delivery、visibility関連 |
| **Private SPA移行** | **`FRONTEND_FEATURES.md` + `AGENT_PROTOCOL.md`** | `CURRENT_ROUTES.md`、現行dashboard/entry/manage/admin、auth/permission test |
| **Hono API / Server Action移行** | **`BACKEND_OPTIMIZATION.md` + `AGENT_PROTOCOL.md`** | `API_MATRIX.md`、対象FN ledger、現行Action/Route Handler/test |
| **Worker/Queue/job移行** | **`BACKEND_OPTIMIZATION.md` + `AGENT_PROTOCOL.md`** | `functions/PLATFORM_API_JOBS.md`、workers、wrangler、test |
| **Worker Route / Custom Domain切替** | **`AGENT_PROTOCOL.md`** | Cloudflare実設定、`GIT_WORKFLOW.md`、rollback gate |
| **Auth移行** | **`FRONTEND_FEATURES.md` + `FUNCTION_INVENTORY.md`** | `src/lib/auth/`、account linking、session/permission test、`PRODUCT_REQUIREMENTS.md` |
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

CURRENT route正本は `CURRENT_ROUTES.md`。
Frontend-observable behavior正本は `FRONTEND_FEATURES.md` + `frontend/*.md`。

新visual sourceは `UI_REFERENCE.md`。現在は `PENDING_HTML` であり、後日ユーザーから提供されるHTML mockを登録するまではvisual redesignを確定しない。

`docs/design-redesign/`は使用しない。`app/(redesign)`もTARGET designの正本にしない。

HTML mock受領後も、mockに見えないCURRENT capabilityを暗黙削除しない。
Loading/error/empty/forbidden/pending/degraded/retry/query/history/responsive/a11yも機能の一部。

## Requirement reconciliation

`PRODUCT_REQUIREMENTS.md`を正本にする。

- CURRENT code/test/configで実挙動を確認する
- active design docsからproduct intentを照合する
- 矛盾は`CURRENT_DIVERGENCE`として記録する
- old designへ無断で戻さない
- CURRENTの逸脱を無言で正当化もしない
- frontend behavior変更は明示決定までCURRENT維持をdefaultにする

## Backend migration / optimization

`BACKEND_OPTIMIZATION.md`を正本にする。

- CURRENT実装を機械的に移植しない
- framework concernとdomain ruleを分離する
- 同じ意味の処理だけを共通化する
- permission/failure/audit/transaction/visibility semanticsが違えば別実装を維持する
- HTTP同期CPUを必要最小化する
- Queue/R2/post-commitへ安全に移せる処理を検討する
- LOC削減は成果指標にしない
- frontend UX/機能維持が最優先

最適化がfrontend挙動変更を要求する場合は自動採用せず、`UX_IMPACT_REVIEW_REQUIRED`として具体的影響を提示する。

## Code quality

`CODE_QUALITY.md`を全migration implementationの必須基準にする。

- experienced production engineerが局所的に推論できる構造
- domain語彙を正確に使う
- framework adapterを薄くする
- domain logicをframework-neutralに保つ
- permission/visibility/transaction/side effectを明示する
- typed contractとboundary validationを使う
- generic mega-helper / flag-heavy CRUD / hidden magicを避ける
- behavior/invariantをtestで固定する

「美しいコード」は短いコードではなく、責務と意味が明確なコード。

## Framework移行

- `packages/domain` から Next / Astro / Hono / React Routerをimportしない
- `packages/contracts` はHTTP frameworkへ依存しない
- public projectionとprivate/auth dataを混ぜない
- Next Server ActionをHonoへ移す前にdomain serviceを抽出する

## Continuous execution

詳細は `docs/migration/AGENT_PROTOCOL.md`。

- 1 iteration = 1 MIG task
- 1 task = 1 short-lived branch = 1 PR = 1 squash mergeを原則にする
- owner/IN_PROGRESSを記録
- 終了はDONE/REVIEW/BLOCKED
- STATUS/inventory/matrix更新なしで次へ進まない
- Phase Gateを自動承認しない
- production操作が必要なら停止
- Git運用は `docs/migration/GIT_WORKFLOW.md`

## 変更手順

1. MIG taskと対象route/UX/FN/API/jobを決める。
2. CURRENT code/testから維持契約を固定。
3. frontend observable stateを固定。
4. backend side effectsを固定。
5. requirement reconciliationが必要なら実施。
6. optimization reviewを行う。
7. framework-neutral層を優先して実装。
8. 新経路をshadow/parallelで実装。
9. parity + quality検査。
10. rollback確認。
11. STATUSと該当ledger/matrix更新。

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
`STATUS.md` のtask acceptance、affected UX parity、affected FN parity、code-quality gate、Phase Gateを満たした時だけ次へ進む。
