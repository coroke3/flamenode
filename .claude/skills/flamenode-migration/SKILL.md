---
name: flamenode-migration
description: Continue the FlameNode platform and UI migration one tracked task at a time, preserving existing functionality and Cloudflare safety invariants.
---

# FlameNode Migration — Claude Skill Adapter

Use the shared protocol; do not duplicate migration rules here.

Read:

1. `AGENTS.md`
2. `docs/migration/AGENT_PROTOCOL.md`
3. `docs/migration/README.md`
4. `docs/migration/STATUS.md` (merged task graph) + live owner PR's `docs/migration/work-items/MIG-XXXX.md`
5. `docs/migration/FEATURE_CATALOG.md`
6. `docs/migration/FUNCTION_INVENTORY.md`
7. relevant matrix/code/tests

Execute exactly one READY MIG task, record `Owner: claude` and scope in the task-specific work-item on the owner PR branch, validate it, and persist a bounded checkpoint before returning. Only update STATUS at pre-merge integration.

Do not auto-cross Phase Gates or perform production Cloudflare/Remote D1/secret changes without explicit approval.
