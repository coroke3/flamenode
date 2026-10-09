# File-level migration execution protocol

> Status: Active / Source-to-target wiring, per-file checkpoint, independent evidence
> Progress ledger: [FILE_MIGRATION_MATRIX.md](FILE_MIGRATION_MATRIX.md)
> Parent MIG state: [STATUS.md](STATUS.md); decisions: [OPEN_DECISIONS.md](OPEN_DECISIONS.md)
> Implementation: [IMPLEMENTATION_RUNBOOK.md](IMPLEMENTATION_RUNBOOK.md), [TASK_MICRO_UNITS.md](TASK_MICRO_UNITS.md)

## Three levels of state — never confuse them

1. **Task:** STATUS.md owns MIG READY / IN_PROGRESS / REVIEW / BLOCKED / DONE and dependencies. A file being verified never advances a task automatically.
2. **File:** FILE_MIGRATION_MATRIX.md owns CURRENT source → exact TARGET files / adapters, first owner MIG, state, PR / tests / SHA evidence. One CURRENT source is a stable primary key even if it produces multiple targets.
3. **Behavior:** CURRENT_ROUTES.md and screen-mapping/README.md own screen URL / UX / FN; route-handlers/README.md owns RH-001..033 (33 methods); server-actions/README.md owns SA-001..110 (110 action units); FUNCTION_INVENTORY.md owns FN. A green compile is not behavior parity.

## Read → claim → implement → verify → checkpoint

1. Read AGENTS.md, AGENT_PROTOCOL.md, STATUS.md, OPEN_DECISIONS.md and the current MIG card, then filter FILE_MIGRATION_MATRIX.md to **the task's rows only**. For broad MIG use one micro-unit from TASK_MICRO_UNITS.md.
2. Open actual CURRENT files, exported symbols, consumers/callers, and adjacent tests. Candidate target paths prefixed with + and entries saying TBD are NOT existing files.
3. Discover the current owner PR/branch, decide a single file owner, record exact impacted paths, UX/FN/RH/SA IDs and test plan. Check live PR after branch creation to avoid double-writers.
4. Add new file row(s) before implementing new files outside the baseline inventory. When an existing source has multiple consumers, update it in one row listing all actual target/bridge files. Preserve original row after deletion as RETIRED with evidence.
5. Write regression/characterization tests, create new provider(s), verify exports and runtime binding, preserve legacy adapter and gradually switch consumers. Never remove a route/old action on first implementation pass.
6. Run tests, compare state/permission/errors/DB audit/Queue effects, update each touched file's state/evidence and the relevant UX/FN/Route/RH/SA ledgers.
7. Finish at REVIEW only when the entire MIG and all micro-units are functionally complete. DONE requires independent review and CI; Phase Gate/higher-risk prod action requires separate approval.
8. On multiwake work, checkpoint the same Draft PR branch (owner, HEAD SHA, current micro-unit, each changed file, next path and tests). New wake resumes that PR; never creates another writer PR.

## File-state machine and evidence

| State | Required meaning | Required evidence |
| --- | --- | --- |
| NOT_STARTED | source inventory exists, migration unstarted | source path + contract + owner MIG |
| IN_PROGRESS | one writer implementing current file | real PR, 40-character HEAD SHA, current micro-unit |
| BRIDGED | old import/URL and new actual module both run | exact existing target path, importer mapping, PR + SHA, test command and output |
| PARITY_VERIFIED | old/new behavior, authz and side effects match | PR, SHA, named test command + CI/log URL, affected UX/FN/RH/SA evidence |
| CUTOVER | traffic/consumers switched in real environment | prior evidence + explicit production approval + monitoring/rollback |
| RETIRED | all old imports removed and legacy URL behavior preserved | prior evidence + Phase9/owner approval and importer=0 proof |
| RETAINED | intentionally stays in architecture | documented reason, owner, test proof and PR |
| BLOCKED | safe continuation impossible | PR and SHA, exact blocker, responsible owner and resume condition |

