import "server-only";
import NextAuth, { type NextAuthConfig } from "next-auth";
import Discord from "next-auth/providers/discord";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { getDatabase } from "@/lib/cloudflare";
import { accounts, sessions, users, verificationTokens } from "@/lib/db/schema";

/**
 * NextAuth v5 (Auth.js) の設定。
 *
 * Cloudflare Pages のランタイムでは D1 が getRequestContext から渡るため、
 * 設定ファクトリで遅延的にアダプタを作る。
 */
export function buildAuthConfig(): NextAuthConfig {
  const db = getDatabase();
  const baseConfig: NextAuthConfig = {
    trustHost: true,
    session: { strategy: "database" },
    providers: [
      Discord({
        clientId: process.env.AUTH_DISCORD_ID,
        clientSecret: process.env.AUTH_DISCORD_SECRET,
        authorization: {
          params: { scope: "identify email guilds" },
        },
      }),
    ],
    pages: {
      signIn: "/entry",
      error: "/entry",
    },
    callbacks: {
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
    events: {
      async linkAccount({ account }) {
        // セキュリティ: アクセストークンは保持しない (refresh のみ)
        // account はビルド時に readonly 推論されるが、実体は mutable なので as 経由でクリア
        const a = account as unknown as Record<string, unknown> | null;
        if (a?.access_token) a.access_token = null;
      },
    },
  };

  if (db) {
    return {
      ...baseConfig,
      adapter: DrizzleAdapter(db as never, {
        usersTable: users as never,
        accountsTable: accounts as never,
        sessionsTable: sessions as never,
        verificationTokensTable: verificationTokens as never,
      } as never),
    };
  }
  return baseConfig;
}

export const { handlers, auth, signIn, signOut } = NextAuth(buildAuthConfig());
