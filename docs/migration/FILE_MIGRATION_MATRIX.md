# FlameNode File Migration Matrix — current source → target → MIG → evidence

> Status: Active / per-file migration progress ledger
> Snapshot source: Git tree at `3e3ef8047fbcb38f4747ba65233e80b3ca729eb5` (2026-10-09), `CURRENT_ROUTES.md`, `route-handlers/README.md`, `server-actions/README.md`
> Owner: individual MIG writer updates ONLY affected rows in its own PR; independent reviewer checks before DONE
> Task parent: [STATUS.md](STATUS.md); method/action parity: [API_MATRIX.md](API_MATRIX.md); route parity: [ROUTE_MATRIX.md](ROUTE_MATRIX.md); usage: [FILE_PROGRESS_PROTOCOL.md](FILE_PROGRESS_PROTOCOL.md)

## Semantics and safety

- **File path is the stable primary key**. Keep historical rows if source file is deleted: mark `RETIRED` with PR/SHA and proof, do not silently delete the row.
- Initial `NOT_STARTED` means **file exists and is inventoried**, not that feature parity or target implementation is complete. `TARGET_SKELETON` existing does not imply any UI/API migrated.
- `+path` denotes **candidate/required NEW TARGET** (may not exist); `TBD` is deliberately unresolved until the owner task decides exact destination. Never create placeholder files solely to satisfy the matrix.
- Route contracts use URL from `CURRENT_ROUTES.md`; RH method IDs from `route-handlers/README.md`; SA IDs from `server-actions/README.md`. These ledgers remain authoritative for permissions, UX/FN, tests, side effects.
- Suggested target paths are **candidates**, not approvals or assertions they already exist. For each file, update target with the actual source path/exports after implementing.
- If a single CURRENT file contributes to many targets, keep **one current-source row** and list all relevant target files/IDs explicitly in the `Target/bridge` cell. Do not claim file DONE while an owner route/SA contract remains unmigrated.
- `RETIRED` requires all URL/method/SA compatibility owners migrated, tests and observability. A legacy path may continue as bridge for a long time.
- For missing/new files, register a new row in the same PR, preserving all others, and update dependency/consumer paths (see FILE_PROGRESS_PROTOCOL.md).
- Source inventory includes all CURRENT `app/**/page.tsx`, all `app/api/**/route.ts`, all `src/lib/actions/**/*.ts` (including helpers), D1 schema source, Worker entries, core target package/app skeleton, and selected root config. **This is the explicit migration-boundary inventory, not all 2,335 repository files**; new code touched outside it is added when it enters an MIG scope.
- States: `NOT_STARTED` → `IN_PROGRESS` → `BRIDGED` → `PARITY_VERIFIED` → `CUTOVER` → `RETIRED` if applicable; or `BLOCKED`, `RETAINED`. See required evidence at FILE_PROGRESS_PROTOCOL.md.

## Migration ledger

