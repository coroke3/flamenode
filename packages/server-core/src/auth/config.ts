/**
 * MIG-0802 U01 (partial): Next-independent session callback used by the
 * CURRENT Auth.js bridge and the future Hono @auth/core config.
 *
 * Only the freshly loaded database user may supply authorization attributes.
 * Never fall back to session/cookie-provided role, ban or Active X fields.
 * Matches CURRENT's in-place session.user mutation and nullish defaults.
 */
export type DatabaseAuthCallbackUser = {
  id: string;
  role?: string | null;
  is_banned?: number | null;
  active_x_user_id?: string | null;
};

export function applyDatabaseAuthSessionClaims<TSession extends { user?: object | null }>(
  session: TSession,
  databaseUser: DatabaseAuthCallbackUser | null | undefined,
): TSession {
  if (!session.user || !databaseUser) return session;
  Object.assign(session.user, {
    id: databaseUser.id,
    role: databaseUser.role ?? "user",
    is_banned: databaseUser.is_banned ?? 0,
    active_x_user_id: databaseUser.active_x_user_id ?? null,
  });
  return session;
}


/**
 * U01 (partial): Web Standard-safe Auth.js credential resolution.
 * These are the same CURRENT fallback and error codes; no environment, Host,
 * cookie or OAuth request is read inside this module. The caller explicitly
 * controls whether the local-only fallback is allowed.
 */
const LOCAL_DEV_AUTH_SECRET = "flamenode-local-development-auth-secret";

export type AuthRuntimeCredentials = {
  secret: string;
  discordClientId: string;
  discordClientSecret: string;
};

export function resolveAuthRuntimeCredentials(input: {
  authSecret: string | null | undefined;
  discordClientId: string | null | undefined;
  discordClientSecret: string | null | undefined;
  allowLocalDevSecret: boolean;
}): AuthRuntimeCredentials {
  const nonEmpty = (value: string | null | undefined) => {
    const trimmed = value?.trim();
    return trimmed ? trimmed : undefined;
  };
  const secret = nonEmpty(input.authSecret) ??
    (input.allowLocalDevSecret ? LOCAL_DEV_AUTH_SECRET : undefined);
  if (!secret) throw new Error("AUTH_SECRET_MISSING");
  const discordClientId = nonEmpty(input.discordClientId);
  const discordClientSecret = nonEmpty(input.discordClientSecret);
  if (!discordClientId || !discordClientSecret) {
    throw new Error("AUTH_DISCORD_CONFIG_MISSING");
  }
  return { secret, discordClientId, discordClientSecret };
}

/**
 * U01 (partial): Discord OAuth provider options shared between CURRENT
 * NextAuth and a future unmounted @auth/core host.
 *
 * Keep the explicit authorization URL: supplying params without url causes
 * Auth.js to attempt OIDC discovery instead of Discord's OAuth endpoint.
 * The email-linking policy is CURRENT behavior, not a new authorization grant.
 */
export function discordProviderOptions(
  credentials: Pick<AuthRuntimeCredentials, "discordClientId" | "discordClientSecret">,
) {
  return {
    clientId: credentials.discordClientId,
    clientSecret: credentials.discordClientSecret,
    allowDangerousEmailAccountLinking: true,
    authorization: {
      url: "https://discord.com/api/oauth2/authorize",
      params: { scope: "identify email" },
    },
  };
}

/**
 * U01: exact CURRENT Auth.js framework-independent options.
 * Callers must validate configured AUTH_URL/NEXT_PUBLIC_SITE_URL before use:
 * trustHost alone is not a redirect, origin or account-linking safety policy.
 *
 * A fresh object per request matches CURRENT's buildAuthConfig behavior, and
 * prevents one request's library code from mutating the next request's config.
 */
export function authRuntimeDefaults() {
  return {
    trustHost: true as const,
    session: { strategy: "database" as const },
    pages: { signIn: "/entry" as const, error: "/entry" as const },
  };
}
