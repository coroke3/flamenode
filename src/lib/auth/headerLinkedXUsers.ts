import "server-only";

import { eq } from "drizzle-orm";
import type { DB } from "@/lib/db/client";
import { xUserAccountLinks, xUsers } from "@/lib/db/schema";

export type HeaderLinkedXUser = {
  x_user_id: string;
  x_name: string;
  icon_url: string | null;
  approval_status: string | null;
};

/**
 * account/header表示専用の最小 linked X projection。
 * profile/contact/request metadata はヘッダーで使わないため取得しない。
 * 承認前/却下済みも表示状態のため必要なので approval_status では絞らない。
 */
export async function getHeaderLinkedXUsersForAuthUser(
  db: DB,
  authUserId: string,
): Promise<HeaderLinkedXUser[]> {
  return db
    .select({
      x_user_id: xUsers.id,
      x_name: xUsers.x_name,
      icon_url: xUsers.icon_url,
      approval_status: xUsers.approval_status,
    })
    .from(xUserAccountLinks)
    .innerJoin(xUsers, eq(xUsers.id, xUserAccountLinks.x_user_id))
    .where(eq(xUserAccountLinks.auth_user_id, authUserId));
}
