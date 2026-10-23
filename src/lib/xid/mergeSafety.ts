import { sql, type SQL } from "drizzle-orm";
import type { XIdMergeSnapshotState } from "@flamenode/domain/xid";

export {
  type XIdMergeSnapshotState,
  buildXIdMergeAfterState,
  buildXIdMergeBeforeState,
} from "@flamenode/domain/xid";

/**
 * Every column name which the merge assertion may inline. D1 allows only 100
 * bind parameters per statement, and binding each `$.column` JSON path pushed
 * the AFTER-state assertion to 141. These are code constants, never input.
 */
const MERGE_STATE_COLUMNS: ReadonlySet<string> = new Set([
  "id", "approval_status", "active_x_user_id", "x_user_id", "auth_user_id",
  "link_role", "created_by_request_id", "created_at", "updated_at",
  "creator_x_user_id", "reserved_x_id_snapshot", "version",
  "related_x_user_id", "video_id", "interaction_type", "event_id",
  "display_name", "permission_preset", "custom_permission_keys_json",
  "is_public", "public_role_label", "approved_by_auth_user_id", "approved_at",
  "alias_x_id",
]);

/** `'$.column'` as a SQL literal; throws unless the column is allowlisted. */
function jsonColumnPathSql(column: string): SQL {
  if (!MERGE_STATE_COLUMNS.has(column) || !/^[a-z_]+$/.test(column)) {
    throw new Error(`xid merge state: 未許可の column です: ${column}`);
  }
  return sql.raw(`'$.${column}'`);
}

function rowsMatchJsonSql(input: {
  table: string;
  columns: readonly string[];
  scope: SQL;
  jsonPath: string;
  /** A CTE-backed JSON value. Keep the large restore snapshot bound once. */
  stateValue: SQL;
}): SQL {
  const table = sql.raw(input.table);
  const columns = sql.join(
    input.columns.map((column) => sql.raw(column)),
    sql`, `,
  );
  const jsonColumns = sql.join(
    input.columns.map((column) =>
      sql`json_extract(value, ${jsonColumnPathSql(column)})`,
    ),
    sql`, `,
  );
  const jsonPath = sql.raw(`'$.${input.jsonPath}'`);
  return sql`
    NOT EXISTS (
      SELECT ${columns} FROM ${table} WHERE ${input.scope}
      EXCEPT
      SELECT ${jsonColumns} FROM json_each(${input.stateValue}, ${jsonPath})
    )
    AND NOT EXISTS (
      SELECT ${jsonColumns} FROM json_each(${input.stateValue}, ${jsonPath})
      EXCEPT
      SELECT ${columns} FROM ${table} WHERE ${input.scope}
    )
  `;
}
function normalizedXIdSql(column: string, xUserId: SQL): SQL {
  return sql`lower(trim(ltrim(trim(${sql.raw(column)}), '@'))) = lower(${xUserId})`;
}

/** Scope an after-state comparison to the exact rows that this merge owns. */
function expectedRowsScope(
  stateValue: SQL,
  table: string,
  jsonPath: string,
  columns: readonly string[],
): SQL {
  const jsonPathSql = sql.raw(`'$.${jsonPath}'`);
  const comparisons = sql.join(
    columns.map((column) =>
      // json_each itself exposes an `id` column. Always qualify the outer
      // relation so a state row keyed by `id` is compared to the table row,
      // not to JSON1's internal traversal ID.
      sql`json_extract(value, ${jsonColumnPathSql(column)}) IS ${sql.raw(`${table}.${column}`)}`,
    ),
    sql` AND `,
  );
  return sql`EXISTS (
    SELECT 1 FROM json_each(${stateValue}, ${jsonPathSql})
    WHERE ${comparisons}
  )`;
}

/**
 * Exact-state CAS used before merge/revert DML. It intentionally scopes only
 * the relations which the merge owns; unrelated target rows stay untouched.
 */
