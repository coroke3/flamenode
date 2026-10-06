# FlameNode ドキュメント索引

> Status: Active
> Last verified: 2026-10-06
> Source of truth: `AGENTS.md`, current code/test, `src/lib/db/schema.ts`, `migrations/`

## AI read order

通常:

`../AGENTS.md` → `AI_CONTEXT.md`該当行 → 対象コード/test

移行:

`../AGENTS.md` → `migration/AGENT_PROTOCOL.md` → `migration/README.md` → `migration/STATUS.md` → `migration/FUNCTION_INVENTORY.md` → task種別に応じて `FRONTEND_FEATURES.md` / `BACKEND_OPTIMIZATION.md` → 対象ledger/matrix/code/test

branch / PR / merge / handoffは `migration/GIT_WORKFLOW.md`。
正本重複判断だけ `migration/DOC_MAP.md`。

Historical/archive/完了済みphaseは現行仕様の根拠にしない。

## CURRENT / TARGET

- CURRENT production: Cloudflare Workers + OpenNext + Workers Static Assets。正確な実装/bindingはcode/config/Cloudflare実設定。
- TARGET migration: `migration/README.md`。
- CURRENTとTARGETは移行完了まで併存する。

## Active entry points

| Purpose | Document |
| --- | --- |
| universal agent rules | [`../AGENTS.md`](../AGENTS.md) |
| task routing | [`AI_CONTEXT.md`](AI_CONTEXT.md) |
| multi-agent migration protocol | [`migration/AGENT_PROTOCOL.md`](migration/AGENT_PROTOCOL.md) |
| migration Git policy | [`migration/GIT_WORKFLOW.md`](migration/GIT_WORKFLOW.md) |
| target migration architecture | [`migration/README.md`](migration/README.md) |
| progress / next READY task | [`migration/STATUS.md`](migration/STATUS.md) |
| documentation source map | [`migration/DOC_MAP.md`](migration/DOC_MAP.md) |
| backend/side-effect function index | [`migration/FUNCTION_INVENTORY.md`](migration/FUNCTION_INVENTORY.md) |
| **frontend-exposed capability / UX preservation** | **[`migration/FRONTEND_FEATURES.md`](migration/FRONTEND_FEATURES.md)** |
| **backend optimization / commonization / blockers** | **[`migration/BACKEND_OPTIMIZATION.md`](migration/BACKEND_OPTIMIZATION.md)** |
| detailed function contracts | [`migration/functions/`](migration/functions/) |
| route migration | [`migration/ROUTE_MATRIX.md`](migration/ROUTE_MATRIX.md) |
| API/server migration | [`migration/API_MATRIX.md`](migration/API_MATRIX.md) |
| UI/UX redesign proposal | [`design-redesign/README.md`](design-redesign/README.md) |
| exact redesign/current screen inventory | [`design-redesign/ROUTE_INVENTORY.md`](design-redesign/ROUTE_INVENTORY.md) |
| UI acceptance | [`operations/ui-acceptance.md`](operations/ui-acceptance.md) |
| static delivery / visibility | [`operations/static-delivery.md`](operations/static-delivery.md) |
| Worker / Queue | [`operations/workers.md`](operations/workers.md) |
| operations | [`operations/README.md`](operations/README.md) |
| DB | [`database/README.md`](database/README.md) |
| DB history | [`database/change-log.md`](database/change-log.md) |
| non-migration backlog | [`implementation-backlog.md`](implementation-backlog.md) |
| local | [`../LOCAL.md`](../LOCAL.md) |
| deploy | [`../DEPLOY.md`](../DEPLOY.md) |

## Migration source-of-truth split

- CURRENT behavior: code/test
- DB: schema/migrations
- CURRENT Cloudflare: wrangler + actual Cloudflare settings
- TARGET architecture: `migration/README.md`
- execution/loop: `migration/AGENT_PROTOCOL.md`
- Git/branch/PR/merge: `migration/GIT_WORKFLOW.md`
- progress/current owner/next READY: `migration/STATUS.md`
- documentation truth ownership: `migration/DOC_MAP.md`
- frontend-observable capability/UX: `migration/FRONTEND_FEATURES.md`
- backend/side-effect parity: `migration/FUNCTION_INVENTORY.md` + `migration/functions/*.md`
- optimization candidates/blockers: `migration/BACKEND_OPTIMIZATION.md`
- route disposition: `migration/ROUTE_MATRIX.md`
- server/API disposition: `migration/API_MATRIX.md`
- visual/information architecture: `design-redesign/`

`design-redesign/` is not the source of truth for permissions, DB/API behavior, side effects, or workflow semantics.

`STATUS.md` is the only progress/work-item ledger.
`FRONTEND_FEATURES.md` is the only frontend capability ledger.
`FUNCTION_INVENTORY.md` + domain ledgers are the only backend/side-effect feature ledger.
`BACKEND_OPTIMIZATION.md` is the only optimization/blocker ledger.

## Agent invocation

詳細は `migration/AGENT_PROTOCOL.md`。

### Claude Code

```text
/flamenode-migration
/loop /flamenode-migration
```

### OpenAI Codex

```text
Use the flamenode-migration skill and execute exactly one READY MIG task.
```

### Google Antigravity

```text
/flamenode-migration
```

全agentは同じrepository progress stateを使う。tool-local chat historyは正本ではない。

## Validation

文書のみ:

```sh
npm run check:docs
npm run check:project-docs
```

`check:project-docs` はmigration task/function/capability/source-map/adapterの整合確認を含む。

## Historical

- `historical/README.md`
- `db-history/README.md`
- `.claude/flamenode/`

必要なhistorical文書1件だけを読む。
