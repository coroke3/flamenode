import "server-only";
import { eq } from "drizzle-orm";
import { getCurrentUser, type CurrentUser } from "./currentUser";
import { getDatabase } from "@/lib/cloudflare";
import { xUsers } from "@/lib/db/schema";
import { getApprovedXIds } from "./ownership";
import {
  evaluateCostGuard,
  type CostGuardFeatureKey,
} from "./costGuardFeatures";
import { evaluateWriteIdentity } from "./writeGuardCore";

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

export type WriteGuardOptions = {
  /** active_x_user_id が存在することを要求する。 */
  requireActiveXId?: boolean;
  /** active_x_user_id が approved であることを要求する (requireActiveXId も真として扱う)。 */
  requireApprovedActiveXId?: boolean;
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
  user: CurrentUser;
  /** requireActiveXId / requireApprovedActiveXId 指定時は必ず非 null。 */
  activeXId: string | null;
  /** 自分が linked かつ approved な X ID 一覧。 */
  approvedXIds: string[];
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

export { getOnboardingHrefForWriteGuardReason } from "./onboardingUrls";

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

  const needActive =
    options.requireActiveXId === true ||
    options.requireApprovedActiveXId === true;

  const activeXId = user.active_x_user_id;

  if (needActive) {
    if (!activeXId) return deny("active_x_required");
    const xRow = (
      await db
        .select({ approval_status: xUsers.approval_status })
        .from(xUsers)
        .where(eq(xUsers.id, activeXId))
        .limit(1)
    )[0];
    if (!xRow) return deny("active_x_required");
    if (xRow.approval_status === "rejected") {
      return deny("active_x_rejected");
    }
    if (
      options.requireApprovedActiveXId === true &&
      xRow.approval_status !== "approved"
    ) {
      return deny("active_x_not_approved");
    }
  }

  const approvedXIds = await getApprovedXIds(db, user.id);

  return { ok: true, user, activeXId, approvedXIds };
}

export async function requireAdminWrite(
  feature: CostGuardFeatureKey,
): Promise<WriteGuardResult> {
  return writeGuard({ feature, requiredRole: "admin" });
}

/**
 * CostGuard override設定専用。通常mutationから呼んではならない。
 * mode/feature判定だけを意図的に省き、認証・DB・BAN・TOS・adminはfail-closed。
 */
export async function requireCostGuardOverrideAdmin(): Promise<WriteGuardResult> {
  const user = await getCurrentUser();
  if (!user) return deny("unauthenticated");
  const db = getDatabase();
  if (!db) return deny("db_unavailable");
  const identityDeny = evaluateWriteIdentity(user, "admin");
  if (identityDeny) return deny(identityDeny);
  const approvedXIds = await getApprovedXIds(db, user.id);
  return {
    ok: true,
    user,
    activeXId: user.active_x_user_id,
    approvedXIds,
  };
}
