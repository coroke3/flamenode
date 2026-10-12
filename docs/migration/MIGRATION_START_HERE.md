# Migration: minimal agent entrypoint

> **Read this before /flamenode-migration, /loop, Codex, Claude or Antigravity.** Rules in root [AGENTS.md](../../AGENTS.md) and [AGENT_PROTOCOL.md](AGENT_PROTOCOL.md) still apply. This page is an index, **not** a second execution policy or progress ledger.

## Autonomous one-wake operation (self-driving agent)

Start with `node scripts/print-migration-task-context.mjs --next` (or `npm run migration:next`). The selector reads only the **merged** `STATUS.md` graph, filters unfinished dependencies and unresolved required decisions, and prefers independent MIG-0401 performance preflight when READY. **It is not a GitHub lock or an approval.** For an explicit user-selected task, use `node scripts/print-migration-task-context.mjs MIG-XXXX`.

Each agent invocation performs this deterministic sequence without asking for routine permission:

1. `git fetch origin main`; read merged task/dependency rows. Query **all open migration PRs** (and branch work-item checkpoints) using `gh pr list --state open --json number,headRefName,title,isDraft` or a connected GitHub tool. If the chosen MIG already has an owner PR, **resume that branch and its work-item** instead of making a second PR. If another agent owns the PR and no handoff is documented, stop with an exact blocker.
2. If unclaimed: confirm `READY`, dependencies `DONE` on main, required D-xx decisions and non-overlapping file ownership. Create `migration/mig-xxxx-...` from latest main, open Draft PR, then check for duplicate PRs again. A race or overlap is `BLOCKED`, never a silent override.
3. Read one task card/one micro-unit and exact code/tests. Implement only that scope with characterization, parity, permissions, visibility and side effects. Update only `work-items/MIG-XXXX.md` and the **owned** file/UX/FN rows. Continue the same Draft PR across wakes. Don't update shared `STATUS.md` during normal implementation checkpoints.
4. Run `npm run check:migration-work-items`, `npm run check:project-docs`, scoped tests, typecheck/build and required CI. Save actual command/results, source SHA, PR, rollback and next micro-unit in the work-item. On failure: repair within scope; otherwise record `BLOCKED` with reproducible failure and safe recovery. Never claim success from skipped tests.
5. When every unit passes: mark `REVIEW` on the work-item and request an **independent reviewer**. Only after required CI, review, human/Lead approvals (where applicable), sync with latest main, reconcile affected `STATUS.md` task DONE/next READY and shared rows, and squash merge. On reviewer/permissions/CI waits, leave PR at REVIEW and **stop**; never auto-merge without the required gate.
6. On the next externally triggered wake, reload merged main and repeat. One wake = at most one MIG/micro-unit; never run another MIG in the same wake merely because capacity remains.

**Unattended limits:** The Markdown and CLI do not create a timer, cloud job or daemon. A supported host's actual `/loop` / scheduled invocation or external runner must provide future wakes and credentials. Autonomous code/PR progress is allowed; Phase Gates, production DNS/Route, Remote D1, Auth/permission policy changes, destructive schema work, secrets and other explicitly gated operations **still require real human approval**. No browser automation or fake CI/review evidence. Source of truth for all policy is [AGENT_PROTOCOL.md](AGENT_PROTOCOL.md), [GIT_WORKFLOW.md](GIT_WORKFLOW.md) and [work-items/README.md](work-items/README.md).

## Quick context packet (do not paste whole Markdown set)

```bash
npm run migration:next
# or choose a concrete MIG explicitly:
node scripts/print-migration-task-context.mjs MIG-0401
```

The output contains **one task, its dependency states, matching decisions, one work card and assigned source-file paths**. It does not execute a task, omit permissions, or replace reading current code/test. For large MIGs select one unit from [TASK_MICRO_UNITS.md](TASK_MICRO_UNITS.md). CI tests the packet size and the MIG-0401 READY state.

## 1. Choose exactly one task, not one whole phase

