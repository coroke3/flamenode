/**
 * MIG-0617 L2: the drizzle handle every server-core call receives, built once per write
 * request after writeGuard passed (reads and denied requests never pay for it). Routes read it
 * with c.get("db"); they never import drizzle-orm or @flamenode/db themselves
 * (scripts/check-server-core-boundaries.mjs).
 */
import * as schema from "@flamenode/db/schema";
import { drizzle } from "drizzle-orm/d1";
import type { Context, Next } from "hono";
import { writeGuardDenyResponse } from "./writeOrigin.ts";
import type { AppEnv } from "../env.ts";
import type { ServerCoreDb } from "@flamenode/server-core/db";

export async function dbMiddleware(c: Context<AppEnv>, next: Next): Promise<void | Response> {
  // A prior write guard may have successfully read DB, but the binding may fail
  // when the drizzle handle is constructed. Never leak a provider exception or
  // allow the write handler to run in that case.
  try {
    const binding = (c.env as { DB?: D1Database } | undefined)?.DB;
    if (!binding) return writeGuardDenyResponse(c, "db_unavailable", 503);
    c.set("db", drizzle(binding, { schema }));
  } catch {
    return writeGuardDenyResponse(c, "db_unavailable", 503);
  }
  await next();
}

/**
 * MIG-0650 U03cr: separate write-capable D1 handle for the UNMOUNTED SA-085
 * atomic candidate. Only call AFTER authenticated read-only preflight,
 * canonical planning and read-meter sealing. Do not make it available to the
 * planning middleware or cache it across invocations.
 *
 * The caller deliberately supplies the RAW provider DB rather than a metered
 * SELECT facade; this handle may execute the final audited atomic batch.
 */
export function createAdminMemberAtomicWriteDb(binding: D1Database): ServerCoreDb {
  if (!binding || typeof binding.prepare !== "function" ||
      typeof binding.batch !== "function") {
    throw new RangeError("video_admin_member_atomic_write_db_unavailable");
  }
  return drizzle(binding, { schema });
}
