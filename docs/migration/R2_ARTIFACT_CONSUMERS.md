# R2 artifact consumers — MIG-0649

Last audited: 2026-10-26. This is an inventory of CURRENT/bridge R2 artifact dependencies, NOT an instruction to delete any object.

## Artifact keys, producers, consumers and migration disposition

| Artifact key | Producer (source:line or target) | Consumer (source:line or family) | Target / retention | Owner MIG |
| --- | --- | --- | --- | --- |
| `list/recent.json` | workers/json-generator/rebuild.ts:1142 | src/lib/publicData/loader.ts:1113; src/lib/publicData/sitemapSources.ts:42; workers/ga-analytics/sync.ts:142 | Build snapshot: video recent / migrate GA4 input in MIG-0517 | MIG-0509 / MIG-0517 |
| `list/popular.json` | workers/json-generator/rebuild.ts:1164 | src/lib/publicData/loader.ts:1155; src/lib/health/artifactSlo.ts:118 | Build snapshot popular list; remove runtime R2 dependence | MIG-0509 / MIG-0627 |
| `events/index.json` | workers/json-generator/rebuild.ts (events_index target) | src/lib/publicData/loader.ts:1064; src/lib/publicData/sitemapSources.ts:48 | Build event index; Hono static_only preserves until replacement | MIG-0509 / MIG-0627 |
| `users/index.json` | workers/json-generator/rebuild.ts (users_index target) | src/lib/publicData/loader.ts:1780; src/lib/publicData/sitemapSources.ts:54 | Build user index / sitemap / public search | MIG-0509 / MIG-0627 |
| `search-index-lite.json` | workers/json-generator/rebuild.ts (search_index target) | src/lib/publicData/loader.ts:1339; src/lib/publicData/sitemapSources.ts:60 | Build search index snapshot | MIG-0509 / MIG-0627 |
| `recommend/core.v1.json` | workers/json-generator/rebuild.ts (recommend_core target) | src/lib/health/artifactSlo.ts:138; workers/json-generator/rebuild.ts:3557 | Build recommendation core; remove generator after cutover | MIG-0509 / MIG-0907 |
| `recommend.json` | workers/json-generator/rebuild.ts (recommend target) | src/lib/publicData/loader.ts:1805; src/lib/health/artifactSlo.ts:150 | Build recommendation view | MIG-0509 / MIG-0627 |
| `rules/current.json` | workers/json-generator/rebuild.ts (rules target) | src/lib/publicData/loader.ts:1712; apps/api/src/routes/personal/onboarding.ts:12-33 | Build published rules or retain verified runtime fallback | MIG-0509 / MIG-0627 |
| `top.json` | workers/json-generator/rebuild.ts (top target) | src/lib/publicData/loader.ts:1733; src/lib/health/artifactSlo.ts:101 | Build homepage snapshot | MIG-0509 / MIG-0627 |
| `top/sections/recommended.v1.json` | workers/json-generator/rebuild.ts (top recommendation section) | src/lib/publicData/staticTopSectionsCore.ts:12 (shared key) | Build top sections | MIG-0509 / MIG-0627 |
| `top/sections/latest.v1.json` | workers/json-generator/rebuild.ts (top latest section) | src/lib/publicData/staticTopSectionsCore.ts:13 (shared key) | Build top sections | MIG-0509 / MIG-0627 |
| `top/sections/nostalgic.v1.json` | workers/json-generator/rebuild.ts (nostalgic section) | src/lib/publicData/staticTopSectionsCore.ts:14; workers/json-generator/rebuild.ts:759 | Build top sections | MIG-0509 / MIG-0627 |
| `top/sections/events.v1.json` | workers/json-generator/rebuild.ts (top events section) | src/lib/publicData/staticTopSectionsCore.ts:15 | Build top sections | MIG-0509 / MIG-0627 |
| `top/sections/announcements.v1.json` | workers/json-generator/rebuild.ts (top announcements section) | src/lib/publicData/staticTopSectionsCore.ts:16 | Build top sections | MIG-0509 / MIG-0627 |
| `top/sections/stats.v1.json` | workers/json-generator/rebuild.ts (top stats section) | app/api/public/about-stats/route.ts:72; apps/api/src/routes/publicAboutStats.ts | Build stats projection, audit RH-026 consumer | MIG-0509 / MIG-0627 |
| `analytics/trending.json` | workers/ga-analytics/sync.ts:21 | public trending builder; workers/ga-analytics/sync.ts (read previous count) | Keep until GA4 producer replacement; do not delete blindly | MIG-0517 / MIG-0907 |
| `youtube/related-blocklist.v1.json` | workers/json-generator/rebuild.ts (youtube_related_blocklist target) | src/lib/publicData/staticSharedInputsLoader.ts; src/lib/health/artifactSlo.ts:160 | Build shared inputs; retire old reader after cutover | MIG-0509 / MIG-0907 |
| `videos/random-pool.v1.json` | workers/json-generator/rebuild.ts (random_video_pool target) | src/lib/publicData/staticSharedInputsLoader.ts; src/lib/health/artifactSlo.ts:165 | Build random pool; retire old reader after cutover | MIG-0509 / MIG-0907 |
| `visibility/blocked-entities.v1.json` | packages/server-core/src/visibility/manifestR2.ts (state writer) | src/lib/health/deepHealth.ts:299; packages/server-core/src/visibility/manifestR2.ts | RETAIN: visibility revocation manifest used beyond migration | MIG-0614 / MIG-0615 |
| `events/<id>.json` | workers/json-generator/rebuild.ts (event detail producer) | src/lib/publicData/loader.ts:1006 | Replace with build event snapshot | MIG-0509 / MIG-0627 |
| `events/<id>/base.v1.json` | workers/json-generator/rebuild.ts:1990 | app/api/public/events/[id]/staff/route.ts:177; apps/api/src/routes/events (RH-028) | Build event base; retain while Hono reader requires artifact | MIG-0509 / MIG-0627 |
| `events/<id>/slots.v1.json` | workers/json-generator/rebuild.ts:1994 | CURRENT event slots public readers | Build slot list; preserve public visibility filtering | MIG-0509 / MIG-0627 |
| `events/<id>/release.v1.json` | workers/json-generator/rebuild.ts (event release producer) | src/lib/publicData/loader.ts:1048; apps/api/src/routes/events/publicRelease.ts | Build release snapshot; retain Hono static_only fallback until replacement | MIG-0509 / MIG-0627 |
| `events/<id>/playlist.v1.json` | workers/json-generator/optimizedRebuild.ts (event_playlist target) | src/lib/db/videoDetailQueries.ts:644; apps/api/src/routes/videos/viewerOverlay.ts | Replace or retain playlist snapshot per consumer audit | MIG-0627 / MIG-0907 |
| `users/<id>.json` | workers/json-generator/rebuild.ts (users projection) | src/lib/publicData/loader.ts:1835 | Build creator detail | MIG-0509 / MIG-0627 |
| `users/<id>/works/<id>.json` | workers/json-generator/rebuild.ts:3705 | src/lib/publicData/loader.ts:1889 | Build creator works pages | MIG-0509 / MIG-0627 |
| `users/<id>/collabs/<id>.json` | workers/json-generator/rebuild.ts:3731 | src/lib/publicData/loader.ts:1938 | Build creator collaborator pages | MIG-0509 / MIG-0627 |
| `videos/<id>.json` | workers/json-generator/rebuild.ts (video target) | src/lib/publicData/loader.ts:1964 | Build public video detail | MIG-0509 / MIG-0627 |
| `search-index-postings.v1/manifest.json` | workers/json-generator/rebuild.ts (search posting builder) | src/lib/publicData/loader.ts:1191; apps/api/src/routes/videos/list.ts | Replace with bounded build/search shard | MIG-0509 / MIG-0627 |
| `search-index-postings.v1/<id>.json` | workers/json-generator/rebuild.ts (search posting directories/pages) | src/lib/publicData/loader.ts:1223-1271; apps/api/src/routes/videos/list.ts | Document computed key pattern; replace with search shard | MIG-0509 / MIG-0627 |
| `users/public-icons/v2/manifest.json` | workers/json-generator/publicIconV2Artifacts.ts (v2 icon manifest producer) | src/lib/publicData/publicIconProjectionV2.ts:10 | Build-time icon projection; retain versioned manifest until consumers migrate | MIG-0509 / MIG-0627 |
| `top/slot-stats.v1.json` | workers/json-generator/topSlotStatsEnqueue.ts (slot statistics rebuild) | src/lib/publicData/staticTopSlotStatsCore.ts:8 | Build-time stats / do not remove until shared readers move | MIG-0509 / MIG-0627 |
| `users/index.v2/manifest.json` | workers/json-generator/usersIndexV2Artifacts.ts (v2 index producer) | src/lib/publicData/staticUsersIndexV2Core.ts:23 | Build-time user index v2 | MIG-0509 / MIG-0627 |
| `internal/member-suggestions/v1/manifest.json` | workers/json-generator/memberSuggestionsArtifacts.ts (v1 suggestion producer) | src/lib/video/memberSuggestionsCore.ts:12 | Internal member suggestion projection; not a public GET artifact | MIG-0627 / MIG-0907 |
| `internal/member-suggestions/v2/manifest.json` | workers/json-generator/memberSuggestionsV2Artifacts.ts (v2 suggestion producer) | src/lib/video/memberSuggestionsPostingsV2.ts:20 | Internal member suggestion projection; retain until reader replacement | MIG-0627 / MIG-0907 |
| `xicons/staging/<id>/<id>.<id>` | src/lib/actions/xid.ts:1088,1094 (temporary upload) | src/lib/actions/xid.ts:1127,1132 (rollback/cleanup) | RETAIN temporary uploaded media; do not treat as generated public snapshots | MIG-0649 / media domain |
| `xicons/<id>/<id>.<id>` | src/lib/actions/xid.ts:1089,1095 (approved X icon upload) | src/lib/actions/xid.ts:1127; src/lib/media/publicMedia.ts (public serving) | RETAIN persistent icon objects; inspect user references before deletion | MIG-0649 / media domain |
| `video-icons/<id>/<id>/` | src/lib/video/resolveVideoCreatorIcon.ts:87-91 (prefix + UUID.ext) | src/lib/video/resolveVideoCreatorIcon.ts:104 rollback; media handler | RETAIN persistent media. Full key = this prefix + UUID.ext by string concatenation, so the scanner lists the put as a dynamic call (below) | MIG-0649 / media domain |
| `internal/materialized/video-cards/v1/manifest.json` | workers/json-generator/videoMaterializedSource.ts:372 (conditional commit) | workers/json-generator/videoMaterializedSource.ts:211 (load) | RETAIN until materialized source retirement gate; generator output not an independent public HTML page | MIG-0627 / MIG-0907 |
| `__flamenode_read_only_health_probe__` | None: read-only probe of a key that is never written (src/lib/health/deepHealth.ts:26) | src/lib/health/deepHealth.ts:390 (`head`, expects null) | RETAIN health probe; not an artifact, nothing to replace or delete | MIG-0649 / health |

