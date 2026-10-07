# FlameNode CURRENT Screen / UX / FN Mapping

> Status: CURRENT_VERIFIED
> Verified: 2026-10-07
> Scope: 92 CURRENT page routes classified as visual / compat / dev / system + cross-route shells + all 432 UX surface tokens
> Route source: [`../CURRENT_ROUTES.md`](../CURRENT_ROUTES.md)
> UX source: [`../FRONTEND_FEATURES.md`](../FRONTEND_FEATURES.md)
> FN source: [`../FUNCTION_INVENTORY.md`](../FUNCTION_INVENTORY.md)
> Visual target: [`../UI_REFERENCE.md`](../UI_REFERENCE.md) = PENDING_HTML
> Production mutation: none

MIG-0010は「URLが残っている」だけでなく、各screenが必要なUX/FN、permission、状態、query/deep-link、responsive/accessibility contractを持つことを固定する。

## Coverage invariants

```text
CURRENT VISUAL_SCREEN = 74
COMPAT_REDIRECT = 9
DEV_ONLY = 3
SYSTEM_SURFACE = 6
page routes classified = 92
UX capabilities = 432
AUDIT_REQUIRED = 0
CURRENT_OBSERVED = 0
route classes with no mapping = 0
UX Surface tokens with no route/shell resolution = 0
visual source = PENDING_HTML
```

432 UXをこの文書へ複製しない。各UXのcapability/final disposition/FNは既存frontend ledgerを正本とし、その `Surface` tokenをvisual/compat/system/dev routeまたはcross-route shellへ解決してownershipを確定する。Final reconciliationは `../gap-scan/FRONTEND_REQUIREMENTS.md`。

## Contract profiles

### Permission

- `P-PUBLIC`: anonymous public read。visibility/public DTO/fail-closedはserver側で強制。
- `P-PUBLIC+OPTIONAL_AUTH`: public read + interaction/chapter等だけserver auth/terms/identity gate。
- `P-PUBLIC+TERMS`: public rules read + terms acceptance mutationはauth/write guard。
- `P-AUTH`: Auth User session + authoritative D1 current-user。
- `P-VIDEO-EDIT`: normal/event/admin privilege modeをserverで分離したvideo edit authorization。
- `P-VIDEO-DELEGATE`: creator-owner等のbounded collaborator delegation。UI表示を認可に使わない。
- `P-ENTRY`: auth + terms + approved Active X + event/slot/deadline rules。
- `P-MANAGE`: Auth Userに紐づく全approved X IDからconcrete event permissionをserver解決。Active Xは唯一のauthz主体ではない。
- `P-ADMIN`: authoritative D1 role=admin + ban/terms/write guard。
- `P-OPERATION-MODE`: maintenance/CostGuard policy + admin exception。
- `P-ONBOARDING`: auth + current prerequisite state。onboarding_completed_atをauthzに使わない。
- `P-AUTH-CALLBACK`: OAuth completion/session resolution + safe next。
- `P-DEV-CURRENT`: CURRENT dev surface access behaviorを移行時に勝手にproduction機能へ昇格しない。

### Dynamic state

- `S-PUBLIC`: ready / empty / stale / reflecting / unavailable / not_found + fail-closed visibility。
- `S-PUBLIC-ACTION`: S-PUBLIC + unauthenticated / terms / identity / pending / success / error / public-reflection。
- `S-AUTH-READ`: loading / unauthenticated / unavailable / banned / forbidden / empty / degraded。
- `S-AUTH+S-MUTATION`: read state + dirty / validation / pending / success / conflict / error / reflection。
- `S-AUTH+S-JOB`: read state + pending / processing / deferred / failed / dead_letter / success / stale / quota。
- `S-AUTH-FLOW`: missing session / bounded retry / unavailable / banned / safe redirect。
- `S-SYSTEM`: maintenance/degraded/error/404/dev-only state as applicable。

### URL/query/history

- `Q-DIRECT`: logical URL/deep-link/reload works; no route-local query state is part of the current page contract.
- `Q-CURRENT`: current page reads searchParams/GET state; preserve the exact current key/value/back-forward semantics until separately dispositioned.
- `Q-LIST(q,event,sort,page,view)`: logical `/list?... ` semantics survive removal of `/list/~query`.
- `Q-USER(q,sort,page)`: logical `/user?... ` semantics survive removal of `/user/~query`.
- `Q-EVENT(q,status,sort)`: logical `/event?... ` semantics survive removal of `/event/~query`.
- `Q-USER-PAGED(worksPage,collabPage)`: logical profile pagination survives removal of `/user/[id]/paged`.
- `Q-RULES(next,error)`: safe return path + terms result/error state remain deep-link safe.
- Query-bearing forms must preserve browser back/forward and reload, not only React in-memory state.

### Responsive/accessibility

- `RA-BASE`: mobile/tablet/desktopでprimary actionへ到達; keyboard operation; visible focus; semantic label/aria; disabled/loading meaning一致。
- `RA-MEDIA`: player/chapter controls are keyboard reachable; time/active state is not color-only。
- `RA-DENSE`: slot/table/dense operational data remains inspectable on narrow screens without hiding destructive/primary action。
- `RA-FORM`: label-help-error association, error summary/focus, pending/disabled semantics, destructive confirmation。
- `RA-LIST`: filter/search/sort/page controls remain reachable and URL state survives responsive layout changes。
- `RA-STATUS`: pending/degraded/quota/failed/dead-letter meaning is text/semantic state, not color-only。

## CURRENT VISUAL_SCREEN mapping

