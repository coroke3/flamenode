# MIG-0004 Route Handler / API Inventory

> Status: CURRENT_VERIFIED
> Task: `MIG-0004`
> Verified: 2026-10-07
> Runtime behavior change: none

## Completion result

```text
app/api/**/route.ts files: 28
HTTP method handlers: 33
unclassified methods: 0
```

Route HandlerはHonoへ機械copyしない。HTTP transport、business/read model、permission、visibility、cache/rate-limit、Cloudflare binding、external fetchを分離し、frontend/external consumerから観測される契約を維持する。

## Method ledger

| ID | Method | Route | Purpose | Auth / permission | Data / effects | Cache / rate | FN | UX / consumers | Tests / evidence | Target observation | State |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| RH-001 | GET | /api/account/summary | account header presence/details | session/current user; degraded auth handled | private identity read; no mutation | private no-store | FN-AUTH-009,FN-AUTH-010 | UX-GLOBAL-010..013 | source + account summary/auth helpers | private read endpoint; typed account contract | CURRENT_VERIFIED |
| RH-002 | POST | /api/admin/import/legacy | legacy import preview/apply | same-origin + requireAdminWrite(admin_legacy_import) | multipart parse; D1 mutation; R2 preview token/store; bounded CPU | private/no-store by admin flow | FN-ADM-016,FN-X-009,FN-X-005 | UX-ADM-049..052 | legacy import parse/preflight/apply tests | keep dedicated import boundary; async/heavy phases may move off request | CURRENT_VERIFIED |
| RH-003 | GET | /api/admin/spreadsheet/data | spreadsheet table page read | admin spreadsheet guard | bounded table read | private no-store | FN-ADM-022,FN-X-002 | UX-ADM-069..072 | spreadsheet routeHandler/pageQuery tests | shared admin data query adapter | CURRENT_VERIFIED |
| RH-004 | PATCH | /api/admin/spreadsheet/data | spreadsheet cell update | same-origin + admin spreadsheet write | D1 write + audit/static reflection via spreadsheet core | private no-store | FN-ADM-022,FN-X-005 | UX-ADM-070..072 | spreadsheet routeHandler/atomicity/staticRebuild tests | typed mutation command; preserve pendingPublicReflection | CURRENT_VERIFIED |
| RH-005 | POST | /api/admin/spreadsheet/data | spreadsheet row insert | same-origin + admin spreadsheet write | D1 write + audit/static reflection | private no-store | FN-ADM-022,FN-X-005 | UX-ADM-070..072 | spreadsheet routeHandler/atomicity tests | typed mutation command | CURRENT_VERIFIED |
| RH-006 | DELETE | /api/admin/spreadsheet/data | spreadsheet row delete | same-origin + admin spreadsheet write | D1 write + audit/static reflection | private no-store | FN-ADM-022,FN-X-005 | UX-ADM-070..072 | spreadsheet routeHandler/atomicity tests | typed mutation command; preserve protected tables | CURRENT_VERIFIED |
| RH-007 | GET | /api/admin/spreadsheet/export | spreadsheet export | admin spreadsheet guard | bounded export serialization | private no-store | FN-ADM-022 | UX-ADM-069..072 | spreadsheet paste/query/routeHandler tests | read adapter; keep export limits explicit | CURRENT_VERIFIED |
| RH-008 | POST | /api/admin/spreadsheet/import | spreadsheet import preview/apply | same-origin + admin spreadsheet write + operation-mode policy | bounded JSON; parse/preview token; D1 batch + static rebuild plan | private no-store | FN-ADM-022,FN-X-005 | UX-ADM-070..072 | importPrep/previewToken/atomicity/staticRebuild tests | dedicated bulk command; do not generic CRUD | CURRENT_VERIFIED |
| RH-009 | GET | /api/admin/spreadsheet/tables | spreadsheet table discovery/settings | admin spreadsheet guard | metadata/read-model only | private no-store | FN-ADM-022 | UX-ADM-069..071 | spreadsheet registry/routeHandler tests | shared discovery query | CURRENT_VERIFIED |
| RH-010 | GET | /api/auth/[...nextauth] | Auth.js GET transport | Auth.js/session/provider contract | OAuth/session/callback reads | Auth.js-defined | FN-AUTH-001,FN-AUTH-002,FN-AUTH-003,FN-AUTH-008 | UX-GLOBAL-014,UX-ENTRY-001..002 | auth config/route error evidence | keep compatibility boundary until Phase 8 | CURRENT_VERIFIED |
| RH-011 | POST | /api/auth/[...nextauth] | Auth.js POST transport | Auth.js/session/provider contract | sign-in/callback/sign-out/account-linking effects | Auth.js-defined | FN-AUTH-001,FN-AUTH-003,FN-AUTH-008 | UX-GLOBAL-014,UX-ENTRY-001..002 | auth config/route error evidence | do not fold into generic Hono API before auth migration | CURRENT_VERIFIED |
| RH-012 | GET | /api/event-endpoints/[id]/release | public event release export | public rate limit + public visibility/data rules | D1/public projection read | public API cache contract | FN-API-001,FN-PUB-011,FN-PLAT-002 | UX-EVENT-017..019 | eventReleaseRoute + eventExport tests | public export query; explicit DTO/cache | CURRENT_VERIFIED |
| RH-013 | GET | /api/event-endpoints/[id] | public configured event export | public rate limit; validated format/update/refresh | D1 + KV/cache/micro-cache; export payload build | format-dependent public cache/no-store | FN-API-001,FN-PLAT-002,FN-X-003 | N/A — external event export API; related UX-EVENT-006..019 | eventExport* + publicApi tests | extract export service; preserve v5/legacy/update semantics | CURRENT_VERIFIED |
| RH-014 | GET | /api/events/[id]/slots/viewer-overlay | viewer-specific slot overlay | viewer/session semantics inside loader | private overlay read | private no-store; 503 retry-after | FN-API-002,FN-PUB-012,FN-ENT-002 | UX-SLOT-004,UX-EVENT-013..016 | source + slotViewerOverlay helpers | private overlay endpoint; never cache publicly | CURRENT_VERIFIED |
| RH-015 | GET | /api/events | public event list | public rate limit + explicit DTO + fail-closed operation mode | static projection first; bounded D1 fallback only when allowed | public cache for static result | FN-API-002,FN-PUB-009,FN-PLAT-002,FN-PLAT-007 | UX-EVENT-001..005 | publicApi/publicDto/publicRouteHardening tests | static-first read service + thin transport | CURRENT_VERIFIED |
| RH-016 | GET | /api/google-drive-image/[id] | Google Drive image proxy | validated external image identifier/URL policy | external fetch/proxy; no D1 mutation | proxy cache contract | FN-API-010 | N/A — image proxy transport used by image surfaces; no standalone screen | externalImageProxy evidence | prefer direct/static where safe; retain proxy safety | CURRENT_VERIFIED |
| RH-017 | GET | /api/health/deep | deep operational health | WORKER_ADMIN_TOKEN authorization | D1/R2/worker deep checks; read-only | no-store | FN-API-008,FN-ADM-013,FN-ADM-027 | UX-ADM-041..048 | deepHealth source/tests where present | internal/admin diagnostics endpoint | CURRENT_VERIFIED |
| RH-018 | GET | /api/health | public shallow health | public; no privileged data | commit/service health only | dynamic; minimal response | FN-API-008 | N/A — operational health consumer | app/api/health/route.test.mjs | keep tiny Worker health path | CURRENT_VERIFIED |
| RH-019 | GET | /api/internal/x-users/search | authenticated X-user/member suggestion search | requireRouteUser; banned denied | R2 suggestion artifacts + bounded fallback search | private no-store | FN-API-005,FN-PER-003,FN-PER-007 | UX-SUB-013..015,UX-SET-003 | memberSuggestionsRoute.contract + loader tests | private search service; versioned artifact fallback explicit | CURRENT_VERIFIED |
| RH-020 | GET | /api/live/events/[id]/slots | live public slot state | public event visibility + operation-mode live guard | bounded D1 read | 5s isolate body cache; s-maxage=5/SWR=30 | FN-API-006,FN-PUB-012,FN-PLAT-011 | UX-EVENT-013..016 | liveGuard/liveApi source + publicSlotsPage tests | one shared live GET adapter; keep per-payload query functions | CURRENT_VERIFIED |
| RH-021 | GET | /api/live/events/[id]/submissions | live public submissions | public event visibility + operation-mode live guard | bounded D1 read; public videos only | 5s isolate body cache; s-maxage=5/SWR=30 | FN-API-006,FN-PUB-010,FN-PLAT-011 | UX-EVENT-009 | liveGuard/liveApi source | shared live GET adapter | CURRENT_VERIFIED |
| RH-022 | GET | /api/live/events/[id]/summary | live event summary counts | public event visibility + operation-mode live guard | bounded D1 aggregate | 5s isolate body cache; s-maxage=5/SWR=30 | FN-API-006,FN-PUB-024,FN-PLAT-011 | UX-PUB-006,UX-EVENT-007..008 | liveGuard/liveApi source | shared live GET adapter; retain one-pass count query | CURRENT_VERIFIED |
| RH-023 | GET | /api/media/[...key] | public R2 media | validated namespace/key + D1 public-entity ACL/fail-closed | D1 ACL + R2 GET + edge cache | long public cache; unavailable no-store | FN-API-011,FN-X-004,FN-PLAT-004 | UX-VID-008,UX-EVENT-006 | publicMediaRoute.contract + publicMedia tests | media service boundary; keep ACL before R2 exposure | CURRENT_VERIFIED |
| RH-024 | GET | /api/media/manage-x-icon/[...key] | signed manage X icon | short-lived HMAC signature; namespace restrictions | R2 GET only after signature | private bounded TTL | FN-API-011,FN-PER-007,FN-X-004 | UX-SET-003..004 | manageXIcon helper evidence | signed-media endpoint; no generic public-media merge | CURRENT_VERIFIED |
| RH-025 | GET | /api/media/slot-submission-icon/[slotId] | slot submission icon with public/private visibility | D1 probe; auth only for viewer-required modes; banned denied | 1 D1 probe + conditional Auth.js + R2 GET | public cache for public_name; private no-store otherwise | FN-API-011,FN-ENT-002,FN-PUB-012,FN-X-004 | UX-SLOT-004,UX-EVENT-013..016 | slotSubmissionIcon helper tests/evidence | preserve probe-before-auth optimization and visibility split | CURRENT_VERIFIED |
| RH-026 | GET | /api/public/about-stats | public about/top statistics | public artifact contract | R2 static top sections read | public/static cache; failure no-store | FN-API-004,FN-PUB-024,FN-PLAT-002 | UX-PUB-005 | about-stats route.contract test | static artifact read; no request-time D1 if avoidable | CURRENT_VERIFIED |
| RH-027 | OPTIONS | /api/public/events/[id]/staff | PVSF public staff API CORS preflight | strict origin/method/header allowlist | no data read/write | preflight max-age=3600 | FN-API-004,FN-X-003 | N/A — external PVSF API preflight | publicEventStaffRoute contract/execution tests | explicit CORS adapter; keep narrow allowlist | CURRENT_VERIFIED |
| RH-028 | GET | /api/public/events/[id]/staff | public event staff DTO | rate limit + CORS + strict visibility manifest + DTO allowlist | R2 event-base artifact + visibility fence recheck | public cache/ETag contract; unavailable fail-closed | FN-API-004,FN-PUB-010,FN-PLAT-004,FN-X-003,FN-X-010 | UX-EVENT-012; external PVSF consumer | publicEventStaffRoute contract/execution + publicEventStaff tests | static artifact API; preserve double visibility check | CURRENT_VERIFIED |
| RH-029 | GET | /api/software/suggestions | public software suggestions | public rate limit + explicit DTO | bounded catalog read | public API cache contract | FN-API-007,FN-ENT-005,FN-PLAT-002 | UX-SUB-011,UX-VID-015 | softwareSuggestions contract/execution tests | small public query; shared public API envelope | CURRENT_VERIFIED |
| RH-030 | GET | /api/videos/[id] | public video detail DTO | public rate limit + explicit DTO + visibility query | bounded D1 public-video lookup | public API response; failure no-store | FN-API-003,FN-PUB-002,FN-PUB-004,FN-X-003 | UX-VID-001..024 | publicApi/publicDto/publicRouteHardening tests | public detail query; can move toward static projection | CURRENT_VERIFIED |
| RH-031 | GET | /api/videos/[id]/viewer-overlay | viewer/private video overlay | session/viewer semantics inside overlay loader | static public detail + private viewer state | private no-store; 503 retry-after | FN-API-003,FN-PUB-008,FN-AUTH-009 | UX-VID-025..030 | viewerOverlay helper/source evidence | private overlay endpoint; separate from public video DTO | CURRENT_VERIFIED |
| RH-032 | GET | /api/videos | public video list/search | public rate limit + explicit DTO | R2/static list/search/event pages; bounded strategy | public cache by static artifact strategy | FN-API-003,FN-PUB-014,FN-PLAT-002,FN-PLAT-008 | UX-DISC-001..004,UX-GLOBAL-005 | publicApi/publicDto/publicRouteHardening tests | static-first query facade; no universal repository | CURRENT_VERIFIED |
| RH-033 | GET | /api/youtube-thumbnail/[id]/[size] | YouTube thumbnail proxy | strict YouTube ID/size allowlist | external image fetch/proxy | proxy cache/object size contract | FN-API-009 | UX-VID-004..005 | externalImageProxy + YouTube id evidence | prefer direct/static where safe; retain SSRF/size/type guard | CURRENT_VERIFIED |

