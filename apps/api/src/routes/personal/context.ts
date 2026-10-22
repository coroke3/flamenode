import type { PersonalUser, OnboardingState } from "@flamenode/contracts";
import { normalizeXId } from "@flamenode/domain/xid";
import { SLOT_RESERVATION_X_REQUEST_TYPES } from "@flamenode/domain/slots/reservationIdentity";
import type { SessionUser } from "../../auth/session.ts";
import { MAX_LINKED_X_USERS } from "./sql.ts";

// CURRENT: src/lib/auth/currentUser.ts (getCurrentUserContext), src/lib/auth/resolveActiveXId.ts,
// src/lib/auth/headerLinkedXUsers.ts, src/lib/terms/reaccept.ts, src/lib/auth/onboarding.ts.
//
// The session middleware (MIG-0608) already resolved id/name/image/role/is_banned/active_x_user_id from the
// `user` row, so only the terms columns and the linked X rows are read here. They are read in one D1 batch.

export interface LinkedXRow {
  x_user_id: string;
  x_name: string;
  icon_url: string | null;
  approval_status: string | null;
}

export interface TermsRow {
  is_tos_accepted: number | null;
  accepted_terms_version_id: string | null;
  terms_reaccept_required: number | null;
}

/**
 * is_tos_accepted / accepted_terms_version_id plus terms_reaccept_required derived from the latest published
 * major terms version (CURRENT getLatestPublishedMajorTerms + termsReacceptRequiredCondition, as one statement).
 */
export function termsStatement(db: D1Database, userId: string): D1PreparedStatement {
  return db
    .prepare(
      `WITH required_major AS (
         SELECT id, published_at FROM terms_versions
         WHERE severity = 'major' AND published_at IS NOT NULL
         ORDER BY published_at DESC, updated_at DESC
         LIMIT 1
       )
       SELECT u.is_tos_accepted AS is_tos_accepted,
         u.accepted_terms_version_id AS accepted_terms_version_id,
         CASE WHEN EXISTS (SELECT 1 FROM required_major WHERE published_at <> 0)
           AND u.is_tos_accepted = 1
           AND NOT (
             EXISTS (
               SELECT 1 FROM terms_versions accepted_terms
               WHERE accepted_terms.id = u.accepted_terms_version_id
                 AND accepted_terms.published_at IS NOT NULL
                 AND (accepted_terms.id = (SELECT id FROM required_major)
                   OR accepted_terms.published_at > (SELECT published_at FROM required_major))
             )
             OR EXISTS (
               SELECT 1 FROM user_tos_consents consent
               INNER JOIN terms_versions consent_terms ON consent_terms.id = consent.terms_version_id
               WHERE consent.user_id = u.id
                 AND consent_terms.published_at IS NOT NULL
                 AND (consent_terms.id = (SELECT id FROM required_major)
                   OR consent_terms.published_at > (SELECT published_at FROM required_major))
             )
           )
         THEN 1 ELSE 0 END AS terms_reaccept_required
       FROM "user" u WHERE u.id = ? LIMIT 1`,
    )
    .bind(userId);
}

/** CURRENT getHeaderLinkedXUsersForAuthUser (approval_status is not filtered). */
export function linkedXStatement(db: D1Database, userId: string): D1PreparedStatement {
  return db
    .prepare(
      `SELECT x_users.id AS x_user_id, x_users.x_name AS x_name, x_users.icon_url AS icon_url,
         x_users.approval_status AS approval_status
       FROM x_user_account_links
       INNER JOIN x_users ON x_users.id = x_user_account_links.x_user_id
       WHERE x_user_account_links.auth_user_id = ?
       LIMIT ?`,
    )
    .bind(userId, MAX_LINKED_X_USERS);
}

/** CURRENT pendingSlotReservationXRequestWhere + getOnboardingState's `limit(1)`. */
export function pendingRequestStatement(db: D1Database, userId: string): D1PreparedStatement {
  const types = SLOT_RESERVATION_X_REQUEST_TYPES;
  return db
    .prepare(
      `SELECT id, requested_x_id FROM x_identity_requests
       WHERE requested_by_auth_user_id = ? AND status = 'pending'
         AND request_type IN (${types.map(() => "?").join(", ")})
         AND requested_x_id IS NOT NULL
       ORDER BY requested_at DESC, id DESC
       LIMIT 1`,
    )
    .bind(userId, ...types);
}

/** CURRENT resolveActiveXUserId with the linked rows supplied (no extra query). */
export function resolveActiveXUserId(
  currentActiveXUserId: string | null,
  linkedRows: readonly Pick<LinkedXRow, "x_user_id" | "approval_status">[],
): string | null {
  const normalizedCurrent = normalizeXId(currentActiveXUserId) || null;
  const linkedIds = new Map<string, string>();
  for (const row of linkedRows) {
    if (row.approval_status !== "approved") continue;
    const normalized = normalizeXId(row.x_user_id);
    if (!normalized) continue;
    if (!linkedIds.has(normalized)) linkedIds.set(normalized, row.x_user_id);
  }
  if (linkedIds.size === 0) return null;
  if (normalizedCurrent && linkedIds.has(normalizedCurrent)) {
    return linkedIds.get(normalizedCurrent) ?? null;
  }
  return linkedIds.size === 1 ? Array.from(linkedIds.values())[0] ?? null : null;
}