| Group | Route | Required local UX | Required local FN | Permission | Dynamic state | URL/query/history | Responsive/a11y | TARGET | State |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Public | `/` | UX-PUB-001..007 | FN-PLAT-007, FN-PUB-001, FN-PUB-009, FN-PUB-012, FN-PUB-016, FN-PUB-023..024 | P-PUBLIC | S-PUBLIC | Q-DIRECT | RA-BASE | same URL / Astro-site | CURRENT_MAPPED |
| Public | `/[id]` | UX-AUTH-023, UX-VID-001..055 | FN-API-003, FN-API-007, FN-AUTH-001, FN-AUTH-004, FN-AUTH-006, FN-AUTH-010, FN-JOB-005, FN-MNG-010, FN-PER-002, FN-PER-007, FN-PLAT-003..004, FN-PLAT-007..008, FN-PUB-002..008, FN-PUB-010, FN-PUB-018, FN-PUB-022, FN-X-004, FN-X-010 | P-PUBLIC+OPTIONAL_AUTH | S-PUBLIC-ACTION | Q-DIRECT | RA-BASE+RA-MEDIA | same URL / Astro-site | CURRENT_MAPPED |
| Public | `/about` | UX-PUB-008..009 | FN-PUB-020 | P-PUBLIC | S-PUBLIC | Q-DIRECT | RA-BASE | same URL / Astro-site | CURRENT_MAPPED |
| Public | `/event` | UX-EVENT-001..005, UX-GLOBAL-006 | FN-PUB-009, FN-PUB-026, FN-X-011 | P-PUBLIC | S-PUBLIC | Q-EVENT(q,status,sort) | RA-BASE+RA-LIST | same URL / Astro-site | CURRENT_MAPPED |
| Public | `/event/[id]` | UX-EVENT-006..012, UX-SLOT-001, UX-SUB-016 | FN-ENT-001..002, FN-ENT-006, FN-JOB-005, FN-PLAT-004, FN-PUB-010, FN-X-010 | P-PUBLIC | S-PUBLIC | Q-DIRECT | RA-BASE | same URL / Astro-site | CURRENT_MAPPED |
| Public | `/event/[id]/release` | UX-EVENT-017..019 | FN-PUB-011, FN-X-010 | P-PUBLIC | S-PUBLIC | Q-DIRECT | RA-BASE | same URL / Astro-site | CURRENT_MAPPED |
| Public | `/event/[id]/slots` | UX-EVENT-013..016 | FN-PUB-012, FN-X-004 | P-PUBLIC | S-PUBLIC | Q-DIRECT | RA-BASE+RA-DENSE | same URL / Astro-site | CURRENT_MAPPED |
| Public | `/list` | UX-DISC-001..009, UX-DISC-016, UX-GLOBAL-005..006 | FN-PLAT-007, FN-PUB-014, FN-PUB-026, FN-X-003..004, FN-X-010..011 | P-PUBLIC | S-PUBLIC | Q-LIST(q,event,sort,page,view) | RA-BASE+RA-LIST | same URL / Astro-site | CURRENT_MAPPED |
| Public | `/recommend` | UX-DISC-010..012, UX-DISC-016 | FN-PLAT-007, FN-PUB-015, FN-X-003..004, FN-X-010 | P-PUBLIC | S-PUBLIC | Q-DIRECT | RA-BASE | same URL / Astro-site | CURRENT_MAPPED |
| Public | `/rules` | UX-ADM-068, UX-AUTH-013, UX-PUB-010..011 | FN-ADM-020, FN-AUTH-006, FN-PUB-021 | P-PUBLIC+TERMS | S-PUBLIC-ACTION | Q-RULES(next,error) | RA-BASE | same URL / Astro-site | CURRENT_MAPPED |
| Public | `/trending` | UX-DISC-013..016 | FN-PLAT-009, FN-PUB-016, FN-X-003..004, FN-X-010 | P-PUBLIC | S-PUBLIC | Q-DIRECT | RA-BASE | same URL / Astro-site | CURRENT_MAPPED |
| Public | `/user` | UX-GLOBAL-006, UX-USER-001..005, UX-USER-016 | FN-PUB-017..018, FN-PUB-026, FN-X-004, FN-X-011 | P-PUBLIC | S-PUBLIC | Q-USER(q,sort,page) | RA-BASE+RA-LIST | same URL / Astro-site | CURRENT_MAPPED |
| Public | `/user/[id]` | UX-USER-006..014, UX-USER-016 | FN-PUB-017..018, FN-X-004, FN-X-011 | P-PUBLIC | S-PUBLIC | Q-USER-PAGED(worksPage,collabPage) | RA-BASE | same URL / Astro-site | CURRENT_MAPPED |
| Public | `/user/[id]/portfolio` | UX-USER-015..016 | FN-PUB-017..019, FN-X-004 | P-PUBLIC | S-PUBLIC | Q-DIRECT | RA-BASE | same URL / Astro-site | CURRENT_MAPPED |
| Personal | `/dashboard` | UX-AUTH-023, UX-DASH-001..004, UX-SLOT-004 | FN-AUTH-010, FN-ENT-002, FN-PER-001, FN-PER-007 | P-AUTH | S-AUTH-READ | Q-DIRECT | RA-BASE | same URL / React-Vite SPA | CURRENT_MAPPED |
| Personal | `/dashboard/edit/[id]` | UX-DASH-005..015, UX-SUB-015, UX-SUB-018, UX-VID-050..051 | FN-ENT-003..004, FN-ENT-006, FN-PER-002..003, FN-PLAT-004, FN-PUB-005, FN-X-002 | P-VIDEO-EDIT | S-AUTH+S-MUTATION | Q-CURRENT | RA-BASE+RA-FORM | same URL / React-Vite SPA | CURRENT_MAPPED |
| Personal | `/dashboard/edit/[id]/permissions` | UX-DASH-016..019 | FN-PER-003, FN-X-001 | P-VIDEO-DELEGATE | S-AUTH+S-MUTATION | Q-CURRENT | RA-BASE+RA-FORM | same URL / React-Vite SPA | CURRENT_MAPPED |
| Personal | `/dashboard/library` | UX-LIB-001..012 | FN-AUTH-010, FN-PER-003..004, FN-PUB-005, FN-PUB-007..008, FN-X-011 | P-AUTH | S-AUTH-READ | Q-CURRENT | RA-BASE | same URL / React-Vite SPA | CURRENT_MAPPED |
| Personal | `/dashboard/settings` | UX-AUTH-006..007, UX-AUTH-015..019, UX-SET-001..005 | FN-AUTH-003, FN-AUTH-009..010, FN-PER-005, FN-PER-007 | P-AUTH | S-AUTH+S-MUTATION | Q-CURRENT | RA-BASE+RA-FORM | same URL / React-Vite SPA | CURRENT_MAPPED |
| Entry | `/entry` | UX-AUTH-001..002, UX-AUTH-023, UX-ENTRY-001..007, UX-SLOT-001..007, UX-SUB-017, UX-SUB-025 | FN-AUTH-001..002, FN-AUTH-006..007, FN-AUTH-010, FN-ENT-001..004, FN-ENT-006, FN-MNG-004, FN-PER-007, FN-PLAT-004 | P-ENTRY | S-AUTH+S-MUTATION | Q-CURRENT | RA-BASE+RA-FORM | same URL / React-Vite SPA | CURRENT_MAPPED |
| Entry | `/entry/slotted` | UX-SLOT-002..003, UX-SLOT-007..009, UX-SUB-002..021, UX-SUB-023..026 | FN-API-007, FN-AUTH-010, FN-ENT-002..006, FN-JOB-005, FN-PLAT-004 | P-ENTRY | S-AUTH+S-MUTATION | Q-CURRENT | RA-BASE+RA-FORM | same URL / React-Vite SPA | CURRENT_MAPPED |
| Entry | `/entry/unslotted` | UX-SLOT-002..003, UX-SLOT-007, UX-SUB-001..015, UX-SUB-017..020, UX-SUB-022..025 | FN-API-007, FN-AUTH-010, FN-ENT-002..006, FN-JOB-005, FN-PLAT-004 | P-ENTRY | S-AUTH+S-MUTATION | Q-CURRENT | RA-BASE+RA-FORM | same URL / React-Vite SPA | CURRENT_MAPPED |
| Manage | `/manage` | UX-MNG-001..004 | FN-MNG-001..002, FN-X-002 | P-MANAGE | S-AUTH+S-MUTATION | Q-DIRECT | RA-BASE | same URL / React-Vite SPA | CURRENT_MAPPED |
| Manage | `/manage/events/[id]` | UX-MNG-009..010 | FN-MNG-002 | P-MANAGE | S-AUTH+S-MUTATION | Q-CURRENT | RA-BASE | same URL / React-Vite SPA | CURRENT_MAPPED |
| Manage | `/manage/events/[id]/audience` | UX-MNG-010..012 | FN-MNG-002..003, FN-X-002 | P-MANAGE | S-AUTH+S-MUTATION | Q-DIRECT | RA-BASE | same URL / React-Vite SPA | CURRENT_MAPPED |
| Manage | `/manage/events/[id]/edit` | UX-MNG-010, UX-MNG-013..019 | FN-ENT-006, FN-MNG-002, FN-MNG-004, FN-X-002 | P-MANAGE | S-AUTH+S-MUTATION | Q-DIRECT | RA-BASE+RA-FORM | same URL / React-Vite SPA | CURRENT_MAPPED |
| Manage | `/manage/events/[id]/slots` | UX-MNG-010, UX-MNG-027..036 | FN-JOB-006, FN-MNG-002, FN-MNG-006 | P-MANAGE | S-AUTH+S-MUTATION | Q-CURRENT | RA-BASE+RA-DENSE | same URL / React-Vite SPA | CURRENT_MAPPED |
| Manage | `/manage/events/[id]/staff` | UX-MNG-010, UX-MNG-037..043 | FN-MNG-002, FN-MNG-007, FN-X-001..002 | P-MANAGE | S-AUTH+S-MUTATION | Q-DIRECT | RA-BASE+RA-FORM | same URL / React-Vite SPA | CURRENT_MAPPED |
| Manage | `/manage/events/[id]/videos` | UX-MNG-010, UX-MNG-044..045 | FN-MNG-002, FN-MNG-008 | P-MANAGE | S-AUTH+S-MUTATION | Q-CURRENT | RA-BASE | same URL / React-Vite SPA | CURRENT_MAPPED |
| Manage | `/manage/events/[id]/videos/[videoId]` | UX-MNG-010, UX-MNG-046..050 | FN-MNG-002, FN-MNG-009, FN-PLAT-004, FN-X-005 | P-MANAGE | S-AUTH+S-MUTATION | Q-DIRECT | RA-BASE | same URL / React-Vite SPA | CURRENT_MAPPED |
| Manage | `/manage/events/[id]/youtube-playlist` | UX-MNG-010, UX-MNG-051..053 | FN-JOB-005, FN-MNG-002, FN-MNG-010 | P-MANAGE | S-AUTH+S-JOB | Q-CURRENT | RA-BASE+RA-STATUS | same URL / React-Vite SPA | CURRENT_MAPPED |
| Manage | `/manage/notifications` | UX-MNG-054..057 | FN-JOB-006, FN-MNG-011 | P-MANAGE | S-AUTH+S-JOB | Q-CURRENT | RA-BASE+RA-LIST+RA-STATUS | same URL / React-Vite SPA | CURRENT_MAPPED |
| Manage | `/manage/x-link-requests` | UX-MNG-058..060 | FN-MNG-012, FN-X-005 | P-MANAGE | S-AUTH+S-MUTATION | Q-DIRECT | RA-BASE | same URL / React-Vite SPA | CURRENT_MAPPED |
| Admin | `/admin` | UX-ADM-001 | FN-ADM-001 | P-ADMIN | S-AUTH+S-MUTATION | Q-DIRECT | RA-BASE | same URL / React-Vite SPA | CURRENT_MAPPED |
| Admin | `/admin/announcements` | UX-ADM-003, UX-ADM-006..007 | FN-ADM-002, FN-X-005 | P-ADMIN | S-AUTH+S-MUTATION | Q-CURRENT | RA-BASE | same URL / React-Vite SPA | CURRENT_MAPPED |
| Admin | `/admin/announcements/[id]/edit` | UX-ADM-005..007 | FN-ADM-002, FN-X-005 | P-ADMIN | S-AUTH+S-MUTATION | Q-DIRECT | RA-BASE+RA-FORM | same URL / React-Vite SPA | CURRENT_MAPPED |
| Admin | `/admin/announcements/new` | UX-ADM-004, UX-ADM-006..007 | FN-ADM-002, FN-X-005 | P-ADMIN | S-AUTH+S-MUTATION | Q-DIRECT | RA-BASE+RA-FORM | same URL / React-Vite SPA | CURRENT_MAPPED |
| Admin | `/admin/api-endpoints` | UX-ADM-008..010 | FN-ADM-003 | P-ADMIN | S-AUTH+S-MUTATION | Q-CURRENT | RA-BASE | same URL / React-Vite SPA | CURRENT_MAPPED |
| Admin | `/admin/audit` | UX-ADM-011, UX-ADM-020 | FN-ADM-004, FN-ADM-015 | P-ADMIN | S-AUTH-READ | Q-CURRENT | RA-BASE+RA-LIST | same URL / React-Vite SPA | CURRENT_MAPPED |
| Admin | `/admin/audit/[id]` | UX-ADM-012..014, UX-ADM-020 | FN-ADM-004, FN-ADM-015 | P-ADMIN | S-AUTH+S-MUTATION | Q-DIRECT | RA-BASE | same URL / React-Vite SPA | CURRENT_MAPPED |
| Admin | `/admin/audit/restore` | UX-ADM-015..017 | FN-ADM-005 | P-ADMIN | S-AUTH+S-MUTATION | Q-DIRECT | RA-BASE+RA-FORM | same URL / React-Vite SPA | CURRENT_MAPPED |
| Admin | `/admin/audit/settings` | UX-ADM-018 | FN-ADM-006 | P-ADMIN | S-AUTH+S-MUTATION | Q-DIRECT | RA-BASE+RA-FORM | same URL / React-Vite SPA | CURRENT_MAPPED |
| Admin | `/admin/cost-guard` | UX-ADM-021..023 | FN-ADM-007 | P-ADMIN | S-AUTH+S-MUTATION | Q-DIRECT | RA-BASE | same URL / React-Vite SPA | CURRENT_MAPPED |
| Admin | `/admin/event-groups` | UX-ADM-025, UX-ADM-028 | FN-ADM-008 | P-ADMIN | S-AUTH+S-MUTATION | Q-CURRENT | RA-BASE | same URL / React-Vite SPA | CURRENT_MAPPED |
| Admin | `/admin/event-groups/[id]/edit` | UX-ADM-027..028 | FN-ADM-008 | P-ADMIN | S-AUTH+S-MUTATION | Q-DIRECT | RA-BASE+RA-FORM | same URL / React-Vite SPA | CURRENT_MAPPED |
| Admin | `/admin/event-groups/new` | UX-ADM-026, UX-ADM-028 | FN-ADM-008 | P-ADMIN | S-AUTH+S-MUTATION | Q-DIRECT | RA-BASE+RA-FORM | same URL / React-Vite SPA | CURRENT_MAPPED |
| Admin | `/admin/events` | UX-ADM-029, UX-ADM-033, UX-ADM-036..037 | FN-ADM-009, FN-ADM-012, FN-X-001, FN-X-005 | P-ADMIN | S-AUTH+S-MUTATION | Q-CURRENT | RA-BASE+RA-LIST | same URL / React-Vite SPA | CURRENT_MAPPED |
| Admin | `/admin/events/new` | UX-ADM-031, UX-ADM-033, UX-ADM-036..037 | FN-ADM-009, FN-ADM-012, FN-X-001, FN-X-005 | P-ADMIN | S-AUTH+S-MUTATION | Q-CURRENT | RA-BASE+RA-FORM | same URL / React-Vite SPA | CURRENT_MAPPED |
| Admin | `/admin/events/templates` | UX-ADM-033, UX-ADM-036..040 | FN-ADM-009..010, FN-ADM-012, FN-X-001, FN-X-005 | P-ADMIN | S-AUTH+S-MUTATION | Q-DIRECT | RA-BASE | same URL / React-Vite SPA | CURRENT_MAPPED |
| Admin | `/admin/health` | UX-ADM-041..042 | FN-ADM-013 | P-ADMIN | S-AUTH-READ | Q-CURRENT | RA-BASE+RA-STATUS | same URL / React-Vite SPA | CURRENT_MAPPED |
| Admin | `/admin/health/integrity` | UX-ADM-043..044 | FN-ADM-014 | P-ADMIN | S-AUTH-READ | Q-CURRENT | RA-BASE+RA-STATUS | same URL / React-Vite SPA | CURRENT_MAPPED |
| Admin | `/admin/import` | UX-ADM-049..052 | FN-ADM-016 | P-ADMIN | S-AUTH+S-MUTATION | Q-DIRECT | RA-BASE | same URL / React-Vite SPA | CURRENT_MAPPED |
| Admin | `/admin/moderation` | UX-ADM-053..056 | FN-ADM-017, FN-X-005 | P-ADMIN | S-AUTH+S-MUTATION | Q-CURRENT | RA-BASE | same URL / React-Vite SPA | CURRENT_MAPPED |
| Admin | `/admin/notifications` | UX-ADM-057..060 | FN-ADM-018, FN-JOB-006 | P-ADMIN | S-AUTH+S-JOB | Q-CURRENT | RA-BASE+RA-LIST+RA-STATUS | same URL / React-Vite SPA | CURRENT_MAPPED |
| Admin | `/admin/permissions/simulator` | UX-ADM-061..063 | FN-ADM-019, FN-X-002 | P-ADMIN | S-AUTH+S-MUTATION | Q-CURRENT | RA-BASE+RA-FORM | same URL / React-Vite SPA | CURRENT_MAPPED |
| Admin | `/admin/rules` | UX-ADM-064, UX-ADM-067..068 | FN-ADM-020, FN-AUTH-006 | P-ADMIN | S-AUTH+S-MUTATION | Q-CURRENT | RA-BASE | same URL / React-Vite SPA | CURRENT_MAPPED |
| Admin | `/admin/rules/[id]/edit` | UX-ADM-066..068 | FN-ADM-020, FN-AUTH-006 | P-ADMIN | S-AUTH+S-MUTATION | Q-DIRECT | RA-BASE+RA-FORM | same URL / React-Vite SPA | CURRENT_MAPPED |
| Admin | `/admin/rules/new` | UX-ADM-065, UX-ADM-067..068 | FN-ADM-020, FN-AUTH-006 | P-ADMIN | S-AUTH+S-MUTATION | Q-DIRECT | RA-BASE+RA-FORM | same URL / React-Vite SPA | CURRENT_MAPPED |
| Admin | `/admin/security` | UX-ADM-045..046 | FN-ADM-021, FN-X-004 | P-ADMIN | S-AUTH-READ | Q-CURRENT | RA-BASE | same URL / React-Vite SPA | CURRENT_MAPPED |
| Admin | `/admin/spreadsheet` | UX-ADM-069..072 | FN-ADM-022, FN-X-005 | P-ADMIN | S-AUTH+S-MUTATION | Q-CURRENT | RA-BASE+RA-FORM | same URL / React-Vite SPA | CURRENT_MAPPED |
| Admin | `/admin/static-builds` | UX-ADM-073..075 | FN-ADM-023, FN-PLAT-003, FN-PLAT-010 | P-ADMIN | S-AUTH+S-JOB | Q-CURRENT | RA-BASE+RA-LIST+RA-STATUS | same URL / React-Vite SPA | CURRENT_MAPPED |
| Admin | `/admin/users` | UX-ADM-076 | FN-ADM-024 | P-ADMIN | S-AUTH+S-MUTATION | Q-CURRENT | RA-BASE+RA-LIST | same URL / React-Vite SPA | CURRENT_MAPPED |
| Admin | `/admin/users/[id]` | UX-ADM-077..078, UX-ADM-081..082 | FN-ADM-024, FN-X-005 | P-ADMIN | S-AUTH+S-MUTATION | Q-DIRECT | RA-BASE | same URL / React-Vite SPA | CURRENT_MAPPED |
| Admin | `/admin/users/[id]/edit` | UX-ADM-079..082 | FN-ADM-024, FN-X-005 | P-ADMIN | S-AUTH+S-MUTATION | Q-DIRECT | RA-BASE+RA-FORM | same URL / React-Vite SPA | CURRENT_MAPPED |
| Admin | `/admin/videos` | UX-ADM-083 | FN-ADM-025 | P-ADMIN | S-AUTH+S-MUTATION | Q-CURRENT | RA-BASE+RA-LIST | same URL / React-Vite SPA | CURRENT_MAPPED |
| Admin | `/admin/videos/[id]` | UX-ADM-084..087, UX-ADM-091 | FN-ADM-025..026, FN-PLAT-004, FN-X-005 | P-ADMIN | S-AUTH+S-MUTATION | Q-CURRENT | RA-BASE | same URL / React-Vite SPA | CURRENT_MAPPED |
| Admin | `/admin/videos/[id]/members` | UX-ADM-085..091 | FN-ADM-025..026, FN-PLAT-004, FN-X-005 | P-ADMIN | S-AUTH+S-MUTATION | Q-DIRECT | RA-BASE+RA-FORM | same URL / React-Vite SPA | CURRENT_MAPPED |
| Admin | `/admin/workers` | UX-ADM-047..048 | FN-ADM-027 | P-ADMIN | S-AUTH+S-JOB | Q-DIRECT | RA-BASE+RA-STATUS | same URL / React-Vite SPA | CURRENT_MAPPED |
| Admin | `/admin/x-id-merges` | UX-ADM-092..095 | FN-ADM-028, FN-X-005 | P-ADMIN | S-AUTH+S-MUTATION | Q-CURRENT | RA-BASE | same URL / React-Vite SPA | CURRENT_MAPPED |
| Admin | `/admin/x-link-requests` | UX-ADM-096..099 | FN-ADM-029, FN-X-005 | P-ADMIN | S-AUTH+S-MUTATION | Q-DIRECT | RA-BASE | same URL / React-Vite SPA | CURRENT_MAPPED |
| Admin | `/admin/youtube-quota` | UX-ADM-100..101 | FN-ADM-030 | P-ADMIN | S-AUTH+S-JOB | Q-DIRECT | RA-BASE+RA-STATUS | same URL / React-Vite SPA | CURRENT_MAPPED |
| Admin | `/admin/youtube-sync` | UX-ADM-102..104 | FN-ADM-031, FN-JOB-005 | P-ADMIN | S-AUTH+S-JOB | Q-CURRENT | RA-BASE+RA-LIST+RA-STATUS | same URL / React-Vite SPA | CURRENT_MAPPED |
| Admin | `/admin/youtube-sync/playlists` | UX-ADM-105..107 | FN-ADM-031, FN-JOB-005 | P-ADMIN | S-AUTH+S-JOB | Q-CURRENT | RA-BASE+RA-STATUS | same URL / React-Vite SPA | CURRENT_MAPPED |
| System | `/onboarding` | UX-ADM-068, UX-AUTH-011..013 | FN-ADM-020, FN-AUTH-005..006 | P-ONBOARDING | S-AUTH+S-MUTATION | Q-CURRENT | RA-BASE | same URL / React-Vite SPA | CURRENT_MAPPED |

