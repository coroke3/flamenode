---
name: loop
description: Safely run one resumable FlameNode MIG task per external Codex invocation; never imply a background scheduler exists.
---

# Codex migration loop

This is a **procedural** loop adapter, not a timer or autonomous trigger.
Use the Codex host's supported repetition feature if available; otherwise a user/external orchestrator must invoke the skill again.

Invoke `.codex/skills/flamenode-migration/SKILL.md` and obey `docs/migration/AGENT_PROTOCOL.md` § `/loop` / continuous execution (Wake decision, Independent review evidence, Pacing). 1 invocation = at most one action: one micro-unit of an owned MIG task, one merge integration, one independent review of another agent's PR, or nothing.

Every wake updates the owner PR's `work-items/MIG-XXXX.md`; STATUS is merged-only. Without a real host repetition mechanism, end after one wake.
