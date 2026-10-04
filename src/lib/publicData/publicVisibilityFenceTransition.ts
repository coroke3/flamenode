import "server-only";

import type { BatchItem } from "drizzle-orm/batch";
import type { DB } from "@/lib/db/client";
import { publicVisibilityFences } from "@/lib/db/schema";
import { generateId } from "@/lib/utils/id";
import {
  readPublicVisibilityBlockedEntitiesManifest,
  writePublicVisibilityBlockedEntitiesManifest,
} from "./publicVisibilityManifest";
import {
  releaseBlockedEntityInManifest,
  upsertBlockedEntityInManifest,
  type PublicVisibilityBlockedEntitiesManifest,
  type PublicVisibilityFenceEntityType,
} from "./publicVisibilityManifestCore";
import { getPublicVisibilityFence } from "./publicVisibilityFenceStore";
import { logStuckPublicVisibilityFenceCandidate } from "./visibilityCompensation";

/**
 * 公開/非公開の切り替えを fence で守る entity（event・event_group・x_user）が
 * 共有する fence ライフサイクル。D1 の fence 行は canonical mutation と同じ
 * batch に載せ、R2 manifest への block はその前に書いて token を確認する。
 */

function normalizeEntityId(
  entityType: PublicVisibilityFenceEntityType,
  entityId: string,
): string {
  return entityType === "x_user" ? entityId.toLowerCase() : entityId;
}

function findManifestEntry(
  manifest: PublicVisibilityBlockedEntitiesManifest,
  entityType: PublicVisibilityFenceEntityType,
  entityId: string,
) {
  return manifest.entities.find(
    (entry) =>
      entry.entity_type === entityType &&
      normalizeEntityId(entityType, entry.entity_id) === entityId,
  );
}

export function buildPublicVisibilityFenceUpsertStatement(
  db: DB,
  input: {
    entityType: PublicVisibilityFenceEntityType;
    entityId: string;
    fenceToken: string;
    state: "blocked" | "release_pending";
    actorUserId: string;
    reason?: string | null;
    now: number;
  },
): BatchItem<"sqlite"> {
  const fields = {
    fence_token: input.fenceToken,
    state: input.state,
    reason: input.reason ?? null,
    requirements_json: null,
    blocked_at: input.state === "blocked" ? input.now : null,
    release_requested_at: input.state === "release_pending" ? input.now : null,
    requested_by_auth_user_id: input.actorUserId,
    updated_at: input.now,
  };
  return db
    .insert(publicVisibilityFences)
    .values({
      entity_type: input.entityType,
      entity_id: normalizeEntityId(input.entityType, input.entityId),
      ...fields,
    })
    .onConflictDoUpdate({
      target: [
        publicVisibilityFences.entity_type,
        publicVisibilityFences.entity_id,
      ],
      set: fields,
    });
}

export type PublicVisibilityFencePlan<Status> = {
  mutationStatements: BatchItem<"sqlite">[];
  expectedMutationChanges: number[];
  fenceToken: string | null;
  previousStatus: Status;
  nextStatus: Status;
};

/**
 * 公開可否が変わるときだけ fence 行の upsert を返す。既存の
 * blocked/release_pending token は再利用し、R2 と D1 の token を分離させない。
 */
