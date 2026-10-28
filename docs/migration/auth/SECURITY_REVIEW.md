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
| T03 D1 outage / CostGuard fail-closed and zero mutation | `session.ts:SessionUnavailableError` and `sessionMiddleware`; `writeOrigin.ts:evaluateAdminWriteGuard`; `costGuard.ts:evaluateCostGuardWithSettings` | `authSession.unavailable.test.mjs` C-1/C-2; `writeGuard.test.mjs` TOS and missing DB; **new** `securityReview.test.mjs` CostGuard D1 throw/missing row (503, 0 downstream writes) | New regression; database exceptions must not turn into allow |
| Admin read role and BAN | `adminReadGuard.ts:adminReadGuardMiddleware` checks unavailable → unauthorized → banned → admin | `adminGuards.test.mjs` `default read guard` matrix (401/403/503, no-store) | Covered; non-admin and banned users cannot read admin data |
| Private / no-store authorization and denial | `session.ts:PRIVATE_NO_STORE`, `writeOrigin.ts:writeGuardDenyResponse`, `adminReadGuard.ts:deny` | `authSession.unavailable.test.mjs` C-2, `writeGuard.test.mjs` deny cases, `adminGuards.test.mjs` admin read status | Covered; authenticated and denial responses are not shared-cacheable |

**Observations / code defects found:** none in the boundaries assessed above. This is a source/test audit, not a penetration test and not evidence that Auth.js login/callback has migrated. If a new regression test or independent review uncovers a defect, change this verdict to **STOP / CHANGES_REQUESTED** and open a separate repair task; do not modify the existing authentication implementation in MIG-0807.

**Remaining acceptance gate:** the new regression suite, existing API tests and migration doc checks must pass on the exact PR HEAD; an independent reviewer (separate agent or human per AGENT_PROTOCOL) must inspect the current code and approve this precise HEAD. Until then the task is REVIEW, not DONE. No production operations are performed.

**Rollback:** revert this documentation/test-only PR. Current session, Origin, CostGuard and admin-read implementations remain unchanged by this task.

## §2. Future Auth.js implementation and cutover (MIG-0804)

Reserved for MIG-0804 after its own prerequisite and independent review. Nothing in §1 asserts that OAuth, callback, PKCE, account linking, or production Auth.js routing has been validated or cut over.
