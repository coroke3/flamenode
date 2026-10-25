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

**Recovery rule:** Missing artifacts are regenerated only by the next public build. Public GET handlers must not write to D1, a Queue, or `public_build_state`.

## Static-audit limitations

The CI checker validates literal `r2Key` property keys, literal calls on known R2 binding names, and stored-object key constants. It excludes test and fixture directories. Computed keys are listed explicitly above but need follow-up source auditing before MIG-0627 removes a reader. A green checker does not prove a dynamically generated key exists or that its consumer is safe to retire.

Media-upload blobs, legacy import previews, and persistent visibility manifests are **not** assumed to be disposable public-build artifacts. MIG-0907 must retain or separately audit them. Every new literal artifact reference that is absent from this table is a CI error.

Referenced tasks: [MIG-0627](PHASE_6_SPEC.md) (reader replacement), [MIG-0907](PHASE_8_9_SPEC.md) (generator removal gate).