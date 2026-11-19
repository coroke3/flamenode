// MIG-0662 / D-16-1 provisional until MIG-0603 (#523) merges.
// SA-011 route exists only in this unmerged Draft; do not deploy until U04 and security review.
import type { Context } from "hono";
import type { AppEnv } from "../env.ts";
import type { AuditRestoreHost } from "@flamenode/server-core/audit/restore";
import { RANDOM_VIDEO_POOL_OBJECT_KEY } from "@flamenode/server-core/publicData/randomVideoPoolCore";
import { YOUTUBE_RELATED_BLOCKLIST_OBJECT_KEY } from "@flamenode/server-core/publicData/staticYoutubeRelatedBlocklistCore";
import { deletePublicJsonCaches } from "@flamenode/server-core/publicCache/delete";
import {
  EVENT_EXPORT_REFRESH_MINUTES,
  eventExportPayloadCacheKey,
} from "@flamenode/server-core/publicCache/eventExportKeys";
import {
  eventBaseObjectKey,
  eventComposedObjectKey,
  eventReleaseObjectKey,
  eventSlotsObjectKey,
} from "@flamenode/server-core/publicData/eventDetailCore";
import {
  emptyPublicVisibilityBlockedEntitiesManifest,
  resolvePublicVisibilityGuardMode,
} from "@flamenode/server-core/visibility/manifestCore";
import {
  putVisibilityManifestWithCas,
  readVisibilityManifestObject,
} from "@flamenode/server-core/visibility/manifestR2";

// Matches CURRENT nextVideoPublicCacheKeyHost. Shared producer keys are
// imported to avoid silent drift. U04 replaces this provisional list with
// MIG-0603's reviewed shared host before route activation.
const STATIC_CACHE_KEYS = [
  RANDOM_VIDEO_POOL_OBJECT_KEY,
  YOUTUBE_RELATED_BLOCKLIST_OBJECT_KEY,
  "top/sections/recommended.v1.json",
  "top/sections/latest.v1.json",
  "top/sections/nostalgic.v1.json",
  "top/sections/stats.v1.json",
] as const;
// CURRENT src/lib/publicData/staticUserProfileCore.ts:STATIC_USER_MAX_PAGES.
const USER_MAX_PAGES = 5;

// Hono has no Next isolate-local public JSON cache. Invalidation still uses
// the same Cache API key identity as CURRENT, with fail-soft Cache API deletion.
async function deleteCachedKeys(keys: readonly string[]): Promise<void> {
  await deletePublicJsonCaches(keys, {
    dropIsolateEntry: () => {},
    readEdgeCache: () => (caches as unknown as { default: Cache }).default,
  });
}

export function createAuditRestoreHost(c: Context<AppEnv>): AuditRestoreHost {
  return {
    manifest: {
      read: async () => {
        const bucket = c.env?.BUCKET;
        if (!bucket) {
          const mode = resolvePublicVisibilityGuardMode(c.env?.PUBLIC_VISIBILITY_GUARD_MODE);
          if (mode === "enforce") {
            throw new Error("public_visibility_manifest_bucket_missing");
          }
          // CURRENT publicVisibilityManifest.ts logs only the telemetry outcome,
          // never an R2 key, user input or provider exception.
          if (mode === "observe") {
            console.warn(JSON.stringify({
              service: "public-visibility-guard",
              mode,
              result: "manifest_bucket_missing",
            }));
          }
          return {
            manifest: emptyPublicVisibilityBlockedEntitiesManifest(Math.floor(Date.now() / 1000)),
            etag: null,
          };
        }
        return readVisibilityManifestObject(bucket);
      },
      write: async (manifest, options) => {
        const bucket = c.env?.BUCKET;
        if (!bucket) throw new Error("public_visibility_manifest_bucket_missing");
        const conditional = options != null && Object.prototype.hasOwnProperty.call(options, "ifMatchEtag");
        await putVisibilityManifestWithCas(
          bucket,
          manifest,
          conditional ? options.ifMatchEtag ?? null : undefined,
          options?.mutateOnConflict,
        );
      },
    },
    publicCacheKeys: {
      staticObjectKeys: STATIC_CACHE_KEYS,
      userMaxPages: USER_MAX_PAGES,
      eventObjectKeys: (eventId) => [
        eventComposedObjectKey(eventId),
        eventBaseObjectKey(eventId),
        eventSlotsObjectKey(eventId),
        eventReleaseObjectKey(eventId),
      ],
    },
    deletePublicJsonCaches: deleteCachedKeys,
    invalidateEventExportCache: async (eventId) => {
      const keys = (["v5", "legacy"] as const).flatMap((format) =>
        EVENT_EXPORT_REFRESH_MINUTES.map((minutes) =>
          eventExportPayloadCacheKey(eventId, format, minutes),
        ),
      );
      await deleteCachedKeys(keys);
    },
    // D-13-41: Hono has no Queue producer binding. Mutation already persists
    // D1 queue records; a post-commit wake must not be invented here.
    loadQueueWakeHost: async () => ({
      readEnv: () => null,
      readWaitUntil: () => null,
      readKv: () => null,
    }),
  };
}
