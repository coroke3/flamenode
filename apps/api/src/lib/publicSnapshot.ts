import { cancelR2BodyBestEffort } from "@flamenode/server-core/r2Body";
import { readVisibilityManifestObject } from "@flamenode/server-core/visibility/manifestR2";
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
}): Promise<SnapshotReadResult> {
  const { bucket, key, targetType, guardModeRaw, targetEntityId } = options;
  if (!bucket) return { kind: "unavailable" };

  const guardMode = resolveGuardMode(guardModeRaw);
  let context: PublicArtifactVisibilityContext | undefined;

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

  const raw = await readBoundedR2Json(bucket, key);
  if (raw == null) return { kind: "unavailable" };

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