## COMPAT_REDIRECT mapping

These rows own legacy/deep-link URL contracts, not independent visual screens.

| Source | Destination | UX disposition owner | Query/hash/role contract | State |
| --- | --- | --- | --- | --- |
| `/groups` | `/event` | UX-EVENT-020, UX-EVENT-024 | source query/hash not forwarded | COMPAT_MAPPED |
| `/groups/[slug]` | `/event#event-group-{slug}` | UX-EVENT-021..024 | slug → event-group hash | COMPAT_MAPPED |
| `/dashboard/youtube-playlists` | `admin: /admin/youtube-sync/playlists; other auth: /dashboard` | UX-SET-006..008 | auth guard; admin role branch | COMPAT_MAPPED |
| `/manage/events/[id]/review` | `/manage/events/[id]/videos?status=pending` | UX-MNG-010, UX-MNG-020..026 | destination query forced to status=pending | COMPAT_MAPPED |
| `/admin/events/[id]` | `/manage/events/[id]` | UX-ADM-030, UX-ADM-033, UX-ADM-036..037 | source query/hash not forwarded | COMPAT_MAPPED |
| `/admin/events/[id]/edit` | `/manage/events/[id]/edit` | UX-ADM-032..033, UX-ADM-036..037 | source query/hash not forwarded | COMPAT_MAPPED |
| `/admin/events/[id]/slots` | `/manage/events/[id]/slots` | UX-ADM-033..034, UX-ADM-036..037 | source query/hash not forwarded | COMPAT_MAPPED |
| `/admin/events/[id]/staff` | `/manage/events/[id]/staff` | UX-ADM-033, UX-ADM-035..037 | source query/hash not forwarded | COMPAT_MAPPED |
| `/admin/history` | `/admin/audit` | UX-ADM-019..020 | source query/hash not forwarded | COMPAT_MAPPED |

