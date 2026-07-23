import "server-only";

import { cache } from "react";
import type { Session } from "next-auth";
import { and, eq, inArray } from "drizzle-orm";
import { unstable_rethrow } from "next/navigation";
import {
  CurrentUserUnavailableError,
  getCurrentUser,
  type CurrentUser,
} from "@/lib/auth/currentUser";
import { getAuthSession } from "@/lib/auth/session";
import { withDatabaseRead } from "@/lib/cloudflare";
import {
  eventStaff,
  xIdentityRequests,
  xUserAccountLinks,
  xUsers,
} from "@/lib/db/schema";
import { resolveStaffPermissionKeys } from "@/lib/auth/permissions/permissionResolver";
import type { HeaderUser } from "@/lib/auth/headerUser";
import { normalizeXId } from "@/lib/utils/xid";
import { logFlowTrace } from "@/lib/observability/flowTrace";

export type MinimalHeaderUser = HeaderUser;

export type MinimalOnboardingState = {
  needsXIdOnboarding: boolean;
  hasLinkedXId: boolean;
  hasPendingXIdRequest: boolean;
};

export type RequestAuthContext = {
  session: Session | null;
  currentUser: CurrentUser | null;
  headerUser: MinimalHeaderUser | null;
  onboarding: MinimalOnboardingState;
  /** management/onboarding 付加情報の取得失敗。認可ゲートでは false-negative にしない。 */
  enrichmentFailed: boolean;
};

async function loadManagementAccess(
  authUserId: string,
  role: CurrentUser["role"],
): Promise<HeaderUser["management"]> {
  if (role === "admin") {
    return {
      canAccessAdmin: true,
      canAccessManage: true,
      manageableEventCount: 0,
    };
  }

  const canAccessManage = await withDatabaseRead(async (db) => {
    const approved = await db
      .select({ x_user_id: xUserAccountLinks.x_user_id })
      .from(xUserAccountLinks)
      .innerJoin(xUsers, eq(xUsers.id, xUserAccountLinks.x_user_id))
      .where(
        and(
          eq(xUserAccountLinks.auth_user_id, authUserId),
          eq(xUsers.approval_status, "approved"),
        ),
      )
      .limit(32);
    const xIds = approved.map((row) => row.x_user_id);
    if (xIds.length === 0) return false;

    const rows = await db
      .select({
        permission_preset: eventStaff.permission_preset,
        custom_permission_keys_json: eventStaff.custom_permission_keys_json,
      })
      .from(eventStaff)
      .where(inArray(eventStaff.x_user_id, xIds))
      .limit(24);

    return rows.some((row) => resolveStaffPermissionKeys(row).size > 0);
  });

  return {
    canAccessAdmin: false,
    canAccessManage: canAccessManage === true,
    manageableEventCount: 0,
  };
}

async function loadOnboardingFlags(
  authUserId: string,
  role: CurrentUser["role"],
): Promise<MinimalOnboardingState> {
  if (role === "admin" || role === "moderator") {
    return {
      needsXIdOnboarding: false,
      hasLinkedXId: true,
      hasPendingXIdRequest: false,
    };
  }

  const flags = await withDatabaseRead(async (db) => {
    const [linked, pending] = await Promise.all([
      db
        .select({ x_user_id: xUserAccountLinks.x_user_id })
        .from(xUserAccountLinks)
        .where(eq(xUserAccountLinks.auth_user_id, authUserId))
        .limit(1),
      db
        .select({ id: xIdentityRequests.id })
        .from(xIdentityRequests)
        .where(
          and(
            eq(xIdentityRequests.requested_by_auth_user_id, authUserId),
            eq(xIdentityRequests.status, "pending"),
          )!,
        )
        .limit(1),
    ]);
    return {
      hasLinkedXId: linked.length > 0,
      hasPendingXIdRequest: pending.length > 0,
    };
  });

  if (!flags) {
    return {
      needsXIdOnboarding: false,
      hasLinkedXId: false,
      hasPendingXIdRequest: false,
    };
  }

  return {
    needsXIdOnboarding: !flags.hasLinkedXId && !flags.hasPendingXIdRequest,
    hasLinkedXId: flags.hasLinkedXId,
    hasPendingXIdRequest: flags.hasPendingXIdRequest,
  };
}

