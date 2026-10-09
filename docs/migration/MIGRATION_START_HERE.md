# Migration: minimal agent entrypoint

> **Read this before /flamenode-migration, /loop, Codex, Claude or Antigravity.** Rules in root [AGENTS.md](../../AGENTS.md) and [AGENT_PROTOCOL.md](AGENT_PROTOCOL.md) still apply. This page is an index, **not** a second execution policy or progress ledger.

## Quick context packet (do not paste whole Markdown set)

```bash
node scripts/print-migration-task-context.mjs MIG-0401
```

The output contains **one task, its dependency states, matching decisions, one work card and assigned source-file paths**. It does not execute a task, omit permissions, or replace reading current code/test. For large MIGs select one unit from [TASK_MICRO_UNITS.md](TASK_MICRO_UNITS.md). CI tests the packet size and the MIG-0401 READY state.

## 1. Choose exactly one task, not one whole phase

Read the top "Overall" and **your MIG row + dependency rows** in [STATUS.md](STATUS.md), the relevant D-xx row in [OPEN_DECISIONS.md](OPEN_DECISIONS.md) and the **one** `### MIG-XXXX` section in the matching TASK_CARDS document. If owner PR exists, resume that branch; do not fork a second writer. Use [IMPLEMENTATION_RUNBOOK.md](IMPLEMENTATION_RUNBOOK.md) "最初の90秒" and "一件を進める厳密な手順" on a fresh wake.

Phase 4 performance path **MIG-0401→0404→0405→0406** is a valid **separate track** from MIG-0301 domain work, with dependencies tracked only in STATUS. **MIG-0402/0403 and Phase 5 real UI** remain blocked by missing D-08 HTML; Phase 4 Gate MIG-0407 requires performance **AND** visual tests. Read [PERFORMANCE_IMPLEMENTATION_PLAN.md](PERFORMANCE_IMPLEMENTATION_PLAN.md) for CPU/Gateway work.

## 2. Load only files your task changes

Read **owned rows only** in [FILE_MIGRATION_MATRIX.md](FILE_MIGRATION_MATRIX.md) and relevant sections of [FILE_PROGRESS_PROTOCOL.md](FILE_PROGRESS_PROTOCOL.md). Then read actual source/tests, exports/importers, task-specific **UX/FN/RH/SA identifiers**, and the one subsystem baseline that governs their behavior.

| Task | Read on demand (one relevant section/row, not whole directory) |
| --- | --- |
| Public CPU/R2/Gateway | [PERF_HOTPATH_MATRIX.md](PERF_HOTPATH_MATRIX.md) → [cloudflare/PERFORMANCE_BASELINE.md](cloudflare/PERFORMANCE_BASELINE.md) → [static-delivery/README.md](static-delivery/README.md) |
| Public visual route | [CURRENT_ROUTES.md](CURRENT_ROUTES.md) → relevant [screen-mapping/README.md](screen-mapping/README.md) and [frontend/PUBLIC.md](frontend/PUBLIC.md) rows → approved [UI_REFERENCE.md](UI_REFERENCE.md) |
| API/Server Action | [route-handlers/README.md](route-handlers/README.md) or [server-actions/README.md](server-actions/README.md) → exact files and tests |
| Domain/DB/Auth/Queue | relevant [FUNCTION_INVENTORY.md](FUNCTION_INVENTORY.md), [auth/README.md](auth/README.md), [background-jobs/README.md](background-jobs/README.md) sections; actual DB/code first |
| Browser/Worker production routing | [ROUTING_AND_DEPLOY_PLAN.md](ROUTING_AND_DEPLOY_PLAN.md), [cloudflare/TOPOLOGY.md](cloudflare/TOPOLOGY.md); explicit approval required |

Do **not** paste all 432 UX / 136 FN / 110 SA / 90 page rows, all MIG cards, full [README.md](README.md) architecture and [DOC_MAP.md](DOC_MAP.md) into each iteration. Use `rg -n 'MIG-0401|UX-...' docs/migration`, `sed -n 'START,ENDp' file`, or tool-supported line/section retrieval. [DOC_MAP.md](DOC_MAP.md) is a search index, not mandatory every time.

## 3. Completion contract

Claim one PR, update touched source+target file rows and caller/HTTP/DTO/permission links, run specific tests and full required CI, capture **real** PR/SHA/CPU/URL/rollback evidence. Without parity tests, retain NOT_STARTED/IN_PROGRESS. Without separate reviewer/approval, do not claim DONE or execute production Route, D1, Auth, Secrets or traffic changes.

Full legal/workflow rules: [GIT_WORKFLOW.md](GIT_WORKFLOW.md); quality standards: [CODE_QUALITY.md](CODE_QUALITY.md); requirement conflicts: [PRODUCT_REQUIREMENTS.md](PRODUCT_REQUIREMENTS.md). Refer to [DOC_CONTEXT_AUDIT.md](DOC_CONTEXT_AUDIT.md) for size and read-budget review.
