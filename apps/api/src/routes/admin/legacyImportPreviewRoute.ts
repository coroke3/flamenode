/**
 * MIG-0645 U02: protected-parent-only, UNMOUNTED preview HTTP boundary.
 *
 * The host MUST execute origin -> session -> admin write identity -> dbMiddleware
 * before mounting this router. It deliberately does not expose an apply endpoint.
 * Never add this router to createAdminRoutes until the audited D1 apply path,
 * workerd/R2 acceptance and independent security review are complete.
 */
import { Hono } from "hono";
import type { AppEnv } from "../../env.ts";
import { costGuardMiddleware } from "../../middleware/costGuard.ts";
import { onlyMutating } from "../../middleware/writeOrigin.ts";
import { legacyImportD1PreflightAdapter } from "./legacyImportD1PreflightAdapter.ts";
import { runLegacyImportPreviewPipeline } from "./legacyImportPreviewPipeline.ts";
import { legacyImportR2Adapter } from "./legacyImportR2Adapter.ts";

export const legacyImportPreviewRoutes = new Hono<AppEnv>();
legacyImportPreviewRoutes.use("*", onlyMutating(costGuardMiddleware("admin_legacy_import")));

legacyImportPreviewRoutes.onError((_cause, c) => {
  c.header("Cache-Control", "private, no-store");
  return c.json({ ok: false, message: "旧形式インポートのプレビューを処理できませんでした。" }, 503);
});

legacyImportPreviewRoutes.post("/", async (c) => {
  c.header("Cache-Control", "private, no-store");

  // Defense in depth: a bare/unprotected test mount must never gain privileges.
  // Origin/session/writeGuard/db are still mandatory in the host.
  const user = c.get("user");
  if (!user || user.role !== "admin" || !c.get("db")) {
    return c.json({ ok: false, message: "forbidden" }, 403);
  }

  const formData = await c.req.raw.formData().catch(() => null);
  if (!formData) {
    return c.json({ ok: false, message: "multipart/form-data を読み取れませんでした。" }, 400);
  }
  if (formData.get("mode") === "apply") {
    // A preview-only host cannot execute a D1 write. Fail closed.
    return c.json({
      ok: false, message: "旧形式インポートの確定操作はまだ利用できません。",
      requires_repreview: false,
    }, 409);
  }
  const files = formData.getAll("files").filter((value): value is File =>
    typeof value !== "string" && typeof value.text === "function" &&
    typeof value.size === "number");
  const d1 = legacyImportD1PreflightAdapter(c.get("db"));
  const r2 = legacyImportR2Adapter(c.env.BUCKET);
  const response = await runLegacyImportPreviewPipeline({
    formData,
    files,
    authUserId: user.id,
    preflight: d1.preflight,
    createPreview: r2.createPreview,
    mapStoreError: r2.mapStoreError,
  });
  return c.json(response.body, response.status);
});
