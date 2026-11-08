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
