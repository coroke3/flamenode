# FlameNode Migration Documentation Map

> Status: Active / source-of-truth map
> Last verified: 2026-10-07

移行で同じ仕様を複数Markdownへ複製しないための正本マップ。

## Canonical sources

| Topic | Canonical source |
| --- | --- |
| repo-wide agent rules / safety | `AGENTS.md` |
| task routing | `docs/AI_CONTEXT.md` |
| migration architecture / invariants / phases | `docs/migration/README.md` |
| cross-agent execution / loop semantics | `docs/migration/AGENT_PROTOCOL.md` |
| migration Git / branch / PR / merge policy | `docs/migration/GIT_WORKFLOW.md` |
| migration code quality | `docs/migration/CODE_QUALITY.md` |
| current phase / task / owner / dependency state | `docs/migration/STATUS.md` |
| CURRENT user-visible routes | `docs/migration/CURRENT_ROUTES.md` |
| frontend observable capabilities | `docs/migration/FRONTEND_FEATURES.md` + `docs/migration/frontend/*.md` |
| backend/domain/platform function parity | `docs/migration/FUNCTION_INVENTORY.md` + `docs/migration/functions/*.md` |
| existing design/product requirement reconciliation | `docs/migration/PRODUCT_REQUIREMENTS.md` |
| new UI visual source / HTML mock registration | `docs/migration/UI_REFERENCE.md` |
| backend commonization / optimization / blocker assessment | `docs/migration/BACKEND_OPTIMIZATION.md` |
| route target/disposition | `docs/migration/ROUTE_MATRIX.md` |
| Server Action / Route Handler / API disposition | `docs/migration/API_MATRIX.md` |
| CURRENT public/static/visibility behavior | `docs/operations/static-delivery.md` + current code/tests |
| CURRENT UI behavior evidence | `docs/operations/ui-acceptance.md` + current code/tests |
| DB schema | `src/lib/db/schema.ts` + `migrations/` |
| CURRENT Worker/bindings | `wrangler.toml`, `workers/*/wrangler.toml`, actual Cloudflare settings |
| deploy procedure | `DEPLOY.md` |

## UI source rule

- `docs/design-redesign/` is removed and is not a migration source.
- `app/(redesign)` is not an authoritative target design.
- New visual/information-architecture target remains `UI_REFERENCE.md = PENDING_HTML` until the user supplies an HTML mock.
- HTML mock never overrides permission/business/visibility/side-effect contracts by itself.

## Rules

- Migration docs describe TARGET / transition / progress. CURRENT behavior remains code/test/config driven until cutover.
- `CURRENT_ROUTES.md` owns the 86 USER_SCREEN route baseline.
- `FRONTEND_FEATURES.md` + `frontend/*.md` own `UX-*` frontend observable behavior.
- `FUNCTION_INVENTORY.md` + `functions/*.md` own `FN-*` backend/domain/platform functions.
- `UX-*` and `FN-*` are intentionally many-to-many.
- `PRODUCT_REQUIREMENTS.md` owns reconciliation between current implementation and existing design intent.
- `BACKEND_OPTIMIZATION.md` owns optimization/blocker decisions.
- `CODE_QUALITY.md` owns implementation quality standards.
- `STATUS.md` is the only progress/task-state source. Do not add `PROGRESS.md`/`WORK_ITEMS.md`.
- `GIT_WORKFLOW.md` is the only branch/PR/merge policy source.
- Do not duplicate exact schema columns, binding IDs, API fields, or long command lists across docs.
- If migration changes CURRENT production behavior, update the relevant Active CURRENT document in the same change before task DONE.
- Historical/archive docs are evidence, not current truth.
- Existing design documents can reveal missed requirements, but conflicts must be reconciled rather than silently applied.

## Active-document classification

- `canonical-current`
- `canonical-target`
- `requirement-reconciliation`
- `ui-reference`
- `task-router`
- `progress-ledger`
- `frontend-ux-ledger`
- `function-ledger`
- `optimization-ledger`
- `code-quality`
- `git-workflow`
- `generated/inventory`
- `historical`
- `duplicate -> <canonical path>`
- `stale-needs-fix`

Do not mass-rewrite docs for style. Optimize truth ownership, context size, verification, and agent handoff.