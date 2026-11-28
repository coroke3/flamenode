/**
 * MIG-0645 U02: UNMOUNTED apply HTTP boundary for independently reviewed D1 step adapters.
 *
 * Only the authenticated, same-origin, admin-write parent may mount this route.
 * The caller MUST inject a D1 operation which atomically commits the import
 * mutation, step marker and audit logs and recovers already-committed steps.
 * DO NOT register this route in createAdminRoutes before workerd/R2 acceptance.
 */
import { Hono } from "hono";
import { isTransientDbError } from "@flamenode/domain/db/transientError";
import {
  LegacyImportPreviewError,
  type LegacyImportApplyProgress,
} from "@flamenode/server-core/legacyImport/previewStore";
import type { AppEnv } from "../../env.ts";
import type { PreloadedAuditContext } from "@flamenode/server-core/audit/logger";
import type { EnvValues, QueueWakeHostLoader } from "@flamenode/server-core/ports";
import type { VisibilityFenceHost } from "@flamenode/server-core/visibility/manifestHost";
import {
  upsertBlockedEntityInManifest,
  type PublicVisibilityBlockedEntitiesManifest,
} from "@flamenode/server-core/visibility/manifestCore";
import {
  readVisibilityManifestObject,
  putVisibilityManifestWithCas,
  type VisibilityManifestBucket,
} from "@flamenode/server-core/visibility/manifestR2";
import {
  deletePublicJsonCaches,
  type PublicJsonCacheDeleteHost,
} from "@flamenode/server-core/publicCache/delete";
import {
  EVENT_EXPORT_REFRESH_MINUTES,
  eventExportPayloadCacheKey,
} from "@flamenode/server-core/publicCache/eventExportKeys";
import {
  eventBaseObjectKey,
  eventSlotsObjectKey,
  eventComposedObjectKey,
  eventReleaseObjectKey,
} from "@flamenode/server-core/publicData/eventDetailCore";
import { costGuardMiddleware } from "../../middleware/costGuard.ts";
import { onlyMutating } from "../../middleware/writeOrigin.ts";
import { runLegacyImportApplyPipeline } from "./legacyImportApplyPipeline.ts";
import { legacyImportR2Adapter } from "./legacyImportR2Adapter.ts";

type PipelineStep = Parameters<typeof runLegacyImportApplyPipeline<LegacyImportApplyProgress>>[0]["applyStep"];
type AtomicD1Step = (input: Parameters<PipelineStep>[0] & {
  db: AppEnv["Variables"]["db"];
  preloaded: PreloadedAuditContext;
  loadWakeHost: QueueWakeHostLoader;
  eventEffects: ReturnType<typeof createLegacyImportEventEffects>;
}) => ReturnType<PipelineStep>;

/**
 * U02aq: import-local precommit for event/video visibility fences.
 * Unlike a general transition helper, an import cannot assume ownership of an
 * existing manifest token. Fail closed on initial read, CAS retry, and
 * confirmation; preserve an identical token's original blocked_at/reason.
 * This helper alone does not authorize any D1 transition or compensation.
 */
export async function precommitLegacyImportVisibilityFence(input: {
  entityType: "event" | "video";
  entityId: string;
  fenceToken: string;
  reason?: string | null;
}, host: VisibilityFenceHost): Promise<void> {
  if (!input.entityId || !input.fenceToken) {
    throw new Error("public_visibility_fence_token_mismatch");
  }
  function ownedEntry(manifest: PublicVisibilityBlockedEntitiesManifest) {
    const entries = manifest.entities.filter((entry) =>
      entry.entity_type === input.entityType && entry.entity_id === input.entityId);
    if (entries.length > 1 ||
        entries.some((entry) => entry.fence_token !== input.fenceToken)) {
      throw new Error("public_visibility_fence_token_mismatch");
    }
    return entries[0] ?? null;
  }
  function addIfAbsent(manifest: PublicVisibilityBlockedEntitiesManifest) {
    if (ownedEntry(manifest)) return manifest;
    const now = Math.floor(Date.now() / 1000);
    return upsertBlockedEntityInManifest(manifest, {
      entity_type: input.entityType,
      entity_id: input.entityId,
      fence_token: input.fenceToken,
      blocked_at: now,
      reason: input.reason ?? null,
    }, now);
  }
  const { manifest, etag } = await host.manifest.read();
  if (ownedEntry(manifest)) return;
  await host.manifest.write(addIfAbsent(manifest), {
    ifMatchEtag: etag,
    mutateOnConflict: addIfAbsent,
  });
  const { manifest: confirmed } = await host.manifest.read();
  if (!ownedEntry(confirmed)) {
    throw new Error("public_visibility_fence_token_mismatch");
  }
}

