# Phase 8 security review: Hono authentication boundaries

> **§1 Owner:** MIG-0807 — existing Hono session / Origin / write / CostGuard / admin-read guards. **§2 reserved:** MIG-0804 (future Auth.js implementation and OAuth/session cutover).
>
> Scope: read-only inspection and regression tests against current `main`. This document does **not** authorize changing existing security code, authentication traffic, cookies, D1, Cloudflare Routes, or production settings. A finding that requires a code change blocks MIG-0807 and must be fixed in a separate, independently reviewed task.

## §1. Existing Hono session and write-guard security (MIG-0807)

**Current integration checkpoint (2026-10-30):** The SEC-0807-01 fix was independently integrated as merged PR #445 into `main` (squash `ee6a6dce98961ede46dda33470eebc05f4c14496`). PR #444 now targets `main`; its latest source tests assert fixed **503 / private, no-store / no provider error disclosure / no writes** rather than the original throwing-getter behavior. The STOP/finding details below are preserved as **historical pre-fix audit evidence**, not as a claim that the defect remains in current `main`. **Present verdict: remediation merged; final independent security review and integration CI are still required before MIG-0807 is DONE or merge-authorized.** See task checkpoint `docs/migration/work-items/MIG-0807.md`.


Source baseline: `apps/api/src/auth/session.ts`, `apps/api/src/middleware/{writeOrigin,adminReadGuard,costGuard}.ts`, `apps/api/src/routes/admin/index.ts`. Legacy behavioral comparison: `src/lib/auth/routeGuard.ts`, `src/lib/auth/origin.ts` and current `writeGuard`. Work Order: `docs/migration/PHASE_8_9_SPEC.md` MIG-0807; decision D-16-14. No independent review has yet approved this checkpoint.

