import "server-only";

import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { withDatabase } from "@/lib/cloudflare";
import { users } from "@/lib/db/schema";
import { normalizeXId } from "@/lib/utils/xid";
import { resolveActiveXUserId } from "@/lib/auth/resolveActiveXId";
import {
  getLatestPublishedMajorTerms,
  termsReacceptRequiredValue,
} from "@/lib/terms/reaccept";

export type CurrentUser = {
  id: string;
  name: string;
  email: string | null;
  image: string | null;
  role: "user" | "admin" | "moderator";
  is_banned: number;
  active_x_user_id: string | null;
  /** TOS 同意状態。1=同意済み, 0=未同意。fallback (DB 読めず) では 0 = 書込フェイルクローズ。 */
  is_tos_accepted: number;
  accepted_terms_version_id: string | null;
  /** 最新major版以降の同意履歴から動的に導出する。保存flagは判定に使わない。 */
  terms_reaccept_required: number;
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
  // closure 内に narrowing が伝わらないため string に束縛し直す。
  const userId: string = sessionUser.id;

  // DB 読めない fallback は TOS 未同意扱い (fail-closed)。
  const fallback: CurrentUser = {
    id: userId,
    name: sessionUser.name ?? "ゲスト",
    email: sessionUser.email ?? null,
    image: sessionUser.image ?? null,
    role:
      sessionUser.role === "admin" || sessionUser.role === "moderator"
        ? sessionUser.role
        : "user",
    is_banned: sessionUser.is_banned ?? 0,
    active_x_user_id: normalizeXId(sessionUser.active_x_user_id) || null,
    is_tos_accepted: 0,
    accepted_terms_version_id: null,
    terms_reaccept_required: 0,
  };

  const row = await withDatabase(async (db) => {
    const requiredMajor = await getLatestPublishedMajorTerms(db);
    const res = await db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        image: users.image,
        role: users.role,
        is_banned: users.is_banned,
        active_x_user_id: users.active_x_user_id,
        is_tos_accepted: users.is_tos_accepted,
        accepted_terms_version_id: users.accepted_terms_version_id,
        terms_reaccept_required: termsReacceptRequiredValue(requiredMajor),
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    const userRow = res[0] ?? null;
    if (!userRow) return null;

    const resolvedActive = await resolveActiveXUserId(
      db,
      userId,
      normalizeXId(userRow.active_x_user_id) || null,
    );

    return { userRow, resolvedActive };
  });

  if (!row) return fallback;

  const { userRow, resolvedActive } = row;

  return {
    id: userRow.id,
    name: userRow.name ?? fallback.name,
    email: userRow.email ?? fallback.email,
    image: userRow.image ?? fallback.image,
    role:
      userRow.role === "admin" || userRow.role === "moderator" ? userRow.role : "user",
    is_banned: userRow.is_banned ?? 0,
    active_x_user_id:
      resolvedActive ?? (normalizeXId(userRow.active_x_user_id) || null),
    is_tos_accepted: userRow.is_tos_accepted ?? 0,
    accepted_terms_version_id: userRow.accepted_terms_version_id ?? null,
    terms_reaccept_required: userRow.terms_reaccept_required === 1 ? 1 : 0,
  };
}
