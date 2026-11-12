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
