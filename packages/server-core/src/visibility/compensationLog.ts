import type { PublicVisibilityFenceEntityType } from "./manifestCore.ts";

const SAFE_COMPENSATION_ERROR_CODES = new Set([
  "r2_cas_failed",
  "public_visibility_fence_token_mismatch",
  "PreconditionFailed",
]);

function errorCode(error: unknown): string {
  try {
    // Provider getters and Proxy prototype checks are untrusted. Only known,
    // non-sensitive internal error codes may appear in stuck-fence logs.
    if (error instanceof Error) {
      const message: unknown = error.message;
      if (typeof message === "string" && SAFE_COMPENSATION_ERROR_CODES.has(message)) {
        return message;
      }
    }
  } catch {
    // A diagnostic error must not escape visibility compensation.
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
    // Diagnostics are best-effort; leave the R2 visibility block in place.
  }
}
