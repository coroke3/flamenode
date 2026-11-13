/**
 * MIG-0802 U03a: standalone test-only /auth/complete landing.
 * DO NOT mount in apps/api/src/app.ts or a production Worker Route.
 * This verifies the safe transition and retry outcomes, not OAuth issuance.
 */
import { Hono } from "hono";
import {
  buildUnmountedAuthConfig,
  invokeUnmountedAuth,
  type UnmountedAuthInputs,
} from "../auth/authjs.ts";
import {
  resolveUnmountedAuthCompleteSession,
  unmountedAuthCompleteDestination,
  type CompleteSession,
  type CompleteWait,
} from "../auth/complete.ts";

export function createUnmountedAuthCompleteRoutes(
  input: UnmountedAuthInputs,
  wait?: CompleteWait,
) {
  const router = new Hono();
  router.get("/auth/complete", async (c) => {
    // Rebuild session request against explicit configured auth origin only;
    // arbitrary Host/X-Forwarded-Host headers are never trusted.
    const sessionCookie = c.req.raw.headers.get("cookie");
    // Auth.js can extend a database session on GET /session. Its Set-Cookie
    // must reach the browser or the DB and client expirations can diverge.
    // Only the last successfully parsed session response may set this value.
    let sessionSetCookies: string[] = [];
    const result = await resolveUnmountedAuthCompleteSession<CompleteSession>(
      async () => {
        const config = buildUnmountedAuthConfig(input);
        const url = new URL("/api/auth/session", input.authOrigin);
        const headers = new Headers();
        if (sessionCookie) headers.set("cookie", sessionCookie);
        const response = await invokeUnmountedAuth(new Request(url, { headers }), config);
        if (!response.ok) throw new Error("AUTH_COMPLETE_SESSION_READ_UNAVAILABLE");
        const session = await response.json() as CompleteSession | null;
        sessionSetCookies = response.headers.getSetCookie();
        return session;
      },
      wait,
    );
    const next = new URL(c.req.url).searchParams.get("next");
    // Use 303 for the test-only navigation; CURRENT Next page handles its own
    // redirect status, which requires an additional final HTTP-level audit.
    // This redirect depends on private session state. Never let an intermediary
    // reuse one visitor's destination (including a banned/login-state result)
    // for another visitor or a later authentication state.
    const response = c.redirect(unmountedAuthCompleteDestination(result, next), 303);
    response.headers.set("Cache-Control", "private, no-store");
    response.headers.set("Vary", "Cookie");
    // A failed retry sequence has no trustworthy session result: never replay
    // cookies obtained during an earlier, partial attempt on that error path.
    if (result.kind !== "unavailable") {
      for (const cookie of sessionSetCookies) {
        response.headers.append("Set-Cookie", cookie);
      }
    }
    return response;
  });
  return router;
}
