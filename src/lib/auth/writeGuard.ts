import "server-only";
import { and, eq } from "drizzle-orm";
import type { DB } from "@/lib/db/client";
import { getCurrentUser, type CurrentUser } from "./currentUser";
import { getDatabase } from "@/lib/cloudflare";
import { systemSettings, xIdentityRequests, xUsers } from "@/lib/db/schema";
import { getApprovedXIds } from "./ownership";
import {
  evaluateActiveXWriteAccess,
  evaluateCostGuardCore,
  evaluateWriteIdentity,
  type WriteFeatureKey,
} from "./writeGuardCore";

/**
 * 全書き込み入口で通す共通ガード。
 *
 * 判定順 (早期 deny):
 *   1. ログイン (unauthenticated)
 *   2. DB 接続 (db_unavailable)
 *   3. BAN (banned)              ← admin もブロック
 *   4. TOS 未同意 (tos_required) ← admin もブロック
 *   5. TOS 再同意要求 (tos_reaccept_required) ← admin もブロック
 *   6. CostGuard mode (maintenance_mode) ← admin もブロック
 *   7. CostGuard feature (cost_guard_blocked) ← admin もブロック
 *   8. Active X 未設定 (active_x_required)
 *   9. Active X rejected (active_x_rejected)
 *  10. Active X 未承認 (active_x_not_approved)
 *
 * 成功時は user, 正規化済み activeXId, 自分の承認済み X ID 一覧を返す。
 * 呼出元は戻り値の reason / message をそのまま VideoActionResult 等に詰められる。
 */

export type CostGuardFeatureKey = WriteFeatureKey;

type CostGuardCheckResult =
  | { blocked: false }
  | { blocked: true; reason: "mode" | "feature" };

async function evaluateCostGuard(
  db: DB,
  feature: CostGuardFeatureKey,
): Promise<CostGuardCheckResult> {
  const row = (
    await db
      .select({
        operation_mode: systemSettings.operation_mode,
        disabled_features_json: systemSettings.disabled_features_json,
        cost_guard_exception_until: systemSettings.cost_guard_exception_until,
        cost_guard_exception_features_json:
          systemSettings.cost_guard_exception_features_json,
      })
      .from(systemSettings)
      .where(eq(systemSettings.id, "default"))
      .limit(1)
  )[0];

  if (!row) return { blocked: true, reason: "mode" };
  return evaluateCostGuardCore({
    feature,
    operationMode: row.operation_mode,
    disabledFeaturesJson: row.disabled_features_json,
    exceptionUntil: row.cost_guard_exception_until,
    exceptionFeaturesJson: row.cost_guard_exception_features_json,
    now: Math.floor(Date.now() / 1000),
  });
}

export type WriteGuardOptions = {
  /** active_x_user_id が存在することを要求する。 */
  requireActiveXId?: boolean;
  /** active_x_user_id が approved であることを要求する (requireActiveXId も真として扱う)。 */
  requireApprovedActiveXId?: boolean;
  /**
   * 明示的な X 身元要件。指定時は requireActiveXId / requireApprovedActiveXId より優先する。
   * "none": X 不問。
   * "requested_x": pending 申請または active X を持つことを要求（枠確保に使用）。
   * "approved_active_x": approved な active X を要求（作品投稿に使用）。
   */
  identityRequirement?: "none" | "requested_x" | "approved_active_x";
  /** 必須のCostGuard機能キー。mode と disabled_features_json を確認する。 */
  feature: CostGuardFeatureKey;
  requiredRole?: "admin";
};

export type WriteGuardDenyReason =
  | "unauthenticated"
  | "db_unavailable"
  | "banned"
  | "tos_required"
  | "tos_reaccept_required"
  | "maintenance_mode"
  | "cost_guard_blocked"
  | "forbidden"
  | "active_x_required"
  | "active_x_rejected"
  | "active_x_not_approved";

export type WriteGuardSuccess = {
  ok: true;
  db: DB;
  user: CurrentUser;
  /** requireActiveXId / requireApprovedActiveXId / identityRequirement 指定時は必ず非 null（"requested_x" でpending申請のみの場合は null）。 */
  activeXId: string | null;
  /** 自分が linked かつ approved な X ID 一覧。 */
  approvedXIds: string[];
  /** identityRequirement: "requested_x" かつ activeXId=null のときに pending 申請があれば true。 */
  hasPendingXRequest: boolean;
};

export type WriteGuardFailure = {
  ok: false;
  reason: WriteGuardDenyReason;
  message: string;
};

export type WriteGuardResult = WriteGuardSuccess | WriteGuardFailure;

const MESSAGES: Record<WriteGuardDenyReason, string> = {
  unauthenticated: "ログインが必要です。",
  db_unavailable: "DB に接続できません。",
  banned: "現在、このアカウントは利用停止中です。",
  tos_required: "利用規約への同意が必要です。",
  tos_reaccept_required: "利用規約の最新版に再同意してください。",
  maintenance_mode:
    "現在、書き込みを一時停止しています (コストガード)。しばらく時間をおいてからお試しください。",
  cost_guard_blocked:
    "現在、この機能の書き込みは一時的に無効化されています。",
  forbidden: "この操作を実行する権限がありません。",
  active_x_required: "X ID を選択してから操作してください。",
  active_x_rejected:
    "選択中の X ID は却下されています。別の X ID を選択してください。",
  active_x_not_approved: "承認済みの X ID が必要です。",
};