## DEV_ONLY page mapping

| Group | Route | Required local UX | Required local FN | Permission | Dynamic state | URL/query/history | Responsive/a11y | TARGET | State |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| System | `/dev/ui-surfaces` | UX-SYS-003 | FN-PLAT-012 | P-DEV-CURRENT | S-SYSTEM | Q-DIRECT | RA-BASE | dev-only / migration disposition | CURRENT_MAPPED |

## SYSTEM_SURFACE page mapping

| Group | Route | Required local UX | Required local FN | Permission | Dynamic state | URL/query/history | Responsive/a11y | TARGET | State |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| System | `/maintenance` | UX-SYS-001..002 | FN-PLAT-011, FN-X-002 | P-OPERATION-MODE | S-SYSTEM | Q-DIRECT | RA-BASE | same URL / site-system | CURRENT_MAPPED |
| System | `/auth/complete` | UX-AUTH-002 | FN-AUTH-001, FN-AUTH-007 | P-AUTH-CALLBACK | S-AUTH-FLOW | Q-CURRENT | RA-BASE | same URL / auth target | CURRENT_MAPPED |

| System | `/event/~query` | UX-EVENT-001..005, UX-GLOBAL-019 | FN-PUB-009, FN-PUB-026, FN-X-011 | P-PUBLIC | S-PUBLIC | Q-EVENT(q,status,sort) | RA-BASE+RA-LIST | technical renderer only | SYSTEM_MAPPED |
| System | `/list/~query` | UX-DISC-001..009, UX-GLOBAL-019 | FN-PUB-014, FN-PUB-026, FN-X-011 | P-PUBLIC | S-PUBLIC | Q-LIST(q,event,sort,page,view) | RA-BASE+RA-LIST | technical renderer only | SYSTEM_MAPPED |
| System | `/user/~query` | UX-USER-001..005, UX-GLOBAL-019 | FN-PUB-017, FN-X-011 | P-PUBLIC | S-PUBLIC | Q-USER(q,sort,page) | RA-BASE+RA-LIST | technical renderer only | SYSTEM_MAPPED |
| System | `/user/[id]/paged` | UX-USER-006..014, UX-GLOBAL-019 | FN-PUB-018, FN-X-011 | P-PUBLIC | S-PUBLIC | Q-USER-PAGED(worksPage,collabPage) | RA-BASE | technical renderer only | SYSTEM_MAPPED |

