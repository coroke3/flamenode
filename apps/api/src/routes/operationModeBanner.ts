import { Hono } from "hono";
import type { AppEnv } from "../env.ts";
import {
  OPERATION_MODE_KV_KEY,
  parseKvMirror,
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
    return c.json({ mode: "normal", reason: null }, 200, NO_STORE);
  }

  let reason: string | null = null;
  if (c.env.KV) {
    try {
      const raw = await c.env.KV.get(OPERATION_MODE_KV_KEY, { cacheTtl: 30 });
      reason = parseKvMirror(typeof raw === "string" ? raw : null)?.reason ?? null;
    } catch {
      // CURRENT readOperationModeKvMirror treats unavailable KV as no reason.
    }
  }
  return c.json({ mode, reason }, 200, NO_STORE);
});
