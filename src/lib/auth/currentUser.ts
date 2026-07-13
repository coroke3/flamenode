import "server-only";

import { cache } from "react";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { withDatabaseRead } from "@/lib/cloudflare";
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
  /** TOS同意状態。1=同意済み、0=未同意。 */
  is_tos_accepted: number;
  accepted_terms_version_id: string | null;
  /** 最新major版以降の同意履歴から動的に導出する。保存flagは判定に使わない。 */
  terms_reaccept_required: number;
};

export type CurrentUserUnavailableCode =
  | "auth_temporarily_unavailable"
  | "database_unavailable";

export class CurrentUserUnavailableError extends Error {
  readonly code: CurrentUserUnavailableCode;

  constructor(code: CurrentUserUnavailableCode, cause?: unknown) {
    super(code, { cause });
    this.name = "CurrentUserUnavailableError";
    this.code = code;
  }
}

async function loadCurrentUser(): Promise<CurrentUser | null> {
  let session: Awaited<ReturnType<typeof auth>>;
  try {
    session = await auth();
  } catch (error) {
    throw new CurrentUserUnavailableError(
      "auth_temporarily_unavailable",
      error,
    );
  }

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

  // authが正常終了してsessionが無い場合だけ未ログイン扱いにする。
  if (!sessionUser?.id) return null;
  const userId = sessionUser.id;

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

  const loaded = await withDatabaseRead(async (db) => {
    const requiredMajor = await getLatestPublishedMajorTerms(db);
    const userRow = (
      await db
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
        .limit(1)
    )[0];

    if (!userRow) return { kind: "missing" as const };
    const resolvedActive = await resolveActiveXUserId(
      db,
      userId,
      normalizeXId(userRow.active_x_user_id) || null,
    );
    return { kind: "found" as const, userRow, resolvedActive };
  });

  if (loaded === null) {
    throw new CurrentUserUnavailableError("database_unavailable");
  }
  // Auth.js側にsessionが残りDB行だけ欠落した場合は書込みをfail-closedにする。
  if (loaded.kind === "missing") return fallback;

  const { userRow, resolvedActive } = loaded;
  return {
    id: userRow.id,
    name: userRow.name ?? fallback.name,
    email: userRow.email ?? fallback.email,
    image: userRow.image ?? fallback.image,
    role:
      userRow.role === "admin" || userRow.role === "moderator"
        ? userRow.role
        : "user",
    is_banned: userRow.is_banned ?? 0,
    active_x_user_id:
      resolvedActive ?? (normalizeXId(userRow.active_x_user_id) || null),
    is_tos_accepted: userRow.is_tos_accepted ?? 0,
    accepted_terms_version_id: userRow.accepted_terms_version_id ?? null,
    terms_reaccept_required: userRow.terms_reaccept_required === 1 ? 1 : 0,
  };
}

/** 同一Server Component request内のauth/DB/X-ID解決を1回にまとめる。 */
export const getCurrentUser = cache(loadCurrentUser);
