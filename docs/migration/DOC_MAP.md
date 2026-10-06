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
| migration Git / branch / PR / merge policy | `docs/migration/GIT_WORKFLOW.md` |
| current phase / task / owner / dependency state | `docs/migration/STATUS.md` |
| existing-function parity index / implementation audit | `docs/migration/FUNCTION_INVENTORY.md` + `docs/migration/functions/*.md` |
| **frontend-visible behavior / UX preservation** | **`docs/migration/FRONTEND_FEATURE_INVENTORY.md`** |
| **backend commonization / optimization candidates and decisions** | **`docs/migration/BACKEND_OPTIMIZATION_LEDGER.md`** |
| route disposition | `docs/migration/ROUTE_MATRIX.md` |
| Server Action / Route Handler / API disposition | `docs/migration/API_MATRIX.md` |
| all redesign screen URLs / mock ids | `docs/design-redesign/ROUTE_INVENTORY.md` + `app/(redesign)/dev/redesign/_catalog.ts` |
| redesign principles / IA / visual acceptance | `docs/design-redesign/` |
| CURRENT public/static/visibility behavior | `docs/operations/static-delivery.md` + current code/tests |
| CURRENT UI acceptance | `docs/operations/ui-acceptance.md` |
| DB schema | `src/lib/db/schema.ts` + `migrations/` |
| CURRENT Worker/bindings | `wrangler.toml`, `workers/*/wrangler.toml`, actual Cloudflare settings |
| deploy procedure | `DEPLOY.md` |

## Truth ownership boundaries

- `FUNCTION_INVENTORY.md` / domain ledgers: **what exists internally, permission/effects/tests/evidence**.
- `FRONTEND_FEATURE_INVENTORY.md`: **what a user can see/do and what UX/state must not regress**.
- `BACKEND_OPTIMIZATION_LEDGER.md`: **how implementation may be improved without silently changing frontend contracts**.
- `ROUTE_MATRIX.md`: **where each screen/URL migrates**.
- `API_MATRIX.md`: **where each server entrypoint migrates**.

同じ情報を複製せず、必要ならID/リンクで接続する。

## Rules

- Migration docs describe **TARGET / transition / progress**. CURRENT behavior remains code/test/config driven until cutover.
- Do not duplicate exact schema columns, route inventories, binding IDs, API fields, or long command/test lists across multiple docs.
- Prefer a short pointer to the canonical source over maintaining two copies of the same prose.
- If migration changes CURRENT production behavior, update the relevant Active CURRENT document in the same change before marking the MIG task done.
- Historical/archive docs are evidence of past decisions, not current truth.
- `Last verified` being old is not enough to rewrite a document; compare it with current code/tests/config first.
- `STATUS.md` is the only progress/task-state source. Do not add a second `PROGRESS.md` or `WORK_ITEMS.md` ledger.
- `FUNCTION_INVENTORY.md` + domain ledgers are the only implementation-level feature parity ledger.
- `FRONTEND_FEATURE_INVENTORY.md` is the only frontend-visible behavior/UX preservation ledger.
- `BACKEND_OPTIMIZATION_LEDGER.md` is the only migration optimization/refactor candidate ledger.
- `GIT_WORKFLOW.md` is the only migration branch/PR/merge policy source. Tool-specific skills/commands must link to it rather than duplicating Git rules.
- Backend optimization must not rewrite frontend contracts by implication. Visible change requires explicit review/approval.

## Active-document classification

When migration touches an Active Markdown file, classify it mentally or in the task evidence as one of:

- `canonical-current`
- `canonical-target`
- `task-router`
- `progress-ledger`
- `function-ledger`
- `frontend-contract-ledger`
- `backend-optimization-ledger`
- `git-workflow`
- `generated/inventory`
- `historical`
- `duplicate -> <canonical path>`
- `stale-needs-fix`

Do not mass-rewrite Markdown for style. Optimize truth ownership, context size, and agent handoff first.
