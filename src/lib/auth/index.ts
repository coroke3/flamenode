import "server-only";
import NextAuth, { type NextAuthConfig } from "next-auth";
import Discord from "next-auth/providers/discord";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { getDatabaseAsync, getEnvAsync } from "@/lib/cloudflare";
import { accounts, sessions, users, verificationTokens } from "@/lib/db/schema";
import { linkDiscordAccountAtomically } from "@/lib/auth/accountLinkAdapter";
import { configuredHttpOrigin } from "@/lib/auth/origin";

const LOCAL_DEV_AUTH_SECRET = "flamenode-local-development-auth-secret";

function envValue(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

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
  const authSecret =
    envValue(env.AUTH_SECRET) ??
    (process.env.NODE_ENV !== "production" ? LOCAL_DEV_AUTH_SECRET : undefined);
  if (!authSecret) throw new Error("AUTH_SECRET_MISSING");
  const discordClientId = envValue(env.AUTH_DISCORD_ID);
  const discordClientSecret = envValue(env.AUTH_DISCORD_SECRET);
  if (!discordClientId || !discordClientSecret) {
    throw new Error("AUTH_DISCORD_CONFIG_MISSING");
  }
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
    secret: authSecret,
    // Auth.jsのHost検査は通すが、redirect先は検証済み設定originだけを使う。
    trustHost: true,
    session: { strategy: "database" },
    providers: [
      Discord({
        clientId: discordClientId,
        clientSecret: discordClientSecret,
        // `authorization` だけ `params` を渡すとデフォルトの `url` が消え、
        // Auth.js が OIDC discovery へ落ちて `new URL(undefined)` → Invalid URL になる。
        authorization: {
          url: "https://discord.com/api/oauth2/authorize",
          params: { scope: "identify email" },
        },
      }),
    ],
    pages: {
      signIn: "/entry",
      error: "/entry",
    },
    callbacks: {
      async redirect({ url }) {
        if (url.startsWith("/")) {
          return `${authOrigin}${url}`;
        }
        try {
          const target = new URL(url);
          if (target.origin === authOrigin) return target.href;
        } catch {
          /* fall through */
        }
        return `${authOrigin}/dashboard`;
      },
      async session({ session, user }) {
        if (session.user && user) {
          const su = session.user as typeof session.user & {
            id: string;
            role?: string;
            is_banned?: number;
            active_x_user_id?: string | null;
          };
          su.id = user.id;
          // user (DB row) に追加カラムが入っているはずなので転写する
          const raw = user as typeof user & {
            role?: string;
            is_banned?: number;
            active_x_user_id?: string | null;
          };
          su.role = raw.role ?? "user";
          su.is_banned = raw.is_banned ?? 0;
          su.active_x_user_id = raw.active_x_user_id ?? null;
        }
        return session;
      },
    },
    adapter: {
      ...drizzleAdapter,
      async linkAccount(account) {
        await linkDiscordAccountAtomically(db, account);
      },
    },
  };

  return baseConfig;
}

export const { handlers, auth, signIn } = NextAuth(async () =>
  await buildAuthConfig(),
);
