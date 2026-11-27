---
name: flamenode-migration
description: Execute one FlameNode migration task with strict UX/FN parity, Git, quality, requirement-reconciliation, and progress guards.
---

# FlameNode Migration — Antigravity Skill

This is a thin reusable adapter. Canonical execution contract:

`docs/migration/AGENT_PROTOCOL.md`

Mandatory concepts:

- `STATUS.md` = merged task/dependency checkpoint; open PR `work-items/MIG-XXXX.md` = live work/owner state
- `FEATURE_CATALOG.md` = 432 UX / 136 FN の人間向け全機能索引
- `GIT_WORKFLOW.md` = branch/PR/merge source of truth
- `CURRENT_ROUTES.md` = CURRENT user-visible routes
- `screen-mapping/README.md` = CURRENT 90 page routes (74 visual) + cross-route shells → UX/FN/permission/state/query/RA mapping
- `FRONTEND_FEATURES.md` + `frontend/*.md` = granular `UX-*` behavior
- `FUNCTION_INVENTORY.md` + `functions/*.md` = `FN-*` backend contracts
- `server-actions/README.md` = CURRENT Server Action / inline action execution-unit evidence
- `route-handlers/README.md` = CURRENT Route Handler / API method-level evidence
- `cloudflare/TOPOLOGY.md` = CURRENT Cloudflare four-Worker / ingress / binding / build-deploy evidence
- `cloudflare/PERFORMANCE_BASELINE.md` = CURRENT measured CPU / 1102 / request evidence + representative TARGET budgets
- `static-delivery/README.md` = CURRENT static artifact / alias / visibility fence / fallback / repair evidence
- `auth/README.md` = CURRENT Auth.js / session / identity / Active X / permission / owner evidence
- `background-jobs/README.md` = CURRENT Queue / Cron / D1 work-state / retry / DLQ / recovery / async-state evidence
- `PRODUCT_REQUIREMENTS.md` = existing-design/current reconciliation
- `BACKEND_OPTIMIZATION.md` = optimization/blocker decisions
- `CODE_QUALITY.md` = professional implementation standard
- `UI_REFERENCE.md` = registered HTML visual source (`docs/migration/mock/`, MIG-0200 DONE, D-08 DECIDED); visual work follows the STATUS dependency chain (MIG-0201 → 0202..0206 → MIG-0402; Phase 5 visual routes wait for MIG-0407); stop visual redesign only if it reverts to `PENDING_HTML`

毎回まず `docs/migration/FEATURE_CATALOG.md` で対象機能と隣接機能を確認する。

Follow AGENT_PROTOCOL's Wake decision: resume your own PR, perform one eligible independent review, claim at most one unowned dependency-ready MIG / bounded micro-unit, or stop. One writer only. While your PR waits in REVIEW, continue other dependency-independent work (one IN_PROGRESS PR per agent; REVIEW PRs may accumulate). Reviewer model eligibility, including the session-scoped exception only when the user explicitly accepts the current model as the required higher tier, follows `AGENT_PROTOCOL.md` §Independent review evidence; builder/reviewer independence and fresh-context subagent review remain mandatory. Use the task branch/PR required by `GIT_WORKFLOW.md`.

Do not remove or change user-visible behavior merely to simplify the backend. Do not optimize for line count. Prefer explicit, readable, framework-neutral domain code and well-defined permission/transaction/side-effect boundaries.

Checkpoint policy: WORK_ITEM_ONLY. Writer wakes checkpoint only their own task-specific work-item, affected ledgers/matrices and real validation evidence. Review-only wakes leave evidence in the reviewed PR without branch/checkpoint edits; wait/no-action wakes report the gate without a checkpoint-only push. Keep STATUS unchanged during implementation; reconcile it just before merge after independent review/CI.

Non-production Phase Gates require independent Lead review and the prescribed acceptance evidence under the 2026-11-27 owner policy. Production cutover, manual production deploy, Worker Route, Custom Domain/DNS, Remote D1/data migration, secrets, and product/permission/visibility semantic changes still require separate explicit user approval.

- In a GitHub environment without authenticated `gh`, use the connected GitHub MCP to list **all** open PRs and compare their owned files/domain before passing verified branch names through `--open-pr-branches`. Never claim from `--offline`. Under the 2026-11-27 owner policy, an eligible agent records `Merge requested:` and squash-merges with the expected final HEAD after independent APPROVE, required CI, all units/acceptance/dependencies, latest-main integration and rollback pass, without per-PR human approval; high-risk code also requires independent Lead review. Follow `AGENT_PROTOCOL.md` and `IMPLEMENTATION_RUNBOOK.md` for the final-head gates. A scheduler/loop requires a real host trigger.
