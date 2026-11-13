/**
 * MIG-0802 U01 synthetic Hono/Auth.js test router.
 * DO NOT mount in app.ts, Worker routes, or production gateways.
 *
 * Deliberately limited HTTP surface. GET /session can slide expiry,
 * GET /csrf issues a CSRF cookie, and POST /signout uses Auth.js native CSRF
 * verification before revoking the D1 session. No login/OAuth callback routes.
 */
import { Hono } from "hono";
import {
  buildUnmountedAuthConfig,
  invokeUnmountedAuth,
  type UnmountedAuthInputs,
} from "../auth/authjs.ts";

export function createUnmountedAuthRoutes(input: UnmountedAuthInputs) {
  const router = new Hono();
  for (const action of ["session", "csrf"] as const) {
    router.get(`/api/auth/${action}`, (c) =>
      invokeUnmountedAuth(c.req.raw, buildUnmountedAuthConfig(input)),
    );
  }
  // U02b: Auth.js enforces CSRF cookie+POST token. Keep GET /signout,
  // signin and callback unavailable until the full reviewed cutover.
  router.post("/api/auth/signout", (c) =>
    invokeUnmountedAuth(c.req.raw, buildUnmountedAuthConfig(input)),
  );
  return router;
}
