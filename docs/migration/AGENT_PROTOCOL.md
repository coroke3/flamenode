# Cross-agent Migration Protocol

Goal: Codex, Antigravity and Claude may alternate without relying on chat memory.

## Canonical shared memory

- objective/invariants: `README.md`, `ARCHITECTURE.md`
- current state: `PROGRESS.md`
- task graph: `WORK_ITEMS.md`
- existing behavior: `FEATURE_INVENTORY.md` + current code/tests/Active docs
- screen coverage: `../design-redesign/ROUTE_INVENTORY.md`

Conversation summaries are never the only record of migration state.

## One cycle

1. Read `PROGRESS.md` and `WORK_ITEMS.md`.
2. If `Claimed by` names another active agent/task, do not edit the same scope. Pick an independent `ready` item only if files do not overlap; otherwise stop.
3. Claim exactly one work item in `PROGRESS.md` (`Active work item`, `Claimed by`, timestamp/branch if known).
4. Read only that item's relevant current code/tests/docs.
5. Implement the smallest coherent slice that advances its `Done when` condition.
6. Run targeted verification. Fix regressions caused by the change; do not hide them by weakening tests.
7. Update inventory/decision docs if the code established new facts.
8. Update `WORK_ITEMS.md` status and append a `Recent cycles` row with concrete evidence.
9. Clear `Claimed by` before stopping unless work is intentionally left in progress with an exact resumable checkpoint.

## Loop semantics

A loop repeats **cycles**, not arbitrary edits. State must be persisted after every cycle so another agent can resume after interruption.

Stop immediately when:

- the next action needs production deploy/route switch/Remote D1/secret/destructive operation without explicit approval;
- current code/test contradicts the target architecture and the correct product behavior is not provable;
- auth/permission/public visibility would be weakened;
- a required test is red for a reason not understood;
- another agent owns the same work item/files;
- the work item exit condition is reached.

Do not endlessly retry the same failed command. Record the exact failure as a blocker after one reasonable repair attempt plus one re-run, unless the failure itself is the assigned debugging task.

## Agent-specific invocation

### Claude Code

`/flamenode-migration` invokes the project command/skill. For repeated runs use `/loop /flamenode-migration`; `.claude/loop.md` makes a bare `/loop` advance this migration by one safe cycle per wake.

### Antigravity

Workspace skills live under `.agents/skills/`. `/flamenode-migration` runs one cycle. `/loop` is a project skill that repeatedly applies the same cycle protocol until a stop condition; it is not a time scheduler.

### Codex

Repo skill adapter lives under `.codex/skills/`. Invoke `$flamenode-migration` (or select it via `/skills`). For long-horizon execution prefer `/goal`, with success defined by a specific work item or phase. `$loop` may be used as a procedural helper, but it must not pretend Codex has Claude's timer `/loop` command.

## Parallel agents

Parallel work is allowed only when work-item file ownership is disjoint. DB/auth/security/public API/visibility/cutover final decisions are serialized. Before merge, the lead agent re-reads combined diffs and runs the union of required checks.
