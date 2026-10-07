# FlameNode Auth / Session / Identity / Permission CURRENT Baseline

> Status: CURRENT_VERIFIED
> Verified: 2026-10-07
> Scope: Discord/Auth.js login, database sessions, account linking, current-user truth, banned/role, onboarding/terms, safe redirect, logout, account summary, Active X, event/video authorization and owner invariants
> Production mutation: none

MIG-0008で認証・identity・権限のCURRENT contractをcode/testsから固定する。Phase 8で認証基盤を置き換えるまで、production auth sourceはAuth.js + D1 adapterのまま維持する。

## Trust hierarchy

認可判定の信頼順序を以下で固定する。

1. Auth.js database session identifies the authenticated **Auth User ID**.
2. D1 `user` row is authoritative for role / banned / current persisted Active X / account state.
3. `x_user_account_links` + `x_users.approval_status = 'approved'` is authoritative for an Auth User’s usable X identities.
4. Event/video permissions are derived from canonical D1 ownership/staff rows and canonical permission keys.
5. UI/header/account-summary snapshots are display/navigation hints only and are never authorization input.

Session cookie contents, client state, route visibility, Active X display state, or a stale session role must not grant permission.

## Discord OAuth / Auth.js contract

CURRENT auth configuration:

- provider: Discord;
- session strategy: **database**;
- adapter: Drizzle/D1;
- OAuth scope: `identify email`;
- production requires `AUTH_SECRET`, Discord client ID/secret, validated `AUTH_URL`, validated `NEXT_PUBLIC_SITE_URL`;
- configured auth and site origins must be equal;
- loopback origins are rejected in production;
- Auth.js Host trust is enabled for platform routing, but redirect destination is independently restricted to the configured origin.

The provider currently enables `allowDangerousEmailAccountLinking` because partial/imported users can pre-exist by email. This must not be interpreted as “merge by email without checks”: the custom adapter link path owns the security boundary described below.

## Discord account linking safety

`linkDiscordAccountAtomically` is the canonical adapter boundary.

It guarantees:

- only provider `discord` is accepted;
- provider account ID conflict with another Auth User is rejected;
- `user.discord_id` conflict with another Auth User is rejected;
- OAuth `access_token`, `refresh_token`, and `id_token` are deliberately **not persisted**;
- account insert and `user.discord_id` CAS update are treated as one logical atomic/authenticated plan where audit is required;
- repeat callbacks are idempotent;
- if a concurrent callback wins, reread may convert the losing CAS into success only when account and user are already exactly consistent;
- first-link welcome/ops notifications are post-commit best-effort and cannot roll back a successful login/link;
- the same first link is not welcome-notified twice.

A Discord conflict is never auto-merged.

## Session restore and current-user truth

`getAuthSession` caches one Auth.js session read per Server Component request. The Auth.js session establishes Auth User ID only.

`getCurrentUserContext` then rereads authoritative D1 state:

- role;
- banned state;
- persisted Active X;
- terms acceptance/version;
- linked X rows.

Important behavior:

- Auth.js failure -> `CurrentUserUnavailableError(auth_temporarily_unavailable)`;
- D1 failure -> `CurrentUserUnavailableError(database_unavailable)`;
- neither is silently converted to “logged out”;
- a normal Auth.js result with no session is logged out;
- a stale session pointing to a deleted D1 user is treated as no current user;
- role/banned/Active X from the session are not allowed to resurrect stale D1 privileges;
- the raw session Active X is not trusted as ownership proof.

This distinction is a product contract because a temporary auth/database outage must show an unavailable/retry state rather than incorrectly removing login or privileges.

## Banned / role / write guard

All protected writes go through server-side guards or equivalent server authorization.

`writeGuard` deny order:

1. unauthenticated;
2. database unavailable;
3. banned;
4. terms not accepted;
5. terms reaccept required;
6. operation mode / CostGuard mode;
7. feature disabled;
8. role requirement;
9. operation-specific Active X requirement.

Admin does **not** bypass ban or terms. The special CostGuard-control admin path may skip CostGuard’s own mode/feature decision, but still enforces authentication, D1, ban, terms and admin role.

Malformed CostGuard feature JSON is fail-closed.

