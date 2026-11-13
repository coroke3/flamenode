/**
 * MIG-0638 / Issue #674: versioned identity for FUTURE spreadsheet audit rows.
 *
 * IMPORTANT: this is an unmounted contract, not a production format migration.
 * CURRENT audit rows use context "admin_spreadsheet" and a colon-joined
 * target_id. Their historical strings must not be reinterpreted as V1 by
 * inspecting target_id alone: a legacy single-column value can mimic any
 * prefix. V1 must use BOTH this context marker and the encoded target_id.
 *
 * Never rewrite historical audit rows, silently combine legacy history with
 * V1 history, or opt into this writer contract without an approved lookup
 * and restore migration plan.
 */

export const SPREADSHEET_AUDIT_PK_V1_CONTEXT = "admin_spreadsheet_pk_v1";
export const SPREADSHEET_AUDIT_PK_V1_PREFIX = "spk:v1:";

export type SpreadsheetAuditIdentityV1 = {
  context: typeof SPREADSHEET_AUDIT_PK_V1_CONTEXT;
  target_id: string;
};

export type SpreadsheetAuditPkParts = readonly (readonly [string, string])[];

function canonicalPkParts(pk: Record<string, string>): [string, string][] {
  const parts = Object.entries(pk);
  if (parts.length === 0) throw new Error("missing_primary_key");
  for (const [key, value] of parts) {
    if (typeof value !== "string" || !key || !value.trim()) {
      throw new Error("missing_primary_key");
    }
    // SQLite TEXT bindings may truncate U+0000; a logged identity must be
    // identical to the values that can actually be bound to SQLite.
    if (key.includes("\0") || value.includes("\0")) {
      throw new Error("invalid_row");
    }
  }
  // localeCompare can compare distinct Unicode key spellings as equal; use
  // deterministic UTF-16 code-unit order independent of input insertion order.
  return parts.sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
}

/** Generate a stable identity WITHOUT changing CURRENT or Hono audit writes. */
export function buildSpreadsheetAuditIdentityV1(
  pk: Record<string, string>,
): SpreadsheetAuditIdentityV1 {
  return {
    context: SPREADSHEET_AUDIT_PK_V1_CONTEXT,
    target_id: SPREADSHEET_AUDIT_PK_V1_PREFIX +
      JSON.stringify(canonicalPkParts(pk)),
  };
}

/**
 * Decode ONLY for records explicitly tagged with the V1 audit context.
 * Legacy target_id values can accidentally look like this JSON syntax, so a
 * prefix-only decoder or unqualified legacy+V1 SQL equality join is unsafe.
 * Return ordered pairs (not an object) to avoid prototype-key ambiguity.
 */
export function parseSpreadsheetAuditIdentityV1(
  identity: { context: string | null; target_id: string },
): SpreadsheetAuditPkParts | null {
  if (identity.context !== SPREADSHEET_AUDIT_PK_V1_CONTEXT ||
      !identity.target_id.startsWith(SPREADSHEET_AUDIT_PK_V1_PREFIX)) {
    return null;
  }
  try {
    const json = identity.target_id.slice(SPREADSHEET_AUDIT_PK_V1_PREFIX.length);
    const value: unknown = JSON.parse(json);
    if (!Array.isArray(value) || value.length === 0) return null;
    const pk: Record<string, string> = Object.create(null);
    for (const item of value) {
      if (!Array.isArray(item) || item.length !== 2 ||
          typeof item[0] !== "string" || typeof item[1] !== "string" ||
          Object.hasOwn(pk, item[0])) return null;
      pk[item[0]] = item[1];
    }
    if (buildSpreadsheetAuditIdentityV1(pk).target_id !== identity.target_id) {
      return null;
    }
    return value as [string, string][];
  } catch {
    return null;
  }
}

/**
 * Candidate selection for a FUTURE explicit per-record history endpoint.
 * This is not a query or a combined visible history: legacy candidates are
 * potentially ambiguous until their stored snapshots are checked.
 */
export type SpreadsheetAuditHistoryLookup = {
  table_name: string;
  v1: SpreadsheetAuditIdentityV1;
  legacy: { context: "admin_spreadsheet"; target_id: string };
};

export function buildSpreadsheetAuditHistoryLookup(
  tableName: string,
  primaryKey: Record<string, string>,
): SpreadsheetAuditHistoryLookup {
  if (!tableName || typeof tableName !== "string") throw new Error("unknown_table");
  // Validate once through V1, including no NUL or missing components.
  const v1 = buildSpreadsheetAuditIdentityV1(primaryKey);
  return {
    table_name: tableName,
    v1,
    // Preserve the CURRENT audit writer's exact legacy localeCompare+colon
    // encoding for historical lookup only. This may collide across tuples.
    legacy: {
      context: "admin_spreadsheet",
      target_id: Object.entries(primaryKey)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([, value]) => value)
        .join(":"),
    },
  };
}

export type SpreadsheetAuditHistoryCandidate = {
  table_name: string;
  context: string | null;
  target_id: string;
  before_json: string | null;
  after_json: string | null;
};

export type SpreadsheetAuditHistoryRelation =
  | "v1_exact"
  | "legacy_snapshot_exact"
  | "legacy_ambiguous"
  | "other";

/**
 * Legacy matching requires the actual full PK in every available snapshot.
 * Missing/redacted/malformed snapshots must NEVER turn a colon collision into
 * a false positive. A matching before and conflicting after are ambiguous.
 *
 * The return value only classifies a candidate row fetched under the trusted
 * table_name+context+target_id predicates. It does not authorize restore,
 * bypass existing audit permission checks, or mutate historical audit IDs.
 */
export function classifySpreadsheetAuditHistoryCandidate(
  lookup: SpreadsheetAuditHistoryLookup,
  row: SpreadsheetAuditHistoryCandidate,
): SpreadsheetAuditHistoryRelation {
  if (row.table_name !== lookup.table_name) return "other";
  if (row.context === SPREADSHEET_AUDIT_PK_V1_CONTEXT) {
    return row.target_id === lookup.v1.target_id &&
      parseSpreadsheetAuditIdentityV1(row) !== null ? "v1_exact" : "other";
  }
  if (row.context !== lookup.legacy.context ||
      row.target_id !== lookup.legacy.target_id) return "other";

  const expectedPk = parseSpreadsheetAuditIdentityV1(lookup.v1);
  if (!expectedPk) return "legacy_ambiguous";
  const parts: string[] = [];
  for (const snapshot of [row.before_json, row.after_json]) {
    if (snapshot === null) continue;
    if (snapshot.length > 128_000) return "legacy_ambiguous";
    try {
      const value: unknown = JSON.parse(snapshot);
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        return "legacy_ambiguous";
      }
      const data = value as Record<string, unknown>;
      const present = expectedPk.every(([key]) =>
        Object.prototype.hasOwnProperty.call(data, key) &&
        typeof data[key] === "string" &&
        data[key] !== "[REDACTED]",
      );
      if (!present) return "legacy_ambiguous";
      parts.push(expectedPk.every(([key, expected]) => data[key] === expected)
        ? "match" : "other");
    } catch {
      return "legacy_ambiguous";
    }
  }
  if (parts.length === 0) return "legacy_ambiguous";
  if (parts.every((x) => x === "match")) return "legacy_snapshot_exact";
  if (parts.every((x) => x === "other")) return "other";
  return "legacy_ambiguous";
}