## Cross-route shell mapping

| Shell | Contract | Required UX | Required FN | Responsive/a11y | State |
| --- | --- | --- | --- | --- | --- |
| `shell:ADMIN` | admin-only console authorization/navigation shell | UX-ADM-002, UX-GLOBAL-030 | FN-ADM-001, FN-X-002 | RA-BASE | CURRENT_MAPPED |
| `shell:ALL` | 全frontend共通theme/deep-link/responsive/keyboard/focus contract | UX-AUTH-014, UX-AUTH-022, UX-GLOBAL-007..009, UX-GLOBAL-019..022 | FN-AUTH-006, FN-AUTH-009..010, FN-PUB-027, FN-X-011 | RA-BASE | CURRENT_MAPPED |
| `shell:AUTH_ACCOUNT` | account menu / Active X / logout identity shell | UX-AUTH-001, UX-AUTH-010, UX-AUTH-019..021, UX-GLOBAL-014, UX-VID-049 | FN-AUTH-001, FN-AUTH-008, FN-AUTH-010, FN-PUB-005 | RA-BASE | CURRENT_MAPPED |
| `shell:AUTH_FLOW` | OAuth/login completion/open-redirect protection flow | UX-AUTH-003 | FN-AUTH-007 | RA-BASE | CURRENT_MAPPED |
| `shell:CONSOLE` | admin/manage console mode/sidebar distinction | UX-GLOBAL-029 | FN-ADM-001, FN-MNG-002 | RA-BASE | CURRENT_MAPPED |
| `shell:ERROR` | recoverable route/group error surface | UX-GLOBAL-023 |  | RA-BASE | CURRENT_MAPPED |
| `shell:GLOBAL_ERROR` | catastrophic root error surface | UX-GLOBAL-024 |  | RA-BASE | CURRENT_MAPPED |
| `shell:MANAGE` | event-scoped manage authorization/sidebar/identity shell | UX-GLOBAL-031..033, UX-MNG-005..008 | FN-AUTH-010, FN-MNG-001..002, FN-MNG-012, FN-X-002 | RA-BASE | CURRENT_MAPPED |
| `shell:NOT_FOUND` | safe unknown/non-public 404 surface | UX-GLOBAL-025 | FN-PLAT-004, FN-X-010 | RA-BASE | CURRENT_MAPPED |
| `shell:OPERATION_MODE` | CostGuard/maintenance warning and access shell | UX-ADM-024, UX-GLOBAL-028 | FN-ADM-007, FN-PLAT-011 | RA-BASE | CURRENT_MAPPED |
| `shell:PRIVATE` | authenticated direct-URL/session/banned/role shell | UX-AUTH-004..005, UX-AUTH-008..009, UX-GLOBAL-018 | FN-AUTH-002, FN-AUTH-004, FN-AUTH-009, FN-X-002 | RA-BASE | CURRENT_MAPPED |
| `shell:PUBLIC` | public layout/footer/SEO/degraded visibility contract | UX-GLOBAL-017, UX-GLOBAL-026, UX-PUB-012 | FN-PLAT-007, FN-PUB-022, FN-PUB-025, FN-X-010 | RA-BASE | CURRENT_MAPPED |
| `shell:PUBLIC_HEADER` | public header/navigation/search/account-presence contract | UX-AUTH-005, UX-GLOBAL-001..006, UX-GLOBAL-010..016 | FN-AUTH-001..002, FN-AUTH-009, FN-PUB-025..026, FN-X-002 | RA-BASE | CURRENT_MAPPED |
| `shell:PUBLIC_MUTATION` | public projection reflecting/pending feedback | UX-GLOBAL-027 | FN-PLAT-003 | RA-BASE | CURRENT_MAPPED |
| `shell:ROBOTS` | crawler indexing policy surface | UX-SYS-004 | FN-PUB-022, FN-X-011 | RA-BASE | CURRENT_MAPPED |
| `shell:SITEMAP` | public URL discovery surface | UX-SYS-005 | FN-PUB-022 | RA-BASE | CURRENT_MAPPED |