**Recovery rule:** Missing artifacts are regenerated only by the next public build. Public GET handlers must not write to D1, a Queue, or `public_build_state`.


## Static-audit limitations

The CI checker (`npm run check:r2-artifact-consumers`) extracts: literal `r2Key:` values; `*_OBJECT_KEY`-style constants; the first argument of `.get/.put/.head/.delete/.list/.createMultipartUpload/.resumeMultipartUpload` (also via `?.`, `!.` and with type arguments) on a known R2 binding, on a same-file alias (`const x = env.BUCKET`, `const { BUCKET: x } = env`) or on a name typed `R2Bucket`; and the second argument of the R2 key helpers `putJson`, `putJsonUntracked`, `putJsonArtifact`, `readJsonObject`, `readBoundedR2Json` (also as member calls and under same-file import aliases). A literal is recorded only when it is the whole argument, whatever its shape; `"a/" + id`, an empty key, or anything else is a dynamic call that needs a row below. A same-file `const` (optionally `: string`) is resolved only when every declaration of that name in the file has the same value. Every key row must have non-empty producer, consumer, target/retention and an owner `MIG-XXXX`. It excludes test and fixture directories. **Not detected:** a bucket passed as an untyped parameter or under a type other than `R2Bucket` with a name outside the binding list, bracket access (`env["BUCKET"]`), casts (`(env.BUCKET as R2Bucket).get`), and new helper functions until they are added to the checker list; comments are not stripped (false positives only). A green checker does not prove a dynamically generated key exists or that its consumer is safe to retire.

