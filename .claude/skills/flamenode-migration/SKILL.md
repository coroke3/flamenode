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
4. `docs/migration/STATUS.md`
5. `docs/migration/FUNCTION_INVENTORY.md`
6. relevant matrix/code/tests

Execute exactly one READY MIG task, record `Owner: claude`, validate it, and persist progress before returning.

Do not auto-cross Phase Gates or perform production Cloudflare/Remote D1/secret changes without explicit approval.
