---
name: flamenode-migration
description: Continue the FlameNode Next/OpenNext migration one tracked MIG task (or one micro-unit) per invocation, preserving existing functionality and Cloudflare safety invariants. Use for /flamenode-migration and /loop /flamenode-migration.
---

# FlameNode Migration — Claude Adapter

Thin adapter. The shared execution contract is `docs/migration/AGENT_PROTOCOL.md`; do not duplicate or reinterpret it here.

## Read (targeted sections, not whole ledgers)

1. `AGENTS.md`
2. `docs/migration/MIGRATION_START_HERE.md`; first read all live open PRs via `gh` or GitHub MCP and resume any owned PR, then use `npm run migration:next` for new-task advice (`--open-pr-branches` if `gh` is unavailable; never `--offline` to claim)
3. `docs/migration/AGENT_PROTOCOL.md` — Per-wake read contract, `/loop` contract, Mandatory stop
4. `docs/migration/GIT_WORKFLOW.md` (current stage) and `docs/migration/work-items/README.md`
5. `docs/migration/STATUS.md` — only the chosen MIG row and its dependency rows
6. `docs/migration/OPEN_DECISIONS.md` — only the D-xx tied to the task
7. `docs/migration/IMPLEMENTATION_RUNBOOK.md` and exactly one matching `docs/migration/TASK_CARDS_*.md` card
8. `docs/migration/IMPLEMENTATION_RECIPES.md` — only the Work Order's `Recipe` sections; `docs/migration/ZERO_1102.md` — its `Runtime` row (§3) and design rules (§4); `docs/migration/CODE_QUALITY.md` — 「移行で守る簡潔さ」「機能維持とブラッシュアップの線引き」 (the `migration:next` packet already includes the recipe and budget)
9. `docs/migration/FEATURE_CATALOG.md` / `FUNCTION_INVENTORY.md` / `ROUTE_MATRIX.md` / `API_MATRIX.md` — only the affected UX/FN rows
10. Subsystem baseline only when touched: `screen-mapping/README.md` (screen/UI/route), `cloudflare/TOPOLOGY.md` (Worker/ingress/binding/build/job), `cloudflare/PERFORMANCE_BASELINE.md` (CPU/1102), `auth/README.md` (auth/session/permission/owner/Active X), `background-jobs/README.md` (Queue/Cron/retry/DLQ), `static-delivery/README.md` (static artifact/visibility), `UI_REFERENCE.md` (visual work)
11. CURRENT code and tests of the owned files

## Execute

Checkpoint policy: WORK_ITEM_ONLY

- Follow the Wake decision in `AGENT_PROTOCOL.md` § `/loop`: check all open PRs (`gh pr list --state open --json number,headRefName,title,isDraft` or GitHub MCP) and their branch work-items first. Own (`Owner: claude`) PR → resume / merge-integrate it; another agent's PR in `REVIEW` without review of its current Head → act as independent reviewer (PR comment only, no branch edits, no merge); otherwise claim one READY task that no open PR owns.
- Exactly one action per invocation (one micro-unit of one MIG task, one merge integration, one review, or no action). On writer wakes, record `Owner: claude`, branch, PR, owned paths and current unit in your own `docs/migration/work-items/MIG-XXXX.md`. Do not edit `STATUS.md` until pre-merge integration.
- Writer wakes persist a bounded checkpoint (real commands/results, Head SHA, next unit) before returning. Review-only wakes leave evidence in the reviewed PR without branch/checkpoint edits; wait/no-action wakes report the gate without a checkpoint-only push.
- Independent review: another agent (Codex / Antigravity) or a human; or, when this session runs on a model below Opus, spawn `flamenode-architecture-reviewer` with `model: "opus"` in a fresh context, pass it the PR diff, Work Order and affected contracts, and record its verdict as a PR comment in the protocol format. Model-tier restrictions are subject only to the session-scoped exception in `AGENT_PROTOCOL.md` §Independent review evidence when the user explicitly accepts the current model as the required higher tier; builder/reviewer independence and fresh-context subagent review remain mandatory. Under the 2026-11-27 owner policy, final-HEAD independent APPROVE + required CI green + all units/acceptance/dependencies, latest-main integration and rollback verified → record `Merge requested:` and squash-merge with the expected HEAD, without per-PR human approval; high-risk code also requires independent Lead review. Otherwise leave the PR in `REVIEW` and continue other dependency-independent work.
- Non-production Phase Gates require independent Lead review and the prescribed acceptance evidence under the 2026-11-27 owner policy. Production cutover, manual production deploy, Worker Route, Custom Domain/DNS, Remote D1/data migration, secrets, and product/permission/visibility semantic changes still require separate explicit user approval.
- UI redesign: visual completion is not functional completion; verify the affected function IDs in `FUNCTION_INVENTORY.md`.
- Write the code in the shape of the Work Order's recipe. Do not add an abstraction with one caller, and do not port CURRENT exports that `node scripts/find-unused-exports.mjs <file>` reports as `UNUSED` / `TEST_ONLY`. Keep behavior identical to CURRENT; list behavior-changing ideas under 「ブラッシュアップ提案」 in the PR body instead of implementing them.
- Record the runtime class and measured max CPU against `ZERO_1102.md` §3 (write 「未計測」 before MIG-0606's harness exists; never estimate).

Report in the CLAUDE.md migration output format.
