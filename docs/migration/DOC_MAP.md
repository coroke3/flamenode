# Documentation Map / Dedupe Rules

The migration must not create a second copy of every existing specification.

## Source-of-truth map

| Topic | Canonical source |
| --- | --- |
| repo-wide agent rules / safety | `AGENTS.md` |
| task routing | `docs/AI_CONTEXT.md` |
| migration target/invariants | `docs/migration/README.md`, `ARCHITECTURE.md` |
| migration state | `docs/migration/PROGRESS.md` |
| migration task graph | `docs/migration/WORK_ITEMS.md` |
| migration parity ledger | `docs/migration/FEATURE_INVENTORY.md` |
| all 86 screen URLs / mock ids | `docs/design-redesign/ROUTE_INVENTORY.md` |
| redesign principles/mock acceptance | `docs/design-redesign/` |
| current UI acceptance | `docs/operations/ui-acceptance.md` |
| current public/static/visibility behavior | `docs/operations/static-delivery.md` |
| DB schema | `src/lib/db/schema.ts` + `migrations/` (not Markdown duplication) |
| current Workers/bindings | `wrangler.toml`, `workers/*/wrangler.toml`, relevant operations docs |
| current deploy procedure | `DEPLOY.md` |

## Rules

- Migration docs describe **target/transition/progress**; current Active docs describe **current production behavior** until cutover.
- Do not copy schema columns, 86 route rows, binding IDs, command lists, or large test lists into multiple docs. Link to the canonical file.
- If a migration changes current production behavior, update the relevant Active doc in the same change and only then mark the migration item done.
- Historical/archive docs are evidence of past decisions, never current truth.
- A stale `Last verified` marker alone is not proof the contents are wrong. `DOC-001` must compare it with code/tests before editing.
- Prefer deleting/replacing duplicate prose with a short pointer over synchronizing two copies forever.

## DOC-001 audit output

For every Active `.md` touched by the migration classify it as one of:

- `canonical-current`
- `canonical-target`
- `task-router`
- `generated/inventory`
- `historical`
- `duplicate -> <canonical path>`
- `stale-needs-fix`

Do not mass-rewrite Markdown for style. Optimize context size and truth ownership first.
