---
name: loop
description: Repeatedly advance the FlameNode migration through small persisted work-item cycles. Use with flamenode-migration when the user asks to keep going, loop, or run /loop in Antigravity.
---

# Migration loop

This is a progress loop, not a timer.

Repeat the `flamenode-migration` skill one work-item cycle at a time. After every cycle, require a committed or working-tree update to `docs/migration/PROGRESS.md` containing evidence and the next state. Re-read the ledger before the next cycle rather than relying on conversational memory.

Stop on any condition in `docs/migration/AGENT_PROTOCOL.md`, when the current phase exit condition is met, or when no `ready` item remains. Never bypass approval requirements to keep the loop moving.