/** Unmounted RH-002 event replacement effects. Constructing the host is I/O-free. */
export function createLegacyImportEventEffects(
  bucket: VisibilityManifestBucket | null | undefined,
  readEdgeCache: PublicJsonCacheDeleteHost["readEdgeCache"] =
    () => (caches as unknown as { default: Cache }).default,
) {
  function requireBucket(): VisibilityManifestBucket {
    if (!bucket) throw new Error("public_visibility_manifest_bucket_missing");
    return bucket;
  }
  const fenceHost: VisibilityFenceHost = {
    manifest: {
      read: async () => readVisibilityManifestObject(requireBucket()),
      write: async (manifest, options) => {
        const hasConditionalOption =
          options && Object.prototype.hasOwnProperty.call(options, "ifMatchEtag");
        await putVisibilityManifestWithCas(
          requireBucket(),
          manifest,
          hasConditionalOption ? options?.ifMatchEtag ?? null : undefined,
          options?.mutateOnConflict,
        );
      },
    },
  };
  const cacheHost: PublicJsonCacheDeleteHost = {
    // No Next isolate-local cache map exists in this Hono host.
    // Cache API deletes are local-colo best effort.
    dropIsolateEntry: () => {},
    readEdgeCache,
  };
  return {
    fenceHost,
    invalidateEventCaches: async (eventId: string) => {
      const exportKeys = (["v5", "legacy"] as const).flatMap((format) =>
        EVENT_EXPORT_REFRESH_MINUTES.map((refreshMinutes) =>
          eventExportPayloadCacheKey(eventId, format, refreshMinutes),
        ),
      );
      await deletePublicJsonCaches([
        eventComposedObjectKey(eventId),
        eventBaseObjectKey(eventId),
        eventSlotsObjectKey(eventId),
        eventReleaseObjectKey(eventId),
        ...exportKeys,
      ], cacheHost);
    },
  };
}

/**
 * Creates a route only when an audit-atomic D1 step has been provided.
 * Never mount merely to test the R2 claim API without the audit and replay
 * contract. HTTP executes at most one already-verified D1 step per request.
 */
export function createLegacyImportApplyRoutes(applyStep: AtomicD1Step) {
  const router = new Hono<AppEnv>();
  router.use("*", onlyMutating(costGuardMiddleware("admin_legacy_import")));
  router.onError((_cause, c) => {
    c.header("Cache-Control", "private, no-store");
    return c.json({ ok: false, message: "旧形式インポートの確定処理を実行できませんでした。" }, 503);
  });
  router.post("/", async (c) => {
    c.header("Cache-Control", "private, no-store");
    const user = c.get("user");
    const db = c.get("db");
    if (!user || user.role !== "admin" || !db) {
      return c.json({ ok: false, message: "forbidden" }, 403);
    }
    const formData = await c.req.raw.formData().catch(() => null);
    if (!formData) {
      return c.json({ ok: false, message: "multipart/form-data を読み取れませんでした。" }, 400);
    }
    const r2 = legacyImportR2Adapter(c.env.BUCKET);
    const response = await runLegacyImportApplyPipeline<LegacyImportApplyProgress>({
      formData,
      authUserId: user.id,
      claimPreview: r2.claimPreview,
      applyStep: (input) => applyStep({
        ...input,
        db,
        preloaded: {
          settings: c.get("auditSettings"),
          actorSnapshotJsonById: c.get("actorSnapshotJsonById"),
        },
        eventEffects: createLegacyImportEventEffects(c.env.BUCKET),
        loadWakeHost: async () => ({
          readEnv: () => c.env as unknown as EnvValues,
          readWaitUntil: () => {
            try {
              const executionCtx = (c as unknown as {
                executionCtx?: { waitUntil?: (promise: Promise<unknown>) => void };
              }).executionCtx;
              const waitUntil = executionCtx?.waitUntil;
              return typeof waitUntil === "function" ? waitUntil.bind(executionCtx) : null;
            } catch {
              return null;
            }
          },
          readKv: () => c.env.KV ?? null,
        }),
      }),
      mapPreviewError: r2.mapPreviewError,
      isTransientApplyFailure: (cause) =>
        isTransientDbError(cause) ||
        (cause instanceof LegacyImportPreviewError && (
          cause.code === "already_claimed" ||
          cause.code === "bucket_unavailable" ||
          cause.code === "claim_conflict"
        )),
    });
    return c.json(response.body, response.status);
  });
  return router;
}
