import { NextResponse } from "next/server";
import { buildHeaderUser } from "@/lib/auth/headerUser";
import {
  CurrentUserUnavailableError,
  getCurrentUserContext,
} from "@/lib/auth/currentUser";
import type { AccountSummaryResponse } from "@/lib/account/summary";
import { normalizeXIdApprovalStatus } from "@/lib/xid/entries";

export const dynamic = "force-dynamic";

const PRIVATE_HEADERS = {
  "Cache-Control": "private, no-store, no-cache, must-revalidate",
  Pragma: "no-cache",
  Expires: "0",
} as const;

function loggedOut(): NextResponse<AccountSummaryResponse> {
  return NextResponse.json({ loggedIn: false }, { headers: PRIVATE_HEADERS });
}

export async function GET(): Promise<NextResponse<AccountSummaryResponse>> {
  let currentContext;
  try {
    currentContext = await getCurrentUserContext();
  } catch (error) {
    if (error instanceof CurrentUserUnavailableError) {
      return NextResponse.json(
        { loggedIn: false, unavailable: true },
        { status: 503, headers: PRIVATE_HEADERS },
      );
    }
    throw error;
  }

  const sessionUser = currentContext.user;
  if (!sessionUser || sessionUser.is_banned === 1) {
    return loggedOut();
  }

  let headerUser;
  try {
    // getCurrentUserContext() が同一requestでDB正本から解決済みの
    // role / active X / linked X rowsを再利用し、Auth.js sessionを認可根拠にしない。
    headerUser = await buildHeaderUser(sessionUser, {
      authoritativeUserSnapshot: {
        role: sessionUser.role,
        active_x_user_id: sessionUser.active_x_user_id,
      },
      authoritativeLinkedXRows: currentContext.linkedXUsers,
    });
  } catch {
    // X ID一覧は getCurrentUserContext() がDB正本から取得済みなので、
    // buildHeaderUser の管理イベント等の補助queryだけが失敗してもその正本を使う。
    // Active Xを無条件でapproved扱いすると、承認取消直後などにUIだけ権限ありに
    // 見えるため、approval_statusもlinked rowから正規化する。
    const xIds = currentContext.linkedXUsers.map((entry) => ({
      x_user_id: entry.x_user_id,
      x_name: entry.x_name?.trim() || `@${entry.x_user_id}`,
      icon_url: entry.icon_url,
      approval_status: normalizeXIdApprovalStatus(entry.approval_status),
      is_active: entry.x_user_id === sessionUser.active_x_user_id,
    }));

    // 管理権限の補助取得失敗でもログイン済み要約は返す。
    return NextResponse.json(
      {
        loggedIn: true,
        degraded: true,
        displayName: sessionUser.name,
        icon: sessionUser.image,
        role: sessionUser.role,
        activeXId: sessionUser.active_x_user_id,
        xIds,
        canAccessAdmin: sessionUser.role === "admin",
        // staff の manage 可否は不明。false で上書きしないよう degraded を付ける。
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
