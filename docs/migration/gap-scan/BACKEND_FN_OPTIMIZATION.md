# MIG-0011 Backend / FN / Optimization Final Audit

> Scope: Backend / FN / domain / processing / optimization / obsolete processing only
> Baseline: main 2a222f7c03eb2703ae7509cbc93af014dbf685e2
> Branch: migration/mig-0011-backend-fn-optimization
> Runtime code change: 0
> Cloudflare production resource mutation: 0
> STATUS/frontend/screen-mapping/CURRENT_ROUTES mutation: 0

This document completes the backend writer lane of MIG-0011. It does **not** mark MIG-0011 DONE. Frontend UX final disposition and route visual/redirect work remain the parallel writer lane; integration owns STATUS after both PRs merge.

## Result

- FN total: 136
- DETAIL_AUDIT_REQUIRED: 0
- CURRENT_VERIFIED: 131
- CURRENT_DIVERGENCE: 2
- MERGED_INTO_OTHER: 2
- TARGET_REDESIGN_REQUIRED: 1
- OBSOLETE: 0
- remaining FN without final disposition: 0
- Server Action unresolved: 0 (110/110 remain CURRENT_VERIFIED in server-actions/README.md)
- Route Handler unresolved: 0 (33/33 remain CURRENT_VERIFIED in route-handlers/README.md)
- production mutation: none

The 103 rows that were DETAIL_AUDIT_REQUIRED were re-disposed below. Existing 33 verified FN retain their previously audited baseline. Final disposition is derived from the four function ledgers; STATUS is intentionally not updated in this parallel lane.

## Evidence backbone

Primary current evidence used:

