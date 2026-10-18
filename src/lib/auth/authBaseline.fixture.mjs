/**
 * Synthetic rows and recorded CURRENT cookie baseline for MIG-0801.
 * No real token, secret or production value is stored here.
 */

export const BASELINE_NOW_MS = Date.now();
const DAY_MS = 24 * 60 * 60 * 1000;

export const AUTH_BASELINE_ENV = {
  AUTH_URL: "https://flamenode.example",
  NEXT_PUBLIC_SITE_URL: "https://flamenode.example",
  AUTH_SECRET: "synthetic-auth-secret-for-characterization-only",
  AUTH_DISCORD_ID: "synthetic-discord-client-id",
  AUTH_DISCORD_SECRET: "synthetic-discord-client-secret",
};

export const USERS = {
  valid: { id: "user-mock-valid", name: "Valid", email: "valid@example.com", role: "user", is_banned: 0, discord_id: "discord-mock-1", active_x_user_id: "x-mock-1" },
  banned: { id: "user-mock-banned", name: "Banned", email: "banned@example.com", role: "user", is_banned: 1, discord_id: "discord-mock-2", active_x_user_id: null },
  noX: { id: "user-mock-nox", name: "No X", email: "nox@example.com", role: "user", is_banned: 0, discord_id: "discord-mock-3", active_x_user_id: null },
  multiX: { id: "user-mock-multix", name: "Multi X", email: "multix@example.com", role: "user", is_banned: 0, discord_id: "discord-mock-4", active_x_user_id: "x-mock-primary" },
};

export const SESSIONS = {
  valid: { sessionToken: "synthetic_session_valid", userId: USERS.valid.id, expiresMs: BASELINE_NOW_MS + 30 * DAY_MS },
  expired: { sessionToken: "synthetic_session_expired", userId: USERS.valid.id, expiresMs: BASELINE_NOW_MS - DAY_MS },
  banned: { sessionToken: "synthetic_session_banned", userId: USERS.banned.id, expiresMs: BASELINE_NOW_MS + 30 * DAY_MS },
  noX: { sessionToken: "synthetic_session_nox", userId: USERS.noX.id, expiresMs: BASELINE_NOW_MS + 30 * DAY_MS },
  multiX: { sessionToken: "synthetic_session_multix", userId: USERS.multiX.id, expiresMs: BASELINE_NOW_MS + 30 * DAY_MS },
  deletedToken: "synthetic_session_not_in_db",
};

export const DISCORD_ACCOUNTS = {
  linked: { userId: USERS.valid.id, type: "oauth", provider: "discord", providerAccountId: USERS.valid.discord_id },
  // Same Discord id as USERS.valid, claimed by another user.
  ownedByOther: { userId: USERS.noX.id, type: "oauth", provider: "discord", providerAccountId: USERS.valid.discord_id },
};

/**
 * Set-Cookie recorded from CURRENT buildAuthConfig() over https (useSecureCookies).
 * `Expires` is excluded because it depends on the clock; `hasExpires` records its presence.
 */
export const BASELINE_COOKIES = {
  sessionToken: {
    name: "__Secure-authjs.session-token",
    // Set on every session read (sliding expiry, Auth.js default maxAge 30 days).
    observedOnRead: {
      attributes: { httponly: true, path: "/", samesite: "Lax", secure: true },
      hasExpires: true,
    },
    observedOnSignOut: {
      attributes: { "max-age": "0", httponly: true, path: "/", samesite: "Lax", secure: true },
      hasExpires: false,
    },
  },
  csrfToken: {
    name: "__Host-authjs.csrf-token",
    observed: {
      attributes: { httponly: true, path: "/", samesite: "Lax", secure: true },
      hasExpires: false,
    },
  },
};
