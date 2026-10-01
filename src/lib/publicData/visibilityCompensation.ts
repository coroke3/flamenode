import type { PublicVisibilityFenceEntityType } from "./publicVisibilityManifestCore";

function errorCode(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message.slice(0, 160);
  }
  return "visibility_compensation_failed";
}

/**
 * A failed compensation must leave the R2 block in place (fail closed), but
 * it must also be visible to operators and deep-health repair tooling. Tokens
 * are logged only as correlation values; the logger never removes a mismatch.
 */
export function logStuckPublicVisibilityFenceCandidate(input: {
  flow: string;
  entityType: PublicVisibilityFenceEntityType;
  entityId: string;
  fenceToken: string;
  error: unknown;
  attempts?: number;
}): void {
  console.warn(
    JSON.stringify({
      service: "visibility_fence",
      flow: input.flow,
      phase: "stuck_fence_candidate",
      entity_type: input.entityType,
      entity_id: input.entityId,
      fence_token: input.fenceToken,
      attempt_count: input.attempts ?? 3,
      error_code: errorCode(input.error),
    }),
  );
}
