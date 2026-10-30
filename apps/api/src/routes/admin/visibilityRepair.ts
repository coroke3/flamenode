/**
 * MIG-0643 U03 SA-050: strict D1-fence + R2-token visibility repair.
 * NOT MOUNTED: admin router currently owned by PR #472.
 * The only R2 operations in this module are against c.env.BUCKET; tests use
 * an in-memory fake bucket. This PR never executes against production R2.
 */
import { Hono } from "hono";
import { normalizeXId } from "@flamenode/domain/xid";
import { AdminVisibilityRepairBodySchema } from "@flamenode/contracts/admin/staticRebuildOps";
import { releaseBlockedEntityInManifest } from "@flamenode/server-core/visibility/manifestCore";
import {
  putVisibilityManifestWithCas,
  readVisibilityManifestObject,
  type VisibilityManifestBucket,
} from "@flamenode/server-core/visibility/manifestR2";
import type { AppEnv } from "../../env.ts";
import { BODY_TOO_LARGE_MESSAGE, readAdminJsonBody } from "./body.ts";
import { costGuardMiddleware } from "../../middleware/costGuard.ts";
import { onlyMutating } from "../../middleware/writeOrigin.ts";

type RepairResult = "invalid_input" | "d1_fence_present" | "manifest_token_not_found" | "repaired" | "failed";
export const visibilityRepairAdminRoutes = new Hono<AppEnv>();
visibilityRepairAdminRoutes.use("*", onlyMutating(costGuardMiddleware("admin_static_rebuild")));

visibilityRepairAdminRoutes.post("/", async (c) => {
  c.header("Cache-Control", "private, no-store");
  const raw = await readAdminJsonBody(c.req.raw);
  if (raw.kind === "too_large") return c.json({ visibility_repair: "invalid_input", message: BODY_TOO_LARGE_MESSAGE }, 413);
  const parsed = raw.kind === "ok" ? AdminVisibilityRepairBodySchema.safeParse(raw.value) : null;
  if (!parsed?.success) return c.json({ visibility_repair: "invalid_input" }, 400);
  const entityType = parsed.data.entity_type;
  const entityId = entityType === "x_user"
    ? normalizeXId(parsed.data.entity_id)
    : parsed.data.entity_id;
  const token = parsed.data.fence_token;
  if (!entityId || entityId.length > 128) return c.json({ visibility_repair: "invalid_input" }, 400);

  let outcome: RepairResult;
  try {
    const currentFence = await c.env.DB.prepare(`
      SELECT fence_token, state FROM public_visibility_fences
      WHERE entity_type = ? AND entity_id = ? LIMIT 1
    `).bind(entityType, entityId).first<{ fence_token: string; state: string }>();

    // CURRENT: a live D1 fence is authoritative. Only a released fence with
    // the exact submitted token is eligible for R2 remediation.
    if (currentFence &&
      (currentFence.state !== "released" || currentFence.fence_token !== token)) {
      outcome = "d1_fence_present";
    } else {
      const rawBucket = c.env.BUCKET;
      if (!rawBucket) throw new Error("public_visibility_manifest_bucket_missing");
      const bucket = rawBucket as unknown as VisibilityManifestBucket;
      const { manifest, etag } = await readVisibilityManifestObject(bucket);
      const released = releaseBlockedEntityInManifest(
        manifest, entityType, entityId, token, Math.floor(Date.now() / 1000),
      );
      if (!released) {
        outcome = "manifest_token_not_found";
      } else {
        await putVisibilityManifestWithCas(bucket, released, etag, (latest) => {
          const retry = releaseBlockedEntityInManifest(
            latest, entityType, entityId, token, Math.floor(Date.now() / 1000),
          );
          if (!retry) throw new Error("public_visibility_repair_token_conflict");
          return retry;
        });
        outcome = "repaired";
        console.warn(JSON.stringify({
          service: "visibility_fence",
          flow: "admin_visibility_repair",
          result: "released_dangling_manifest_entry",
          // Fence tokens are CAS capabilities; never emit them in telemetry.
          entity_type: entityType, entity_id: entityId,
          actor_user_id: c.get("user")!.id,
        }));
      }
    }
  } catch {
    // Never include fence token, a bucket error payload, or R2 credentials
    // in the failure telemetry returned to the caller.
    console.error(JSON.stringify({
      service: "visibility_fence", flow: "admin_visibility_repair",
      result: "failed", entity_type: entityType, entity_id: entityId,
      error_code: "public_visibility_repair_failed",
    }));
    outcome = "failed";
  }

  // D-17-5: UI navigates to the same CURRENT query key and re-fetches.
  return c.json({ visibility_repair: outcome }, outcome === "failed" ? 500 : 200);
});
