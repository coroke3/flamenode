# FlameNode ドキュメント索引

> Status: Active
> Last verified: 2026-10-06
> Verified against commit: `99591f7b3387b6b33d113f2685d6b31e38085fdc`
> Source of truth: `AGENTS.md`, current code/test, `src/lib/db/schema.ts`, `migrations/`

## AI read order

通常:

`../AGENTS.md` → `AI_CONTEXT.md`該当行 → 対象コード/test

移行:

`../AGENTS.md` → `migration/AGENT_PROTOCOL.md` → `migration/README.md` → `migration/STATUS.md` → `migration/FUNCTION_INVENTORY.md` → 対象ledger/matrix/code/test

branch / PR / merge / handoffを伴う移行作業では [`migration/GIT_WORKFLOW.md`](migration/GIT_WORKFLOW.md) を正本とする。
正本の重複判断が必要な場合だけ [`migration/DOC_MAP.md`](migration/DOC_MAP.md) を読む。

Historical / archive / 完了済みphaseは現行仕様の根拠にしない。

## CURRENT / TARGET

- **CURRENT production**: Cloudflare Workers + OpenNext + Workers Static Assets。正確な実装・bindingはcode/config/Cloudflare実設定が正本。
- **TARGET migration**: [`migration/README.md`](migration/README.md) が正本。
- CURRENTとTARGETは移行完了まで併存する。

## Active entry points

| Purpose | Document |
| --- | --- |
| universal agent rules | [`../AGENTS.md`](../AGENTS.md) |
| task routing | [`AI_CONTEXT.md`](AI_CONTEXT.md) |
| **multi-agent migration protocol** | **[`migration/AGENT_PROTOCOL.md`](migration/AGENT_PROTOCOL.md)** |
| **migration Git / branch / PR / merge policy** | **[`migration/GIT_WORKFLOW.md`](migration/GIT_WORKFLOW.md)** |
| **target migration architecture** | **[`migration/README.md`](migration/README.md)** |
| **progress / next READY task** | **[`migration/STATUS.md`](migration/STATUS.md)** |
| **documentation source map / dedupe rules** | **[`migration/DOC_MAP.md`](migration/DOC_MAP.md)** |
| **existing-function parity inventory** | **[`migration/FUNCTION_INVENTORY.md`](migration/FUNCTION_INVENTORY.md)** |
| route migration | [`migration/ROUTE_MATRIX.md`](migration/ROUTE_MATRIX.md) |
| API/server migration | [`migration/API_MATRIX.md`](migration/API_MATRIX.md) |
| UI/UX redesign proposal | [`design-redesign/README.md`](design-redesign/README.md) |
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
- execution/loop semantics: `migration/AGENT_PROTOCOL.md`
- Git/branch/PR/merge policy: `migration/GIT_WORKFLOW.md`
- progress/current owner/next READY/dependencies: `migration/STATUS.md`
- documentation truth ownership: `migration/DOC_MAP.md`
- existing feature preservation: `migration/FUNCTION_INVENTORY.md` + `migration/functions/*.md`
- route disposition: `migration/ROUTE_MATRIX.md`
- server/API disposition: `migration/API_MATRIX.md`
- visual/information architecture: `design-redesign/`

`design-redesign/` is not the source of truth for permissions, DB/API behavior, side effects, or workflow semantics.

`STATUS.md` is the only progress/work-item ledger. Do not add parallel `PROGRESS.md` or `WORK_ITEMS.md` files. `FUNCTION_INVENTORY.md` + domain ledgers are the only feature-parity ledger.

## Agent invocation

共通実行契約は [`migration/AGENT_PROTOCOL.md`](migration/AGENT_PROTOCOL.md)。下記は薄い入口だけ。

### Claude Code

```text
/flamenode-migration
/loop /flamenode-migration
```

`.claude/loop.md` は反復時の短いwake-up contract。

### OpenAI Codex

Repo-scoped `flamenode-migration` skillを使う。

```text
Use the flamenode-migration skill and execute exactly one READY MIG task.
```

長期実行はCodex `/goal` を優先する。`.codex/skills/loop/SKILL.md` は`/loop`相当の手順互換であり、STATUSの1-task-per-cycle規則を変えない。

### Google Antigravity

```text
/flamenode-migration
```

- slash command: `.agents/workflows/flamenode-migration.md`
- migration knowledge: `.agents/skills/flamenode-migration/SKILL.md`
- loop compatibility: `.agents/skills/loop/SKILL.md`
- workspace rule: `.agents/rules/flamenode-project.md`

全agentは同じrepository progress stateを使う。tool-local chat historyは正本ではない。

## Validation

文書のみの変更:

```sh
npm run check:docs
npm run check:project-docs
```

`check:project-docs` はmigration task/function/inventory/source-map/adapterの整合確認を含む。

## Historical

- [`historical/README.md`](historical/README.md)
- [`db-history/README.md`](db-history/README.md)
- `.claude/flamenode/`

必要なhistorical文書1件だけを読む。

実装変更時は該当Activeだけ更新する。schema列・live ID・急速に変化する実装値をMarkdownへ重複させない。ただしmigration acceptance evidenceとして必要なsnapshot値は例外とする。
