/**
 * MIG-0802 U01: UNMOUNTED @auth/core 0.41.3 request adapter (synthetic PoC).
 *
 * Never import this module from apps/api/src/app.ts or production entrypoints.
 * Only GET /api/auth/session, GET /api/auth/csrf, POST /api/auth/signout
 * are exposed by the isolated test-only routes/auth.ts. Sign-out is handled
 * by Auth.js itself with CSRF verification; OAuth sign-in/callback remain
 * unavailable until the audited atomic Discord account linker is ported.
 */
import { Auth, type AuthConfig } from "@auth/core";
import Discord from "@auth/core/providers/discord";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "@flamenode/db/schema";
import {
  applyDatabaseAuthSessionClaims,
  authAdapterTables,
  authRuntimeDefaults,
  discordProviderOptions,
  resolveAuthRuntimeCredentials,
} from "@flamenode/server-core/auth/config";
import { authRedirectTarget } from "@flamenode/server-core/auth/redirect";

export type UnmountedAuthInputs = {
  d1: D1Database;
  authSecret: string | null | undefined;
  discordClientId: string | null | undefined;
  discordClientSecret: string | null | undefined;
  /** These origins come from explicit configuration, never request Host. */
  authOrigin: string;
  siteOrigin: string;
};

function strictConfiguredOrigin(value: string): string {
  let parsed: URL;
  try {
    // CURRENT's configuredHttpOrigin trims whitespace and accepts the optional
    // trailing slash/default TLS port. Compare normalized origins, not raw URLs.
    parsed = new URL(value.trim());
  } catch {
    throw new Error("AUTH_ORIGIN_INVALID");
  }
  const hostname = parsed.hostname.toLowerCase().replace(/\\.$/, "");
  // This non-production host deliberately requires HTTPS (even though CURRENT
  // may allow HTTP on a non-loopback origin). Never enable the loopback
  // allowance or rely on request Host to derive the configured origin.
  if (
    parsed.protocol !== "https:" ||
    parsed.username || parsed.password ||
    parsed.pathname !== "/" || parsed.search || parsed.hash ||
    hostname === "localhost" ||
    hostname === "[::1]" ||
    /^127(?:\\.\\d{1,3}){3}$/.test(hostname)
  ) {
    throw new Error("AUTH_ORIGIN_INVALID");
  }
  return parsed.origin;
}

/**
 * The CURRENT adapter uses audited atomic linkDiscordAccountAtomically, which
 * still depends on Next-only modules. NEVER let the ordinary DrizzleAdapter
 * linkAccount bypass that logic during the migration. This is a hard blocker
 * until the existing atomic implementation is ported with parity evidence.
 */
export function buildUnmountedAuthConfig(input: UnmountedAuthInputs): AuthConfig {
  const authOrigin = strictConfiguredOrigin(input.authOrigin);
  const siteOrigin = strictConfiguredOrigin(input.siteOrigin);
  if (authOrigin !== siteOrigin) throw new Error("AUTH_ORIGIN_MISMATCH");
  if (!input.d1) throw new Error("AUTH_DATABASE_UNAVAILABLE");
  const credentials = resolveAuthRuntimeCredentials({
    authSecret: input.authSecret,
    discordClientId: input.discordClientId,
    discordClientSecret: input.discordClientSecret,
    allowLocalDevSecret: false,
  });
  const db = drizzle(input.d1, { schema });
  const adapter = DrizzleAdapter(db as never, authAdapterTables() as never);
  return {
    ...authRuntimeDefaults(),
    basePath: "/api/auth",
    secret: credentials.secret,
    // Never log stack, Cookie, tokens, secrets or untrusted URLs.
    logger: { error() {} },
    providers: [Discord(discordProviderOptions(credentials))],
    adapter: {
      ...adapter,
      async linkAccount() {
        throw new Error("AUTH_ATOMIC_LINK_PORT_PENDING");
      },
    },
    callbacks: {
      async redirect({ url }) {
        return authRedirectTarget(url, authOrigin);
      },
      async session({ session, user }) {
        return applyDatabaseAuthSessionClaims(session, user);
      },
    },
  };
}

/** Native Fetch Request/Response; caller must enforce the route allowlist. */
export function invokeUnmountedAuth(request: Request, config: AuthConfig): Promise<Response> {
  return Auth(request, config);
}
