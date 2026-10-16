# Auth Baseline Fixtures & Characterization Specifications (MIG-0801)

> Status: CURRENT_VERIFIED / CHARACTERIZED
> Work Order: `MIG-0801` in `PHASE_8_9_SPEC.md`
> Tests: `src/lib/auth/authBaseline.characterization.test.mjs` (5 PASS)
> Fixtures: `src/lib/auth/authBaseline.fixture.mjs`

---

## 1. Overview & Security Invariants

MIG-0801 establishes characterization tests and synthetic fixtures for FlameNode's Auth.js contracts prior to Web Standard Auth migration (MIG-0802).
It enforces strict invariants:
- **Zero production secrets**: Fixtures contain only deterministic synthetic tokens (`synthetic_sess_token_*`).
- **OAuth token strip**: OAuth `access_token`, `refresh_token`, and `id_token` are deliberately discarded (`null`) and never persisted to the database.
- **Fail-closed origin & redirect**: Authentication URLs and callback redirects enforce same-origin matching; invalid, cross-origin, or malformed redirects fall back to `${authOrigin}/dashboard`.

---

## 2. Cookie Contract Baseline

Auth.js v5 cookie conventions are characterized across runtime environments:

| Environment | Cookie Name | HTTPOnly | SameSite | Secure | Path |
|---|---|:---:|:---:|:---:|:---:|
| **Production (HTTPS)** | `__Secure-authjs.session-token` | `true` | `lax` | `true` | `/` |
| **Production (HTTPS)** | `__Secure-authjs.callback-url` | `true` | `lax` | `true` | `/` |
| **Production (HTTPS)** | `__Host-authjs.csrf-token` | `true` | `lax` | `true` | `/` |
| **Development (HTTP)** | `authjs.session-token` | `true` | `lax` | `false` | `/` |
| **Development (HTTP)** | `authjs.callback-url` | `true` | `lax` | `false` | `/` |
| **Development (HTTP)** | `authjs.csrf-token` | `true` | `lax` | `false` | `/` |

---

## 3. Session Resolution Characterization

The database session strategy (`session: { strategy: "database" }`) in `src/lib/auth/index.ts` governs session validity:
1. **Valid Active Session**: Token exists in `sessions` table and `expires > Date.now()`. User is loaded from `users` table.
2. **Expired Session**: `expires <= Date.now()` evaluates as unauthenticated/signed-out immediately.
3. **Missing / Revoked Session**: Non-existent session token evaluates as signed-out without fallback.
4. **Missing User in Database**: If session token exists but user row in D1 is deleted/missing (`loaded.kind === 'missing'`), the system returns `{ user: null, linkedXUsers: [] }` and never falls back to stale session claims.
5. **Banned User**: `user.is_banned === 1` blocks operational routes via `routeGuard` / `requireRouteUser`.

---

## 4. Discord Account Linking Atomicity (`linkDiscordAccountAtomically`)

Canonical account linking invariants in `src/lib/auth/accountLinkAdapter.ts`:
- **Provider Restriction**: Only `provider === "discord"` is accepted (`AUTH_UNSUPPORTED_ACCOUNT_PROVIDER`).
- **Provider Account Conflict**: Linking a Discord account already owned by another user throws `AUTH_DISCORD_ID_CONFLICT`.
- **User Discord ID Conflict**: Attempting to link when another user already holds the same `discord_id` throws `AUTH_DISCORD_ID_CONFLICT`.
- **Token Discarding**: `accountRowWithoutTokens` guarantees that OAuth tokens are set to `null` before inserting into D1 `accounts`.
- **Audit & Notification**: Atomic link operation registers an audit log mutation and queues first-link welcome notifications post-commit.
