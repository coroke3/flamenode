/**
 * MIG-0802 U01 synthetic Hono/Auth.js test router.
 * DO NOT mount in app.ts, Worker routes, or production gateways.
 *
 * Deliberately read-only HTTP surface. Auth.js can slide session expiry when
 * serving GET /session, exactly like CURRENT; no OAuth login or logout here.
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
  return router;
}