function deny(reason: WriteGuardDenyReason): WriteGuardFailure {
  return { ok: false, reason, message: MESSAGES[reason] };
}


export async function writeGuard(
  options: WriteGuardOptions,
): Promise<WriteGuardResult> {
  const user = await getCurrentUser();
  if (!user) return deny("unauthenticated");

  const db = getDatabase();
  if (!db) return deny("db_unavailable");

  const identityDeny = evaluateWriteIdentity(user, options.requiredRole);
  if (identityDeny) return deny(identityDeny);

  try {
    const cg = await evaluateCostGuard(db, options.feature);
    if (cg.blocked) {
      return deny(
        cg.reason === "mode" ? "maintenance_mode" : "cost_guard_blocked",
      );
    }
  } catch {
    return deny("cost_guard_blocked");
  }

  // identityRequirement が指定された場合はそちらを優先する
  const idReq = options.identityRequirement;

  if (idReq === "none") {
    let approvedXIds: string[];
    try {
      approvedXIds = await getApprovedXIds(db, user.id);
    } catch {
      return deny("db_unavailable");
    }
    return { ok: true, db, user, activeXId: user.active_x_user_id, approvedXIds, hasPendingXRequest: false };
  }

  const activeXId = user.active_x_user_id;
  let approvedXIds: string[];
  let activeXApprovalStatus: string | null = null;
  let hasPendingXRequest = false;

  // "requested_x" + activeXId なし → pending 申請の有無を確認する
  const isRequestedXReq = idReq === "requested_x";
  const requireApprovedActiveXId =
    idReq === "approved_active_x" || options.requireApprovedActiveXId === true;
  const requireActiveXId =
    idReq === "approved_active_x" || options.requireActiveXId === true;
  const needActive = requireActiveXId || requireApprovedActiveXId || isRequestedXReq;

  try {
    approvedXIds = await getApprovedXIds(db, user.id);
    if (activeXId && needActive) {
      const xRow = (
        await db
          .select({ approval_status: xUsers.approval_status })
          .from(xUsers)
          .where(eq(xUsers.id, activeXId))
          .limit(1)
      )[0];
      activeXApprovalStatus = xRow?.approval_status ?? null;
    }
    if (isRequestedXReq && (!activeXId || activeXApprovalStatus === "rejected")) {
      const pendingRow = (
        await db
          .select({ id: xIdentityRequests.id })
          .from(xIdentityRequests)
          .where(
            and(
              eq(xIdentityRequests.requested_by_auth_user_id, user.id),
              eq(xIdentityRequests.status, "pending"),
            )!,
          )
          .limit(1)
      )[0];
      hasPendingXRequest = Boolean(pendingRow);
    }
  } catch {
    return deny("db_unavailable");
  }

  // "requested_x": 申請済み(pending)または active X（rejected以外）が必要。
  if (isRequestedXReq) {
    if (activeXId && activeXApprovalStatus === "rejected") {
      if (!hasPendingXRequest) return deny("active_x_rejected");
      return {
        ok: true,
        db,
        user,
        activeXId: null,
        approvedXIds,
        hasPendingXRequest: true,
      };
    }
    if (activeXId && activeXApprovalStatus != null) {
      return { ok: true, db, user, activeXId, approvedXIds, hasPendingXRequest };
    }
    if (hasPendingXRequest) {
      return {
        ok: true,
        db,
        user,
        activeXId: null,
        approvedXIds,
        hasPendingXRequest: true,
      };
    }
    return deny("active_x_required");
  }

  const activeXDeny = evaluateActiveXWriteAccess({
    requireActiveXId,
    requireApprovedActiveXId,
    activeXId,
    approvalStatus: activeXApprovalStatus,
    approvedXIds,
  });
  if (activeXDeny) return deny(activeXDeny);

  return { ok: true, db, user, activeXId, approvedXIds, hasPendingXRequest: false };
}

export async function requireAdminWrite(
  feature: CostGuardFeatureKey,
): Promise<WriteGuardResult> {
  return writeGuard({ feature, requiredRole: "admin" });
}

/**
 * CostGuardの手動mode/override制御専用。通常mutationから呼んではならない。
 * mode/feature判定だけを意図的に省き、認証・DB・BAN・TOS・adminはfail-closed。
 */
export async function requireCostGuardControlAdmin(): Promise<WriteGuardResult> {
  const user = await getCurrentUser();
  if (!user) return deny("unauthenticated");
  const db = getDatabase();
  if (!db) return deny("db_unavailable");
  const identityDeny = evaluateWriteIdentity(user, "admin");
  if (identityDeny) return deny(identityDeny);
  return {
    ok: true,
    db,
    user,
    activeXId: null,
    approvedXIds: [],
    hasPendingXRequest: false,
  };
}
