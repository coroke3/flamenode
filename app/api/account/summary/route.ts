import { NextResponse } from "next/server";
import { buildHeaderUser } from "@/lib/auth/headerUser";
import {
  CurrentUserUnavailableError,
  getCurrentUser,
} from "@/lib/auth/currentUser";
import { getAuthSession } from "@/lib/auth/session";
import type { AccountSummaryResponse } from "@/lib/account/summary";

export const dynamic = "force-dynamic";

const PRIVATE_HEADERS = {
  "Cache-Control": "private, no-store",
} as const;

function loggedOut(): NextResponse<AccountSummaryResponse> {
  return NextResponse.json({ loggedIn: false }, { headers: PRIVATE_HEADERS });
}

export async function GET(): Promise<NextResponse<AccountSummaryResponse>> {
  let sessionUser;
  try {
    sessionUser = await getCurrentUser();
  } catch (error) {
    if (error instanceof CurrentUserUnavailableError) {
      return NextResponse.json(
        { loggedIn: false },
        { status: 503, headers: PRIVATE_HEADERS },
      );
    }
    throw error;
  }

  if (!sessionUser || sessionUser.is_banned === 1) {
    return loggedOut();
  }

  // getCurrentUser と同一requestの session cache を再利用する（auth() の再実行を避ける）。
  const session = await getAuthSession();
  let headerUser;
  try {
    headerUser = await buildHeaderUser(session?.user);
  } catch {
    // X ID一覧・管理イベント取得失敗でもログイン済み要約は返す。
    return NextResponse.json(
      {
        loggedIn: true,
        displayName: sessionUser.name,
        icon: sessionUser.image,
        role: sessionUser.role,
        activeXId: sessionUser.active_x_user_id,
        xIds: sessionUser.active_x_user_id
          ? [
              {
                x_user_id: sessionUser.active_x_user_id,
                x_name: `@${sessionUser.active_x_user_id}`,
                icon_url: sessionUser.image,
                approval_status: "approved" as const,
                is_active: true,
              },
            ]
          : [],
        canAccessAdmin: sessionUser.role === "admin",
        canAccessManage: sessionUser.role === "admin",
      },
      { headers: PRIVATE_HEADERS },
    );
  }
  if (!headerUser) {
    return loggedOut();
  }

  const activeEntry = headerUser.xIds.find((entry) => entry.is_active);

  const body: AccountSummaryResponse = {
    loggedIn: true,
    displayName: headerUser.name,
    icon: headerUser.image,
    role: headerUser.role,
    activeXId: activeEntry?.x_user_id ?? sessionUser.active_x_user_id ?? null,
    xIds: headerUser.xIds,
    canAccessAdmin: headerUser.management.canAccessAdmin,
    canAccessManage: headerUser.management.canAccessManage,
  };

  return NextResponse.json(body, { headers: PRIVATE_HEADERS });
}
