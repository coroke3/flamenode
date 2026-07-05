import "server-only";

import { and, eq, isNull } from "drizzle-orm";
import type { CurrentUser } from "./currentUser";
import {
  xAccountLinkRequests,
  xUsers,
  users,
} from "@/lib/db/schema";

type DrizzleDb = NonNullable<ReturnType<typeof import("@/lib/cloudflare").getDatabase>>;

export type XApprovalStatus = "approved" | "pending" | "rejected" | "imported";

export type OnboardingStepStatus = "done" | "action" | "pending" | "waiting";

export type OnboardingState = {
  isLoggedIn: boolean;
  needsTosAccept: boolean;
  hasLinkedXId: boolean;
  hasPendingXIdRequest: boolean;
  hasPendingLinkedXId: boolean;
  hasApprovedActiveXId: boolean;
  canPost: boolean;
  isComplete: boolean;
  activeXId: string | null;
  activeXApprovalStatus: XApprovalStatus | null;
  pendingRequestCount: number;
  onboardingCompletedAt: number | null;
};

function needsTosAccept(user: Pick<
  CurrentUser,
  "is_tos_accepted" | "terms_reaccept_required"
>): boolean {
  return user.is_tos_accepted !== 1 || user.terms_reaccept_required === 1;
}

export async function getOnboardingState(
  db: DrizzleDb | null,
  user: CurrentUser | null,
): Promise<OnboardingState> {
  const empty: OnboardingState = {
    isLoggedIn: false,
    needsTosAccept: true,
    hasLinkedXId: false,
    hasPendingXIdRequest: false,
    hasPendingLinkedXId: false,
    hasApprovedActiveXId: false,
    canPost: false,
    isComplete: false,
    activeXId: null,
    activeXApprovalStatus: null,
    pendingRequestCount: 0,
    onboardingCompletedAt: null,
  };

  if (!user) return empty;

  const tosPending = needsTosAccept(user);
  const activeXId = user.active_x_user_id;
  let hasLinkedXId = false;
  let hasPendingLinkedXId = false;
  let hasPendingXIdRequest = false;
  let pendingRequestCount = 0;
  let activeXApprovalStatus: XApprovalStatus | null = null;
  let onboardingCompletedAt: number | null = null;

  if (db) {
    const userRow = (
      await db
        .select({ onboarding_completed_at: users.onboarding_completed_at })
        .from(users)
        .where(eq(users.id, user.id))
        .limit(1)
    )[0];
    onboardingCompletedAt = userRow?.onboarding_completed_at ?? null;

    const linkedRows = await db
      .select({ approval_status: xUsers.approval_status })
      .from(xUsers)
      .where(eq(xUsers.linked_discord_user_id, user.id));
    hasLinkedXId = linkedRows.length > 0;
    hasPendingLinkedXId = linkedRows.some((row) => row.approval_status === "pending");

    const pendingRequests = await db
      .select({ id: xAccountLinkRequests.id })
      .from(xAccountLinkRequests)
      .where(
        and(
          eq(xAccountLinkRequests.discord_user_id, user.id),
          eq(xAccountLinkRequests.status, "pending"),
        )!,
      );
    pendingRequestCount = pendingRequests.length;
    hasPendingXIdRequest = pendingRequestCount > 0;

    if (activeXId) {
      const activeRow = (
        await db
          .select({ approval_status: xUsers.approval_status })
          .from(xUsers)
          .where(eq(xUsers.id, activeXId))
          .limit(1)
      )[0];
      activeXApprovalStatus = activeRow?.approval_status ?? null;
    }
  }

  const hasApprovedActiveXId = activeXApprovalStatus === "approved";
  const hasPendingXId =
    hasPendingXIdRequest || hasPendingLinkedXId;
  const canPost = !tosPending && hasApprovedActiveXId;
  const isComplete = !tosPending && (hasApprovedActiveXId || hasPendingXId);

  return {
    isLoggedIn: true,
    needsTosAccept: tosPending,
    hasLinkedXId,
    hasPendingXIdRequest,
    hasPendingLinkedXId,
    hasApprovedActiveXId,
    canPost,
    isComplete,
    activeXId,
    activeXApprovalStatus,
    pendingRequestCount,
    onboardingCompletedAt,
  };
}

export async function maybeMarkOnboardingComplete(
  db: DrizzleDb,
  userId: string,
  state: OnboardingState,
): Promise<void> {
  if (!state.isComplete || state.onboardingCompletedAt != null) return;
  const now = Math.floor(Date.now() / 1000);
  await db
    .update(users)
    .set({ onboarding_completed_at: now })
    .where(
      and(eq(users.id, userId), isNull(users.onboarding_completed_at))!,
    );
}

export {
  onboardingHref,
  onboardingRulesHref,
  entryLoginRedirectTo,
  getOnboardingHrefForWriteGuardReason,
} from "./onboardingUrls";

export function resolveOnboardingStepStatuses(
  state: OnboardingState,
): {
  login: OnboardingStepStatus;
  terms: OnboardingStepStatus;
  xId: OnboardingStepStatus;
  ready: OnboardingStepStatus;
} {
  if (!state.isLoggedIn) {
    return {
      login: "action",
      terms: "waiting",
      xId: "waiting",
      ready: "waiting",
    };
  }

  if (state.needsTosAccept) {
    return {
      login: "done",
      terms: "action",
      xId: "waiting",
      ready: "waiting",
    };
  }

  if (state.hasApprovedActiveXId) {
    return {
      login: "done",
      terms: "done",
      xId: "done",
      ready: state.canPost ? "done" : "action",
    };
  }

  if (state.hasPendingXIdRequest || state.hasPendingLinkedXId) {
    return {
      login: "done",
      terms: "done",
      xId: "pending",
      ready: "waiting",
    };
  }

  if (state.activeXApprovalStatus === "rejected") {
    return {
      login: "done",
      terms: "done",
      xId: "action",
      ready: "waiting",
    };
  }

  return {
    login: "done",
    terms: "done",
    xId: "action",
    ready: "waiting",
  };
}
