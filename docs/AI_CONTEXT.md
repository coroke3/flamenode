# FlameNode AI作業コンテキスト

> Status: Active
> Last verified: 2026-10-06
> Verified against commit: `99591f7b3387b6b33d113f2685d6b31e38085fdc`
> Source of truth: `AGENTS.md`, current code/test, `src/lib/db/schema.ts`, `migrations/`

規範は [`AGENTS.md`](../AGENTS.md)。この文書は **タスク別に次に読むActive文書を選ぶ索引**。

## 最小手順

1. 依頼を1文で固定する。
2. 下表から該当行を1つ選ぶ。
3. 対象コードと関連testを読む。
4. migration taskでは共通protocolとSTATUSを使う。
5. 推測でscopeを拡大しない。

禁止:

- repo/Historical/archiveの一括読込
- migrationと無関係な作業へmigration文書を大量投入
- redesign mockをpermission/API/DB仕様の正本にする

## タスク別読取表

| Task | First read | Then verify |
| --- | --- | --- |
| 一般実装・不具合 | 対象file | related tests、`package.json` |
| **platform/UI migration共通** | **`docs/migration/AGENT_PROTOCOL.md`** | `README.md` → `STATUS.md` →対象function ledger/matrix |
| **Claude `/flamenode-migration` / loop** | **`.claude/commands/flamenode-migration.md`** | shared AGENT_PROTOCOL |
| **Codex migration** | **`.codex/skills/flamenode-migration/SKILL.md`** | shared AGENT_PROTOCOL |
| **Antigravity migration** | **`.agents/skills/flamenode-migration/SKILL.md`** | shared AGENT_PROTOCOL |
| UI redesign production移植 | `docs/migration/AGENT_PROTOCOL.md` | `docs/design-redesign/README.md` review order + function ledger |
| Public Astro/SSG/Island | `docs/migration/README.md` | `ROUTE_MATRIX.md`、static-delivery、function ledger |
| Private SPA | `docs/migration/README.md` | current dashboard/entry/manage/admin + function ledger |
| Hono/API/Server Action | `docs/migration/API_MATRIX.md` | current action/handler、function ledger、contract tests |
| Worker Route / Custom Domain | `docs/migration/README.md` | actual Cloudflare config、wrangler、rollback gate |
| Auth migration | `docs/migration/README.md` | `src/lib/auth/`、account linking、session/permission tests |
| DB / migration | `docs/database/README.md`, `docs/operations/migrations.md` | schema、migrations、change-log |
| DB canonical/legacy conversion | `docs/database/canonical-migration-plan.md` | migration、fixture、verification scripts |
| Auth/permission/owner (non-migration) | relevant Active doc | `src/lib/auth/`、permission core、contract tests |
| Public API/DTO | target Route Handler | `src/lib/api/publicDto.ts`、contract tests |
| Worker/Cron/Queue | `docs/operations/workers.md` | `workers/`、wrangler、worker tests |
| YouTube sync | `docs/operations/youtube-playlist-sync.md` | sync Worker、quota code |
| UI/form (non-migration) | `docs/operations/ui-acceptance.md` | target component/CSS/tests |
| Public static/degraded | `docs/operations/static-delivery.md` | publicData loader、visibility code |
| Audit/restore | `docs/operations/audit-and-restore.md` | mutation、audit helper、restore tests |
| Local | `LOCAL.md` | package scripts、`.dev.vars.example` |
| Deploy | `DEPLOY.md` | `cf:*` scripts、Cloudflare scripts |
| Historical investigation | `docs/historical/README.md` | one necessary document only |

旧形式importは通常runtime互換ではない。`/admin/import`、`/api/admin/import/legacy`、`src/lib/import/legacy/` に限定する。

## Migration vocabulary

- `CURRENT`: productionで動作する現行経路
- `TARGET`: 移行後構成
- `BRIDGE`: 共存期間の互換層
- `REMOVABLE`: parity確認後のみ削除可能

## Function preservation

migration/redesign taskでは `docs/migration/FUNCTION_INVENTORY.md` から対象domain ledgerだけを読む。

- 見た目の完成 != function parity
- `DETAIL_AUDIT_REQUIRED` を移行済み扱いしない
- 削除は `REMOVAL_PROPOSED` → explicit approval → `REMOVED_APPROVED`
- screen DONEには関連function IDsのparityが必要

## Framework migration

- `packages/domain` にNext/Astro/Hono/React Routerを入れない
- `packages/contracts` をHTTP frameworkへ依存させない
- public projectionとprivate/auth dataを混ぜない
- Server Action→Honoは、先にdomain service抽出

## Continuous execution

product固有commandは `docs/migration/AGENT_PROTOCOL.md` を正本とする。

共通:

- 1 iteration = 1 MIG task
- task ownerをSTATUSへ記録
- iteration終端でDONE/REVIEW/BLOCKED
- STATUS/ledger/matrixをpersistしてから次へ
- Phase Gate自動承認禁止
- approval-required production actionで停止

## 変更手順

1. CURRENT contract確認
2. function IDs / route/API IDs確認
3. STATUSのtask/owner確認
4. scope/non-scope固定
5. implementation
6. parity/acceptance検証
7. rollback確認
8. progress Markdown更新
9. legacy削除は後続task/PR

## 検査

| Change | Run |
| --- | --- |
| Markdown only | `npm run check:docs`, `npm run check:project-docs` |
| TS/UI | typecheck、lint、related tests、必要ならbuild |
| Astro/Public | static build + SEO/route/visibility acceptance |
| React SPA | navigation/auth/permission acceptance |
| Hono API | contract/integration + CPU対象確認 |
| Worker | `npm run test:workers` + related tests |
| DB/permission/API | relevant checks/integration |
| route cutover | smoke + rollback; production action only with approval |
| release-wide | `verify:fast`、必要ならfull/build/Cloudflare checks |

## 完了判定

新コードが動くだけでは完了しない。
`STATUS.md` task Acceptance、affected function parity、Phase Gateを満たすこと。
