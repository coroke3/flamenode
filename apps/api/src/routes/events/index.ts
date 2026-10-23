/**
 * MIG-0604 admin-only event routes, mounted at /api/admin AFTER
 * createAdminRoutes() in app.ts. They deliberately do not re-register
 * session / writeGuard: the MIG-0602 admin app registers them on
 * "/api/admin/*" (session -> writeGuard), which also covers these paths, so
 * the guard (and its D1 TOS read) runs exactly once. Registration order is
 * the safety property and is contract-tested (unauthenticated -> 401).
 * Event staff/owner (non-admin) routes are not mounted here: they need a
 * role-parameterised write guard (work item blockers).
 */
import { Hono } from "hono";
import type { AppEnv } from "../../env.ts";
import { eventTemplateRoutes } from "./templates.ts";

export const adminEventRoutes = new Hono<AppEnv>();
adminEventRoutes.route("/event-templates", eventTemplateRoutes);