## Reuse candidates

- **Public API envelope**: rate limit、explicit DTO、safe error、cache headerは共有可能。ただしvisibility source/static fallbackはrouteごとに明示する。
- **Admin write boundary**: same-origin + actor + operation-mode/write guardは共通化価値が高い。domain permission・danger semanticsは隠さない。
- **Live GET adapter**: `handleLiveApiGet` は既に良い共通核。payload queryは別関数のまま維持する。
- **Media delivery primitives**: key/type/size validation、R2 body cancellation、edge cache、safe errorは共有可能。public ACL・signed manage media・viewer-conditional mediaは同一guardへ統合しない。
- **Static-first public reads**: R2/static projection + explicit D1 fallback policyをread serviceとして整理する。maintenance/static_json_onlyのfail-closedを崩さない。
- **External image proxy**: Google Drive / YouTubeでtransport primitiveは共有できるが、ID allowlist・size tier・origin policyはprovider別に保持する。

## Intentional exceptions

- Auth.js catch-allはPhase 8まで独立compatibility boundary。
- legacy importはpreview token / CPU budget / partial progressがありgeneric admin CRUD化しない。
- spreadsheet bulk importは8MiB bounded stream、preview token、atomicity、static rebuild planがあり専用bulk commandを維持。
- public event staff APIは外部PVSF向けCORS＋visibility manifest再確認があり一般public GETへ平坦化しない。
- slot submission iconは**D1 probe → 必要時のみAuth.js**の順序がCPU最適化とprivacyの両方に効くため維持。
- deep healthはadmin token boundaryでpublic healthと統合しない。

## Frontend-impact blocker status

MIG-0004単体では、backend効率化のためfrontend behavior変更を必須とするblockerは確定していない。
public/live/media APIのcache/freshness変更はUXへ影響し得るため、MIG-0011で具体的な許容遅延・refresh semanticsと突合する。

## Acceptance

- [x] 28 route files
- [x] 33 HTTP method handlers
- [x] unclassified = 0
- [x] auth/permission/cache/rate/data/effect/FN/UX/tests/target disposition recorded
- [x] runtime behavior changed = 0
- [x] reusable transport primitivesとintentional safety exceptionsを分離
