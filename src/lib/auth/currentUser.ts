import "server-only";

import { cache } from "react";
import type { Session } from "next-auth";
import { unstable_rethrow } from "next/navigation";
import { eq } from "drizzle-orm";
import { getAuthSession } from "@/lib/auth/session";
import { withDatabaseRead } from "@/lib/cloudflare";
import { users } from "@/lib/db/schema";
import { normalizeXId } from "@/lib/utils/xid";
import { resolveActiveXUserId } from "@/lib/auth/resolveActiveXId";
import {
  getHeaderLinkedXUsersForAuthUser,
  type HeaderLinkedXUser,
} from "@/lib/auth/headerLinkedXUsers";
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

/**
 * 同一request内でのみ再利用するDB正本スナップショット。
 * linkedXUsers は認証・active X解決時にD1から取得した行で、外部入力ではない。
 */
export type CurrentUserContext = {
  user: CurrentUser | null;
  linkedXUsers: HeaderLinkedXUser[];
};

/** Account-menu identity projection. Terms are enforced by protected-route callers, not header hydration. */
export type AccountSummaryCurrentUser = Pick<
  CurrentUser,
  "id" | "name" | "email" | "image" | "role" | "is_banned" | "active_x_user_id"
>;

export type AccountSummaryCurrentUserContext = {
  user: AccountSummaryCurrentUser | null;
  linkedXUsers: HeaderLinkedXUser[];
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

async function loadCurrentUserContext(
  includeTerms: boolean,
): Promise<CurrentUserContext | AccountSummaryCurrentUserContext> {
  let session: Session | null;
  try {
    session = await getAuthSession();
  } catch (error) {
    unstable_rethrow(error);
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
  if (!sessionUser?.id) return { user: null, linkedXUsers: [] };
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
    // Active X ID は session の古い値を信用せず、DB の正本リンクからのみ解決する。
    active_x_user_id: null,
    is_tos_accepted: 0,
    accepted_terms_version_id: null,
    terms_reaccept_required: 0,
  };

  const loaded = await (async () => {
    try {
      return await withDatabaseRead(async (db) => {
        const userRow = includeTerms
          ? await (async () => {
              const requiredMajor = await getLatestPublishedMajorTerms(db);
              return (
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
                    terms_reaccept_required:
                      termsReacceptRequiredValue(requiredMajor),
                  })
                  .from(users)
                  .where(eq(users.id, userId))
                  .limit(1)
              )[0];
            })()
          : (
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
                .where(eq(users.id, userId))
                .limit(1)
            )[0];

        if (!userRow) return { kind: "missing" as const };

        // active X解決とaccount/header表示で同じlinked X行を再利用できるよう、
        // ここで最小projectionを1回だけ読む。認可判定はapproval_statusを境界で再確認する。
        const linkedXUsers = await getHeaderLinkedXUsersForAuthUser(db, userId);
        const resolvedActive = await resolveActiveXUserId(
          db,
          userId,
          normalizeXId(userRow.active_x_user_id) || null,
          linkedXUsers,
        );
        const accountUser: AccountSummaryCurrentUser = {
          id: userRow.id,
          name: userRow.name ?? fallback.name,
          email: userRow.email ?? fallback.email,
          image: userRow.image ?? fallback.image,
          role:
            userRow.role === "admin" || userRow.role === "moderator"
              ? userRow.role
              : "user",
          is_banned: userRow.is_banned ?? 0,
          active_x_user_id: resolvedActive,
        };
        const termsUserRow = userRow as typeof userRow & {
          is_tos_accepted?: number | null;
          accepted_terms_version_id?: string | null;
          terms_reaccept_required?: number | null;
        };
        const currentUser: CurrentUser | AccountSummaryCurrentUser = includeTerms
          ? {
              ...accountUser,
              is_tos_accepted: termsUserRow.is_tos_accepted ?? 0,
              accepted_terms_version_id:
                termsUserRow.accepted_terms_version_id ?? null,
              terms_reaccept_required:
                termsUserRow.terms_reaccept_required === 1 ? 1 : 0,
            }
          : accountUser;
        return {
          kind: "found" as const,
          user: currentUser,
          resolvedActive,
          linkedXUsers,
        };
      });
    } catch (error) {
      unstable_rethrow(error);
      throw new CurrentUserUnavailableError("database_unavailable", error);
    }
  })();

  if (loaded === null) {
    throw new CurrentUserUnavailableError("database_unavailable");
  }
  // Auth.js側に古いsessionが残っていても、消失したDB userのroleを復活させない。
  if (loaded.kind === "missing") return { user: null, linkedXUsers: [] };

  return {
    user: loaded.user,
    linkedXUsers: loaded.linkedXUsers,
  };
}

const getCachedCurrentUserContext = cache(loadCurrentUserContext);

/** 同一Server Component request内でterms付きDB正本contextを1回にまとめる。 */
export const getCurrentUserContext = (): Promise<CurrentUserContext> =>
  getCachedCurrentUserContext(true) as Promise<CurrentUserContext>;

/** Account summary専用projection。TOS判定を避けつつuser/linked-X正本は維持する。 */
export const getAccountSummaryCurrentUserContext =
  (): Promise<AccountSummaryCurrentUserContext> =>
    getCachedCurrentUserContext(false) as Promise<AccountSummaryCurrentUserContext>;

/** 既存callers向け。context cacheを共有するため追加D1 readは発生しない。 */
export const getCurrentUser = cache(
  async (): Promise<CurrentUser | null> => (await getCurrentUserContext()).user,
);
