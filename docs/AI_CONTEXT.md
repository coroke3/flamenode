# FlameNode AI作業コンテキスト

> Status: Active
> Last verified: 2026-10-06
> Verified against commit: `99591f7b3387b6b33d113f2685d6b31e38085fdc`
> Source of truth: `AGENTS.md`、現行コード/test、`src/lib/db/schema.ts`、`migrations/`
> Migration source of truth: `docs/migration/README.md`

規範・優先順位・不変条件・モデル停止条件の正本は [`AGENTS.md`](../AGENTS.md)。
この文書は **タスクごとに次に読むものを選ぶ索引** とする。

## 最小手順

1. 依頼を1文で言い換える。
2. 下表から該当行を1つ選ぶ。
3. 対象コードと関連testを直接読む。
4. migration taskだけ `docs/migration/AGENT_PROTOCOL.md` と `STATUS.md` を読む。
5. UI/frontendへ触るなら `FRONTEND_FEATURE_INVENTORY.md`、backendへ触るなら `BACKEND_OPTIMIZATION_LEDGER.md` の対象部分を確認する。
6. 推測で埋めず、phase/task内の最小差分にする。

禁止:

- source/archive/Historicalの一括読込
- migrationと無関係な作業へmigration文書を持ち込む
- redesign mockをproduction機能仕様そのものと誤認する
- backend整理を理由にfrontend-visible behaviorを暗黙変更する

## タスク別読取表

| タスク | 最初に読む | 次に確認する正本 |
| --- | --- | --- |
| 一般実装・不具合 | 対象ファイル | 関連test、`package.json` |
| **新基盤移行 / UI再設計 / 継続実行** | **`docs/migration/AGENT_PROTOCOL.md` → `STATUS.md`** | `docs/migration/README.md`、対象function/frontend/optimization ledger / matrix / code/test |
| **既存機能棚卸し** | **`docs/migration/FUNCTION_INVENTORY.md`** | `FRONTEND_FEATURE_INVENTORY.md`、対象`functions/*.md`、現行route/action/API/job/test |
| **フロント機能/UX棚卸し** | **`docs/migration/FRONTEND_FEATURE_INVENTORY.md`** | `ROUTE_MATRIX.md`、対象function ledger、CURRENT code/test、redesign inventory |
| **バックエンド共通化/最適化検討** | **`docs/migration/BACKEND_OPTIMIZATION_LEDGER.md`** | 対象function ledger、`API_MATRIX.md`、CURRENT action/API/job/test、frontend contract |
| **Public Astro/SSG/Island移行** | **`docs/migration/AGENT_PROTOCOL.md`** | `FRONTEND_FEATURE_INVENTORY.md`、`ROUTE_MATRIX.md`、`docs/operations/static-delivery.md`、visibility関連 |
| **Private SPA移行** | **`docs/migration/AGENT_PROTOCOL.md`** | `FRONTEND_FEATURE_INVENTORY.md`、`ROUTE_MATRIX.md`、現行dashboard/entry/manage/admin、auth/permission test |
| **Hono API / Server Action移行** | **`docs/migration/AGENT_PROTOCOL.md`** | `BACKEND_OPTIMIZATION_LEDGER.md`、`API_MATRIX.md`、対象function ledger、現行Action/Route Handler/test |
| **Worker Route / Custom Domain切替** | **`docs/migration/AGENT_PROTOCOL.md`** | Cloudflare実設定、wrangler、rollback gate |
| **Auth移行** | **`docs/migration/AGENT_PROTOCOL.md`** | `src/lib/auth/`、account linking、session/permission test、frontend auth contract |
| DB・migration | `docs/database/README.md`、`docs/operations/migrations.md` | `src/lib/db/schema.ts`、`migrations/`、change-log |
| DB正本移行・旧データ変換 | `docs/database/canonical-migration-plan.md` | migration、fixture、検証script |
| 認証・権限・owner（非移行） | 関連Active | `src/lib/auth/`、権限判定、contract test |
| 公開API・DTO（非移行） | 対象Route Handler | `src/lib/api/publicDto.ts`、契約test |
| Worker・Cron・Queue（非移行） | `docs/operations/workers.md` | `workers/`、各`wrangler.toml`、worker test |
| YouTube同期 | `docs/operations/youtube-playlist-sync.md` | 同期Worker、quotaコード |
| UI・フォーム（非移行） | `docs/operations/ui-acceptance.md` | 対象page/component、CSS、test |
| 公開静的・degraded D1 | `docs/operations/static-delivery.md` | `src/lib/publicData/loader.ts`、visibility関連 |
| 監査・復元 | `docs/operations/audit-and-restore.md` | mutation、audit helper、復元test |
| ローカル起動 | `LOCAL.md` | `package.json`、`.dev.vars.example` |
| デプロイ | `DEPLOY.md` | `package.json` の `cf:*`、`scripts/cloudflare-*.mjs` |
| 過去仕様 | `docs/historical/README.md` | 必要資料1件だけ |

