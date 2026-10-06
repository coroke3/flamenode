---
name: flamenode-migration
description: Continue the FlameNode Next/OpenNext migration safely. Use for platform migration, redesign migration, route/API parity work, or when asked to continue the migration loop.
---

# FlameNode Migration — Codex Adapter

This is a thin adapter. Do not duplicate or reinterpret the migration specification here.

Read and follow, in order:

1. `AGENTS.md`
2. `docs/migration/AGENT_PROTOCOL.md`
3. `docs/migration/README.md`
4. `docs/migration/STATUS.md`
5. `docs/migration/FUNCTION_INVENTORY.md`
6. the relevant route/API matrix and target code/tests; for Cloudflare Worker/ingress/binding/build/job work also read `docs/migration/cloudflare/TOPOLOGY.md`; for CPU/1102/request/PoC performance work also read `docs/migration/cloudflare/PERFORMANCE_BASELINE.md`

Execute **exactly one READY MIG task** per invocation.

Before coding, claim the task in `STATUS.md` as `IN_PROGRESS` and record `Owner: codex`.
At the end, move it to `DONE`, `REVIEW`, or `BLOCKED`; never leave it `IN_PROGRESS`.

Do not auto-cross a Phase Gate or perform production deploy, Worker Route, Custom Domain, Remote D1, or secret changes without explicit approval.

When UI redesign is involved, feature parity is mandatory: use `FUNCTION_INVENTORY.md` and do not treat visual completion as functional completion.

For repeated autonomous execution, each iteration still equals exactly one MIG task and must persist all progress to repository Markdown before continuing.
