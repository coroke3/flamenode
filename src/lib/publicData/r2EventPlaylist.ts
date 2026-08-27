import "server-only";

import { getCloudflareContext } from "@opennextjs/cloudflare";
import { eventBaseObjectKey } from "./staticEventDetailCore.ts";
import {
  EVENT_PLAYLIST_MAX_OBJECT_BYTES,
  eventPlaylistObjectKey,
  normalizeStaticEventPlaylist,
  type StaticEventPlaylist,
} from "./staticEventPlaylistCore.ts";
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

async function readVisibleEventArtifact<T>(args: {
  eventId: string;
  maxBytes: number;
  objectKey: (eventId: string) => string;
  normalize: (payload: unknown, eventId: string) => T | null;
}): Promise<T | null> {
  const normalizedId = args.eventId.trim();
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(normalizedId)) return null;
  const runtime = resolveRuntime();
  if (!runtime) return null;
  const { bucket, guardMode } = runtime;

  try {
    const visibility = await readPublicVisibilityBlockedEntitiesManifest(
      bucket as R2Bucket,
    );
    if (guardMode === "enforce" && !visibility.etag) return null;
    if (
      guardMode === "enforce" &&
      isEntityBlockedInManifest(visibility.manifest, "event", normalizedId)
    ) {
      return null;
    }

    const object = await bucket.get(args.objectKey(normalizedId));
    if (!object || (typeof object.size === "number" && object.size > args.maxBytes)) {
      return null;
    }
    const normalized = args.normalize(await object.json<unknown>(), normalizedId);
    if (!normalized) return null;

    // Artifact readとvisibility transitionが競合しても、commit-point manifestの
    // 再確認でprivate/release-pendingイベントを返さない。
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
    return normalized;
  } catch {
    return null;
  }
}

/**
 * Reads only the public event base artifact. This intentionally has no D1,
 * loader fallback, or R2 LIST path so an unavailable projection never becomes
 * a request-time database dependency on the public video page.
 */
export async function loadPublicEventYoutubePlaylistIdR2Only(
  eventId: string,
): Promise<string | null> {
  const event = await readVisibleEventArtifact<Record<string, unknown>>({
    eventId,
    maxBytes: MAX_EVENT_BASE_BYTES,
    objectKey: eventBaseObjectKey,
    normalize: (payload, expectedId) => {
      if (!payload || typeof payload !== "object") return null;
      const value = (payload as { event?: unknown }).event;
      if (!value || typeof value !== "object") return null;
      const row = value as Record<string, unknown>;
      if (
        String(row.id ?? "").trim() !== expectedId ||
        String(row.visibility_status ?? "").trim() !== "public"
      ) {
        return null;
      }
      return row;
    },
  });
  if (!event) return null;
  return extractYoutubePlaylistId(
    typeof event.youtube_playlist_id === "string"
      ? event.youtube_playlist_id
      : null,
  );
}

/** 公開event playlist projectionだけを読み、D1 fallbackは行わない。 */
export async function loadPublicEventPlaylistR2Only(
  eventId: string,
): Promise<StaticEventPlaylist | null> {
  return readVisibleEventArtifact({
    eventId,
    maxBytes: EVENT_PLAYLIST_MAX_OBJECT_BYTES,
    objectKey: eventPlaylistObjectKey,
    normalize: (payload, expectedId) => {
      if (!payload || typeof payload !== "object") return null;
      const normalized = normalizeStaticEventPlaylist(
        payload as Record<string, unknown>,
        expectedId,
      );
      // partial artifactは「上映順」の正本として使わない。
      return normalized?.complete ? normalized : null;
    },
  });
}
