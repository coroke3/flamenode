import { sql, type SQL } from "drizzle-orm";
import { normalizeXId } from "@/lib/utils/xid";

type SnapshotRow = Record<string, unknown>;

export type XIdMergeSnapshotState = {
  x_users: SnapshotRow[];
  active_users: SnapshotRow[];
  account_links: SnapshotRow[];
  videos: SnapshotRow[];
  video_chapters: SnapshotRow[];
  video_members: SnapshotRow[];
  slots: SnapshotRow[];
  slot_reservation_groups: SnapshotRow[];
  video_moderation_cases: SnapshotRow[];
  video_interactions: SnapshotRow[];
  event_staff: SnapshotRow[];
  aliases: SnapshotRow[];
};

type SnapshotLike = {
  source_x_user: SnapshotRow;
  target_x_user: SnapshotRow;
  active_users: readonly SnapshotRow[];
  account_links: readonly SnapshotRow[];
  videos: readonly SnapshotRow[];
  video_chapters: readonly SnapshotRow[];
  video_members: readonly SnapshotRow[];
  slots: readonly SnapshotRow[];
  slot_reservation_groups?: readonly SnapshotRow[];
  video_moderation_cases?: readonly SnapshotRow[];
  video_interactions: readonly SnapshotRow[];
  event_staff: readonly SnapshotRow[];
  aliases: readonly SnapshotRow[];
};

function cloneRows(rows: readonly SnapshotRow[] | undefined): SnapshotRow[] {
  return (rows ?? []).map((row) => ({ ...row }));
}

function key(...parts: unknown[]): string {
  return parts.map((part) => String(part ?? "")).join("\u0000");
}

/** The exact relation set captured before a merge. */
export function buildXIdMergeBeforeState(
  snapshot: SnapshotLike,
): XIdMergeSnapshotState {
  return {
    x_users: [
      { id: snapshot.source_x_user.id, approval_status: snapshot.source_x_user.approval_status },
      { id: snapshot.target_x_user.id, approval_status: snapshot.target_x_user.approval_status },
    ],
    active_users: cloneRows(snapshot.active_users),
    account_links: cloneRows(snapshot.account_links),
    videos: cloneRows(snapshot.videos),
    video_chapters: cloneRows(snapshot.video_chapters),
    video_members: cloneRows(snapshot.video_members),
    slots: cloneRows(snapshot.slots),
    slot_reservation_groups: cloneRows(snapshot.slot_reservation_groups),
    video_moderation_cases: cloneRows(snapshot.video_moderation_cases),
    video_interactions: cloneRows(snapshot.video_interactions),
    event_staff: cloneRows(snapshot.event_staff),
    aliases: cloneRows(snapshot.aliases),
  };
}

/**
 * Build the relation set which the current merge SQL is allowed to produce.
 * The result is deliberately a data-only contract: both merge preconditions and
 * revert preconditions compare D1 rows with this exact set inside their batch.
 */
