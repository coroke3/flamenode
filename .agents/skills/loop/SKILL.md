---
name: loop
description: Execute exactly one persisted FlameNode migration cycle; requires an external wake for the next cycle.
---

# Antigravity migration loop

Checkpoint policy: WORK_ITEM_ONLY

This skill does **not** create a background timer. Re-invoke through a supported host mechanism or manually.

Use `.agents/skills/flamenode-migration/SKILL.md` and obey `docs/migration/AGENT_PROTOCOL.md` § `/loop` / continuous execution (Wake decision, Independent review evidence, Pacing). 1 wake = at most one action: one micro-unit of an owned MIG task, one merge integration, one independent review of another agent's PR, or nothing.

Writer wakes checkpoint only their own `work-items/MIG-XXXX.md`; never edit STATUS until merge integration. Review-only wakes leave evidence in the reviewed PR without branch/checkpoint edits; wait/no-action wakes report the gate without a checkpoint-only push. Never advance another task in the same turn; report and stop.
