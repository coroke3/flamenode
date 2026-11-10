/**
 * MIG-0603 U02a: Hono adapter for the shared video visibility mutation core.
 *
 * The adapter keeps the CURRENT R2 fence / atomic audit / compensation order,
 * but deliberately omits Queue wake sources (D-13-41 / D-0603-1). The durable
 * outbox rows are committed in the same D1 batch and the recovery cron drains
 * them; this module never sends a notification or static-rebuild wake.
 */
import type { Context } from "hono";
import { eq } from "drizzle-orm";
import { videos } from "@flamenode/db/schema";
import {
  AuditMutationError,
  mutateWithAudit,
} from "@flamenode/server-core/audit/mutate";
import type { PreloadedAuditContext } from "@flamenode/server-core/audit/logger";
import type { ServerCoreDb } from "@flamenode/server-core/db";
import {
  createTraceId,
} from "@flamenode/server-core/observability/flowTrace";
import {
  compensateDepublicizationFenceOnD1Failure,
  preCommitVideoVisibilityDepublicization,
  type VideoVisibilityTransitionHost,
} from "@flamenode/server-core/visibility/videoTransition";
import {
  executeVideoVisibilityStatusMutation,
  type VideoVisibilityStatusMutationHost,
} from "@flamenode/server-core/video/visibilityStatusMutation";
import { createVideoVisibilityTransitionHost } from "./videoTransitionHost.ts";
import type { AppEnv } from "../env.ts";

type AuditContext = Pick<
  Context<AppEnv>,
  "get"
>;

/** Test seam for asserting the atomic audit payload without executing D1. */
export type VideoStatusMutationHostOptions = {
  mutateWithAudit?: typeof mutateWithAudit;
  createTraceId?: typeof createTraceId;
};

function preloadedAuditContext(c: AuditContext): PreloadedAuditContext {
  return {
    settings: c.get("auditSettings"),
    actorSnapshotJsonById: c.get("actorSnapshotJsonById"),
  };
}

function isVisibilityPrecommitFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("public_visibility_fence") ||
    message.includes("public_visibility_manifest")
  );
}

function markPendingPublicReflection<T extends { ok: boolean }>(
  result: T,
  enqueued: boolean,
): T & { pendingPublicReflection?: boolean } {
  if (!result.ok || !enqueued) return result;
  return { ...result, pendingPublicReflection: true };
}

export function createVideoVisibilityStatusMutationHost(
  c: AuditContext & Pick<Context<AppEnv>, "env">,
  options: VideoStatusMutationHostOptions = {},
): VideoVisibilityStatusMutationHost<ServerCoreDb> {
  const transitionHost: VideoVisibilityTransitionHost =
    createVideoVisibilityTransitionHost(c);
  const runMutation = options.mutateWithAudit ?? mutateWithAudit;

  return {
    createTraceId: options.createTraceId ?? createTraceId,
    preCommit: (input) =>
      preCommitVideoVisibilityDepublicization(input, transitionHost),
    mutate: (db, payload) =>
      runMutation(db, {
        mutationStatements: payload.mutationStatements,
        expectedMutationChanges: payload.expectedMutationChanges,
        audits: payload.audits,
        // Intentionally no notificationWakeSource/staticRebuildWakeSource.
        // D1 outbox rows remain durable and are drained by recovery cron.
        preloaded: preloadedAuditContext(c),
      }),
    compensate: (db, input) =>
      compensateDepublicizationFenceOnD1Failure(db, input, transitionHost),
    rethrowFrameworkControl: () => undefined,
    isAuditMutationError: (error) => error instanceof AuditMutationError,
    rereadStatus: async (db, videoId) => {
      const row = (
        await db
          .select({ visibility_status: videos.visibility_status })
          .from(videos)
          .where(eq(videos.id, videoId))
          .limit(1)
      )[0];
      return row?.visibility_status;
    },
    isVisibilityPrecommitFailure,
    markPendingPublicReflection,
    log: (level, tag, details) => console[level](tag, details),
  };
}

export function executeHonoVideoVisibilityStatusMutation(
  input: Parameters<typeof executeVideoVisibilityStatusMutation<ServerCoreDb>>[0],
  host: VideoVisibilityStatusMutationHost<ServerCoreDb>,
) {
  return executeVideoVisibilityStatusMutation(input, host);
}
