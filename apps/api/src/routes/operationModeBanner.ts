import { Hono } from "hono";
import { CostGuardBannerResponseSchema, boundedCostGuardBannerReason } from "@flamenode/contracts";
import type { AppEnv } from "../env.ts";
import {
  readOperationModeKvMirror,
  resolvePublicOperationMode,
} from "./live/operationMode.ts";

const NO_STORE = { "Cache-Control": "no-store" } as const;

/**
 * MIG-0661 U01: CURRENT public CostGuardBanner reads env / isolate / KV,
 * never D1 or session. A missing/malformed mirror has no explanatory reason.
 */
export const operationModeBannerRoutes = new Hono<AppEnv>();

operationModeBannerRoutes.get("/", async (c) => {
  const mode = await resolvePublicOperationMode(c.env, { allowD1: false });
  if (mode === "normal") {
    return c.json(CostGuardBannerResponseSchema.parse({ mode: "normal", reason: null }), 200, NO_STORE);
  }

  // Reuse the same 30s mirror as the mode resolver. A forced mode still
  // performs one bounded KV read for the optional reason (CURRENT parity).
  const reason = boundedCostGuardBannerReason(
    (await readOperationModeKvMirror(c.env.KV))?.reason,
  );
  return c.json(CostGuardBannerResponseSchema.parse({ mode, reason }), 200, NO_STORE);
});
