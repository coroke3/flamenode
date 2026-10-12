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
5. If visual UI work is involved, read `UI_REFERENCE.md` (HTML mock registered in `docs/migration/mock/`, MIG-0200 DONE, D-08 DECIDED) and obey the STATUS dependency chain (MIG-0201 → 0202..0206 → MIG-0402; Phase 5 visual routes wait for MIG-0407). Public screens (Phase 4/5) match the mock; private/manage/admin SPA (Phase 7) reuses `packages/ui` and treats the mock as reference. Stop visual implementation only if `UI_REFERENCE.md` reverts to `PENDING_HTML`.
6. Follow AGENT_PROTOCOL's Wake decision: resume your own PR, perform one eligible independent review, claim at most one unowned dependency-ready MIG / bounded micro-unit, or stop.
7. Use the required short-lived migration branch/PR; never push directly to main.
8. Record owner as `antigravity` in `docs/migration/work-items/MIG-XXXX.md` on the PR branch while writing (not in `STATUS.md`).
9. Preserve all affected `UX-*` and `FN-*` contracts unless an explicit approved removal exists. `FEATURE_CATALOG.md` にないCURRENT機能を見つけた場合は実装前に台帳へ追加する。
10. Backend changes must include optimization and code-quality review; line-count reduction is not a goal.
11. Checkpoint policy: WORK_ITEM_ONLY. Writer wakes save `IN_PROGRESS` while units remain, `REVIEW` after all units pass, or `BLOCKED` with recovery conditions in their own `work-items/MIG-XXXX.md`. Persist actual validation/rollback evidence and affected ledgers/matrices. Review-only wakes leave evidence in the reviewed PR without branch/checkpoint edits; wait/no-action wakes report the gate without a checkpoint-only push. `STATUS.md` is reconciled only at pre-merge integration (after independent review/CI).

Never automatically cross a Phase Gate or perform production deploy, Worker Route, Custom Domain, Remote D1, or secret changes without explicit approval.

Open PR live state: `docs/migration/work-items/MIG-XXXX.md` is updated by its owner on writer wakes. `STATUS.md` is the merged task/dependency summary and is updated only at merge integration. See `GIT_WORKFLOW.md`.
