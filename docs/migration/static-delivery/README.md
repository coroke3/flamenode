# FlameNode Static Artifact / Visibility CURRENT Baseline

> Status: CURRENT_VERIFIED
> Verified: 2026-10-07
> Scope: public/static artifacts, canonical aliases, visibility fences, R2 miss/fallback, tracking/dedupe, repair
> Platform boundary: [`../cloudflare/TOPOLOGY.md`](../cloudflare/TOPOLOGY.md)
> Performance boundary: [`../cloudflare/PERFORMANCE_BASELINE.md`](../cloudflare/PERFORMANCE_BASELINE.md)
> Production mutation: none

MIG-0007でCURRENTの静的配信安全契約をcode/testsから固定する。D1がcanonical sourceであり、R2/KV/Cache APIはprojection/delivery stateであってcanonical databaseではない。

## Static rebuild target set

`src/lib/staticRebuild/types.ts` と `workers/json-generator/rebuild.ts` のtarget dispatcherを照合し、CURRENT targetは **25** 種類。

| Target | Principal artifact / role |
| --- | --- |
| `top` | `top.json` composer |
| `top_recommended` | `top/sections/recommended.v1.json` |
| `top_latest` | `top/sections/latest.v1.json` |
| `top_nostalgic` | `top/sections/nostalgic.v1.json` |
| `top_events` | `top/sections/events.v1.json` |
| `top_announcements` | `top/sections/announcements.v1.json` |
| `top_stats` | `top/sections/stats.v1.json` |
| `top_slot_stats` | `top/slot-stats.v1.json` |
| `events_index` | `events/index.json` including public group sections |
| `event_base` | `events/{id}/base.v1.json` + event playlist projection |
| `event_slots` | `events/{id}/slots.v1.json` |
| `event_release` | `events/{id}/release.v1.json` |
| `event` | `events/{id}.json` composed public detail |
| `video` | canonical `videos/{internalId}.json` + YouTube alias object |
| `user` | `users/{id}.json` + bounded works/collabs pages |
| `users_index` | creator index/shared inputs + v2 generation artifacts |
| `list_recent` | `list/recent.json` |
| `list_popular` | `list/popular.json` |
| `search_index` | `search-index-lite.json` + generation postings-v1 |
| `recommend_core` | `recommend/core.v1.json` |
| `recommend` | `recommend.json` composer |
| `rules` | `rules/current.json` |
| `youtube_related_blocklist` | `youtube/related-blocklist.v1.json` |
| `random_video_pool` | `videos/random-pool.v1.json` |
| `member_suggestions` | internal member suggestion artifacts including v2 generation |

The target set is a migration contract. A target may emit multiple physical objects; object count is deliberately not treated as the API.

## Artifact family ledger

