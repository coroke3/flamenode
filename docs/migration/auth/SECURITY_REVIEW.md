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

## §2. Unmounted Auth.js/OAuth security review (MIG-0804 U02 & U01)

> **Status (2026-11-21): U02 Security PASS (pending independent review) / U01 CPU IN_PROGRESS (D1 query counts verified; Linux `workerd` / non-prod `wrangler tail` CPU confirmation still required).** This audit applies only to the *unmounted* `apps/api/src/auth/authjs.ts`, synthetic `apps/api/src/routes/auth.ts`, and synthetic `apps/api/src/routes/authComplete.ts` integrated against `main` (`0c34ec94c`, incl. PR `#695`). It does **not** authorize mounting Auth.js in `apps/api/src/app.ts`, enabling production OAuth traffic, changing Cloudflare Routes, or modifying secrets (all strictly scoped to `MIG-0805`).

| Security boundary | Source of truth | Existing evidence / added check | U02 assessment |
| --- | --- | --- | --- |
| Session cookie tamper, expiry, deletion and current user claims | `apps/api/src/auth/authjs.ts:636-693`; shared `applyDatabaseAuthSessionClaims` in `packages/server-core/src/auth/config.ts` | `apps/api/test/authjsCrossRuntime.test.mjs`: valid/unknown/expired/deleted/banned session and both directions of session-cookie renewal (U01, U02a). `apps/api/test/authAccountLink.parity.test.mjs` tests user/account parity. | Baseline parity covered in synthetic SQLite; **BAN is present in session data, not an Auth.js login denial**, so private route write authorization still depends on the §1 Hono writeGuard |
| CSRF and signout integrity | `apps/api/src/routes/auth.ts`: only POST signout; `@auth/core` native form token/cookie validation | `authjsCrossRuntime.test.mjs` U02b: invalid form token, absent CSRF cookie and cross-runtime CSRF token exchange. Tests check that a denial does **not** delete the D1 session. | Synthetic route contract covered; no production signout cutover |
| OAuth callback/PKCE and Discord identity collision | `authjs.ts:463-599` atomic `linkDiscordAccountAtomically`, `accountRowWithoutTokens`; `routes/auth.ts` allowlist | `authAccountLink.parity.test.mjs`: mock Discord authorize/code exchange, PKCE, reused code, cross-account hijack denial, audit/outbox, no bearer/refresh/id token persistence. `authjsCrossRuntime.test.mjs`: GET/POST signin/callback return 404 from the *unmounted* Hono test router. | Mock parity covered; **full production signin/callback is intentionally unavailable** pending MIG-0805 and owner approval |
| Untrusted redirect/Host and configured origin | `apps/api/src/auth/authjs.ts:108-132,636-686`; `packages/server-core/src/auth/redirect.ts` | `authjsCrossRuntime.test.mjs` configured HTTPS/credentials and origin mismatch checks; `authjsSecurityReview.test.mjs` U02 T01 direct callback cross-host/protocol-relative/`javascript:`/`data:` checks and T02 spoofed `Host`/`X-Forwarded-Host` negative check. | **U02 T01 & T02 PASS**: explicit configured origin is never derived from request `Host`; redirect callback never authorizes a foreign origin |
| Auth/DB outage fail-closed, cache and secret disclosure | `apps/api/src/routes/auth.ts:51-133` (`monitorSessionAdapterFailures` + `databaseSessionUnavailableResponse`); `authjs.ts:98-106` redacts logger error detail | `authjsCrossRuntime.test.mjs` checks missing DB/config/secret responds 503. `authjsSecurityReview.test.mjs` U02 T03 (`D1.prepare()` runtime exception → `503` `private, no-store`, no provider sentinel). `authProviderFailures.test.mjs` (`#695`, 6/6 PASS: prepare/read/update/delete failures, concurrent request isolation, D1 session retention). | **U02 T03 PASS (remediated by PR `#695`, Issue `#694` resolved)** in unmounted `routes/auth.ts`. *Note for `MIG-0805`:* `apps/api/src/routes/authComplete.ts` (`MIG-0802`) calls `invokeUnmountedAuth` directly without `monitorSessionAdapterFailures`, so cutover wiring must share the adapter-failure guard on `/auth/complete` as well. |
| CPU / D1 query budget (U01) | `PHASE_8_9_SPEC.md` MIG-0804 U01; `ZERO_1102.md` §3 & §5 | Deterministic per-request D1 statement counts locked in `authjsSecurityReview.test.mjs` (`MIG-0804 U01`). Local Windows `workerd` (`wrangler dev --local` 4.118.0, `win32/x64`) + Node `inproc` measurements recorded below. | **D1 counts measured; CPU IN_PROGRESS / INCONCLUSIVE on Windows host** (`BASELINE` max `19.70–21.71ms` noise floor and warm Auth.js `p50` `12.30–18.61ms` require quiet Linux `workerd` or non-prod `wrangler tail` `cpuTime` verification). |

