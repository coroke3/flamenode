# FlameNode Migration Documentation Map

> Status: Active / Source-of-truth map
> Last verified: 2026-10-06
> Baseline commit: `99591f7b3387b6b33d113f2685d6b31e38085fdc`

移行で同じ仕様を複数Markdownへ複製しないための正本マップ。

## Canonical sources

| Topic | Canonical source |
| --- | --- |
| repo-wide agent rules / safety | `AGENTS.md` |
| task routing | `docs/AI_CONTEXT.md` |
| migration architecture / invariants / phases | `docs/migration/README.md` |
| cross-agent execution / loop semantics | `docs/migration/AGENT_PROTOCOL.md` |
| current phase / task / owner / dependency state | `docs/migration/STATUS.md` |
| existing-function parity index | `docs/migration/FUNCTION_INVENTORY.md` |
| detailed function contracts | `docs/migration/functions/*.md` |
| route disposition | `docs/migration/ROUTE_MATRIX.md` |
| Server Action / Route Handler / API disposition | `docs/migration/API_MATRIX.md` |
| all redesign screen URLs / mock ids | `docs/design-redesign/ROUTE_INVENTORY.md` + `app/(redesign)/dev/redesign/_catalog.ts` |
| redesign principles / IA / visual acceptance | `docs/design-redesign/` |
| CURRENT public/static/visibility behavior | `docs/operations/static-delivery.md` + current code/tests |
| CURRENT UI acceptance | `docs/operations/ui-acceptance.md` |
| DB schema | `src/lib/db/schema.ts` + `migrations/` |
| CURRENT Worker/bindings | `wrangler.toml`, `workers/*/wrangler.toml`, actual Cloudflare settings |
| deploy procedure | `DEPLOY.md` |

## Rules

- Migration docs describe **TARGET / transition / progress**. CURRENT behavior remains code/test/config driven until cutover.
- Do not duplicate exact schema columns, route inventories, binding IDs, API fields, or long command/test lists across multiple docs.
- Prefer a short pointer to the canonical source over maintaining two copies of the same prose.
- If migration changes CURRENT production behavior, update the relevant Active CURRENT document in the same change before marking the MIG task done.
- Historical/archive docs are evidence of past decisions, not current truth.
- `Last verified` being old is not enough to rewrite a document; compare it with current code/tests/config first.
- `STATUS.md` is the only progress/task-state source. Do not add a second `PROGRESS.md` or `WORK_ITEMS.md` ledger.
- `FUNCTION_INVENTORY.md` + domain ledgers are the only feature-parity source. Do not add a second feature inventory.

## Active-document classification

When migration touches an Active Markdown file, classify it mentally or in the task evidence as one of:

- `canonical-current`
- `canonical-target`
- `task-router`
- `progress-ledger`
- `function-ledger`
- `generated/inventory`
- `historical`
- `duplicate -> <canonical path>`
- `stale-needs-fix`

Do not mass-rewrite Markdown for style. Optimize truth ownership, context size, and agent handoff first.