| Family | Physical key pattern / commit point | Writer | Readers / UX | Visibility / failure rule | FN |
| --- | --- | --- | --- | --- | --- |
| Home composer | `top.json`; sections under `top/sections/*.v1.json`; `top/slot-stats.v1.json` | content generator | home, about stats | section artifacts are bounded; composer publishes only from valid inputs; private entities filtered | FN-PLAT-002,003,006 |
| Lists | `list/recent.json`, `list/popular.json` | ranking bundle/content | `/list`, home/list rails | bounded max corpus/object size; R2/static preferred; empty overlay collection may request rebuild without unbounded D1 projection | FN-PLAT-002,003,007 |
| Video detail | `videos/{internalId}.json` and optional `videos/{youtubeId}.json` | video rebuild | `/[id]`, related/card readers | manifest fence checked; canonical internal ID owns rebuild; alias is compatibility copy, not second canonical entity | FN-PLAT-002,003,004 |
| Creator detail | `users/{id}.json`, `works/{page}.json`, `collabs/{page}.json` | user rebuild | `/user/[id]*` | x_user fence/listability applied; page count is bounded; case-insensitive canonical X ID | FN-PLAT-002,003,004 |
| Creator shared index | `users/index.json`, `users/public-x-icon-map.v1.json`, `users/pickup-creators.v1.json` | users_index rebuild | user search, icon/pickup shelves | public-listable projection only; icon completion path does not drop to D1 | FN-PLAT-002,003,004,008 |
| Creator index v2 | `users/index.v2/manifest.json` + immutable generation pages/search postings | users_index optimized rebuild | bounded creator page/search | generation manifest is commit point; mismatched/incomplete generation is invalid; current generation excluded from GC | FN-PLAT-003,006,008 |
| Video search postings | legacy complete `search-index-lite.json` plus generation-specific postings manifest/directory/pages | search_index | `/list?q=` | bounded shard reads; missing/over-limit shard falls back to complete legacy index rather than returning partial results | FN-PLAT-003,006,008 |
| Events index/groups | `events/index.json` | events_index | `/event`, `/groups*` | public events/groups only; group promotion fence stays blocked until complete index including group sections is current | FN-PLAT-002,003,004 |
| Event detail producers | `base.v1.json`, `slots.v1.json`, `release.v1.json`, `playlist.v1.json` | event_* rebuilds | event detail/slots/release/playlist | promotion fence is not released until all producer tracking rows are current versus D1 `updated_at` | FN-PLAT-003,004,006 |
| Event composed detail | `events/{id}.json` | event composer | `/event/[id]` | requires valid producer sections; non-public event cleanup removes tracked + canonical keys and does not release tombstone | FN-PLAT-002,003,004 |
| Recommend | `recommend/core.v1.json` -> `recommend.json` | ranking/core + composer | `/recommend`, home | public-safe bounded pools; composer separated from producer inputs | FN-PLAT-002,003,006 |
| Shared YouTube safety | `youtube/related-blocklist.v1.json`, `videos/random-pool.v1.json` | content rebuild | related/recommend/random | non-public/private/missing YouTube items remain excluded; readers use bounded shared inputs | FN-PLAT-002,003 |
| Rules | `rules/current.json` | content rebuild | `/rules` | stale fallback deliberately disabled for current rules | FN-PLAT-003,007 |
| Trending analytics | `analytics/trending.json` | analytics job | `/trending`, home where eligible | R2-only reader; no D1 fallback; analytics scoring semantics remain FN-PLAT-009 audit scope | FN-PLAT-007,009 |
| Visibility deny manifest | `visibility/blocked-entities.v1.json` | visibility transition + content release | every fenced public read | in `enforce`, malformed/missing/read failure is unavailable/fail-closed; CAS/token protected | FN-PLAT-004,005,FN-X-010 |
| Internal member suggestions | `internal/member-suggestions/v2/manifest.json` + generation index/postings | content rebuild | authenticated/internal suggestion API | generation tracking is completed before publish; incomplete total/index generation rejected | FN-PLAT-003,006,008 |

Physical shard/object keys may evolve without product change. Migration must preserve each family’s commit-point, completeness, visibility, and fallback semantics.

## Canonical ID and alias contract

D1 remains identity/canonical truth.

### Video

- Public route accepts internal ID and YouTube video ID.
- On R2 miss, `probePublicStaticTarget` resolves the requested ID to the canonical internal video ID.
- Rebuild enqueue uses `canonicalTargetId`, so an alias miss cannot create a second `video:<youtube-id>` queue identity.
- Before heavy degraded D1 projection, the loader rewrites the R2 key to the canonical video object and retries R2.
- The generated video target may publish both `videos/{internalId}.json` and `videos/{youtubeId}.json` for URL compatibility.
- Cache invalidation covers canonical and alias keys.

### X user

- Fence and public probe identity are case-insensitive and normalized to lower case for matching.
- Legacy/request casing does not create a separate visibility entity.
- Canonical-key rewrite is allowed only through the bounded rewrite helper.

