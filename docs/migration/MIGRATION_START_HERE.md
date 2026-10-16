# Migration: minimal agent entrypoint

> **Read this before /flamenode-migration, /loop, Codex, Claude or Antigravity.** Rules in root [AGENTS.md](../../AGENTS.md) and [AGENT_PROTOCOL.md](AGENT_PROTOCOL.md) still apply. This page is an index, **not** a second execution policy or progress ledger.

## Autonomous one-wake operation (self-driving agent)

First inspect all open PRs and any owned task checkpoint (via `gh` or GitHub MCP); resume an existing IN_PROGRESS/REVIEW/DONE-but-unmerged PR before selecting new work. For an unclaimed task, run `node scripts/print-migration-task-context.mjs --next` (or `npm run migration:next`). The selector reads the **merged** `STATUS.md` graph, filters unfinished dependencies and unresolved required decisions, drops READY tasks owned by an open `migration/mig-XXXX-*` PR when `gh` is available or verified branch names are supplied via `--open-pr-branches` (branch names alone do not prove file ownership; do not claim with `--offline`), and prioritizes the Phase 4 performance/route-map track when dependency-ready. **It is not a GitHub lock or an approval.** For an explicit user-selected task, use `node scripts/print-migration-task-context.mjs MIG-XXXX`. The packet includes the task's Work Order (`### MIG-XXXX:` section of the phase spec). **Small models (Haiku / Luna / Flash) run `npm run migration:next -- --model small`**, which offers only Work Orders marked `Model: small` + `READY_FOR_SMALL_MODEL`, then follow [IMPLEMENTATION_RUNBOOK.md](IMPLEMENTATION_RUNBOOK.md) "1 wake のコマンド手順" literally.

First apply [AGENT_PROTOCOL.md](AGENT_PROTOCOL.md) §Wake decision to choose **one** writer unit, merge integration, eligible independent review, or no action. The steps below describe the selected writer/merge stages; they do not require creating a PR on every wake. A review-only wake leaves evidence in the reviewed PR and never edits its branch/work-item/STATUS. A wait/no-action wake reports the gate without a checkpoint-only push.

1. `git fetch origin main`; read merged task/dependency rows. Query **all open migration PRs** (and branch work-item checkpoints) using `gh pr list --state open --json number,headRefName,title,isDraft` or a connected GitHub tool. Resume your own `IN_PROGRESS` PR from its next unit; evaluate recorded gates for `REVIEW`/`BLOCKED`. An existing PR is never permission to take over another owner; follow Wake decision's reviewer/claim/stop paths.
2. If unclaimed: confirm `READY`, dependencies `DONE` on main, required D-xx decisions and non-overlapping file ownership. Create `migration/mig-xxxx-...` from latest main, open Draft PR, then check for duplicate PRs again. A race or overlap is `BLOCKED`, never a silent override.
3. For a writer unit, read one task card/one micro-unit and exact code/tests. Implement only that scope with characterization, parity, permissions, visibility and side effects. Update only your own `work-items/MIG-XXXX.md` and the **owned** file/UX/FN rows. Continue the same Draft PR across wakes; healthy unfinished units remain `IN_PROGRESS`. Don't update shared `STATUS.md` during normal implementation checkpoints.
4. Run `npm run check:migration-work-items`, `npm run check:project-docs`, scoped tests, typecheck/build and required CI. Save actual command/results, source SHA, PR, rollback and next micro-unit in the work-item. On failure: repair within scope; otherwise record `BLOCKED` with reproducible failure and safe recovery. Never claim success from skipped tests.
5. When every unit passes: mark `REVIEW` on the work-item and request an **independent reviewer**. A later integration wake checks CI and review, syncs latest main and reconciles affected `STATUS.md` task DONE/next READY and shared rows. Re-run CI and independent review on the **final Head** (including STATUS-only commits). Record `Merge requested:` in the PR; **a human merges only after reviewing that PR**. On reviewer/permissions/CI waits, leave the PR at REVIEW and keep working on dependency-independent tasks (REVIEW PRs may accumulate; at most one IN_PROGRESS per agent). A fresh-context subagent on a higher-tier model than the builder counts as independent review; never auto-merge without the required gate.
6. On the next externally triggered wake, reload merged main and repeat. One wake = at most one MIG/micro-unit; never run another MIG in the same wake merely because capacity remains.

**Unattended limits:** The Markdown and CLI do not create a timer, cloud job or daemon. A supported host's actual `/loop` / scheduled invocation or external runner must provide future wakes and credentials. Autonomous code/PR progress is allowed; Phase Gates, production DNS/Route, Remote D1, Auth/permission policy changes, destructive schema work, secrets and other explicitly gated operations **still require real human approval**. No browser automation or fake CI/review evidence. Source of truth for all policy is [AGENT_PROTOCOL.md](AGENT_PROTOCOL.md), [GIT_WORKFLOW.md](GIT_WORKFLOW.md) and [work-items/README.md](work-items/README.md).

## Start-ready lanes after #301 (2026-10-16)

As of main including #283/#298/#300/#301, the initial READY tasks are **MIG-0301** (domain; `Model: small` / `READY_FOR_SMALL_MODEL`, lead + Haiku trial), **MIG-0201** (design tokens; lead) and **MIG-0404** (route-map; lead). Read current `STATUS.md` and live PR ownership every wake; this dated checkpoint never replaces the state ledger. MIG-0401 is DONE and must not be claimed again.

**実際の移行開始条件:** taskを選んだだけでは未開始。依存・Decision・既存全open PRのownershipを確認し、単一のownerがDraft PRを作ってbranchの`work-items/MIG-XXXX.md`にclaimを残し、CURRENTのソースとテストを読んで最初の1 micro-unitを実装・検証する。文書の試走は本実装の開始ではない。利用するhostの`/loop`等は外部の実行トリガーが必要で、Markdownだけでは自走しない。