Shell ownership is additional to route-local mapping。例えば `UX-GLOBAL-020..022` は各route行へ重複展開せず `shell:ALL` から全frontendへ継承する。

## UX Surface resolution ledger

Frontend ledgersの `Surface` tokenを以下でroute/shellへ解決する。MIG-0010 checkerは全432 UX rowのSurface tokenがこの表に存在し、ownerが空でないことを要求する。

| Source Surface token | Owner route/shell | UX IDs using token |
| --- | --- | --- |
| `.../audience` | `/manage/events/[id]/audience` | UX-MNG-011..012 |
| `.../edit` | `/manage/events/[id]/edit` | UX-MNG-013..019 |
| `.../review` | `/manage/events/[id]/videos`, `/manage/events/[id]/review` | UX-MNG-020..026 |
| `.../slots` | `/manage/events/[id]/slots` | UX-MNG-027..036 |
| `.../staff` | `/manage/events/[id]/staff` | UX-MNG-037..043 |
| `.../videos` | `/manage/events/[id]/videos` | UX-MNG-044..045 |
| `.../videos/[videoId]` | `/manage/events/[id]/videos/[videoId]` | UX-MNG-046 |
| `.../youtube-playlist` | `/manage/events/[id]/youtube-playlist` | UX-MNG-051..053 |
| `/` | `/` | UX-PUB-001..007 |
| `/[id]` | `/[id]` | UX-VID-001..048, UX-VID-052..055 |
| `/about` | `/about` | UX-PUB-008..009 |
| `/admin` | `/admin` | UX-ADM-001 |
| `/admin/announcements` | `/admin/announcements` | UX-ADM-003 |
| `/admin/announcements/[id]/edit` | `/admin/announcements/[id]/edit` | UX-ADM-005 |
| `/admin/announcements/new` | `/admin/announcements/new` | UX-ADM-004 |
| `/admin/api-endpoints` | `/admin/api-endpoints` | UX-ADM-008..010 |
| `/admin/audit` | `/admin/audit` | UX-ADM-011 |
| `/admin/audit/[id]` | `/admin/audit/[id]` | UX-ADM-012 |
| `/admin/audit/restore` | `/admin/audit/restore` | UX-ADM-015..017 |
| `/admin/audit/settings` | `/admin/audit/settings` | UX-ADM-018 |
| `/admin/cost-guard` | `/admin/cost-guard` | UX-ADM-021..023 |
| `/admin/event-groups` | `/admin/event-groups` | UX-ADM-025 |
| `/admin/event-groups/[id]/edit` | `/admin/event-groups/[id]/edit` | UX-ADM-027 |
| `/admin/event-groups/new` | `/admin/event-groups/new` | UX-ADM-026 |
| `/admin/events` | `/admin/events` | UX-ADM-029 |
| `/admin/events/[id]` | `/manage/events/[id]`, `/admin/events/[id]` | UX-ADM-030 |
| `/admin/events/[id]/edit` | `/manage/events/[id]/edit`, `/admin/events/[id]/edit` | UX-ADM-032 |
| `/admin/events/[id]/slots` | `/manage/events/[id]/slots`, `/admin/events/[id]/slots` | UX-ADM-034 |
| `/admin/events/[id]/staff` | `/manage/events/[id]/staff`, `/admin/events/[id]/staff` | UX-ADM-035 |
| `/admin/events/new` | `/admin/events/new` | UX-ADM-031 |
| `/admin/events/templates` | `/admin/events/templates` | UX-ADM-038 |
| `/admin/health` | `/admin/health` | UX-ADM-041..042 |
| `/admin/health/integrity` | `/admin/health/integrity` | UX-ADM-043 |
| `/admin/history` | `/admin/audit`, `/admin/history` | UX-ADM-019 |
| `/admin/import` | `/admin/import` | UX-ADM-049..052 |
| `/admin/moderation` | `/admin/moderation` | UX-ADM-053..056 |
| `/admin/notifications` | `/admin/notifications` | UX-ADM-057..060 |
| `/admin/permissions/simulator` | `/admin/permissions/simulator` | UX-ADM-061 |
| `/admin/rules` | `/admin/rules` | UX-ADM-064 |
| `/admin/rules/[id]/edit` | `/admin/rules/[id]/edit` | UX-ADM-066 |
| `/admin/rules/new` | `/admin/rules/new` | UX-ADM-065 |
| `/admin/security` | `/admin/security` | UX-ADM-045 |
| `/admin/spreadsheet` | `/admin/spreadsheet` | UX-ADM-069..070 |
| `/admin/static-builds` | `/admin/static-builds` | UX-ADM-073 |
| `/admin/users` | `/admin/users` | UX-ADM-076 |
| `/admin/users/[id]` | `/admin/users/[id]` | UX-ADM-077 |
| `/admin/users/[id]/edit` | `/admin/users/[id]/edit` | UX-ADM-079 |
| `/admin/videos` | `/admin/videos` | UX-ADM-083 |
| `/admin/videos/[id]` | `/admin/videos/[id]` | UX-ADM-084 |
| `/admin/videos/[id]/members` | `/admin/videos/[id]/members` | UX-ADM-088 |
| `/admin/workers` | `/admin/workers` | UX-ADM-047..048 |
| `/admin/x-id-merges` | `/admin/x-id-merges` | UX-ADM-092 |
| `/admin/x-link-requests` | `/admin/x-link-requests` | UX-ADM-096 |
| `/admin/youtube-quota` | `/admin/youtube-quota` | UX-ADM-100 |
| `/admin/youtube-sync` | `/admin/youtube-sync` | UX-ADM-102 |
| `/admin/youtube-sync/playlists` | `/admin/youtube-sync/playlists` | UX-ADM-105 |
| `/dashboard` | `/dashboard` | UX-DASH-001..004 |
| `/dashboard/edit/[id]` | `/dashboard/edit/[id]` | UX-DASH-005..015 |
| `/dashboard/edit/[id]/permissions` | `/dashboard/edit/[id]/permissions` | UX-DASH-016 |
| `/dashboard/library` | `/dashboard/library` | UX-LIB-006..007, UX-LIB-009..012 |
| `/dashboard/library → video` | `/dashboard/library` | UX-LIB-008 |
| `/dashboard/library?tab=bookmark` | `/dashboard/library` | UX-LIB-002 |
| `/dashboard/library?tab=chapters` | `/dashboard/library` | UX-LIB-005 |
| `/dashboard/library?tab=collab` | `/dashboard/library` | UX-LIB-004 |
| `/dashboard/library?tab=like` | `/dashboard/library` | UX-LIB-001 |
| `/dashboard/library?tab=mine` | `/dashboard/library` | UX-LIB-003 |
| `/dashboard/settings` | `/dashboard/settings` | UX-AUTH-016, UX-SET-001..005 |
| `/dashboard/youtube-playlists` | `/dashboard/youtube-playlists` | UX-SET-006..008 |
| `/dev/ui-surfaces` | `/dev/ui-surfaces` | UX-SYS-003 |
| `/entry` | `/entry` | UX-ENTRY-001..007 |
| `/entry/slotted` | `/entry/slotted` | UX-SLOT-008..009, UX-SUB-021 |
| `/entry/unslotted` | `/entry/unslotted` | UX-SUB-001, UX-SUB-022 |
| `/event` | `/event` | UX-EVENT-001..005 |
| `/event/[id]` | `/event/[id]` | UX-EVENT-006..012 |
| `/event/[id]/release` | `/event/[id]/release` | UX-EVENT-017..019 |
| `/event/[id]/slots` | `/event/[id]/slots` | UX-EVENT-013..016 |
| `/groups` | `/event`, `/groups` | UX-EVENT-020 |
| `/groups*` | `/event`, `/groups`, `/groups/[slug]` | UX-EVENT-024 |
| `/groups/[slug]` | `/event`, `/groups/[slug]` | UX-EVENT-021..023 |
| `/list` | `/list` | UX-DISC-001, UX-DISC-003..009 |
| `/list?q=` | `/list` | UX-DISC-002 |
| `/maintenance` | `/maintenance` | UX-SYS-001..002 |
| `/manage` | `/manage` | UX-MNG-001..004 |
| `/manage/events/[id]` | `/manage/events/[id]` | UX-MNG-009 |
| `/manage/notifications` | `/manage/notifications` | UX-MNG-054..057 |
| `/manage/x-link-requests` | `/manage/x-link-requests` | UX-MNG-058..060 |
| `/onboarding` | `/onboarding` | UX-AUTH-011..012 |
| `/recommend` | `/recommend` | UX-DISC-010..012 |
| `/rules` | `/rules` | UX-PUB-010..011 |
| `/trending` | `/trending` | UX-DISC-013..015 |
| `/user` | `/user` | UX-USER-001..005 |
| `/user*` | `/user`, `/user/[id]`, `/user/[id]/portfolio` | UX-USER-016 |
| `/user/[id]` | `/user/[id]` | UX-USER-006..014 |
| `/user/[id]/portfolio` | `/user/[id]/portfolio` | UX-USER-015 |
| `X link requests` | `/admin/x-link-requests` | UX-ADM-097..099 |
| `X merges` | `/admin/x-id-merges` | UX-ADM-093..095 |
| `YouTube quota` | `/admin/youtube-quota` | UX-ADM-101 |
| `YouTube sync` | `/admin/youtube-sync` | UX-ADM-103..104 |
| `account menu` | `shell:AUTH_ACCOUNT` | UX-AUTH-010, UX-AUTH-020..021 |
| `account/settings` | `/dashboard/settings`, `shell:AUTH_ACCOUNT` | UX-AUTH-019 |
| `admin events` | `/admin/events`, `/admin/events/[id]`, `/admin/events/[id]/edit`, `/admin/events/[id]/slots`, `/admin/events/[id]/staff`, `/admin/events/new`, `/admin/events/templates` | UX-ADM-033 |
| `admin shell` | `shell:ADMIN` | UX-ADM-002, UX-GLOBAL-030 |
| `admin/manage/maintenance` | `shell:OPERATION_MODE` | UX-ADM-024 |
| `admin/manage/public operational shell` | `shell:OPERATION_MODE` | UX-GLOBAL-028 |
| `all frontend` | `shell:ALL` | UX-GLOBAL-020..022 |
| `announcements` | `/admin/announcements`, `/admin/announcements/[id]/edit`, `/admin/announcements/new` | UX-ADM-006..007 |
| `audit detail` | `/admin/audit/[id]` | UX-ADM-013..014 |
| `audit/history` | `/admin/audit`, `/admin/history` | UX-ADM-020 |
| `auth complete/entry` | `/auth/complete`, `/entry` | UX-AUTH-002 |
| `auth flow` | `shell:AUTH_FLOW` | UX-AUTH-003 |
| `auth/private layout` | `shell:PRIVATE` | UX-GLOBAL-018 |
| `auth/settings` | `/dashboard/settings` | UX-AUTH-006..007 |
| `authenticated UI` | `shell:PRIVATE` | UX-AUTH-008..009 |
| `authenticated routes` | `shell:PRIVATE` | UX-AUTH-004 |
| `chapter composer/account` | `/[id]`, `shell:AUTH_ACCOUNT` | UX-VID-049 |
| `console sidebar` | `shell:CONSOLE` | UX-GLOBAL-029 |
| `discovery routes` | `/list`, `/recommend`, `/trending` | UX-DISC-016 |
| `edit/chapter composer` | `/dashboard/edit/[id]`, `/[id]` | UX-VID-050..051 |
| `entry` | `/entry`, `/entry/slotted`, `/entry/unslotted` | UX-SLOT-002..003, UX-SLOT-007, UX-SUB-017, UX-SUB-025 |
| `entry forms` | `/entry/slotted`, `/entry/unslotted` | UX-SUB-002..014, UX-SUB-019..020, UX-SUB-023..024 |
| `entry/account` | `/entry`, `shell:AUTH_ACCOUNT` | UX-AUTH-001 |
| `entry/chapter/dashboard` | `/entry`, `/[id]`, `/dashboard` | UX-AUTH-023 |
| `entry/dashboard` | `/entry`, `/dashboard` | UX-SLOT-004 |
| `entry/edit` | `/entry/slotted`, `/entry/unslotted`, `/dashboard/edit/[id]` | UX-SUB-015, UX-SUB-018 |
| `entry/event` | `/entry`, `/event/[id]` | UX-SLOT-001 |
| `entry/manageable reservation` | `/entry` | UX-SLOT-005..006 |
| `error.tsx / route-group errors` | `shell:ERROR` | UX-GLOBAL-023 |
| `event admin` | `/admin/events`, `/admin/events/[id]`, `/admin/events/[id]/edit`, `/admin/events/[id]/slots`, `/admin/events/[id]/staff`, `/admin/events/new`, `/admin/events/templates` | UX-ADM-036..037 |
| `event groups` | `/admin/event-groups`, `/admin/event-groups/[id]/edit`, `/admin/event-groups/new` | UX-ADM-028 |
| `global` | `shell:ALL` | UX-GLOBAL-008..009 |
| `global-error.tsx` | `shell:GLOBAL_ERROR` | UX-GLOBAL-024 |
| `global/header` | `shell:ALL` | UX-GLOBAL-007 |
| `header/private routes` | `shell:PUBLIC_HEADER`, `shell:PRIVATE` | UX-AUTH-005 |
| `integrity` | `/admin/health/integrity` | UX-ADM-044 |
| `manage event routes` | `/manage/events/[id]`, `/manage/events/[id]/audience`, `/manage/events/[id]/edit`, `/manage/events/[id]/videos`, `/manage/events/[id]/review`, `/manage/events/[id]/slots`, `/manage/events/[id]/staff`, `/manage/events/[id]/videos/[videoId]`, `/manage/events/[id]/youtube-playlist` | UX-MNG-010 |
| `manage layout` | `shell:MANAGE` | UX-MNG-008 |
| `manage shell` | `shell:MANAGE` | UX-GLOBAL-031..033, UX-MNG-005..007 |
| `not-found.tsx` | `shell:NOT_FOUND` | UX-GLOBAL-025 |
| `onboarding/rules` | `/onboarding`, `/rules` | UX-AUTH-013 |
| `permission simulator` | `/admin/permissions/simulator` | UX-ADM-062..063 |
| `permissions` | `/dashboard/edit/[id]/permissions` | UX-DASH-017..019 |
| `playlist sync` | `/admin/youtube-sync/playlists` | UX-ADM-106..107 |
| `public` | `shell:PUBLIC` | UX-PUB-012 |
| `public header` | `shell:PUBLIC_HEADER` | UX-GLOBAL-001..004, UX-GLOBAL-010..013, UX-GLOBAL-015..016 |
| `public header → /list?q=` | `shell:PUBLIC_HEADER`, `/list` | UX-GLOBAL-005 |
| `public header/account` | `shell:PUBLIC_HEADER`, `shell:AUTH_ACCOUNT` | UX-GLOBAL-014 |
| `public layout` | `shell:PUBLIC` | UX-GLOBAL-017 |
| `public mutation feedback` | `shell:PUBLIC_MUTATION` | UX-GLOBAL-027 |
| `public routes` | `shell:PUBLIC` | UX-GLOBAL-026 |
| `public search forms` | `/list`, `/user`, `/event`, `shell:PUBLIC_HEADER` | UX-GLOBAL-006 |
| `public/private routes` | `shell:ALL` | UX-GLOBAL-019 |
| `robots/canonical` | `shell:ROBOTS` | UX-SYS-004 |
| `rules` | `/admin/rules`, `/admin/rules/[id]/edit`, `/admin/rules/new` | UX-ADM-067 |
| `rules/auth` | `/admin/rules`, `/admin/rules/[id]/edit`, `/admin/rules/new`, `/rules`, `/onboarding` | UX-ADM-068 |
| `security` | `/admin/security` | UX-ADM-046 |
| `settings` | `/dashboard/settings` | UX-AUTH-017..018 |
| `settings/account` | `/dashboard/settings` | UX-AUTH-015 |
| `site-wide` | `shell:ALL` | UX-AUTH-014, UX-AUTH-022 |
| `sitemap` | `shell:SITEMAP` | UX-SYS-005 |
| `slotted entry` | `/entry/slotted` | UX-SUB-026 |
| `slotted/event entry` | `/entry/slotted`, `/event/[id]` | UX-SUB-016 |
| `spreadsheet` | `/admin/spreadsheet` | UX-ADM-071..072 |
| `static builds` | `/admin/static-builds` | UX-ADM-074..075 |
| `templates` | `/admin/events/templates` | UX-ADM-039..040 |
| `user admin` | `/admin/users/[id]`, `/admin/users/[id]/edit` | UX-ADM-081..082 |
| `user detail` | `/admin/users/[id]` | UX-ADM-078 |
| `user edit` | `/admin/users/[id]/edit` | UX-ADM-080 |
| `video admin` | `/admin/videos/[id]`, `/admin/videos/[id]/members` | UX-ADM-085..087, UX-ADM-091 |
| `video detail` | `/manage/events/[id]/videos/[videoId]` | UX-MNG-047..050 |
| `video members` | `/admin/videos/[id]/members` | UX-ADM-089..090 |

