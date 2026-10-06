---
name: loop
description: Repeatedly advance the FlameNode migration through small persisted MIG-task cycles. Use with flamenode-migration when the user asks to keep going or run a loop.
---

# FlameNode migration loop

This is a progress loop, not a timer.

Repeat the `flamenode-migration` workflow one MIG task at a time.
Before every cycle, re-read `docs/migration/STATUS.md`; do not rely on conversational memory.

Each cycle must:

1. select exactly one `READY` task whose dependencies are satisfied
2. claim it as `IN_PROGRESS` with `Owner: antigravity`
3. execute and validate only that task
4. persist `STATUS.md` and affected ledgers/matrices
5. finish as `DONE`, `REVIEW`, or `BLOCKED`
6. stop or continue according to `docs/migration/AGENT_PROTOCOL.md`

Never bypass a Phase Gate, blocker, ownership conflict, or approval-required production action just to keep the loop moving.
