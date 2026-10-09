# D-01: packages/db 完全分離とゼロDDL移設計画

> Status: DECIDED architecture / NOT IMPLEMENTED
> Decision: A adopted 2026-10-09
> Owner: Phase 3 Domain Extraction
> Approval boundary: source-code migration only. Remote D1 writes, production deploy, existing SQL migration rewriting are not authorized.

## 1. CURRENT graph (inspected in repository)

- `src/lib/db/schema.ts`: explicit re-exports of `schema.base.ts` and `schema.canonical.ts`.
- `schema.canonical.ts`: `import { eventGroups, softwareCatalog, users } from "./schema.base.ts"`. Moving canonical alone breaks circular table references.
- `drizzle.config.ts`: `schema: "./src/lib/db/schema.ts"` and `out: "./migrations"`.
- `scripts/check-db-schema.mjs`: `assertSchemaEntryPoint()` requires 3 legacy files and checks fragment imports under app/src/workers/scripts. Also performs canonical SQL index/table manifest checks.
- Root `package.json`: npm workspaces `packages/*` and `apps/*`. `packages/domain` currently depends on `@flamenode/contracts`, not DB.
- `src/lib/db/**`: query execution and D1 context; NOT automatically movable with schema declarations.
- Existing applied migrations: immutable; no DDL/schema change is intended in this extraction.

## 2. Target graph

```text
packages/contracts ──────────────────────────────┐
packages/db/src/schema/base.ts                   │
  └─ referenced by canonical.ts                 │
packages/db/src/schema/canonical.ts ──────────┐  │
packages/db/src/schema/index.ts (only export) │  │
                                              ▼  ▼
packages/domain (pure policy + typed entities where useful)
    ▲                    ▲
    │                    │
src/lib/db/schema.ts      apps/api / Hono (D1 adapter)
(reexport bridge)         ▲
    ▲                    │
legacy Next services ────┘
```

- `packages/db` must not import `src/`, `app/`, `workers/`, `next`, `hono`, `react`, or `packages/domain`.
- `packages/domain` may import `@flamenode/db` for schema/types but must not import legacy `src/**`. Avoid domain→Hono/Next dependencies.
- Only adapters use Cloudflare D1 bindings, request context, transactions, authorization session, audits, enqueue, and adapter-specific retry.
- Prefer `packages/db/src/schema/index.ts` as canonical public export, with `@flamenode/db/schema` export and package main. No wildcard exports exposing internal fragment modules.

## 3. Implementation (separate MIG task/PR before Tier 2 extraction)

1. **Inventory before move**: enumerate all imports of `src/lib/db/schema*`, TypeScript path aliases, app/workers/scripts imports, Drizzle references, migration-generation commands, tests and known third-party callers. Save a line-item compatibility manifest and schema symbol snapshot. Inventory current SQL tables/columns/checks/indexes/FK using verifier; record before-state as evidence.
2. **Establish new package**: `+packages/db/package.json` with `@flamenode/db` name, explicit `drizzle-orm` and TS scripts/exports, `+packages/db/tsconfig.json`, `+packages/db/src/schema/base.ts`, `+packages/db/src/schema/canonical.ts`, `+packages/db/src/schema/index.ts`.
3. **Move both fragments together** preserving export names, table definitions, identifiers, FK closures, enum, index/check expressions, column defaults. Keep canonical→base as a local module import. Do not copy obsolete tables back in.
4. **Compatibility**: `src/lib/db/schema.ts` becomes a re-export of `@flamenode/db/schema` while preserving existing runtime symbols. For any callers of legacy `schema.base.ts`/canonical, remove bypasses or add narrow deprecated reexports with explicit expiry; do not leave two independent table constructors/Drizzle table objects in runtime.
5. **Package and build**: npm workspace lockfile changed with new package; prove `npm ci` reproducibility. Adjust `drizzle.config.ts` schema import/path and `scripts/check-db-schema.mjs` manifest entry scanner to new locations. Restore or tighten old restriction forbidding fragment direct imports. Do not remove safeguards on the pretext of path migration.
6. **TypeScript/runtime**: verify ESM Node TS strip, `node --test`, `next`/OpenNext, Wrangler bundles, Hono worker import with no bundler-only aliases. Split package exports/types/d.ts as needed; `npm run typecheck`, `test:unit`, `test:integration`, `verify:fast`, workspace builds, `check:project-docs`.
7. **Schema invariance**: compare before/after Drizzle manifests including every table, SQL name, FK, NOT NULL, defaults, unique index, partial index `WHERE`, ordering, CHECK. `drizzle-kit generate` (or dry-run schema diff equivalent) must produce **zero new DDL**; never auto-apply. Commit no regenerated applied migrations.
8. **Cut-in order**: package build → old compatibility bridge → consumers one bounded section at a time → remove direct fragment imports → full CI/parallel smoke → merge. Keep production code on old API contract; pure file movement is not traffic cutover.
9. **Rollback**: revert PR while migrations remain unmodified; no DB rollback is needed because no DDL/data change was allowed.

## 4. Accept/reject criteria

- [ ] `packages/db` compiles and is the **only** source of runtime sqliteTable declarations.
- [ ] all original `schema.ts` named exports resolve identically through bridge.
- [ ] No package import cycles (including type-only imports and build-time scripts).
- [ ] DB schema manifest stable; no generated DDL in migrations.
- [ ] Original Next/Worker scripts and domain/Hono import path all build, tests/CI PASS.
- [ ] No hidden `src/` imports from package; `check-db-schema` checks relocated files with equal or stronger rules.
- [ ] D1 remote data unchanged, no Route/Custom Domain/Auth cutover.
- [ ] Independent review of compatibility + sensitive schema diff prior to merge.

## 5. Task sequencing

`MIG-0301`: existing pure domain PoC. `MIG-0302`: pure read extraction can proceed. **New MIG-0308 ("packages/db schema extraction")** after MIG-0302 and before MIG-0303 Tier2. MIG-0303/0304/0305/0306 are blocked on MIG-0308, and Gate MIG-0307 must include MIG-0308 outcome.

Do not claim that D-01 is completed simply because this architecture plan is DECIDED. The above is the implementation checklist for subsequent PR; do not move schema definitions within a broad unrelated documentation PR.
