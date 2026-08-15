import "server-only";

import { and, eq } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import type { DB } from "@/lib/db/client";
import { eventGroups, publicVisibilityFences } from "@/lib/db/schema";
import { generateId } from "@/lib/utils/id";
import {
  readPublicVisibilityBlockedEntitiesManifest,
  writePublicVisibilityBlockedEntitiesManifest,
} from "@/lib/publicData/publicVisibilityManifest";
import {
  releaseBlockedEntityInManifest,
  upsertBlockedEntityInManifest,
} from "@/lib/publicData/publicVisibilityManifestCore";
import { getPublicVisibilityFence } from "@/lib/publicData/publicVisibilityFenceStore";

type EventGroupVisibilityStatus = typeof eventGroups.$inferSelect["visibility_status"];

export type EventGroupVisibilityFencePlan = {
  mutationStatements: BatchItem<"sqlite">[];
  expectedMutationChanges: number[];
  fenceToken: string | null;
  previousStatus: EventGroupVisibilityStatus;
  nextStatus: EventGroupVisibilityStatus;
};

function isPublic(status: EventGroupVisibilityStatus): boolean {
  return status === "public";
}

function buildFenceUpsertStatement(
  db: DB,
  input: {
    groupId: string;
    fenceToken: string;
    state: "blocked" | "release_pending";
    actorUserId: string;
    reason?: string | null;
    now: number;
  },
): BatchItem<"sqlite"> {
  return db
    .insert(publicVisibilityFences)
    .values({
      entity_type: "event_group",
      entity_id: input.groupId,
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
      target: [
        publicVisibilityFences.entity_type,
        publicVisibilityFences.entity_id,
      ],
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
 * event_groups の公開状態変更を D1 mutation と同一 batch に載せるための
 * fence planner。既存の blocked/release_pending token は再利用し、R2 と
 * D1 の token が分離しないようにする。
 */
export async function planEventGroupVisibilityFenceTransition(input: {
  db: DB;
  groupId: string;
  previousStatus: EventGroupVisibilityStatus;
  nextStatus: EventGroupVisibilityStatus;
  actorUserId: string;
  reason?: string | null;
  now: number;
}): Promise<EventGroupVisibilityFencePlan> {
  if (
    input.previousStatus === input.nextStatus ||
    isPublic(input.previousStatus) === isPublic(input.nextStatus)
  ) {
    return {
      mutationStatements: [],
      expectedMutationChanges: [],
      fenceToken: null,
      previousStatus: input.previousStatus,
      nextStatus: input.nextStatus,
    };
  }

  const existing = await getPublicVisibilityFence(
    input.db,
    "event_group",
    input.groupId,
  );
  const reusableToken =
    existing &&
    (existing.state === "blocked" || existing.state === "release_pending")
      ? existing.fence_token
      : null;
  const fenceToken = reusableToken || generateId("vf");
  const nextState = isPublic(input.nextStatus)
    ? "release_pending"
    : "blocked";

  return {
    mutationStatements: [
      buildFenceUpsertStatement(input.db, {
        groupId: input.groupId,
        fenceToken,
        state: nextState,
        actorUserId: input.actorUserId,
        reason: input.reason,
        now: input.now,
      }),
    ],
    expectedMutationChanges: [1],
    fenceToken,
    previousStatus: input.previousStatus,
    nextStatus: input.nextStatus,
  };
}

/** Write the block before the canonical D1 mutation and verify token visibility. */
export async function preCommitEventGroupVisibilityTransition(input: {
  groupId: string;
  fenceToken: string;
  reason?: string | null;
}): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const { manifest, etag } =
    await readPublicVisibilityBlockedEntitiesManifest();
  const next = upsertBlockedEntityInManifest(
    manifest,
    {
      entity_type: "event_group",
      entity_id: input.groupId,
      fence_token: input.fenceToken,
      blocked_at: now,
      reason: input.reason ?? null,
    },
    now,
  );
  await writePublicVisibilityBlockedEntitiesManifest(next, {
    ifMatchEtag: etag,
  });

  const { manifest: confirmed } =
    await readPublicVisibilityBlockedEntitiesManifest();
  const entry = confirmed.entities.find(
    (row) =>
      row.entity_type === "event_group" && row.entity_id === input.groupId,
  );
  if (!entry || entry.fence_token !== input.fenceToken) {
    throw new Error("public_visibility_fence_token_mismatch");
  }
}

/**
 * If mutateWithAudit rolled back the fence row, remove only our exact R2 token.
 * A newer D1 fence or manifest entry is never overwritten.
 */
export async function compensateEventGroupVisibilityOnD1Failure(input: {
  db: DB;
  groupId: string;
  fenceToken: string;
}): Promise<void> {
  const fence = await getPublicVisibilityFence(
    input.db,
    "event_group",
    input.groupId,
  );
  if (fence?.fence_token === input.fenceToken) return;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const { manifest, etag } =
      await readPublicVisibilityBlockedEntitiesManifest();
    const entry = manifest.entities.find(
      (row) =>
        row.entity_type === "event_group" &&
        row.entity_id === input.groupId,
    );
    if (!entry || entry.fence_token !== input.fenceToken) return;
    const released = releaseBlockedEntityInManifest(
      manifest,
      "event_group",
      input.groupId,
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