| Check | Code boundary | Reproduction / existing contract test | Audit assessment |
| --- | --- | --- | --- |
| T01 Tampered / forged session cookie | `session.ts:extractSessionToken` and `resolveSessionUser` query `session.sessionToken = ?`; cookie is an opaque database lookup key, **not** a signed authorization claim | `apps/api/test/authSession.test.mjs` T04; `authSession.parity.test.mjs` T04; `authSession.test.mjs` T02 non-existing session | Covered; a forged token has no matching D1 session and cannot authenticate |
| Expired session | `session.ts:resolveSessionUser` compares persisted `session.expires` (epoch milliseconds) to the request clock | `authSession.test.mjs` T02 expired + deleted token | Covered; denial is unauthenticated, never stale identity |
| Cookie chunk quantity / length / header bound | `session.ts:extractSessionToken` caps matching names, chunks and joined token length | `authSession.test.mjs` `chunk count cap`, `joined token length cap`, `session-prefixed name cap`, `128KB header` | Covered; oversized input fails closed without excessive CPU |
| Secure cookie policy | `session.ts:sessionCookieName` selects `__Secure-authjs.session-token` on HTTPS, `authjs.session-token` on HTTP | `authSession.test.mjs` `https reads only...`, `http reads only...`, `authSession.parity.test.mjs` SessionStore cases | Covered; wrong-scheme cookie cannot become a session |
| T02 Cross-origin POST and missing/untrusted Origin | `writeOrigin.ts:originGuardMiddleware` before session; `checkOrigin` and `requestHasSameOrigin` | `writeGuard.test.mjs` different/missing Origin; `writeGuard.extra.test.mjs` null/path/port; `adminGuards.test.mjs` `LOW-1` zero D1 prepares | Covered; rejection precedes D1, write handler not reached |
| Non-mutating GET/HEAD/OPTIONS | `writeOrigin.ts:onlyMutating` skips safe methods for the write-only guard, `adminReadGuard.ts:onlyReads` protects admin GET/HEAD | `adminGuards.test.mjs` `write-only checks skip GET/HEAD`; **new** `securityReview.test.mjs` safe-method boundary including OPTIONS | New regression; non-mutating HTTP methods do not enter write-only middleware |
| T04 BAN and role change immediately after request | `session.ts:resolveSessionUser` joins current `user` row on every request, `requireAuth` checks `is_banned` | `authSession.test.mjs` T03; **new** `securityReview.test.mjs` same-cookie allowed → banned → role change → deleted user, four D1 reads | New regression; permission cannot be resurrected by cached cookie/session role |
| T03 D1 outage / CostGuard fail-closed and zero mutation | `session.ts:SessionUnavailableError` and `sessionMiddleware`; `writeOrigin.ts:evaluateAdminWriteGuard` / `writeGuardMiddleware`; `costGuard.ts:costGuardMiddleware` / `evaluateCostGuardWithSettings` | `authSession.unavailable.test.mjs` C-1/C-2; `writeGuard.test.mjs` TOS and missing DB; `d1BindingFailClosed.test.mjs` (#445); **new** `securityReview.test.mjs` CostGuard D1 throw/missing row (503, 0 downstream writes) and U03 throwing-getter regression | **PROBLEM SEC-0807-01 found (historical), repaired by merged #445.** Pre-fix: a synchronously throwing DB-binding getter escaped all three shared guards before their 503 mapping. Current `main`: fixed private 503, handler not reached, provider error not in body or logs |
| Admin read role and BAN | `adminReadGuard.ts:adminReadGuardMiddleware` checks unavailable → unauthorized → banned → admin | `adminGuards.test.mjs` `default read guard` matrix (401/403/503, no-store) | Covered; non-admin and banned users cannot read admin data |
| Private / no-store authorization and denial | `session.ts:PRIVATE_NO_STORE`, `writeOrigin.ts:writeGuardDenyResponse`, `adminReadGuard.ts:deny` | `authSession.unavailable.test.mjs` C-2, `writeGuard.test.mjs` deny cases, `adminGuards.test.mjs` admin read status | Covered; authenticated and denial responses are not shared-cacheable |

**Audit verdict (pre-fix, 2026-10-28, historical): STOP / CHANGES_REQUESTED — SEC-0807-01.** The security review identified one cross-cutting failure-mode defect. **Current verdict (2026-10-30, against `main` incl. #445): 0 open problems in the ten observations; SEC-0807-01 repaired outside this task (STOP honored).** This is a source/test audit, not a penetration test, and does not validate Auth.js OAuth or production cutover.

### SEC-0807-01 — DB binding getter escaped the shared Hono guards (historical; repaired by #445)

**Source:** `apps/api/src/auth/session.ts:sessionMiddleware` reads `c.env?.DB` outside its D1 resolution catch; `apps/api/src/middleware/writeOrigin.ts:writeGuardMiddleware` reads `c.env.DB` outside the `evaluateAdminWriteGuard` error mapping; `apps/api/src/middleware/costGuard.ts:costGuardMiddleware` reads `c.env.DB` before calling the caught `evaluateCostGuardWithSettings` function.

**Reproducer (pre-fix, removed after #445):** `apps/api/test/securityReview.test.mjs` test `MIG-0807 U03 finding: a throwing D1 binding getter escapes shared guards` at SHA `5085226a742864fa6d4e4344782cb832018e0c72`. A deliberately throwing `DB` property accessor causes all three middleware functions to reject with the provider error, rather than returning the expected private 503 response. No downstream mutation occurs in this isolated reproduction, but an unhandled Hono exception can surface as a generic 500 and provider error details can propagate to host logging.

**Risk and boundary:** Unhandled infrastructure exceptions violate the fail-closed *response contract* (503/no-store), with potential sensitive exception metadata exposure in logs. This does not demonstrate unauthorized data access, a production incident, or that a Cloudflare binding getter normally throws. Existing asynchronous `D1.first()` failure cases still fail closed correctly, as existing tests verify.

**Required follow-up (done: PR #445, squash `ee6a6dce98961ede46dda33470eebc05f4c14496`):** an independently owned, narrowly scoped repair task must wrap binding acquisition inside each shared guard's fixed-code 503 handling, preserve Origin-before-D1, unauthenticated/ban/role ordering, and no-write invariants; add negative tests that assert private 503 and no provider detail leakage. **MIG-0807 must not modify security runtime code** under its Work Order. Do not mark this audit DONE or merge it as an all-clear review until the defect is addressed and independently approved; report it to the Lead.

**Post-fix regression (current):** `securityReview.test.mjs` test `MIG-0807 U03: SEC-0807-01 fix converts throwing D1 getters to private fail-closed responses` asserts, for session / writeGuard / costGuard, status 503, `Cache-Control: private, no-store`, fixed reason code, handler not called, the provider sentinel absent from the body **and from console output**, and exactly one getter read. Reverting any one of the #445 changes to `session.ts`, `writeOrigin.ts` or `costGuard.ts` makes this test fail (verified locally 2026-10-30). The `db.ts` part of #445 is covered by `d1BindingFailClosed.test.mjs`, not by this task's test.

**Remaining acceptance gate:** the new regression suite, existing API tests and migration doc checks must pass on the exact PR HEAD; an independent reviewer (separate agent or human per AGENT_PROTOCOL) must inspect the current code and approve this precise HEAD. Until then the task is REVIEW, not DONE. No production operations are performed.

**Rollback:** revert this documentation/test-only PR. Current session, Origin, CostGuard and admin-read implementations remain unchanged by this task.

### 2026-10-30 remediation status (PR #445 merged → #444)

PR #445 (merged to `main` 2026-10-30, squash `ee6a6dce98961ede46dda33470eebc05f4c14496`) maps a throwing DB binding getter to a fixed private 503 in the three guards (plus `dbMiddleware`). PR #444 targets `main` and its head includes #445. The former `assert.rejects` reproducer was deleted so the suite no longer tests *for* the vulnerability. This does **not** constitute security approval of #444: an independent reviewer must still approve the exact final HEAD, and a human must authorize the merge.

## §2. Future Auth.js implementation and cutover (MIG-0804)

Reserved for MIG-0804 after its own prerequisite and independent review. Nothing in §1 asserts that OAuth, callback, PKCE, account linking, or production Auth.js routing has been validated or cut over.
