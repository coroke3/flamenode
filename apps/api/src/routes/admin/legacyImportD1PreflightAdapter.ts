import type { ServerCoreDb } from "@flamenode/server-core/db";
import { preflightLegacyImportPlan } from "@flamenode/server-core/legacyImport/preflight";

/**
 * MIG-0645: actual D1 read-only preflight boundary for guarded Hono import.
 * The host constructs the Drizzle DB only after origin/session/admin-write
 * and CostGuard; this module does not accept a raw D1 binding or create one.
 * Apply transactions and audit inserts are still handled separately.
 */
export function legacyImportD1PreflightAdapter(db: ServerCoreDb) {
  return {
    preflight: (plan: Parameters<typeof preflightLegacyImportPlan>[1],
      strategy: Parameters<typeof preflightLegacyImportPlan>[2]) =>
      preflightLegacyImportPlan(db, plan, strategy),
  };
}
