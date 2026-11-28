import { unstable_rethrow } from "next/navigation";
import { eq } from "drizzle-orm";
import { AuditMutationError, mutateWithAudit } from "@/lib/audit/mutate";
import type { DB } from "@/lib/db/client";
import { videos } from "@/lib/db/schema";
import { createTraceId } from "@/lib/observability/flowTrace";
import { nextVisibilityManifestHost } from "@/lib/publicData/visibilityManifestHost";
import { markPendingPublicReflection } from "@/lib/staticRebuild/publicReflectionNotice";
import type { PendingPublicReflection } from "@/lib/staticRebuild/publicReflectionNotice";
import {
  compensateDepublicizationFenceOnD1Failure,
  preCommitVideoVisibilityDepublicization,
  type VideoVisibilityTransitionPlan,
} from "@/lib/video/videoVisibilityTransition";
import {
  executeVideoVisibilityStatusMutation as executeVideoVisibilityStatusMutationCore,
  type ExecuteVideoVisibilityStatusMutationInput,
  type VideoVisibilityStatusMutationHost,
  type VideoStatusActionResult,
} from "@flamenode/server-core/video/visibilityStatusMutation";

const VISIBILITY_PRECOMMIT_ERROR_MARKERS = [
  "public_visibility_fence",
  "public_visibility_manifest",
] as const;

function isVisibilityPrecommitFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return VISIBILITY_PRECOMMIT_ERROR_MARKERS.some((marker) =>
    message.includes(marker),
  );
}

// Pinned Next 15.5.x recognizes digest, message and $$typeof, and follows
// Error.cause. Inspect descriptors rather than invoking provider getters.
const MAX_FRAMEWORK_CAUSE_DEPTH = 64;
const MAX_FRAMEWORK_PROTOTYPE_DEPTH = 16;

function readFrameworkData(error: object, key: string): unknown {
  if (!Reflect.has(error, key)) return undefined;
  let cursor: object | null = error;
  for (let depth = 0; cursor !== null && depth < MAX_FRAMEWORK_PROTOTYPE_DEPTH; depth += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(cursor, key);
    if (descriptor) {
      if (!Object.hasOwn(descriptor, "value")) throw new Error("framework_metadata_unavailable");
      return descriptor.value;
    }
    cursor = Object.getPrototypeOf(cursor);
  }
  throw new Error("framework_metadata_unavailable");
}

function hasErrorPrototype(error: object): boolean {
  let cursor: object | null = error;
  for (let depth = 0; depth < MAX_FRAMEWORK_PROTOTYPE_DEPTH; depth += 1) {
    cursor = Object.getPrototypeOf(cursor);
    if (cursor === null) return false;
    if (cursor === Error.prototype) return true;
  }
  throw new Error("framework_metadata_unavailable");
}

function rethrowVideoStatusFrameworkControl(error: unknown): void | "unavailable" {
  const seen = new Set<object>();
  for (let depth = 0; typeof error === "object" && error !== null; depth += 1) {
    if (depth >= MAX_FRAMEWORK_CAUSE_DEPTH || seen.has(error)) return "unavailable";
    seen.add(error);

    let metadata: { digest: unknown; message: unknown; $$typeof: unknown };
    try {
      const digest = readFrameworkData(error, "digest");
      const message = readFrameworkData(error, "message");
      const marker = readFrameworkData(error, "$$typeof");
      metadata = {
        digest: typeof digest === "string" ? digest : undefined,
        message: typeof message === "string" ? message : undefined,
        $$typeof: typeof marker === "symbol" ? marker : undefined,
      };
    } catch {
      return "unavailable";
    }

    try {
      unstable_rethrow(metadata);
    } catch (controlFlow) {
      // Next throws the object it recognizes. Only that exact projection
      // certifies a signal; propagate the original direct/nested identity.
      if (controlFlow === metadata) throw error;
      return "unavailable";
    }

    try {
      if (!hasErrorPrototype(error)) return;
      error = readFrameworkData(error, "cause");
    } catch {
      return "unavailable";
    }
  }
}

export type { VideoStatusActionResult };
export type ExecuteMutationInput = ExecuteVideoVisibilityStatusMutationInput<DB> & {
  transition: VideoVisibilityTransitionPlan;
};
export type { PendingPublicReflection };

export {
  SAME_VIDEO_STATUS_MESSAGE,
  loadVideoRebuildEventIds,
  mergeVideoRebuildEventIds,
  monotonicVideoUpdatedAt,
} from "@/lib/video/videoVisibilityStatusCore";

const mutationHost: VideoVisibilityStatusMutationHost<DB> = {
  createTraceId,
  preCommit: preCommitVideoVisibilityDepublicization,
  mutate: (db, mutation) => mutateWithAudit(db, mutation),
  compensate: compensateDepublicizationFenceOnD1Failure,
  confirmCompensation: async (videoId) => {
    // CURRENT must enforce the same readback as TARGET: an exhausted R2 CAS
    // compensator can report only a warning and resolve without throwing.
    const { manifest, etag } = await nextVisibilityManifestHost.read();
    return typeof etag === "string" && etag.length > 0 &&
      !manifest.entities.some((entry) =>
        entry.entity_type === "video" && entry.entity_id === videoId);
  },
  rethrowFrameworkControl: rethrowVideoStatusFrameworkControl,
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

export function executeVideoVisibilityStatusMutation(
  input: ExecuteMutationInput,
): Promise<VideoStatusActionResult> {
  return executeVideoVisibilityStatusMutationCore(input, mutationHost);
}
