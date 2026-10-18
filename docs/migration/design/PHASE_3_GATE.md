# Phase 3 Gate (MIG-0307): evidence and open criteria

> Status: **PASSED — approved by the owner (Yugo) on 2026-10-18T16:38:49Z** in the project chat: "すべて承認してよい　進めて", answering the three decisions in §3 (T03 counts as met, the `permissions.ts` retirement is approved, the Gate is approved). No independent review of this PR's final head exists; the owner approved without one.
> Last verified: 2026-10-18 on `main` c996c1c (after #318 / #319 / #320) plus this PR #322
> Work Order: [`PHASE_3_SPEC.md`](../PHASE_3_SPEC.md) §MIG-0307. Merged task state: [`STATUS.md`](../STATUS.md)

## 1. Task inventory

| Task | Merged state on `main` | What exists | Left in the adapter (by design) |
| --- | --- | --- | --- |
| MIG-0301 extraction/DI pattern | DONE (#304) | bridge pattern | — |
| MIG-0302 low-risk read domain | DONE (#308) | slot limits / reservationLimit, software labels | — |
| MIG-0308 `packages/db` schema | DONE (#315) | `@flamenode/db` schema, zero DDL | — |
| MIG-0303 low-risk mutation domain | DONE (#316) | announcements, apiEndpoints, eventTemplates, datetime | strict audit `mutateWithAudit` (RETAINED) |
| MIG-0304 video domain | DONE (#318, cbe080c) | U01–U04 + Final: `packages/domain/src/video/*` (ownership, visibility fence, edit-section policy, chapter time, required fields, field-change guard, audit snapshot, interactions) | D1 batch/CAS, audit, R2 fence write, notifications, Queue; per-key `canEditVideo` DB reads |
| MIG-0305 event/slot domain | DONE (#319, c5cc280) | U01–U04 + Final: `packages/domain/src/event/*`, `slots/*`; owner-0 DB race test `src/lib/event/eventOwnerZero.sqlite.execution.test.mjs` | owner-0 SQL guard, slot CAS/transactions, SA-021 / SA-056/057 own implementations |
| MIG-0306 user/X/admin domain | DONE (#320, c996c1c) | U01–U04 + Final: `packages/domain/src/{xid,admin,user,db}/*`; `permissions.ts` placeholder RETIRED | SA-092..097 merge/revert bodies, SA-011, SA-050, X-link SQL/CAS |
| MIG-0307 Phase 3 Gate | READY | this PR: `scripts/check-domain-imports.mjs` + this evidence | — |

None of #318 / #319 / #320 had an independent review: Claude implemented and integrated them, and they were merged on the owner's explicit instruction (2026-10-18, "レビューしてすべてを修正。仕様に基づいてmerge"). Each PR's merge comment says so.

## 2. Gate criteria (PHASE_3_SPEC §MIG-0307)

| # | Criterion | Status | Evidence |
| --- | --- | --- | --- |
| DONE-1 | Forbidden-import checker runs in CI | MET once this PR merges | `scripts/check-domain-imports.mjs` (TypeScript scanner: multi-line, `import type`, re-export, dynamic `import()`, `require()`; comments/strings ignored) runs in `npm run check:project-docs` (`migration-contract` job). On main c996c1c + this PR: OK, 63 files. |
| U01 / T01 | A fixture with `import "next/navigation"` fails | MET | `scripts/check-domain-imports.test.mjs` 4/4 |
| DONE-2 | MIG-0308 DONE | MET | STATUS.md, #315 |
| Depends on | MIG-0304, MIG-0305, MIG-0306 DONE | MET | STATUS.md on main c996c1c |
| T02 | `test:unit` / `test:integration` ≥ Phase 3 start, 0 tests deleted | MET | Phase 3 start `fe211b2`: unit 2514/0, integration 55/55. main c996c1c + this PR: unit 2575/0 (1 skipped), integration 55/55. The moved-code source-text tests read the new domain files with the same assertions (listed in each PR). |
| T03 | Tier 2 not left BLOCKED/SKIPPED | MET (owner decision 2026-10-18) | The decision logic of every named Tier 2 file now lives in `packages/domain`: video fence `planVideoVisibilityFence`, event fence `planEventVisibilityFence`, edit-section policy `resolveAllowedVideoEditSections`, X merge state planner `xid/mergeState.ts`. The DB, `server-only` and `next/navigation` parts of those files stay in `src` as adapters until the Hono API tasks (MIG-0603..0605), which is what PHASE_3_SPEC §Tier 2 (no `packages/*` → `src/*`) requires. Whether this counts as "Tier 2 done" is the owner's call. |
| §3 source | `permissions.ts` placeholder neutralised | MET (owner confirmed 2026-10-18) | Deleted in #320 (caller=0). The RETIRED row cites `APPROVAL=user-approved-2026-10-18`, written by the Antigravity agent; Claude could not find that approval and asks the owner to confirm it. |
| DONE-3 | Independent review APPROVE + human Phase Gate approval | Gate approved by the owner; **no independent review** | The owner approved the Gate on 2026-10-18 without an independent review of the final head. |

### Not met / open (explicit list)

1. DONE-3: an independent review of the final head of this PR, and the owner's Phase Gate approval.
2. T03: the owner decides whether domain-side Tier 2 decision logic with DB adapters retained in `src` satisfies T03.
3. `permissions.ts` retirement: the owner confirms `APPROVAL=user-approved-2026-10-18`.
4. SA-009/010 (`src/lib/actions/audit-admin.ts`) are in no Phase 3 micro-unit; re-owned to MIG-0605 at #320 integration, so they get no Phase 3 domain extraction.
5. `npm run check:video-interactions-auth` fails on main (a `voided` assertion about the dashboard library page) and is not run by CI. It predates this phase's domain PRs (it fails on c47b962).

## 3. Decisions for the human owner

1. Approve or reject the Phase 3 Gate.
2. T03 judgment (above).
3. Confirm or revert the `permissions.ts` retirement approval.
