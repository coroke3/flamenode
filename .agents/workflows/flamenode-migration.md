---
description: Execute exactly one tracked FlameNode migration task using the shared migration protocol.
---

# /flamenode-migration

Antigravity adapter only. Do not invent a separate migration process.

1. Read `AGENTS.md`.
2. Read `docs/migration/AGENT_PROTOCOL.md` and follow it as the canonical execution contract.
3. Read `docs/migration/STATUS.md`, `GIT_WORKFLOW.md`, `PRODUCT_REQUIREMENTS.md`, and `CODE_QUALITY.md`.
4. Read only the route/UX/FN ledgers relevant to the selected task.
5. If visual UI work is involved, read `UI_REFERENCE.md`; stop visual implementation while it is `PENDING_HTML`.
6. Execute exactly one dependency-ready MIG task.
7. Use the required short-lived migration branch/PR; never push directly to main.
8. Record owner as `antigravity` while writing.
9. Preserve all affected `UX-*` and `FN-*` contracts unless an explicit approved removal exists.
10. Backend changes must include optimization and code-quality review; line-count reduction is not a goal.
11. Finish as `DONE`, `REVIEW`, or `BLOCKED`, update `STATUS.md` and affected ledgers/matrices, and persist validation/rollback evidence.

Never automatically cross a Phase Gate or perform production deploy, Worker Route, Custom Domain, Remote D1, or secret changes without explicit approval.