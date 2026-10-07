# MIG-0011 Gap Scan Checkpoint

> Status: CHECKPOINT / NOT COMPLETE
> Verified through: 2026-10-07
> Production mutation: none

MIG-0011の途中調査をmainへ安全に合流するためのcheckpoint。MIG-0011完了を意味しない。

## Current baseline at checkpoint

- CURRENT USER_SCREEN baseline: 86
- frontend UX capabilities: 432
- FN contracts: 136
- FN CURRENT_VERIFIED: 33
- FN DETAIL_AUDIT_REQUIRED: 103
- Server Actions: 110 CURRENT_VERIFIED
- Route Handler methods: 33 CURRENT_VERIFIED
- Cloudflare topology/performance/static/auth/background jobs baseline: completed
- screen mapping: 86/86 screens, 432 UX, 170 Surface tokens, 16 cross-route shells resolved

## MIG-0011 scan progress

Remaining FN rows were cross-referenced against Server Action/API/screen mapping evidence.

- 98 DETAIL_AUDIT_REQUIRED rows are product/domain/API rows.
- 5 remaining rows are cross-cutting invariants.
- Most remaining rows already have at least one Server Action/API/screen mapping evidence path.
- Six rows initially had no direct cross-ledger reference and were manually checked:
  - FN-PUB-003 YouTube player
  - FN-PUB-006 view tracking
  - FN-PUB-019 creator portfolio
  - FN-PER-004 dashboard library
  - FN-MNG-003 manage audience
  - FN-PLAT-001 D1 canonical source

Manual code/test evidence exists for all six:
- YouTube player uses playerBridge and dedicated playerBridge tests.
- view tracking uses VideoViewTracker/videoViewTrackerCore and dedicated tests.
- portfolio uses static public profile data with reflection/unavailable/not-found semantics.
- dashboard library uses authenticated account-owned interactions via auth_user_id plus approved-X identity rules for mine/collab/chapter views.
- manage audience performs server-side manage authorization and read-only event-scoped aggregation.
- D1 canonical-source invariant is consistently reflected across migration/static/job/topology docs and runtime design.

Additional directly verified platform/product evidence:
- trending is R2-only public data with explicit stale/unavailable handling and fixed GA4 ranking rule.
- /dev/ui-surfaces is production 404.
- /maintenance is a real user-facing system page.
- UI acceptance source includes explicit responsive/a11y/deep-link/form/job-state requirements.
- interaction ownership divergence is resolved in favor of CURRENT auth_user_id semantics.
- chapter/comment historical-model divergence is resolved in favor of CURRENT timed chapter/comment semantics.
- obsolete docs/design-redesign remains excluded as visual target.

## Important route-classification gap found

Several entries counted as USER_SCREEN are actually compatibility redirects, not independent UI surfaces.

Confirmed redirect-only CURRENT routes:

- `/groups` -> `/event`
- `/groups/[slug]` -> `/event#event-group-<slug>`
- `/admin/history` -> `/admin/audit`
- `/admin/events/[id]` -> `/manage/events/[id]`
- `/dashboard/youtube-playlists` -> admin playlist page for admin, otherwise `/dashboard`
- `/manage/events/[id]/review` -> `/manage/events/[id]/videos?status=pending`

This is a MIG-0011 finding, not yet fully reconciled into CURRENT_ROUTES/screen-mapping counts.

Required next action:
1. scan all CURRENT page.tsx for redirect-only behavior;
2. reclassify compatibility URLs separately from real visual screens;
3. update route/screen counts and checker together;
4. preserve URLs/deep-links even if they stop counting as independent screens;
5. then continue remaining FN/UX requirement reconciliation.

## UX evidence state at checkpoint

Current frontend ledger states:

- CURRENT_OBSERVED: 280
- AUDIT_REQUIRED: 152

MIG-0011 still needs to disposition every AUDIT_REQUIRED UX row into:
- CURRENT_VERIFIED,
- REQUIREMENT_ONLY,
- CURRENT_DIVERGENCE,
- or another explicit terminal/non-ambiguous state.

Do not bulk-promote without evidence.

## Known requirement divergences

Already identified and effectively resolved for migration direction:

1. Interaction ownership
   - historical: Active X ownership
   - CURRENT: auth_user_id account ownership
   - migration direction: preserve CURRENT

2. Chapter/comment model
   - historical: broader/free-comment model
   - CURRENT: timed chapter/comment experience
   - migration direction: preserve CURRENT

3. UI redesign source
   - historical docs/design-redesign
   - CURRENT migration rule: excluded
   - target visual source: user-provided HTML mock only; currently PENDING_HTML

MIG-0011 still needs to record these as explicit resolved dispositions so gate counts become zero.

## Safety

- runtime application changes: 0
- production Cloudflare changes: 0
- D1/R2/KV/Queue mutations: 0
- feature removals approved: 0
- frontend behavior changes approved: 0

## Resume point

Resume MIG-0011 from the redirect-only route classification scan before final FN/UX bulk disposition.

MIG-0011 remains incomplete.
