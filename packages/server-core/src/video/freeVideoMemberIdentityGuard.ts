import { sql, type SQL } from "drizzle-orm";
import { isCanonicalXId } from "@flamenode/domain/xid";

/**
 * MIG-0651 SA-086 UNMOUNTED: assert the pre-read member X identity mappings
 * still resolve to the same canonical X ID *inside the write transaction*.
 *
 * Mirrors the canonical resolver: raw X handles can be direct, aliases to one
 * non-rejected target, or not-found pending placeholders. Valid direct rows
 * conflicting with an alias must fail. A previously absent X placeholder
 * may be inserted ONLY while both the direct row and alias remain absent.
 * Even an exact-PK concurrent arrival must abort: accepting its existing
 * profile would make our CREATE audit claim an invented pending profile.
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
    -- Each normalized identity is probed through the matching expression
    -- index. Avoid joining two separately grouped CTEs through unindexed
    -- raw_id columns: for 100 members that join caused cubic comparisons.
    metrics AS MATERIALIZED (
      SELECT i.raw_id, i.target_id, i.allow_absent,
        (SELECT COUNT(*) FROM x_users d
         WHERE lower(trim(ltrim(trim(d.id), '@'))) = i.raw_id
        ) AS direct_count,
        (SELECT COUNT(*) FROM x_users d
         WHERE lower(trim(ltrim(trim(d.id), '@'))) = i.raw_id
           AND COALESCE(d.approval_status, '') IN ('pending','approved','imported')
           AND lower(trim(ltrim(trim(d.id), '@'))) = i.target_id
        ) AS matching_direct,
        (SELECT COUNT(*) FROM x_users d
         WHERE lower(trim(ltrim(trim(d.id), '@'))) = i.raw_id
           AND COALESCE(d.approval_status, '') IN ('pending','approved','imported')
           AND lower(trim(ltrim(trim(d.id), '@'))) <> i.target_id
        ) AS different_direct,
        (SELECT COUNT(*) FROM x_user_aliases a
         WHERE lower(trim(ltrim(trim(a.alias_x_id), '@'))) = i.raw_id
        ) AS alias_count,
        (SELECT COUNT(*) FROM x_user_aliases a
         LEFT JOIN x_users target
           ON lower(trim(ltrim(trim(target.id), '@'))) =
              lower(trim(ltrim(trim(a.x_user_id), '@')))
         WHERE lower(trim(ltrim(trim(a.alias_x_id), '@'))) = i.raw_id
           AND (target.id IS NULL
             OR COALESCE(target.approval_status, '') NOT IN ('pending','approved','imported')
             OR lower(trim(ltrim(trim(target.id), '@'))) <> i.target_id)
        ) AS bad_alias_count
      FROM incoming i
    )
    SELECT CASE WHEN NOT EXISTS (
      SELECT 1 FROM metrics m
      WHERE m.direct_count > 1
         OR (m.allow_absent = 1 AND (m.direct_count > 0 OR m.alias_count > 0))
         OR (m.alias_count = 0 AND NOT (
           (m.direct_count = 0 AND m.target_id = m.raw_id AND m.allow_absent = 1)
           OR (m.direct_count = 1 AND m.matching_direct = 1)
         ))
         OR (m.alias_count > 0 AND (
           m.bad_alias_count > 0 OR m.different_direct > 0
         ))
    ) THEN 1 ELSE json_extract('not-valid-json', '$') END
  `;
}
