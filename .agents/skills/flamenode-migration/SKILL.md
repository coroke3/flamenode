---
name: flamenode-migration
description: Continue the FlameNode platform/UI migration one safe task at a time with explicit progress tracking and feature-parity guards.
---

# FlameNode Migration — Antigravity Adapter

This is a thin adapter. The shared execution contract is `docs/migration/AGENT_PROTOCOL.md`.

Read, in order:

1. `AGENTS.md`
2. `docs/migration/AGENT_PROTOCOL.md`
3. `docs/migration/README.md`
4. `docs/migration/STATUS.md`
5. `docs/migration/FUNCTION_INVENTORY.md`
6. the relevant route/API matrix and target code/tests

Run exactly one READY MIG task.

At start:

- set the task to `IN_PROGRESS`
- record `Owner: antigravity`

At finish:

- set `DONE`, `REVIEW`, or `BLOCKED`
- update `STATUS.md`
- update affected inventory/matrix rows

Never auto-cross Phase Gates or perform production deploy, Worker Route, Custom Domain, Remote D1, or secret changes without explicit approval.

For redesign tasks, verify all associated function IDs before treating a screen as migrated.
