/**
 * MIG-0617 L2: the drizzle handle every server-core call receives, built once per write
 * request after writeGuard passed (reads and denied requests never pay for it). Routes read it
 * with c.get("db"); they never import drizzle-orm or @flamenode/db themselves
 * (scripts/check-server-core-boundaries.mjs).
 */
import * as schema from "@flamenode/db/schema";
import { drizzle } from "drizzle-orm/d1";
import type { Context, Next } from "hono";
import type { AppEnv } from "../env.ts";

export async function dbMiddleware(c: Context<AppEnv>, next: Next): Promise<void> {
  c.set("db", drizzle(c.env.DB, { schema }));
  await next();
}
