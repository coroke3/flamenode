import { Hono } from "hono";
import type { AppEnv } from "../../../env.ts";
import { personalEntryIndexRoutes } from "./entryIndex.ts";
import { personalEntrySlottedRoutes } from "./slotted.ts";
import { personalEntryUnslottedRoutes } from "./unslotted.ts";

// MIG-0623: Entry read APIs, mounted under /api/personal/entry by ../index.ts (which applies sessionMiddleware,
// requireAuth, `Cache-Control: private, no-store` on every response and the 503 error handler).
export const personalEntryRoutes = new Hono<AppEnv>();
personalEntryRoutes.route("/", personalEntryIndexRoutes);
personalEntryRoutes.route("/slotted", personalEntrySlottedRoutes);
personalEntryRoutes.route("/unslotted", personalEntryUnslottedRoutes);