Media-upload blobs, legacy import previews, and persistent visibility manifests are **not** assumed to be disposable public-build artifacts. MIG-0907 must retain or separately audit them. Every new literal artifact reference that is absent from this table is a CI error.

Referenced tasks: [MIG-0627](PHASE_6_SPEC.md) (reader replacement), [MIG-0907](PHASE_8_9_SPEC.md) (generator removal gate).
## Reviewed dynamic R2 calls

Conservative *bounded exception inventory* for R2 API calls whose first argument is imported, a computed key, or a key collection. This section is **not a removal authorization**. Source paths and method/expression strings are exact, and the occurrence count is locked to the 2026-10-26 source audit. Adding a new untracked dynamic operation, changing its expression, or changing its count in either direction breaks CI, so a removed call must also be removed here. Each expression must be verified before MIG-0627/MIG-0907 removes its storage dependency.

| Source path | Method and argument expression | Call sites (exact) | Disposition / reason |
| --- | --- | ---: | --- |
| `apps/site/src/gateway/r2Html.ts` | `bucket.get(r2HtmlKey(decision.key))` | 1 | Public HTML build/render key; migrate only with gateway cutover |
| `apps/site/src/gateway/pageRenderQueue.ts` | `bucket.delete(r2HtmlKey(key))` | 1 | D-11 DELETE-only on unpublish/revocation; never renders or PUTs HTML |
| `workers/json-generator/rebuild.ts` | `bucket.delete(pendingPostingArtifacts.map)` | 2 | Generator/producer key; MIG-0907 review required |
| `workers/json-generator/rebuild.ts` | `bucket.get(staticVideoSearchPostingManifestObjectKey(""))` | 1 | Generator/producer key; MIG-0907 review required |
| `workers/json-generator/videoMaterializedSource.ts` | `bucket.put(sourceKey)` | 2 | Generator/producer key; MIG-0907 review required |
| `workers/json-generator/videoMaterializedSource.ts` | `bucket.head(sourceKey)` | 1 | Generator/producer key; MIG-0907 review required |
| `workers/json-generator/videoMaterializedSource.ts` | `bucket.get(sourceKey)` | 1 | Generator/producer key; MIG-0907 review required |
| `workers/json-generator/videoMaterializedSource.ts` | `bucket.delete(sourceKey)` | 1 | Generator/producer key; MIG-0907 review required |
| `workers/json-generator/videoMaterializedSource.ts` | `bucket.delete(obsoleteKey)` | 1 | Generator/producer key; MIG-0907 review required |
| `workers/json-generator/memberSuggestionsArtifacts.ts` | `bucket.delete(keys)` | 1 | Generator/producer key; MIG-0907 review required |
| `workers/json-generator/memberSuggestionsArtifacts.ts` | `bucket.get(MEMBER_SUGGESTIONS_MANIFEST_OBJECT_KEY)` | 1 | Generator/producer key; MIG-0907 review required |
| `workers/json-generator/memberSuggestionsArtifacts.ts` | `bucket.delete(MEMBER_SUGGESTIONS_MANIFEST_OBJECT_KEY)` | 1 | Generator/producer key; MIG-0907 review required |
| `workers/json-generator/memberSuggestionsArtifacts.ts` | `bucket.put(MEMBER_SUGGESTIONS_MANIFEST_OBJECT_KEY)` | 1 | Generator/producer key; MIG-0907 review required |
| `workers/json-generator/r2Dedup.ts` | `bucket.put(key)` | 1 | Generator/producer key; MIG-0907 review required |
| `workers/json-generator/r2Dedup.ts` | `bucket.head(objectKey)` | 1 | Generator/producer key; MIG-0907 review required |
| `workers/json-generator/publicIconV2Artifacts.ts` | `bucket.head(publicXIconV2ShardObjectKey(generation, shard))` | 1 | Generator/producer key; MIG-0907 review required |
| `workers/json-generator/publicIconV2Artifacts.ts` | `bucket.delete(keys)` | 1 | Generator/producer key; MIG-0907 review required |
| `workers/json-generator/publicIconV2Artifacts.ts` | `bucket.delete(PUBLIC_X_ICON_V2_MANIFEST_OBJECT_KEY)` | 1 | Generator/producer key; MIG-0907 review required |
| `workers/json-generator/publicIconV2Artifacts.ts` | `bucket.delete(writtenKeys)` | 1 | Generator/producer key; MIG-0907 review required |
| `workers/json-generator/topSectionsEnqueue.ts` | `bucket.head(objectKey)` | 1 | Generator/producer key; MIG-0907 review required |
| `workers/json-generator/topSlotStatsEnqueue.ts` | `bucket.head(TOP_SLOT_STATS_OBJECT_KEY)` | 1 | Generator/producer key; MIG-0907 review required |
| `workers/json-generator/usersSharedInputsEnqueue.ts` | `bucket.head(USERS_INDEX_OBJECT_KEY)` | 1 | Generator/producer key; MIG-0907 review required |
| `workers/json-generator/usersSharedInputsEnqueue.ts` | `bucket.head(PUBLIC_X_ICON_MAP_OBJECT_KEY)` | 1 | Generator/producer key; MIG-0907 review required |
| `workers/json-generator/usersSharedInputsEnqueue.ts` | `bucket.head(PICKUP_CREATORS_OBJECT_KEY)` | 1 | Generator/producer key; MIG-0907 review required |
| `workers/json-generator/youtubeRelatedSharedInputsEnqueue.ts` | `bucket.head(YOUTUBE_RELATED_BLOCKLIST_OBJECT_KEY)` | 1 | Generator/producer key; MIG-0907 review required |
| `workers/json-generator/youtubeRelatedSharedInputsEnqueue.ts` | `bucket.head(RANDOM_VIDEO_POOL_OBJECT_KEY)` | 1 | Generator/producer key; MIG-0907 review required |
| `workers/json-generator/staleArtifactRefresh.ts` | `bucket.head(objectKey)` | 1 | Generator/producer key; MIG-0907 review required |
| `workers/json-generator/usersIndexV2Artifacts.ts` | `bucket.head(key)` | 1 | Generator/producer key; MIG-0907 review required |
| `workers/json-generator/usersIndexV2Artifacts.ts` | `bucket.delete(keys)` | 1 | Generator/producer key; MIG-0907 review required |
| `workers/json-generator/usersIndexV2Artifacts.ts` | `bucket.delete(staleKeys)` | 1 | Generator/producer key; MIG-0907 review required |
| `workers/json-generator/staticArtifactTracking.ts` | `bucket.delete(<complex>)` | 1 | Generator/producer key; MIG-0907 review required |
| `workers/cleanup/incrementalCache.ts` | `bucket.delete(expired.map)` | 1 | Cleanup keys; do not retire while old storage remains |
| `packages/server-core/src/r2Body.ts` | `bucket.get(key)` | 1 | Generator/producer key; MIG-0907 review required |
| `app/api/public/about-stats/route.ts` | `bucket.get(TOP_STATS_OBJECT_KEY)` | 1 | Read-only public/API consumer; MIG-0627 review required |
| `apps/api/src/lib/publicSnapshot.ts` | `bucket.get(key)` | 1 | Read-only public/API consumer; MIG-0627 review required |
| `src/lib/media/publicMedia.ts` | `bucket.get(rawKey)` | 1 | Persistent uploaded media or preview object; RETAIN until separately reviewed |
| `src/lib/media/manageXIcon.ts` | `bucket.get(key)` | 1 | Persistent uploaded media or preview object; RETAIN until separately reviewed |
| `src/lib/health/artifactSlo.ts` | `bucket.get(probe.key)` | 1 | Health/readiness probe; preserve coverage during migration |
| `src/lib/health/deepHealth.ts` | `bucket.get(PUBLIC_VISIBILITY_BLOCKED_ENTITIES_OBJECT_KEY)` | 1 | Health/readiness probe; preserve coverage during migration |
| `src/lib/media/slotSubmissionIcon.ts` | `bucket.get(r2Key)` | 1 | Persistent uploaded media or preview object; RETAIN until separately reviewed |
| `app/api/public/events/[id]/staff/route.ts` | `bucket.get(eventBaseObjectKey(eventId))` | 1 | Read-only public/API consumer; MIG-0627 review required |
| `src/lib/db/videoDetailQueries.ts` | `bucket.get(eventPlaylistObjectKey(eventId))` | 1 | Read-only public/API consumer; MIG-0627 review required |
| `packages/server-core/src/visibility/manifestR2.ts` | `bucket.get(PUBLIC_VISIBILITY_BLOCKED_ENTITIES_OBJECT_KEY)` | 1 | Visibility revocation state; RETAIN |
| `packages/server-core/src/visibility/manifestR2.ts` | `bucket.put(PUBLIC_VISIBILITY_BLOCKED_ENTITIES_OBJECT_KEY)` | 1 | Visibility revocation state; RETAIN |
| `src/lib/import/legacy/previewStore.ts` | `bucket.put(key)` | 5 | Persistent uploaded media or preview object; RETAIN until separately reviewed |
| `src/lib/import/legacy/previewStore.ts` | `bucket.get(key)` | 2 | Persistent uploaded media or preview object; RETAIN until separately reviewed |
| `src/lib/video/resolveVideoCreatorIcon.ts` | `bucket.delete(uploadedKey)` | 1 | Generator/producer key; MIG-0907 review required |
| `src/lib/event/eventIdReuse.ts` | `bucket.head(key)` | 1 | Generator/producer key; MIG-0907 review required |
| `src/lib/admin/staticSharedInputDiagnostics.ts` | `bucket.head(key)` | 1 | Generator/producer key; MIG-0907 review required |
| `workers/json-generator/memberSuggestionsV2Artifacts.ts` | `bucket.delete(MEMBER_SUGGESTIONS_V2_MANIFEST_OBJECT_KEY)` | 2 | Generator/producer key; MIG-0907 review required |
| `workers/json-generator/memberSuggestionsV2Artifacts.ts` | `bucket.delete(<complex>)` | 1 | Generator/producer key; MIG-0907 review required |
| `workers/json-generator/memberSuggestionsV2Artifacts.ts` | `bucket.delete(keys)` | 1 | Generator/producer key; MIG-0907 review required |
| `src/lib/media/iconOrphanCleanup.ts` | `bucket.delete(objectKey)` | 1 | Persistent uploaded media or preview object; RETAIN until separately reviewed |
| `src/lib/video/resolveVideoCreatorIcon.ts` | `bucket.put(key)` | 1 | Persistent uploaded media (`video-icons/<id>/<id>/` + UUID.ext); RETAIN until separately reviewed |
| `apps/api/src/routes/adminRead/ops.ts` | `bucket.head(objectKey)` | 1 | Admin read-only artifact existence probe; MIG-0627 review required |
| `workers/cleanup/incrementalCache.ts` | `bucket.list(<complex>)` | 1 | Cleanup prefix listing; do not retire while old storage remains |
| `workers/json-generator/memberSuggestionsV2Artifacts.ts` | `bucket.list(<complex>)` | 1 | Generator prefix listing; MIG-0907 review required |
| `src/lib/publicData/loader.ts` | `readBoundedR2Json(key)` | 1 | R2 key helper on read-only public/API consumer path; MIG-0627 review required |
| `src/lib/publicData/r2EventPlaylist.ts` | `readBoundedR2Json(args.objectKey(normalizedId))` | 1 | R2 key helper on read-only public/API consumer path; MIG-0627 review required |
| `src/lib/publicData/staticSharedInputsLoader.ts` | `readBoundedR2Json(key)` | 1 | R2 key helper on read-only public/API consumer path; MIG-0627 review required |
| `src/lib/video/memberSuggestionsLoader.ts` | `readBoundedR2Json(MEMBER_SUGGESTIONS_MANIFEST_OBJECT_KEY)` | 1 | R2 key helper on read-only public/API consumer path; MIG-0627 review required |
| `src/lib/video/memberSuggestionsLoader.ts` | `readBoundedR2Json(memberSuggestionsIndexObjectKey(manifestResult.generation))` | 1 | R2 key helper on read-only public/API consumer path; MIG-0627 review required |
| `src/lib/video/memberSuggestionsV2Loader.ts` | `readBoundedR2Json(key)` | 1 | R2 key helper on read-only public/API consumer path; MIG-0627 review required |
| `packages/server-core/src/memberSuggestion/loader.ts` | `readBoundedR2Json(MEMBER_SUGGESTIONS_MANIFEST_OBJECT_KEY)` | 1 | MIG-0648 RH-019 target reader; canonical manifest commit point per request, keep CURRENT until gated cutover |
| `packages/server-core/src/memberSuggestion/loader.ts` | `readBoundedR2Json(memberSuggestionsIndexObjectKey(manifestResult.generation))` | 1 | MIG-0648 RH-019 V1 fallback index; bounded read, generation validation, keep CURRENT until gated cutover |
| `packages/server-core/src/memberSuggestion/v2Loader.ts` | `readBoundedR2Json(key)` | 1 | MIG-0648 RH-019 V2 posting reader; generation-specific R2 page/manifest, no D1 fallback; staged and not mounted |
| `apps/api/src/lib/publicSnapshot.ts` | `readBoundedR2Json(key)` | 1 | R2 key helper on read-only public/API consumer path; MIG-0627 review required |
| `workers/json-generator/memberSuggestionsArtifacts.ts` | `putJsonArtifact(key)` | 1 | R2 key helper on generator/producer path; MIG-0907 review required |
| `workers/json-generator/memberSuggestionsV2Artifacts.ts` | `putJsonArtifact(key)` | 1 | R2 key helper on generator/producer path; MIG-0907 review required |
| `workers/json-generator/memberSuggestionsV2Artifacts.ts` | `readBoundedR2Json(MEMBER_SUGGESTIONS_V2_MANIFEST_OBJECT_KEY)` | 1 | R2 key helper on generator/producer path; MIG-0907 review required |
| `workers/json-generator/memberSuggestionsV2Artifacts.ts` | `putJson(entry.key)` | 1 | R2 key helper on generator/producer path; MIG-0907 review required |
| `workers/json-generator/memberSuggestionsV2Artifacts.ts` | `putJson(MEMBER_SUGGESTIONS_V2_MANIFEST_OBJECT_KEY)` | 1 | R2 key helper on generator/producer path; MIG-0907 review required |
| `workers/json-generator/optimizedRebuild.ts` | `putJsonArtifact(objectKey)` | 1 | R2 key helper on generator/producer path; MIG-0907 review required |
| `workers/json-generator/pickupCreatorsR2.ts` | `readBoundedR2Json(PICKUP_CREATORS_OBJECT_KEY)` | 1 | R2 key helper on generator/producer path; MIG-0907 review required |
| `workers/json-generator/publicIconV2Artifacts.ts` | `readBoundedR2Json(PUBLIC_X_ICON_V2_MANIFEST_OBJECT_KEY)` | 1 | R2 key helper on generator/producer path; MIG-0907 review required |
| `workers/json-generator/publicIconV2Artifacts.ts` | `putJsonArtifact(PUBLIC_X_ICON_V2_MANIFEST_OBJECT_KEY)` | 1 | R2 key helper on generator/producer path; MIG-0907 review required |
| `workers/json-generator/publicIconV2Artifacts.ts` | `readBoundedR2Json(PUBLIC_X_ICON_MAP_OBJECT_KEY)` | 1 | R2 key helper on generator/producer path; MIG-0907 review required |
| `workers/json-generator/publicIconV2Artifacts.ts` | `putJsonArtifact(key)` | 1 | R2 key helper on generator/producer path; MIG-0907 review required |
| `workers/json-generator/rebuild.ts` | `bucket.delete(key)` | 1 | R2 key helper on generator/producer path; MIG-0907 review required |
| `workers/json-generator/rebuild.ts` | `bucket.get(key)` | 1 | R2 key helper on generator/producer path; MIG-0907 review required |
| `workers/json-generator/rebuild.ts` | `putJsonArtifact(key)` | 2 | R2 key helper on generator/producer path; MIG-0907 review required |
| `workers/json-generator/rebuild.ts` | `putJson(TOP_SLOT_STATS_OBJECT_KEY)` | 1 | R2 key helper on generator/producer path; MIG-0907 review required |
| `workers/json-generator/rebuild.ts` | `putJson(objectKey)` | 3 | R2 key helper on generator/producer path; MIG-0907 review required |
| `workers/json-generator/rebuild.ts` | `putJsonUntracked(key)` | 1 | R2 key helper on generator/producer path; MIG-0907 review required |
| `workers/json-generator/rebuild.ts` | `putJson(manifestKey)` | 1 | R2 key helper on generator/producer path; MIG-0907 review required |
| `workers/json-generator/rebuild.ts` | `putJson(eventReleaseObjectKey(eventId))` | 1 | R2 key helper on generator/producer path; MIG-0907 review required |
| `workers/json-generator/rebuild.ts` | `putJson(USERS_INDEX_OBJECT_KEY)` | 1 | R2 key helper on generator/producer path; MIG-0907 review required |
| `workers/json-generator/rebuild.ts` | `putJson(PUBLIC_X_ICON_MAP_OBJECT_KEY)` | 1 | R2 key helper on generator/producer path; MIG-0907 review required |
| `workers/json-generator/rebuild.ts` | `putJson(PICKUP_CREATORS_OBJECT_KEY)` | 1 | R2 key helper on generator/producer path; MIG-0907 review required |
| `workers/json-generator/rebuild.ts` | `putJson(YOUTUBE_RELATED_BLOCKLIST_OBJECT_KEY)` | 1 | R2 key helper on generator/producer path; MIG-0907 review required |
| `workers/json-generator/rebuild.ts` | `putJson(RANDOM_VIDEO_POOL_OBJECT_KEY)` | 1 | R2 key helper on generator/producer path; MIG-0907 review required |
| `workers/json-generator/rebuild.ts` | `putJson(RECOMMEND_CORE_OBJECT_KEY)` | 1 | R2 key helper on generator/producer path; MIG-0907 review required |
| `workers/json-generator/rebuild.ts` | `putJson(key)` | 2 | R2 key helper on generator/producer path; MIG-0907 review required |
| `workers/json-generator/usersIndexV2Artifacts.ts` | `putJsonArtifact(key)` | 1 | R2 key helper on generator/producer path; MIG-0907 review required |
| `workers/json-generator/usersIndexV2Artifacts.ts` | `readBoundedR2Json(USERS_INDEX_V2_MANIFEST_OBJECT_KEY)` | 1 | R2 key helper on generator/producer path; MIG-0907 review required |
| `workers/json-generator/usersIndexV2Artifacts.ts` | `readBoundedR2Json(USERS_INDEX_OBJECT_KEY)` | 1 | R2 key helper on generator/producer path; MIG-0907 review required |
| `workers/json-generator/videoMaterializedSource.ts` | `readBoundedR2Json(key)` | 1 | R2 key helper on generator/producer path; MIG-0907 review required |
| `workers/json-generator/videoMaterializedSource.ts` | `readJsonObject(manifest.source_key)` | 1 | R2 key helper on generator/producer path; MIG-0907 review required |

These dynamic references are retained for inspection. The static scanner cannot prove a computed value's full key domain or resolve imported symbols across files; owners must compare producer and consumer paths before removal.