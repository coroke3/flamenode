import "server-only";

import { cache } from "react";
import type { Session } from "next-auth";
import { desc, eq } from "drizzle-orm";
import { unstable_rethrow } from "next/navigation";
import {
  CurrentUserUnavailableError,
  getCurrentUser,
  type CurrentUser,
} from "@/lib/auth/currentUser";
import { getAuthSession } from "@/lib/auth/session";
import { withDatabaseRead } from "@/lib/cloudflare";
import {
  xIdentityRequests,
  xUserAccountLinks,
} from "@/lib/db/schema";
import { getManageAuthorizationSnapshot } from "@/lib/auth/manageAuthorization";
import type { HeaderUser } from "@/lib/auth/headerUser";
import { normalizeXId } from "@/lib/utils/xid";
import { pendingSlotReservationXRequestWhere } from "@/lib/slots/reservationIdentity";
import { logFlowTrace } from "@/lib/observability/flowTrace";

export type MinimalHeaderUser = HeaderUser;

export type MinimalOnboardingState = {
  /** 連携 X も pending 申請もないとき true。layout 強制リダイレクトには使わない（表示・将来用）。 */
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

type RequestAuthBase = {
  session: Session | null;
  currentUser: CurrentUser | null;
  traceId: string;
  started: number;
};

function emptyOnboarding(): MinimalOnboardingState {
  return {
    needsXIdOnboarding: false,
    hasLinkedXId: false,
    hasPendingXIdRequest: false,
  };
}

function defaultManagement(
  user: CurrentUser,
): HeaderUser["management"] {
  return {
    canAccessAdmin: user.role === "admin",
    canAccessManage: user.role === "admin",
    manageableEventCount: 0,
  };
}

async function loadManagementAccess(
  authUserId: string,
  role: CurrentUser["role"],
): Promise<HeaderUser["management"]> {
  const snapshot = await getManageAuthorizationSnapshot(authUserId, role);

  return {
    canAccessAdmin: snapshot.canAccessAdmin,
    canAccessManage: snapshot.canAccessManage,
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
        .where(pendingSlotReservationXRequestWhere(authUserId))
        .orderBy(desc(xIdentityRequests.requested_at), desc(xIdentityRequests.id))
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

/** session/currentUserだけを読む共通base。onboarding readは含めない。 */
async function loadRequestAuthBase(): Promise<RequestAuthBase> {
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

  return { session, currentUser, traceId, started };
}

/** 同一Server Component request内のbase認証を共有する。 */
export const getRequestAuthBase = cache(loadRequestAuthBase);

function unauthenticatedContext(
  session: Session | null,
  currentUser: CurrentUser | null,
): RequestAuthContext {
  return {
    session,
    currentUser: currentUser?.is_banned === 1 ? currentUser : null,
    headerUser: null,
    onboarding: emptyOnboarding(),
    enrichmentFailed: false,
  };
}

async function loadRequestAuthContext(): Promise<RequestAuthContext> {
  const { session, currentUser, traceId, started } = await getRequestAuthBase();

  if (!currentUser || currentUser.is_banned === 1) {
    return unauthenticatedContext(session, currentUser);
  }

  let management = defaultManagement(currentUser);
  let onboarding = emptyOnboarding();

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

/**
 * layout用: onboarding用のlinked/pending readを実行せず、
 * session/currentUser + managementだけを解決する。
 */
async function loadLayoutAuthSurface(): Promise<{
  currentUser: CurrentUser | null;
  headerUser: MinimalHeaderUser | null;
  enrichmentFailed: boolean;
}> {
  const { currentUser, traceId, started } = await getRequestAuthBase();
  if (!currentUser || currentUser.is_banned === 1) {
    return {
      currentUser: currentUser?.is_banned === 1 ? currentUser : null,
      headerUser: null,
      enrichmentFailed: false,
    };
  }

  let management = defaultManagement(currentUser);
  let enrichmentFailed = false;
  try {
    management = await loadManagementAccess(currentUser.id, currentUser.role);
  } catch (error) {
    unstable_rethrow(error);
    enrichmentFailed = true;
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
    currentUser,
    headerUser: buildMinimalHeaderUser(currentUser, management),
    enrichmentFailed,
  };
}

/** 同一Server Component request内のlayout surfaceを共有する。 */
export const getLayoutAuthSurface = cache(loadLayoutAuthSurface);
