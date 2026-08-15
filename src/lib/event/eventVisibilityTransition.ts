import "server-only";

import { eq } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import type { DB } from "@/lib/db/client";
import { events, publicVisibilityFences } from "@/lib/db/schema";
import { generateId } from "@/lib/utils/id";
import {
  readPublicVisibilityBlockedEntitiesManifest,
  writePublicVisibilityBlockedEntitiesManifest,
} from "@/lib/publicData/publicVisibilityManifest";
import {
  isEntityBlockedInManifest,
  releaseBlockedEntityInManifest,
  upsertBlockedEntityInManifest,
  type PublicVisibilityBlockedEntity,
} from "@/lib/publicData/publicVisibilityManifestCore";
import { getPublicVisibilityFence } from "@/lib/publicData/publicVisibilityFenceStore";

type EventVisibilityStatus = typeof events.$inferSelect["visibility_status"];

export type EventVisibilityTransitionPlan = {
  mutationStatements: BatchItem<"sqlite">[];
  expectedMutationChanges: (number | null)[];
  fenceToken: string | null;
  depublicizedFromPublic: boolean;
};

export type EventVisibilityFenceRenamePrecommit = {
  oldEventId: string;
  newEventId: string;
  fenceToken: string;
  previousOldEntry: PublicVisibilityBlockedEntity | null;
};

/**
 * Event ID を変更した後も、旧 ID に残った R2 artifact を公開しないための
 * tombstone pre-commit。旧 ID は D1 から消えるため、D1 fence の有無だけでは
 * public loader を止められない。成功後は旧 URL を再利用しても古い payload を
 * 返さないよう block を残し、D1 が rollback した場合だけ元の entry を戻す。
 */
export type EventVisibilityRenameTombstonePrecommit = {
  eventId: string;
  fenceToken: string;
  previousEntry: PublicVisibilityBlockedEntity | null;
};

function buildEventFenceUpsertStatement(
  db: DB,
  input: {
    eventId: string;
    fenceToken: string;
    state: "blocked" | "release_pending";
    reason?: string | null;
    actorUserId: string;
    now: number;
  },
): BatchItem<"sqlite"> {
  return db
    .insert(publicVisibilityFences)
    .values({
      entity_type: "event",
      entity_id: input.eventId,
      fence_token: input.fenceToken,
      state: input.state,
      reason: input.reason ?? null,
      requirements_json: null,
      blocked_at: input.state === "blocked" ? input.now : null,
      release_requested_at:
        input.state === "release_pending" ? input.now : null,
      requested_by_auth_user_id: input.actorUserId,
      updated_at: input.now,
    })
    .onConflictDoUpdate({
      target: [publicVisibilityFences.entity_type, publicVisibilityFences.entity_id],
      set: {
        fence_token: input.fenceToken,
        state: input.state,
        reason: input.reason ?? null,
        requirements_json: null,
        blocked_at: input.state === "blocked" ? input.now : null,
        release_requested_at:
          input.state === "release_pending" ? input.now : null,
        requested_by_auth_user_id: input.actorUserId,
        updated_at: input.now,
      },
    });
}

/**
 * イベントの公開状態変更に伴うフェンス行を、イベント本体と同じ D1 batch
 * に追加する。再公開時も一度 blocked として manifest に載せ、event artifact
 * の生成が完了するまで古い成果物を公開しない。
 */
export function planEventVisibilityTransition(input: {
  db: DB;
  eventId: string;
  previousStatus: EventVisibilityStatus;
  nextStatus: EventVisibilityStatus;
  actorUserId: string;
  reason?: string | null;
  now: number;
}): EventVisibilityTransitionPlan {
  if (input.previousStatus === input.nextStatus) {
    return {
      mutationStatements: [],
      expectedMutationChanges: [],
      fenceToken: null,
      depublicizedFromPublic: false,
    };
  }

  const fenceToken = generateId("vf");
  const depublicizedFromPublic = input.previousStatus === "public";
  const state = input.nextStatus === "public" ? "release_pending" : "blocked";

  return {
    mutationStatements: [
      buildEventFenceUpsertStatement(input.db, {
        eventId: input.eventId,
        fenceToken,
        state,
        reason: input.reason,
        actorUserId: input.actorUserId,
        now: input.now,
      }),
    ],
    expectedMutationChanges: [1],
    fenceToken,
    depublicizedFromPublic,
  };
}

