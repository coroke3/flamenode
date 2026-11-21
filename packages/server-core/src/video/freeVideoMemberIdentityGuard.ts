import { sql, type SQL } from "drizzle-orm";
import { isCanonicalXId } from "@flamenode/domain/xid";

/**
 * MIG-0651 SA-086 UNMOUNTED: assert the pre-read member X identity mappings
 * still resolve to the same canonical X ID *inside the write transaction*.
 *
 * Mirrors the canonical resolver: raw X handles can be direct, aliases to one
 * non-rejected target, or not-found pending placeholders. Valid direct rows
 * conflicting with an alias must fail. A new direct X row may race a pending
 * placeholder ONLY if it resolves to the very same normalized canonical id.
 * Previously existing direct/alias X records may NOT silently disappear.
 * Rejected/ambiguous/retargeted mappings must abort the complete D1 batch.
 *
 * This statement MUST be executed as a SELECT (not swallowed or omitted) and
 * placed before any x_users/video_members/video_chapters mutation. SQLite's
 * invalid-json branch raises an error to stop the entire D1 transaction.
 */
export function buildFreeVideoMemberIdentityGuardSql(
  identities: readonly { candidate: string; canonical: string; allowAbsent: boolean }[],
): SQL {
  if (identities.length < 1 || identities.length > 100 ||
      identities.some(({ candidate, canonical, allowAbsent }) =>
        !isCanonicalXId(candidate) || !isCanonicalXId(canonical) ||
        typeof allowAbsent !== "boolean") ||
      new Set(identities.map(row => row.candidate)).size !== identities.length) {
    throw new Error("free_video_member_identity_guard_arguments_invalid");
  }
  const payload = JSON.stringify(identities);
  return sql`
    WITH incoming AS (
      SELECT json_extract(value, '$.candidate') AS raw_id,
             json_extract(value, '$.canonical') AS target_id,
             json_extract(value, '$.allowAbsent') AS allow_absent
      FROM json_each(${payload})
    ),
    direct AS (
      SELECT i.raw_id, COUNT(d.id) AS direct_count,
        SUM(CASE WHEN d.id IS NOT NULL
          AND COALESCE(d.approval_status, '') IN ('pending','approved','imported')
          AND lower(trim(ltrim(trim(d.id), '@'))) = i.target_id
          THEN 1 ELSE 0 END) AS matching_direct,
        SUM(CASE WHEN d.id IS NOT NULL
          AND COALESCE(d.approval_status, '') IN ('pending','approved','imported')
          AND lower(trim(ltrim(trim(d.id), '@'))) <> i.target_id
          THEN 1 ELSE 0 END) AS different_direct
      FROM incoming i
      LEFT JOIN x_users d ON lower(trim(ltrim(trim(d.id), '@'))) = i.raw_id
      GROUP BY i.raw_id
    ),
    aliases AS (
      SELECT i.raw_id, COUNT(a.alias_x_id) AS alias_count,
        SUM(CASE WHEN a.alias_x_id IS NOT NULL AND (
          target.id IS NULL
          OR COALESCE(target.approval_status, '') NOT IN ('pending','approved','imported')
          OR lower(trim(ltrim(trim(target.id), '@'))) <> i.target_id
        ) THEN 1 ELSE 0 END) AS bad_alias_count
      FROM incoming i
      LEFT JOIN x_user_aliases a
        ON lower(trim(ltrim(trim(a.alias_x_id), '@'))) = i.raw_id
      LEFT JOIN x_users target
        ON lower(trim(ltrim(trim(target.id), '@'))) =
           lower(trim(ltrim(trim(a.x_user_id), '@')))
      GROUP BY i.raw_id
    )
    SELECT CASE WHEN NOT EXISTS (
      SELECT 1 FROM incoming i
      JOIN direct d ON d.raw_id = i.raw_id
      JOIN aliases a ON a.raw_id = i.raw_id
      WHERE d.direct_count > 1
         OR (
           a.alias_count = 0 AND NOT (
             (d.direct_count = 0 AND i.target_id = i.raw_id AND i.allow_absent = 1)
             OR (d.direct_count = 1 AND d.matching_direct = 1)
           )
         )
         OR (
           a.alias_count > 0 AND (
             a.bad_alias_count > 0 OR d.different_direct > 0
           )
         )
    )
    THEN 1 ELSE json_extract('not-valid-json', '$') END
  `;
}
