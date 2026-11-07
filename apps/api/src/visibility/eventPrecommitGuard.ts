/**
 * MIG-0652 U02 — Event visibility precommit / D1 mutation boundary for Hono.
 *
 * CURRENT: src/lib/actions/event-admin.ts#updateEvent and #deleteEvent.
 * This helper never reads D1, calls a Queue, or performs post-commit effects.
 * A caller MUST supply its audited, atomic D1 mutation in \`commit\`, and its
 * existing D1-aware fence compensation in \`compensateOnFailure\`.
 */
import type { VisibilityFenceHost } from "@flamenode/server-core/visibility/manifestHost";
import { preCommitEventVisibilityTransition } from "@flamenode/server-core/visibility/eventTransition";

/**
 * Guarantee a committed visibility-changing event write never starts before
 * the R2 block is acknowledged and independently re-read by server-core.
 *
 * If the R2 precommit or the D1 transaction fails, attempt CURRENT's
 * D1-aware compensation. Compensation is intentionally best-effort: even
 * a failed rollback must NOT hide the actual failure from the request handler.
 * A null fence token is a no-op boundary (same-status update / safe create).
 */
export async function runEventWriteBehindVisibilityFence<T>(args: {
  eventId: string;
  fenceToken: string | null;
  reason?: string | null;
  visibilityHost: VisibilityFenceHost;
  commit: () => Promise<T>;
  compensateOnFailure: () => Promise<void>;
}): Promise<T> {
  if (!args.fenceToken) {
    return args.commit();
  }

  const compensateBestEffort = async (): Promise<void> => {
    try {
      await args.compensateOnFailure();
    } catch {
      // Never log provider messages, credentials or the user-supplied event ID.
      console.warn("[MIG-0652] event visibility compensation failed");
    }
  };

  try {
    await preCommitEventVisibilityTransition(
      {
        eventId: args.eventId,
        fenceToken: args.fenceToken,
        reason: args.reason ?? null,
      },
      args.visibilityHost,
    );
  } catch (error) {
    // A PUT may have succeeded before its verification read failed.
    await compensateBestEffort();
    throw error;
  }

  try {
    return await args.commit();
  } catch (error) {
    await compensateBestEffort();
    throw error;
  }
}
