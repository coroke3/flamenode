---
name: loop
description: Run repeated persisted FlameNode migration cycles for long-horizon work.
---

# FlameNode migration loop — Codex compatibility

This is a procedural compatibility skill, not a claim that Codex implements Claude Code's timer `/loop`.
Prefer Codex `/goal` for autonomous long-horizon execution.

Use together with `.codex/skills/flamenode-migration/SKILL.md` and follow `docs/migration/AGENT_PROTOCOL.md`.

For every cycle:

1. re-read `docs/migration/STATUS.md`
2. execute exactly one `READY` MIG task whose dependencies are satisfied
3. persist STATUS and affected ledgers/matrices
4. stop at Phase Gates, blockers, ownership conflicts, or approval-required production actions

Repository state is authoritative; conversation state is not.
