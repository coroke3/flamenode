import { cancelR2BodyBestEffort } from "@flamenode/server-core/r2Body";
import { readVisibilityManifestObject } from "@flamenode/server-core/visibility/manifestR2";
import { PUBLIC_VISIBILITY_BLOCKED_ENTITIES_OBJECT_KEY } from "@flamenode/server-core/visibility/manifestCore";
import {
  buildPublicArtifactVisibilityContext,
  filterPublicArtifactPayload,
  type PublicArtifactVisibilityContext,
} from "@flamenode/server-core/publicData/artifactVisibility";
import type { StaticRebuildTargetType } from "@flamenode/server-core/staticRebuild/types";

export const MAX_PUBLIC_SNAPSHOT_OBJECT_BYTES = 16 * 1024 * 1024; // 16 MiB

export type PublicVisibilityGuardMode = "off" | "observe" | "enforce";

export function resolveGuardMode(raw?: string | null): PublicVisibilityGuardMode {
  const mode = raw?.trim().toLowerCase();
  if (mode === "enforce") return "enforce";
  if (mode === "off") return "off";
  return "observe";
}

export type SnapshotReadResult =
  | { kind: "ok"; data: unknown }
  | { kind: "not_found" }
  | { kind: "unavailable" };

export async function readBoundedR2Json(
  bucket: R2Bucket,
  key: string,
  maxBytes = MAX_PUBLIC_SNAPSHOT_OBJECT_BYTES,
): Promise<unknown | null> {
  let object: R2ObjectBody | null = null;
  try {
    object = (await bucket.get(key)) as R2ObjectBody | null;
  } catch {
    return null;
  }
  if (!object) return null;

  if (typeof object.size === "number" && (object.size < 0 || object.size > maxBytes)) {
    await cancelR2BodyBestEffort(object);
    return null;
  }

  try {
    return await object.json();
  } catch {
    await cancelR2BodyBestEffort(object);
    return null;
  }
}

export async function loadPublicSnapshot(options: {
  bucket?: R2Bucket;
  key: string;
  targetType: StaticRebuildTargetType;
  guardModeRaw?: string | null;
  targetEntityId?: string; // e.g. event ID for event_release
  /** Object size cap; defaults to MAX_PUBLIC_SNAPSHOT_OBJECT_BYTES. */
  maxBytes?: number;
}): Promise<SnapshotReadResult> {
  const { bucket, key, targetType, guardModeRaw, targetEntityId, maxBytes } = options;
  if (!bucket) return { kind: "unavailable" };

  const guardMode = resolveGuardMode(guardModeRaw);
  let context: PublicArtifactVisibilityContext | undefined;
  let initialManifestEtag: string | null = null;

  // For events_index, fence entity does not exist so observe mode does not read manifest (CURRENT loader.ts L278-L279).
  // For other targets (like event_release), observe and enforce both read the manifest.
  const shouldReadManifest =
    guardMode === "enforce" || (guardMode === "observe" && targetType !== "events_index");

  if (shouldReadManifest) {
    try {
      const manifestResult = await readVisibilityManifestObject(bucket);
      if (guardMode === "enforce") {
        if (!manifestResult.etag) {
          return { kind: "unavailable" };
        }
        initialManifestEtag = manifestResult.etag;
      }
      context = buildPublicArtifactVisibilityContext(manifestResult.manifest);
    } catch {
      if (guardMode === "enforce") {
        return { kind: "unavailable" };
      }
    }
  }

  // If enforce and target entity is blocked, return not_found (404) for event_release
  if (guardMode === "enforce" && targetEntityId && context?.blockedEventIds.has(targetEntityId)) {
    return { kind: "not_found" };
  }

  const raw = await readBoundedR2Json(bucket, key, maxBytes);
  if (raw == null) return { kind: "unavailable" };

  // SEC-712: video visibility may be revoked while this playlist GET is in flight.
  // Only this consumer needs a second manifest commit-point check. The initial
  // manifest still denies a blocked parent event before fetching the playlist.
  // HEAD avoids downloading the same 1 MiB bounded manifest body a second time
  // in Cloudflare. Synthetic buckets without HEAD re-read through the validated
  // bounded manifest reader; never silently skip the privacy check.
  const isPublicEventPlaylist =
    targetType === "event_slots" &&
    /^events\/[A-Za-z0-9_-]{1,64}\/playlist\.v1\.json$/.test(key);
  if (guardMode === "enforce" && isPublicEventPlaylist) {
    try {
      const latestEtag = typeof bucket.head === "function"
        ? (await bucket.head(PUBLIC_VISIBILITY_BLOCKED_ENTITIES_OBJECT_KEY))?.etag ?? null
        : (await readVisibilityManifestObject(bucket)).etag;
      if (!initialManifestEtag || !latestEtag ||
          latestEtag !== initialManifestEtag) {
        // An R2 mutation, missing manifest or unverifiable ETag is a hard
        // deny; the initial blocked-video context can no longer be trusted.
        return { kind: "unavailable" };
      }
    } catch {
      return { kind: "unavailable" };
    }
  }

  const filtered = filterPublicArtifactPayload(
    targetType,
    raw,
    guardMode === "enforce" ? context : undefined,
  );
  if (filtered == null) {
    return { kind: "not_found" };
  }

  if (guardMode === "observe" && context) {
    // If target entity is blocked, log in observe mode
    if (targetEntityId && context.blockedEventIds.has(targetEntityId)) {
      console.warn(
        JSON.stringify({
          level: "warn",
          code: "public_visibility_observed_blocked_entity",
          targetType,
          targetEntityId,
        }),
      );
    }
  }

  return { kind: "ok", data: filtered };
}