export function xIdMergeStateMatchesSql(
  state: XIdMergeSnapshotState,
  input: {
    sourceXUserId: string;
    targetXUserId: string;
    phase: "before" | "after";
  },
): SQL {
  const source = input.sourceXUserId;
  const target = input.targetXUserId;
  const stateJson = JSON.stringify(state);
  // A snapshot can be nearly 1MB. Passing it to every json_each() would both
  // multiply the payload and exceed D1's 100-parameter limit. The same is
  // true of the source/target values repeated by relation predicates, so all
  // three values are bound once and read from this CTE below.
  const stateValue = sql`(SELECT value FROM xid_merge_state)`;
  const sourceValue = sql`(SELECT source_id FROM xid_merge_state)`;
  const targetValue = sql`(SELECT target_id FROM xid_merge_state)`;
  const sourceOrTarget = sql`x_user_id IN (${sourceValue}, ${targetValue})`;
  const relationXUserId = input.phase === "before" ? sourceValue : targetValue;
  const relationSlotScope = input.phase === "before"
    ? sql`${normalizedXIdSql("x_user_id", sourceValue)} OR ${normalizedXIdSql("reserved_x_id_snapshot", sourceValue)}`
    : sql`${normalizedXIdSql("x_user_id", targetValue)} OR ${normalizedXIdSql("reserved_x_id_snapshot", targetValue)}`;
  const afterScope = (
    table: string,
    path: string,
    columns: readonly string[],
  ) => expectedRowsScope(stateValue, table, path, columns);
  const matches = sql`
    ${rowsMatchJsonSql({
      table: "x_users",
      columns: ["id", "approval_status"],
      scope: sql`id IN (${sourceValue}, ${targetValue})`,
      jsonPath: "x_users",
      stateValue,
    })}
    AND ${rowsMatchJsonSql({
      table: '"user"',
      columns: ["id", "active_x_user_id"],
      scope: input.phase === "before"
        ? sql`${normalizedXIdSql("active_x_user_id", sourceValue)} OR ${normalizedXIdSql("active_x_user_id", targetValue)}`
        : afterScope('"user"', "active_users", ["id"]),
      jsonPath: "active_users",
      stateValue,
    })}
    AND ${rowsMatchJsonSql({
      table: "x_user_account_links",
      columns: ["x_user_id", "auth_user_id", "link_role", "created_by_request_id", "created_at", "updated_at"],
      scope: input.phase === "before"
        ? sourceOrTarget
        : afterScope("x_user_account_links", "account_links", ["x_user_id", "auth_user_id"]),
      jsonPath: "account_links",
      stateValue,
    })}
    AND ${rowsMatchJsonSql({
      table: "videos",
      columns: ["id", "creator_x_user_id", "updated_at"],
      scope: input.phase === "before"
        ? sql`creator_x_user_id = ${relationXUserId}`
        : afterScope("videos", "videos", ["id"]),
      jsonPath: "videos",
      stateValue,
    })}
    AND ${rowsMatchJsonSql({
      table: "video_chapters",
      columns: ["id", "x_user_id", "updated_at"],
      scope: input.phase === "before"
        ? sql`x_user_id = ${relationXUserId}`
        : afterScope("video_chapters", "video_chapters", ["id"]),
      jsonPath: "video_chapters",
      stateValue,
    })}
    AND ${rowsMatchJsonSql({
      table: "video_members",
      columns: ["id", "x_user_id"],
      scope: input.phase === "before"
        ? sql`x_user_id = ${relationXUserId}`
        : afterScope("video_members", "video_members", ["id"]),
      jsonPath: "video_members",
      stateValue,
    })}
    AND ${rowsMatchJsonSql({
      table: "slots",
      columns: ["id", "x_user_id", "reserved_x_id_snapshot", "updated_at", "version"],
      scope: input.phase === "before"
        ? relationSlotScope
        : afterScope("slots", "slots", ["id"]),
      jsonPath: "slots",
      stateValue,
    })}
    AND ${rowsMatchJsonSql({
      table: "slot_reservation_groups",
      columns: ["id", "x_user_id", "updated_at", "version"],
      scope: input.phase === "before"
        ? sql`x_user_id = ${relationXUserId}`
        : afterScope("slot_reservation_groups", "slot_reservation_groups", ["id"]),
      jsonPath: "slot_reservation_groups",
      stateValue,
    })}
    AND ${rowsMatchJsonSql({
      table: "video_moderation_cases",
      columns: ["id", "related_x_user_id"],
      scope: input.phase === "before"
        ? sql`related_x_user_id = ${relationXUserId}`
        : afterScope("video_moderation_cases", "video_moderation_cases", ["id"]),
      jsonPath: "video_moderation_cases",
      stateValue,
    })}
    AND ${rowsMatchJsonSql({
      table: "video_interactions",
      columns: ["x_user_id", "video_id", "interaction_type", "created_at"],
      scope: input.phase === "before"
        ? sourceOrTarget
        : afterScope("video_interactions", "video_interactions", ["x_user_id", "video_id", "interaction_type"]),
      jsonPath: "video_interactions",
      stateValue,
    })}
    AND ${rowsMatchJsonSql({
      table: "event_staff",
      columns: ["id", "event_id", "x_user_id", "display_name", "permission_preset", "custom_permission_keys_json", "is_public", "public_role_label", "approved_by_auth_user_id", "approved_at", "created_at", "updated_at"],
      scope: input.phase === "before"
        ? sourceOrTarget
        : afterScope("event_staff", "event_staff", ["id"]),
      jsonPath: "event_staff",
      stateValue,
    })}
    AND ${rowsMatchJsonSql({
      table: "x_user_aliases",
      columns: ["x_user_id", "alias_x_id"],
      scope: input.phase === "before"
        ? sql`x_user_id IN (${sourceValue}, ${targetValue}) OR alias_x_id IN (${sourceValue}, ${targetValue})`
        // A merge deliberately retains only target -> source as a canonical
        // alias. Any later source-owned row or second source alias must make
        // the revert fail closed instead of being silently overwritten.
        : sql`
            ${afterScope("x_user_aliases", "aliases", ["x_user_id", "alias_x_id"])}
            OR ${normalizedXIdSql("x_user_id", sourceValue)}
            OR ${normalizedXIdSql("alias_x_id", sourceValue)}
          `,
      jsonPath: "aliases",
      stateValue,
    })}
  `;
  return sql`
    EXISTS (
      WITH xid_merge_state(value, source_id, target_id) AS (
        VALUES (${stateJson}, ${source}, ${target})
      )
      SELECT 1 WHERE ${matches}
    )
  `;
}