function buildMinimalHeaderUser(
  user: CurrentUser,
  management: HeaderUser["management"],
): MinimalHeaderUser {
  const active = normalizeXId(user.active_x_user_id) || null;
  return {
    id: user.id,
    name: user.name?.trim() || "guest",
    image: user.image,
    role: user.role,
    // 初期SSRは Active だけ。切替一覧はメニュー展開時に /api/account/summary で取得。
    xIds: active
      ? [
          {
            x_user_id: active,
            x_name: `@${active}`,
            icon_url: user.image,
            approval_status: "approved",
            is_active: true,
          },
        ]
      : [],
    management,
  };
}

async function loadRequestAuthContext(): Promise<RequestAuthContext> {
  const started = Date.now();
  const traceId = crypto.randomUUID().slice(0, 8);

  let session: Session | null = null;
  try {
    session = await getAuthSession();
    logFlowTrace({
      flow: "request_auth",
      phase: "session_resolved",
      trace_id: traceId,
      result: "succeeded",
      duration_ms: Date.now() - started,
    });
  } catch (error) {
    unstable_rethrow(error);
    logFlowTrace({
      flow: "request_auth",
      phase: "session_resolved",
      trace_id: traceId,
      result: "failed",
      error_code: "auth_temporarily_unavailable",
    });
    throw new CurrentUserUnavailableError("auth_temporarily_unavailable", error);
  }

  let currentUser: CurrentUser | null;
  try {
    currentUser = await getCurrentUser();
  } catch (error) {
    unstable_rethrow(error);
    throw error;
  }

  if (!currentUser || currentUser.is_banned === 1) {
    return {
      session,
      currentUser: currentUser?.is_banned === 1 ? currentUser : null,
      headerUser: null,
      onboarding: {
        needsXIdOnboarding: false,
        hasLinkedXId: false,
        hasPendingXIdRequest: false,
      },
      enrichmentFailed: false,
    };
  }

  let management: HeaderUser["management"] = {
    canAccessAdmin: currentUser.role === "admin",
    canAccessManage: currentUser.role === "admin",
    manageableEventCount: 0,
  };
  let onboarding: MinimalOnboardingState = {
    needsXIdOnboarding: false,
    hasLinkedXId: false,
    hasPendingXIdRequest: false,
  };

  let enrichmentFailed = false;
  try {
    const [mgmt, onboardingFlags] = await Promise.all([
      loadManagementAccess(currentUser.id, currentUser.role),
      loadOnboardingFlags(currentUser.id, currentUser.role),
    ]);
    management = mgmt;
    onboarding = onboardingFlags;
  } catch (error) {
    unstable_rethrow(error);
    enrichmentFailed = true;
    // 追加情報の失敗でログイン表示自体を消さない。
    logFlowTrace({
      flow: "request_auth",
      phase: "header_enrichment",
      trace_id: traceId,
      result: "failed",
      error_code: "header_enrichment_failed",
      retryable: true,
    });
  }

  logFlowTrace({
    flow: "request_auth",
    phase: "context_ready",
    trace_id: traceId,
    result: "succeeded",
    duration_ms: Date.now() - started,
  });

  return {
    session,
    currentUser,
    headerUser: buildMinimalHeaderUser(currentUser, management),
    onboarding,
    enrichmentFailed,
  };
}

/** 同一 Server Component request 内の認証関連取得を1回にまとめる。 */
export const getRequestAuthContext = cache(loadRequestAuthContext);

/** layout 用: 追加情報失敗でもログイン済みヘッダーを返す。 */
export async function getLayoutAuthSurface(): Promise<{
  currentUser: CurrentUser | null;
  headerUser: MinimalHeaderUser | null;
  needsXIdOnboarding: boolean;
  enrichmentFailed: boolean;
}> {
  const ctx = await getRequestAuthContext();
  return {
    currentUser: ctx.currentUser,
    headerUser: ctx.headerUser,
    needsXIdOnboarding: ctx.onboarding.needsXIdOnboarding,
    enrichmentFailed: ctx.enrichmentFailed,
  };
}
