import { Hono } from "hono";
import type { AppEnv } from "../../../env.ts";
import { personalEditPageRoutes } from "./editPage.ts";
import { personalEditFormOptionsRoutes } from "./formOptions.ts";
import { personalEditPermissionsRoutes } from "./permissions.ts";

// MIG-0630: video edit read APIs, mounted under /api/personal/edit by ../index.ts (which applies sessionMiddleware,
// requireAuth, `Cache-Control: private, no-store` on every response and the 503 error handler).
export const personalEditRoutes = new Hono<AppEnv>();
personalEditRoutes.route("/", personalEditPermissionsRoutes);
personalEditRoutes.route("/", personalEditFormOptionsRoutes);
personalEditRoutes.route("/", personalEditPageRoutes);