## Safe redirect / OAuth completion

Untrusted `next` accepts only same-site relative paths.

Rejected examples include:

- absolute URLs;
- `//host` protocol-relative URLs;
- backslashes;
- control characters;
- oversized paths.

OAuth callback uses `/auth/complete`, not a heavy private page, and:

- retries only the immediate session read race with delays 80/160/320ms;
- distinguishes `missing` from `unavailable`;
- sends unavailable state back as `auth_temporarily_unavailable`;
- rejects redirect loops into `/api/auth`, `/auth/complete`, `/onboarding`, and `/rules`;
- rejects banned session users;
- redirects only after authenticated resolution succeeds.

## Logout

Logout is a state-changing Auth.js POST flow, not a GET link.

The client:

1. fetches Auth.js CSRF state;
2. POSTs to Auth.js signout;
3. prevents double-submit;
4. hard-navigates to `/` only after success;
5. leaves a visible retryable error on failure.

The adapter’s `deleteSession` remains the database-session invalidation boundary and is flow-traced without exposing the session token.

## Onboarding and terms

Onboarding authorization requirements are not represented by the `onboarding_completed_at` convenience marker.

Canonical state:

- `needsTermsAcceptance = is_tos_accepted !== 1 || terms_reaccept_required === 1`;
- reserve-slot minimum = authenticated + D1 available + terms accepted;
- posting minimum = the above + an **approved Active X**;
- pending/rejected/no X remain distinct UI states.

`onboarding_completed_at` is best-effort progress metadata only and must never become an authorization flag.

Terms acceptance:

- chooses the latest published terms version (with the existing fallback-current compatibility behavior);
- records `user_tos_consents` and updates the user row atomically;
- uses expected-row CAS;
- is idempotent when already accepted;
- after a CAS race, rereads and accepts success only when the required version is already committed;
- writes long-audit records;
- navigation happens only after commit;
- `next` remains sanitized.

Current-user terms reaccept state is derived against the latest published major terms contract rather than trusting a stale stored boolean alone.

## X identity model

Auth User and X identity are separate principals.

Canonical relationship:

`user.id -> x_user_account_links -> x_users.id`

Authorization-grade X identities require:

- a link to the current Auth User;
- `x_users.approval_status = 'approved'`.

`imported`, pending, rejected or an unlinked raw X ID are not accepted for authorization.

Account-link role is `owner | manager`; event-owner operability requires at least one approved X link with `link_role = 'owner'`.

Canonical X resolution is fail-closed when alias resolution is invalid/ambiguous/colliding.

## Active X contract

Active X is the selected acting/posting identity, not a replacement for Auth User authorization.

Read resolution:

- persisted `users.active_x_user_id` is kept only if it remains linked + approved;
- if it is no longer valid, it resolves to null;
- when exactly one approved linked identity exists, read-time resolution may select it for presentation/context without granting a new link or rewriting D1;
- multiple approved identities with no valid persisted selection stay ambiguous/null.

Write switching:

- `setActiveXId` requires a linked X row;
- it must be `approved`;
- update uses expected-row CAS + audit;
- already-active is an idempotent success;
- the client rejects non-approved entries before submit;
- client performs optimistic selection but rolls back on failure;
- `beforeActiveXSwitch` may veto the switch (for example unsaved form state);
- success dispatches `ACTIVE_X_CHANGED_EVENT` and refreshes account-dependent UI.

Account summary is then revalidated; privileged details are not retained if the authoritative refresh is unavailable.

## Account summary / public header contract

`GET /api/account/summary` is private `no-store`.

Presence mode:

- no Cookie header -> proven logged out without invoking Auth.js;
- **any** Cookie header -> Auth.js must validate it; cookie content/name is never authorization;
- presence DTO includes display identity only, never role/manage permission.

Full detail mode:

- uses D1-authoritative current-user and linked-X context;
- banned users are not exposed as logged in;
- temporary auth/DB failure -> HTTP 503 + `unavailable`, not false logout;
- enrichment failure may return `degraded: true`, but uncertain manage privilege is hidden/fail-closed;
- admin/manage links in header are navigation hints, never server authorization.

## Permission key model

