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
3. execute and validate only that task (including lockfile integrity and `check-migration-docs.mjs`)
4. persist `STATUS.md` and affected ledgers/matrices
5. finish as `DONE`, `REVIEW`, or `BLOCKED`

### Mandatory Safety Guards (Strictly Enforced)

- **One Task per Interaction Turn**: The agent MUST NOT autonomously loop across multiple MIG tasks or Phase Gates in a single response turn. After finishing 1 task and its PR merge, the agent MUST stop and report progress to the user.
- **Never Auto-Pass Phase Gates**: Tasks marked as Phase Gates (e.g., MIG-0012, MIG-0108, MIG-0206, etc.) require explicit human / Lead approval and verification evidence. An agent MUST NOT mark a Gate as `DONE` / `PASSED` without explicit user instruction.
- **Never Bypass Broken CI / Lockfile**: If `package.json` changes, ensure `package-lock.json` is in sync and `npm ci` would succeed.
- **Stop on Ambiguity or Blocker**: Immediately halt the loop if requirements are unclear, `UI_REFERENCE.md` is `PENDING_HTML` for visual tasks, or dependencies are missing.

