import "server-only";

import { cache } from "react";
import { getAuthSession } from "@/lib/auth/session";
import { buildHeaderUser, type HeaderUser } from "@/lib/auth/headerUser";

/**
 * layout / PublicHeader 用の HeaderUser を request 内で1回にまとめる。
 * `includeXIds=false` は /admin など X ID 切替不要な画面向け。
 */
export const getLayoutHeaderUser = cache(
  async (includeXIds = true): Promise<HeaderUser | null> => {
    const session = await getAuthSession();
    return buildHeaderUser(session?.user, { includeXIds });
  },
);