- gap-scan/CHECKPOINT.md
- FUNCTION_INVENTORY.md and functions/*.md
- server-actions/README.md (110 execution units)
- route-handlers/README.md (33 HTTP methods)
- cloudflare/TOPOLOGY.md and cloudflare/PERFORMANCE_BASELINE.md
- static-delivery/README.md
- auth/README.md
- background-jobs/README.md
- current source/tests referenced by those inventories

Weak-evidence rows were rechecked directly:
- FN-PUB-003: src/components/video/YoutubePlayer.tsx, playerBridge.ts, playerBridge.test.mjs.
- FN-PUB-006: VideoViewTracker.tsx, videoViewTrackerCore.ts/test.mjs; GA4 localStorage cooldown semantics.
- FN-PUB-019: current portfolio static profile path and reflection/unavailable/not-found contract.
- FN-PER-004: dashboard/library/page.tsx + check-video-interactions-auth.mjs + onboardingState.contract.test.mjs.
- FN-MNG-003: manage audience page, manage authorization snapshot, and current bounded icon/query optimization.
- FN-PLAT-001: static/background/topology/runtime all consistently keep D1 canonical.

Additional direct checks relevant to optimization:
- staticUsersIndexCore.prepareUsersIndexItems already avoids request-time score re-sort after filtering.
- admin YouTube sync main no longer joins x_users unnecessarily; the remaining expensive shape is the cross-table COALESCE ORDER BY.
- account summary already reuses currentUser linked-X context, but management/access and other callers still justify a typed request-local Account/Identity context rather than any global authz cache.
- audit schema already has actor_user_id + actor_x_user_id, but acting-X propagation is incomplete across mutations.

Cloudflare platform interpretation follows current official semantics: 1102/exceededCpu is active CPU time, not network/storage wait; D1 cost/performance depends on rows scanned and plans should be checked with EXPLAIN QUERY PLAN; Queue retries/DLQ are transport delivery mechanisms and do not replace canonical business state.

## 103 FN detailed final audit

Each row records caller/transport, domain/storage/effects, authorization/visibility/audit/cache/retry/test evidence, and TARGET ownership. “No backend resource” is an intentional result, not missing evidence.

### Public / discovery / playback

| FN | Purpose | Final disposition | Caller / transport | Data / effects | Authz / visibility / audit / tests | TARGET / UX owner |
| --- | --- | --- | --- | --- | --- | --- |
| FN-PUB-001 | トップで新着・注目・イベント等を発見 | CURRENT_VERIFIED | / home; top static loaders | R2 top/sections + top composer; D1 only generator/background; no KV business truth | public visibility/projection allowlist; static-delivery tests; bounded/stale semantics | KEEP capability; TARGET SSG/static home, UX owner Public |
| FN-PUB-002 | 作品詳細を開く | CURRENT_VERIFIED | /[id]; RH-030 + public static video loader | R2 videos/{canonical}.json + YouTube alias; bounded D1 alias/probe/fallback; rebuild Queue on miss | public visibility fence, explicit DTO, alias/canonical tests | TARGET_REWRITE delivery to SSG + thin visibility/alias gateway; same URL/UX |
| FN-PUB-003 | YouTube作品を再生 | CURRENT_VERIFIED | YoutubePlayer + playerBridge client path | No D1/R2/KV/Queue; external YouTube iframe/postMessage | visibility inherited from public page; playerBridge.test.mjs + UI acceptance ended/seek checks | KEEP as client island; no backend hot-path work |
| FN-PUB-004 | 作品metadata/説明/credit/music表示 | CURRENT_VERIFIED | /[id] metadata renderer; RH-030/static DTO | R2 video projection; bounded D1 fallback; no direct mutation | public DTO allowlist + visibility fence; publicDto/public route tests | TARGET_REWRITE build-time/static projection; UX unchanged |
| FN-PUB-005 | 作品chapter表示 | CURRENT_VERIFIED | video detail chapter UI; SA-012..015 + RH-031 private overlay | D1 video_chapters; public chapter projection R2; static rebuild Queue after mutation | video edit privilege; private chapters bounded/fail-closed; chapter action/tests | KEEP domain; public static + private bounded overlay API |
| FN-PUB-006 | view計測 | CURRENT_VERIFIED | VideoViewTracker + videoViewTrackerCore | No D1/R2/KV/Queue; GA4 external event; localStorage 6h duplicate suppression | public telemetry; dedicated videoViewTrackerCore tests | KEEP telemetry as intentional analytics exception; do not invent Active-X attribution |
| FN-PUB-007 | like等の作品interaction | CURRENT_DIVERGENCE | InteractionButton; SA-087; RH-031 overlay/library playlist | CURRENT D1 video_interactions_auth keyed auth_user_id; like count D1 + static rebuild Queue | session/terms/banned/public visibility; strict audit; atomicity/visibility tests | CURRENT_DIVERGENCE: TARGET interaction identity Active X; migrate schema/service/overlay/library |
| FN-PUB-008 | viewer utility/private overlay | CURRENT_VERIFIED | RH-031 viewer overlay | D1 auth/chapters/interactions + R2 event playlist; no public cache | server-side viewer auth, banned/terms, fail-closed; private no-store; overlay tests | KEEP bounded private overlay API; remove from public SSR |
| FN-PUB-009 | イベント一覧 | CURRENT_VERIFIED | /event; RH-015 | R2 events index first; bounded D1 fallback only when policy allows | public event/DTO/operation-mode fail-closed; public API tests | TARGET_REWRITE to SSG/static-first; no UX change |
| FN-PUB-010 | イベント詳細/作品一覧 | CURRENT_VERIFIED | /event/[id]; RH-021 + static event family | R2 event base/slots/release/composer; live D1 submissions when requested | event visibility/stage; public DTO; static-delivery/live tests | TARGET_REWRITE static shell + bounded live island |
| FN-PUB-011 | イベントrelease連続閲覧 | CURRENT_VERIFIED | /event/[id]/release; RH-012 | event release projection R2/static; bounded canonical source build from D1 | public event/release order/visibility; event release/export tests | KEEP as static/public export; no request-time generation |
| FN-PUB-012 | 公開枠状況 | CURRENT_VERIFIED | event slots pages; RH-014/020/025 | D1 live slots/viewer probe; R2 submission icon/media; 5s live cache | public/private slot visibility, conditional auth; slot overlay/icon tests | KEEP live bounded API + static shell; media ACL exception retained |
| FN-PUB-013 | イベントグループ一覧/詳細 | CURRENT_VERIFIED | group data in events index; /groups compatibility routes | D1 event_group/event_group_events -> R2 events/index projection | public group/event visibility; static generation completeness | KEEP domain projection; no separate heavy runtime service |
| FN-PUB-014 | 作品一覧・filter・search | CURRENT_VERIFIED | /list; RH-032 | R2 recent/popular/search generation shards; bounded fallback policy | explicit public DTO + completeness manifest; search tests | TARGET_REWRITE to static/SSG query facade; no universal D1 search |
| FN-PUB-015 | recommend表示 | CURRENT_VERIFIED | /recommend; static recommend loader | R2 recommend/core.v1 -> recommend composer; D1 only background source | public-only bounded pools; artifact hash/dedupe tests | KEEP background ranking/projection; static delivery |
| FN-PUB-016 | trending表示 | CURRENT_VERIFIED | /trending; GA4 analytics job reader | R2 analytics/trending.json; GA4 sync background; no D1 fallback | R2-only stale/empty/unavailable contract; ga-analytics sync tests/docs | KEEP cold/background generation; static read |
| FN-PUB-017 | creator一覧 | CURRENT_VERIFIED | /user; users index loader | R2 users index/v2 generation; request filter; score path already avoids duplicate sort | public-listable X only; generation completeness; staticUsersIndexCore tests | TARGET_REWRITE static pages/shards; preserve current score-sort optimization |
| FN-PUB-018 | creator profile/作品 | CURRENT_VERIFIED | /user/[id]; creator static loader | R2 users/{id}.json + bounded works/collabs pages; D1 probe on miss | X listability/visibility fence; user static tests | TARGET_REWRITE SSG/static detail + thin fence |
| FN-PUB-019 | creator portfolio | CURRENT_VERIFIED | /user/[id]/portfolio; direct code audit | R2 creator profile/works projection; no independent business write | reflection/unavailable/not-found semantics; static profile evidence in checkpoint | KEEP static portfolio projection; no separate service |
| FN-PUB-020 | about | CURRENT_VERIFIED | /about + RH-026 stats | static content + R2 top sections/stats | public safe projection; about-stats route contract test | KEEP SSG; stats artifact only |
| FN-PUB-021 | rules public閲覧 | CURRENT_VERIFIED | /rules | R2 rules/current.json built from D1 terms | public; rules explicitly no-stale; terms tests | KEEP no-stale intentional exception; SSG/static with freshness fence |
| FN-PUB-022 | SEO/canonical/OGP | CURRENT_VERIFIED | metadata/canonical/OGP on public detail routes | reads same public static DTO; no mutation/storage of its own | canonical alias/visibility contracts; route metadata evidence | MERGE implementation with build-time public detail contract; function remains verified |
| FN-PUB-023 | 公開お知らせ表示 | CURRENT_VERIFIED | home announcements; SA-004..006 producer | D1 announcement canonical + audit; Queue/static top_announcements -> R2 | admin write; public only published projection; SA/static tests | KEEP background projection; public SSG |
| FN-PUB-024 | 公開統計・募集中イベント/空き枠概要表示 | CURRENT_VERIFIED | home/about/event summary; RH-022/RH-026 | R2 static stats plus bounded live D1 aggregate | public DTO/operation mode; 5s live cache; live API tests | KEEP split static stats + bounded live summary |
| FN-PUB-025 | 全体公開ナビゲーション/モバイルメニュー | CURRENT_VERIFIED | public layout navigation | No backend storage/effect; route state only | N/A backend authz; screen mapping/component evidence | CURRENT_VERIFIED; frontend-owned, backend optimization N/A |
| FN-PUB-026 | 公開ヘッダーから作品検索 | CURRENT_VERIFIED | header GET search -> /list?q= | No mutation; consumes same RH-032/static search contract | public query/deep-link; search API limits apply | CURRENT_VERIFIED; reuse static search facade |
| FN-PUB-027 | ライト/ダークテーマ切替 | CURRENT_VERIFIED | theme client state | localStorage/system preference only; no backend resource | N/A authz/audit/cache; component/UI acceptance evidence | CURRENT_VERIFIED; backend optimization N/A |

### Personal / entry

| FN | Purpose | Final disposition | Caller / transport | Data / effects | Authz / visibility / audit / tests | TARGET / UX owner |
| --- | --- | --- | --- | --- | --- | --- |
| FN-PER-001 | dashboardで必要作業/作品状態を見る | CURRENT_VERIFIED | /dashboard server page | D1 owned/related video + slot/account reads; no public artifact as authz truth | requireSession/onboarding; private no-store/current SSR | TARGET_REWRITE private React/Vite SPA + bounded dashboard API |
| FN-PER-002 | 作品編集 | CURRENT_VERIFIED | /dashboard/edit/[id]; SA-089 + SA-012..015 | D1 video/member/chapter/custom answers; R2/static + YouTube follow-up | owner/collab/event privilege server-side; audit; action tests | MERGE through typed video edit domain plan; adapters remain section-aware |
| FN-PER-003 | 共同編集権限管理 | CURRENT_VERIFIED | permissions page; SA-082..084; RH-019 suggestions | D1 video_members/x links; R2 member-suggestion artifact; notification/static effects | video owner/delegation privilege; strict audit; collab permission tests | KEEP X content identity + Auth grantor; typed batch command |
| FN-PER-004 | library閲覧 | CURRENT_DIVERGENCE | /dashboard/library; direct page + overlay audit | CURRENT like/bookmark uses video_interactions_auth auth_user_id; mine uses Active X; collab/chapter use approved X | authenticated; visibility filters; onboardingState/check-video-interactions-auth explicitly assert auth-owned likes | CURRENT_DIVERGENCE: like/bookmark must become Active-X scoped; same tabs/query UX |
| FN-PER-005 | user settings | CURRENT_VERIFIED | /dashboard/settings; SA-098..105 | D1 users/x_users/account links/requests; R2 icon/static; notification/YouTube follow-up where relevant | current auth user + link ownership; audit; Active-X switch validation | KEEP account security principal Auth User; acting profile identity Active X |
| FN-PER-006 | personal YouTube playlist確認 | MERGED_INTO_OTHER | /dashboard/youtube-playlists compatibility surface | No independent personal sync engine; existing playlist/sync state owned by MNG-010/ADM-031/JOB-005 | authenticated route/compatibility behavior; background job baseline | MERGED_INTO_OTHER backend: reuse YouTube playlist/sync domain; frontend route disposition handled separately |
| FN-PER-007 | X ID登録/変更/申請 | CURRENT_VERIFIED | settings X ID requests; SA-090..105; RH-019 | D1 x identity requests/account links/x_users; R2 icon/member suggestion; notification/static/youtube effects | Auth User request principal; approved Active X validation; strict audit | KEEP identity domain; merge/revert remains intentional exception |
| FN-ENT-001 | entry入口で参加/投稿方法を判断 | CURRENT_VERIFIED | /entry; SA-107 login + server entry decision | D1 event/slot/account reads; auth/session; no canonical client state | auth/onboarding/terms/event-stage guards | TARGET_REWRITE private SPA entry bootstrap API; same decision contract |
| FN-ENT-002 | slot確保/状態管理 | CURRENT_VERIFIED | slot UI; SA-065..068; RH-014/020/025 | D1 slot_reservation_groups/slots canonical; notification/live/static effects | Auth User provenance + Active X reservation identity; capacity/race CAS; audit | KEEP reservation aggregate; do not generic CRUD |
| FN-ENT-003 | slot付き作品提出 | CURRENT_VERIFIED | /entry/slotted; SA-088 | atomic D1 video/member/answers/slot; R2/static; Queue notification/YouTube | slot ownership, Active X, deadline, visibility; audit/atomicity tests | KEEP shared video-save plan with explicit slot transaction |
| FN-ENT-004 | 通常作品投稿 | CURRENT_VERIFIED | /entry/unslotted; SA-086 | D1 video/member/event links; static/notification/YouTube follow-up | approved Active X + entry/write eligibility; duplicate validation | KEEP shared save plan; bounded API adapter |
| FN-ENT-005 | YouTube quick input/metadata取得 | CURRENT_VERIFIED | VideoForm quick input + RH-029 software suggestions + YouTube metadata flow | bounded external YouTube metadata/quota path; D1 duplicate lookup; software catalog read | input validation/YouTube ID uniqueness/quota semantics; form/action tests | KEEP provider-specific external contract; heavy sync stays background |
| FN-ENT-006 | custom question回答 | CURRENT_VERIFIED | custom question fields in SA-088/089 | D1 event question schema + video answers within save transaction | event schema/validation + edit privilege; audited with parent mutation | KEEP typed question schema; no standalone generic key/value CRUD |

### Manage

| FN | Purpose | Final disposition | Caller / transport | Data / effects | Authz / visibility / audit / tests | TARGET / UX owner |
| --- | --- | --- | --- | --- | --- | --- |
| FN-MNG-001 | 担当イベント一覧/要対応把握 | CURRENT_VERIFIED | /manage; manageAuthorization snapshot | D1 event_staff + approved account links/event status; request-local React.cache | all approved linked X can authorize; Active X only display priority; auth baseline tests | TARGET_REWRITE SPA bootstrap; keep authz snapshot request-local only |
| FN-MNG-002 | event workspace overview | CURRENT_VERIFIED | /manage/events/[id] workspace | D1 event/read models + job/notification summaries | event staff/admin permission; server-side guard | TARGET_REWRITE bounded event workspace API; preserve permission union |
| FN-MNG-003 | audience情報確認 | CURRENT_VERIFIED | .../audience direct page audit | read-only event-scoped D1 aggregation; canonical x_users icon rows, no decorative N+1 ACL | manage authorization; privacy/event scope; operations optimization evidence | KEEP bounded read query; no write/service duplication |
| FN-MNG-004 | event settings編集 | CURRENT_VERIFIED | event edit; SA-022..024 | D1 event/settings/staff + audit + static Queue | admin/delegated event write, stage/validation, owner invariant | MERGE shared event domain service; role scope explicit |
| FN-MNG-005 | review queue/審査 | CURRENT_VERIFIED | review flow; SA-040..042 | D1 video status + notification/static follow-up | event review permission; audit/status CAS; manage video action tests | MERGE status transition core with admin; navigation adapter separate |
| FN-MNG-006 | slot運用 | CURRENT_VERIFIED | slots admin; SA-056..064 | D1 slots/groups + audit + notification/static | event edit permission; destructive submitted release explicit | KEEP aggregate/planner; dangerous release INTENTIONAL_EXCEPTION |
| FN-MNG-007 | staff管理 | CURRENT_VERIFIED | staff; SA-031..034 | D1 event_staff/account links; static permission follow-up | owner invariant incl. last operable owner; server auth tests | KEEP owner/staff invariant service; no generic membership CRUD |
| FN-MNG-008 | event作品一覧管理 | CURRENT_VERIFIED | event videos list; SA-040..042 consumers | bounded D1 video/event queries; status/static state | event video management permissions; visibility filters | MERGE read/query primitives with MNG-009 but keep list/detail DTOs |
| FN-MNG-009 | event作品1件処理 | CURRENT_VERIFIED | event video detail/action; SA-040..042/089 as permitted | D1 video/member/status + audit; static/notification effects | concrete event permission + section edit rules | MERGE transition core; detail command remains typed |
| FN-MNG-010 | event YouTube playlist同期管理 | CURRENT_VERIFIED | event YouTube playlist; SA-038..039 + JOB-005 | D1 playlist config/due state; Queue doorbell; external YouTube in sync worker; R2 projection | event management write; quota/deferred/cursor semantics | KEEP domain-specific playlist state machine; background execution |
| FN-MNG-011 | 通知失敗/状態管理 | CURRENT_VERIFIED | /manage/notifications | D1 notification_outbox event-scoped read | event scope; no operator retry beyond allowed surface; background job tests | KEEP monitoring query; retry engine shared with admin/job |
| FN-MNG-012 | X link request処理 | CURRENT_VERIFIED | manage X link requests; SA-090..091 | D1 identity request/link + audit/static/notification | delegated xid.link_requests permission; actor scope | MERGE decision service with admin adapter; permission boundary separate |

### Admin

| FN | Purpose | Final disposition | Caller / transport | Data / effects | Authz / visibility / audit / tests | TARGET / UX owner |
| --- | --- | --- | --- | --- | --- | --- |
| FN-ADM-001 | admin dashboard/対応待ち | CURRENT_VERIFIED | /admin dashboard | bounded D1 operational summaries + links; no distinct mutation | admin only; diagnostic/job state read | TARGET_REWRITE SPA dashboard API; avoid aggregating unbounded counts |
| FN-ADM-002 | announcements CRUD | CURRENT_VERIFIED | announcements; SA-004..006 | D1 canonical + strict audit; static rebuild Queue/R2 | admin write; published-only public projection | KEEP typed announcement commands + publication effect |
| FN-ADM-003 | API endpoint設定/管理 | CURRENT_VERIFIED | API endpoints; SA-007/008 + inline SA-108/109 wrappers | D1 endpoint config + audit | admin write/security config; action inventory tests | MERGE/remove page wrappers into typed adapter; no generic security CRUD |
| FN-ADM-004 | audit検索/詳細 | CURRENT_VERIFIED | /admin/audit search/detail | bounded D1 audit_logs/settings/actor display | admin-only immutable audit read; retention/restore metadata | KEEP dedicated audit query model |
| FN-ADM-005 | audit restore | CURRENT_VERIFIED | audit restore; SA-010/011 | D1 restore batch + audit_restore_runs + visibility/static effects when needed | admin, dry-run, conflict/restore capability, strict audit | INTENTIONAL_EXCEPTION: restore transaction never generic CRUD |
| FN-ADM-006 | audit settings | CURRENT_VERIFIED | audit settings; SA-009 | D1 system/audit settings + audit | admin write; retention bounds | KEEP typed settings command; request-local read reuse |
| FN-ADM-007 | cost guard | CURRENT_VERIFIED | CostGuard; SA-016..020 | D1 system_settings canonical + KV mirror acceleration; audit | admin/write-feature guard; full-row CAS/conflict | INTENTIONAL_EXCEPTION: typed operation-mode CAS; KV never canonical |
| FN-ADM-008 | event groups CRUD | CURRENT_VERIFIED | event groups; SA-025..030 | D1 group/relation canonical + audit; static events-index rebuild | admin; relation integrity | KEEP metadata/membership commands; static projection |
| FN-ADM-009 | events CRUD/admin detail | CURRENT_VERIFIED | events admin; SA-021..024 + slot admin | D1 event/staff/settings + audit; visibility/static/notification | admin; owner invariant/stage; event rename special | MERGE normal event service with manage; rename/tombstone exception |
| FN-ADM-010 | event template管理 | CURRENT_VERIFIED | templates; SA-035..037 | D1 event template rows; audit | admin read/write | KEEP query/command split; no need for generic CRUD |
| FN-ADM-011 | event staff admin | CURRENT_VERIFIED | admin/manage staff; SA-031..034 | D1 event_staff + account links | admin/event permissions; last owner invariant | MERGE same owner/staff core as MNG-007 |
| FN-ADM-012 | dangerous event operations | CURRENT_VERIFIED | dangerous event ops; SA-021 | multi-table D1 rename/reuse/tombstone + audit + R2/visibility/static effects | explicit admin confirmation; rollback/canonical alias safety | INTENTIONAL_EXCEPTION; do not flatten into event CRUD |
| FN-ADM-013 | health dashboard | CURRENT_VERIFIED | /admin/health + RH-017 deep health | bounded read-only D1/R2/worker diagnostics | admin page; token-auth deep endpoint; no-store | KEEP diagnostics isolated from public health; background expensive checks |
| FN-ADM-014 | integrity checks | CURRENT_VERIFIED | /admin/health/integrity | read-only D1 integrity queries by default | admin; explicit run=1; diagnostic optimization contract tests | KEEP bounded/read-only checks; repairs remain separate commands |
| FN-ADM-015 | history閲覧 | MERGED_INTO_OTHER | /admin/history compatibility route | No independent history backend; current route resolves into audit/history data | admin; canonicalNaming tests distinguish historical naming | MERGED_INTO_OTHER: backend query owned by FN-ADM-004 audit; frontend redirect handled elsewhere |
| FN-ADM-016 | legacy import | CURRENT_VERIFIED | legacy import; RH-002 | multipart preview/apply; D1 mutation + R2 preview token; bounded CPU | same-origin + admin write; preview/atomicity tests | INTENTIONAL_EXCEPTION; heavy apply can move background but boundary stays dedicated |
| FN-ADM-017 | moderation cases | CURRENT_VERIFIED | moderation; SA-043/044 | D1 moderation cases + audit + notification Queue | admin write; explicit case state machine | KEEP typed moderation state machine |
| FN-ADM-018 | notification admin/retry | CURRENT_VERIFIED | notification admin; SA-045..048 | D1 outbox canonical; Queue doorbell; Discord external worker | admin; idempotency/dedupe; retry/cancel/force distinctions | MERGE retry primitives only; external-delivery suppression exception stays |
| FN-ADM-019 | permission simulator | CURRENT_VERIFIED | permission simulator | reads same permission resolver/data; no business mutation | admin; must match real fail-closed resolver | KEEP as diagnostic adapter; never separate permission implementation |
| FN-ADM-020 | rules/terms CRUD | CURRENT_VERIFIED | rules/terms; SA-051..055 | D1 terms/acceptance canonical + audit; notification/static rebuild Queue | admin; version lifecycle/reaccept semantics | KEEP terms lifecycle; rules no-stale publication exception |
| FN-ADM-021 | security diagnostics | CURRENT_VERIFIED | security diagnostics | bounded D1 security/account checks; no secrets returned | admin-only; no mutation/secret leak; diagnostic tests | KEEP read-only diagnostic model; run heavy checks outside hot path if needed |
| FN-ADM-022 | spreadsheet/DB browser | CURRENT_VERIFIED | spreadsheet; RH-003..009 | bounded D1 table read/write/import/export + audit/static plan | same-origin + admin guard; preview token/atomicity/protected tables | INTENTIONAL_EXCEPTION for bulk/data command; not generic CRUD |
| FN-ADM-023 | static build/rebuild管理 | CURRENT_VERIFIED | static builds; SA-050/069..073 | D1 static_rebuild_queue canonical; Queue doorbell; R2 generator/repair | admin; lease/retry/dirty generation/visibility repair | KEEP admin orchestration; execution stays background |
| FN-ADM-024 | users search/detail/edit | CURRENT_VERIFIED | users; SA-049/077..081 | D1 user/x state + audit; notification/icon/static effects | admin; role/ban/security state Auth User, X profile separate | KEEP split account vs X identity commands; request-local actor context |
| FN-ADM-025 | videos search/detail/admin | CURRENT_VERIFIED | videos; SA-001..003 | D1 video status + audit; static/notification effects | admin/video status permission | MERGE status transition core with manage; admin adapter remains |
| FN-ADM-026 | video members admin | CURRENT_VERIFIED | video members; SA-082..085 | D1 video_members/x identity + audit/static follow-up | admin or owner/delegation permission; grantor auth provenance | MERGE member aggregate core; preserve X subject |
| FN-ADM-027 | workers monitoring | CURRENT_VERIFIED | /admin/workers; RH-017 linkage | D1 worker leases/outbox/rebuild/sync state + KV last-failure diagnostics | admin read-only; workerMonitoring contract/integration tests | KEEP monitoring model; D1 state canonical, KV diagnostics only |
| FN-ADM-028 | X ID merge | CURRENT_VERIFIED | X merge/revert; SA-092..097/110 wrapper | multi-table D1 X references + audit + static fanout | admin; preflight/CAS/revert/merge safety tests | INTENTIONAL_EXCEPTION; only safe primitives shared; typed adapters replace generic dispatcher |
| FN-ADM-029 | X link requests | CURRENT_VERIFIED | X link requests; SA-090/091 | D1 identity requests/account links + audit/static/notification | admin/delegated decision; decision metadata | MERGE single identity-decision domain service |
| FN-ADM-030 | YouTube quota | CURRENT_VERIFIED | YouTube quota page | D1 quota ledger/counters; Google Cloud remains provider authority for external total | admin read-only; PT day/80% budget semantics | KEEP monitoring query; do not duplicate quota truth in KV/client |
| FN-ADM-031 | YouTube sync管理 | CURRENT_VERIFIED | YouTube sync; SA-106 + JOB-005 | D1 metadata status/due state; Queue doorbell; external YouTube; admin query cross-table COALESCE sort | admin retry; quota/idempotency/deferred semantics; youtube sync tests | TARGET_REWRITE admin read model/projection for bounded rows-read; execution remains background |

### Platform / API / cross-cutting

| FN | Purpose | Final disposition | Caller / transport | Data / effects | Authz / visibility / audit / tests | TARGET / UX owner |
| --- | --- | --- | --- | --- | --- | --- |
| FN-PLAT-001 | D1をcanonical sourceにする | CURRENT_VERIFIED | DB/domain/storage invariant | D1 business truth; R2 projection/media; KV bounded cache/diagnostic; Queue doorbell | verified across static/background/topology/runtime; no session/client authz truth | CURRENT_VERIFIED; enforce repository/service ownership and migration checks |
| FN-PLAT-009 | score/trending analytics | CURRENT_VERIFIED | score/trending pipeline | D1 video score fields + background score recalculation; GA4 -> R2 analytics/trending.json | public-only result; R2 reader has no D1 fallback; scheduled retry isolation | KEEP background analytics/ranking; never compute heavy ranking on HTTP path |
| FN-PLAT-011 | maintenance状態を全ユーザーへ案内 | CURRENT_VERIFIED | /maintenance + live policy | D1 system_settings canonical; KV mirror/cache only; live APIs read operation mode | admin exceptions/write guards; maintenance/disabled-feature semantics | KEEP explicit operation-mode contract; static page + tiny status read |
| FN-PLAT-012 | 既存UI surfaceを開発者が確認 | CURRENT_VERIFIED | /dev/ui-surfaces | dev-only static/code catalog; production resolves 404; no D1/R2/KV/Queue | no production authz/business effects; checkpoint direct evidence | CURRENT_VERIFIED dev-only; exclude from production backend architecture |
| FN-API-001 | event endpoint API | CURRENT_VERIFIED | RH-012/013 event endpoint APIs | D1/public projection + KV/micro-cache where configured | public rate limit/visibility/DTO; event export tests | MERGE transport envelope, keep v5/legacy/update export semantics explicit |
| FN-API-002 | events API | CURRENT_VERIFIED | RH-014/015 events APIs | R2 static event list + bounded D1/live/private overlay | public DTO/fail-closed + private no-store viewer overlay | KEEP split public static and private overlay; no universal events repository |
| FN-API-003 | videos API | CURRENT_VERIFIED | RH-030/031/032 videos APIs | R2/static list + D1 detail/overlay/interactions | explicit DTO/public visibility; private overlay auth; rate/cache tests | TARGET_REWRITE public static-first; private bounded overlay |
| FN-API-004 | public API | CURRENT_VERIFIED | RH-026..028 public APIs | R2 public artifacts, strict CORS staff export, no private DB row passthrough | rate/CORS/DTO/visibility double-check; route tests | MERGE public envelope only; PVSF staff CORS remains exception |
| FN-API-005 | internal API | CURRENT_VERIFIED | RH-019 internal X search | R2 member-suggestion generation + bounded fallback search | authenticated/banned fail-closed; private no-store; contract tests | KEEP private search service; static suggestion generation |
| FN-API-006 | live API | CURRENT_VERIFIED | RH-020..022 live APIs | bounded D1 slots/submissions/summary; 5s isolate/body cache | public event visibility + operation-mode guard; live tests | KEEP shared live GET adapter, separate payload queries |
| FN-API-007 | software catalog API | CURRENT_VERIFIED | RH-029 software suggestions | bounded software catalog D1/read model | public rate limit + explicit DTO; contract tests | KEEP small query under shared public envelope |
| FN-API-008 | health API | CURRENT_VERIFIED | RH-017/018 health | tiny public shallow + tokenized deep D1/R2 diagnostics | separate public/admin trust boundaries; no-store | KEEP two-tier health; do not merge deep work into public health |
| FN-API-009 | YouTube thumbnail proxy | CURRENT_VERIFIED | RH-033 YouTube thumbnail proxy | external fetch/cache/object-size handling; no business D1 | strict YouTube ID/size allowlist; proxy tests | TARGET_REWRITE pages to direct/static where safe; retain guarded proxy fallback |
| FN-API-010 | Google Drive image proxy | CURRENT_VERIFIED | RH-016 Google Drive image proxy | external fetch/cache; no business D1 | validated identifier/origin/type/size; proxy tests | TARGET_REWRITE stable images to R2/direct when provenance/revocation allow |
| FN-API-011 | media APIs | CURRENT_VERIFIED | RH-023..025 media | D1 ACL/probe + R2 body/signed media; edge/private cache split | public ACL vs signed manage vs viewer-conditional are distinct; media tests | MERGE delivery primitives only; security models stay separate |
| FN-X-003 | public APIは明示DTOのみ | CURRENT_VERIFIED | publicDto + RH public routes | explicit projection allowlists; R2/public API output | deny sensitive fields; publicDto tests | CURRENT_VERIFIED; shared DTO tooling allowed, domain DTOs remain explicit |
| FN-X-005 | mutation auditを維持 | TARGET_REDESIGN_REQUIRED | mutateWithAudit/audit logger + all mutations | D1 audit_logs atomically with mutations; actor_user_id required, actor_x_user_id optional; no R2/KV canonical audit | strict actor-X pair validation exists, but many acting/content mutations omit actor_x_user_id and snapshot defaults to users.active_x_user_id | TARGET_REDESIGN_REQUIRED: ActorContext(authUserId, activeXId?) through command/audit boundary; do not backfill historical X guesses |
| FN-X-009 | legacy importを専用境界外へ広げない | CURRENT_VERIFIED | RH-002 legacy import boundary | D1 apply + R2 preview token; no legacy table spread into normal services | admin/same-origin/preview/atomicity; import tests | CURRENT_VERIFIED INTENTIONAL_EXCEPTION; contain and retire only with explicit migration gate |
| FN-X-011 | URL/canonical互換を維持 | CURRENT_VERIFIED | aliases/canonical routes + SA-021/092..097 | D1 canonical IDs/aliases + R2 compatibility objects/tombstones | visibility/canonical fail-closed; merge/rename tests | CURRENT_VERIFIED; compatibility gateway explicit, no silent URL break |
| FN-X-012 | production changeはrollback可能にする | CURRENT_VERIFIED | deploy/migration architecture | tracked config/builds; D1 migrations manual/read-only preflight; no runtime mutation in this task | rollback/canary/visibility safety docs | CURRENT_VERIFIED; all cutovers keep rollback and canonical D1 |

## Final 136 FN disposition index

This is the orphan/final-state completeness index. Every FN in the four canonical ledgers appears exactly once.

| FN | Final disposition |
| --- | --- |
| FN-PUB-001 | CURRENT_VERIFIED |
| FN-PUB-002 | CURRENT_VERIFIED |
| FN-PUB-003 | CURRENT_VERIFIED |
| FN-PUB-004 | CURRENT_VERIFIED |
| FN-PUB-005 | CURRENT_VERIFIED |
| FN-PUB-006 | CURRENT_VERIFIED |
| FN-PUB-007 | CURRENT_DIVERGENCE |
| FN-PUB-008 | CURRENT_VERIFIED |
| FN-PUB-009 | CURRENT_VERIFIED |
| FN-PUB-010 | CURRENT_VERIFIED |
| FN-PUB-011 | CURRENT_VERIFIED |
| FN-PUB-012 | CURRENT_VERIFIED |
| FN-PUB-013 | CURRENT_VERIFIED |
| FN-PUB-014 | CURRENT_VERIFIED |
| FN-PUB-015 | CURRENT_VERIFIED |
| FN-PUB-016 | CURRENT_VERIFIED |
| FN-PUB-017 | CURRENT_VERIFIED |
| FN-PUB-018 | CURRENT_VERIFIED |
| FN-PUB-019 | CURRENT_VERIFIED |
| FN-PUB-020 | CURRENT_VERIFIED |
| FN-PUB-021 | CURRENT_VERIFIED |
| FN-PUB-022 | CURRENT_VERIFIED |
| FN-PUB-023 | CURRENT_VERIFIED |
| FN-PUB-024 | CURRENT_VERIFIED |
| FN-PUB-025 | CURRENT_VERIFIED |
| FN-PUB-026 | CURRENT_VERIFIED |
| FN-PUB-027 | CURRENT_VERIFIED |
| FN-AUTH-001 | CURRENT_VERIFIED |
| FN-AUTH-002 | CURRENT_VERIFIED |
| FN-AUTH-003 | CURRENT_VERIFIED |
| FN-AUTH-004 | CURRENT_VERIFIED |
| FN-AUTH-005 | CURRENT_VERIFIED |
| FN-AUTH-006 | CURRENT_VERIFIED |
| FN-AUTH-007 | CURRENT_VERIFIED |
| FN-AUTH-008 | CURRENT_VERIFIED |
| FN-AUTH-009 | CURRENT_VERIFIED |
| FN-AUTH-010 | CURRENT_VERIFIED |
| FN-PER-001 | CURRENT_VERIFIED |
| FN-PER-002 | CURRENT_VERIFIED |
| FN-PER-003 | CURRENT_VERIFIED |
| FN-PER-004 | CURRENT_DIVERGENCE |
| FN-PER-005 | CURRENT_VERIFIED |
| FN-PER-006 | MERGED_INTO_OTHER |
| FN-PER-007 | CURRENT_VERIFIED |
| FN-ENT-001 | CURRENT_VERIFIED |
| FN-ENT-002 | CURRENT_VERIFIED |
| FN-ENT-003 | CURRENT_VERIFIED |
| FN-ENT-004 | CURRENT_VERIFIED |
| FN-ENT-005 | CURRENT_VERIFIED |
| FN-ENT-006 | CURRENT_VERIFIED |
| FN-MNG-001 | CURRENT_VERIFIED |
| FN-MNG-002 | CURRENT_VERIFIED |
| FN-MNG-003 | CURRENT_VERIFIED |
| FN-MNG-004 | CURRENT_VERIFIED |
| FN-MNG-005 | CURRENT_VERIFIED |
| FN-MNG-006 | CURRENT_VERIFIED |
| FN-MNG-007 | CURRENT_VERIFIED |
| FN-MNG-008 | CURRENT_VERIFIED |
| FN-MNG-009 | CURRENT_VERIFIED |
| FN-MNG-010 | CURRENT_VERIFIED |
| FN-MNG-011 | CURRENT_VERIFIED |
| FN-MNG-012 | CURRENT_VERIFIED |
| FN-ADM-001 | CURRENT_VERIFIED |
| FN-ADM-002 | CURRENT_VERIFIED |
| FN-ADM-003 | CURRENT_VERIFIED |
| FN-ADM-004 | CURRENT_VERIFIED |
| FN-ADM-005 | CURRENT_VERIFIED |
| FN-ADM-006 | CURRENT_VERIFIED |
| FN-ADM-007 | CURRENT_VERIFIED |
| FN-ADM-008 | CURRENT_VERIFIED |
| FN-ADM-009 | CURRENT_VERIFIED |
| FN-ADM-010 | CURRENT_VERIFIED |
| FN-ADM-011 | CURRENT_VERIFIED |
| FN-ADM-012 | CURRENT_VERIFIED |
| FN-ADM-013 | CURRENT_VERIFIED |
| FN-ADM-014 | CURRENT_VERIFIED |
| FN-ADM-015 | MERGED_INTO_OTHER |
| FN-ADM-016 | CURRENT_VERIFIED |
| FN-ADM-017 | CURRENT_VERIFIED |
| FN-ADM-018 | CURRENT_VERIFIED |
| FN-ADM-019 | CURRENT_VERIFIED |
| FN-ADM-020 | CURRENT_VERIFIED |
| FN-ADM-021 | CURRENT_VERIFIED |
| FN-ADM-022 | CURRENT_VERIFIED |
| FN-ADM-023 | CURRENT_VERIFIED |
| FN-ADM-024 | CURRENT_VERIFIED |
| FN-ADM-025 | CURRENT_VERIFIED |
| FN-ADM-026 | CURRENT_VERIFIED |
| FN-ADM-027 | CURRENT_VERIFIED |
| FN-ADM-028 | CURRENT_VERIFIED |
| FN-ADM-029 | CURRENT_VERIFIED |
| FN-ADM-030 | CURRENT_VERIFIED |
| FN-ADM-031 | CURRENT_VERIFIED |
| FN-PLAT-001 | CURRENT_VERIFIED |
| FN-PLAT-002 | CURRENT_VERIFIED |
| FN-PLAT-003 | CURRENT_VERIFIED |
| FN-PLAT-004 | CURRENT_VERIFIED |
| FN-PLAT-005 | CURRENT_VERIFIED |
| FN-PLAT-006 | CURRENT_VERIFIED |
| FN-PLAT-007 | CURRENT_VERIFIED |
| FN-PLAT-008 | CURRENT_VERIFIED |
| FN-PLAT-009 | CURRENT_VERIFIED |
| FN-PLAT-010 | CURRENT_VERIFIED |
| FN-PLAT-011 | CURRENT_VERIFIED |
| FN-PLAT-012 | CURRENT_VERIFIED |
| FN-API-001 | CURRENT_VERIFIED |
| FN-API-002 | CURRENT_VERIFIED |
| FN-API-003 | CURRENT_VERIFIED |
| FN-API-004 | CURRENT_VERIFIED |
| FN-API-005 | CURRENT_VERIFIED |
| FN-API-006 | CURRENT_VERIFIED |
| FN-API-007 | CURRENT_VERIFIED |
| FN-API-008 | CURRENT_VERIFIED |
| FN-API-009 | CURRENT_VERIFIED |
| FN-API-010 | CURRENT_VERIFIED |
| FN-API-011 | CURRENT_VERIFIED |
| FN-JOB-001 | CURRENT_VERIFIED |
| FN-JOB-002 | CURRENT_VERIFIED |
| FN-JOB-003 | CURRENT_VERIFIED |
| FN-JOB-004 | CURRENT_VERIFIED |
| FN-JOB-005 | CURRENT_VERIFIED |
| FN-JOB-006 | CURRENT_VERIFIED |
| FN-JOB-007 | CURRENT_VERIFIED |
| FN-JOB-008 | CURRENT_VERIFIED |
| FN-X-001 | CURRENT_VERIFIED |
| FN-X-002 | CURRENT_VERIFIED |
| FN-X-003 | CURRENT_VERIFIED |
| FN-X-004 | CURRENT_VERIFIED |
| FN-X-005 | TARGET_REDESIGN_REQUIRED |
| FN-X-006 | CURRENT_VERIFIED |
| FN-X-007 | CURRENT_VERIFIED |
| FN-X-008 | CURRENT_VERIFIED |
| FN-X-009 | CURRENT_VERIFIED |
| FN-X-010 | CURRENT_VERIFIED |
| FN-X-011 | CURRENT_VERIFIED |
| FN-X-012 | CURRENT_VERIFIED |

## Active X backend migration assessment

TARGET requirement for this audit overrides the older checkpoint direction for interaction ownership:

- authentication principal = Auth User
- acting/content/interaction identity = Active X

Auth User remains the security/account/session principal. Active X is **not** allowed to replace session, banned state, terms acceptance, admin role, or the server-side account-to-X approval/link check.

| Capability | CURRENT identity key | TARGET identity key | Migration/backfill/index impact | API / permission impact |
| --- | --- | --- | --- | --- |
| like / bookmark | video_interactions_auth(auth_user_id, video_id, type) | Active X x_user_id + Auth User provenance | **required**. Do not execute pending “drop video_interactions” plan as TARGET. Prefer expand/contract to an X-keyed canonical interaction row with acted_by_auth_user_id provenance. Backfill from current auth rows is deterministic only when one approved X is provable; multi-X historical rows must not be guessed. Unique key becomes (x_user_id, video_id, type); dedupe rows from multiple auth managers of the same X. | toggle requires authenticated user **and approved Active X**. Overlay/library query by active X. |
| view telemetry | browser/localStorage + GA4 event; no account row | telemetry remains anonymous/browser by default | no DB migration. Treat analytics as an intentional non-business-interaction exception; attaching X would change privacy/metric semantics. | no permission change. If a future persisted “view history” feature exists, give it a separate Active-X model. |
| chapter/comment | video_chapters.x_user_id; member chapter identity X | Active X / content X | already aligned; no backfill. Historical free-comment tables stay removed. | Auth User authorizes; command must bind actor Active X to chapter x_user_id. |
| audit actor | actor_user_id required; actor_x_user_id optional; snapshot may resolve current users.active_x_user_id | Auth User + acting Active X when command has acting identity | schema largely exists; **service-boundary migration required**, historical backfill not reliable. Never rewrite old null actor X from current Active X. Snapshot builder should snapshot the explicitly supplied actor X, not a later/current user setting. | admin/security-only commands may legitimately have null actor X; acting/content commands should pass it. |
| notifications | recipient_user_id is Auth User delivery principal; domain payload may carry content references | Auth User delivery principal + optional subject/actor X context | do not replace recipient auth ID. Add/standardize X context only where notification semantics are per-X. Backfill optional/null; dedupe keys may need subject X when the same auth user manages several X identities. | Discord/account delivery still resolves Auth User. X context must never authorize delivery. |
| creator ownership | videos.creator_x_user_id + submitted_by_user_id Auth provenance | same split | already aligned; no backfill/index redesign required. | editing authorization resolves Auth User -> approved X + privilege mode; content owner remains X. |
| collaboration | video_members.x_user_id + edit_granted_by_auth_user_id | same split | aligned. | delegate subject X; grant/revoke actor Auth User + acting X where applicable. |
| event staff | event_staff.x_user_id + approved_by_auth_user_id | same split | aligned; event+x unique index already matches target. | Auth User is authorized through all approved linked X IDs; Active X can choose acting/display context but is not sole permission source. |
| submissions | video creator X + submitted_by_user_id; slots/groups keep Auth reservation provenance + X/snapshot | same split | mostly aligned. Future cleanup may rename legacy reserved_by_user_id to explicit auth naming, but no semantic rewrite is needed. | submit/reserve requires Auth User security checks and appropriate Active X identity. |
| Active X switch | users.active_x_user_id validated against approved account link | same | aligned; request-local identity context should invalidate/refetch Active-X-scoped reads. | current switcher emits event + router.refresh, which is sufficient foundation for like/library semantic refresh after backend migration. |

### Interaction migration guardrails

1. Do not use the current users.active_x_user_id as a historical backfill oracle for old interactions.
2. Do not drop the legacy X-keyed video_interactions table until reconciliation shows whether it can seed target data.
3. Do not copy auth-owned rows to *all* linked X IDs.
4. When several Auth Users manage one X, target uniqueness is per X, not per account.
5. Keep acted_by_auth_user_id/provenance so moderation/audit/security investigation can still identify the authenticated principal.
6. app_like_count remains an aggregate on videos; migration must recompute/verify it from the target canonical interaction set before cutover.
7. The visual button/tab structure does not need redesign, but state semantics after Active X switch do change and must be contract-tested.

## Canonical source / storage audit

| Resource | Canonical role | Findings |
| --- | --- | --- |
| D1 | canonical business truth | Correct across events/videos/X links/staff/slots/outbox/rebuild/sync state. No target should authorize from R2/KV/client/session snapshot alone. |
| R2 | projection/static/media | Current aliases, composed event objects, analytics and media are delivery artifacts. They can be duplicated physically if one D1 identity and a publication/visibility commit-point remain canonical. |
| KV | small bounded cache/diagnostic state | CostGuard mirror / wake-failure diagnostics are acceptable only as acceleration/diagnostic. D1 system/work state remains authoritative. |
| Queue | doorbell | Current wake messages contain no recipient/video/event business payload. Keep it that way; D1 pending/due/lease state owns work. |
| Cache API | acceleration only | May hold public projection responses but never visibility/authz/business truth. |
| session/client | authentication hint/UI state only | Auth.js identifies the Auth User, then role/banned/terms/links/permissions are re-read/validated against D1. Client Active X state never authorizes a write by itself. |

No current code path reviewed in the audited baseline requires promoting R2, KV, Queue message or client state to canonical business truth. The main identity divergence is instead **which D1 table/key is canonical for like/bookmark**.

## Duplicate / obsolete / commonization final scan

| Optimization | Subject | Disposition | Frontend behavior change | Decision |
| --- | --- | --- | --- | --- |
| OPT-BE-001 | Request-local Account/Identity/Authz context | MERGE | NONE | React.cache/currentUser context already reduces reads; finish sharing linked X/approved X/management reads inside one request. Never cross-request cache authz. |
| OPT-BE-002 | writeGuard / requireAdminWrite envelope | KEEP | NONE | Existing security boundary is useful. Share transport/auth preconditions, not domain permission flags. |
| OPT-BE-003 | mutateWithAudit + CAS budget | KEEP | NONE | Atomic mutation+audit is a safety primitive; optimize batching/actor snapshot reads without weakening strict audit. |
| OPT-BE-004 | ActorContext -> audit actor X | TARGET_REWRITE | NONE | Propagate Auth User + acting Active X explicitly; current optional actor_x coverage is incomplete. Historical null actor X remains null. |
| OPT-BE-005 | post-commit effect runner | KEEP | NONE | Keep explicit effect classes; visibility-critical publication is not generic best-effort. |
| OPT-BE-006 | admin/manage video status transitions | MERGE | NONE | Share status transition domain core; role/permission/result/navigation adapters remain separate. |
| OPT-BE-007 | event/video save/update plans | MERGE | NONE | Reuse validation/member/static plans while preserving slot transaction and section permission boundaries. |
| OPT-BE-008 | page-local Server Action wrappers SA-108/109/110 | MERGE | NONE | Move to typed transport adapters; remove generic dispatcher/wrapper-only duplication after transport migration. |
| OPT-BE-009 | public API envelope | MERGE | NONE | Share rate limit, explicit DTO, safe error and cache header; route visibility/fallback policies stay explicit. |
| OPT-BE-010 | public HTML request-time React/SSR | TARGET_REWRITE | NONE | Production exceededCpu evidence supports SSG/static assets + thin gateway. Same URLs/loading/error/visibility contracts. |
| OPT-BE-011 | private dashboard/entry/manage/admin SSR | TARGET_REWRITE | NONE | React/Vite SPA + bounded APIs removes Worker render CPU; auth/permission states remain server-authoritative. |
| OPT-BE-012 | live API adapter | KEEP | NONE | Shared handleLiveApiGet + bounded payload queries is already the right shape; keep 5s freshness contract. |
| OPT-BE-013 | image proxy delivery | TARGET_REWRITE | NONE | Use direct/static/R2 URLs for stable images where revocation/provenance permits; guarded provider proxy remains fallback. |
| OPT-BE-014 | media delivery primitives | MERGE | NONE | Share key/type/size/R2 streaming/cache primitives; public ACL/signed manage/viewer conditional guards are exceptions. |
| OPT-BE-015 | users score request-time duplicate sort | REMOVE | NONE | Already removed on current main: prepareUsersIndexItems keeps generated score order after filter. Do not reintroduce. |
| OPT-BE-016 | YouTube sync admin list cross-table COALESCE sort | TARGET_REWRITE | NONE | Current main no longer has the previously reported unused x_users join, but ORDER BY COALESCE(metadata.updated_at,videos.updated_at,created_at) can still scan/sort. Build bounded admin read model/projection and verify EXPLAIN/rows_read. |
| OPT-BE-017 | COUNT + list double read | KEEP | NONE | Prefer existing LIMIT+1 pagination where exact total is not product-required; do not add COUNT solely for UI decoration. |
| OPT-BE-018 | decorative icon N+1 authorization reads | REMOVE | NONE | Current optimized paths already derive canonical icon fields from bounded list query/sign once; keep regression checks. |
| OPT-BE-019 | static artifact descriptor/publication protocol | MERGE | NONE | Share typed descriptors/hash/write/commit-point primitives; entity release prerequisites remain explicit. |
| OPT-BE-020 | R2 canonical aliases/copies | INTENTIONAL_EXCEPTION | NONE | Aliases/composed objects are delivery compatibility projections, not second business truth; hash/dedupe avoids needless PUT. |
| OPT-BE-021 | Queue wake/continuation shell | MERGE | NONE | One data-free doorbell protocol and bounded drain shell; D1 remains work truth. |
| OPT-BE-022 | Queue platform retry + app retry + Recovery Cron | INTENTIONAL_EXCEPTION | NONE | Three layers solve different failure modes. Do not collapse counters or make DLQ canonical. |
| OPT-BE-023 | static dirty-generation / completion sentinel | INTENTIONAL_EXCEPTION | NONE | Prevents lost invalidation and duplicate expensive rebuild after done-mark failure. |
| OPT-BE-024 | Discord delivery suppression marker | INTENTIONAL_EXCEPTION | NONE | Prevents duplicate external delivery when Discord succeeded but D1 sent-mark failed. |
| OPT-BE-025 | YouTube quota/deferred + playlist cursor semantics | INTENTIONAL_EXCEPTION | NONE | Quota is persisted business deferral, not Queue failure; playlist scan cursor/remote mutation requires domain state. |
| OPT-BE-026 | legacy import / spreadsheet bulk command | INTENTIONAL_EXCEPTION | NONE | Preview/atomicity/bounded-stream/recovery requirements justify dedicated boundaries. |
| OPT-BE-027 | Active-X like/bookmark canonical identity | TARGET_REWRITE | REQUIRED | Explicit TARGET requirement changes visible identity semantics: interaction state/library follows Active X. UX-VID-025..030 and UX-LIB-001..012 must refresh consistently on Active X switch; visual structure need not change. |

### Obsolete/meaning-thin processing conclusions

- Duplicate score sorting on the default creator-score path is **already removed on current main**; keep the regression behavior.
- The earlier unused x_users JOIN in YouTube sync admin query is **not present on current main**; do not propose removing a JOIN that no longer exists.
- Page-local Server Action wrappers/dispatcher that only translate transport state have no target domain value and should disappear when transport is replaced.
- Separate backend implementations for /admin/history and personal YouTube playlist are not justified: their backend responsibilities are represented by audit and YouTube sync domains respectively.
- Legacy compatibility artifacts are not automatically obsolete. Canonical video aliases, event tombstones, old interaction data needed for Active-X reconciliation, and static visibility tokens have migration/recovery value and must not be deleted merely to reduce code.

## Intentional exceptions

| Exception | Why genericization is rejected |
| --- | --- |
| event ID rename/reuse/tombstone | multi-table canonical ID + old-ID tombstone + visibility/static rollback; never generic CRUD |
| audit restore | dry-run/conflict/restore capability + mutation/audit batch; generic update would lose restoration semantics |
| X merge/revert | multi-table X reference rewrite, preflight, dedupe, revert and static fanout |
| submitted-slot destructive release | slot/video state transition with explicit operator intent and notifications |
| Discord account-link conflict | provider/link uniqueness and security principal ownership |
| terms CAS/version lifecycle | acceptance/reaccept/version publication has security/legal state |
| Active X switch | approved-link validation + account state + request refresh; acting identity switch, not permission shortcut |
| last operable event owner | owner preset plus approved owner account link; SQL/CAS invariant |
| creator-only permission delegation | video ownership/collaboration permission semantics differ from event/admin privilege |
| visibility fence release | deny-first/release_pending/token CAS; publication safety critical |
| dangling visibility repair | repair is explicit safety workflow, not ordinary projection refresh |
| rules no-stale | latest terms cannot use ordinary stale public fallback |
| search generation completeness | immutable generation + manifest commit; partial shard result forbidden |
| Discord external-delivery suppression marker | external side effect success must survive D1 finalization failure without redelivery |
| static dirty-generation | invalidation arriving during processing must requeue rather than finalize stale output |
| YouTube quota/deferred semantics | quota stop is business deferral, not infrastructure retry |
| playlist cursor/scan semantics | remote ordered playlist mutation/cursor must persist separately from generic sync retry |

These exceptions are not “technical debt to delete”. They encode security, publication safety, exactly-once-like external delivery, recovery or provider semantics.

## Cloudflare TARGET backend architecture

### Public

**static-first / SSG + thin visibility/API gateway**

- stable HTML/JSON generation leaves the web fetch hot path;
- direct Static Assets/R2 satisfy normal public reads;
- thin gateway performs only visibility/canonical alias decisions that cannot be safely baked;
- viewer state lives in explicit private overlays/live APIs;
- external images use direct/static delivery where revocation/provenance allows, with guarded proxy fallback.

Reason: PERFORMANCE_BASELINE has real web exceededCpu events and a web fetch p95/p99 far above the future thin-gateway budget. Raising CPU limits alone would not address SSR, JSON transforms, historical memory/canceled failures, or unnecessary image proxy work.

### Private

**React/Vite SPA + bounded API**

- no request-time React SSR for dashboard/entry/manage/admin;
- API adapters resolve Auth User + request-local Identity/Authz context;
- domain commands/queries remain framework-neutral;
- D1 query shape is bounded and measured; exact totals are not fetched unless product-required.

### Heavy / external

**Queue/background**

- static builds, GA4/ranking, YouTube metadata/playlist, notification delivery, bulk repair/import phases remain off HTTP;
- one bounded Queue invocation performs bounded work, then emits at most a continuation doorbell;
- Recovery Cron owns stale lease/reconciliation rather than every Queue wake;
- platform Queue retry, application retry and recovery remain distinct.

### D1 rows/read priorities

1. Measure query plans/rows_read; prefer index/searchable predicates over full scans.
2. Keep request-local current user/link/permission context; no global/cross-request authz cache.
3. Replace request-time large JSON normalize/sort/render with static build work.
4. For YouTube sync admin ordering, materialize/index a bounded sort/read model if EXPLAIN still shows scan/temp sort; do not add an index blindly to each source column because the current ORDER BY is cross-table COALESCE.
5. Preserve LIMIT+1 pagination where an exact COUNT is not required.
6. Avoid reintroducing icon/permission N+1 reads already removed.

## Frontend optimization blockers

### Performance/architecture blockers requiring frontend product behavior change: 0

Public SSG, private SPA, bounded APIs, request-local auth context, D1 read-model improvements, Queue/background ownership, direct/static image delivery and commonized transport primitives can preserve URLs, permission semantics, loading/error/empty states, freshness contracts and destructive-action confirmations.

### Explicit TARGET identity divergence (not a performance blocker)

**Active-X like/bookmark canonicalization: frontend behavior change = REQUIRED (semantic, not visual).**

Affected capability IDs:
- FN-PUB-007
- FN-PER-004
- FN-AUTH-010 (switch event/refresh, already CURRENT_VERIFIED)
- FN-X-005 (audit actor context)

Affected UX:
- UX-VID-025..030
- UX-LIB-001..012
- Active X switch surfaces using FN-AUTH-010

CURRENT frontend behavior:
- like/bookmark follows Auth User across Active X changes.
- mine follows Active X; collaboration/chapter uses approved linked X sets.

Why backend-only “keep current semantics” is not acceptable:
- the user-specified TARGET explicitly defines interaction identity as Active X. Keeping auth_user_id canonical would violate that target even if it is simpler.

Alternative A — preserve CURRENT account-owned interaction:
- backend consequence: no schema migration.
- frontend impact: none.
- migration risk: low.
- **Rejected for TARGET** because it violates the stated identity model.

Alternative B — Active-X interaction:
- backend benefit: content/interaction identity becomes internally consistent with creator/member/staff/chapter models.
- exact frontend impact: switching Active X changes like/bookmark active state, library like/save rows and lib-like/lib-bookmark playlist.
- migration risk: historical multi-X auth interactions cannot be safely attributed without evidence.
- Recommendation: target this behavior, use expand/reconcile/cutover, and require contract tests around Active X switch.
- Approval required: no additional approval; this task prompt already defines the TARGET requirement.

## Self-review

- [x] 136 FN have a final disposition in canonical ledgers.
- [x] 103 former DETAIL_AUDIT_REQUIRED rows are audited above.
- [x] DETAIL_AUDIT_REQUIRED = 0 in function ledgers.
- [x] 110 Server Action execution units remain resolved.
- [x] 33 Route Handler methods remain resolved.
- [x] D1/R2/KV/Queue/Cache source-of-truth roles are explicit.
- [x] Active X backend divergence and migration risks are explicit.
- [x] duplicate/obsolete/commonization candidates have disposition.
- [x] intentional security/recovery exceptions are explicit.
- [x] frontend-required semantic change is isolated from performance optimization blockers.
- [x] production runtime code changed = 0.
- [x] Cloudflare production resource changed = 0.
- [x] STATUS/frontend ledgers/screen mapping/CURRENT_ROUTES changed = 0.
- [x] independent approval is **not** claimed.

MIG-0011 remains an integration task after the parallel frontend PR is merged.
