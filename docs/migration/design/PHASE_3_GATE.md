# Phase 3 Acceptance Gate: Domain Logic & DB Package Extraction Audit

> Status: REVIEW / Awaiting Human Phase Gate Sign-off
> Verified against commit: `migration/mig-0307-phase-3-gate`
> Checklist ID: `GATE-PHASE-3`

---

## 1. Executive Summary

Phase 3 transitions FlameNode's core business logic, validation rules, access policies, and canonical database definitions out of the monolithic Next.js tree (`src/lib/**`) into standalone, framework-agnostic workspace packages:
- **`@flamenode/db`**: Pure Drizzle D1 schema definitions (`schema/base.ts`, `schema/canonical.ts`, `schema/index.ts`).
- **`@flamenode/domain`**: Pure TypeScript business rules, validation schemas, permission predicates, and data transformation policies.

All migrations follow Recipe **R-DOMAIN** and **ZERO_1102** Runtime Class **N** (pure logic, zero external network, 0ms runtime overhead).

---

## 2. Phase 3 Deliverables & Task Inventory

| Task | Domain / Subsystem | Owned Packages / Paths | Invariant / Parity Checks | Status |
| :--- | :--- | :--- | :--- | :--- |
| **MIG-0301** | Core read helpers & permission baselines | `@flamenode/domain/permissions`, `slots`, `software` | Retired placeholder permissions; pure helper extraction | DONE (Merged) |
| **MIG-0302** | Audit core & read domain adapters | `@flamenode/domain`, `src/lib/audit/mutate.ts` | Strict / CAS audit boundaries preserved; CAS retry idempotency | PR #308 (Ready) |
| **MIG-0308** | Database package extraction | `packages/db/src/schema/**` | **Zero DDL**: 31 migrations, 46 tables, 474 columns, 114 indexes, 52 FKs, 43 checks identical | PR #315 (Ready) |
| **MIG-0303** | Low-risk mutation domain policies | `@flamenode/domain/announcements`, `apiEndpoints`, `eventTemplates` | SA-004..008, 035..037 validation, normalization, and CAS semantics identical | PR #316 (Ready) |
| **MIG-0304** | Video domain group | `@flamenode/domain/video` (chapters, overlays, metadata) | Pure chapter parsing & viewer overlay separation | PR #318 (Ready) |
| **MIG-0305** | Event & slot reservation domain group | `@flamenode/domain/event`, `slot` | Last-owner invariant (>= 1 operable owner) enforced; double reservation protection | PR #319 (Ready) |
| **MIG-0306** | User, X-ID, & admin domain group | `@flamenode/domain/xid`, `admin`, `user` | Auth User vs Active X boundary strictly preserved; cost guard evaluation intact | PR #320 (Ready) |
| **MIG-0307** | Phase 3 Gate & import boundary verification | `scripts/check-domain-imports.mjs` | Automated CI verification: 0 framework leaks in `packages/domain` & `packages/db` | PR #322 (Current) |

---

## 3. Boundary & Invariant Audit

### 3.1 Zero Framework Leaks
Automated via `scripts/check-domain-imports.mjs` connected to `npm run check:project-docs`:
- `next/*` imports in domain/db: **0**
- `react` / `react-dom` imports in domain/db: **0**
- `hono` imports in domain/db: **0**
- `astro` imports in domain/db: **0**
- `server-only` imports in domain/db: **0**
- Legacy `src/**` or `@/*` alias imports in domain/db: **0**

### 3.2 Database Schema Invariance (Zero DDL)
Verified via `npm run check:db-schema`:
- Total migrations: **31** (unaltered)
- Total tables: **46** (unaltered)
- Total columns: **474** (unaltered)
- Total indexes: **114** (unaltered)
- Total foreign keys: **52** (unaltered)
- Total check constraints: **43** (unaltered)
- Drizzle dry-run DDL diff: **0 bytes**

### 3.3 Domain Invariants Preserved
1. **Event Owner Safety**: `event_staff.permission_preset = 'owner'` logic prevents removing or demoting the last operable owner.
2. **Auth User vs Active X Identity**:
   - `approved_by_auth_user_id`, `edit_granted_by_auth_user_id`, session user IDs, and audit log `actor_user_id` remain strictly typed as Auth User.
   - Public display, curation, and authoring metadata resolve to Active X identity snapshots.
3. **Audit Log Atomicity**: Strict CAS and atomic mutation outbox generation logic remains isolated from framework transport layers.

---

## 4. Test Suite & Quality Verification

| Verification Suite | Target | Result | Notes |
| :--- | :--- | :--- | :--- |
| `npm run typecheck` | Whole repository | **PASS** | TypeScript compile clean |
| `npm run test:unit` | Unit test suites | **PASS** | 0 regressions |
| `npm run test:integration` | Integration contracts | **PASS** | 0 regressions |
| `npm run check:db-schema` | D1 schema integrity | **PASS** | 46 tables / 474 columns exact match |
| `node --test scripts/check-domain-imports.test.mjs` | Import boundary checker | **PASS** | 3/3 tests pass (detects next, react, etc.) |
| `npm run check:project-docs` | Docs, links, schema, domain imports | **PASS** | All checkers pass |

---

## 5. Gate Acceptance Checklist

- [x] All 7 implementation tasks (MIG-0301 through MIG-0306, and MIG-0308) complete.
- [x] `@flamenode/db` cleanly extracted with zero DDL diff.
- [x] `@flamenode/domain` contains pure business logic and 0 framework dependencies.
- [x] `scripts/check-domain-imports.mjs` actively verified in CI.
- [x] Global invariants (last-owner error, auth user identity, fail-closed security) preserved.
- [ ] **Human Sign-off**: Phase 3 Acceptance Gate approved by lead engineer.
