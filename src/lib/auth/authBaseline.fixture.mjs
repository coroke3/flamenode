/**
 * Auth baseline synthetic fixtures for FlameNode characterization testing (MIG-0801).
 *
 * INVARIANTS:
 * - ZERO live secrets, access tokens, or real production credentials.
 * - All tokens are deterministic synthetic identifiers.
 * - Cookie definitions represent Auth.js v5 contracts.
 */

export const AUTH_COOKIE_DEFINITIONS = {
  production: {
    sessionToken: {
      name: "__Secure-authjs.session-token",
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: true,
      },
    },
    callbackUrl: {
      name: "__Secure-authjs.callback-url",
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: true,
      },
    },
    csrfToken: {
      name: "__Host-authjs.csrf-token",
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: true,
      },
    },
  },
  development: {
    sessionToken: {
      name: "authjs.session-token",
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: false,
      },
    },
    callbackUrl: {
      name: "authjs.callback-url",
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: false,
      },
    },
    csrfToken: {
      name: "authjs.csrf-token",
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: false,
      },
    },
  },
};

export const MOCK_AUTH_USERS = {
  validUser: {
    id: "usr_valid_001",
    email: "test-user-1@example.com",
    name: "Valid Test User",
    role: "user",
    is_banned: 0,
    discord_id: "discord_uid_1001",
    active_x_user_id: "x_usr_001",
  },
  adminUser: {
    id: "usr_admin_002",
    email: "admin@example.com",
    name: "Admin Test User",
    role: "admin",
    is_banned: 0,
    discord_id: "discord_uid_1002",
    active_x_user_id: null,
  },
  bannedUser: {
    id: "usr_banned_003",
    email: "banned@example.com",
    name: "Banned Test User",
    role: "user",
    is_banned: 1,
    discord_id: "discord_uid_1003",
    active_x_user_id: null,
  },
  noXUser: {
    id: "usr_nox_004",
    email: "nox@example.com",
    name: "No X User",
    role: "user",
    is_banned: 0,
    discord_id: "discord_uid_1004",
    active_x_user_id: null,
  },
  multiXUser: {
    id: "usr_multix_005",
    email: "multix@example.com",
    name: "Multi X User",
    role: "user",
    is_banned: 0,
    discord_id: "discord_uid_1005",
    active_x_user_id: "x_usr_primary",
  },
};

export const MOCK_SESSIONS = {
  validSession: {
    sessionToken: "synthetic_sess_token_valid_12345",
    userId: "usr_valid_001",
    expires: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // +30 days
  },
  expiredSession: {
    sessionToken: "synthetic_sess_token_expired_67890",
    userId: "usr_valid_001",
    expires: new Date(Date.now() - 24 * 60 * 60 * 1000), // -1 day
  },
  bannedUserSession: {
    sessionToken: "synthetic_sess_token_banned_11223",
    userId: "usr_banned_003",
    expires: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
  },
  revokedSessionToken: "synthetic_sess_token_nonexistent_99999",
};

export const MOCK_DISCORD_ACCOUNTS = {
  linkedAccount1: {
    userId: "usr_valid_001",
    type: "oauth",
    provider: "discord",
    providerAccountId: "discord_uid_1001",
    scope: "identify email",
    token_type: "Bearer",
  },
  unlinkedAccount: {
    userId: "usr_nox_004",
    type: "oauth",
    provider: "discord",
    providerAccountId: "discord_uid_new_9999",
    scope: "identify email",
    token_type: "Bearer",
  },
  duplicateDiscordAccount: {
    userId: "usr_banned_003",
    type: "oauth",
    provider: "discord",
    providerAccountId: "discord_uid_1001", // Conflicts with usr_valid_001
    scope: "identify email",
    token_type: "Bearer",
  },
};
