import "server-only";

import { and, eq, inArray, isNull, or } from "drizzle-orm";
import type { DB } from "@/lib/db/client";
import {
  publicVisibilityFences,
  staticArtifacts,
  staticRebuildQueue,
} from "@/lib/db/schema";
import { getEnv } from "@/lib/cloudflare";
import {
  eventBaseObjectKey,
  eventComposedObjectKey,
  eventSlotsObjectKey,
} from "@/lib/publicData/staticEventDetailCore";
import {
  readPublicVisibilityBlockedEntitiesManifest,
  writePublicVisibilityBlockedEntitiesManifest,
} from "@/lib/publicData/publicVisibilityManifest";
import {
  releaseBlockedEntityInManifest,
  upsertBlockedEntityInManifest,
  type PublicVisibilityBlockedEntity,
} from "@/lib/publicData/publicVisibilityManifestCore";
import {
  EVENT_ID_RENAME_CLEANUP_REASON,
  eventIdRenameCleanupTargets,
  hasCompletedEventIdRenameCleanup,
  isEventIdReuseDelayElapsed,
  type EventIdRenameCleanupRow,
} from "./eventIdReuseCore";

export type EventIdReuseTombstone = {
  fence_token: string;
  state: string;
  reason: string | null;
  blocked_at: number | null;
};

export type EventIdReusePrecommit = {
  eventId: string;
  fenceToken: string;
  previousEntry: PublicVisibilityBlockedEntity | null;
};

export type EventIdReusePreparation =
  | { ok: true; precommit: EventIdReusePrecommit }
  | { ok: false; reason: string };

function notReady(reason: string): EventIdReusePreparation {
  return { ok: false, reason };
}

/**
 * Rename tombstones are intentionally retained for a bounded safety window.
 * Reuse is allowed only after D1 cleanup history, tracked artifacts, the
 * canonical R2 objects, and the manifest all agree that the old projection is
 * gone. The caller must delete the D1 fence in the same mutation as creation
 * or rename, and compensate this manifest precommit if that mutation fails.
 */
export async function preCommitEventIdReuse(input: {
  db: DB;
  eventId: string;
  tombstone: EventIdReuseTombstone;
  now?: number;
}): Promise<EventIdReusePreparation> {
  const now = input.now ?? Math.floor(Date.now() / 1000);
  if (
    input.tombstone.state !== "blocked" ||
    input.tombstone.reason !== EVENT_ID_RENAME_CLEANUP_REASON
  ) {
    return notReady("event_id_reuse_fence_state_invalid");
  }
  if (!isEventIdReuseDelayElapsed(input.tombstone.blocked_at, now)) {
    return notReady("event_id_reuse_retention_active");
  }

  const cleanupRows = await input.db
    .select({
      target_type: staticRebuildQueue.target_type,
      target_id: staticRebuildQueue.target_id,
      status: staticRebuildQueue.status,
      updated_at: staticRebuildQueue.updated_at,
    })
    .from(staticRebuildQueue)
    .where(
      and(
        eq(staticRebuildQueue.reason, EVENT_ID_RENAME_CLEANUP_REASON),
        or(
          eq(staticRebuildQueue.target_id, input.eventId),
          eq(staticRebuildQueue.target_id, "global"),
        ),
      )!,
    );
  const cleanupHistory: EventIdRenameCleanupRow[] = cleanupRows.map((row) => ({
    targetType: row.target_type,
    targetId: row.target_id,
    status: row.status,
    updatedAt: row.updated_at,
  }));
  if (!hasCompletedEventIdRenameCleanup(input.eventId, cleanupHistory)) {
    return notReady("event_id_reuse_cleanup_pending");
  }

  const liveArtifacts = await input.db
    .select({ id: staticArtifacts.id })
    .from(staticArtifacts)
    .where(
      and(
        inArray(staticArtifacts.target_type, ["event", "event_base", "event_slots"]),
        eq(staticArtifacts.target_id, input.eventId),
        isNull(staticArtifacts.deleted_at),
      )!,
    )
    .limit(1);
  if (liveArtifacts.length > 0) {
    return notReady("event_id_reuse_artifact_tracking_pending");
  }

  let bucket: R2Bucket;
  try {
    bucket = getEnv().BUCKET;
    const objects = await Promise.all(
      [
        eventComposedObjectKey(input.eventId),
        eventBaseObjectKey(input.eventId),
        eventSlotsObjectKey(input.eventId),
      ].map((key) => bucket.get(key)),
    );
    if (objects.some(Boolean)) {
      return notReady("event_id_reuse_r2_cleanup_pending");
    }
  } catch {
    return notReady("event_id_reuse_storage_unavailable");
  }

  let manifest: Awaited<
    ReturnType<typeof readPublicVisibilityBlockedEntitiesManifest>
  >;
  try {
    manifest = await readPublicVisibilityBlockedEntitiesManifest(bucket);
  } catch {
    return notReady("event_id_reuse_manifest_unavailable");
  }
  const currentEntry =
    manifest.manifest.entities.find(
      (entry) =>
        entry.entity_type === "event" && entry.entity_id === input.eventId,
    ) ?? null;
  if (currentEntry && currentEntry.fence_token !== input.tombstone.fence_token) {
    return notReady("event_id_reuse_fence_token_mismatch");
  }

  if (currentEntry) {
    const released = releaseBlockedEntityInManifest(
      manifest.manifest,
      "event",
      input.eventId,
      input.tombstone.fence_token,
      now,
    );
    if (!released || !manifest.etag) {
      return notReady("event_id_reuse_manifest_cas_unavailable");
    }
    try {
      await writePublicVisibilityBlockedEntitiesManifest(released, {
        bucket,
        ifMatchEtag: manifest.etag,
      });
      const confirmed = await readPublicVisibilityBlockedEntitiesManifest(
        bucket,
      );
      const stillBlocked = confirmed.manifest.entities.some(
        (entry) =>
          entry.entity_type === "event" &&
          entry.entity_id === input.eventId &&
          entry.fence_token === input.tombstone.fence_token,
      );
      if (stillBlocked) {
        return notReady("event_id_reuse_manifest_release_unconfirmed");
      }
    } catch {
      return notReady("event_id_reuse_manifest_release_failed");
    }
  }

  return {
    ok: true,
    precommit: {
      eventId: input.eventId,
      fenceToken: input.tombstone.fence_token,
      previousEntry: currentEntry,
    },
  };
}

export async function compensateEventIdReuseOnD1Failure(
  input: EventIdReusePrecommit,
): Promise<void> {
  if (!input.previousEntry) return;
  let bucket: R2Bucket;
  try {
    bucket = getEnv().BUCKET;
  } catch {
    return;
  }
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const current = await readPublicVisibilityBlockedEntitiesManifest(bucket);
      const currentEntry = current.manifest.entities.find(
        (entry) =>
          entry.entity_type === "event" && entry.entity_id === input.eventId,
      );
      if (currentEntry) {
        if (currentEntry.fence_token !== input.fenceToken) return;
        return;
      }
      const restored = upsertBlockedEntityInManifest(
        current.manifest,
        input.previousEntry,
        Math.floor(Date.now() / 1000),
      );
      await writePublicVisibilityBlockedEntitiesManifest(restored, {
        bucket,
        ifMatchEtag: current.etag,
      });
      return;
    } catch {
      if (attempt === 2) return;
    }
  }
}

export { eventIdRenameCleanupTargets } from "./eventIdReuseCore";
