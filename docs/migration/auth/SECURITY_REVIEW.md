# Phase 8 security review: Hono authentication boundaries

> **§1 Owner:** MIG-0807 — existing Hono session / Origin / write / CostGuard / admin-read guards. **§2 reserved:** MIG-0804 (future Auth.js implementation and OAuth/session cutover).
>
> Scope: read-only inspection and regression tests against current `main`. This document does **not** authorize changing existing security code, authentication traffic, cookies, D1, Cloudflare Routes, or production settings. A finding that requires a code change blocks MIG-0807 and must be fixed in a separate, independently reviewed task.

## §1. Existing Hono session and write-guard security (MIG-0807)

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
| T03 D1 outage / CostGuard fail-closed and zero mutation | `session.ts:SessionUnavailableError` and `sessionMiddleware`; `writeOrigin.ts:evaluateAdminWriteGuard`; `costGuard.ts:evaluateCostGuardWithSettings` | `authSession.unavailable.test.mjs` C-1/C-2; `writeGuard.test.mjs` TOS and missing DB; **new** `securityReview.test.mjs` CostGuard D1 throw/missing row (503, 0 downstream writes) | **PROBLEM SEC-0807-01:** asynchronous D1 errors and missing settings are denied; synchronous DB-binding getter errors escape all three shared guards before their 503 mapping |
| Admin read role and BAN | `adminReadGuard.ts:adminReadGuardMiddleware` checks unavailable → unauthorized → banned → admin | `adminGuards.test.mjs` `default read guard` matrix (401/403/503, no-store) | Covered; non-admin and banned users cannot read admin data |
| Private / no-store authorization and denial | `session.ts:PRIVATE_NO_STORE`, `writeOrigin.ts:writeGuardDenyResponse`, `adminReadGuard.ts:deny` | `authSession.unavailable.test.mjs` C-2, `writeGuard.test.mjs` deny cases, `adminGuards.test.mjs` admin read status | Covered; authenticated and denial responses are not shared-cacheable |

**Audit verdict: STOP / CHANGES_REQUESTED — SEC-0807-01.** The security review identified one cross-cutting failure-mode defect. This is a source/test audit, not a penetration test, and does not validate Auth.js OAuth or production cutover.

### SEC-0807-01 — DB binding getter escapes the shared Hono guards (blocking)

**Source:** `apps/api/src/auth/session.ts:sessionMiddleware` reads `c.env?.DB` outside its D1 resolution catch; `apps/api/src/middleware/writeOrigin.ts:writeGuardMiddleware` reads `c.env.DB` outside the `evaluateAdminWriteGuard` error mapping; `apps/api/src/middleware/costGuard.ts:costGuardMiddleware` reads `c.env.DB` before calling the caught `evaluateCostGuardWithSettings` function.

**Reproducer:** `apps/api/test/securityReview.test.mjs` test `MIG-0807 U03 finding: a throwing D1 binding getter escapes shared guards`. A deliberately throwing `DB` property accessor causes all three middleware functions to reject with the provider error, rather than returning the expected private 503 response. No downstream mutation occurs in this isolated reproduction, but an unhandled Hono exception can surface as a generic 500 and provider error details can propagate to host logging.

**Risk and boundary:** Unhandled infrastructure exceptions violate the fail-closed *response contract* (503/no-store), with potential sensitive exception metadata exposure in logs. This does not demonstrate unauthorized data access, a production incident, or that a Cloudflare binding getter normally throws. Existing asynchronous `D1.first()` failure cases still fail closed correctly, as existing tests verify.

**Required follow-up:** an independently owned, narrowly scoped repair task must wrap binding acquisition inside each shared guard's fixed-code 503 handling, preserve Origin-before-D1, unauthenticated/ban/role ordering, and no-write invariants; add negative tests that assert private 503 and no provider detail leakage. **MIG-0807 must not modify security runtime code** under its Work Order. Do not mark this audit DONE or merge it as an all-clear review until the defect is addressed and independently approved; report it to the Lead.

**Remaining validation:** verify this characterization test and the rest of the suite pass on the exact PR HEAD; a passing test *documents the defect*, not its repair.

**Remaining acceptance gate:** the new regression suite, existing API tests and migration doc checks must pass on the exact PR HEAD; an independent reviewer (separate agent or human per AGENT_PROTOCOL) must inspect the current code and approve this precise HEAD. Until then the task is REVIEW, not DONE. No production operations are performed.

**Rollback:** revert this documentation/test-only PR. Current session, Origin, CostGuard and admin-read implementations remain unchanged by this task.

## §2. Future Auth.js implementation and cutover (MIG-0804)

Reserved for MIG-0804 after its own prerequisite and independent review. Nothing in §1 asserts that OAuth, callback, PKCE, account linking, or production Auth.js routing has been validated or cut over.