### U01 D1 query count & non-production local CPU measurements (2026-11-21)

#### 1. Per-request D1 statement counts (`authjsSecurityReview.test.mjs` U01, deterministic local SQLite)

| Path / input condition | HTTP status | D1 statements | SQL operations | Notes |
| --- | ---: | ---: | --- | --- |
| `GET /api/auth/session` (no cookie) | 200 | 0 | — | Short-circuits before D1 |
| `GET /api/auth/session` (unknown token) | 200 | 1 | `SELECT` | Joins `session` + `user` |
| `GET /api/auth/session` (valid fresh session, >29d remaining) | 200 | 1 | `SELECT` | Matches `S4` 1-read budget |
| `GET /api/auth/session` (valid near-expiry <=29d, sliding renewal) | 200 | 2 | `SELECT`, `UPDATE` | Extends `session.expires` |
| `GET /api/auth/session` (expired cookie) | 200 | 2 | `SELECT`, `DELETE` | Reads then deletes expired session |
| `GET /api/auth/csrf` | 200 | 0 | — | Cookie + WebCrypto token only |
| `POST /api/auth/signout` (invalid CSRF + session cookie) | 302 | 0 | — | Fails CSRF validation before D1 |
| `POST /api/auth/signout` (valid CSRF + session cookie) | 302 | 1 | `DELETE` | Deletes `session` row |
| `GET /auth/complete` (valid fresh session) | 303 | 1 | `SELECT` | 2 (`SELECT`, `UPDATE`) if sliding renewal triggers |
| `GET /auth/complete` (missing/unknown cookie, 4 retries) | 303 | 4 | `SELECT` × 4 | Retry sequence `[80, 160, 320]` ms |
| Reference: `S4 sessionMiddleware` (`apps/api/src/auth/session.ts`) | 200 | 1 | `SELECT` | Read-only middleware (`0` writes) |

#### 2. Non-production local `workerd` probe (Windows 11 x64 — NOT a production value or final `ZERO_1102` pass)

- **Environment & method:** `wrangler 4.118.0` (`wrangler dev --local`, `win32/x64`, Node `v22.23.2`), V8 inspector `Profiler.start/stop` (`100µs` sampling interval, non-idle sample deltas) with `--d1 replay` (D1 results recorded from `node:sqlite`, replayed in `workerd` without local D1 simulator overhead), `50` warm samples (`10` warmup discarded) + `10` cold isolate reloads, `0` unexpected HTTP statuses.
- **Why Windows `workerd` is inconclusive for `ZERO_1102.md` §3 budgets (`S4 <= 2ms`, `S2 < 7ms`, `S3 < 8ms`):**
  1. `wrangler dev --local` observability spans report `cpu_time_ms = 0` on local runs (`API_CPU_BENCHMARK.md` §4).
  2. The V8 sampling profiler on this Windows host exhibits a high noise floor (`BASELINE` zero-work route max **`19.70ms`** in the Auth.js run and **`21.71ms`** in `scripts/benchmark-api-cpu.mjs --mode wrangler --only S4 --samples 10 --cold-samples 5`; max single non-idle sample delta `100.94ms`).
  3. Even on warm `p50` (where `BASELINE` is `0.00ms`), Auth.js endpoints measured `12.30–18.61ms` in this Windows `workerd` probe (and `1.73–7.58ms` in a separate `50`-sample Node `inproc` wall-time proxy: `AUTH-SESSION-VALID-FRESH` `p50 7.34ms / max 50.77ms`, `AUTH-SESSION-UNKNOWN` `p50 7.58ms / max 22.73ms`, `AUTH-CSRF` `p50 2.00ms / max 9.66ms`, `AUTH-SIGNOUT-BAD-CSRF` `p50 1.73ms / max 8.10ms`, `AUTH-COMPLETE-VALID` `p50 2.19ms / max 8.92ms`). `buildUnmountedAuthConfig` currently builds `drizzle(input.d1, { schema })` + `DrizzleAdapter` + `Discord(...)` per request.