export async function planPublicVisibilityFenceTransition<Status>(input: {
  db: DB;
  entityType: PublicVisibilityFenceEntityType;
  entityId: string;
  previousStatus: Status;
  nextStatus: Status;
  isPublic: (status: Status) => boolean;
  actorUserId: string;
  reason?: string | null;
  now: number;
}): Promise<PublicVisibilityFencePlan<Status>> {
  const unchanged = {
    mutationStatements: [],
    expectedMutationChanges: [],
    fenceToken: null,
    previousStatus: input.previousStatus,
    nextStatus: input.nextStatus,
  };
  if (
    input.previousStatus === input.nextStatus ||
    input.isPublic(input.previousStatus) === input.isPublic(input.nextStatus)
  ) {
    return unchanged;
  }

  const existing = await getPublicVisibilityFence(
    input.db,
    input.entityType,
    input.entityId,
  );
  const reusableToken =
    existing &&
    (existing.state === "blocked" || existing.state === "release_pending")
      ? existing.fence_token
      : null;
  const fenceToken = reusableToken || generateId("vf");

  return {
    ...unchanged,
    mutationStatements: [
      buildPublicVisibilityFenceUpsertStatement(input.db, {
        entityType: input.entityType,
        entityId: input.entityId,
        fenceToken,
        state: input.isPublic(input.nextStatus) ? "release_pending" : "blocked",
        actorUserId: input.actorUserId,
        reason: input.reason,
        now: input.now,
      }),
    ],
    expectedMutationChanges: [1],
    fenceToken,
  };
}

/** Write the block before the canonical D1 mutation and verify token visibility. */
export async function preCommitPublicVisibilityFence(input: {
  entityType: PublicVisibilityFenceEntityType;
  entityId: string;
  fenceToken: string;
  reason?: string | null;
}): Promise<void> {
  const entityId = normalizeEntityId(input.entityType, input.entityId);
  const block = (manifest: PublicVisibilityBlockedEntitiesManifest) => {
    const now = Math.floor(Date.now() / 1000);
    return upsertBlockedEntityInManifest(
      manifest,
      {
        entity_type: input.entityType,
        entity_id: entityId,
        fence_token: input.fenceToken,
        blocked_at: now,
        reason: input.reason ?? null,
      },
      now,
    );
  };
  const { manifest, etag } = await readPublicVisibilityBlockedEntitiesManifest();
  await writePublicVisibilityBlockedEntitiesManifest(block(manifest), {
    ifMatchEtag: etag,
    mutateOnConflict: (latest) => {
      const current = findManifestEntry(latest, input.entityType, entityId);
      if (current && current.fence_token !== input.fenceToken) {
        throw new Error("public_visibility_fence_token_mismatch");
      }
      return block(latest);
    },
  });

  const { manifest: confirmed } =
    await readPublicVisibilityBlockedEntitiesManifest();
  const entry = findManifestEntry(confirmed, input.entityType, entityId);
  if (!entry || entry.fence_token !== input.fenceToken) {
    throw new Error("public_visibility_fence_token_mismatch");
  }
}

/**
 * If mutateWithAudit rolled back the fence row, remove only our exact R2 token.
 * A newer D1 fence or manifest entry is never overwritten.
 */
export async function compensatePublicVisibilityFenceOnD1Failure(input: {
  db: DB;
  entityType: PublicVisibilityFenceEntityType;
  entityId: string;
  fenceToken: string;
  flow: string;
}): Promise<void> {
  const entityId = normalizeEntityId(input.entityType, input.entityId);
  const logStuck = (error: unknown) =>
    logStuckPublicVisibilityFenceCandidate({
      flow: input.flow,
      entityType: input.entityType,
      entityId,
      fenceToken: input.fenceToken,
      error,
    });
  try {
    const fence = await getPublicVisibilityFence(
      input.db,
      input.entityType,
      entityId,
    );
    if (fence?.fence_token === input.fenceToken) return;

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const { manifest, etag } =
        await readPublicVisibilityBlockedEntitiesManifest();
      const entry = findManifestEntry(manifest, input.entityType, entityId);
      // A token mismatch belongs to a newer transition and is intentionally
      // left untouched.
      if (!entry || entry.fence_token !== input.fenceToken) return;
      const released = releaseBlockedEntityInManifest(
        manifest,
        input.entityType,
        entityId,
        input.fenceToken,
        Math.floor(Date.now() / 1000),
      );
      if (!released) return;
      try {
        await writePublicVisibilityBlockedEntitiesManifest(released, {
          ifMatchEtag: etag,
        });
        return;
      } catch (error) {
        if (attempt === 2) {
          logStuck(error);
          return;
        }
      }
    }
  } catch (error) {
    logStuck(error);
  }
}
