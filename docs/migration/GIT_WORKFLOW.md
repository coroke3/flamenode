# FlameNode Migration Git Workflow

> Status: Active / Git workflow source of truth
> Last verified: 2026-10-12
> Scope: platform migration / UI redesign / migration-related infrastructure work
> Related: `AGENTS.md`, `AGENT_PROTOCOL.md`, `STATUS.md`

## 1. Core policy

FlameNode migration uses a **short-lived trunk-based workflow**.

```text
main
  ├─ migration/mig-0002-route-baseline
  ├─ migration/mig-0304-video-domain
  └─ migration/mig-0502-event-routes
```

Rules:

- `main` is the only integration trunk and must remain deployable/rollback-capable.
- Direct push to `main` is prohibited.
- **1 MIG task = 1 branch = 1 PR = 1 merge unit** by default.
- Branches are short-lived. Do not create long-lived phase branches such as `phase-4` or `migration-v2`.
- Normal merge method is **squash merge**.
- Do not mix unrelated migration tasks in one PR.
- Do not use a framework rewrite as a reason to bypass CURRENT behavior/parity requirements.

The goal is to make every migration change independently reviewable, revertible, and understandable by Claude, Codex, Antigravity, and humans.

---

## 2. Branch naming

Migration branches:

```text
migration/<task-id-lowercase>-<short-kebab-description>
```

Examples:

```text
migration/mig-0002-route-baseline
migration/mig-0304-video-domain
migration/mig-0405-visibility-gateway
migration/mig-0704-manage-spa
```

Non-MIG governance/docs work explicitly requested outside the migration loop may use:

```text
docs/<short-description>
chore/<short-description>
```

Do not include agent names in branch names. Ownership is tracked in `STATUS.md` / PR metadata, so a branch can be handed off without renaming.

---

## 3. Starting a migration task

Before creating a write branch:

1. Pull/read latest `main`.
2. Read `docs/migration/STATUS.md`.
3. Confirm the target task is `READY` and dependencies are complete.
4. Check whether an open PR/branch already claims the same MIG task.
5. Confirm no other writer owns the same files/domain.
6. Create the branch from the latest `main`.
7. Open a **draft PR early** when implementation begins.

The open task PR is the short-lived live lock for that task. Larger tasks may be checkpointed across multiple wakes **within the same Draft PR**, following `TASK_MICRO_UNITS.md`; each wake records status/tests/next unit on PR branch. Only the last wake moves the complete task to REVIEW. **PR作成は原子的なロックではない**ので作成直後にも同一MIGのopen PRを検索する。重複時は後発writerが停止し、実装・mergeせずLeadへowner調整を要求する。

`main`'s `STATUS.md` is the last **merged** dependency/Phase checkpoint. The open PR and the branch's task-specific `work-items/MIG-XXXX.md` are the live state; ordinary implementation wakes do **not** edit `STATUS.md`.

No agent may start a second implementation PR for a MIG task that already has an open owner PR.

## 3a. Work-item checkpoints / Git conflict isolation

`STATUS.md` remains the integrated task/dependency/Phase state used by existing validation scripts. Each active task instead persists its in-flight owner, current unit, test results, exact paths, rollback, blockers and next step in **`docs/migration/work-items/MIG-XXXX.md`**, only on that task's PR branch. Format: [work-items/README.md](work-items/README.md).

- Before every wake: re-read latest main, all open migration PRs, the owning task's PR branch and its checkpoint; never use chat history as a lock.
- Do not change `STATUS.md` for a claim or mid-task checkpoint. Multiple independent writers must not rewrite this shared file on every wake.
- The open Draft PR is a discoverable *advisory* owner lock, not an atomic lock: search again immediately after PR creation. Stop on duplicate MIG PR.
- Agents on different tasks may only edit their **own** work-item checkpoint. Concurrent changes to the same code path, migration file matrix row, UX/FN/Route/API ledger or permission/schema/auth boundary are prohibited.
- Before merge, fetch latest main; reconcile dependency/Phase state and any other merged task; only then update the **affected task and newly unblocked tasks** in `STATUS.md`. Do not overwrite the full summary with a stale copy.
- Re-run required CI/contract checks and independent review on the integrated head. Move the work-item to DONE with actual evidence, then squash merge. Next wake reads the new main.
- `node scripts/check-migration-work-items.mjs` validates local record structure/declared duplicate paths; actual remote PR, reviewer identity and CI must still be inspected.

---

## 4. Task and PR lifecycle

```text
READY on main
  ↓
branch from latest main
  ↓
draft PR + IN_PROGRESS in task-specific work-item file
  ↓
implement bounded micro-unit, checkpoint work-item on same PR branch
  ↓
repeat next wake on the SAME PR until all units DONE
  ↓
REVIEW in work-item checkpoint
  ↓
independent review
  ↓
after review, DONE work-item + reconcile STATUS against latest main
  ↓
squash merge
  ↓
main becomes the new progress checkpoint
```