| CURRENT path (exact) | Kind | Route / RH / SA linkage | First owner MIG | Target / bridge (candidate unless proven) | File state | PR / tests / evidence |
| --- | --- | --- | --- | --- | --- | --- |
| `app/(admin)/admin/announcements/[id]/edit/page.tsx` | PAGE | /admin/announcements/[id]/edit (VISUAL_SCREEN) | MIG-0705 | apps/ops (route=/admin/announcements/[id]/edit; exact component TBD) | NOT_STARTED | — |
| `app/(admin)/admin/announcements/new/page.tsx` | PAGE | /admin/announcements/new (VISUAL_SCREEN) | MIG-0705 | apps/ops (route=/admin/announcements/new; exact component TBD) | NOT_STARTED | — |
| `app/(admin)/admin/announcements/page.tsx` | PAGE | /admin/announcements (VISUAL_SCREEN) | MIG-0705 | apps/ops (route=/admin/announcements; exact component TBD) | NOT_STARTED | — |
| `app/(admin)/admin/api-endpoints/page.tsx` | PAGE | /admin/api-endpoints (VISUAL_SCREEN) | MIG-0705 | apps/ops (route=/admin/api-endpoints; exact component TBD) | NOT_STARTED | — |
| `app/(admin)/admin/audit/[id]/page.tsx` | PAGE | /admin/audit/[id] (VISUAL_SCREEN) | MIG-0705 | apps/ops (route=/admin/audit/[id]; exact component TBD) | NOT_STARTED | — |
| `app/(admin)/admin/audit/page.tsx` | PAGE | /admin/audit (VISUAL_SCREEN) | MIG-0705 | apps/ops (route=/admin/audit; exact component TBD) | NOT_STARTED | — |
| `app/(admin)/admin/audit/restore/page.tsx` | PAGE | /admin/audit/restore (VISUAL_SCREEN) | MIG-0705 | apps/ops (route=/admin/audit/restore; exact component TBD) | NOT_STARTED | — |
| `app/(admin)/admin/audit/settings/page.tsx` | PAGE | /admin/audit/settings (VISUAL_SCREEN) | MIG-0705 | apps/ops (route=/admin/audit/settings; exact component TBD) | NOT_STARTED | — |
| `app/(admin)/admin/cost-guard/page.tsx` | PAGE | /admin/cost-guard (VISUAL_SCREEN) | MIG-0705 | apps/ops (route=/admin/cost-guard; exact component TBD) | NOT_STARTED | — |
| `app/(admin)/admin/event-groups/[id]/edit/page.tsx` | PAGE | /admin/event-groups/[id]/edit (VISUAL_SCREEN) | MIG-0705 | apps/ops (route=/admin/event-groups/[id]/edit; exact component TBD) | NOT_STARTED | — |
| `app/(admin)/admin/event-groups/new/page.tsx` | PAGE | /admin/event-groups/new (VISUAL_SCREEN) | MIG-0705 | apps/ops (route=/admin/event-groups/new; exact component TBD) | NOT_STARTED | — |
| `app/(admin)/admin/event-groups/page.tsx` | PAGE | /admin/event-groups (VISUAL_SCREEN) | MIG-0705 | apps/ops (route=/admin/event-groups; exact component TBD) | NOT_STARTED | — |
| `app/(admin)/admin/events/[id]/edit/page.tsx` | PAGE | /admin/events/[id]/edit (COMPAT_REDIRECT) | MIG-0705 | apps/ops (route=/admin/events/[id]/edit; exact component TBD) | NOT_STARTED | — |
| `app/(admin)/admin/events/[id]/page.tsx` | PAGE | /admin/events/[id] (COMPAT_REDIRECT) | MIG-0705 | apps/ops (route=/admin/events/[id]; exact component TBD) | NOT_STARTED | — |
| `app/(admin)/admin/events/[id]/slots/page.tsx` | PAGE | /admin/events/[id]/slots (COMPAT_REDIRECT) | MIG-0705 | apps/ops (route=/admin/events/[id]/slots; exact component TBD) | NOT_STARTED | — |
| `app/(admin)/admin/events/[id]/staff/page.tsx` | PAGE | /admin/events/[id]/staff (COMPAT_REDIRECT) | MIG-0705 | apps/ops (route=/admin/events/[id]/staff; exact component TBD) | NOT_STARTED | — |
| `app/(admin)/admin/events/new/page.tsx` | PAGE | /admin/events/new (VISUAL_SCREEN) | MIG-0705 | apps/ops (route=/admin/events/new; exact component TBD) | NOT_STARTED | — |
| `app/(admin)/admin/events/page.tsx` | PAGE | /admin/events (VISUAL_SCREEN) | MIG-0705 | apps/ops (route=/admin/events; exact component TBD) | NOT_STARTED | — |
| `app/(admin)/admin/events/templates/page.tsx` | PAGE | /admin/events/templates (VISUAL_SCREEN) | MIG-0705 | apps/ops (route=/admin/events/templates; exact component TBD) | NOT_STARTED | — |
| `app/(admin)/admin/health/integrity/page.tsx` | PAGE | /admin/health/integrity (VISUAL_SCREEN) | MIG-0705 | apps/ops (route=/admin/health/integrity; exact component TBD) | NOT_STARTED | — |
| `app/(admin)/admin/health/page.tsx` | PAGE | /admin/health (VISUAL_SCREEN) | MIG-0705 | apps/ops (route=/admin/health; exact component TBD) | NOT_STARTED | — |
| `app/(admin)/admin/history/page.tsx` | PAGE | /admin/history (COMPAT_REDIRECT) | MIG-0705 | apps/ops (route=/admin/history; exact component TBD) | NOT_STARTED | — |
| `app/(admin)/admin/import/page.tsx` | PAGE | /admin/import (VISUAL_SCREEN) | MIG-0705 | apps/ops (route=/admin/import; exact component TBD) | NOT_STARTED | — |
| `app/(admin)/admin/moderation/page.tsx` | PAGE | /admin/moderation (VISUAL_SCREEN) | MIG-0705 | apps/ops (route=/admin/moderation; exact component TBD) | NOT_STARTED | — |
| `app/(admin)/admin/notifications/page.tsx` | PAGE | /admin/notifications (VISUAL_SCREEN) | MIG-0705 | apps/ops (route=/admin/notifications; exact component TBD) | NOT_STARTED | — |
| `app/(admin)/admin/page.tsx` | PAGE | /admin (VISUAL_SCREEN) | MIG-0705 | apps/ops (route=/admin; exact component TBD) | NOT_STARTED | — |
| `app/(admin)/admin/permissions/simulator/page.tsx` | PAGE | /admin/permissions/simulator (VISUAL_SCREEN) | MIG-0705 | apps/ops (route=/admin/permissions/simulator; exact component TBD) | NOT_STARTED | — |
| `app/(admin)/admin/rules/[id]/edit/page.tsx` | PAGE | /admin/rules/[id]/edit (VISUAL_SCREEN) | MIG-0705 | apps/ops (route=/admin/rules/[id]/edit; exact component TBD) | NOT_STARTED | — |
| `app/(admin)/admin/rules/new/page.tsx` | PAGE | /admin/rules/new (VISUAL_SCREEN) | MIG-0705 | apps/ops (route=/admin/rules/new; exact component TBD) | NOT_STARTED | — |
| `app/(admin)/admin/rules/page.tsx` | PAGE | /admin/rules (VISUAL_SCREEN) | MIG-0705 | apps/ops (route=/admin/rules; exact component TBD) | NOT_STARTED | — |
| `app/(admin)/admin/security/page.tsx` | PAGE | /admin/security (VISUAL_SCREEN) | MIG-0705 | apps/ops (route=/admin/security; exact component TBD) | NOT_STARTED | — |
| `app/(admin)/admin/spreadsheet/page.tsx` | PAGE | /admin/spreadsheet (VISUAL_SCREEN) | MIG-0705 | apps/ops (route=/admin/spreadsheet; exact component TBD) | NOT_STARTED | — |
| `app/(admin)/admin/static-builds/page.tsx` | PAGE | /admin/static-builds (VISUAL_SCREEN) | MIG-0705 | apps/ops (route=/admin/static-builds; exact component TBD) | NOT_STARTED | — |
| `app/(admin)/admin/users/[id]/edit/page.tsx` | PAGE | /admin/users/[id]/edit (VISUAL_SCREEN) | MIG-0705 | apps/ops (route=/admin/users/[id]/edit; exact component TBD) | NOT_STARTED | — |
| `app/(admin)/admin/users/[id]/page.tsx` | PAGE | /admin/users/[id] (VISUAL_SCREEN) | MIG-0705 | apps/ops (route=/admin/users/[id]; exact component TBD) | NOT_STARTED | — |
| `app/(admin)/admin/users/page.tsx` | PAGE | /admin/users (VISUAL_SCREEN) | MIG-0705 | apps/ops (route=/admin/users; exact component TBD) | NOT_STARTED | — |
| `app/(admin)/admin/videos/[id]/members/page.tsx` | PAGE | /admin/videos/[id]/members (VISUAL_SCREEN) | MIG-0705 | apps/ops (route=/admin/videos/[id]/members; exact component TBD) | NOT_STARTED | — |
| `app/(admin)/admin/videos/[id]/page.tsx` | PAGE | /admin/videos/[id] (VISUAL_SCREEN) | MIG-0705 | apps/ops (route=/admin/videos/[id]; exact component TBD) | NOT_STARTED | — |
| `app/(admin)/admin/videos/page.tsx` | PAGE | /admin/videos (VISUAL_SCREEN) | MIG-0705 | apps/ops (route=/admin/videos; exact component TBD) | NOT_STARTED | — |
| `app/(admin)/admin/workers/page.tsx` | PAGE | /admin/workers (VISUAL_SCREEN) | MIG-0705 | apps/ops (route=/admin/workers; exact component TBD) | NOT_STARTED | — |
| `app/(admin)/admin/x-id-merges/page.tsx` | PAGE | /admin/x-id-merges (VISUAL_SCREEN) | MIG-0705 | apps/ops (route=/admin/x-id-merges; exact component TBD) | NOT_STARTED | — |
| `app/(admin)/admin/x-link-requests/page.tsx` | PAGE | /admin/x-link-requests (VISUAL_SCREEN) | MIG-0705 | apps/ops (route=/admin/x-link-requests; exact component TBD) | NOT_STARTED | — |
| `app/(admin)/admin/youtube-quota/page.tsx` | PAGE | /admin/youtube-quota (VISUAL_SCREEN) | MIG-0705 | apps/ops (route=/admin/youtube-quota; exact component TBD) | NOT_STARTED | — |
| `app/(admin)/admin/youtube-sync/page.tsx` | PAGE | /admin/youtube-sync (VISUAL_SCREEN) | MIG-0705 | apps/ops (route=/admin/youtube-sync; exact component TBD) | NOT_STARTED | — |
| `app/(admin)/admin/youtube-sync/playlists/page.tsx` | PAGE | /admin/youtube-sync/playlists (VISUAL_SCREEN) | MIG-0705 | apps/ops (route=/admin/youtube-sync/playlists; exact component TBD) | NOT_STARTED | — |
| `app/(auth-complete)/auth/complete/page.tsx` | PAGE | /auth/complete (SYSTEM_SURFACE) | MIG-0802 | apps/api Auth.js (exact route TBD) | NOT_STARTED | — |
| `app/(auth)/dashboard/edit/[id]/page.tsx` | PAGE | /dashboard/edit/[id] (VISUAL_SCREEN) | MIG-0703 | apps/app (route=/dashboard/edit/[id]; exact component TBD) | NOT_STARTED | — |
| `app/(auth)/dashboard/edit/[id]/permissions/page.tsx` | PAGE | /dashboard/edit/[id]/permissions (VISUAL_SCREEN) | MIG-0703 | apps/app (route=/dashboard/edit/[id]/permissions; exact component TBD) | NOT_STARTED | — |
| `app/(auth)/dashboard/library/page.tsx` | PAGE | /dashboard/library (VISUAL_SCREEN) | MIG-0701 | apps/app (route=/dashboard/library; exact component TBD) | NOT_STARTED | — |
| `app/(auth)/dashboard/page.tsx` | PAGE | /dashboard (VISUAL_SCREEN) | MIG-0701 | apps/app (route=/dashboard; exact component TBD) | NOT_STARTED | — |
| `app/(auth)/dashboard/settings/page.tsx` | PAGE | /dashboard/settings (VISUAL_SCREEN) | MIG-0701 | apps/app (route=/dashboard/settings; exact component TBD) | NOT_STARTED | — |
| `app/(auth)/dashboard/youtube-playlists/page.tsx` | PAGE | /dashboard/youtube-playlists (COMPAT_REDIRECT) | MIG-0701 | apps/app (route=/dashboard/youtube-playlists; exact component TBD) | NOT_STARTED | — |
| `app/(auth)/entry/page.tsx` | PAGE | /entry (VISUAL_SCREEN) | MIG-0703 | apps/app (route=/entry; exact component TBD) | NOT_STARTED | — |
| `app/(auth)/entry/slotted/page.tsx` | PAGE | /entry/slotted (VISUAL_SCREEN) | MIG-0703 | apps/app (route=/entry/slotted; exact component TBD) | NOT_STARTED | — |
| `app/(auth)/entry/unslotted/page.tsx` | PAGE | /entry/unslotted (VISUAL_SCREEN) | MIG-0703 | apps/app (route=/entry/unslotted; exact component TBD) | NOT_STARTED | — |
| `app/(auth)/onboarding/page.tsx` | PAGE | /onboarding (VISUAL_SCREEN) | MIG-0701 | apps/app (route=/onboarding; exact component TBD) | NOT_STARTED | — |
| `app/(manage)/manage/events/[id]/audience/page.tsx` | PAGE | /manage/events/[id]/audience (VISUAL_SCREEN) | MIG-0704 | apps/ops (route=/manage/events/[id]/audience; exact component TBD) | NOT_STARTED | — |
| `app/(manage)/manage/events/[id]/edit/page.tsx` | PAGE | /manage/events/[id]/edit (VISUAL_SCREEN) | MIG-0704 | apps/ops (route=/manage/events/[id]/edit; exact component TBD) | NOT_STARTED | — |
| `app/(manage)/manage/events/[id]/page.tsx` | PAGE | /manage/events/[id] (VISUAL_SCREEN) | MIG-0704 | apps/ops (route=/manage/events/[id]; exact component TBD) | NOT_STARTED | — |
| `app/(manage)/manage/events/[id]/review/page.tsx` | PAGE | /manage/events/[id]/review (COMPAT_REDIRECT) | MIG-0704 | apps/ops (route=/manage/events/[id]/review; exact component TBD) | NOT_STARTED | — |
| `app/(manage)/manage/events/[id]/slots/page.tsx` | PAGE | /manage/events/[id]/slots (VISUAL_SCREEN) | MIG-0704 | apps/ops (route=/manage/events/[id]/slots; exact component TBD) | NOT_STARTED | — |
| `app/(manage)/manage/events/[id]/staff/page.tsx` | PAGE | /manage/events/[id]/staff (VISUAL_SCREEN) | MIG-0704 | apps/ops (route=/manage/events/[id]/staff; exact component TBD) | NOT_STARTED | — |
| `app/(manage)/manage/events/[id]/videos/[videoId]/page.tsx` | PAGE | /manage/events/[id]/videos/[videoId] (VISUAL_SCREEN) | MIG-0704 | apps/ops (route=/manage/events/[id]/videos/[videoId]; exact component TBD) | NOT_STARTED | — |
| `app/(manage)/manage/events/[id]/videos/page.tsx` | PAGE | /manage/events/[id]/videos (VISUAL_SCREEN) | MIG-0704 | apps/ops (route=/manage/events/[id]/videos; exact component TBD) | NOT_STARTED | — |
| `app/(manage)/manage/events/[id]/youtube-playlist/page.tsx` | PAGE | /manage/events/[id]/youtube-playlist (VISUAL_SCREEN) | MIG-0704 | apps/ops (route=/manage/events/[id]/youtube-playlist; exact component TBD) | NOT_STARTED | — |
| `app/(manage)/manage/notifications/page.tsx` | PAGE | /manage/notifications (VISUAL_SCREEN) | MIG-0704 | apps/ops (route=/manage/notifications; exact component TBD) | NOT_STARTED | — |
| `app/(manage)/manage/page.tsx` | PAGE | /manage (VISUAL_SCREEN) | MIG-0704 | apps/ops (route=/manage; exact component TBD) | NOT_STARTED | — |
| `app/(manage)/manage/x-link-requests/page.tsx` | PAGE | /manage/x-link-requests (VISUAL_SCREEN) | MIG-0704 | apps/ops (route=/manage/x-link-requests; exact component TBD) | NOT_STARTED | — |
| `app/(public)/[id]/page.tsx` | PAGE | /[id] (VISUAL_SCREEN) | MIG-0507 | +apps/site/src/pages/[id].astro | NOT_STARTED | — |
| `app/(public)/about/page.tsx` | PAGE | /about (VISUAL_SCREEN) | MIG-0501 | +apps/site/src/pages/about.astro | NOT_STARTED | — |
| `app/(public)/dev/ui-surfaces/page.tsx` | PAGE | /dev/ui-surfaces (DEV_ONLY) | MIG-0901 | RETAIN/REVIEW in MIG-0901 | NOT_STARTED | — |
| `app/(public)/event/[id]/page.tsx` | PAGE | /event/[id] (VISUAL_SCREEN) | MIG-0502 | +apps/site/src/pages/event/[id]/index.astro | NOT_STARTED | — |
| `app/(public)/event/[id]/release/page.tsx` | PAGE | /event/[id]/release (VISUAL_SCREEN) | MIG-0502 | +apps/site/src/pages/event/[id]/release.astro | NOT_STARTED | — |
| `app/(public)/event/[id]/slots/page.tsx` | PAGE | /event/[id]/slots (VISUAL_SCREEN) | MIG-0502 | +apps/site/src/pages/event/[id]/slots.astro | NOT_STARTED | — |
| `app/(public)/event/~query/page.tsx` | PAGE | /event/~query (SYSTEM_SURFACE) | MIG-0502 | +apps/site/src/pages/event/~query.astro | NOT_STARTED | — |
| `app/(public)/event/page.tsx` | PAGE | /event (VISUAL_SCREEN) | MIG-0502 | +apps/site/src/pages/event.astro | NOT_STARTED | — |
| `app/(public)/groups/[slug]/page.tsx` | PAGE | /groups/[slug] (COMPAT_REDIRECT) | MIG-0503 | +apps/site/src/pages/groups/[slug].astro | NOT_STARTED | — |
| `app/(public)/groups/page.tsx` | PAGE | /groups (COMPAT_REDIRECT) | MIG-0503 | +apps/site/src/pages/groups.astro | NOT_STARTED | — |
| `app/(public)/list/~query/page.tsx` | PAGE | /list/~query (SYSTEM_SURFACE) | MIG-0505 | +apps/site/src/pages/list/~query.astro | NOT_STARTED | — |
| `app/(public)/list/page.tsx` | PAGE | /list (VISUAL_SCREEN) | MIG-0505 | +apps/site/src/pages/list.astro | NOT_STARTED | — |
| `app/(public)/maintenance/page.tsx` | PAGE | /maintenance (SYSTEM_SURFACE) | MIG-0901 | RETAIN/REVIEW in MIG-0901 | NOT_STARTED | — |
| `app/(public)/page.tsx` | PAGE | / (VISUAL_SCREEN) | MIG-0506 | +apps/site/src/pages/index.astro | NOT_STARTED | — |
| `app/(public)/recommend/page.tsx` | PAGE | /recommend (VISUAL_SCREEN) | MIG-0505 | +apps/site/src/pages/recommend.astro | NOT_STARTED | — |
| `app/(public)/rules/page.tsx` | PAGE | /rules (VISUAL_SCREEN) | MIG-0501 | +apps/site/src/pages/rules.astro | NOT_STARTED | — |
| `app/(public)/trending/page.tsx` | PAGE | /trending (VISUAL_SCREEN) | MIG-0505 | +apps/site/src/pages/trending.astro | NOT_STARTED | — |
| `app/(public)/user/[id]/page.tsx` | PAGE | /user/[id] (VISUAL_SCREEN) | MIG-0504 | +apps/site/src/pages/user/[id]/index.astro | NOT_STARTED | — |
| `app/(public)/user/[id]/paged/page.tsx` | PAGE | /user/[id]/paged (SYSTEM_SURFACE) | MIG-0504 | +apps/site/src/pages/user/[id]/paged.astro | NOT_STARTED | — |
| `app/(public)/user/[id]/portfolio/page.tsx` | PAGE | /user/[id]/portfolio (VISUAL_SCREEN) | MIG-0504 | +apps/site/src/pages/user/[id]/portfolio.astro | NOT_STARTED | — |
| `app/(public)/user/~query/page.tsx` | PAGE | /user/~query (SYSTEM_SURFACE) | MIG-0504 | +apps/site/src/pages/user/~query.astro | NOT_STARTED | — |
| `app/(public)/user/page.tsx` | PAGE | /user (VISUAL_SCREEN) | MIG-0504 | +apps/site/src/pages/user.astro | NOT_STARTED | — |
| `app/api/account/summary/route.ts` | ROUTE_HANDLER | RH-001:GET | MIG-0605 | +apps/api/src/routes/account/summary.ts (candidate, verify router) | NOT_STARTED | — |
| `app/api/admin/import/legacy/route.ts` | ROUTE_HANDLER | RH-002:POST | MIG-0605 | +apps/api/src/routes/admin/import/legacy.ts (candidate, verify router) | NOT_STARTED | — |
| `app/api/admin/spreadsheet/data/route.ts` | ROUTE_HANDLER | RH-003:GET,RH-004:PATCH,RH-005:POST,RH-006:DELETE | MIG-0605 | +apps/api/src/routes/admin/spreadsheet/data.ts (candidate, verify router) | NOT_STARTED | — |
| `app/api/admin/spreadsheet/export/route.ts` | ROUTE_HANDLER | RH-007:GET | MIG-0605 | +apps/api/src/routes/admin/spreadsheet/export.ts (candidate, verify router) | NOT_STARTED | — |
| `app/api/admin/spreadsheet/import/route.ts` | ROUTE_HANDLER | RH-008:POST | MIG-0605 | +apps/api/src/routes/admin/spreadsheet/import.ts (candidate, verify router) | NOT_STARTED | — |
| `app/api/admin/spreadsheet/tables/route.ts` | ROUTE_HANDLER | RH-009:GET | MIG-0605 | +apps/api/src/routes/admin/spreadsheet/tables.ts (candidate, verify router) | NOT_STARTED | — |
| `app/api/auth/[...nextauth]/route.ts` | ROUTE_HANDLER | RH-010:GET,RH-011:POST | MIG-0802 | +apps/api/src/routes/auth/[...nextauth].ts (candidate, verify router) | NOT_STARTED | — |
| `app/api/event-endpoints/[id]/release/route.ts` | ROUTE_HANDLER | RH-012:GET | MIG-0604 | +apps/api/src/routes/event-endpoints/[id]/release.ts (candidate, verify router) | NOT_STARTED | — |
| `app/api/event-endpoints/[id]/route.ts` | ROUTE_HANDLER | RH-013:GET | MIG-0604 | +apps/api/src/routes/event-endpoints/[id].ts (candidate, verify router) | NOT_STARTED | — |
| `app/api/events/[id]/slots/viewer-overlay/route.ts` | ROUTE_HANDLER | RH-014:GET | MIG-0604 | +apps/api/src/routes/events/[id]/slots/viewer-overlay.ts (candidate, verify router) | NOT_STARTED | — |
| `app/api/events/route.ts` | ROUTE_HANDLER | RH-015:GET | MIG-0604 | +apps/api/src/routes/events.ts (candidate, verify router) | NOT_STARTED | — |
| `app/api/google-drive-image/[id]/route.ts` | ROUTE_HANDLER | RH-016:GET | MIG-0605 | +apps/api/src/routes/google-drive-image/[id].ts (candidate, verify router) | NOT_STARTED | — |
| `app/api/health/deep/route.ts` | ROUTE_HANDLER | RH-017:GET | MIG-0601 | +apps/api/src/routes/health/deep.ts (candidate, verify router) | NOT_STARTED | — |
| `app/api/health/route.ts` | ROUTE_HANDLER | RH-018:GET | MIG-0601 | +apps/api/src/routes/health.ts (candidate, verify router) | NOT_STARTED | — |
| `app/api/internal/x-users/search/route.ts` | ROUTE_HANDLER | RH-019:GET | MIG-0605 | +apps/api/src/routes/internal/x-users/search.ts (candidate, verify router) | NOT_STARTED | — |
| `app/api/live/events/[id]/slots/route.ts` | ROUTE_HANDLER | RH-020:GET | MIG-0604 | +apps/api/src/routes/live/events/[id]/slots.ts (candidate, verify router) | NOT_STARTED | — |
| `app/api/live/events/[id]/submissions/route.ts` | ROUTE_HANDLER | RH-021:GET | MIG-0604 | +apps/api/src/routes/live/events/[id]/submissions.ts (candidate, verify router) | NOT_STARTED | — |
| `app/api/live/events/[id]/summary/route.ts` | ROUTE_HANDLER | RH-022:GET | MIG-0604 | +apps/api/src/routes/live/events/[id]/summary.ts (candidate, verify router) | NOT_STARTED | — |
| `app/api/media/[...key]/route.ts` | ROUTE_HANDLER | RH-023:GET | MIG-0605 | +apps/api/src/routes/media/[...key].ts (candidate, verify router) | NOT_STARTED | — |
| `app/api/media/manage-x-icon/[...key]/route.ts` | ROUTE_HANDLER | RH-024:GET | MIG-0605 | +apps/api/src/routes/media/manage-x-icon/[...key].ts (candidate, verify router) | NOT_STARTED | — |
| `app/api/media/slot-submission-icon/[slotId]/route.ts` | ROUTE_HANDLER | RH-025:GET | MIG-0605 | +apps/api/src/routes/media/slot-submission-icon/[slotId].ts (candidate, verify router) | NOT_STARTED | — |
| `app/api/public/about-stats/route.ts` | ROUTE_HANDLER | RH-026:GET | MIG-0601 | +apps/api/src/routes/public/about-stats.ts (candidate, verify router) | NOT_STARTED | — |
| `app/api/public/events/[id]/staff/route.ts` | ROUTE_HANDLER | RH-027:OPTIONS,RH-028:GET | MIG-0605 | +apps/api/src/routes/public/events/[id]/staff.ts (candidate, verify router) | NOT_STARTED | — |
| `app/api/software/suggestions/route.ts` | ROUTE_HANDLER | RH-029:GET | MIG-0601 | +apps/api/src/routes/software/suggestions.ts (candidate, verify router) | NOT_STARTED | — |
| `app/api/videos/[id]/route.ts` | ROUTE_HANDLER | RH-030:GET | MIG-0603 | +apps/api/src/routes/videos/[id].ts (candidate, verify router) | NOT_STARTED | — |
| `app/api/videos/[id]/viewer-overlay/route.ts` | ROUTE_HANDLER | RH-031:GET | MIG-0603 | +apps/api/src/routes/videos/[id]/viewer-overlay.ts (candidate, verify router) | NOT_STARTED | — |
| `app/api/videos/route.ts` | ROUTE_HANDLER | RH-032:GET | MIG-0603 | +apps/api/src/routes/videos.ts (candidate, verify router) | NOT_STARTED | — |
| `app/api/youtube-thumbnail/[id]/[size]/route.ts` | ROUTE_HANDLER | RH-033:GET | MIG-0605 | +apps/api/src/routes/youtube-thumbnail/[id]/[size].ts (candidate, verify router) | NOT_STARTED | — |
| `apps/api/package.json` | TARGET_SKELETON | existing baseline; never assume feature migrated | MIG-0601 | SAME (extend in owner task) | NOT_STARTED | — |
| `apps/api/src/index.ts` | TARGET_SKELETON | existing baseline; never assume feature migrated | MIG-0601 | SAME (extend in owner task) | NOT_STARTED | — |
| `apps/api/src/types/hono.d.ts` | TARGET_SKELETON | existing baseline; never assume feature migrated | MIG-0601 | SAME (extend in owner task) | NOT_STARTED | — |
| `apps/api/tsconfig.json` | TARGET_SKELETON | existing baseline; never assume feature migrated | MIG-0601 | SAME (extend in owner task) | NOT_STARTED | — |
| `apps/app/index.html` | TARGET_SKELETON | existing baseline; never assume feature migrated | MIG-0701 | SAME (extend in owner task) | NOT_STARTED | — |
| `apps/app/package.json` | TARGET_SKELETON | existing baseline; never assume feature migrated | MIG-0701 | SAME (extend in owner task) | NOT_STARTED | — |
| `apps/app/src/App.tsx` | TARGET_SKELETON | existing baseline; never assume feature migrated | MIG-0701 | SAME (extend in owner task) | NOT_STARTED | — |
| `apps/app/src/main.tsx` | TARGET_SKELETON | existing baseline; never assume feature migrated | MIG-0701 | SAME (extend in owner task) | NOT_STARTED | — |
| `apps/app/tsconfig.json` | TARGET_SKELETON | existing baseline; never assume feature migrated | MIG-0701 | SAME (extend in owner task) | NOT_STARTED | — |
| `apps/app/vite.config.ts` | TARGET_SKELETON | existing baseline; never assume feature migrated | MIG-0701 | SAME (extend in owner task) | NOT_STARTED | — |
| `apps/site/astro.config.mjs` | TARGET_SKELETON | existing baseline; never assume feature migrated | MIG-0401 | SAME (extend in owner task) | NOT_STARTED | — |
| `apps/site/package.json` | TARGET_SKELETON | existing baseline; never assume feature migrated | MIG-0401 | SAME (extend in owner task) | NOT_STARTED | — |
| `apps/site/src/pages/index.astro` | TARGET_SKELETON | existing baseline; never assume feature migrated | MIG-0401 | SAME (extend in owner task) | NOT_STARTED | — |
| `drizzle.config.ts` | CONFIG | shared config; change requires cross-task compatibility review | MIG-0308 | SAME (review owner and package graph) | NOT_STARTED | — |
| `package-lock.json` | CONFIG | shared config; change requires cross-task compatibility review | MIG-0901 | SAME (review owner and package graph) | NOT_STARTED | — |
| `package.json` | CONFIG | shared config; change requires cross-task compatibility review | MIG-0901 | SAME (review owner and package graph) | NOT_STARTED | — |
| `packages/contracts/package.json` | TARGET_SKELETON | existing baseline; never assume feature migrated | MIG-0601 | SAME (extend in owner task) | NOT_STARTED | — |
| `packages/contracts/src/index.ts` | TARGET_SKELETON | existing baseline; never assume feature migrated | MIG-0601 | SAME (extend in owner task) | NOT_STARTED | — |
| `packages/contracts/src/video.ts` | TARGET_SKELETON | existing baseline; never assume feature migrated | MIG-0601 | SAME (extend in owner task) | NOT_STARTED | — |
| `packages/contracts/tsconfig.json` | TARGET_SKELETON | existing baseline; never assume feature migrated | MIG-0601 | SAME (extend in owner task) | NOT_STARTED | — |
| `packages/domain/package.json` | TARGET_SKELETON | existing baseline; never assume feature migrated | MIG-0301 | SAME (extend in owner task) | NOT_STARTED | — |
| `packages/domain/src/index.ts` | TARGET_SKELETON | existing baseline; never assume feature migrated | MIG-0301 | SAME (extend in owner task) | NOT_STARTED | — |
| `packages/domain/src/permissions.ts` | TARGET_SKELETON | existing baseline; never assume feature migrated | MIG-0301 | SAME (extend in owner task) | NOT_STARTED | — |
| `packages/domain/tsconfig.json` | TARGET_SKELETON | existing baseline; never assume feature migrated | MIG-0301 | SAME (extend in owner task) | NOT_STARTED | — |
| `packages/ui/package.json` | TARGET_SKELETON | existing baseline; never assume feature migrated | MIG-0202 | SAME (extend in owner task) | NOT_STARTED | — |
| `packages/ui/src/adapters/index.tsx` | TARGET_SKELETON | existing baseline; never assume feature migrated | MIG-0202 | SAME (extend in owner task) | NOT_STARTED | — |
| `packages/ui/src/components/Button.tsx` | TARGET_SKELETON | existing baseline; never assume feature migrated | MIG-0202 | SAME (extend in owner task) | NOT_STARTED | — |
| `packages/ui/src/index.ts` | TARGET_SKELETON | existing baseline; never assume feature migrated | MIG-0202 | SAME (extend in owner task) | NOT_STARTED | — |
| `packages/ui/tsconfig.json` | TARGET_SKELETON | existing baseline; never assume feature migrated | MIG-0202 | SAME (extend in owner task) | NOT_STARTED | — |
| `src/lib/actions/admin.ts` | SERVER_ACTION | SA-001,SA-002,SA-003 | MIG-0306 | domain service + Hono adapter (exact file TBD) | NOT_STARTED | — |
| `src/lib/actions/announcement.ts` | SERVER_ACTION | SA-004,SA-005,SA-006 | MIG-0303 | domain service + Hono adapter (exact file TBD) | NOT_STARTED | — |
| `src/lib/actions/api-endpoints.ts` | SERVER_ACTION | SA-007,SA-008 | MIG-0303 | domain service + Hono adapter (exact file TBD) | NOT_STARTED | — |
| `src/lib/actions/audit-admin.ts` | SERVER_ACTION | SA-009,SA-010,SA-011 | MIG-0306 | domain service + Hono adapter (exact file TBD) | NOT_STARTED | — |
| `src/lib/actions/chapter.ts` | SERVER_ACTION | SA-012,SA-013,SA-014,SA-015 | MIG-0304 | domain service + Hono adapter (exact file TBD) | NOT_STARTED | — |
| `src/lib/actions/chapterLimits.ts` | ACTION_HELPER | no SA export; inspect callers | MIG-0304 | domain service + Hono adapter (exact file TBD) | NOT_STARTED | — |
| `src/lib/actions/cost-guard.ts` | SERVER_ACTION | SA-016,SA-017,SA-018,SA-019,SA-020 | MIG-0306 | domain service + Hono adapter (exact file TBD) | NOT_STARTED | — |
| `src/lib/actions/event-admin-danger.ts` | SERVER_ACTION | SA-021 | MIG-0305 | domain service + Hono adapter (exact file TBD) | NOT_STARTED | — |
| `src/lib/actions/event-admin.ts` | SERVER_ACTION | SA-022,SA-023,SA-024 | MIG-0305 | domain service + Hono adapter (exact file TBD) | NOT_STARTED | — |
| `src/lib/actions/event-group-admin.ts` | SERVER_ACTION | SA-025,SA-026,SA-027,SA-028,SA-029,SA-030 | MIG-0305 | domain service + Hono adapter (exact file TBD) | NOT_STARTED | — |
| `src/lib/actions/event-staff-admin.ts` | SERVER_ACTION | SA-031,SA-032,SA-033,SA-034 | MIG-0305 | domain service + Hono adapter (exact file TBD) | NOT_STARTED | — |
| `src/lib/actions/event-template-admin.ts` | SERVER_ACTION | SA-035,SA-036,SA-037 | MIG-0305 | domain service + Hono adapter (exact file TBD) | NOT_STARTED | — |
| `src/lib/actions/event-youtube-playlist.ts` | SERVER_ACTION | SA-038,SA-039 | MIG-0305 | domain service + Hono adapter (exact file TBD) | NOT_STARTED | — |
| `src/lib/actions/manage-video.ts` | SERVER_ACTION | SA-040,SA-041,SA-042 | MIG-0304 | domain service + Hono adapter (exact file TBD) | NOT_STARTED | — |
| `src/lib/actions/moderation-admin.ts` | SERVER_ACTION | SA-043,SA-044 | MIG-0306 | domain service + Hono adapter (exact file TBD) | NOT_STARTED | — |
| `src/lib/actions/mutationResult.ts` | ACTION_HELPER | no SA export; inspect callers | MIG-0306 | domain service + Hono adapter (exact file TBD) | NOT_STARTED | — |
| `src/lib/actions/notification-admin.ts` | SERVER_ACTION | SA-045,SA-046,SA-047,SA-048 | MIG-0306 | domain service + Hono adapter (exact file TBD) | NOT_STARTED | — |
| `src/lib/actions/permissions-admin.ts` | SERVER_ACTION | SA-049 | MIG-0306 | domain service + Hono adapter (exact file TBD) | NOT_STARTED | — |
| `src/lib/actions/public-visibility-repair.ts` | SERVER_ACTION | SA-050 | MIG-0306 | domain service + Hono adapter (exact file TBD) | NOT_STARTED | — |
| `src/lib/actions/rules.ts` | SERVER_ACTION | SA-051,SA-052,SA-053,SA-054,SA-055 | MIG-0306 | domain service + Hono adapter (exact file TBD) | NOT_STARTED | — |
| `src/lib/actions/slot-admin-danger.ts` | SERVER_ACTION | SA-056,SA-057 | MIG-0305 | domain service + Hono adapter (exact file TBD) | NOT_STARTED | — |
| `src/lib/actions/slot-admin.ts` | SERVER_ACTION | SA-058,SA-059,SA-060,SA-061,SA-062,SA-063,SA-064 | MIG-0305 | domain service + Hono adapter (exact file TBD) | NOT_STARTED | — |
| `src/lib/actions/slot.ts` | SERVER_ACTION | SA-065,SA-066,SA-067,SA-068 | MIG-0305 | domain service + Hono adapter (exact file TBD) | NOT_STARTED | — |
| `src/lib/actions/slotNotificationsPostCommit.ts` | ACTION_HELPER | no SA export; inspect callers | MIG-0305 | domain service + Hono adapter (exact file TBD) | NOT_STARTED | — |
| `src/lib/actions/static-rebuild-admin.ts` | SERVER_ACTION | SA-069,SA-070,SA-071,SA-072,SA-073 | MIG-0306 | domain service + Hono adapter (exact file TBD) | NOT_STARTED | — |
| `src/lib/actions/terms.ts` | SERVER_ACTION | SA-074,SA-075,SA-076 | MIG-0306 | domain service + Hono adapter (exact file TBD) | NOT_STARTED | — |
| `src/lib/actions/user-admin.ts` | SERVER_ACTION | SA-077,SA-078,SA-079,SA-080,SA-081 | MIG-0306 | domain service + Hono adapter (exact file TBD) | NOT_STARTED | — |
| `src/lib/actions/video-collab-perms.ts` | SERVER_ACTION | SA-082,SA-083,SA-084 | MIG-0304 | domain service + Hono adapter (exact file TBD) | NOT_STARTED | — |
| `src/lib/actions/video.ts` | ACTION_HELPER | no SA export; inspect callers | MIG-0304 | domain service + Hono adapter (exact file TBD) | NOT_STARTED | — |
| `src/lib/actions/video/adminMembers.ts` | SERVER_ACTION | SA-085 | MIG-0304 | domain service + Hono adapter (exact file TBD) | NOT_STARTED | — |
| `src/lib/actions/video/createFreeVideo.ts` | SERVER_ACTION | SA-086 | MIG-0304 | domain service + Hono adapter (exact file TBD) | NOT_STARTED | — |
| `src/lib/actions/video/interaction.ts` | SERVER_ACTION | SA-087 | MIG-0304 | domain service + Hono adapter (exact file TBD) | NOT_STARTED | — |
| `src/lib/actions/video/submitSlotVideo.ts` | SERVER_ACTION | SA-088 | MIG-0304 | domain service + Hono adapter (exact file TBD) | NOT_STARTED | — |
| `src/lib/actions/video/updateVideo.ts` | SERVER_ACTION | SA-089 | MIG-0304 | domain service + Hono adapter (exact file TBD) | NOT_STARTED | — |
| `src/lib/actions/xid-admin.ts` | SERVER_ACTION | SA-090,SA-091 | MIG-0306 | domain service + Hono adapter (exact file TBD) | NOT_STARTED | — |
| `src/lib/actions/xid-merge-admin.ts` | SERVER_ACTION | SA-092,SA-093,SA-094,SA-095,SA-096,SA-097 | MIG-0306 | domain service + Hono adapter (exact file TBD) | NOT_STARTED | — |
| `src/lib/actions/xid.ts` | SERVER_ACTION | SA-098,SA-099,SA-100,SA-101,SA-102,SA-103,SA-104,SA-105 | MIG-0306 | domain service + Hono adapter (exact file TBD) | NOT_STARTED | — |
| `src/lib/actions/xidPendingInsert.ts` | ACTION_HELPER | no SA export; inspect callers | MIG-0306 | domain service + Hono adapter (exact file TBD) | NOT_STARTED | — |
| `src/lib/actions/xidRequestReliabilityCore.ts` | ACTION_HELPER | no SA export; inspect callers | MIG-0306 | domain service + Hono adapter (exact file TBD) | NOT_STARTED | — |
| `src/lib/actions/youtube-sync-admin.ts` | SERVER_ACTION | SA-106 | MIG-0306 | domain service + Hono adapter (exact file TBD) | NOT_STARTED | — |
| `src/lib/db/schema.base.ts` | DB_SCHEMA | D-01 / schema compatibility | MIG-0308 | +packages/db/src/schema (MIG-0308 plan) | NOT_STARTED | — |
| `src/lib/db/schema.canonical.ts` | DB_SCHEMA | D-01 / schema compatibility | MIG-0308 | +packages/db/src/schema (MIG-0308 plan) | NOT_STARTED | — |
| `src/lib/db/schema.ts` | DB_SCHEMA | D-01 / schema compatibility | MIG-0308 | +packages/db/src/schema (MIG-0308 plan) | NOT_STARTED | — |
| `tsconfig.base.json` | CONFIG | shared config; change requires cross-task compatibility review | MIG-0901 | SAME (review owner and package graph) | NOT_STARTED | — |
| `workers/cleanup/index.ts` | WORKER_ENTRY | Queue/Cron + production bindings | MIG-0901 | RETAIN until audit; worker code target TBD | NOT_STARTED | — |
| `workers/content-jobs/index.ts` | WORKER_ENTRY | Queue/Cron + production bindings | MIG-0901 | RETAIN until audit; worker code target TBD | NOT_STARTED | — |
| `workers/fast-jobs/index.ts` | WORKER_ENTRY | Queue/Cron + production bindings | MIG-0901 | RETAIN until audit; worker code target TBD | NOT_STARTED | — |
| `workers/score-recalc/index.ts` | WORKER_ENTRY | Queue/Cron + production bindings | MIG-0901 | RETAIN until audit; worker code target TBD | NOT_STARTED | — |
| `workers/sync-jobs/index.ts` | WORKER_ENTRY | Queue/Cron + production bindings | MIG-0901 | RETAIN until audit; worker code target TBD | NOT_STARTED | — |
| `workers/youtube-playlist-sync/index.ts` | WORKER_ENTRY | Queue/Cron + production bindings | MIG-0901 | RETAIN until audit; worker code target TBD | NOT_STARTED | — |
| `workers/youtube-sync/index.ts` | WORKER_ENTRY | Queue/Cron + production bindings | MIG-0901 | RETAIN until audit; worker code target TBD | NOT_STARTED | — |
| `wrangler.toml` | CONFIG | shared config; change requires cross-task compatibility review | MIG-0901 | SAME (review owner and package graph) | NOT_STARTED | — |