### Unsafe rewrite rejection

Canonical R2 rewrite rejects unsafe IDs/key segments such as slash/backslash, `..`, control characters, leading/trailing whitespace or empty segments. Alias compatibility must never become arbitrary R2 key access.

## Visibility fence state machine

Canonical deny object:

`visibility/blocked-entities.v1.json`

Entity types:

- `video`
- `event`
- `x_user`
- `event_group`

D1 fence states:

- `blocked`
- `release_pending`
- `released`

Guard modes:

- `off`
- `observe`
- `enforce`

### Public -> private / no-longer-listable

Safety ordering is **R2 deny first, canonical D1 mutation second**.

1. Generate/reuse a fence token and plan D1 fence state `blocked` in the same canonical mutation batch.
2. Before that D1 mutation, CAS-upsert the exact token into the R2 deny manifest.
3. Re-read the manifest and verify the same token is visible.
4. Commit canonical D1 status + fence row + associated queue/audit mutation.
5. Invalidate public Cache API keys and rebuild/cleanup affected artifacts.
6. If D1 mutation fails, compensation may remove only its exact stale token and only when no matching live D1 fence remains. Token mismatch belongs to a newer transition and is untouched.

Video deliberately keeps a failed de-publication block unless rollback safety is proven; public data exposure is less acceptable than a temporary false-negative.

### Private -> public / newly-listable

Re-publication is also deny-first.

1. Create/reuse token and set D1 fence to `release_pending`.
2. Precommit the same deny manifest block before canonical D1 status becomes public.
3. Generate all required public artifacts.
4. Verify entity-specific freshness/completeness:
   - video: successful canonical public artifact;
   - event: event is still public and event_base/event_slots/event_release/event_playlist tracking is at least current D1 `updated_at`, then composed output;
   - x_user: still public-listable and both user + users_index tracked generations are newer than fence update;
   - event_group: still public and full events index/group section was generated from current row.
5. Remove only the matching manifest token with R2 CAS.
6. Mark D1 fence `released` with token/state CAS.
7. If the D1 release CAS loses a race after R2 removal, restore a deny block for the newer live D1 token.

This ordering prevents stale artifacts from becoming visible during promotion and prevents a later private transition from being accidentally released by an older rebuild.

## Event rename / ID reuse safety

Event rename is an intentional exception to generic CRUD.

- If a visibility fence exists, the manifest entry is copied/moved with the same token before D1 rename.
- The old ID keeps a tombstone so stale R2 payloads cannot reappear after D1 no longer has the old primary key.
- Non-public event cleanup removes tracked objects and the canonical event/base/slots/release/playlist keys even if legacy tracking rows are missing.
- Cleanup alone never releases the old-ID tombstone.
- D1 rollback compensation restores only the exact previous token/entry.
- Event ID reuse must verify the retention/absence/fence conditions before release.

Do not replace this with a simple `visibility_status` check.

## Enforce-mode public read guarantee

In `enforce` mode, a public detail/collection must not serve potentially private data when the visibility manifest cannot be trusted.

- Manifest read/parse failure -> `unavailable`, not fail-open.
- R2 hit payloads are filtered through `PublicArtifactVisibilityContext` where applicable.
- Degraded D1 payloads rebuild the same visibility context; degraded mode cannot bypass X-user/event/video filtering.
- Stale global collections that can include mutable entities require a successfully loaded visibility manifest before stale Cache API fallback.
- Event-staff public API rechecks event/contained entity visibility before emitting its allowlisted DTO.
- Deep health reports visibility degradation; `enforce` treats inability to validate as blocking public safety.

## R2 miss / fallback matrix

