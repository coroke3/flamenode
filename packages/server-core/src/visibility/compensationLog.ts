import type { PublicVisibilityFenceEntityType } from "./manifestCore.ts";

// Only stable, internally defined codes may leave a failed visibility
// compensation as a diagnostic. Provider messages can contain credentials,
// SQL or paths; truncating them would not make those values safe.
const SAFE_COMPENSATION_CODES = new Set([
  "r2_cas_failed",
  "public_visibility_fence_token_mismatch",
]);

function errorCode(error: unknown): string {
  try {
    // Both instanceof (hostile Proxy) and Error.message (accessor) can throw.
    if (error instanceof Error) {
      const message: unknown = error.message;
      if (typeof message === "string" && SAFE_COMPENSATION_CODES.has(message)) {
        return message;
      }
    }
  } catch {
    // A diagnostic failure must not interrupt the fail-closed fence recovery.
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
  try {
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
  } catch {
    // Logging is best-effort. Never turn a stuck-fence diagnostic into a
    // second failure that can bypass the compensator's fail-closed return.
  }
}
