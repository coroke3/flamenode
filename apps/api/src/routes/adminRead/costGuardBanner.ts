import { Hono } from "hono";
import {
  CostGuardBannerResponseSchema,
  boundedCostGuardBannerReason,
  type CostGuardBannerResponse,
} from "@flamenode/contracts";
import { resolveOperationMode } from "@flamenode/domain/admin";
import type { AppEnv } from "../../env.ts";

/** MIG-0661 U02: existing adminReadRoutes middleware enforces Auth.js session,
 * banned-user rejection, and role=admin before this read-only endpoint.
 * A missing row or D1 exception mirrors CURRENT CostGuardBanner (no banner).
 */
export const adminCostGuardBannerRoutes = new Hono<AppEnv>();

adminCostGuardBannerRoutes.get("/", async (c) => {
  const fallback: CostGuardBannerResponse = { mode: "normal", reason: null };
  try {
    const row = await c.env.DB.prepare(
      "SELECT operation_mode, cost_guard_reason FROM system_settings WHERE id = 'default' LIMIT 1",
    ).first<{ operation_mode: string | null; cost_guard_reason: string | null }>();
    if (!row) return c.json(CostGuardBannerResponseSchema.parse(fallback));
    return c.json(CostGuardBannerResponseSchema.parse({
      mode: resolveOperationMode(row),
      reason: boundedCostGuardBannerReason(row.cost_guard_reason),
    }));
  } catch {
    // Do not leak D1 error messages, schema details or raw setting values.
    return c.json(CostGuardBannerResponseSchema.parse(fallback));
  }
});