mainへのmergeはWorkers Builds等の本番deployを起こす可能性がある。移行ループは自動mergeせず、最終Headの独立レビュー・CI greenと`Merge requested:`を揃えて人間に引き渡す。Phase Gate、Route/Custom Domain、Remote D1、Secrets、権限・可視性変更を包括承認しない。

## Quick context packet (do not paste whole Markdown set)

```bash
# `gh` が使えて全open PRを確認済みの場合:
npm run migration:next -- --model small
# `gh` が無い場合は GitHub MCP で全open PRを取得してから:
npm run migration:next -- --model small --open-pr-branches "<branch1>,<branch2>"
# open PRが0件であると確認できた場合だけ空文字:
npm run migration:next -- --model lead --open-pr-branches ""
# 明示MIGのパケット閲覧（claim権限は付与しない）:
node scripts/print-migration-task-context.mjs MIG-0301
```

The output contains **one task, its dependency states, matching decisions, one work card and assigned source-file paths**. It does not execute a task, omit permissions, or replace reading current code/test. For large MIGs select one unit from [TASK_MICRO_UNITS.md](TASK_MICRO_UNITS.md). CI tests the packet size and the MIG-0401 READY state.

## 1. Choose exactly one task, not one whole phase

Read the top "Overall" and **your MIG row + dependency rows** in [STATUS.md](STATUS.md), the relevant D-xx row in [OPEN_DECISIONS.md](OPEN_DECISIONS.md) and the **one** `### MIG-XXXX` section in the matching TASK_CARDS document. If owner PR exists, resume that branch; do not fork a second writer. Use [IMPLEMENTATION_RUNBOOK.md](IMPLEMENTATION_RUNBOOK.md) "最初の90秒" and "一件を進める厳密な手順" on a fresh wake.

Phase 4 performance path **MIG-0401→0404→0405→0406** is a valid **separate track** from MIG-0301 domain work, with dependencies tracked only in STATUS. **MIG-0402/0403 and Phase 5 real UI** require Phase 2 design system foundation (MIG-0201..0206; D-08 DECIDED); Phase 4 Gate MIG-0407 requires performance **AND** visual tests. Read [PERFORMANCE_IMPLEMENTATION_PLAN.md](PERFORMANCE_IMPLEMENTATION_PLAN.md) for CPU/Gateway work.

## 2. Load only files your task changes

Read **owned rows only** in [FILE_MIGRATION_MATRIX.md](FILE_MIGRATION_MATRIX.md) and relevant sections of [FILE_PROGRESS_PROTOCOL.md](FILE_PROGRESS_PROTOCOL.md). Then read actual source/tests, exports/importers, task-specific **UX/FN/RH/SA identifiers**, and the one subsystem baseline that governs their behavior.

| Task | Read on demand (one relevant section/row, not whole directory) |
| --- | --- |
| Public CPU/R2/Gateway | [PERF_HOTPATH_MATRIX.md](PERF_HOTPATH_MATRIX.md) → [cloudflare/PERFORMANCE_BASELINE.md](cloudflare/PERFORMANCE_BASELINE.md) → [static-delivery/README.md](static-delivery/README.md) |
| Public visual route | [CURRENT_ROUTES.md](CURRENT_ROUTES.md) → relevant [screen-mapping/README.md](screen-mapping/README.md) and [frontend/PUBLIC.md](frontend/PUBLIC.md) rows → approved [UI_REFERENCE.md](UI_REFERENCE.md) |
| API/Server Action | [route-handlers/README.md](route-handlers/README.md) or [server-actions/README.md](server-actions/README.md) → exact files and tests |
| Domain/DB/Auth/Queue | relevant [FUNCTION_INVENTORY.md](FUNCTION_INVENTORY.md), [auth/README.md](auth/README.md), [background-jobs/README.md](background-jobs/README.md) sections; actual DB/code first |
| Browser/Worker production routing | [ROUTING_AND_DEPLOY_PLAN.md](ROUTING_AND_DEPLOY_PLAN.md), [cloudflare/TOPOLOGY.md](cloudflare/TOPOLOGY.md); explicit approval required |

Do **not** paste all 432 UX / 136 FN / 110 SA / 90 page rows, all MIG cards, full [README.md](README.md) architecture and [DOC_MAP.md](DOC_MAP.md) into each iteration. Large ledgers like [FEATURE_CATALOG.md](FEATURE_CATALOG.md) (73KB) are human-readable derived views, and `gap-scan/` files are CI evidence anchors; do not load them wholesale into LLM context. Use `rg -n 'MIG-0401|UX-...' docs/migration`, `sed -n 'START,ENDp' file`, or tool-supported line/section retrieval. [DOC_MAP.md](DOC_MAP.md) is a search index, not mandatory every time.

## 3. Completion contract

Claim one PR, update touched source+target file rows and caller/HTTP/DTO/permission links, run specific tests and full required CI, capture **real** PR/SHA/CPU/URL/rollback evidence. Without parity tests, retain NOT_STARTED/IN_PROGRESS. Without separate reviewer/approval, do not claim DONE or execute production Route, D1, Auth, Secrets or traffic changes.

Full legal/workflow rules: [GIT_WORKFLOW.md](GIT_WORKFLOW.md); quality standards: [CODE_QUALITY.md](CODE_QUALITY.md); requirement conflicts: [PRODUCT_REQUIREMENTS.md](PRODUCT_REQUIREMENTS.md). Refer to [DOC_CONTEXT_AUDIT.md](DOC_CONTEXT_AUDIT.md) for size and read-budget review.
