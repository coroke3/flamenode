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

/** Linked video IDs and YouTube IDs are invalidated after a committed event ID rename. */
export type EventRenameLinkedVideo = {
  id: string;
  youtube_video_id: string | null;
};

/**
 * SA-021 CURRENT deletes old event detail, new event detail, five global
 * projections and each linked video's public JSON (including its YouTube alias).
 * Preserve order and the per-video Set behavior: only aliases that duplicate
 * the *same* video's ID are removed at this point.
 */
export function eventRenamePublicJsonKeys(
  oldId: string,
  newId: string,
  linkedVideoRows: readonly EventRenameLinkedVideo[],
): string[] {
  return [
    eventComposedObjectKey(oldId),
    eventBaseObjectKey(oldId),
    eventSlotsObjectKey(oldId),
    eventReleaseObjectKey(oldId),
    eventComposedObjectKey(newId),
    eventBaseObjectKey(newId),
    eventSlotsObjectKey(newId),
    eventReleaseObjectKey(newId),
    "events/index.json",
    "list/recent.json",
    "list/popular.json",
    "top/sections/events.v1.json",
    "top.json",
    ...linkedVideoRows.flatMap((video) => {
      const keys = new Set<string>([`videos/${video.id}.json`]);
      if (video.youtube_video_id) {
        keys.add(`videos/${video.youtube_video_id}.json`);
      }
      return [...keys];
    }),
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
    /**
     * SA-021: after the audited rename D1 batch has committed, evict
     * both export identities first, then old/new event and linked video JSON.
     * Do not delete R2 artifacts; CURRENT leaves that to the rebuild queue.
     */
    rename: async (
      oldId: string,
      newId: string,
      linkedVideoRows: readonly EventRenameLinkedVideo[],
    ): Promise<void> => {
      await deletePublicJsonCaches(eventExportPayloadCacheKeys(oldId), host);
      await deletePublicJsonCaches(eventExportPayloadCacheKeys(newId), host);
      await deletePublicJsonCaches(
        eventRenamePublicJsonKeys(oldId, newId, linkedVideoRows),
        host,
      );
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