## Technical compatibility routes

CURRENT technical twin routesは独立USER_SCREENとして数えない。

| Logical URL | CURRENT technical route | Preserved profile |
| --- | --- | --- |
| `/list?...` | `/list/~query` | Q-LIST |
| `/user?...` | `/user/~query` | Q-USER |
| `/event?...` | `/event/~query` | Q-EVENT |
| `/user/[id]?worksPage/collabPage` | `/user/[id]/paged` | Q-USER-PAGED |

TARGETでtechnical routeを削除してもlogical URL contractは削除しない。

## Global non-page surfaces

- `app/error.tsx` / route-group error -> `shell:ERROR`
- `app/global-error.tsx` -> `shell:GLOBAL_ERROR`
- `app/not-found.tsx` -> `shell:NOT_FOUND`
- `app/robots.ts` -> `shell:ROBOTS`
- `app/sitemap.ts` -> `shell:SITEMAP`

These remain migration acceptance requirements and are not visual-only extras.

## Design-source boundary

`UI_REFERENCE.md` is still `PENDING_HTML`。

Therefore:

- CURRENT mapping is complete without inventing target visual layout;
- old `docs/design-redesign` / old redesign surfaces are not target evidence;
- visual component/layout decisions remain pending until the user-provided HTML mock is registered;
- UX/FN/permission/query/state/a11y contracts in this document constrain that future visual implementation.

## Migration use

Before migrating any screen:

1. find the exact route row;
2. load its route-local UX/FN;
3. resolve inherited shell UX;
4. preserve permission/state/query/RA profiles;
5. follow auth/static/job/API baselines referenced by its FN IDs;
6. implement against future UI_REFERENCE;
7. parity-test direct URL, reload, back/forward, error/empty/pending states and server authorization.

Frontend unresolved/orphan/unknown owners: **0**

This MIG-0011 Frontend PR changes documentation/checker evidence only. Runtime application behavior and production Cloudflare/D1/R2/KV/Queue configuration are unchanged.
