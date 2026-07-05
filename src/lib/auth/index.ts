import "server-only";
import NextAuth, { type NextAuthConfig } from "next-auth";
import Discord from "next-auth/providers/discord";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { and, eq } from "drizzle-orm";
import { getDatabase, getDatabaseAsync, getEnv, waitForLocalBindings } from "@/lib/cloudflare";
import { accounts, sessions, users, verificationTokens } from "@/lib/db/schema";

const LOCAL_DEV_AUTH_SECRET = "flamenode-local-development-auth-secret";

function loadLocalDevVarsIfNeeded(): void {
  if (process.env.NODE_ENV === "production") return;
  if (process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET) return;

  try {
    const req = eval("require") as NodeRequire;
    const fs = req("node:fs") as typeof import("node:fs");
    const path = req("node:path") as typeof import("node:path");
    const file = path.join(process.cwd(), ".dev.vars");
    if (!fs.existsSync(file)) return;

    const content = fs.readFileSync(file, "utf8");
    for (const raw of content.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq <= 0) continue;
      const key = line.slice(0, eq).trim();
      let value = line.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (process.env[key] === undefined || process.env[key] === "") {
        process.env[key] = value;
      }
    }
  } catch {
    // The package script already preloads .dev.vars; this is only a fallback.
  }
}

loadLocalDevVarsIfNeeded();

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
  const candidate = (fromPublic || fromVercel || "http://localhost:3000").trim();
  try {
    const origin = new URL(candidate).origin;
    process.env.AUTH_URL = origin;
    process.env.NEXTAUTH_URL = origin;
  } catch {
    process.env.AUTH_URL = "http://localhost:3000";
    process.env.NEXTAUTH_URL = "http://localhost:3000";
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
          await eventDb
            ?.update(users)
            .set({ discord_id: account.providerAccountId })
            .where(eq(users.id, user.id));
          await eventDb
            ?.update(accounts)
            .set({ access_token: null })
            .where(
              and(
                eq(accounts.provider, account.provider),
                eq(accounts.providerAccountId, account.providerAccountId),
              )!,
            );
        }
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

export const { handlers, auth, signIn, signOut } = NextAuth(async () =>
  await buildAuthConfig(),
);