旧形式インポートは通常ランタイムの互換ではない。管理者専用境界 `/admin/import`、`/api/admin/import/legacy`、`src/lib/import/legacy/` に限定する。

## Migration taskの分類

- `CURRENT`: 現在productionで動く実装
- `TARGET`: 移行後構成
- `BRIDGE`: 移行期間のみ存在する互換層
- `REMOVABLE`: parity確認後に削除する旧実装

PR・TODO・STATUSでは必要に応じて明示する。

## UI移行

デザインは `docs/design-redesign/` と `/dev/redesign` を参照する。
productionの機能・権限・API・DB副作用は現行code/testと `FUNCTION_INVENTORY.md` を正本とする。
ユーザーが実際に利用する操作・状態・feedbackは `FRONTEND_FEATURE_INVENTORY.md` を正本とする。

画面の見た目だけ完成しても機能parity完了ではない。

## Backend移行

CURRENT backendのファイル構造をそのまま再現することは要件ではない。

- frontend-visible behaviorを最優先で維持する
- permission/privacy/visibility/audit/idempotency/atomicityを維持する
- 似たvalidation/permission/audit/post-commit effect/external adapter/Queue contractは共通化候補として調査する
- frameworkとbusiness logicの密結合を減らす
- CPU/D1/R2/Queue改善を主張する場合は計測する
- コード行数削減を目的にしない
- scope外で見つけた改善候補は `BACKEND_OPTIMIZATION_LEDGER.md` へ記録し、勝手に広げない
- frontend仕様変更が必要なら `FRONTEND_DECISION_REQUIRED` として停止・報告する

## Framework移行

framework APIをbusiness logicへ侵入させない。

- `packages/domain` から Next / Astro / Hono / React Router をimportしない
- `packages/contracts` はHTTP frameworkへ依存しない
- public projectionとprivate/auth dataを混ぜない
- Next Server ActionをHonoへ移す前にdomain serviceを抽出する

## Continuous execution

詳細は `docs/migration/AGENT_PROTOCOL.md`。

共通不変条件:

- 1 iteration = 1 MIG task
- 開始時にownerと`IN_PROGRESS`を記録
- 終了時に`DONE` / `REVIEW` / `BLOCKED`
- STATUS/inventory/matrix更新なしで次へ進まない
- frontend/backend ledgerを該当時に更新する
- Phase Gateを自動承認しない
- production操作が必要になったら停止する
- frontend-visible変更が必要になったら承認前に停止する

製品別の呼出方法はprotocolだけを正本にする。

## 変更手順

1. MIG taskと対象route/functionを決める。
2. 現行test/codeから維持契約を固定する。
3. UI/frontendならfrontend contractを固定する。
4. function inventoryの詳細度を確認する。
5. backendならより良い共通化/責務分離候補を検討・記録する。
6. framework-neutral層を先に作る。
7. 新経路をshadow/parallelで実装する。
8. parityを検査する。
9. routeを限定切替する。
10. rollback可能性を確認する。
11. 旧経路削除は別task/PRにする。
12. STATUSと該当inventory/matrix/ledgerを更新する。

## 検査の選び方

| 変更 | 実行 |
| --- | --- |
| Markdownのみ | `npm run check:docs`、`npm run check:project-docs` |
| TypeScript / UI | typecheck、lint、関連test、必要ならbuild |
| Astro/Public | 上記 + static build + SEO/route/visibility acceptance |
| React SPA | 上記 + navigation/auth/permission/frontend-state acceptance |
| Hono API | 上記 + contract/integration + CPU計測対象確認 |
| Worker | 上記 + `npm run test:workers` |
| DB / 権限 / API | 上記 + 関連check/integration |
| route切替 | smoke + rollback確認 + production操作は明示依頼時のみ |
| release影響 | `verify:fast`、必要ならfull/build/Cloudflare関連check |

`npm run check:project-docs` はmigration進捗MDの整合チェックも含む。

## 完了判定

「新コードが動く」だけでは完了にしない。
`STATUS.md` のtask acceptance、該当function parity、frontend-visible contract、`README.md` のPhase Gateを満たした時だけ次へ進む。
