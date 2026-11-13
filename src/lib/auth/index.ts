import "server-only";
import NextAuth, { type NextAuthConfig } from "next-auth";
import Discord from "next-auth/providers/discord";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { getDatabaseAsync, getEnvAsync } from "@/lib/cloudflare";
import { accounts, sessions, users, verificationTokens } from "@/lib/db/schema";
import { linkDiscordAccountAtomically } from "@/lib/auth/accountLinkAdapter";
import { configuredHttpOrigin } from "@/lib/auth/origin";
import { authRedirectTarget } from "@flamenode/server-core/auth/redirect";
import { applyDatabaseAuthSessionClaims, authRuntimeDefaults, discordProviderOptions, resolveAuthRuntimeCredentials } from "@flamenode/server-core/auth/config";
import { logSafeAuthError } from "@/lib/auth/safeLogger";
import {
  createTraceId,
  logFlowTrace,
} from "@/lib/observability/flowTrace";

/**
 * NextAuth v5 (Auth.js) の設定。
 *
 * OpenNext request contextから設定とD1を遅延取得する。
 */
export async function buildAuthConfig(): Promise<NextAuthConfig> {
  const env = await getEnvAsync();
  const db = await getDatabaseAsync();
  if (!db) {
    throw new Error("AUTH_DATABASE_UNAVAILABLE");
  }
  const { secret: authSecret, discordClientId, discordClientSecret } =
    resolveAuthRuntimeCredentials({
      authSecret: env.AUTH_SECRET,
      discordClientId: env.AUTH_DISCORD_ID,
      discordClientSecret: env.AUTH_DISCORD_SECRET,
      allowLocalDevSecret: process.env.NODE_ENV !== "production",
    });
  const allowLocalPreview =
    process.env.NODE_ENV !== "production" ||
    env.FLAMENODE_LOCAL_PREVIEW === "1";
  const authOrigin = configuredHttpOrigin(env.AUTH_URL, "AUTH_URL", {
    allowLoopback: allowLocalPreview,
  });
  const siteOrigin = configuredHttpOrigin(
    env.NEXT_PUBLIC_SITE_URL,
    "NEXT_PUBLIC_SITE_URL",
    { allowLoopback: allowLocalPreview },
  );
  if (authOrigin !== siteOrigin) throw new Error("AUTH_ORIGIN_MISMATCH");

  const drizzleAdapter = DrizzleAdapter(db as never, {
    usersTable: users as never,
    accountsTable: accounts as never,
    sessionsTable: sessions as never,
    verificationTokensTable: verificationTokens as never,
  } as never);
  const baseConfig: NextAuthConfig = {
    // Shared CURRENT defaults; origin validation and redirect policy remain
    // bound to configured AUTH_URL/NEXT_PUBLIC_SITE_URL above.
    ...authRuntimeDefaults(),
    secret: authSecret,
    // Adapter/Drizzle failure stacks can include sessionToken bind values.
    logger: { error: logSafeAuthError },
    providers: [
      Discord(discordProviderOptions({ discordClientId, discordClientSecret })),
    ],
    callbacks: {
      async redirect({ url }) {
        return authRedirectTarget(url, authOrigin);
      },
      async session({ session, user }) {
        // Database identity is the only authority for role/ban/Active X claims.
        // The pure callback is shared with the future unmounted Hono Auth.js PoC.
        return applyDatabaseAuthSessionClaims(session, user as typeof user & {
          role?: string | null;
          is_banned?: number | null;
          active_x_user_id?: string | null;
        });
      },
    },
    adapter: {
      ...drizzleAdapter,
      ...(drizzleAdapter.createUser
        ? {
            async createUser(
              data: Parameters<NonNullable<typeof drizzleAdapter.createUser>>[0],
            ) {
              const traceId = createTraceId();
              try {
                const user = await drizzleAdapter.createUser!(data);
                logFlowTrace({
                  flow: "discord_auth",
                  phase: "user_created",
                  trace_id: traceId,
                  result: "succeeded",
                });
                return user;
              } catch (error) {
                logFlowTrace({
                  flow: "discord_auth",
                  phase: "user_created",
                  trace_id: traceId,
                  result: "failed",
                  error_code: "AUTH_USER_CREATE_FAILED",
                });
                throw error;
              }
            },
          }
        : {}),
      ...(drizzleAdapter.createSession
        ? {
            async createSession(
              session: Parameters<
                NonNullable<typeof drizzleAdapter.createSession>
              >[0],
            ) {
              const traceId = createTraceId();
              try {
                const created = await drizzleAdapter.createSession!(session);
                logFlowTrace({
                  flow: "discord_auth",
                  phase: "session_created",
                  trace_id: traceId,
                  result: "succeeded",
                });
                return created;
              } catch (error) {
                logFlowTrace({
                  flow: "discord_auth",
                  phase: "session_created",
                  trace_id: traceId,
                  result: "failed",
                  error_code: "AUTH_SESSION_CREATE_FAILED",
                });
                throw error;
              }
            },
          }
        : {}),
      ...(drizzleAdapter.deleteSession
        ? {
            async deleteSession(sessionToken: string): Promise<void> {
              const traceId = createTraceId();
              try {
                await drizzleAdapter.deleteSession!(sessionToken);
                logFlowTrace({
                  flow: "discord_auth",
                  phase: "signout_completed",
                  trace_id: traceId,
                  result: "succeeded",
                });
              } catch (error) {
                logFlowTrace({
                  flow: "discord_auth",
                  phase: "signout_completed",
                  trace_id: traceId,
                  result: "failed",
                  error_code: "AUTH_SESSION_DELETE_FAILED",
                });
                throw error;
              }
            },
          }
        : {}),
      async linkAccount(account) {
        await linkDiscordAccountAtomically(db, account, undefined, undefined, siteOrigin);
      },
    },
  };

  return baseConfig;
}

export const { handlers, auth, signIn, signOut } = NextAuth(async () =>
  await buildAuthConfig(),
);
