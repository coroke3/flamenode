# AGENTS.md

> Status: Active
> Last verified: 2026-10-07
> Source of truth: current code/test, `src/lib/db/schema.ts`, `migrations/`, Cloudflare config

## Start

1. Read this file.
2. Read the matching row in [`docs/AI_CONTEXT.md`](docs/AI_CONTEXT.md).
3. Read target code and related tests.
4. For platform/UI migration, read [`docs/migration/AGENT_PROTOCOL.md`](docs/migration/AGENT_PROTOCOL.md) and follow it exactly.

Do not bulk-load the repository, Historical/archive material, completed migration phases, or old `.claude/flamenode/source/` documents.

## Precedence

1. Current code/config/tests
2. `src/lib/db/schema.ts` and `migrations/`
3. Active CURRENT operations/docs
4. For migration tasks: `docs/migration/*`
5. `設計/` and other active design-intent documents when requirement reconciliation is needed
6. Historical/archive material

Migration work must distinguish **CURRENT** production behavior from **TARGET** architecture.

`docs/design-redesign/` is obsolete and must not be used. New visual design remains pending until the user supplies an HTML mock and it is registered in `docs/migration/UI_REFERENCE.md`.

## Sources of truth

| Area | Source |
| --- | --- |
| DB | `src/lib/db/schema.ts` |
| migrations | `migrations/` |
| current Cloudflare bindings/routes | `wrangler.toml`, `workers/*/wrangler.toml`, actual Cloudflare config |
| migration architecture | `docs/migration/README.md` |
| multi-agent execution | `docs/migration/AGENT_PROTOCOL.md` |
| migration Git/PR workflow | `docs/migration/GIT_WORKFLOW.md` |
| migration progress | `docs/migration/STATUS.md` |
| CURRENT user-visible routes | `docs/migration/CURRENT_ROUTES.md` |
| 既存機能の全件カタログ | `docs/migration/FEATURE_CATALOG.md` |
| frontend observable capabilities | `docs/migration/FRONTEND_FEATURES.md` + `docs/migration/frontend/*.md` |
| backend/domain/platform parity | `docs/migration/FUNCTION_INVENTORY.md` + `docs/migration/functions/*.md` |
| requirement reconciliation | `docs/migration/PRODUCT_REQUIREMENTS.md` |
| migration code quality | `docs/migration/CODE_QUALITY.md` |
| backend optimization | `docs/migration/BACKEND_OPTIMIZATION.md` |
| new visual UI input | `docs/migration/UI_REFERENCE.md` |
| route migration | `docs/migration/ROUTE_MATRIX.md` |
| API/server migration | `docs/migration/API_MATRIX.md` |
| deploy | `DEPLOY.md` |
| operations | `docs/operations/README.md` |

## Global invariants

- Do not edit SQL text of already-applied migrations.
- Do not reintroduce old-column fallback, runtime DDL, deprecated wrappers, or uncontrolled dual writes.
- `event_staff.permission_preset = 'owner'` remains representative; never leave an event with zero owners.
- Authorization must be enforced server-side, not only in UI.
- Public APIs return explicit DTOs only.
- D1 remains canonical; R2/KV remain projection/cache/delivery layers.
- Public visibility remains fail-closed where CURRENT requires it.
- Preserve audit, retry safety, idempotency, atomicity, and rollback guarantees.
- Remote D1 migration is read-only during preflight and never auto-applied.
- main direct push is prohibited; use branch + PR + required review.
- Migration Git operations follow `docs/migration/GIT_WORKFLOW.md`.
- Production deploy, Worker Route, Custom Domain, Remote D1, or secret changes require explicit user approval.

## CURRENT production

CURRENT is Next.js + OpenNext + Cloudflare Workers Static Assets behind `flamenode-web`, plus existing fast/content/sync background Workers.

CURRENT remains a rollback target until migration parity is verified.

## TARGET migration

Target details live in `docs/migration/README.md`.

Summary only:

- Public: Astro SSG + React Islands
- Public request: thin visibility gateway + Static Assets
- Private UI: React + Vite SPA
- API: Hono
- Data: D1 canonical / R2 projection / Queue generation
- Existing background Workers retained unless a later task proves replacement is better
- Same `flamenode.net` URL space via staged Worker Routes
- request-time SSR disabled by default

Do not infer missing details from this summary; read the migration docs.

## Multi-agent migration

Claude Code, Codex, Antigravity, and other agents share one protocol:

[`docs/migration/AGENT_PROTOCOL.md`](docs/migration/AGENT_PROTOCOL.md)

Tool adapters are intentionally thin:

- Claude: `.claude/commands/flamenode-migration.md`, `.claude/skills/flamenode-migration/SKILL.md`
- Codex: `.codex/skills/flamenode-migration/SKILL.md`
- Antigravity: `.agents/workflows/flamenode-migration.md`, `.agents/skills/flamenode-migration/SKILL.md`, `.agents/rules/flamenode-project.md`

Repository Markdown state is authoritative; chat history is not.

One migration iteration equals exactly one dependency-ready `MIG-*` task. Update `STATUS.md` and affected inventories before another iteration.

## Existing function / UX preservation

