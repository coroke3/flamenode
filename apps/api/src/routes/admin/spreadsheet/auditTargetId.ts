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
