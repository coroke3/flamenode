/**
 * MIG-0652 U02 — Hono post-commit event cache invalidation adapter.
 *
 * CURRENT: src/lib/actions/event-admin.ts#deleteEvent post-commit tasks,
 * src/lib/api/eventExportCache.ts#invalidateEventExportCache.
 * No request is mounted by this module. No D1, R2, Queue, wake or deploy.
 */
import {
  deletePublicJsonCaches,
  type PublicJsonCacheDeleteHost,
} from "@flamenode/server-core/publicCache/delete";
import {
  eventBaseObjectKey,
  eventComposedObjectKey,
  eventReleaseObjectKey,
  eventSlotsObjectKey,
} from "@flamenode/server-core/publicData/eventDetailCore";
import {
  EVENT_EXPORT_REFRESH_MINUTES,
  eventExportPayloadCacheKey,
} from "@flamenode/server-core/publicCache/eventExportKeys";

/** Exactly the nine CURRENT archive Cache API keys; R2 artifacts are not deleted here. */
export function eventArchivePublicJsonKeys(eventId: string): string[] {
  return [
    eventComposedObjectKey(eventId),
    eventBaseObjectKey(eventId),
    eventSlotsObjectKey(eventId),
    eventReleaseObjectKey(eventId),
    "events/index.json",
    "list/recent.json",
    "list/popular.json",
    "top/sections/events.v1.json",
    "top.json",
  ];
}

/** CURRENT caches both API formats at every supported refresh window (2 * 4 keys). */
export function eventExportPayloadCacheKeys(eventId: string): string[] {
  return (["v5", "legacy"] as const).flatMap((format) =>
    EVENT_EXPORT_REFRESH_MINUTES.map((refreshMinutes) =>
      eventExportPayloadCacheKey(eventId, format, refreshMinutes),
    ),
  );
}

/**
 * Hono has no Next isolate public-JSON map; use the native Cache API only.
 * The core Cache API delete operation is best-effort and never wakes a Queue.
 */
function defaultCacheHost(): PublicJsonCacheDeleteHost {
  return {
    dropIsolateEntry: () => {},
    readEdgeCache: () => (caches as unknown as { default: {
      delete(url: string): Promise<boolean>;
    } }).default,
  };
}

export function createEventPostCommitCacheHost(
  host: PublicJsonCacheDeleteHost = defaultCacheHost(),
) {
  return {
    /** SA-024 (soft archive): invalidate event listing/detail + export caches after D1 commit. */
    archive: async (eventId: string): Promise<void> => {
      await deletePublicJsonCaches(eventArchivePublicJsonKeys(eventId), host);
      await deletePublicJsonCaches(eventExportPayloadCacheKeys(eventId), host);
    },
    /** SA-023 / SA-021: export-cache invalidation after committed status or ID changes. */
    invalidateExport: async (eventId: string): Promise<void> => {
      await deletePublicJsonCaches(eventExportPayloadCacheKeys(eventId), host);
    },
    /** Shared post-commit invalidation of public event artifacts by event ID. */
    invalidatePublicJson: async (eventId: string): Promise<void> => {
      await deletePublicJsonCaches(eventArchivePublicJsonKeys(eventId), host);
    },
  };
}
