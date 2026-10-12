---
name: flamenode-migration
description: Continue the FlameNode Next/OpenNext migration safely. Use for platform migration, redesign migration, route/API parity work, or when asked to continue the migration loop.
---

# FlameNode Migration — Codex Adapter

This is a thin adapter. Do not duplicate or reinterpret the migration specification here.

Start with `AGENTS.md` and `docs/migration/MIGRATION_START_HERE.md`. Follow the relevant sections of `docs/migration/AGENT_PROTOCOL.md`, `GIT_WORKFLOW.md`, `IMPLEMENTATION_RUNBOOK.md`, `OPEN_DECISIONS.md`, one MIG card and CURRENT source/tests. Read only affected portions of `FEATURE_CATALOG.md`, `FUNCTION_INVENTORY.md`, route/API matrices and subsystem baselines.

One invocation processes at most one READY MIG task or one of its bounded micro-units. Re-read latest main, open migration PRs and the owning PR checkpoint before claiming. Resume the same owner PR; never create a duplicate.

Checkpoint policy: WORK_ITEM_ONLY.
Record `Owner: codex`, scope, current unit, actual tests, source SHA, rollback and next unit in the owner PR's `docs/migration/work-items/MIG-XXXX.md`. Ordinary implementation wakes do not edit `STATUS.md`.
Incomplete but healthy work remains `IN_PROGRESS` with a durable checkpoint. Mark `REVIEW` only after all units pass; record blockers and recovery conditions as `BLOCKED`. After independent review and required CI/approval, reconcile the task's DONE/next READY in `STATUS.md` against latest main immediately before squash merge.

Do not auto-cross a Phase Gate or perform production deploy, Worker Route, Custom Domain, Remote D1, or secret changes without explicit approval.

When UI redesign is involved, feature parity is mandatory: use `FUNCTION_INVENTORY.md` and do not treat visual completion as functional completion.

For repeated execution, persist the checkpoint before returning. This skill creates no scheduler; the next external wake re-reads the merged state. Missing independent review or approval is a stop, not permission to auto-merge.
