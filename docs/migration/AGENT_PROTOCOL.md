# FlameNode Migration Agent Protocol

> Status: Active
> Last verified: 2026-10-06
> Verified against commit: `99591f7b3387b6b33d113f2685d6b31e38085fdc`
> Source of truth: `docs/migration/README.md`, `docs/migration/STATUS.md`, current code/test
>
> Claude Code / OpenAI Codex / Google Antigravity 共通の移行実行契約。
> tool固有adapterには仕様を複製せず、この文書を参照させる。

## 1. Invocation

### Claude Code

One task:

```text
/flamenode-migration
```

Repeated execution:

```text
/loop /flamenode-migration
```

Adapters:

- `.claude/commands/flamenode-migration.md`
- `.claude/skills/flamenode-migration/SKILL.md`

### OpenAI Codex

Repo skill:

```text
flamenode-migration
```

Adapter:

- `.codex/skills/flamenode-migration/SKILL.md`

One task prompt:

```text
Use the flamenode-migration skill and execute exactly one READY MIG task.
```

Codex builds with Goals support may run the campaign as a persistent `/goal`:

```text
/goal Continue the FlameNode migration using the flamenode-migration skill and repository migration protocol. Execute exactly one MIG task per iteration, persist STATUS/inventory changes after each task, and stop at any Phase Gate, blocker, or approval-required production action.
```

The `/goal` does not override this protocol. Repository STATUS remains authoritative.

### Google Antigravity

Workspace skill:

```text
/flamenode-migration
```

Adapter:

- `.agents/skills/flamenode-migration/SKILL.md`

Antigravity discovers workspace skills under `.agents/skills/` and exposes them as slash commands.

For continuous execution:

```text
/goal Continue /flamenode-migration one MIG task at a time. Persist all progress to repository migration Markdown and stop on the AGENT_PROTOCOL stop conditions.
```

Optional custom agent:

- `.agents/agents/flamenode-migration/agent.md`
- select through `/agents` when useful

### Generic agent

Any agent that reads root `AGENTS.md` can use:

```text
Read docs/migration/AGENT_PROTOCOL.md and execute exactly one READY task from docs/migration/STATUS.md.
```

---

## 2. Canonical read order

Every migration iteration:

1. `AGENTS.md`
2. matching migration row in `docs/AI_CONTEXT.md`
3. `docs/migration/README.md`
4. `docs/migration/STATUS.md`
5. `docs/migration/FUNCTION_INVENTORY.md` index
6. **only the relevant** `docs/migration/functions/*.md` ledger
7. relevant `ROUTE_MATRIX.md` / `API_MATRIX.md`
8. target code and tests
9. at most one additional Active document when required

Do **not** read every function ledger on every iteration.

Forbidden:

- indiscriminate repository rereads
- bulk Historical/archive loading
- repeating facts already persisted by previous iterations without reason
- treating a tool-specific adapter as the specification source
- using prior chat state as the only handoff

---

## 3. One iteration contract

**1 iteration = exactly 1 MIG task.**

### Start

Read from `STATUS.md`:

- Current Phase
- Current/Next Task
- dependencies
- Phase Gate
- blockers
- current owner

If no task is `READY`, do not pick another task opportunistically.

### Claim

Transition the selected task to `IN_PROGRESS` and record an owner.

```text
Task:
Owner: claude | codex | antigravity | other
CURRENT:
TARGET:
Scope:
Non-scope:
Affected function IDs:
Affected route/API IDs:
Rollback:
Production action required: yes/no
```

### Inventory guard

Before implementation:

1. resolve affected function IDs from the inventory/index
2. open only their relevant domain ledger(s)
3. if the existing capability is not sufficiently audited, complete the necessary CURRENT audit first
4. never mark `DETAIL_AUDIT_REQUIRED`, unknown, or unverified functionality as migrated
5. for screen redesign, classify every available action/capability as migration scope or explicit non-scope

Visual completion is not functional completion.

### Implement

Principles:

- one PR = one migration boundary where practical
- freeze CURRENT contract from code/tests first
- prefer framework-neutral domain logic
- make compatibility bridges explicit
- do not delete the legacy path in the same step that first introduces the new path
- no Big Bang rewrite
- preserve function coverage during redesign
- do not add technology solely because it is part of the target stack; use it only when the active task needs it

### Validate

Run:

- task Acceptance
- affected function Acceptance
- relevant existing regression tests
- migration-specific CPU/build/UI/security checks when required

### Finish

The task must transition to one of:

- `DONE`
- `REVIEW`
- `BLOCKED`

Never end an iteration with a task left `IN_PROGRESS`.

Persist relevant updates to:

- `STATUS.md`
- affected `functions/*.md` ledger(s)
- `FUNCTION_INVENTORY.md` totals/index if counts change
- `ROUTE_MATRIX.md`
- `API_MATRIX.md`

Last iteration format:

```text
Agent:
Task:
Result:
Affected functions:
Validation:
PR/commit:
Rollback:
Blockers:
Next:
```

---

## 4. Multi-agent coordination

Claude / Codex / Antigravity may all participate, but **the Git repository is the only shared state authority**.

### Single writer per task

Only one agent may own an `IN_PROGRESS` task.

```text
Owner: claude
Owner: codex
Owner: antigravity
```

Other agents may perform read-only review/audit, but must not silently mutate the same task state.

### Safe parallel work

Good parallel candidates:

- read-only inventory exploration
- independent test audit
- design comparison
- security review
- CPU/build analysis
- reviewer-only validation of another agent's PR

Avoid concurrent edits to:

- `STATUS.md`
- the same function ledger row
- the same route/API matrix row
- the same domain service
- DB/auth/permission/visibility core

The task owner integrates read-only findings.

### Handoff

Before switching agents, persist:

- task state
- owner
- findings/evidence
- tests run
- blocker
- next action

If the handoff exists only in a Claude/Codex/Antigravity conversation, it does not count.

---

## 5. Continuous execution contract

Different products have different long-running commands:

- Claude Code: `/loop /flamenode-migration`
- Codex: `/goal ...` around the `flamenode-migration` skill
- Antigravity: `/goal ...` around `/flamenode-migration`; `/teamwork-preview` may be used for read-only large-scale investigation, but task ownership still follows STATUS

All map to the same logical loop:

```text
LOOP:
  read STATUS
  select exactly one READY MIG task
  claim it
  execute
  validate
  persist STATUS + affected ledgers/matrices
  evaluate stop conditions
```

### Mandatory stop conditions

Stop instead of continuing when:

- Overall State = BLOCKED
- no READY task exists
- a Phase Gate is waiting for review
- production action requires explicit approval
- Remote D1 / secret / Worker Route / Custom Domain change is required
- auth/security/permission/visibility specification conflicts
- test failure root cause exceeds task scope
- rollback is unavailable or unproven
- required function inventory coverage is unknown
- another agent already owns the target task

### Continuous-mode prohibitions

- completing multiple MIG tasks as one status transition
- auto-approving a Phase Gate
- bypassing BLOCKED work to enter a later high-risk phase
- automatic production deploy/routing/secret/Remote D1 mutation
- continuing without persisting progress

---

## 6. Redesign contract

UI redesign is part of migration, not permission to reduce product capability.

Visual sources:

1. `docs/design-redesign/DESIGN_PRINCIPLES.md`
2. `docs/design-redesign/UX_AUDIT.md`
3. `docs/design-redesign/NAVIGATION.md`
4. `/dev/redesign`
5. `docs/design-redesign/PAGE_COVERAGE.md`
6. `docs/design-redesign/DECISIONS.md`

Functional sources:

- CURRENT code/tests
- `FUNCTION_INVENTORY.md` + relevant function ledger
- `ROUTE_MATRIX.md`
- `API_MATRIX.md`

### Screen completion

A screen is `DONE` only when:

- visual redesign is complete
- target responsive states are complete
- loading/error/empty/permission states are covered
- every associated required function is `PARITY_VERIFIED` or explicitly `REMOVED_APPROVED`
- permission checks and server-side side effects are verified
- route/API dependencies are migrated or have an explicit bridge
- current acceptance tests pass or equivalent replacement tests exist
- direct navigation/reload/history semantics are verified where applicable

A visually complete screen with incomplete functions is `UI_DONE_FUNCTIONS_PENDING`.

---

## 7. Existing-function preservation invariant

Final migration cannot complete with:

```text
UNKNOWN required functions
DETAIL_AUDIT_REQUIRED functions
unverified migrated functions
screens without complete function mapping
legacy actions/routes without disposition
background jobs without disposition
permission rules without parity evidence
side effects without parity evidence
```

### Removal workflow

Never hide feature removal inside migration/refactor work.

Required:

1. ledger state → `REMOVAL_PROPOSED`
2. reason
3. affected users/routes/data
4. replacement, if any
5. explicit user/Lead approval
6. only then → `REMOVED_APPROVED`

---

## 8. Tool-neutral completion format

```text
MIG-XXXX: <task>
Agent: <agent>
State: DONE | REVIEW | BLOCKED

Functions:
- FN-...

Changed:
- ...

Preserved:
- ...

Validation:
- ...

Rollback:
- ...

Progress files updated:
- STATUS.md
- relevant functions/*.md
- ROUTE_MATRIX.md / API_MATRIX.md

Next:
- MIG-YYYY | Phase Gate review | BLOCKED(reason)
```