/** CURRENT AuthSessionUser as built by getCurrentUserContext (name falls back to "ゲスト"). */
export function buildPersonalUser(
  sessionUser: SessionUser,
  terms: TermsRow,
  linkedRows: readonly Pick<LinkedXRow, "x_user_id" | "approval_status">[],
): PersonalUser {
  return {
    id: sessionUser.id,
    name: sessionUser.name ?? "ゲスト",
    image: sessionUser.image ?? null,
    role: sessionUser.role,
    is_banned: sessionUser.is_banned ?? 0,
    active_x_user_id: resolveActiveXUserId(sessionUser.active_x_user_id, linkedRows),
    is_tos_accepted: terms.is_tos_accepted ?? 0,
    accepted_terms_version_id: terms.accepted_terms_version_id ?? null,
    terms_reaccept_required: terms.terms_reaccept_required === 1 ? 1 : 0,
  };
}

/** CURRENT getOnboardingState's active-approved decision (no pending-request input needed). */
export function activeApprovedXId(
  activeXId: string | null,
  linkedRows: readonly Pick<LinkedXRow, "x_user_id" | "approval_status">[],
): string | null {
  const status = linkedRows.find((row) => row.x_user_id === activeXId)?.approval_status ?? null;
  return status === "approved" && activeXId ? activeXId : null;
}

/** CURRENT getOnboardingState for a logged-in user whose DB is available. */
export function computeOnboardingState(input: {
  user: Pick<PersonalUser, "is_tos_accepted" | "terms_reaccept_required" | "active_x_user_id">;
  linkedRows: readonly Pick<LinkedXRow, "x_user_id" | "approval_status">[];
  pendingRequest: { requested_x_id: string | null } | null;
}): OnboardingState {
  const { user, linkedRows, pendingRequest } = input;
  const tosPending = user.is_tos_accepted !== 1 || user.terms_reaccept_required === 1;
  const activeXId = user.active_x_user_id;
  const approvedActive = activeApprovedXId(activeXId, linkedRows);
  const hasApprovedLinked = linkedRows.some((r) => r.approval_status === "approved");
  const hasPendingLinked = linkedRows.some((r) => r.approval_status === "pending");
  const hasRejectedOnly =
    linkedRows.length > 0 && !hasApprovedLinked && !hasPendingLinked && !pendingRequest;

  let xIdentityStatus: OnboardingState["xIdentityStatus"] = "none";
  let activeApprovedXIdValue: string | null = null;
  if (approvedActive) {
    xIdentityStatus = "approved";
    activeApprovedXIdValue = approvedActive;
  } else if (hasApprovedLinked) {
    xIdentityStatus = "approved";
  } else if (hasPendingLinked || pendingRequest) {
    xIdentityStatus = "pending";
  } else if (hasRejectedOnly) {
    xIdentityStatus = "rejected";
  }

  return {
    needsTermsAcceptance: tosPending,
    xIdentityStatus,
    requestedXId: pendingRequest?.requested_x_id ?? null,
    activeApprovedXId: activeApprovedXIdValue,
    canReserveSlot: !tosPending,
    canPost: !tosPending && activeApprovedXIdValue != null,
  };
}

/** Unique approved X IDs, as CURRENT builds `approvedXIds` from the linked rows. */
export function approvedXIdsOf(
  linkedRows: readonly Pick<LinkedXRow, "x_user_id" | "approval_status">[],
): string[] {
  return Array.from(
    new Set(linkedRows.filter((row) => row.approval_status === "approved").map((row) => row.x_user_id)),
  );
}

export interface PersonalContext {
  user: PersonalUser;
  linkedRows: LinkedXRow[];
  pendingRequest: { id: string; requested_x_id: string | null } | null;
}

/**
 * Loads terms + linked X (+ optionally the latest pending request) in one D1 batch and builds the user.
 * Returns null when the user row vanished after the session was resolved (CURRENT treats it as logged out).
 */
export async function loadPersonalContext(
  db: D1Database,
  sessionUser: SessionUser,
  options: { pendingRequest: boolean },
): Promise<PersonalContext | null> {
  const statements = [termsStatement(db, sessionUser.id), linkedXStatement(db, sessionUser.id)];
  if (options.pendingRequest) statements.push(pendingRequestStatement(db, sessionUser.id));
  const [termsResult, linkedResult, pendingResult] = await db.batch(statements);
  const terms = (termsResult?.results as TermsRow[] | undefined)?.[0];
  if (!terms) return null;
  const linkedRows = (linkedResult?.results ?? []) as unknown as LinkedXRow[];
  const pendingRequest =
    (pendingResult?.results as Array<{ id: string; requested_x_id: string | null }> | undefined)?.[0] ?? null;
  return { user: buildPersonalUser(sessionUser, terms, linkedRows), linkedRows, pendingRequest };
}
