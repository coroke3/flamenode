/**
 * MIG-0652: exact CURRENT event-ID reuse preparation and compensation.
 * The host preserves binding lookup and manifest-wrapper behavior. This move
 * does not enable Hono reuse or repair the inherited mixed-token removal,
 * partial-PUT confirmation or concurrent compensation behavior; those remain
 * explicit acceptance blockers in the owner work-item and characterization.
 */
import { and, eq, inArray, isNull, or } from "drizzle-orm";
import type { ServerCoreDb } from "../db.ts";
import { staticArtifacts, staticRebuildQueue } from "@flamenode/db/schema";
import {
  eventBaseObjectKey,
  eventComposedObjectKey,
  eventSlotsObjectKey,
  eventReleaseObjectKey,
} from "../publicData/eventDetailCore.ts";
import { eventPlaylistObjectKey } from "../publicData/eventPlaylistCore.ts";
import {
  releaseBlockedEntityInManifest,
  upsertBlockedEntityInManifest,
  type PublicVisibilityBlockedEntity,
  type PublicVisibilityBlockedEntitiesManifest,
} from "./manifestCore.ts";
import type { VisibilityManifestBucket } from "./manifestR2.ts";
import type { VisibilityManifestHost } from "./manifestHost.ts";
import {
  EVENT_ID_RENAME_CLEANUP_REASON,
  hasCompletedEventIdRenameCleanup,
  isEventIdReuseDelayElapsed,
  type EventIdRenameCleanupRow,
} from "@flamenode/domain/event";

type EventIdReuseBucket = VisibilityManifestBucket & {
  head(key: string): Promise<unknown>;
};

/** Resolve storage only at CURRENT's original operation boundary. */
export type EventIdReuseHost = {
  requireBucket(): EventIdReuseBucket;
  readManifest(bucket: EventIdReuseBucket): ReturnType<VisibilityManifestHost["read"]>;
  writeManifest(
    manifest: PublicVisibilityBlockedEntitiesManifest,
    options: { bucket: EventIdReuseBucket; ifMatchEtag: string | null },
  ): Promise<void>;
};

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
  db: ServerCoreDb;
  eventId: string;
  tombstone: EventIdReuseTombstone;
  now?: number;
}, host: EventIdReuseHost): Promise<EventIdReusePreparation> {
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
        inArray(staticArtifacts.target_type, ["event", "event_base", "event_slots", "event_release", "event_playlist"]),
        eq(staticArtifacts.target_id, input.eventId),
        isNull(staticArtifacts.deleted_at),
      )!,
    )
    .limit(1);
  if (liveArtifacts.length > 0) {
    return notReady("event_id_reuse_artifact_tracking_pending");
  }

  let bucket: EventIdReuseBucket;
  try {
    bucket = host.requireBucket();
    // 存在確認だけなのでGETでbodyを開かない。5 objectを並列GETして未消費bodyを
    // 残すとrequestの接続資源を圧迫し得るためHEADを使う。
    const objects = await Promise.all(
      [
        eventComposedObjectKey(input.eventId),
        eventBaseObjectKey(input.eventId),
        eventSlotsObjectKey(input.eventId),
        eventReleaseObjectKey(input.eventId),
        eventPlaylistObjectKey(input.eventId),
      ].map((key) => bucket.head(key)),
    );
    if (objects.some(Boolean)) {
      return notReady("event_id_reuse_r2_cleanup_pending");
    }
  } catch {
    return notReady("event_id_reuse_storage_unavailable");
  }

  let manifest: Awaited<
    ReturnType<typeof host.readManifest>
  >;
  try {
    manifest = await host.readManifest(bucket);
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
      await host.writeManifest(released, {
        bucket,
        ifMatchEtag: manifest.etag,
      });
      const confirmed = await host.readManifest(
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
  host: EventIdReuseHost,
): Promise<void> {
  if (!input.previousEntry) return;
  let bucket: EventIdReuseBucket;
  try {
    bucket = host.requireBucket();
  } catch {
    return;
  }
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const current = await host.readManifest(bucket);
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
      await host.writeManifest(restored, {
        bucket,
        ifMatchEtag: current.etag,
      });
      return;
    } catch {
      if (attempt === 2) return;
    }
  }
}
