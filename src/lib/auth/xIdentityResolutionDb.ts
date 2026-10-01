import { sql, type SQLWrapper } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import type { DB } from "@/lib/db/client";
import { xUserAliases, xUsers } from "@/lib/db/schema";
import { normalizeXId } from "@/lib/utils/xid";
import {
  decideCanonicalXUserResolution,
  type CanonicalXUserResolution,
} from "./xIdentityResolutionCore";

const CANONICAL_RESOLUTION_CHUNK_SIZE = 80;

function normalizedXIdSql(column: SQLWrapper) {
  return sql`lower(trim(ltrim(trim(${column}), '@')))`;
}

function normalizedCandidatesWhere(
  column: SQLWrapper,
  candidates: readonly string[],
) {
  return sql`${normalizedXIdSql(column)} IN (${sql.join(
    candidates.map((candidate) => sql`${candidate}`),
    sql`, `,
  )})`;
}

/**
 * Resolve a bounded set with the same collision policy everywhere. Both
 * canonical rows and aliases are read before deciding; `LIMIT 1` must never
 * choose an arbitrary target from malformed historical alias data.
 *
 * This is deliberately separate from the server-only identity facade because
 * video plan builders also need the exact same D1 read policy in executable
 * tests. It still requires a server-side D1 DB instance.
 */
export async function resolveCanonicalXUserResolutions(
  db: DB,
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
  for (
    let offset = 0;
    offset < normalizedCandidates.length;
    offset += CANONICAL_RESOLUTION_CHUNK_SIZE
  ) {
    const chunk = normalizedCandidates.slice(
      offset,
      offset + CANONICAL_RESOLUTION_CHUNK_SIZE,
    );
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
        decideCanonicalXUserResolution({
          candidate,
          aliases: aliasRows,
          directRows,
        }),
      );
    }
  }
  return resolutions;
}