Canonical permission registry has event/video keys with one-way legacy aliases.

Important rules:

- unknown keys are rejected/ignored fail-closed;
- malformed custom permission JSON resolves to empty permissions;
- legacy keys canonicalize one-way to current keys;
- admin-only permission keys are filtered unless the assignment boundary explicitly allows them;
- owner preset excludes admin-only permissions;
- `public_staff` has zero internal permissions.

Admin-only keys include:

- `event.public_api`;
- `event.static_rebuild`;
- `xid.link_requests`;
- `video.primary_event`;
- `video.youtube_id`;
- `video.identity`.

`video.permissions` is dangerous but intentionally not site-admin-only because creator/event-owner workflows can manage bounded collaborator grants.

A non-admin cannot manufacture admin-only keys through `custom_permission_keys_json`.

## Event authorization

Site admin and event staff are distinct permission sources.

For non-admin event operations:

1. resolve **all approved linked X IDs** for the Auth User;
2. find event_staff rows for those identities;
3. canonicalize preset/custom permission keys;
4. require the concrete operation key.

Active X is preferred only when choosing the audit/acting X among already-authorized rows. It is **not** required to match the only authorized staff identity.

Thus changing Active X does not silently remove event permission that is held through another approved linked identity.

Site admin short-circuits event permission checks only in code paths that explicitly support admin authority.

## Event owner invariant

An operable event owner requires all of:

- `event_staff.permission_preset = 'owner'`;
- canonical X ID;
- X row approval = `approved`;
- at least one `x_user_account_links.link_role = 'owner'`.

Safety invariants:

- an event must retain at least one **operable** owner;
- pre-read validation is backed by conditional SQL/CAS so concurrent owner demotion/removal cannot remove the last owner;
- only site admin or an existing event owner may assign owner;
- ownership transfer requires a reason and `TRANSFER {eventId}` confirmation;
- self-removal/self-permission-loss requires explicit reason + confirmation;
- CSV staff import cannot add/change owners; owner transfer has a dedicated path;
- duplicate logical staff X IDs are rejected, including legacy mixed-case/@ forms;
- X-ID merge collision promotes the target staff row when necessary so owner continuity is not lost.

This invariant must survive framework/database refactoring and must not be implemented only in UI validation.

## Video ownership and editing authorization

Video ownership is not `submitted_by_user_id` and is not “current Active X”.

Normal ownership is:

- creator owner: `video.creator_x_user_id` is one of the Auth User’s approved linked X IDs; or
- collaborator owner: a `video_members.can_edit = 1` row points at one of the Auth User’s approved linked X IDs.

Privilege modes remain separate:

### normal

- requires video ownership;
- uses a bounded general-edit field policy;
- dangerous keys remain denied even if malformed/legacy policy tries to include them;
- only the **creator owner** may directly manage `video.permissions`; collaborator ownership alone cannot recursively delegate edit authority.

### event

- ownership is irrelevant;
- the Auth User must have the concrete canonical event_staff permission on one of the video’s bounded current events;
- owner/admin privilege does not implicitly fall back into event mode.

### admin

- requires site `role = admin`;
- known video edit keys are available under the explicit admin mode;
- an admin does not implicitly receive admin privilege while operating in normal/event mode.

The request-local `VideoEditAccessContext` may memoize D1-derived inputs inside one request but must never be persisted or reused as a cross-request authorization cache.

## UI/server separation

The following are explicitly non-authoritative:

- Public header `canAccessManage`;
- account summary role/manage display;
- ConsoleSidebar visibility;
- disabled buttons;
- current tab/route visibility;
- Active X selector state;
- client permission view model.

Every mutation/privileged Route Handler must independently execute its server-side guard.

## Failure semantics

Security-sensitive uncertainty is deny/unavailable, not privilege fallback:

- malformed permission policy -> empty/deny;
- DB authz read failure -> deny/unavailable;
- unknown alias/canonical X resolution -> deny;
- stale Active X -> null;
- missing manage staff row/key -> deny;
- missing current user row behind stale session -> logged out;
- auth infrastructure failure -> unavailable, not logged out;
- account-summary enrichment failure -> degraded with uncertain privilege hidden.

## UX / FN mapping

