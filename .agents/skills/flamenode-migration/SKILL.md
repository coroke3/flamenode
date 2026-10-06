---
name: flamenode-migration
description: Execute one FlameNode migration task with strict UX/FN parity, Git, quality, requirement-reconciliation, and progress guards.
---

# FlameNode Migration — Antigravity Skill

This is a thin reusable adapter. Canonical execution contract:

`docs/migration/AGENT_PROTOCOL.md`

Mandatory concepts:

- `STATUS.md` = progress source of truth
- `GIT_WORKFLOW.md` = branch/PR/merge source of truth
- `CURRENT_ROUTES.md` = CURRENT user-visible routes
- `FRONTEND_FEATURES.md` + `frontend/*.md` = granular `UX-*` behavior
- `FUNCTION_INVENTORY.md` + `functions/*.md` = `FN-*` backend contracts
- `server-actions/README.md` = CURRENT Server Action / inline action execution-unit evidence
- `route-handlers/README.md` = CURRENT Route Handler / API method-level evidence
- `cloudflare/TOPOLOGY.md` = CURRENT Cloudflare four-Worker / ingress / binding / build-deploy evidence
- `cloudflare/PERFORMANCE_BASELINE.md` = CURRENT measured CPU / 1102 / request evidence + representative TARGET budgets
- `PRODUCT_REQUIREMENTS.md` = existing-design/current reconciliation
- `BACKEND_OPTIMIZATION.md` = optimization/blocker decisions
- `CODE_QUALITY.md` = professional implementation standard
- `UI_REFERENCE.md` = future HTML visual source; stop visual redesign while `PENDING_HTML`

Execute exactly one READY MIG task. One writer only. Use the task branch/PR required by `GIT_WORKFLOW.md`.

Do not remove or change user-visible behavior merely to simplify the backend. Do not optimize for line count. Prefer explicit, readable, framework-neutral domain code and well-defined permission/transaction/side-effect boundaries.

Finish by persisting `DONE`, `REVIEW`, or `BLOCKED`, updating affected ledgers/matrices, validation evidence, and rollback information.

Never auto-cross Phase Gates or perform production deploy, Worker Route, Custom Domain, Remote D1, or secret changes without explicit approval.