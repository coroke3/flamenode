import "server-only";

import { and, eq } from "drizzle-orm";
import type { DB } from "@/lib/db/client";
import { publicVisibilityFences } from "@/lib/db/schema";
import type {
  PublicVisibilityFenceEntityType,
  PublicVisibilityFenceState,
} from "./publicVisibilityManifestCore";

export type PublicVisibilityFenceRow = typeof publicVisibilityFences.$inferSelect;

export async function upsertPublicVisibilityFence(
  db: DB,
  input: {
    entityType: PublicVisibilityFenceEntityType;
    entityId: string;
    fenceToken: string;
    state: PublicVisibilityFenceState;
    reason?: string | null;
    requirementsJson?: string | null;
    blockedAt?: number | null;
    releaseRequestedAt?: number | null;
    requestedByAuthUserId?: string | null;
    updatedAt: number;
  },
): Promise<void> {
  const normalizedId =
    input.entityType === "x_user"
      ? input.entityId.toLowerCase()
      : input.entityId;
  const existing = await db
    .select()
    .from(publicVisibilityFences)
    .where(
      and(
        eq(publicVisibilityFences.entity_type, input.entityType),
        eq(publicVisibilityFences.entity_id, normalizedId),
      )!,
    )
    .limit(1);
  if (existing[0]) {
    await db
      .update(publicVisibilityFences)
      .set({
        fence_token: input.fenceToken,
        state: input.state,
        reason: input.reason ?? null,
        requirements_json: input.requirementsJson ?? null,
        blocked_at: input.blockedAt ?? null,
        release_requested_at: input.releaseRequestedAt ?? null,
        requested_by_auth_user_id: input.requestedByAuthUserId ?? null,
        updated_at: input.updatedAt,
      })
      .where(
        and(
          eq(publicVisibilityFences.entity_type, input.entityType),
          eq(publicVisibilityFences.entity_id, normalizedId),
        )!,
      );
    return;
  }
  await db.insert(publicVisibilityFences).values({
    entity_type: input.entityType,
    entity_id: normalizedId,
    fence_token: input.fenceToken,
    state: input.state,
    reason: input.reason ?? null,
    requirements_json: input.requirementsJson ?? null,
    blocked_at: input.blockedAt ?? null,
    release_requested_at: input.releaseRequestedAt ?? null,
    requested_by_auth_user_id: input.requestedByAuthUserId ?? null,
    updated_at: input.updatedAt,
  });
}

export async function deletePublicVisibilityFence(
  db: DB,
  entityType: PublicVisibilityFenceEntityType,
  entityId: string,
  fenceToken: string,
): Promise<boolean> {
  const normalizedId =
    entityType === "x_user" ? entityId.toLowerCase() : entityId;
  const result = await db
    .delete(publicVisibilityFences)
    .where(
      and(
        eq(publicVisibilityFences.entity_type, entityType),
        eq(publicVisibilityFences.entity_id, normalizedId),
        eq(publicVisibilityFences.fence_token, fenceToken),
      )!,
    );
  return (result.meta?.changes ?? 0) > 0;
}

export async function getPublicVisibilityFence(
  db: DB,
  entityType: PublicVisibilityFenceEntityType,
  entityId: string,
): Promise<PublicVisibilityFenceRow | null> {
  const normalizedId =
    entityType === "x_user" ? entityId.toLowerCase() : entityId;
  const rows = await db
    .select()
    .from(publicVisibilityFences)
    .where(
      and(
        eq(publicVisibilityFences.entity_type, entityType),
        eq(publicVisibilityFences.entity_id, normalizedId),
      )!,
    )
    .limit(1);
  return rows[0] ?? null;
}
