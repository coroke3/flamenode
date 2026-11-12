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
import { costGuardMiddleware } from "../../middleware/costGuard.ts";
import { onlyMutating } from "../../middleware/writeOrigin.ts";
import { runLegacyImportApplyPipeline } from "./legacyImportApplyPipeline.ts";
import { legacyImportR2Adapter } from "./legacyImportR2Adapter.ts";

type AtomicD1Step = Parameters<typeof runLegacyImportApplyPipeline<LegacyImportApplyProgress>>[0]["applyStep"];

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
    if (!user || user.role !== "admin" || !c.get("db")) {
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
      applyStep,
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
