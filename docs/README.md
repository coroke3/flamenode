# FlameNode ドキュメント索引

> Status: Active
> Last verified: 2026-10-07
> Verified against commit: `f862c6cc7993ef30f0363d92719c938b23723bee`
> Source of truth: `AGENTS.md`, CURRENT code/test, `src/lib/db/schema.ts`, `migrations/`

## AI read order

通常:

`../AGENTS.md` → `AI_CONTEXT.md`該当行 → 対象code/test

移行:

`../AGENTS.md` → `migration/AGENT_PROTOCOL.md` → `migration/STATUS.md` → `migration/OPEN_DECISIONS.md` → `migration/GIT_WORKFLOW.md` → `migration/README.md` → taskに必要なUX/FN/route/API ledger → 対象code/test

branch / PR / merge / handoffは `migration/GIT_WORKFLOW.md`。
正本重複判断だけ `migration/DOC_MAP.md`。

Historical/archive/完了済みphaseはCURRENT仕様の根拠にしない。

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
| user decisions / prerequisite gates | [`migration/OPEN_DECISIONS.md`](migration/OPEN_DECISIONS.md) |
| documentation source map | [`migration/DOC_MAP.md`](migration/DOC_MAP.md) |
| CURRENT user-visible routes | [`migration/CURRENT_ROUTES.md`](migration/CURRENT_ROUTES.md) |
| frontend observable capabilities | [`migration/FRONTEND_FEATURES.md`](migration/FRONTEND_FEATURES.md) + [`migration/frontend/`](migration/frontend/) |
| backend/domain/platform functions | [`migration/FUNCTION_INVENTORY.md`](migration/FUNCTION_INVENTORY.md) + [`migration/functions/`](migration/functions/) |
| existing design / product requirement reconciliation | [`migration/PRODUCT_REQUIREMENTS.md`](migration/PRODUCT_REQUIREMENTS.md) |
| migration code quality | [`migration/CODE_QUALITY.md`](migration/CODE_QUALITY.md) |
| backend optimization / commonization / blockers | [`migration/BACKEND_OPTIMIZATION.md`](migration/BACKEND_OPTIMIZATION.md) |
| new UI visual source / HTML mock registration | [`migration/UI_REFERENCE.md`](migration/UI_REFERENCE.md) |
| route migration | [`migration/ROUTE_MATRIX.md`](migration/ROUTE_MATRIX.md) |
| API/server migration | [`migration/API_MATRIX.md`](migration/API_MATRIX.md) |
| UI acceptance evidence | [`operations/ui-acceptance.md`](operations/ui-acceptance.md) |
| static delivery / visibility | [`operations/static-delivery.md`](operations/static-delivery.md) |
| Worker / Queue | [`operations/workers.md`](operations/workers.md) |
| operations | [`operations/README.md`](operations/README.md) |
| DB | [`database/README.md`](database/README.md) |
| DB history | [`database/change-log.md`](database/change-log.md) |
| non-migration backlog | [`implementation-backlog.md`](implementation-backlog.md) |
| local | [`../LOCAL.md`](../LOCAL.md) |
| deploy | [`../DEPLOY.md`](../DEPLOY.md) |

## Migration source-of-truth split

- CURRENT behavior: code/test/config
- DB: schema/migrations
- CURRENT Cloudflare: wrangler + actual Cloudflare settings
- TARGET architecture: `migration/README.md`
- execution/loop: `migration/AGENT_PROTOCOL.md`
- Git/branch/PR/merge: `migration/GIT_WORKFLOW.md`
- progress/current owner/next READY: `migration/STATUS.md`
- documentation truth ownership: `migration/DOC_MAP.md`
- CURRENT route inventory: `migration/CURRENT_ROUTES.md`
- frontend-observable capability/UX: `migration/FRONTEND_FEATURES.md` + `migration/frontend/*.md`
- backend/side-effect parity: `migration/FUNCTION_INVENTORY.md` + `migration/functions/*.md`
- existing design/product intent reconciliation: `migration/PRODUCT_REQUIREMENTS.md`
- code quality: `migration/CODE_QUALITY.md`
- optimization candidates/blockers: `migration/BACKEND_OPTIMIZATION.md`
- new visual target: `migration/UI_REFERENCE.md`
- route disposition: `migration/ROUTE_MATRIX.md`
- server/API disposition: `migration/API_MATRIX.md`

`docs/design-redesign/` is obsolete and removed from the migration workflow.
`app/(redesign)` is not a TARGET visual source.
The next UI visual source will be the user-provided HTML mock registered in `UI_REFERENCE.md`; until then its state remains `PENDING_HTML`.

`STATUS.md` is the only progress/work-item ledger.
`FRONTEND_FEATURES.md` + `frontend/*.md` are the only frontend capability ledger.
`FUNCTION_INVENTORY.md` + `functions/*.md` are the only backend/domain/platform function ledger.
`BACKEND_OPTIMIZATION.md` is the only optimization/blocker ledger.
`CODE_QUALITY.md` is the mandatory implementation-quality standard.

## Frontend inventory model

```text
CURRENT_ROUTES.md
  -> 86 CURRENT user-visible screens/routes

FRONTEND_FEATURES.md + frontend/*.md
  -> 432 baseline UX-* capabilities

FUNCTION_INVENTORY.md + functions/*.md
  -> FN-* backend/domain/platform contracts
```

`UX-*`と`FN-*`はmany-to-many。画面の存在だけで機能parityを判断しない。

MIG-0010/0011でcode/action/API/job/auth/permission/operationsを横断し、orphan・未監査・mapping漏れを0にする。432件は初期baselineであり、後続監査で追加してよい。

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

Antigravity adapter:

- `.agents/workflows/flamenode-migration.md`
- `.agents/skills/flamenode-migration/SKILL.md`
- `.agents/rules/flamenode-project.md`

全agentは同じrepository progress stateを使う。tool-local chat historyは正本ではない。

## Validation

文書のみ:

```sh
npm run check:docs
npm run check:project-docs
```

`check:project-docs` はmigration task、UX/FN inventory、source map、agent adapter、Git policy、obsolete design source除去の整合確認を含む。

## Historical

- `historical/README.md`
- `db-history/README.md`
- `.claude/flamenode/source/`

必要なhistorical文書だけを読む。current implementationへ自動復活させない。