| Strategy / condition | R2/static miss behavior | D1 behavior | Public state |
| --- | --- | --- | --- |
| `maintenance` | do not recover on request | none | `unavailable` |
| `static_json_only` | bounded high-priority rebuild may be requested where policy permits | no degraded public projection | reflecting/unavailable/not_found based on probe |
| `static_json_with_live_overlay` + public detail | probe D1, retry canonical R2 alias key, enqueue canonical rebuild | bounded degraded fetch only if enabled/circuit allows | degraded ready or reflecting |
| same + missing/not-public target | no fake public recovery | no degraded fetch; missing/not_public do not increment public-miss KV circuit counter | `not_found` |
| same + probe failure | recovery is uncertain | do not convert DB failure to missing | `unavailable` |
| same + empty static collection | may be semantic miss and enqueue rebuild | global list/search/top do not run an unbounded full projection just because JSON is empty | existing empty/reflection state |
| stale Cache API candidate | bounded by family TTL | no D1 merely to refresh stale object | usable only when family allows; mutable global collections may require visibility manifest |
| `rules/current.json` | miss/rebuild path only | no unsafe stale rules fallback | unavailable/reflecting rather than stale terms |

`PUBLIC_DEGRADED_D1_ENABLED` is an explicit kill switch. Degraded D1 is permitted only for `static_json_with_live_overlay`; it is not an unconditional fallback.

Implementation anchors retained by the loader are `degraded_d1` for bounded live fallback and `requireVisibilityManifestForStale` for stale-cache paths that must prove a trustworthy visibility manifest before serving mutable public collections.

Public data state vocabulary that frontend migration must preserve:

- `ready`
- `empty`
- `stale`
- `reflecting`
- `unavailable`
- `not_found`

## Publication, tracking and dedupe invariants

- Public payloads pass explicit projection/sanitization; private source rows are not copied wholesale.
- Every bounded artifact has object-size/input-row guards; unlimited full-table JSON generation is forbidden.
- `static_artifacts` tracks physical R2 objects, target identity, generation/freshness and deletion.
- Content hashes avoid unnecessary R2 PUTs only when doing so cannot hide a repair requirement.
- Repair/miss/visibility/deploy-generator-change reasons force regeneration where immutable-generation fast paths would otherwise skip.
- Generation families publish immutable objects first and a manifest/commit point last.
- If tracking/publication fails before commit, delete only newly generated unpublished keys; do not destroy the currently live generation.
- A loader rejects mismatched/incomplete manifest/index/shard generations instead of returning a partial search result.
- Current live generation is excluded from cleanup/purge; stale GC is bounded.
- `STATIC_GENERATOR_HASH` causes global rebuild enqueue only when generator sources change; docs/UI-only deployment does not intentionally rebuild every public artifact.
- `putVisibilityManifestWithCas` and token comparison are required for visibility manifest mutation; last-write-wins without token ownership is invalid.

## Repair and compensation

### Automatic repair

- genuine public R2 miss can enqueue a canonical rebuild with cooldown/coalescing;
- generator-change recovery retries failed global targets in a bounded manner;
- event playlist backfill/repair uses existing event target fanout rather than a second unbounded publication path;
- visibility release only happens after rebuilt artifacts satisfy entity-specific freshness.

### Admin dangling-manifest repair

`repairDanglingPublicVisibilityManifestEntry` is admin-only via `requireAdminWrite("admin_static_rebuild")`.

It may remove an R2 deny entry only when:

- no live D1 fence exists, or the D1 row is historical `released`;
- a historical row, if present, has the exact submitted fence token;
- the R2 manifest still contains that exact token;
- the CAS conflict handler still sees the same token.

It must not release `blocked`/`release_pending` live fences or a newer token. Failure telemetry deliberately omits token/SDK payloads.

The bootstrap command creates only a missing canonical empty manifest and refuses to overwrite an existing/malformed manifest.

## UX / FN impact

Primary frontend-observable contracts:

