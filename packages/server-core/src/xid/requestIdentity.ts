/**
 * MIG-0659 U02: identity reads used by the X ID request core.
 * Same queries and collision policy as CURRENT src/lib/auth/xIdentityResolutionDb.ts and
 * src/lib/auth/xIdentity.ts (getLinkedXUserForAuthUser reduced to the existence the callers use).
 */
import { and, eq, sql, type SQLWrapper } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { xUserAccountLinks, xUserAliases, xUsers } from "@flamenode/db/schema";
import {
  decideCanonicalXUserResolution,
  normalizeXId,
  type CanonicalXUserResolution,
} from "@flamenode/domain/xid";
import type { ServerCoreDb } from "../db.ts";

const CANONICAL_RESOLUTION_CHUNK_SIZE = 80;

function normalizedXIdSql(column: SQLWrapper) {
  return sql`lower(trim(ltrim(trim(${column}), '@')))`;
}

function normalizedCandidatesWhere(column: SQLWrapper, candidates: readonly string[]) {
  return sql`${normalizedXIdSql(column)} IN (${sql.join(
    candidates.map((candidate) => sql`${candidate}`),
    sql`, `,
  )})`;
}

export async function resolveCanonicalXUserResolutions(
  db: ServerCoreDb,
  candidates: readonly (string | null | undefined)[],
): Promise<Map<string, CanonicalXUserResolution>> {
  const normalizedCandidates = Array.from(
    new Set(
      candidates
        .map((candidate) => normalizeXId(candidate))
        .filter((candidate): candidate is string => Boolean(candidate)),
    ),
  );
  const resolutions = new Map<string, CanonicalXUserResolution>();
  for (let offset = 0; offset < normalizedCandidates.length; offset += CANONICAL_RESOLUTION_CHUNK_SIZE) {
    const chunk = normalizedCandidates.slice(offset, offset + CANONICAL_RESOLUTION_CHUNK_SIZE);
    const aliasTarget = alias(xUsers, "canonical_alias_target");
    const [aliasRows, directRows] = await Promise.all([
      db
        .select({
          alias_x_id: xUserAliases.alias_x_id,
          target_x_user_id: aliasTarget.id,
          target_approval_status: aliasTarget.approval_status,
        })
        .from(xUserAliases)
        .leftJoin(
          aliasTarget,
          sql`${normalizedXIdSql(aliasTarget.id)} = ${normalizedXIdSql(xUserAliases.x_user_id)}`,
        )
        .where(normalizedCandidatesWhere(xUserAliases.alias_x_id, chunk)),
      db
        .select({ id: xUsers.id, approval_status: xUsers.approval_status })
        .from(xUsers)
        .where(normalizedCandidatesWhere(xUsers.id, chunk)),
    ]);
    for (const candidate of chunk) {
      resolutions.set(
        candidate,
        decideCanonicalXUserResolution({ candidate, aliases: aliasRows, directRows }),
      );
    }
  }
  return resolutions;
}

/** CURRENT isAuthUserLinkedToXUser: canonical resolution, then one link-row read. */
export async function isAuthUserLinkedToXUser(
  db: ServerCoreDb,
  authUserId: string,
  xUserId: string,
): Promise<boolean> {
  const normalized = normalizeXId(xUserId);
  if (!normalized) return false;
  const canonical = (await resolveCanonicalXUserResolutions(db, [normalized])).get(normalized)?.value ?? null;
  if (!canonical) return false;
  const rows = await db
    .select({ x_user_id: xUserAccountLinks.x_user_id })
    .from(xUserAccountLinks)
    .innerJoin(xUsers, eq(xUsers.id, xUserAccountLinks.x_user_id))
    .where(
      and(
        eq(xUserAccountLinks.auth_user_id, authUserId),
        eq(xUserAccountLinks.x_user_id, canonical),
      )!,
    )
    .limit(1);
  return rows.length > 0;
}
