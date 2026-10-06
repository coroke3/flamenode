---
name: flamenode-migration
description: Execute one safe, evidence-backed FlameNode architecture/UI migration cycle using the repository migration ledger. Use for Next/OpenNext→Astro/React/Hono migration, redesign productionization, parity inventory, or when the user says /flamenode-migration.
---

# FlameNode migration

Execute work; do not return only a plan unless the active work item is explicitly a planning/inventory item.

1. Read `AGENTS.md` migration exception, then `docs/migration/PROGRESS.md` and `docs/migration/WORK_ITEMS.md`.
2. Select the active item, otherwise the first `ready` item whose dependencies are done.
3. Follow `docs/migration/AGENT_PROTOCOL.md` for claim/loop/handoff rules.
4. Read only the current code/tests/docs needed by that item. Current code/test wins over migration assumptions for existing behavior.
5. Preserve `docs/migration/README.md` invariants, especially visibility fail-closed and no production cutover without explicit approval.
6. Implement one coherent cycle, verify it, and persist evidence to `PROGRESS.md` before stopping.
7. New behavior discovered during migration must be added to `FEATURE_INVENTORY.md` before replacing the legacy path.

A cycle cannot mark a task done based on prose alone when its `Done when` requires code/test/runtime evidence.
