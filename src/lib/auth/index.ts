import "server-only";
import NextAuth, { type NextAuthConfig } from "next-auth";
import Discord from "next-auth/providers/discord";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { and, eq } from "drizzle-orm";
import { mutateWithAudit } from "@/lib/audit/mutate";
import { expectedRowCondition } from "@/lib/audit/expectedRowCondition";
import { getDatabase, getDatabaseAsync, getEnv, waitForLocalBindings } from "@/lib/cloudflare";
import { accounts, sessions, users, verificationTokens } from "@/lib/db/schema";

const LOCAL_DEV_AUTH_SECRET = "flamenode-local-development-auth-secret";

function ensureAuthSecretEnv(): void {
  if (process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET) return;
  if (process.env.NODE_ENV !== "production") {
    process.env.AUTH_SECRET = LOCAL_DEV_AUTH_SECRET;
  }
}

ensureAuthSecretEnv();

/**
 * Auth.js v5 は OAuth 認可 URL 組み立てに `AUTH_URL`（または `NEXTAUTH_URL`）を参照する。
 * 未設定だと `new URL(undefined)` となり `Configuration` / `Invalid URL` になる。
 * ローカルでは `NEXT_PUBLIC_SITE_URL` を既定のベース URL に使う。
 */
function ensureAuthBaseUrlEnv(): void {
  if (process.env.AUTH_URL || process.env.NEXTAUTH_URL) return;
  const fromPublic = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  const vercel = process.env.VERCEL_URL?.trim();
  const fromVercel =
    vercel && !/^https?:\/\//i.test(vercel) ? `https://${vercel}` : vercel;
  const candidate = (fromPublic || fromVercel || "").trim();
  if (!candidate) {
    throw new Error(
      "AUTH_URL または NEXT_PUBLIC_SITE_URL を明示してください。Hostヘッダーやlocalhostへの暗黙fallbackは使用しません。",
    );
  }
  try {
    const origin = new URL(candidate).origin;
    process.env.AUTH_URL = origin;
    process.env.NEXTAUTH_URL = origin;
  } catch {
    throw new Error("AUTH_URL / NEXT_PUBLIC_SITE_URL のoriginが不正です。");
  }
}

ensureAuthBaseUrlEnv();

function envValue(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

/**
 * NextAuth v5 (Auth.js) の設定。
 *
 * Cloudflare Pages のランタイムでは D1 が getRequestContext から渡るため、
 * 設定ファクトリで遅延的にアダプタを作る。
 */
export async function buildAuthConfig(): Promise<NextAuthConfig> {
  await waitForLocalBindings();
  const env = getEnv();
  const db = await getDatabaseAsync();
  if (!db) {
    throw new Error("AUTH_DATABASE_UNAVAILABLE");
  }
  const authSecret =
    envValue(process.env.AUTH_SECRET) ??
    envValue(process.env.NEXTAUTH_SECRET) ??
    envValue(env.AUTH_SECRET) ??
    (process.env.NODE_ENV !== "production" ? LOCAL_DEV_AUTH_SECRET : undefined);
  const discordClientId =
    envValue(process.env.AUTH_DISCORD_ID) ?? envValue(env.AUTH_DISCORD_ID);
  const discordClientSecret =
    envValue(process.env.AUTH_DISCORD_SECRET) ??
    envValue(env.AUTH_DISCORD_SECRET);
  const baseConfig: NextAuthConfig = {
    secret: authSecret,
    trustHost: false,
    session: { strategy: "database" },
    providers: [
      Discord({
        clientId: discordClientId,
        clientSecret: discordClientSecret,
        // `authorization` だけ `params` を渡すとデフォルトの `url` が消え、
        // Auth.js が OIDC discovery へ落ちて `new URL(undefined)` → Invalid URL になる。
        authorization: {
          url: "https://discord.com/api/oauth2/authorize",
          params: { scope: "identify email guilds" },
        },
      }),
    ],
    pages: {
      signIn: "/entry",
      error: "/entry",
    },
    callbacks: {
      async redirect({ url, baseUrl }) {
        const base = baseUrl.replace(/\/$/, "");
        if (url.startsWith("/")) {
          return `${base}${url}`;
        }
        try {
          const target = new URL(url);
          const origin = new URL(base);
          if (target.origin === origin.origin) return url;
        } catch {
          /* fall through */
        }
        return `${base}/dashboard`;
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
    events: {
      async linkAccount({ account, user }) {
        // セキュリティ: アクセストークンは保持しない (refresh のみ)
        // account はビルド時に readonly 推論されるが、実体は mutable なので as 経由でクリア
        const a = account as unknown as Record<string, unknown> | null;
        if (a?.access_token) a.access_token = null;
        if (
          account.provider === "discord" &&
          account.providerAccountId &&
          user.id
        ) {
          const eventDb = getDatabase();
          if (!eventDb) throw new Error("AUTH_DATABASE_UNAVAILABLE");
          const beforeUser = (
            await eventDb.select().from(users).where(eq(users.id, user.id)).limit(1)
          )[0];
          if (!beforeUser) throw new Error("AUTH_LINK_USER_NOT_FOUND");
          const afterUser = { ...beforeUser, discord_id: account.providerAccountId };
          await mutateWithAudit(eventDb, {
            mutationStatements: [
              eventDb.update(users).set({ discord_id: account.providerAccountId }).where(
                expectedRowCondition({ expectedCurrent: beforeUser }),
              ),
              eventDb.update(accounts).set({ access_token: null }).where(
                and(
                  eq(accounts.provider, account.provider),
                  eq(accounts.providerAccountId, account.providerAccountId),
                )!,
              ),
            ],
            expectedMutationChanges: [1, 1],
            audits: [{
              table_name: "user",
              target_id: user.id,
              operation: "UPDATE",
              before: { ...beforeUser },
              after: { ...afterUser },
              actor_user_id: user.id,
              reason: "auth_link_discord",
              context: "auth",
              retention_class: "long_audit",
            }],
          });
        }
      },
    },
  };

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

export const { handlers, auth, signIn, signOut } = NextAuth(async () =>
  await buildAuthConfig(),
);