export function buildXIdMergeAfterState(
  snapshot: SnapshotLike,
  input: { sourceXUserId: string; targetXUserId: string; now: number },
): XIdMergeSnapshotState {
  const before = buildXIdMergeBeforeState(snapshot);
  const source = input.sourceXUserId;
  const target = input.targetXUserId;

  const sourceInteractions = before.video_interactions.filter(
    (row) => row.x_user_id === source,
  );
  const targetInteractionKeys = new Set(
    before.video_interactions
      .filter((row) => row.x_user_id === target)
      .map((row) => key(row.video_id, row.interaction_type)),
  );
  const video_interactions = before.video_interactions.flatMap((row) => {
    if (row.x_user_id !== source) return [{ ...row }];
    return targetInteractionKeys.has(key(row.video_id, row.interaction_type))
      ? []
      : [{ ...row, x_user_id: target }];
  });

  const targetStaffByEvent = new Map(
    before.event_staff
      .filter((row) => row.x_user_id === target)
      .map((row) => [String(row.event_id), row] as const),
  );
  const event_staff = before.event_staff.flatMap((row) => {
    if (row.x_user_id === source) {
      return targetStaffByEvent.has(String(row.event_id))
        ? []
        : [{ ...row, x_user_id: target, updated_at: input.now }];
    }
    if (
      row.x_user_id === target &&
      before.event_staff.some(
        (sourceRow) =>
          sourceRow.x_user_id === source &&
          sourceRow.event_id === row.event_id &&
          sourceRow.permission_preset === "owner",
      ) &&
      row.permission_preset !== "owner"
    ) {
      return [{ ...row, permission_preset: "owner", updated_at: input.now }];
    }
    return [{ ...row }];
  });

  const targetAliasIds = new Set(
    before.aliases
      .filter((row) => row.x_user_id === target)
      .map((row) => String(row.alias_x_id)),
  );
  const aliases: SnapshotRow[] = before.aliases
    .filter((row) => row.alias_x_id !== source)
    .filter(
      (row) =>
        !(
          row.x_user_id === source &&
          targetAliasIds.has(String(row.alias_x_id))
        ),
    )
    .map((row) =>
      row.x_user_id === source ? { ...row, x_user_id: target } : { ...row },
    );
  if (!aliases.some((row) => row.x_user_id === target && row.alias_x_id === source)) {
    aliases.push({ x_user_id: target, alias_x_id: source });
  }

  const targetLinks = new Map(
    before.account_links
      .filter((row) => row.x_user_id === target)
      .map((row) => [String(row.auth_user_id), { ...row }] as const),
  );
  for (const sourceLink of before.account_links.filter(
    (row) => row.x_user_id === source,
  )) {
    const authUserId = String(sourceLink.auth_user_id);
    const existing = targetLinks.get(authUserId);
    if (!existing) {
      targetLinks.set(authUserId, {
        ...sourceLink,
        x_user_id: target,
        updated_at: input.now,
      });
      continue;
    }
    targetLinks.set(authUserId, {
      ...existing,
      link_role:
        existing.link_role === "owner" || sourceLink.link_role === "owner"
          ? "owner"
          : "manager",
      created_by_request_id:
        existing.created_by_request_id ?? sourceLink.created_by_request_id ?? null,
      updated_at: input.now,
    });
  }

  const active_users = before.active_users.map((row) => ({
    ...row,
    active_x_user_id:
      normalizeXId(String(row.active_x_user_id ?? "")) === source
        ? target
        : row.active_x_user_id,
  }));

  return {
    x_users: [
      { id: source, approval_status: "rejected" },
      {
        id: snapshot.target_x_user.id,
        approval_status: snapshot.target_x_user.approval_status,
      },
    ],
    active_users,
    account_links: Array.from(targetLinks.values()),
    videos: before.videos.map((row) => ({
      ...row,
      creator_x_user_id: target,
      updated_at: input.now,
    })),
    video_chapters: before.video_chapters.map((row) => ({
      ...row,
      x_user_id: target,
      updated_at: input.now,
    })),
    video_members: before.video_members.map((row) => ({
      ...row,
      x_user_id: target,
    })),
    slots: before.slots.map((row) => ({
      ...row,
      x_user_id: row.x_user_id === source ? target : row.x_user_id,
      reserved_x_id_snapshot:
        normalizeXId(String(row.reserved_x_id_snapshot ?? "")) === source
          ? target
          : row.reserved_x_id_snapshot,
      updated_at: input.now,
      version: Number(row.version ?? 0) + 1,
    })),
    slot_reservation_groups: before.slot_reservation_groups.map((row) => ({
      ...row,
      x_user_id: target,
      updated_at: input.now,
      version: Number(row.version ?? 0) + 1,
    })),
    video_moderation_cases: before.video_moderation_cases.map((row) => ({
      ...row,
      related_x_user_id: target,
    })),
    video_interactions,
    event_staff,
    aliases,
  };
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
      sql`json_extract(value, ${`$.${column}`})`,
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
      sql`json_extract(value, ${`$.${column}`}) IS ${sql.raw(`${table}.${column}`)}`,
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