| `src/lib/publicData/loader.test.mjs` | TEST | legacy public data loader caching/visibility regression | MIG-0401 | SAME (CURRENT regression; future Astro loader test TBD) | NOT_STARTED | — |

## Future files requiring source/target registration

| Planned path or family | Owning MIG | Status | Required connection |
| --- | --- | --- | --- |
| `packages/db/src/schema/{base,canonical,index}.ts` | MIG-0308 | NOT_CREATED | 3 old schema rows + canonical exports + Drizzle/config checker |
| `packages/domain/src/slots/reservationLimit.ts` | MIG-0301 | NOT_CREATED | `src/lib/slots/slotReservationLimit.ts` legacy export bridge |
| `apps/ops/{package.json,tsconfig.json,index.html,vite.config.ts,src/**}` | MIG-0704 | NOT_CREATED | `/manage`, `/admin`, Ops assets / session, `@flamenode/ui` |
| `apps/site/src/lib/publicDataLoader.ts` | MIG-0401 | NOT_CREATED | static projection R2 public snapshot, privacy fence |
| `apps/site/src/gateway/**` | MIG-0405 | NOT_CREATED | visibility manifest/cache/fail-closed + Route PoC |
| `scripts/check-public-site-build-budget.mjs` | MIG-0406 | NOT_CREATED | SSG file count → R2 pre-generated HTML fallback (no unmeasured SSR) |

**Update rule:** Every file created, moved, removed, or modified as part of a migration MIG must either have an updated row above or an added one in this matrix, with exact new path, owner, state, and evidence. The one-MIG PR must show a per-file before/after list. Never mark `PARITY_VERIFIED` on the basis of only TypeScript compile or an AI assertion.