Read the top "Overall" and **your MIG row + dependency rows** in [STATUS.md](STATUS.md), the relevant D-xx row in [OPEN_DECISIONS.md](OPEN_DECISIONS.md) and the **one** `### MIG-XXXX` section in the matching TASK_CARDS document. If owner PR exists, resume that branch; do not fork a second writer. Use [IMPLEMENTATION_RUNBOOK.md](IMPLEMENTATION_RUNBOOK.md) "最初の90秒" and "一件を進める厳密な手順" on a fresh wake.

Phase 4 performance path **MIG-0401→0404→0405→0406** is a valid **separate track** from MIG-0301 domain work. D-08 HTML is registered; **MIG-0402/0403 and Phase 5 real UI** still require their STATUS dependencies, including Phase 2 Gate and MIG-0401. Registration alone does not unlock them. Phase 4 Gate MIG-0407 requires performance **AND** visual tests. Read [PERFORMANCE_IMPLEMENTATION_PLAN.md](PERFORMANCE_IMPLEMENTATION_PLAN.md) for CPU/Gateway work.

## 2. Load only files your task changes

Read **owned rows only** in [FILE_MIGRATION_MATRIX.md](FILE_MIGRATION_MATRIX.md) and relevant sections of [FILE_PROGRESS_PROTOCOL.md](FILE_PROGRESS_PROTOCOL.md). Then read actual source/tests, exports/importers, task-specific **UX/FN/RH/SA identifiers**, and the one subsystem baseline that governs their behavior.

| Task | Read on demand (one relevant section/row, not whole directory) |
| --- | --- |
| Public CPU/R2/Gateway | [PERF_HOTPATH_MATRIX.md](PERF_HOTPATH_MATRIX.md) → [cloudflare/PERFORMANCE_BASELINE.md](cloudflare/PERFORMANCE_BASELINE.md) → [static-delivery/README.md](static-delivery/README.md) |
| Public visual route | [CURRENT_ROUTES.md](CURRENT_ROUTES.md) → relevant [screen-mapping/README.md](screen-mapping/README.md) and [frontend/PUBLIC.md](frontend/PUBLIC.md) rows → approved [UI_REFERENCE.md](UI_REFERENCE.md) |
| API/Server Action | [route-handlers/README.md](route-handlers/README.md) or [server-actions/README.md](server-actions/README.md) → exact files and tests |
| Domain/DB/Auth/Queue | relevant [FUNCTION_INVENTORY.md](FUNCTION_INVENTORY.md), [auth/README.md](auth/README.md), [background-jobs/README.md](background-jobs/README.md) sections; actual DB/code first |
| Browser/Worker production routing | [ROUTING_AND_DEPLOY_PLAN.md](ROUTING_AND_DEPLOY_PLAN.md), [cloudflare/TOPOLOGY.md](cloudflare/TOPOLOGY.md); explicit approval required |

Do **not** paste all 432 UX / 136 FN / 110 SA / 90 page rows, all MIG cards, full [README.md](README.md) architecture and [DOC_MAP.md](DOC_MAP.md) into each iteration. Large ledgers like [FEATURE_CATALOG.md](FEATURE_CATALOG.md) (73KB) are human-readable derived views, and `gap-scan/` files are CI evidence anchors; do not load them wholesale into LLM context. Use `rg -n 'MIG-0401|UX-...' docs/migration`, `sed -n 'START,ENDp' file`, or tool-supported line/section retrieval. [DOC_MAP.md](DOC_MAP.md) is a search index, not mandatory every time.

## 3. Completion contract

Claim one PR, update touched source+target file rows and caller/HTTP/DTO/permission links, run specific tests and full required CI, capture **real** PR/SHA/CPU/URL/rollback evidence. Without parity tests, retain NOT_STARTED/IN_PROGRESS. Without separate reviewer/approval, do not claim DONE or execute production Route, D1, Auth, Secrets or traffic changes.

Full legal/workflow rules: [GIT_WORKFLOW.md](GIT_WORKFLOW.md); quality standards: [CODE_QUALITY.md](CODE_QUALITY.md); requirement conflicts: [PRODUCT_REQUIREMENTS.md](PRODUCT_REQUIREMENTS.md). Refer to [DOC_CONTEXT_AUDIT.md](DOC_CONTEXT_AUDIT.md) for size and read-budget review.