| Scenario (`--d1 replay`, local Windows `workerd`) | D1 stmts | Bytes | Warm `p50 / p95 / max` (ms) | Cold `p50 / max` (ms) (`n=10`) |
| --- | ---: | ---: | --- | --- |
| `BASELINE` (zero-work no-op) | 0 | 2 | `0.00 / 15.66 / 19.70` | `0.00 / 14.01` |
| `GET /api/auth/session` (valid, 29d sliding) | 2 | 513 | `12.30 / 28.38 / 44.52` | `28.79 / 79.05` |
| `GET /api/auth/session` (valid, 2d sliding) | 2 | 513 | `18.03 / 24.04 / 24.65` | `26.10 / 58.39` |
| `GET /api/auth/session` (unknown token) | 1 | 4 | `14.96 / 47.37 / 59.77` | `16.37 / 65.03` |
| `GET /api/auth/csrf` | 0 | 80 | `14.83 / 41.42 / 110.10` | `13.08 / 34.31` |
| `POST /api/auth/signout` (valid CSRF) | 1 | 0 | `18.61 / 32.13 / 101.75` | `16.31 / 40.97` |
| `POST /api/auth/signout` (invalid CSRF) | 0 | 0 | `18.53 / 32.94 / 107.71` | `25.38 / 45.58` |
| `GET /auth/complete` (valid, 29d sliding) | 2 | 0 | `17.20 / 26.97 / 86.71` | `27.65 / 57.17` |

**Remaining U01 & MIG-0804 acceptance gate:**
- U01 requires a quiet Linux `workerd` measurement or deployed non-production Worker `wrangler tail` `cpuTime` check (`ZERO_1102.md` §5) to confirm whether per-request `drizzle(d1, { schema })` / `@auth/core` initialization fits within `ZERO_1102.md` §3 budgets (or needs lightweight schema/per-request optimization before `MIG-0805` cutover).
- U02 requires independent security review of this PR HEAD (`authjsSecurityReview.test.mjs`, `authProviderFailures.test.mjs`, `routes/auth.ts` integration) and green exact-HEAD CI (`migration-contract` + `migration-workspaces`). No `STATUS.md` `DONE` change, Auth.js route mount, production OAuth configuration, remote D1, R2, Worker Routes or secrets action is authorized.

### 2026-11-20 — U02 T03 confirmed FAIL (historical pre-fix; remediated by PR #695)

CI [#44657912902](https://github.com/coroke3/flamenode/actions/runs/44657912902) (pre-#695) compiled the target API and executed `apps/api/test/authjsSecurityReview.test.mjs` with `T01 PASS`, `T02 PASS`, `T03 FAIL`: `actual 200 !== expected 503` when `D1.prepare()` threw for a valid session (Issue [#694](https://github.com/coroke3/flamenode/issues/694)).

### 2026-11-21 — SEC-0804-01 remediated (`#695`) + U01 D1/Windows-workerd baseline

Merged `origin/main` (`0c34ec94c`, PR `#695`) into PR `#693`. Re-ran `authjsSecurityReview.test.mjs` (`T01`, `T02`, `T03`, and new `U01` D1 query-count test: `4/4 PASS`) and `authProviderFailures.test.mjs` (`6/6 PASS`). Executed U01 D1 statement-count and local Windows `workerd` probes (inconclusive noise floor `19.70–21.71ms`; Linux `workerd` / non-prod `wrangler tail` CPU confirmation still required before U01 `DONE`).