/** D1 のイベント更新前に R2 の公開 manifest を block する。 */
export async function preCommitEventVisibilityTransition(input: {
  eventId: string;
  fenceToken: string;
  reason?: string | null;
}): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const { manifest, etag } = await readPublicVisibilityBlockedEntitiesManifest();
  const updated = upsertBlockedEntityInManifest(
    manifest,
    {
      entity_type: "event",
      entity_id: input.eventId,
      fence_token: input.fenceToken,
      blocked_at: now,
      reason: input.reason ?? null,
    },
    now,
  );
  await writePublicVisibilityBlockedEntitiesManifest(updated, {
    ifMatchEtag: etag,
    mutateOnConflict: (latest) => {
      const current = latest.entities.find(
        (entry) =>
          entry.entity_type === "event" && entry.entity_id === input.eventId,
      );
      if (current && current.fence_token !== input.fenceToken) {
        throw new Error("public_visibility_fence_token_mismatch");
      }
      return upsertBlockedEntityInManifest(
        latest,
        {
          entity_type: "event",
          entity_id: input.eventId,
          fence_token: input.fenceToken,
          blocked_at: Math.floor(Date.now() / 1000),
          reason: input.reason ?? null,
        },
        Math.floor(Date.now() / 1000),
      );
    },
  });

  const { manifest: confirmed } =
    await readPublicVisibilityBlockedEntitiesManifest();
  if (
    !isEntityBlockedInManifest(confirmed, "event", input.eventId) ||
    !confirmed.entities.some(
      (entry) =>
        entry.entity_type === "event" &&
        entry.entity_id === input.eventId &&
        entry.fence_token === input.fenceToken,
    )
  ) {
    throw new Error("public_visibility_fence_token_mismatch");
  }
}

/**
 * event ID rename は D1 の fence 主キーも移動するため、blocked / release_pending
 * の R2 manifest entry も同じ token で移動してから D1 を更新する。これを省くと
 * release worker が新 ID の entry を見つけられず、release_pending が永続化する。
 */
