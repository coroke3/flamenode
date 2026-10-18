# Phase 3 Gate (MIG-0307): evidence and open criteria

> Status: REVIEW (evidence only). **Phase 3 Gate is NOT met.** Gate approval is a human decision; no agent may approve it.
> Last verified: 2026-10-18, on `main` 8211de6 plus the open PRs #318 / #319 / #320 / #322 at their review-fix heads
> Work Order: [`PHASE_3_SPEC.md`](../PHASE_3_SPEC.md) §MIG-0307. Merged task state: [`STATUS.md`](../STATUS.md)

This file replaces an earlier draft that described MIG-0301..0306 as complete. That was wrong: MIG-0304/0305/0306 have only part of U01 implemented. The earlier draft also described MIG-0304 as "chapters, overlays, metadata" and MIG-0305 as "double reservation protection", and neither of those was implemented.

## 1. Task inventory

| Task | Merged state on `main` | What actually exists | Remaining before DONE |
| --- | --- | --- | --- |
| MIG-0301 extraction/DI pattern | DONE (#304) | bridge pattern PoC | — (but see §3: `packages/domain/src/permissions.ts` placeholder `canEditVideo` is still present) |
| MIG-0302 low-risk read domain | DONE (#308) | slots limits / reservationLimit, software labels | — |
| MIG-0308 `packages/db` schema | DONE (#315, 541f65a) | `@flamenode/db` schema, zero DDL | — |
| MIG-0303 low-risk mutation domain | DONE (#316, 8211de6) | announcements, apiEndpoints, eventTemplates, datetime | — |
| MIG-0304 video domain | READY (PR #318 open) | U01 only: `packages/domain/src/video/{ownership,editSections,generalEditPermissions}.ts`, `packages/domain/src/auth/permissions/{keys,aliases}.ts` + legacy bridges | U02 video visibility (Tier 2), U03 edit/member/chapter, U04 submission/interactions, Final audit, API_MATRIX SA-001..003/012..015/040..042/082..089 |
| MIG-0305 event/slot domain | READY (PR #319 open) | U01 partial: `packages/domain/src/event/ownership.ts` (+ shared `xid/format.ts`) + bridge | U01 DB race test (owner>=1), U02 event visibility (Tier 2), U03 slot reservation SA-056..068 (`+packages/domain/src/slots/*.ts`), U04 SA-021..034/038..039, Final audit, API_MATRIX |
| MIG-0306 user/X/admin domain | READY (PR #320 open) | U01 partial: `packages/domain/src/xid/*`, `admin/{costGuard,writeIdentity}.ts`, `user/index.ts` + bridges | U01 remainder, U02 X merge/revert (`src/lib/xid/merge.ts`, `mergeSafety.ts`, `mergeBudget.ts`, Tier 2), U03 SA-016..020/043..055, U04 SA-069..081/090..106, Final audit, action files switched to domain calls, `permissions.ts` replace-or-retire, API_MATRIX |
| MIG-0307 Phase 3 Gate | BLOCKED | this PR #322: `scripts/check-domain-imports.mjs` checker + this evidence | everything in §2 |

## 2. Gate criteria (PHASE_3_SPEC §MIG-0307)

| # | Criterion | Status | Evidence |
| --- | --- | --- | --- |
| DONE-1 | Forbidden-import checker runs in CI | MET (once #322 merges) | `scripts/check-domain-imports.mjs` is wired into `npm run check:project-docs`, which runs in the `migration-contract` job. It uses the TypeScript scanner, so multi-line, `import type`, re-export, dynamic `import()` and `require()` are all covered, and comments and strings are ignored. The earlier per-line regex missed multi-line imports (reported in the CHANGES_REQUESTED review on #322). |
| U01 / T01 | A fixture with `import "next/navigation"` fails | MET | `scripts/check-domain-imports.test.mjs` has 4 tests, including a multi-line, type-only, re-export, dynamic and relative-legacy fixture |
| DONE-2 | MIG-0308 DONE | MET | STATUS.md, #315 |
| Depends on | MIG-0304, MIG-0305, MIG-0306 DONE | **NOT MET** | §1: only U01 (partial) exists; STATUS shows READY |
| T02 | `test:unit` / `test:integration` counts ≥ the Phase 3 start, with 0 tests deleted | MET for the current heads | Phase 3 start `fe211b2` (parent of MIG-0301): `test:unit` 2514 pass / 0 fail, `test:integration` 55/55. #320 head: `test:unit` 2530/0. #322 head (stacked on #320): `test:unit` 2534/0 (the 4 extra are the checker tests), `test:integration` 55/55. #318 head: 2531/0. #319 head: 2533/0. |
| T03 | Tier 2 not left BLOCKED/SKIPPED | **NOT MET** | No Tier 2 extraction (video/event/X-user visibility transitions, `computeEditSections.ts`, X merge) has started. MIG-0308 is DONE, so it is no longer blocked, but it is not done. The only exception is an explicit user approval plus a named alternative task. |
| §3 source | `permissions.ts` placeholder `canEditVideo` neutralised | **NOT MET** | Still exported from `@flamenode/domain` with OR semantics and no caller. MIG-0306 owns the replace-or-retire decision; retiring it needs `APPROVAL=`. |
| DONE-3 | Independent review APPROVE + human Phase Gate approval on the PR | **NOT MET** | Antigravity's "APPROVE" on #322 is a builder self-review, so it does not count under AGENT_PROTOCOL. The GPT review on #322 was CHANGES_REQUESTED (now addressed). The "independent review APPROVE posted" claims on #318 and #319 have no review comment behind them. New pushes require a fresh independent review on the final heads. |

Other checks on the #322 head: `npm run check:db-schema` OK (31 migrations, 46 tables, 474 columns, 114 indexes, 52 FKs, 43 checks); `npm run check:project-docs` OK; `npm run typecheck` OK.

## 3. Decisions for the human owner

1. **Merge #318/#319/#320 as partial U01 steps, or require U02..U04 first?** Merging them as partial steps is safe for behaviour: the bridges are re-export only, behaviour is unchanged, and the tests prove identity. But the MIGs must stay IN_PROGRESS, not DONE.
2. **Tier 2 (T03):** schedule the Tier 2 extraction now that MIG-0308 is DONE, or approve an explicit exception that names the alternative task(s).
3. **`packages/domain/src/permissions.ts`:** replace it with the real policy (MIG-0306), or retire it (`APPROVAL=` required).
4. **Phase 3 Gate:** it can be approved only after 1–3 are resolved and MIG-0304/0305/0306 are DONE with independent reviews.
