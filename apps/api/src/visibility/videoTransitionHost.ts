import type { Context } from "hono";
import {
  buildVideoApprovedNotification,
  buildVideoVisibilityChangedNotification,
} from "../../../../src/lib/notifications/templates/video.ts";
import type { VideoVisibilityTransitionHost } from "@flamenode/server-core/visibility/videoTransition";
import { buildVideoStatusChangeNotificationBatch } from "@flamenode/server-core/notifications/videoStatusNotify";
import type { ServerCoreDb } from "@flamenode/server-core/db";
import type { EdgeCachePort } from "@flamenode/server-core/ports";
import {
  emptyPublicVisibilityBlockedEntitiesManifest,
  resolvePublicVisibilityGuardMode,
} from "@flamenode/server-core/visibility/manifestCore";
import {
  putVisibilityManifestWithCas,
  readVisibilityManifestObject,
  type VisibilityManifestBucket,
} from "@flamenode/server-core/visibility/manifestR2";
import type { VisibilityManifestHost } from "@flamenode/server-core/visibility/manifestHost";
import { deletePublicJsonCaches } from "@flamenode/server-core/publicCache/delete";
import {
  EVENT_EXPORT_REFRESH_MINUTES,
  eventExportPayloadCacheKey,
} from "@flamenode/server-core/publicCache/eventExportKeys";
import type { AppEnv } from "../env.ts";
import {
  VIDEO_VISIBILITY_STATIC_OBJECT_KEYS,
  VIDEO_VISIBILITY_USER_MAX_PAGES,
  videoVisibilityEventObjectKeys,
} from "./publicCacheKeys.ts";

type HostContext = Pick<Context<AppEnv>, "env">;

export type VideoVisibilityHostOptions = {
  edgeCache?: EdgeCachePort;
  dropIsolateEntry?: (key: string) => void;
};

function createManifestHost(env: AppEnv["Bindings"]): VisibilityManifestHost {
  return {
    async read() {
      const bucket = env.BUCKET;
      if (!bucket) {
        const mode = resolvePublicVisibilityGuardMode(env.PUBLIC_VISIBILITY_GUARD_MODE);
        if (mode === "enforce") {
          throw new Error("public_visibility_manifest_bucket_missing");
        }
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
      return readVisibilityManifestObject(bucket as unknown as VisibilityManifestBucket);
    },
    async write(manifest, options) {
      const bucket = env.BUCKET;
      if (!bucket) throw new Error("public_visibility_manifest_bucket_missing");
      await putVisibilityManifestWithCas(
        bucket as unknown as VisibilityManifestBucket,
        manifest,
        options?.ifMatchEtag,
        options?.mutateOnConflict,
      );
    },
  };
}

/**
 * Hono adapter for the framework-neutral video visibility transition core.
 * It intentionally sends no Queue wake (D-13-41); the existing fast-jobs
 * recovery cron drains notification_outbox. No Next APIs or ambient env reads.
 */
export function createVideoVisibilityTransitionHost(
  c: HostContext,
  options: VideoVisibilityHostOptions = {},
): VideoVisibilityTransitionHost {
  const cacheHost = {
    dropIsolateEntry: options.dropIsolateEntry ?? (() => undefined),
    readEdgeCache: (): EdgeCachePort =>
      options.edgeCache ?? {
        delete: (url) => (caches as unknown as { default: { delete(request: RequestInfo | URL): Promise<boolean> } }).default.delete(url),
      },
  };
  const notificationEnv = {
    NEXT_PUBLIC_SITE_URL: c.env.NEXT_PUBLIC_SITE_URL,
  };

  return {
    manifest: createManifestHost(c.env),
    rethrowFrameworkControl: () => undefined,
    publicCacheKeys: {
      staticObjectKeys: VIDEO_VISIBILITY_STATIC_OBJECT_KEYS,
      userMaxPages: VIDEO_VISIBILITY_USER_MAX_PAGES,
      eventObjectKeys: videoVisibilityEventObjectKeys,
    },
    buildNotificationBatch: (db: ServerCoreDb, args) =>
      buildVideoStatusChangeNotificationBatch(db, args, {
        buildVideoApprovedNotification: (input) =>
          buildVideoApprovedNotification(input, notificationEnv),
        buildVideoVisibilityChangedNotification: (input) =>
          buildVideoVisibilityChangedNotification(input, notificationEnv),
      }),
    invalidateEventExportCaches: async (eventIds) => {
      const keys = [...new Set(eventIds)]
        .filter(Boolean)
        .flatMap((eventId) =>
          (["v5", "legacy"] as const).flatMap((format) =>
            EVENT_EXPORT_REFRESH_MINUTES.map((minutes) =>
              eventExportPayloadCacheKey(eventId, format, minutes),
            ),
          ),
        );
      if (keys.length > 0) await deletePublicJsonCaches(keys, cacheHost);
    },
    deletePublicJsonCaches: (keys) => deletePublicJsonCaches(keys, cacheHost),
    wakeNotificationQueueAfterCommit: async () => undefined,
  };
}
