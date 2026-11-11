import {
  normalizeXId,
  type CanonicalXUserResolution,
} from "@flamenode/domain/xid";
import type { CollaboratorPermissionIntent } from "@flamenode/domain/video";
import type { ServerCoreDb } from "../db.ts";
import { resolveCanonicalXUserResolutions } from "../xid/requestIdentity.ts";

/** Historical invalid/rejected/ambiguous aliases MUST never create new rows. */
const DENIED_RESOLUTION_REASONS = new Set<CanonicalXUserResolution["reason"]>([
  "invalid_alias_target",
  "ambiguous_alias",
  "canonical_alias_collision",
  "rejected_or_invalid",
]);

export function canonicalizeResolvedPermissionIntents(
  input: readonly CollaboratorPermissionIntent[],
  resolutions: ReadonlyMap<string, CanonicalXUserResolution>,
): CollaboratorPermissionIntent[] {
  return input.map((item) => {
    const normalizedId = normalizeXId(item.x_user_id);
    const resolution = resolutions.get(normalizedId);
    if (resolution && DENIED_RESOLUTION_REASONS.has(resolution.reason)) {
      throw new Error(`video_permission_x_user_resolution_invalid:${normalizedId}`);
    }
    return { ...item, x_user_id: resolution?.value || normalizedId };
  });
}

/**
 * SA-082..084 identity resolution shared by Next and future Hono callers.
 * Normalization and full candidate-set reads preserve CURRENT semantics.
 * Never accept the result as authorization; perform user/video permission
 * checks, duplicate canonical intent rejection and rejected-X preflight.
 */
export async function canonicalizePermissionIntents(
  db: ServerCoreDb,
  input: readonly CollaboratorPermissionIntent[],
): Promise<CollaboratorPermissionIntent[]> {
  const normalized = input.map((item) => ({
    ...item,
    x_user_id: normalizeXId(item.x_user_id),
  }));
  const candidates = Array.from(
    new Set(normalized.map((item) => item.x_user_id).filter(Boolean)),
  );
  if (candidates.length === 0) return normalized;
  const resolutions = await resolveCanonicalXUserResolutions(db, candidates);
  return canonicalizeResolvedPermissionIntents(normalized, resolutions);
}