### Important

Incomplete micro-units do **not** justify setting REVIEW early; the PR remains Draft/IN_PROGRESS with explicit owner and next unit checkpoint. The ordinary prohibition on abandoned IN_PROGRESS applies only to missing owner/handoff evidence.

Do **not** create a second bookkeeping PR only to move `REVIEW → DONE` after a normal task PR.

Before merge, the task branch should already contain the final state that main should inherit:

- `FILE_MIGRATION_MATRIX.md` contains every changed CURRENT/NEW source path, target provider/consumer linkage, test+PR+SHA evidence, file state; validated by `node scripts/check-migration-file-progress.mjs`

- current task work-item `DONE` with real review/CI evidence
- current task `DONE` in `STATUS.md` against latest main
- evidence/validation recorded
- affected inventory/matrices updated
- next dependency-ready task(s) marked `READY`
- owner released where appropriate

Exception: emergency/manual production operations whose result is not known until after merge may require a dedicated follow-up record.

---

## 5. PR title and body

### Title

```text
MIG-XXXX: <Japanese concise task description>
```

Examples:

```text
MIG-0002: 画面・ルート基準を棚卸し
MIG-0405: visibility gateway PoCを追加
MIG-0704: Manage画面をReact SPAへ移行
```

### Required PR body

Every migration PR must contain:

```text
Task: MIG-XXXX
Agent/Owner:
CURRENT:
TARGET:
Scope:
Non-scope:
Affected function IDs:
Affected routes/APIs:
FILE_MIGRATION_MATRIX.md rows before/after:
Actual source -> target exports -> consumers:
Changed:
Preserved contracts:
Validation:
Production impact:
Rollback:
Dependencies / follow-up:
```

For UI redesign PRs, also include:

- mapped screen IDs/routes
- related function IDs
- loading/error/empty/forbidden states
- responsive acceptance
- intentional removals, if any, with approval evidence

---

## 6. Commit policy

Work-branch commits may be incremental, but they must remain understandable.

Preferred commit messages are Japanese and action-oriented.

Examples:

```text
画面ルートの棚卸しを追加
作品更新処理をドメインサービスへ抽出
visibility gatewayの失敗時挙動を追加
移行テストを修正
```

Avoid meaningless commits such as `fix`, `wip`, `aaa`, unless immediately squashed/fixed before review.

Because normal merge is squash, `main` receives one atomic commit per MIG task.

Squash commit title should match the PR title where possible.

---

## 7. Merge policy

### Default: squash merge

Use squash merge for normal migration PRs because:

- one main commit maps to one MIG task
- rollback is `git revert <squash-commit>`
- agent-internal fixup history does not pollute main
- history remains readable across a long migration

### Merge commit

Not used by default.

Allowed only when preserving a meaningful multi-commit history is explicitly justified, such as importing an independently reviewed upstream history. This should be rare.

### Rebase merge

Not used for normal migration tasks. Squash is the project standard.

---

## 8. Updating a branch with main

Tasks should be small enough that branch drift is uncommon.

Before final review/merge:

- ensure the branch is based on a sufficiently current `main`
- resolve conflicts against current source-of-truth files
- rerun relevant validation after conflict resolution

Prefer rebasing a short-lived single-owner branch onto `main` before review.

If rewriting a remote branch is required, use **force-with-lease only**. Never blind-force-push.

Do not rewrite a branch after independent review has started unless the reviewer is notified and review is repeated for changed commits.

---

## 9. Multi-agent roles

A migration PR has distinct roles:

```text
Builder  = writes the task
Reviewer = independent agent/human reviewing parity and regression risk
Verifier = optional third agent for high-risk tasks
Lead     = final approver for gated/high-risk changes
```

Rules:

- An agent must not be the only reviewer of its own migration PR.
- Claude, Codex, and Antigravity may rotate Builder/Reviewer roles.
- Review findings are written to the PR/repository, not left only in chat.
- The reviewer checks CURRENT parity, not only code style. **Review must come from a separate reviewer identity/process**; builder's self-review/CIだけで独立レビューと称しない。レビュー対象のcommit SHAを記録し、レビュー後に変更した場合は再レビューとCIを要求する。

### High-risk two/three-party rule

The following require an independent reviewer **and Lead/human approval** before merge or production action:

- Auth/session/account linking
- DB schema/destructive migration
- permissions/owner invariants
- visibility/fail-closed behavior
- public API/privacy boundary
- audit/restore
- Worker Route / Custom Domain / traffic cutover
- secrets
- production Remote D1 operations
- irreversible data migration

A third verifier agent is recommended for these tasks when practical.

---

## 10. Parallel work

### Default

Only one migration **writer lane** is active at a time.

Other agents may work in parallel on read-only activities:

- PR review
- test audit
- design comparison
- security review
- benchmark analysis
- code archaeology

Per-MIG checkpoint files prevent every wake from writing to `STATUS.md`. Shared ledgers/matrices still need nonoverlapping row/path ownership, and `STATUS.md` is integrated serially just before merge.