export async function preCommitEventVisibilityFenceRename(input: {
  oldEventId: string;
  newEventId: string;
  fenceToken: string;
  reason?: string | null;
}): Promise<EventVisibilityFenceRenamePrecommit> {
  const now = Math.floor(Date.now() / 1000);
  const { manifest, etag } = await readPublicVisibilityBlockedEntitiesManifest();
  const previousOldEntry =
    manifest.entities.find(
      (entry) =>
        entry.entity_type === "event" && entry.entity_id === input.oldEventId,
    ) ?? null;
  const currentNewEntry =
    manifest.entities.find(
      (entry) =>
        entry.entity_type === "event" && entry.entity_id === input.newEventId,
    ) ?? null;
  if (
    (previousOldEntry && previousOldEntry.fence_token !== input.fenceToken) ||
    (currentNewEntry && currentNewEntry.fence_token !== input.fenceToken)
  ) {
    throw new Error("public_visibility_fence_token_mismatch");
  }

  // Keep the old entry during this first write. The caller subsequently
  // replaces it with an old-ID tombstone, but retaining it here closes the
  // crash window between the fence-copy and that tombstone write.
  const withoutNewEventId = {
    ...manifest,
    entities: manifest.entities.filter(
      (entry) =>
        !(
          entry.entity_type === "event" &&
          entry.entity_id === input.newEventId
        ),
    ),
  };
  const next = upsertBlockedEntityInManifest(
    withoutNewEventId,
    {
      entity_type: "event",
      entity_id: input.newEventId,
      fence_token: input.fenceToken,
      blocked_at: previousOldEntry?.blocked_at ?? now,
      reason: previousOldEntry?.reason ?? input.reason ?? null,
    },
    now,
  );
  await writePublicVisibilityBlockedEntitiesManifest(next, {
    ifMatchEtag: etag,
    mutateOnConflict: (latest) => {
      const previous = latest.entities.find(
        (entry) =>
          entry.entity_type === "event" && entry.entity_id === input.oldEventId,
      ) ?? null;
      const current = latest.entities.find(
        (entry) =>
          entry.entity_type === "event" && entry.entity_id === input.newEventId,
      );
      if (
        (previous && previous.fence_token !== input.fenceToken) ||
        (current && current.fence_token !== input.fenceToken)
      ) {
        throw new Error("public_visibility_fence_token_mismatch");
      }
      const withoutNew = {
        ...latest,
        entities: latest.entities.filter(
          (entry) =>
            !(
              entry.entity_type === "event" &&
              entry.entity_id === input.newEventId
            ),
        ),
      };
      return upsertBlockedEntityInManifest(
        withoutNew,
        {
          entity_type: "event",
          entity_id: input.newEventId,
          fence_token: input.fenceToken,
          blocked_at: previous?.blocked_at ?? Math.floor(Date.now() / 1000),
          reason: previous?.reason ?? input.reason ?? null,
        },
        Math.floor(Date.now() / 1000),
      );
    },
  });

  const { manifest: confirmed } =
    await readPublicVisibilityBlockedEntitiesManifest();
  const confirmedEntry = confirmed.entities.find(
    (entry) =>
      entry.entity_type === "event" && entry.entity_id === input.newEventId,
  );
  if (
    !confirmedEntry ||
    confirmedEntry.fence_token !== input.fenceToken ||
    previousOldEntry !== null &&
    !confirmed.entities.some(
      (entry) =>
        entry.entity_type === "event" && entry.entity_id === input.oldEventId,
    )
  ) {
    throw new Error("public_visibility_fence_token_mismatch");
  }
  return {
    oldEventId: input.oldEventId,
    newEventId: input.newEventId,
    fenceToken: input.fenceToken,
    previousOldEntry,
  };
}

export async function preCommitEventVisibilityRenameTombstone(input: {
  eventId: string;
  fenceToken: string;
  reason?: string | null;
}): Promise<EventVisibilityRenameTombstonePrecommit> {
  const now = Math.floor(Date.now() / 1000);
  const { manifest, etag } = await readPublicVisibilityBlockedEntitiesManifest();
  const previousEntry =
    manifest.entities.find(
      (entry) =>
        entry.entity_type === "event" && entry.entity_id === input.eventId,
    ) ?? null;
  const next = upsertBlockedEntityInManifest(
    manifest,
    {
      entity_type: "event",
      entity_id: input.eventId,
      fence_token: input.fenceToken,
      blocked_at: previousEntry?.blocked_at ?? now,
      reason: previousEntry?.reason ?? input.reason ?? "event_id_rename",
    },
    now,
  );
  await writePublicVisibilityBlockedEntitiesManifest(next, {
    ifMatchEtag: etag,
    mutateOnConflict: (latest) => {
      const previous = latest.entities.find(
        (entry) =>
          entry.entity_type === "event" && entry.entity_id === input.eventId,
      ) ?? null;
      return upsertBlockedEntityInManifest(
        latest,
        {
          entity_type: "event",
          entity_id: input.eventId,
          fence_token: input.fenceToken,
          blocked_at: previous?.blocked_at ?? Math.floor(Date.now() / 1000),
          reason:
            previous?.reason ?? input.reason ?? "event_id_rename_old_cleanup",
        },
        Math.floor(Date.now() / 1000),
      );
    },
  });

  const { manifest: confirmed } =
    await readPublicVisibilityBlockedEntitiesManifest();
  const confirmedEntry = confirmed.entities.find(
    (entry) =>
      entry.entity_type === "event" && entry.entity_id === input.eventId,
  );
  if (!confirmedEntry || confirmedEntry.fence_token !== input.fenceToken) {
    throw new Error("public_visibility_fence_token_mismatch");
  }
  return {
    eventId: input.eventId,
    fenceToken: input.fenceToken,
    previousEntry,
  };
}

