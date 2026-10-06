---
description: Continue the FlameNode platform/UI migration by executing exactly one tracked READY task.
---

When the user runs `/flamenode-migration`, execute the shared FlameNode migration protocol.

Read, in order:

1. `AGENTS.md`
2. `docs/migration/AGENT_PROTOCOL.md`
3. `docs/migration/README.md`
4. `docs/migration/STATUS.md`
5. `docs/migration/FUNCTION_INVENTORY.md`
6. the relevant function ledger and route/API matrix
7. target code and tests

Execute exactly one READY MIG task.

At start:
- claim the task as `IN_PROGRESS`
- record `Owner: antigravity`

At finish:
- transition the task to `DONE`, `REVIEW`, or `BLOCKED`
- update `STATUS.md`
- update affected function ledger / route matrix / API matrix
- persist validation and rollback evidence

Do not automatically cross a Phase Gate.
Do not perform production deploy, Worker Route, Custom Domain, Remote D1, or secret changes without explicit approval.
For redesign tasks, visual completion is not enough: preserve and verify every associated required function.
