import { unstable_rethrow } from "next/navigation";
import { NextResponse } from "next/server";
import { buildHeaderUser } from "@/lib/auth/headerUser";
import {
  getAccountSummaryCurrentUserContext,
  CurrentUserUnavailableError,
} from "@/lib/auth/currentUser";
import { getAuthSession } from "@/lib/auth/session";
import type {
  AccountPresenceResponse,
  AccountSummaryResponse,
} from "@/lib/account/summary";
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

function presenceLoggedOut(): NextResponse<AccountPresenceResponse> {
  return NextResponse.json(
    { view: "presence", loggedIn: false },
    { headers: PRIVATE_HEADERS },
  );
}

async function getPresence(
  request: Request,
): Promise<NextResponse<AccountPresenceResponse>> {
  // A missing/empty Cookie header proves there is no Auth.js session cookie,
  // regardless of the configured cookie name or HTTPS prefix. Any non-empty
  // Cookie header still goes through Auth.js; cookie contents never authorize.
  if (!request.headers.get("cookie")?.trim()) return presenceLoggedOut();

  try {
    const session = await getAuthSession();
    const sessionUser = session?.user as
      | {
          id?: string | null;
          name?: string | null;
          image?: string | null;
          is_banned?: number | null;
        }
      | undefined;

    if (!sessionUser?.id || sessionUser.is_banned === 1) {
      return presenceLoggedOut();
    }

    return NextResponse.json(
      {
        view: "presence",
        loggedIn: true,
        displayName: sessionUser.name?.trim() || "guest",
        icon: sessionUser.image ?? null,
      },
      { headers: PRIVATE_HEADERS },
    );
  } catch (error) {
    unstable_rethrow(error);
    return NextResponse.json(
      { view: "presence", loggedIn: false, unavailable: true },
      { status: 503, headers: PRIVATE_HEADERS },
    );
  }
}

async function getDetails(): Promise<NextResponse<AccountSummaryResponse>> {
  let currentContext;
  try {
    currentContext = await getAccountSummaryCurrentUserContext();
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
    // account summary context が同一requestでDB正本から解決済みの
    // role / active X / linked X rowsを再利用し、Auth.js sessionを認可根拠にしない。
    headerUser = await buildHeaderUser(sessionUser, {
      authoritativeUserSnapshot: {
        role: sessionUser.role,
        active_x_user_id: sessionUser.active_x_user_id,
      },
      authoritativeLinkedXRows: currentContext.linkedXUsers,
    });
  } catch {
    // X ID一覧は account summary context がDB正本から取得済みなので、
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

export async function GET(
  request: Request,
): Promise<NextResponse<AccountSummaryResponse | AccountPresenceResponse>> {
  if (new URL(request.url).searchParams.get("view") === "presence") {
    return getPresence(request);
  }
  return getDetails();
}