### Parallel write exception

Parallel write PRs are allowed only when all are true:

- tasks are dependency-independent
- file/domain ownership does not overlap
- neither task modifies another work-item file or shared matrix/ledger rows owned by the other; STATUS integration is serialized at merge
- rollback is independent
- Lead explicitly marks the work parallel-safe

If uncertain, serialize the tasks.

---

## 11. Stacked PRs

Stacked PRs are **not the default**.

Use a stacked PR only when waiting for review would otherwise block clearly independent follow-up work and the dependency is explicit.

Rules:

- maximum practical stack depth: 2
- child PR base is the parent branch until parent merges
- PR body must say `STACKED ON: #<parent>`
- child does not merge before parent
- after parent merge, rebase/retarget child to `main` and rerun validation
- do not stack DB/Auth/visibility/cutover changes

For `/loop`, prefer sequential task PRs over stacks.

---

## 12. Main branch policy

`main` must remain:

- buildable
- deployable under CURRENT production architecture until cutover
- a valid rollback point
- free of partially completed destructive migrations
- free of unreviewed production routing changes

Target GitHub protection/ruleset:

- require pull request before merge
- block force push
- block branch deletion
- require conversation resolution
- require at least 1 approval for migration code
- require configured status checks once migration CI exists
- require CODEOWNERS/Lead review for high-risk paths when configured

Repository protection may not currently enforce all of these mechanically; agents must still obey this document.

---

## 13. Deployment separation

**Code landing and traffic switching are separate operations.**

Do not combine a large implementation PR with production route cutover.

Preferred sequence:

```text
implementation PR
  ↓ merge
shadow/non-routed deploy
  ↓ smoke/benchmark
cutover proposal/review
  ↓ explicit approval
small routing/cutover PR or operation
  ↓ observe
```

For new Workers (`site`, `app`, `api`), deployment without production traffic is allowed only when the active MIG task permits it. Attaching `flamenode.net` routes/custom domains requires explicit approval.

---

## 14. Database changes

Use **expand → migrate → contract**.

- Additive schema support lands before consumers require it.
- Existing Next and new paths must coexist during bridge phases.
- Do not remove/rename fields while legacy runtime still depends on them.
- Migration SQL is committed/reviewed through PR.
- Remote D1 migration is **not** automatically applied by merge.
- Remote apply requires explicit approval and read-only preflight.
- Destructive contract/removal happens in a later dedicated MIG task after legacy usage reaches zero.

Never edit the SQL body of an already-applied migration.

---

## 15. Production routing / infrastructure changes

Changes to:

- Worker Routes
- Custom Domains
- production build topology
- production secrets
- Remote D1
- public bucket exposure

must be isolated from ordinary feature implementation where possible.

They require:

1. explicit task/PR
2. current-state snapshot
3. exact change
4. smoke plan
5. rollback command/route
6. explicit user/Lead approval
7. post-change observation evidence

Do not let `/loop` auto-execute these changes.

---

## 16. Rollback

Every migration PR must state rollback.

### Normal code/task PR

Primary rollback:

```text
git revert <squash-merge-commit>
```

### Route/cutover

Rollback is usually restoring the previous Worker Route/Custom Domain ownership so traffic returns to `flamenode-web`.

### DB

Prefer forward-fix/additive rollback. Never assume destructive D1 rollback is safe.

If rollback cannot be described before merge, the PR is not ready.

---

## 17. Phase checkpoints / tags

At successful Phase Gates, create a durable checkpoint reference when useful.

Recommended naming:

```text
migration-phase-0
migration-phase-1
...
pre-public-cutover-YYYYMMDD
pre-opennext-retirement-YYYYMMDD
```

Tags/checkpoints are for rollback and archaeology, not for maintaining parallel release branches.

---

## 18. Agent handoff

Prefer handing off between tasks, not mid-task.

If a mid-task handoff is necessary:

- keep the same branch/PR
- update owner in the PR branch `work-items/MIG-XXXX.md`
- record what is complete and incomplete
- record exact validation already run
- record current blockers
- do not create a second branch for the same MIG task

The next agent re-reads the branch state and continues from there.

---

## 19. Practical default flow

```text
1. /flamenode-migration selects MIG-XXXX
2. confirm no open owner PR
3. branch from latest main:
   migration/mig-xxxx-description
4. open draft PR
5. mark work-item IN_PROGRESS on branch (do not edit STATUS.md during work)
6. implement exactly that task
7. update inventories/matrices/tests
8. validate
9. mark work-item REVIEW, request independent review
10. address findings + rerun validation
11. after independent review, update work-item DONE and reconcile STATUS task DONE + next READY against latest main
12. CI成功・別レビュアー確認・必要な人間承認を確認した場合だけsquash merge。権限/レビューが不足する場合はREVIEWで停止
13. delete branch
14. next loop starts from updated main
```

This is the default unless a specific high-risk migration task defines stricter rules.
