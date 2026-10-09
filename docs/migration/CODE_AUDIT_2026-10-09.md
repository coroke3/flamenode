# Code vs Migration Specs Audit — 2026-10-09

> Baseline main SHA: b667b8ecd77a92dcff52a555f584e30840205ccd
> Scope: source inspection only; no domain/API/frontend cutover performed
> Canonical inventories: [FILE_MIGRATION_MATRIX.md](FILE_MIGRATION_MATRIX.md), [CURRENT_ROUTES.md](CURRENT_ROUTES.md), [server-actions/README.md](server-actions/README.md), [route-handlers/README.md](route-handlers/README.md)

## Discrepancies resolved

| Current implementation evidence | Correction |
| --- | --- |
| `src/lib/actions/admin.ts` contains video status actions SA-001..003 | First domain owner is MIG-0304 (not MIG-0306); downstream Hono MIG-0603 and Ops MIG-0705 must reuse the same service |
| `src/lib/actions/event-template-admin.ts` contains event templates SA-035..037 | First domain owner is MIG-0303 (not MIG-0305); event and Hono consumers must preserve compatibility without duplicate implementations |
| `next.config.mjs` implements query-backed technical twins (`/list/~query`, `/event/~query`, `/user/~query`, `/user/[id]/paged`) | Migrate logical user URLs with query/back-forward/refresh compatibility; do not require one matching Astro page per old internal renderer |
| `apps/api/src/index.ts` contains only PoC `GET /health`; CURRENT `app/api/health/route.ts` exposes `/api/health` | MIG-0601 must prove real HTTP path, headers, DTO and auth/error parity, including Worker ingress prefixes |
| `apps/site/src/pages/index.astro` contains only placeholder text/Button | Astro public page parity is not implemented |
| `apps/app/src/App.tsx` contains only example dashboard/Button | Personal/Entry/Manage/Admin UI parity is not implemented |
| `packages/domain/src/permissions.ts#canEditVideo` uses `isOwner || isCollabEditor || isEventStaff` | This is not CURRENT mode-aware authorization and must not be used for real privilege decisions |
| `packages/ui/src/adapters/index.tsx` has module-global `setLinkComponent`, `setImageComponent`, `setNavigatorAdapter` | Require per-root/island dependency isolation and tests before SSR |
| `src/lib/db/schema.ts` reexports legacy base/canonical fragments; Drizzle config references legacy location | `packages/db` remains a MIG-0308 plan, not an implemented package; schema migration must produce zero DDL |
| Phase7 spec demanded notification 「既読化」 | No CURRENT notification read-receipt command established; do not invent a new mutation as existing parity |

## Mandatory connection order

1. Find the real source file and all importers/callers before editing.
2. Snapshot exact RH/SA and UX/FN behavior, denial/error cases and side effects.
3. Implement the domain provider and preserve legacy bridge; record actual target paths rather than guessed candidates.
4. Confirm Node, Next, Astro, Vite and Worker import/runtime compatibility where applicable.
5. Migrate HTTP/UI consumers separately in their assigned MIG; Domain DONE does not mean Hono route or browser cutover.
6. Update every touched FILE_MIGRATION_MATRIX.md row with actual PR/commit/test proof. The SHA references the code/test commit immediately before the evidence-table commit, never an imaginary future HEAD.
7. Verify logical query URLs, permissions, D1/audit/Queue, R2 visibility and Auth.js sessions as applicable before marking parity.
8. Respect STATUS.md dependencies, Phase Gates, independent review, real user approval for production/DB/route changes.

## Outstanding implementation blockers

- MIG-0301 is READY but not completed; the entire migration is not implemented.
- D-08 UI mock is still PENDING_HTML.
- Cloudflare Route, 1102 CPU headroom, R2 visibility, Auth.js compatibility and D-03/D-04 real data cutover require separate evidence.
- This audit is a documentation and test review, not a claim that small models have successfully completed all work autonomously.
