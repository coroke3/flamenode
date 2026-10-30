/**
 * MIG-0641 U01f: one bounded D1 read for CURRENT SA-074 snapshots.
 *
 * The session + CostGuard pre-reads already consume the S2 statement budget;
 * terms version, current user and existing consent must share ONE statement.
 * This is read-only and is not exposed as an HTTP route.
 */
import type { TermsUserSnapshot } from "./termsConsentPlan.ts";

export const FALLBACK_TERMS_VERSION_ID = "fallback-current";

/** D1's raw row includes the milliseconds timestamp returned by SQLite. */
type TermsSnapshotRow = TermsUserSnapshot & {
  __terms_version_id: string;
  __existing_consent_id: string | null;
  emailVerified?: number | null;
};

export type TermsSnapshot = {
  userBefore: TermsUserSnapshot;
  termsVersionId: string;
  existingConsentId: string | null;
};

/**
 * CURRENT order: last published terms by published_at, updated_at; fallback
 * when none is published. The subquery uses the (user_id, terms_version_id)
 * index; LIMIT 1 prevents a duplicate consent row from widening the result.
 */
export const TERMS_SNAPSHOT_SQL = `
WITH latest AS (
  SELECT "id" FROM "terms_versions"
  WHERE "status" = 'published'
  ORDER BY "published_at" DESC, "updated_at" DESC LIMIT 1
),
version AS (
  SELECT COALESCE((SELECT "id" FROM latest), 'fallback-current') AS terms_id
)
SELECT u.*,
  version.terms_id AS __terms_version_id,
  (SELECT c."id" FROM "user_tos_consents" c
    WHERE c."user_id" = u."id" AND c."terms_version_id" = version.terms_id
    LIMIT 1) AS __existing_consent_id
FROM "user" u CROSS JOIN version
WHERE u."id" = ? LIMIT 1
`;

export async function loadTermsSnapshot(
  d1: Pick<D1Database, "prepare">,
  authenticatedUserId: string,
): Promise<TermsSnapshot | null> {
  const row = await d1.prepare(TERMS_SNAPSHOT_SQL).bind(authenticatedUserId).first<TermsSnapshotRow>();
  if (!row) return null;
  const { __terms_version_id, __existing_consent_id, ...user } = row;
  if (
    user.id !== authenticatedUserId ||
    typeof __terms_version_id !== "string" ||
    !__terms_version_id ||
    (__existing_consent_id !== null && typeof __existing_consent_id !== "string")
  ) throw new Error("invalid_terms_snapshot");
  // Drizzle's users.emailVerified is timestamp_ms, and CURRENT's audit before
  // snapshot contains Date|null rather than D1's raw millisecond number.
  let userBefore: TermsUserSnapshot = user;
  if (user.emailVerified !== null && user.emailVerified !== undefined) {
    if (!Number.isFinite(user.emailVerified)) throw new Error("invalid_terms_timestamp");
    // Number.isFinite alone accepts out-of-range timestamps. Reject invalid
    // Date objects before passing them to strict audit serialization.
    const verifiedAt = new Date(user.emailVerified);
    if (!Number.isFinite(verifiedAt.getTime())) throw new Error("invalid_terms_timestamp");
    userBefore = { ...user, emailVerified: verifiedAt };
  }
  return {
    userBefore,
    termsVersionId: __terms_version_id,
    existingConsentId: __existing_consent_id,
  };
}
