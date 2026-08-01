import "server-only";

import { and, eq, isNull, sql } from "drizzle-orm";
import type { CurrentUser } from "./currentUser";
import { xIdentityRequests, users } from "@/lib/db/schema";
import { getLinkedXUsersForAuthUser } from "./xIdentity";

type DrizzleDb = NonNullable<ReturnType<typeof import("@/lib/cloudflare").getDatabase>>;

/** settings 等の既存コンポーネントが参照する X 承認ステータス型。 */
export type XApprovalStatus = "approved" | "pending" | "rejected" | "imported";

/** オンボーディング向けの X 身元状態。 */
export type XIdentityOnboardingStatus = "none" | "pending" | "approved" | "rejected";

export type OnboardingState = {
  isLoggedIn: boolean;
  /** TOS 未同意・再同意要求が true のとき書き込み不可。 */
  needsTermsAcceptance: boolean;
  /** 最終的な X 身元状態。none: 未申請 / pending: 申請済み承認待ち / approved: 承認済み / rejected: 却下。 */
  xIdentityStatus: XIdentityOnboardingStatus;
  /** 最新の pending 申請の requested_x_id。null = pending 申請なし。 */
  requestedXId: string | null;
  /** active_x_user_id が承認済み (approved) のときの値。null = 投稿不可。 */
  activeApprovedXId: string | null;
  /** ログイン + TOS同意 + X申請済み(pending含む)が満たされているとき true。枠確保の最低条件。 */
  canReserveSlot: boolean;
  /** ログイン + TOS同意 + active X が approved のとき true。作品投稿の条件。 */
  canPost: boolean;
};

function checkNeedsTermsAcceptance(
  user: Pick<CurrentUser, "is_tos_accepted" | "terms_reaccept_required">,
): boolean {
  return user.is_tos_accepted !== 1 || user.terms_reaccept_required === 1;
}

export async function getOnboardingState(
  db: DrizzleDb | null,
  user: CurrentUser | null,
): Promise<OnboardingState> {
  const empty: OnboardingState = {
    isLoggedIn: false,
    needsTermsAcceptance: true,
    xIdentityStatus: "none",
    requestedXId: null,
    activeApprovedXId: null,
    canReserveSlot: false,
    canPost: false,
  };
  if (!user) return empty;

  const tosPending = checkNeedsTermsAcceptance(user);
  const activeXId = user.active_x_user_id;

  let xIdentityStatus: XIdentityOnboardingStatus = "none";
  let requestedXId: string | null = null;
  let activeApprovedXId: string | null = null;

  if (db) {
    const [linkedRows, pendingRequests] = await Promise.all([
      getLinkedXUsersForAuthUser(db, user.id),
      db
        .select({
          id: xIdentityRequests.id,
          requested_x_id: xIdentityRequests.requested_x_id,
        })
        .from(xIdentityRequests)
        .where(
          and(
            eq(xIdentityRequests.requested_by_auth_user_id, user.id),
            eq(xIdentityRequests.status, "pending"),
          )!,
        )
        .limit(1),
    ]);

    const activeXApprovalStatus =
      linkedRows.find((row) => row.x_user_id === activeXId)?.approval_status ?? null;
    const hasApprovedLinked = linkedRows.some((r) => r.approval_status === "approved");
    const hasPendingLinked = linkedRows.some((r) => r.approval_status === "pending");
    const hasRejectedOnly =
      linkedRows.length > 0 &&
      !hasApprovedLinked &&
      !hasPendingLinked &&
      pendingRequests.length === 0;

    // 投稿可否は承認済み Active X ID のみ。承認済み連携があっても active 未設定なら投稿不可。
    if (activeXApprovalStatus === "approved" && activeXId) {
      xIdentityStatus = "approved";
      activeApprovedXId = activeXId;
    } else if (hasApprovedLinked) {
      xIdentityStatus = "approved";
      activeApprovedXId = null;
    } else if (hasPendingLinked || pendingRequests.length > 0) {
      xIdentityStatus = "pending";
    } else if (hasRejectedOnly) {
      xIdentityStatus = "rejected";
    }

    requestedXId =
      pendingRequests[0]?.requested_x_id ??
      linkedRows.find((r) => r.approval_status === "pending")?.x_user_id ??
      linkedRows.find((r) => r.approval_status === "rejected")?.x_user_id ??
      null;
  }

  // DB 障害時は fail-closed: canPost/canReserveSlot は false のまま
  const canPost = !tosPending && activeApprovedXId != null;
  const canReserveSlot =
    !tosPending &&
    (xIdentityStatus === "pending" || xIdentityStatus === "approved");

  return {
    isLoggedIn: true,
    needsTermsAcceptance: tosPending,
    xIdentityStatus,
    requestedXId,
    activeApprovedXId,
    canReserveSlot,
    canPost,
  };
}

/**
 * 初回設定申請まで到達した日時を記録する。
 * `onboarding_completed_at` は認可判定に使わない。
 * 申請または承認済み X を持つ状態を「到達」とみなす。
 * `/onboarding` 到達時と、settings 等からの X 連携申請成功時に呼ぶ。
 */
export async function maybeMarkOnboardingComplete(
  db: DrizzleDb,
  authUserId: string,
  state: Pick<OnboardingState, "xIdentityStatus">,
): Promise<void> {
  const hasReachedOnboarding =
    state.xIdentityStatus === "pending" || state.xIdentityStatus === "approved";
  if (!hasReachedOnboarding) return;

  // 認可には使わない補助マーカーなので、申請保存後やページ表示を失敗扱いにしない。
  // 既に記録済みなら更新不要。行読取を避けるため条件付き UPDATE を使う。
  try {
    await db
      .update(users)
      .set({ onboarding_completed_at: Math.floor(Date.now() / 1000) })
      .where(and(eq(users.id, authUserId), isNull(users.onboarding_completed_at))!);
  } catch (error) {
    console.warn(
      JSON.stringify({
        service: "onboarding_marker",
        result: "failed",
        auth_user_id: authUserId,
        error_name: error instanceof Error ? error.name : "UnknownError",
      }),
    );
  }
}

export { onboardingHref, onboardingRulesHref, entryLoginRedirectTo } from "./onboardingUrls";
