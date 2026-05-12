import "server-only";

import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { getDatabase } from "@/lib/cloudflare";
import { users } from "@/lib/db/schema";
import { normalizeXId } from "@/lib/utils/xid";

export type CurrentUser = {
  id: string;
  name: string;
  email: string | null;
  image: string | null;
  role: "user" | "admin" | "moderator";
  is_banned: number;
  active_x_user_id: string | null;
};

export async function getCurrentUser(): Promise<CurrentUser | null> {
  const session = await auth().catch(() => null);
  const sessionUser = session?.user as
    | {
        id?: string | null;
        name?: string | null;
        email?: string | null;
        image?: string | null;
        role?: string | null;
        is_banned?: number | null;
        active_x_user_id?: string | null;
      }
    | undefined;

  if (!sessionUser?.id) return null;

  const fallback: CurrentUser = {
    id: sessionUser.id,
    name: sessionUser.name ?? "ゲスト",
    email: sessionUser.email ?? null,
    image: sessionUser.image ?? null,
    role:
      sessionUser.role === "admin" || sessionUser.role === "moderator"
        ? sessionUser.role
        : "user",
    is_banned: sessionUser.is_banned ?? 0,
    active_x_user_id: normalizeXId(sessionUser.active_x_user_id) || null,
  };

  const db = getDatabase();
  if (!db) return fallback;

  const row = (
    await db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        image: users.image,
        role: users.role,
        is_banned: users.is_banned,
        active_x_user_id: users.active_x_user_id,
      })
      .from(users)
      .where(eq(users.id, sessionUser.id))
      .limit(1)
  )[0];

  if (!row) return fallback;

  return {
    id: row.id,
    name: row.name ?? fallback.name,
    email: row.email ?? fallback.email,
    image: row.image ?? fallback.image,
    role:
      row.role === "admin" || row.role === "moderator" ? row.role : "user",
    is_banned: row.is_banned ?? 0,
    active_x_user_id: normalizeXId(row.active_x_user_id) || null,
  };
}
