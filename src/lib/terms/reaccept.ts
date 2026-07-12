import { and, desc, eq, isNotNull, sql, type SQL } from "drizzle-orm";
import type { DB } from "../db/client.ts";
import { termsVersions, users } from "../db/schema.ts";

export type RequiredMajorTerms = Pick<
  typeof termsVersions.$inferSelect,
  "id" | "published_at" | "updated_at"
>;

/** 現在のstatusではなく、一度公開されたmajor版のうち最新を正本にする。 */
export async function getLatestPublishedMajorTerms(
  db: DB,
): Promise<RequiredMajorTerms | null> {
  return (await db
    .select({
      id: termsVersions.id,
      published_at: termsVersions.published_at,
      updated_at: termsVersions.updated_at,
    })
    .from(termsVersions)
    .where(and(
      eq(termsVersions.severity, "major"),
      isNotNull(termsVersions.published_at),
    )!)
    .orderBy(desc(termsVersions.published_at), desc(termsVersions.updated_at))
    .limit(1))[0] ?? null;
}

/**
 * usersの保存flagは判定に使わない。accepted mirrorまたはconsent履歴が最後の
 * major版そのもの、またはそれより後に公開された規約なら再同意済みとみなす。
 */
export function termsReacceptRequiredCondition(
  requiredMajor: RequiredMajorTerms | null,
): SQL {
  if (!requiredMajor?.published_at) return sql`0 = 1`;
  const publishedAt = requiredMajor.published_at;
  return sql`
    ${users.is_tos_accepted} = 1
    AND NOT (
      EXISTS (
        SELECT 1
        FROM terms_versions accepted_terms
        WHERE accepted_terms.id = ${users.accepted_terms_version_id}
          AND accepted_terms.published_at IS NOT NULL
          AND (
            accepted_terms.id = ${requiredMajor.id}
            OR accepted_terms.published_at > ${publishedAt}
          )
      )
      OR EXISTS (
        SELECT 1
        FROM user_tos_consents consent
        INNER JOIN terms_versions consent_terms
          ON consent_terms.id = consent.terms_version_id
        WHERE consent.user_id = ${users.id}
          AND consent_terms.published_at IS NOT NULL
          AND (
            consent_terms.id = ${requiredMajor.id}
            OR consent_terms.published_at > ${publishedAt}
          )
      )
    )
  `;
}

export function termsReacceptRequiredValue(
  requiredMajor: RequiredMajorTerms | null,
): SQL<number> {
  return sql<number>`CASE WHEN ${termsReacceptRequiredCondition(requiredMajor)} THEN 1 ELSE 0 END`;
}
