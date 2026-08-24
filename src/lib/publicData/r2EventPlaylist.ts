import "server-only";

import { getCloudflareContext } from "@opennextjs/cloudflare";
import { eventBaseObjectKey } from "./staticEventDetailCore.ts";
import {
  isEntityBlockedInManifest,
} from "./publicVisibilityManifestCore.ts";
import {
  readPublicVisibilityBlockedEntitiesManifest,
  resolvePublicVisibilityGuardModeFromEnv,
} from "./publicVisibilityManifest.ts";
import { extractYoutubePlaylistId } from "@/lib/youtube/playlist";

const MAX_EVENT_BASE_BYTES = 8 * 1024 * 1024;

type EventPlaylistBucket = Pick<R2Bucket, "get">;

function resolveRuntime(): {
  bucket: EventPlaylistBucket;
  guardMode: ReturnType<typeof resolvePublicVisibilityGuardModeFromEnv>;
} | null {
  try {
    const env = getCloudflareContext().env as {
      BUCKET?: unknown;
      PUBLIC_VISIBILITY_GUARD_MODE?: string;
    };
    const bucket = env.BUCKET;
    if (
      bucket &&
      typeof bucket === "object" &&
      typeof (bucket as { get?: unknown }).get === "function"
    ) {
      return {
        bucket: bucket as EventPlaylistBucket,
        guardMode: resolvePublicVisibilityGuardModeFromEnv({
          PUBLIC_VISIBILITY_GUARD_MODE: env.PUBLIC_VISIBILITY_GUARD_MODE,
        }),
      };
    }
  } catch {
    // R2-only enhancement is optional; an unavailable runtime simply hides it.
  }
  return null;
}

/**
 * Reads only the public event base artifact. This intentionally has no D1,
 * loader fallback, or R2 LIST path so an unavailable projection never becomes
 * a request-time database dependency on the public video page.
 */
export async function loadPublicEventYoutubePlaylistIdR2Only(
  eventId: string,
): Promise<string | null> {
  const normalizedId = eventId.trim();
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(normalizedId)) return null;
  const runtime = resolveRuntime();
  if (!runtime) return null;
  const { bucket, guardMode } = runtime;

  try {
    const visibility = await readPublicVisibilityBlockedEntitiesManifest(bucket as R2Bucket);
    if (guardMode === "enforce" && !visibility.etag) return null;
    if (
      guardMode === "enforce" &&
      isEntityBlockedInManifest(visibility.manifest, "event", normalizedId)
    ) {
      return null;
    }

    const object = await bucket.get(eventBaseObjectKey(normalizedId));
    if (!object || (typeof object.size === "number" && object.size > MAX_EVENT_BASE_BYTES)) {
      return null;
    }
    const payload = await object.json<unknown>();
    if (!payload || typeof payload !== "object") return null;
    const event = (payload as { event?: unknown }).event;
    if (!event || typeof event !== "object") return null;
    const row = event as Record<string, unknown>;
    if (
      String(row.id ?? "").trim() !== normalizedId ||
      String(row.visibility_status ?? "").trim() !== "public"
    ) {
      return null;
    }
    const playlistId = extractYoutubePlaylistId(
      typeof row.youtube_playlist_id === "string"
        ? row.youtube_playlist_id
        : null,
    );
    if (!playlistId) return null;

    // The event base can be read while a visibility fence is being inserted.
    // Re-read the commit-point manifest so a concurrent private transition or
    // release-pending token cannot leave a stale playlist CTA in the response.
    const afterVisibility = await readPublicVisibilityBlockedEntitiesManifest(
      bucket as R2Bucket,
    );
    if (guardMode === "enforce" && !afterVisibility.etag) return null;
    if (
      guardMode === "enforce" &&
      isEntityBlockedInManifest(
        afterVisibility.manifest,
        "event",
        normalizedId,
      )
    ) {
      return null;
    }
    if (
      guardMode === "enforce" &&
      visibility.etag &&
      afterVisibility.etag &&
      visibility.etag !== afterVisibility.etag
    ) {
      return null;
    }
    return playlistId;
  } catch {
    return null;
  }
}
