import "server-only";

import type { BatchItem } from "drizzle-orm/batch";
import type { DB } from "@/lib/db/client";
import { publicVisibilityFences, xUsers } from "@/lib/db/schema";
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
import { PUBLIC_LISTABLE_X_APPROVAL_STATUSES } from "@/lib/utils/publicXUser";

type XUserApprovalStatus = typeof xUsers.$inferSelect["approval_status"];

export type XUserVisibilityFencePlan = {
  mutationStatements: BatchItem<"sqlite">[];
  expectedMutationChanges: number[];
  fenceToken: string | null;
  previousStatus: XUserApprovalStatus;
  nextStatus: XUserApprovalStatus;
};

function isListable(status: XUserApprovalStatus): boolean {
  return PUBLIC_LISTABLE_X_APPROVAL_STATUSES.some((value) => value === status);
}

function buildFenceUpsertStatement(
  db: DB,
  input: {
    xUserId: string;
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
      entity_type: "x_user",
      entity_id: input.xUserId.toLowerCase(),
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

export async function planXUserVisibilityFenceTransition(input: {
  db: DB;
  xUserId: string;
  previousStatus: XUserApprovalStatus;
  nextStatus: XUserApprovalStatus;
  actorUserId: string;
  reason?: string | null;
  now: number;
}): Promise<XUserVisibilityFencePlan> {
  if (
    input.previousStatus === input.nextStatus ||
    isListable(input.previousStatus) === isListable(input.nextStatus)
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
    "x_user",
    input.xUserId,
  );
  const reusableToken =
    existing &&
    (existing.state === "blocked" || existing.state === "release_pending")
      ? existing.fence_token
      : null;
  const fenceToken = reusableToken || generateId("vf");
  const nextState = isListable(input.nextStatus)
    ? "release_pending"
    : "blocked";

  return {
    mutationStatements: [
      buildFenceUpsertStatement(input.db, {
        xUserId: input.xUserId,
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

export async function preCommitXUserVisibilityTransition(input: {
  xUserId: string;
  fenceToken: string;
  reason?: string | null;
}): Promise<void> {
  const xUserId = input.xUserId.toLowerCase();
  const now = Math.floor(Date.now() / 1000);
  const { manifest, etag } =
    await readPublicVisibilityBlockedEntitiesManifest();
  const next = upsertBlockedEntityInManifest(
    manifest,
    {
      entity_type: "x_user",
      entity_id: xUserId,
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
      row.entity_type === "x_user" &&
      row.entity_id.toLowerCase() === xUserId,
  );
  if (!entry || entry.fence_token !== input.fenceToken) {
    throw new Error("public_visibility_fence_token_mismatch");
  }
}

export async function compensateXUserVisibilityOnD1Failure(input: {
  db: DB;
  xUserId: string;
  fenceToken: string;
}): Promise<void> {
  const xUserId = input.xUserId.toLowerCase();
  const fence = await getPublicVisibilityFence(input.db, "x_user", xUserId);
  if (fence?.fence_token === input.fenceToken) return;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const { manifest, etag } =
      await readPublicVisibilityBlockedEntitiesManifest();
    const entry = manifest.entities.find(
      (row) =>
        row.entity_type === "x_user" &&
        row.entity_id.toLowerCase() === xUserId,
    );
    if (!entry || entry.fence_token !== input.fenceToken) return;
    const released = releaseBlockedEntityInManifest(
      manifest,
      "x_user",
      xUserId,
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