Migration and redesign must not silently delete functionality.

Before a route/screen/domain is considered migrated:

- first read `docs/migration/FEATURE_CATALOG.md` to identify the complete product capability set in scope

- identify all affected `UX-*` capabilities
- identify all affected `FN-*` backend/domain contracts
- verify permissions, privacy, visibility and side effects
- verify loading/error/empty/forbidden/degraded/pending/retry states where applicable
- verify responsive/keyboard/focus behavior where applicable
- verify URL/query/deep-link/reload/back-forward semantics
- preserve existing behavior or obtain explicit approval for a change/removal

Visual completion alone is never functional completion.

## UI redesign source

`docs/design-redesign/` is not a valid source and is removed from the migration workflow.

Until `docs/migration/UI_REFERENCE.md` changes from `PENDING_HTML`:

- do not infer the target visual design from `app/(redesign)`
- do not finalize a new visual hierarchy on your own
- continue CURRENT route/UX/requirement auditing

After the user supplies an HTML mock, register it in `UI_REFERENCE.md` and map it to CURRENT routes and `UX-*` capabilities.

The HTML mock governs visual/IA intent only. It does not by itself override permissions, business rules, visibility, data ownership, API semantics, audit, notifications, retry/idempotency, URL compatibility, or destructive-operation semantics.

## Existing design / requirement reconciliation

Follow `docs/migration/PRODUCT_REQUIREMENTS.md`.

- CURRENT code/test/config is the first source for actual behavior.
- Active design documents may contain product intent or missed requirements.
- Historical documents are background evidence only.
- If CURRENT and design intent differ, record `CURRENT_DIVERGENCE`; do not silently revert either side.
- Frontend-visible behavior changes require explicit decision; CURRENT remains the default until then.

## Code quality

Every migration implementation follows `docs/migration/CODE_QUALITY.md`.

Required standard:

- code must be clear, readable and maintainable
- an experienced production engineer should find responsibilities, naming, dependency direction and failure boundaries natural
- domain vocabulary must be precise
- framework adapters should remain thin
- domain/business logic should be framework-neutral where practical
- transaction, permission, visibility, audit and post-commit side effects must be explicit
- typed contracts and boundary validation are preferred
- clever abstractions, mega helpers, flag-heavy generic CRUD and hidden side effects are avoided
- tests fix behavior/invariants rather than implementation details

Code line reduction is not a goal. A shorter implementation is valuable only when semantics become clearer, not weaker.

## Target boundaries

As phases progress, use these boundaries:

- `apps/site`: Astro public SSG/Islands
- `apps/app`: authenticated/private React SPA
- `apps/api`: Hono HTTP boundary
- `packages/ui`: reusable React UI without Next/Astro/Hono/data bindings
- `packages/domain`: business logic without framework imports
- `packages/contracts`: shared Zod/API contracts
- `packages/public-data`: public projection contracts/loaders
- `workers/*`: background/queue/scheduled jobs

Do not move the entire current tree up-front. Add boundaries only when the active phase requires them.

## Work rules

- Fix task scope and non-scope before editing.
- Prefer the smallest coherent change that advances the current gate.
- For migration writes, use **1 MIG task = 1 short-lived branch = 1 PR = 1 squash merge** unless `GIT_WORKFLOW.md` explicitly allows an exception.
- Open a draft PR early; the open task PR is the writer lock.
- Only one migration writer lane is active by default; other agents may review/audit in parallel.
- Do not have multiple agents edit the same file/domain/task concurrently.
- DB/auth/security/visibility/public API/Cloudflare routing decisions require stronger review.
- Separate code landing from production traffic cutover/routing changes.
- Keep compatibility bridges explicit and record their removal condition.
- Do not invent a custom router, SSG, island runtime, auth protocol, or cache framework when a standard solution exists.
- Do not rewrite existing D1/R2/Queue/Auth merely because framework migration is in progress.

## Model / agent escalation

Use lightweight agents/models for bounded inventory, search, docs and mechanical edits.
Use stronger reasoning/review for architecture, DB, auth, permissions, security, visibility, routing, destructive changes, gates and final review.

Stop/escalate when:

- CURRENT/TARGET is ambiguous
- the task crosses multiple high-risk domains
- auth/permission/visibility/database destruction is involved
- production Cloudflare/Remote D1 changes are required
- tests conflict with requested behavior
- rollback is unclear
- an optimization requires frontend behavior changes

## Validation

Run checks relevant to the change and state what was not run and why.

```sh
npm run typecheck
npm run lint
npm run test:unit
npm run test:workers
npm run test:integration
npm run verify:fast
npm run verify:full
npm run check:docs
npm run check:project-docs
npm run check:db-schema
npm run check:db-legacy
npm run check:public-api-contract
```

`npm run check:project-docs` validates migration task/function/UX/source-map/adapter/Git-policy consistency through `scripts/check-migration-docs.mjs`.

Migration gates may require additional CPU/build/visibility/auth/UI measurements defined in `docs/migration/README.md`.

## Completion report

Report only:

- changed
- preserved
- migration/task state
- validations/results
- not-run checks/reasons
- rollback
- blockers/next task
