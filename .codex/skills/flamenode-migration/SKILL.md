---
name: flamenode-migration
description: Continue the FlameNode Next/OpenNext migration safely. Use for platform migration, redesign migration, route/API parity work, or when asked to continue the migration loop.
---

# FlameNode Migration — Codex Adapter

This is a thin adapter. Do not duplicate or reinterpret the migration specification here.

Read and follow, in order:

1. `AGENTS.md`
2. `docs/migration/AGENT_PROTOCOL.md`
2a. `docs/migration/IMPLEMENTATION_RUNBOOK.md` and one current `docs/migration/TASK_CARDS_*.md` card
2b. `docs/migration/OPEN_DECISIONS.md`
2c. `docs/migration/MIGRATION_START_HERE.md`; run `npm run migration:next` for an advisory next-task suggestion (STATUS.md remains the authority; it does not see open PRs)
2d. `docs/migration/GIT_WORKFLOW.md`
3. `docs/migration/README.md` (relevant sections only)
4. `docs/migration/STATUS.md` (selected task and dependency rows only)
5. `docs/migration/FEATURE_CATALOG.md` (relevant rows only)
6. `docs/migration/FUNCTION_INVENTORY.md` (relevant rows only)
7. the relevant route/API matrix and target code/tests; for screen/UI/route work also read `docs/migration/screen-mapping/README.md`; for Cloudflare Worker/ingress/binding/build/job work also read `docs/migration/cloudflare/TOPOLOGY.md`; for CPU/1102/request/PoC performance work also read `docs/migration/cloudflare/PERFORMANCE_BASELINE.md`; for auth/session/linking/terms/Active X/permission/owner work also read `docs/migration/auth/README.md`; for Queue/Cron/background job/retry/DLQ/recovery work also read `docs/migration/background-jobs/README.md`; for static artifact/alias/visibility/fallback/repair work also read `docs/migration/static-delivery/README.md`

Execute **exactly one READY MIG task** per invocation.

Before coding, record `Owner: codex` and task scope in `docs/migration/work-items/MIG-XXXX.md` on the task branch/PR. Keep `STATUS.md` unchanged during implementation.
At each wake, persist bounded checkpoint progress in `docs/migration/work-items/MIG-XXXX.md`. `STATUS.md` is updated only at pre-merge integration. See `GIT_WORKFLOW.md`.

Do not auto-cross a Phase Gate or perform production deploy, Worker Route, Custom Domain, Remote D1, or secret changes without explicit approval.

When UI redesign is involved, feature parity is mandatory: use `FUNCTION_INVENTORY.md` and do not treat visual completion as functional completion.

For repeated autonomous execution, each iteration still equals exactly one MIG task and must persist all progress to repository Markdown before continuing.