- video alias + visibility: `UX-VID-002..003`
- reflection/degraded related state: `UX-VID-047,UX-VID-053..054`
- discovery list/search/recommend/trending state: `UX-DISC-001..015`
- creator public-listability/profile/search: `UX-USER-001..016`
- event/group visibility/release/slots: `UX-EVENT-001..024`
- home degraded/empty: `UX-PUB-007`
- manage visibility result: `UX-MNG-049`
- static build/repair visibility: `UX-ADM-073..075,UX-ADM-087`
- repair/global safety state already mapped by Server Action inventory: `UX-GLOBAL-026`

CURRENT_VERIFIED function contracts in this task:

- `FN-PLAT-002` public DTO projection
- `FN-PLAT-003` static artifact generation contract
- `FN-PLAT-004` visibility fence
- `FN-PLAT-005` visibility repair
- `FN-PLAT-006` R2 hash/tracking/dedupe
- `FN-PLAT-007` degraded D1/public fallback
- `FN-PLAT-008` search index/shards
- `FN-X-004` no private data in public artifacts
- `FN-X-010` fail-closed public visibility

Queue delivery/retry/redelivery semantics remain `FN-JOB-002/FN-JOB-004/FN-JOB-008` scope for MIG-0009. Trending score/order remains `FN-PLAT-009`. Admin queue UX completeness remains `FN-PLAT-010`.

## Optimization disposition

### Strengthen/reuse

- typed artifact descriptor/key-builder + explicit schema/normalizer/max-size contracts;
- one bounded publication protocol: project -> sanitize/validate -> track/hash -> write immutable/body objects -> publish commit manifest/composer;
- shared visibility fence planner/precommit/compensation/release CAS;
- shared R2 miss result envelope with canonical probe, safe alias rewrite, rebuild request, operation-mode and bounded degraded policy;
- typed dependency graph from domain mutation to affected artifact targets so duplicate fanout code can be reduced without hiding effects.

### Keep intentionally explicit

- event ID rename/reuse/tombstone;
- dangling visibility repair;
- rules no-stale behavior;
- search generation/shard completeness and commit-point logic;
- media/external-image proxy security boundaries;
- entity-specific visibility release prerequisites.

### Reject

A single generic “R2 repository” or generic CRUD publication helper that erases freshness, visibility, alias, manifest commit-point or compensation semantics. Physical JSON similarity is not sufficient evidence for behavioral commonization.

Optimization blockers requiring frontend change: **0**

Rendering/storage ownership may change in the target architecture, but the `ready/empty/stale/reflecting/unavailable/not_found`, URL alias, visibility and permission behavior remain product contracts.

## Test / evidence set

Representative CURRENT evidence:

- `src/lib/publicData/loader.test.mjs`
- `src/lib/publicData/publicVisibilityManifest.test.mjs`
- `src/lib/publicData/publicVisibilityManifestCore.test.mjs`
- `workers/shared/publicVisibilityManifest.test.mjs`
- `src/lib/actions/public-visibility-repair.contract.test.mjs`
- `src/lib/video/videoVisibilityCompensation.execution.test.mjs`
- `workers/json-generator/rebuild.test.mjs`
- `workers/json-generator/usersIndexV2Artifacts.contract.test.mjs`
- `workers/json-generator/publicIconV2Artifacts.test.mjs`
- `workers/json-generator/pickupCreatorsR2.test.mjs`
- `src/lib/publicData/staticSharedInputsLoader*.test.mjs`
- `src/lib/health/deepHealth.test.mjs`
- `scripts/bootstrap-public-visibility-manifest.test.mjs`
- `scripts/check-public-visibility-fences.test.mjs`
- `src/lib/staticRebuild/enqueue*.test.mjs`
- `src/lib/runtimeErrorHardening.contract.test.mjs`
- `src/lib/db/videoPlaylistAuth.contract.test.mjs`

MIG-0007 changes documentation/checker state only. Production runtime, D1, R2, KV, Cache API, Queue, Custom Domain and deployed configuration are unchanged.