**Evidence syntax:** Every state other than NOT_STARTED must have PR#123 and SHA=<40 hex>. BRIDGED/PARITY_VERIFIED and later also require TEST=<exact command> and a CI/log link. CUTOVER/RETIRED require APPROVAL=<reference>. These strings represent actual run identifiers; never fabricate them. DONE is a MIG state, never a file state.

## File mapping is a wiring contract

For every changed file document: current exact file#export or URL/method → actual target file#export → every importer, API consumer or browser route. Show how package exports resolve under Node/Next/Astro/Vite/Workers. TypeScript path aliases do not establish runtime resolution. For DB work specify D1 binding, SQL transaction/audit/Queue; for public routes specify static HTML visibility fence, R2/caching and SEO; for private routes specify server-side auth and cross-SPA navigation.

Template for a MIG PR:

~~~text
Parent MIG: MIG-XXXX | Unit UXX | PR#... | Owner: ... | HEAD SHA: ...
File path (source): ...
Current symbol / URL / RH / SA: ...
Target real path(s) and exported symbol(s): ...
Importers / HTTP clients / consumers: ...
Compatibility bridge and rollback: ...
UX/FN/permission/visibility/queue/audit/DTO: ...
Changed files in this wake: ...
Tests run and results + CI URL: ...
Tests not run and why: ...
File state (FILE_MIGRATION_MATRIX.md): ...
MIG state (STATUS.md): ...
Next wake (one file/micro-unit): ...
~~~

## Worked connection examples

**MIG-0301:** CURRENT src/lib/slots/slotReservationLimit.ts → PLANNED packages/domain/src/slots/reservationLimit.ts. Preserve original 3 named exports and normalization/message byte-for-byte. The original file becomes a compatibility bridge. Verify consumer src/lib/slots/slotReservationLimitGuard.ts still loads but never move that DB/SQL/server-only code during MIG-0301. Tests: slotReservationLimit.contract.test.mjs, slotReservationLimitGuard.execution.test.mjs, typecheck/unit/verify:fast and Node runtime import.

**MIG-0308:** move schema.base.ts and schema.canonical.ts together into packages/db; schema.ts stays an explicit re-export bridge; configure drizzle.config.ts and DB checker; zero generated DDL, old Next/Hono/Workers build PASS. Remote D1 untouched until separate permission.

**MIG-0704:** apps/app remains Personal (/dashboard, /entry); add apps/ops as independent Ops (/manage, /admin). Separate worker/bundle/asset namespaces /_personal_assets/* and /_ops_assets/*, same-origin Auth cookie, cross-SPA full navigation and Hono owner/role checks. Verify all deep links and permissions.

**D-03/D-04:** historic Auth User likes/bookmarks fan-out to all approved X owner links (not manager-only), deduplicate by X/video/type, count differences. Cutover is one-shot with write freeze and final reconciliation. Migration PR and file parity do not authorize Remote D1 writes.

## Safety and stop conditions

- Source file or method absent, RH/SA ID disappeared, migration card refers to nonexistent provider: BLOCKED and record real code/plan conflict; no guessed implementation.
- Candidate +path or TBD still present when marking BRIDGED/PARITY_VERIFIED: fail.
- Old source removed with no RETIRED file row and verified import/URL compatibility: fail.
- Parallel PR touched shared file owned by another agent: stop/coordinate handoff.
- D-08 UI HTML remains missing; Phase2/4/5 visual work not started by assumption.
- Production Cloudflare Route, Remote D1, secrets, Auth.js cutover or Phase Gate requested without explicit approval: stop.
- Checker passing means ledger structure is correct, NOT real running /loop, code parity, or zero-1102.

## Required checks

~~~bash
node scripts/check-migration-file-progress.mjs
node --test scripts/check-migration-file-progress.test.mjs
node scripts/check-migration-docs.mjs
node scripts/check-migration-task-cards.mjs
npm run check:project-docs
npm run typecheck
npm run test:unit
npm run verify:fast
~~~

Resume only after recording the exact HEAD, PR, test evidence, file changes and next single micro-unit.