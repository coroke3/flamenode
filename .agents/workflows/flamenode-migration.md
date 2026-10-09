---
description: Execute exactly one tracked FlameNode migration task using the shared migration protocol.
---

# /flamenode-migration

Antigravity adapter only. Do not invent a separate migration process.

1. Read `AGENTS.md`.
2. Read `docs/migration/AGENT_PROTOCOL.md` and follow it as the canonical execution contract.
2a. Read `docs/migration/IMPLEMENTATION_RUNBOOK.md`, exactly one matching `docs/migration/TASK_CARDS_*.md` card, and `docs/migration/OPEN_DECISIONS.md`.
3. Read `docs/migration/STATUS.md`, `GIT_WORKFLOW.md`, `FEATURE_CATALOG.md`, `PRODUCT_REQUIREMENTS.md`, and `CODE_QUALITY.md`.
4. Read only the route/UX/FN ledgers relevant to the selected task. Screen/UI/route work must also read `docs/migration/screen-mapping/README.md`. Server Action work must also read `docs/migration/server-actions/README.md`; Route Handler/API work must also read `docs/migration/route-handlers/README.md`; Cloudflare Worker/ingress/binding/build/job work must also read `docs/migration/cloudflare/TOPOLOGY.md`; CPU/1102/request/PoC performance work must also read `docs/migration/cloudflare/PERFORMANCE_BASELINE.md`; static artifact/alias/visibility/fallback/repair work must also read `docs/migration/static-delivery/README.md`; auth/session/linking/terms/Active X/permission/owner work must also read `docs/migration/auth/README.md`; Queue/Cron/background job/retry/DLQ/recovery work must also read `docs/migration/background-jobs/README.md`.
5. If visual UI work is involved, read `UI_REFERENCE.md`; stop visual implementation while it is `PENDING_HTML`.
6. Execute exactly one dependency-ready MIG task.
7. Use the required short-lived migration branch/PR; never push directly to main.
8. Record owner as `antigravity` while writing.
9. Preserve all affected `UX-*` and `FN-*` contracts unless an explicit approved removal exists. `FEATURE_CATALOG.md` にないCURRENT機能を見つけた場合は実装前に台帳へ追加する。
10. Backend changes must include optimization and code-quality review; line-count reduction is not a goal.
11. Finish as `DONE`, `REVIEW`, or `BLOCKED`, update `STATUS.md` and affected ledgers/matrices, and persist validation/rollback evidence.

Never automatically cross a Phase Gate or perform production deploy, Worker Route, Custom Domain, Remote D1, or secret changes without explicit approval.