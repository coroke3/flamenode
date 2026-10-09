# Migration documentation sufficiency & context-budget audit — 2026-10-09

> Audit scope: `docs/migration/**/*.md`, verified against main tree at `0b50441788741a2f0518ecd6058e4bd2ff36dd9d` **before** this PR. This is document design review, **not a full small-model runtime acceptance test**.

## Measured input

| Indicator | Before performance-first PR | Evaluation |
| --- | ---: | --- |
| Migration MD files | **56** | Numerous *separated ledgers/specs* are justified by 432 UX, 136 FN, 110 SA, 33 RH methods, 90 page routes |
| Markdown bytes (UTF-8, repo tree blob sizes) | **839,768 B (~820 KiB)** | Cannot be loaded wholesale every iteration |
| Largest 5 files | **259,615 B (31%)** | feature catalog 73,037; backend FN gap ledger 65,855; file matrix 41,277; screen mapping 40,009; action ledger 39,437 |
| Common starting set: AGENT_PROTOCOL + STATUS + README + RUNBOOK + OPEN_DECISIONS | **88,283 B** | Excessive if full documents are repeatedly loaded by Luna/Haiku/other small-context agents |
| Validator evidence | GitHub Action checks current page/route/action ledgers, file state, links, task cards and dependencies | The repo contains substantive implementation rules; validator cannot prove an agent understood every sentence |

These are bytes, **not tokens**. Japanese and code/tokenizer variation make any fixed “bytes-to-tokens” conversion misleading. Files on disk do not slow production Workers; **unselective prompt context ingestion** increases model latency/cost and can displace key instructions.

## Findings

1. **Required and justified:** `STATUS.md` task state/dependencies, exact per-file source/target owner in `FILE_MIGRATION_MATRIX.md`, route/SA/RH and UX/FN canonical ledgers, security/visibility and Queue baseline, runbook and scope-limited task cards. Their size mostly reflects capability coverage. **Do not truncate or delete their individual rows to optimize token counts**.
2. **Context inefficiency:** `AGENT_PROTOCOL.md` originally provided an 11-step "mandatory read order" including the full 27KiB README and dozens of large cross-ledgers; this is a discovery checklist, not a safe per-wake loading list. With 56 files, a model may inadvertently load the whole corpus.
3. **Documentation duplication:** `README.md`, `DOC_MAP.md`, `AGENT_PROTOCOL.md`, `IMPLEMENTATION_RUNBOOK.md` repeat navigation. They must not become four conflicting instructions. Keep `DOC_MAP` as canonical index, `STATUS` as unique state, `RUNBOOK` as execution procedure, `AGENT_PROTOCOL` as cross-agent policy.
4. **New content:** two small performance documents are justified because the original baseline was observational while the change needs executable route ownership and acceptance. They are references, **not new state ledgers**.
5. **Unchecked:** actual Luna/Haiku agent comprehension, live PoC CPU reduction, human visual review, auth/Queue end-to-end parity are not proven by documentation checks.

## After-change snapshot (PR #281; 2026-10-09 verified branch)

- After the initial performance-first documentation change: **60 migration MD files / 868,552 bytes (~848 KiB)**, **+28,784 bytes (+3.43%)** over the 56-file baseline. This increase is primarily targeted runtime performance/acceptance detail and the context audit itself, not duplicated full capability ledgers.
- The legacy five-document full-read set is still **88,308 bytes**. The benefit does **not** come from reducing those files' total size; it comes from stopping full-file reads and emitting a task-scoped subset instead.
- The one-task packet is produced by `node scripts/print-migration-task-context.mjs MIG-0401`; its correctness and size (including a large Admin MIG) are CI-tested. MIG-0401 was actually emitted as **2,508 characters / 5 source rows** in the contract CI; large Admin scope is asserted under **24,000 characters**. It is a **locator**: actual source/tests/PR+approval rules remain mandatory.
- These bytes were measured from 60 Markdown Git blobs on this PR branch after the one-task packet documentation change. The final one-line audit edit adjusts the total by only its textual delta. This is a size audit, not measured LLM inference latency or tokens.

## Changes and concrete read budget

- New **[MIGRATION_START_HERE.md](MIGRATION_START_HERE.md)** is the one-page entry; it points to existing sources without repeating tables. **`scripts/print-migration-task-context.mjs MIG-XXXX`** returns a small scoped packet, with test-covered output budgets and explicit warning on large tasks.
- A wake reads **STATUS only relevant task/dependency rows**, **one TASK_CARDS section**, **relevant decision**, **FILE_MIGRATION_MATRIX owner rows**, real source/tests and 1–2 relevant subsystem baseline sections. Full policy files are consulted for conflict/approval, never skipped when pertinent.
- If a single task requires more than one screen/domain, use [TASK_MICRO_UNITS.md](TASK_MICRO_UNITS.md) and narrow scope rather than dumping full files into context. Keep open PR/owner and tests as resumption evidence.
- Large ledgers are **searchable source-of-truth on disk**, not chat prompt attachments. No duplicate copy of full route/action/state tables in new documents.
- **No hard total-byte cap** on the canonical library: a cap would reward deleting test evidence and risk lost functionality. Watch new duplicate normative sections instead.
- Any future new migration document must explain which existing canonical source it links, what new fact it adds, why it cannot be a subsection, and which task(s) consume it.

## Acceptance audit

- Task completeness: Phase 2–9 MIGs and planned Phase 4 dependency DAG validated by executable checker and task-card coverage.
- References: relative Markdown paths checked by `check-migration-links.mjs`.
- Behavior data: canonical inventories and exact source linkage checked by `check-migration-docs.mjs` and `check-migration-file-progress.mjs`.
- New performance plan: measured old baseline vs **TARGET** budgets clearly separated; design/production approval still gated.
- Claims limited to documentary consistency and existing CI; runtime 1102 and token usage of specific agents require their own post-implementation measurements.
