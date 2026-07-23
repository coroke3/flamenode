import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { buildHeaderUser } from "@/lib/auth/headerUser";
import {
  CurrentUserUnavailableError,
  getCurrentUser,
} from "@/lib/auth/currentUser";
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

  const session = await auth();
  const headerUser = await buildHeaderUser(session?.user);
  if (!headerUser) {
    return loggedOut();
  }

  const activeEntry = headerUser.xIds.find((entry) => entry.is_active);

  const body: AccountSummaryResponse = {
    loggedIn: true,
    displayName: headerUser.name,
    icon: headerUser.image,
    role: headerUser.role,
    activeXId: activeEntry?.x_user_id ?? null,
    xIds: headerUser.xIds,
    canAccessAdmin: headerUser.management.canAccessAdmin,
    canAccessManage: headerUser.management.canAccessManage,
  };

  return NextResponse.json(body, { headers: PRIVATE_HEADERS });
}
