---
name: flamenode-migration
description: Continue the FlameNode Next/OpenNext migration one tracked MIG task (or one micro-unit) per invocation, preserving existing functionality and Cloudflare safety invariants. Use for /flamenode-migration and /loop /flamenode-migration.
---

# FlameNode Migration — Claude Adapter

Thin adapter. The shared execution contract is `docs/migration/AGENT_PROTOCOL.md`; do not duplicate or reinterpret it here.

## Read (targeted sections, not whole ledgers)

1. `AGENTS.md`
2. `docs/migration/MIGRATION_START_HERE.md`, then `npm run migration:next` (advisory only; PR branch hints do not verify live owners, checkpoints, reviews or CI)
3. `docs/migration/AGENT_PROTOCOL.md` — Per-wake read contract, `/loop` contract, Mandatory stop
4. `docs/migration/GIT_WORKFLOW.md` (current stage) and `docs/migration/work-items/README.md`
5. `docs/migration/STATUS.md` — only the chosen MIG row and its dependency rows
6. `docs/migration/OPEN_DECISIONS.md` — only the D-xx tied to the task
7. `docs/migration/IMPLEMENTATION_RUNBOOK.md` and exactly one matching `docs/migration/TASK_CARDS_*.md` card
8. `docs/migration/FEATURE_CATALOG.md` / `FUNCTION_INVENTORY.md` / `ROUTE_MATRIX.md` / `API_MATRIX.md` — only the affected UX/FN rows
9. Subsystem baseline only when touched: `screen-mapping/README.md` (screen/UI/route), `cloudflare/TOPOLOGY.md` (Worker/ingress/binding/build/job), `cloudflare/PERFORMANCE_BASELINE.md` (CPU/1102), `auth/README.md` (auth/session/permission/owner/Active X), `background-jobs/README.md` (Queue/Cron/retry/DLQ), `static-delivery/README.md` (static artifact/visibility), `UI_REFERENCE.md` (visual work)
10. CURRENT code and tests of the owned files

## Execute

Checkpoint policy: WORK_ITEM_ONLY

- Follow the Wake decision in `AGENT_PROTOCOL.md` § `/loop`: check open PRs (`gh pr list --state open --json number,headRefName,title,isDraft`) and their branch work-items first. Own (`Owner: claude`) PR → resume / merge-integrate it; another agent's PR in `REVIEW` without review of its current Head → act as independent reviewer (PR comment only, no branch edits, no merge); otherwise claim one READY task that no open PR owns.
- Exactly one action per invocation (one micro-unit of one MIG task, one merge integration, one review, or no action). On writer wakes, record `Owner: claude`, branch, PR, owned paths and current unit in your own `docs/migration/work-items/MIG-XXXX.md`. Do not edit `STATUS.md` until pre-merge integration.
- Writer wakes persist a bounded checkpoint (real commands/results, Head SHA, next unit) before returning. Review-only wakes leave evidence in the reviewed PR without branch/checkpoint edits; wait/no-action wakes report the gate without a checkpoint-only push.
- Independent review: another agent (Codex / Antigravity) or a human; or, when this session runs on a model below Opus, spawn `flamenode-architecture-reviewer` with `model: "opus"` in a fresh context, pass it the PR diff, Work Order and affected contracts, and record its verdict as a PR comment in the protocol format. A same-or-lower-model subagent does not count. APPROVE + green CI on the reviewed Head (+ user approval for high-risk / Phase Gate) → merge-integrate. Otherwise leave the PR in `REVIEW` and continue other dependency-independent work.
- Never auto-cross a Phase Gate or perform production deploy, Worker Route / Custom Domain, Remote D1 or secret changes without explicit user approval.
- UI redesign: visual completion is not functional completion; verify the affected function IDs in `FUNCTION_INVENTORY.md`.

Report in the CLAUDE.md migration output format.