Primary user-visible contracts:

- login/redirect/session/outage/logout: `UX-AUTH-001..010`
- onboarding/terms: `UX-AUTH-011..014`
- linked X / request states: `UX-AUTH-015..018`
- Active X selection/pending/revalidation: `UX-AUTH-019..023`
- dashboard edit direct-URL/server permission: `UX-DASH-005..019`
- library Active-X/collaboration visibility: `UX-LIB-003..010`
- entry login/terms/identity prerequisites: `UX-ENTRY-001..007`
- event owner/staff permission surfaces: `UX-MNG-018..024,UX-ADM-033` where applicable to the current frontend ledger
- server-side permission denial is also a cross-cutting requirement under `FN-X-002`.

CURRENT_VERIFIED function contracts in this task:

- `FN-AUTH-001` Discord OAuth login
- `FN-AUTH-002` session restore/current-user truth
- `FN-AUTH-003` Discord account linking
- `FN-AUTH-004` banned/role reflection and enforcement
- `FN-AUTH-005` onboarding prerequisites
- `FN-AUTH-006` terms acceptance/reaccept gate
- `FN-AUTH-007` auth-complete safe redirect
- `FN-AUTH-008` logout/session termination
- `FN-AUTH-009` private account summary/degraded state
- `FN-AUTH-010` Active X switching
- `FN-X-001` event must retain an operable owner
- `FN-X-002` UI is never the authorization boundary

Video-edit, X-lifecycle, event-staff, admin-permission-simulator and individual manage/admin feature FN rows remain detailed-audit scope where this task verified only their authorization core rather than the entire feature lifecycle.

## Optimization disposition

### Strengthen/reuse

- one typed request-scoped `AuthContext`: Auth User + authoritative D1 user + approved linked X identities;
- one policy layer for write prerequisites (ban, terms, CostGuard, role, identity requirement);
- canonical permission-key resolver shared by event/video authorization and simulator;
- request-local video/event authorization snapshots to remove duplicate D1 reads without cross-request caching;
- explicit action result for `unauthenticated | unavailable | forbidden | prerequisite_required` rather than framework-specific redirects in domain code.

### Keep explicit

- Discord account-link conflict/atomicity;
- auth-complete callback retry;
- terms CAS acceptance;
- Active X switch;
- event owner transfer/self-removal confirmation;
- creator-only collaborator delegation;
- X merge/revert/destructive identity operations.

### Reject

- trusting session role/Active X without D1 reread;
- using header/account-summary DTO as authz input;
- merging normal/event/admin video privilege modes;
- using Active X as the only source of event authorization;
- generic “role >= manager” hierarchy that discards concrete permission keys;
- automatically merging Discord/X identities on ambiguous data.

Optimization blockers requiring frontend change: **0**

The target may change transport/framework, but login/session/outage/permission/identity/owner user-visible behavior remains a product contract.

## Representative test/evidence set

- `src/lib/auth/accountLinkAdapter.execution.test.mjs`
- `src/lib/auth/authTermsReliability.contract.test.mjs`
- `src/lib/auth/authFlowTrace.contract.test.mjs`
- `src/lib/auth/activeXOwnershipGuard.contract.test.mjs`
- `src/lib/auth/writeGuardCore.test.mjs`
- `src/lib/auth/ownershipCore.test.mjs`
- `src/lib/auth/ownershipAccessContext.test.mjs`
- `src/lib/auth/permissions/permissionResolver.test.mjs`
- `src/lib/event/eventOwnershipCore.test.mjs`
- `src/lib/account/summary.contract.test.mjs`
- `src/lib/client/authSignOutClient.contract.test.mjs`
- `src/components/auth/SignOutButton.contract.test.mjs`
- `src/lib/auth/xidOnboarding.contract.test.mjs`
- `src/lib/terms/reaccept.contract.test.mjs`
- `src/lib/terms/reaccept.integration.test.mjs`
- `src/lib/auth/routeApiSecurity.contract.test.mjs`
- Server Action / Route Handler ledgers from MIG-0003/MIG-0004

MIG-0008 changes documentation/checker evidence only. Auth.js, D1, sessions, users, X links, event staff and production routing are not mutated.