/** D1 rename failure時に pre-commit した manifest entryを元のIDへ戻す。 */
export async function compensateEventVisibilityFenceRenameOnD1Failure(
  input: EventVisibilityFenceRenamePrecommit,
): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const { manifest, etag } =
      await readPublicVisibilityBlockedEntitiesManifest();
    const currentNewEntry = manifest.entities.find(
      (entry) =>
        entry.entity_type === "event" &&
        entry.entity_id === input.newEventId,
    );
    if (!currentNewEntry || currentNewEntry.fence_token !== input.fenceToken) {
      return;
    }
    const withoutNew = {
      ...manifest,
      entities: manifest.entities.filter(
        (entry) =>
          !(
            entry.entity_type === "event" &&
            entry.entity_id === input.newEventId
          ),
      ),
    };
    const restored = input.previousOldEntry
      ? upsertBlockedEntityInManifest(
          withoutNew,
          input.previousOldEntry,
          Math.floor(Date.now() / 1000),
        )
      : {
          ...withoutNew,
          revision: withoutNew.revision + 1,
          generated_at: Math.floor(Date.now() / 1000),
        };
    try {
      await writePublicVisibilityBlockedEntitiesManifest(restored, {
        ifMatchEtag: etag,
      });
      return;
    } catch {
      if (attempt === 2) return;
    }
  }
}

/** D1 rename failure時だけ、旧ID tombstoneを元のmanifest entryへ戻す。 */
export async function compensateEventVisibilityRenameTombstoneOnD1Failure(
  input: EventVisibilityRenameTombstonePrecommit,
): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const { manifest, etag } =
      await readPublicVisibilityBlockedEntitiesManifest();
    const currentEntry = manifest.entities.find(
      (entry) =>
        entry.entity_type === "event" && entry.entity_id === input.eventId,
    );
    if (!currentEntry || currentEntry.fence_token !== input.fenceToken) {
      return;
    }
    const withoutCurrent = {
      ...manifest,
      entities: manifest.entities.filter(
        (entry) =>
          !(
            entry.entity_type === "event" && entry.entity_id === input.eventId
          ),
      ),
    };
    const restored = input.previousEntry
      ? upsertBlockedEntityInManifest(
          withoutCurrent,
          input.previousEntry,
          Math.floor(Date.now() / 1000),
        )
      : {
          ...withoutCurrent,
          revision: withoutCurrent.revision + 1,
          generated_at: Math.floor(Date.now() / 1000),
        };
    try {
      await writePublicVisibilityBlockedEntitiesManifest(restored, {
        ifMatchEtag: etag,
      });
      return;
    } catch {
      if (attempt === 2) return;
    }
  }
}

/** D1 失敗時、イベントがまだ public の場合だけ先行 block を戻す。 */
export async function compensateEventVisibilityFenceOnD1Failure(
  db: DB,
  input: {
    eventId: string;
    fenceToken: string;
    allowNonPublicRollback?: boolean;
  },
): Promise<void> {
  const event = (
    await db
      .select({ visibility_status: events.visibility_status })
      .from(events)
      .where(eq(events.id, input.eventId))
      .limit(1)
  )[0];
  const fence = await getPublicVisibilityFence(db, "event", input.eventId);
  if (
    fence &&
    (fence.state === "blocked" || fence.state === "release_pending") &&
    fence.fence_token === input.fenceToken
  ) {
    return;
  }
  if (
    !event ||
    (event.visibility_status !== "public" && !input.allowNonPublicRollback)
  ) {
    return;
  }

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const { manifest, etag } =
      await readPublicVisibilityBlockedEntitiesManifest();
    const entry = manifest.entities.find(
      (row) =>
        row.entity_type === "event" && row.entity_id === input.eventId,
    );
    if (!entry || entry.fence_token !== input.fenceToken) return;
    const released = releaseBlockedEntityInManifest(
      manifest,
      "event",
      input.eventId,
      input.fenceToken,
      Math.floor(Date.now() / 1000),
    );
    if (!released) return;
    try {
      await writePublicVisibilityBlockedEntitiesManifest(released, {
        ifMatchEtag: etag,
      });
      return;
    } catch {
      if (attempt === 2) return;
    }
  }
}
