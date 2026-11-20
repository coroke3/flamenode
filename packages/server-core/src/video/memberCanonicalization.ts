/**
 * MIG-0650 U03d-2i: exact CURRENT SA-085 X identity + inverse-alias reads.
 *
 * All submitted handles pass the lifecycle resolver. Inverse aliases are read
 * exclusively to find prior member permission rows; any ambiguous or invalid
 * legacy alias rejects the entire write rather than importing edit grants.
 *
 * Authorization, transaction/CAS/audits and post-commit Queue remain with the
 * authenticated caller; this is a read-only prepare step.
 */
import { sql } from "drizzle-orm";
import { xUserAliases } from "@flamenode/db/schema";
import {
  isCanonicalXId, normalizeXId,
  type CanonicalXUserResolution,
} from "@flamenode/domain/xid";
import type { MemberInput } from "@flamenode/domain/video/adminMemberSubmission";
import type { ServerCoreDb } from "../db.ts";
import { resolveCanonicalXUserResolutions } from "../xid/requestIdentity.ts";

export type CanonicalizedMemberInputs = {
  members: MemberInput[];
  canonicalByXId: Map<string, string>;
  lookupXIds: string[];
};

function isUnsafeXUserResolution(
  resolution: CanonicalXUserResolution | undefined,
): boolean {
  return (
    resolution?.reason === "invalid_alias_target" ||
    resolution?.reason === "ambiguous_alias" ||
    resolution?.reason === "canonical_alias_collision" ||
    resolution?.reason === "rejected_or_invalid"
  );
}

/**
 * 入力X IDと、その正本X IDに紐づく既存aliasを1 queryで読み、
 * public/hidden既存行も同一identityとして扱えるlookupを作る。
 */
export async function canonicalizeVideoMemberInputs(
  db: ServerCoreDb,
  members: readonly MemberInput[],
): Promise<CanonicalizedMemberInputs> {
  const normalized = members.map((member) => ({
    ...member,
    x_user_id: normalizeXId(member.x_user_id),
  }));
  const candidates = Array.from(
    new Set(normalized.map((member) => member.x_user_id).filter(Boolean)),
  );
  // Use the lifecycle resolver for every submitted handle.  The inverse alias
  // lookup below is retained only to find legacy member rows that should carry
  // permissions forward; it is never used to select a write target.
  const resolutions = candidates.length === 0
    ? new Map()
    : await resolveCanonicalXUserResolutions(db, candidates);
  const aliases = candidates.length === 0
    ? []
    : await db
        .select({
          alias_x_id: xUserAliases.alias_x_id,
          x_user_id: xUserAliases.x_user_id,
        })
        .from(xUserAliases)
        .where(sql`
           lower(trim(ltrim(trim(${xUserAliases.alias_x_id}), '@'))) IN (
             SELECT lower(trim(ltrim(trim(CAST(value AS TEXT)), '@')))
            FROM json_each(${JSON.stringify(candidates)})
          )
           OR lower(trim(ltrim(trim(${xUserAliases.x_user_id}), '@'))) IN (
             SELECT lower(trim(ltrim(trim(CAST(value AS TEXT)), '@')))
            FROM json_each(${JSON.stringify(candidates)})
          )
        `);

  // The inverse lookup is only for carrying an existing member's permission
  // forward.  It must nevertheless use the very same resolver before it is
  // allowed to associate a legacy member row with a submitted canonical ID:
  // otherwise an ambiguous old alias could silently inherit edit rights.
  const inverseAliasCandidates = Array.from(
    new Set(
      aliases
        .map((row) => normalizeXId(row.alias_x_id))
        .filter((alias): alias is string => Boolean(alias))
        .filter((alias) => !resolutions.has(alias)),
    ),
  );
  const inverseAliasResolutions = inverseAliasCandidates.length === 0
    ? new Map()
    : await resolveCanonicalXUserResolutions(db, inverseAliasCandidates);

  const canonicalByXId = new Map<string, string>();
  for (const candidate of candidates) {
    const resolution = resolutions.get(candidate);
    if (isUnsafeXUserResolution(resolution)) {
      throw new Error("video_member_x_user_resolution_invalid");
    }
    const canonical = resolution?.value ?? candidate;
    canonicalByXId.set(candidate, canonical);
    canonicalByXId.set(canonical, canonical);
  }

  for (const row of aliases) {
    const alias = normalizeXId(row.alias_x_id);
    const target = normalizeXId(row.x_user_id);
    if (!alias || !target || !isCanonicalXId(target)) {
      throw new Error("video_member_alias_target_invalid");
    }
    const resolution = resolutions.get(alias) ?? inverseAliasResolutions.get(alias);
    if (
      isUnsafeXUserResolution(resolution) ||
      resolution?.reason !== "resolved_alias" ||
      !resolution.value ||
      resolution.value !== target
    ) {
      throw new Error("video_member_alias_resolution_invalid");
    }
    canonicalByXId.set(alias, resolution.value);
  }

  const canonical = normalized.map((member) => {
    if (!member.x_user_id) return member;
    const target = canonicalByXId.get(member.x_user_id) ?? member.x_user_id;
    return target === member.x_user_id
      ? member
      : { ...member, x_user_id: target };
  });

  const seen = new Set<string>();
  const canonicalIds = new Set<string>();
  for (const member of canonical) {
    const xid = member.x_user_id;
    if (!xid) continue;
    if (!isCanonicalXId(xid)) throw new Error("video_member_x_user_id_invalid");
    if (seen.has(xid)) throw new Error("video_member_duplicate_x_user_id");
    seen.add(xid);
    canonicalIds.add(xid);
  }

  const lookupXIds = new Set<string>(canonicalIds);
  for (const row of aliases) {
    const alias = normalizeXId(row.alias_x_id);
    const target = normalizeXId(row.x_user_id);
    if (canonicalIds.has(target)) {
      lookupXIds.add(alias);
      lookupXIds.add(target);
    }
  }

  return {
    members: canonical,
    canonicalByXId,
    lookupXIds: Array.from(lookupXIds),
  };
}

