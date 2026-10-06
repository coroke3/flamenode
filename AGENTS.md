# AGENTS.md

> Status: Active
> Last verified: 2026-10-06
> Verified against commit: `99591f7b3387b6b33d113f2685d6b31e38085fdc`
> Source of truth: `src/lib/db/schema.ts`, `migrations/`, `wrangler.toml`, `workers/*/wrangler.toml`, current code/test

## Start

1. Read this file.
2. Read the matching row in [`docs/AI_CONTEXT.md`](docs/AI_CONTEXT.md).
3. Read target code and related tests.
4. For platform/UI migration only, read [`docs/migration/AGENT_PROTOCOL.md`](docs/migration/AGENT_PROTOCOL.md).

Do not bulk-load the repository, Historical/archive material, completed phases, or old `.claude/flamenode/source/` documents.

## Precedence

1. Current code/config/tests
2. `src/lib/db/schema.ts` and `migrations/`
3. Active docs
4. For migration tasks only: `docs/migration/*`
5. `docs/design-redesign/*` / `設計/`
6. Historical/archive material

Migration work must distinguish **CURRENT** production from **TARGET** architecture.

## Sources of truth

| Area | Source |
| --- | --- |
| DB | `src/lib/db/schema.ts` |
| migrations | `migrations/` |
| current Cloudflare bindings | `wrangler.toml`, `workers/*/wrangler.toml`, actual Cloudflare config |
| migration architecture | `docs/migration/README.md` |
| multi-agent execution | `docs/migration/AGENT_PROTOCOL.md` |
| **migration Git/PR workflow** | **`docs/migration/GIT_WORKFLOW.md`** |
| migration progress | `docs/migration/STATUS.md` |
| existing-function parity | `docs/migration/FUNCTION_INVENTORY.md` |
| route migration | `docs/migration/ROUTE_MATRIX.md` |
| API/server migration | `docs/migration/API_MATRIX.md` |
| redesign | `docs/design-redesign/README.md` and its review order |
| executable redesign inventory | `app/(redesign)/dev/redesign/_catalog.ts` |
| deploy | `DEPLOY.md` |
| operations | `docs/operations/README.md` |

## Global invariants

- Do not edit SQL text of already-applied migrations.
- Do not reintroduce old-column fallback, runtime DDL, deprecated wrappers, or uncontrolled dual writes.
- `event_staff.permission_preset = 'owner'` remains the representative source; never leave an event with zero owners.
- Authorization must be enforced server-side, not only in UI.
- Public APIs return explicit DTOs only.
- D1 remains canonical; R2/KV remain projections/cache/delivery layers.
- Public visibility must remain fail-closed where CURRENT requires it.
- Preserve audit, retry safety, idempotency, atomicity, and rollback guarantees.
- Remote D1 migration is read-only during preflight and never auto-applied.
- main direct push is prohibited; use branch + PR + required review.
- Migration branches/PRs/merges follow `docs/migration/GIT_WORKFLOW.md`.
- Production deploy, Worker Route, Custom Domain, Remote D1, or secret changes require explicit user approval.

## CURRENT production

CURRENT is still Next.js + OpenNext + Cloudflare Workers Static Assets behind `flamenode-web`, plus existing fast/content/sync background Workers.

This CURRENT path remains a rollback target until migration parity is verified.

## TARGET migration

Target details live only in `docs/migration/README.md`.

Summary:

- Public: Astro SSG + React Islands
- Public request: thin visibility gateway + Static Assets
- Private UI: React + Vite SPA
- API: Hono
- Data: D1 canonical / R2 projection / Queue generation
- Existing background Workers retained unless a later task proves replacement is better
- Same `flamenode.net` URL space via staged Worker Routes
- request-time SSR disabled by default

Do not infer details from this summary; read the migration docs.

## Multi-agent migration

Claude Code, Codex, Antigravity, and other agents share one protocol:

[`docs/migration/AGENT_PROTOCOL.md`](docs/migration/AGENT_PROTOCOL.md)

Tool adapters are intentionally thin:

- Claude: `.claude/commands/flamenode-migration.md`, `.claude/skills/flamenode-migration/SKILL.md`
- Codex: `.codex/skills/flamenode-migration/SKILL.md`
- Antigravity: `.agents/workflows/flamenode-migration.md`, `.agents/skills/flamenode-migration/SKILL.md`, `.agents/rules/flamenode-project.md`

The repository Markdown state is authoritative; chat history is not.

One migration iteration equals exactly one `MIG-*` task. Update `STATUS.md` and affected inventories before starting another iteration.

## Redesign / feature preservation

UI redesign is part of migration but must not silently delete functionality.

Before a screen is considered migrated:

- map it to existing function IDs in `FUNCTION_INVENTORY.md`
- verify permission and side effects
- verify loading/error/empty/permission states
- verify responsive behavior
- preserve or explicitly approve removal of every existing capability

Visual completion alone is not functional completion.

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

- Fix the task scope and non-scope before editing.
- Prefer the smallest change that advances the current gate.
- For migration writes, use **1 MIG task = 1 short-lived branch = 1 PR = 1 squash merge** unless `GIT_WORKFLOW.md` explicitly allows an exception.
- Open a draft PR early; the open task PR is the live lock preventing duplicate writers for the same MIG task.
- Only one migration writer lane is active by default; other agents may review/audit in parallel.
- Do not have multiple agents edit the same file/domain/task concurrently.
- DB/auth/security/visibility/public API/Cloudflare routing decisions require Lead-level review.
- Separate implementation landing from production traffic cutover/routing changes.
- Keep compatibility bridges explicit and record their removal condition.
- Do not invent a custom router, SSG, island runtime, auth protocol, or cache framework when a standard solution exists.
- Do not rewrite existing D1/R2/Queue/Auth just because a migration is in progress.

## Model escalation

Use lightweight models for search, inventories, simple docs, fixture work, and bounded mechanical edits.
Use stronger reasoning for architecture, DB, auth, permissions, security, visibility, routing, destructive changes, gates, and final review.

Stop/escalate when:

- CURRENT/TARGET is ambiguous
- the task crosses 3+ risk domains
- auth/permission/visibility/database destruction is involved
- production Cloudflare/Remote D1 changes are required
- tests conflict with the requested migration behavior
- rollback is unclear

## Validation

Run only checks relevant to the change; state what was not run and why.

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

`npm run check:project-docs` also validates migration task/function/inventory consistency through `scripts/check-migration-docs.mjs`.

Migration gates may require additional CPU/build/visibility/auth/UI measurements defined in `docs/migration/README.md`.

## Completion report

Report only:

- changed
- preserved
- migration/task state
- validations and results
- not-run checks and reasons
- rollback
- blockers / next task
