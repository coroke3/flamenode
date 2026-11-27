/**
 * MIG-0638 U01b: Hono admin spreadsheet CRUD write routes (RH-004 PATCH, RH-005 POST, RH-006 DELETE)
 * under /api/admin/spreadsheet/data.
 *
 * CURRENT: app/api/admin/spreadsheet/data/route.ts + src/lib/admin/spreadsheet/{query,routeHandler,guard,errors,staticRebuildPlan}.ts.
 *
 * Guard order (matches CURRENT requireSpreadsheetAdminWrite + Hono /api/admin):
 *   1. originGuardMiddleware (pure, 0 D1) -> 403 invalid_origin / 503 origin_verification_unavailable
 *   2. spreadsheetEnabledGuard (pure, 0 D1) -> 404 spreadsheet_disabled
 *   3. sessionMiddleware (1 D1)
 *   4. writeGuardMiddleware (1 D1 -> 401/403/503, sets actorSnapshotJsonById)
 *   5. dbMiddleware
 *   6. costGuardMiddleware("admin_spreadsheet") (1 D1 -> 503, sets auditSettings)
 *
 * D-0603-1: static_rebuild_queue rows are committed atomically inside mutateWithAudit's D1 batch,
 * with zero immediate Queue wakes (background Cron consumes static_rebuild_queue).
 */
import { Hono, type Context, type MiddlewareHandler, type Next } from "hono";
import type { AdminSpreadsheetColumnMeta } from "@flamenode/contracts";
import { AdminSpreadsheetMutationResponseSchema } from "@flamenode/contracts";
import {
  assertAtomicAuditMutationBindLimits,
  mutateWithAudit,
  planAtomicAuditMutationBudget,
  type AtomicAuditMutationInput,
} from "@flamenode/server-core/audit/mutate";
import type { ServerCoreDb } from "@flamenode/server-core/db";
import type { QueueWakeHostLoader } from "@flamenode/server-core/ports";
import { sql } from "@flamenode/server-core/sql";
import { buildStaticRebuildQueueBatch } from "@flamenode/server-core/staticRebuild/enqueue";
import type { EnqueueStaticRebuildInput } from "@flamenode/server-core/staticRebuild/types";
import { sessionMiddleware } from "../../../auth/session.ts";
import type { AppEnv } from "../../../env.ts";
import { costGuardMiddleware } from "../../../middleware/costGuard.ts";
import { dbMiddleware } from "../../../middleware/db.ts";
import {
  onlyMutating,
  originGuardMiddleware,
  writeGuardMiddleware,
} from "../../../middleware/writeOrigin.ts";
import { auditPreloaded } from "../body.ts";
import {
  getSpreadsheetDb,
  quoteIdent,
  SPREADSHEET_ERROR,
  SpreadsheetError,
} from "./catalog.ts";
import {
  buildSpreadsheetTableDefs,
  isSpreadsheetColumnEditable,
  isValidSqliteTableName,
  primaryKeysFromColumns,
} from "./registry.ts";
import { SPREADSHEET_COLUMN_ENUMS, SPREADSHEET_SCHEMA_TABLES } from "./schemaCatalog.ts";
import { SpreadsheetImportColumnError } from "./importPrepCore.ts";
import { readSpreadsheetJsonBody } from "./writeBody.ts";
import {
  assertSpreadsheetForeignKeyLookup,
  buildSpreadsheetForeignKeyLookups,
  parseSpreadsheetCrudBody,
  buildSpreadsheetGuardedCrudPlanFromSnapshot,
  planSpreadsheetAtomicAuditedCrud,
  planSpreadsheetGuardedCrud,
  prepareSpreadsheetGuardedCrudMutation,
  snapshotSpreadsheetRawRow,
  validateSpreadsheetForeignKeys,
  type PreparedSpreadsheetCrudMutation,
  SPREADSHEET_ATOMIC_MAX_REBUILD_TARGETS,
  SPREADSHEET_FK_PREFLIGHT_MAX_QUERIES,
  SPREADSHEET_IMPORT_APPLY_MAX_ROWS,
  spreadsheetMutationToBoundSql,
  type SpreadsheetAuditedSqlPlan,
  type SpreadsheetCrudMethod,
  type SpreadsheetForeignKey,
  type SpreadsheetForeignKeyLookup,
  type SpreadsheetSqlTableContext,
} from "./writeValidation.ts";

export const PRIVATE_HEADERS = {
  "Cache-Control": "private, no-store, no-cache, must-revalidate",
  Pragma: "no-cache",
  Expires: "0",
} as const;

export const SPREADSHEET_STATIC_REBUILD_TARGET_LIMIT = 256;
export const SPREADSHEET_STATIC_REBUILD_SPLIT_REQUIRED =
  "静的再生成対象が多すぎます。行を分割してください。";
export const SPREADSHEET_MAX_STATIC_REBUILD_QUEUE_STATEMENTS = 4;

/** D-0603-1: Hono admin routes persist static_rebuild_queue without sending a Queue wake. */
export const NOOP_WAKE_HOST: QueueWakeHostLoader = async () => ({
  readEnv: () => null,
  readWaitUntil: () => null,
  readKv: () => null,
});

const WRITE_CACHE_TTL_MS = 30_000;
const SPREADSHEET_VIDEO_EVENT_LOOKUP_CHUNK_SIZE = 80;
const SPREADSHEET_JS_TRIM_CHARS = String.fromCodePoint(
  0x0009, 0x000a, 0x000b, 0x000c, 0x000d, 0x0020, 0x00a0, 0x1680,
  0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007,
  0x2008, 0x2009, 0x200a, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000, 0xfeff,
);
const PVSF_SUMMARY_EVENT_ID = "PVSFSummary";

export interface SpreadsheetWriteTableContext extends SpreadsheetSqlTableContext {
  columnNames: string[];
  quotedTable: string;
}

type WriteContextEntry = {
  ctx: SpreadsheetWriteTableContext;
  foreignKeys: readonly SpreadsheetForeignKey[];
  cachedAt: number;
};

const writeContextCache = new Map<string, WriteContextEntry>();

export function invalidateSpreadsheetWriteCaches(): void {
  writeContextCache.clear();
}

const TABLE_WRITE_COLUMNS_SQL = `SELECT x.name AS name, x.type AS type, x."notnull" AS not_null, x.pk AS pk,
       x.dflt_value AS dflt_value, x.hidden AS hidden,
       (SELECT json_group_array(json_object('column', fk."from", 'referencedTable', fk."table", 'referencedColumn', fk."to"))
        FROM pragma_foreign_key_list(?) AS fk) AS foreign_keys_json,
       (SELECT json_group_array(name) FROM (SELECT name FROM pragma_table_info(?) WHERE pk > 0 ORDER BY pk)) AS primary_keys_json
FROM pragma_table_xinfo(?) AS x
WHERE EXISTS (
  SELECT 1 FROM sqlite_master m
  WHERE m.type = 'table'
  AND m.name = ?
  AND m.name NOT LIKE 'sqlite_%'
  AND substr(m.name, 1, 1) != '_'
  AND EXISTS (SELECT 1 FROM pragma_table_info(m.name) WHERE pk > 0)
)
ORDER BY x.cid`;

const SOFTWARE_CATALOG_SNAPSHOT_PREFIX = "__mig0638_catalog_";
const SOFTWARE_CATALOG_SNAPSHOT_MAX_COLUMNS = 64;
const SOFTWARE_CATALOG_SNAPSHOT_SQL = `WITH catalog AS (${TABLE_WRITE_COLUMNS_SQL.replace(
  "SELECT x.name AS name",
  "SELECT x.cid AS cid, x.name AS name",
)}),
snapshot AS (
  SELECT * FROM "software_catalog" WHERE "id" = ? LIMIT 2
),
snapshot_count AS (
  SELECT COUNT(*) AS count FROM snapshot
)
SELECT s.*,
  c.cid AS "${SOFTWARE_CATALOG_SNAPSHOT_PREFIX}cid",
  c.name AS "${SOFTWARE_CATALOG_SNAPSHOT_PREFIX}name",
  c.type AS "${SOFTWARE_CATALOG_SNAPSHOT_PREFIX}type",
  c.not_null AS "${SOFTWARE_CATALOG_SNAPSHOT_PREFIX}not_null",
  c.pk AS "${SOFTWARE_CATALOG_SNAPSHOT_PREFIX}pk",
  c.dflt_value AS "${SOFTWARE_CATALOG_SNAPSHOT_PREFIX}dflt_value",
  c.hidden AS "${SOFTWARE_CATALOG_SNAPSHOT_PREFIX}hidden",
  c.foreign_keys_json AS "${SOFTWARE_CATALOG_SNAPSHOT_PREFIX}foreign_keys_json",
  c.primary_keys_json AS "${SOFTWARE_CATALOG_SNAPSHOT_PREFIX}primary_keys_json",
  sc.count AS "${SOFTWARE_CATALOG_SNAPSHOT_PREFIX}snapshot_count"
FROM catalog c
CROSS JOIN snapshot_count sc
LEFT JOIN snapshot s ON 1=1
ORDER BY c.cid
LIMIT ${SOFTWARE_CATALOG_SNAPSHOT_MAX_COLUMNS * 2 + 1}`;

type WriteColumnRow = {
  name: string;
  type: string | null;
  not_null: number;
  pk: number | null;
  dflt_value: string | null;
  hidden: number | null;
  foreign_keys_json: string | null;
  primary_keys_json: string;
};

// Snapshot catalog rows before exposing schema facts to the write planners.
// json_group_array over an empty FK list is "[]", not null or missing data.
function snapshotSpreadsheetWriteCatalog(rows: unknown): {
  rows: WriteColumnRow[];
  foreignKeys: SpreadsheetForeignKey[];
} {
  if (!Array.isArray(rows)) throw new Error("invalid_snapshot");
  const columns: WriteColumnRow[] = [];
  const names = new Set<string>();
  const pkNames = new Map<number, string>();
  let fkJson: string | undefined;
  let pkJson: string | undefined;
  const count = rows.length;
  for (let i = 0; i < count; i++) {
    const row = rows[i];
    if (!row || typeof row !== "object" || Array.isArray(row) ||
        !["name", "type", "not_null", "pk", "dflt_value", "hidden", "foreign_keys_json", "primary_keys_json"]
          .every(key => Object.hasOwn(row, key))) {
      throw new Error("invalid_snapshot");
    }
    const { name, type, not_null, pk, dflt_value, hidden, foreign_keys_json, primary_keys_json } = row;
    if (typeof name !== "string" || !isValidSqliteTableName(name) || names.has(name) ||
        (type !== null && typeof type !== "string") ||
        (not_null !== 0 && not_null !== 1) ||
        (!Number.isSafeInteger(pk) || pk < 0 || (pk > 0 && pkNames.has(pk))) ||
        (dflt_value !== null && typeof dflt_value !== "string") ||
        (hidden !== null && (!Number.isSafeInteger(hidden) || hidden < 0 || hidden > 3)) ||
        typeof foreign_keys_json !== "string" ||
        (fkJson !== undefined && foreign_keys_json !== fkJson) ||
        typeof primary_keys_json !== "string" ||
        (pkJson !== undefined && primary_keys_json !== pkJson)) {
      throw new Error("invalid_snapshot");
    }
    names.add(name);
    if (pk > 0) pkNames.set(pk, name);
    fkJson = foreign_keys_json;
    pkJson = primary_keys_json;
    columns.push({ name, type, not_null, pk, dflt_value, hidden, foreign_keys_json, primary_keys_json });
  }
  // Check the ordered key list from pragma_table_info against the xinfo
  // rows in the same D1 receipt. A valid-looking 1..N prefix is not proof
  // of a complete composite key: the last ordinal could be missing or zero.
  if (pkJson !== undefined) {
    const expected: unknown = JSON.parse(pkJson);
    if (!Array.isArray(expected) || expected.length === 0 ||
        expected.length !== pkNames.size || expected.some((name, i) =>
          typeof name !== "string" || pkNames.get(i + 1) !== name)) {
      throw new Error("invalid_snapshot");
    }
  }
  const foreignKeys: SpreadsheetForeignKey[] = [];
  if (fkJson !== undefined) {
    const parsed: unknown = JSON.parse(fkJson);
    if (!Array.isArray(parsed)) throw new Error("invalid_snapshot");
    for (const fk of parsed) {
      if (!fk || typeof fk !== "object" || Array.isArray(fk) ||
          !Object.hasOwn(fk, "column") || !Object.hasOwn(fk, "referencedTable") ||
          !Object.hasOwn(fk, "referencedColumn")) {
        throw new Error("invalid_snapshot");
      }
      const { column, referencedTable, referencedColumn } = fk;
      // The existing planner only accepts explicit, safe SQL identifiers.
      // Unsupported or malformed FK metadata must never become an empty list.
      if (typeof column !== "string" || !names.has(column) ||
          typeof referencedTable !== "string" || !isValidSqliteTableName(referencedTable) ||
          typeof referencedColumn !== "string" || !isValidSqliteTableName(referencedColumn)) {
        throw new Error("invalid_snapshot");
      }
      foreignKeys.push({ column, referencedTable, referencedColumn });
    }
  }
  return { rows: columns, foreignKeys };
}

type SpreadsheetWriteTableDef = NonNullable<ReturnType<typeof buildSpreadsheetTableDefs>[number]>;

function buildSpreadsheetWriteContextFromCatalog(
  def: SpreadsheetWriteTableDef,
  catalog: ReturnType<typeof snapshotSpreadsheetWriteCatalog>,
  now: number,
): {
  ctx: SpreadsheetWriteTableContext;
  foreignKeys: readonly SpreadsheetForeignKey[];
  fromCache: false;
} {
  const { rows, foreignKeys } = catalog;
  const enumCache = SPREADSHEET_COLUMN_ENUMS;
  const raw: (AdminSpreadsheetColumnMeta & { pk: number })[] = rows.map((row) => {
    const enumValues = enumCache[`${def.table}.${row.name}`];
    return {
      name: row.name,
      type: row.type ?? "TEXT",
      notNull: Boolean(row.not_null),
      pk: Number(row.pk ?? 0),
      editable: isSpreadsheetColumnEditable(def, row.name),
      defaultValue: row.dflt_value ?? null,
      generated: Number(row.hidden ?? 0) !== 0,
      enumValues: enumValues ? [...enumValues] : undefined,
    };
  });
  const primaryKeys = primaryKeysFromColumns(raw);
  if (raw.length === 0 || primaryKeys.length === 0 || raw.some((column) => column.generated)) {
    throw new SpreadsheetError(SPREADSHEET_ERROR.UNKNOWN_TABLE);
  }

  const ctx: SpreadsheetWriteTableContext = {
    def,
    columns: raw,
    columnNames: raw.map((column) => column.name),
    primaryKeys,
    quotedTable: quoteIdent(def.table),
  };
  const frozenFks = Object.freeze(foreignKeys);
  writeContextCache.set(def.table, { ctx, foreignKeys: frozenFks, cachedAt: now });
  return { ctx, foreignKeys: frozenFks, fromCache: false };
}

export async function resolveSpreadsheetWriteTableContext(
  db: D1Database,
  table: string,
  now = Date.now(),
): Promise<{
  ctx: SpreadsheetWriteTableContext;
  foreignKeys: readonly SpreadsheetForeignKey[];
  fromCache: boolean;
}> {
  const trimmed = table.trim();
  if (!trimmed || !isValidSqliteTableName(trimmed)) {
    throw new SpreadsheetError(SPREADSHEET_ERROR.UNKNOWN_TABLE);
  }
  const def = buildSpreadsheetTableDefs([trimmed], SPREADSHEET_SCHEMA_TABLES)[0];
  if (!def) throw new SpreadsheetError(SPREADSHEET_ERROR.UNKNOWN_TABLE);

  const hit = writeContextCache.get(def.table);
  if (hit && now - hit.cachedAt < WRITE_CACHE_TTL_MS) {
    return { ctx: hit.ctx, foreignKeys: hit.foreignKeys, fromCache: true };
  }

  // Only the catalog query crosses this provider boundary. A SELECT failure
  // cannot prove a client validation error or a mutation constraint conflict.
  let catalog: ReturnType<typeof snapshotSpreadsheetWriteCatalog>;
  try {
    const result = await db
      .prepare(TABLE_WRITE_COLUMNS_SQL)
      .bind(def.table, def.table, def.table, def.table)
      .all<WriteColumnRow>();
    if (result.success !== true) throw new Error("invalid_snapshot");
    catalog = snapshotSpreadsheetWriteCatalog(result.results);
  } catch {
    throw new Error("spreadsheet_catalog_read_failed");
  }
  return buildSpreadsheetWriteContextFromCatalog(def, catalog, now);
}

async function resolveSoftwareCatalogWriteContextWithSnapshot(
  db: D1Database,
  body: ReturnType<typeof parseSpreadsheetCrudBody>,
  now = Date.now(),
): Promise<{
  ctx: SpreadsheetWriteTableContext;
  foreignKeys: readonly SpreadsheetForeignKey[];
  before: Record<string, unknown>;
} | null> {
  if (body.table.trim() !== "software_catalog" ||
      (body.method !== "PATCH" && body.method !== "DELETE")) return null;

  // Keep this optimization deliberately narrower than the general CRUD
  // parser: these are the existing valid software_catalog PATCH/DELETE shapes.
  // Other columns, empty/null values, composite keys and unusual schemas use
  // the original catalog -> validation -> before-image path.
  if (body.method === "PATCH" &&
      (body.column !== "name" || typeof body.value !== "string" ||
       body.value.length === 0 || body.value.includes("\0"))) return null;
  const primaryKey = body.primaryKey as unknown as Record<string, unknown>;
  if (!primaryKey || typeof primaryKey !== "object" || Array.isArray(primaryKey) ||
      Object.keys(primaryKey).length !== 1 || !Object.hasOwn(primaryKey, "id")) return null;
  const id = primaryKey.id;
  if (typeof id !== "string" || id.trim() === "" || id.includes("\0")) return null;

  const def = buildSpreadsheetTableDefs(["software_catalog"], SPREADSHEET_SCHEMA_TABLES)[0];
  if (!def) return null;
  const cached = writeContextCache.get(def.table);
  if (cached && now - cached.cachedAt < WRITE_CACHE_TTL_MS) return null;

  let receipt: { success?: boolean; results?: unknown[] };
  try {
    receipt = await db.prepare(SOFTWARE_CATALOG_SNAPSHOT_SQL)
      .bind(def.table, def.table, def.table, def.table, id).all<unknown>();
  } catch {
    // This is the catalog boundary in the legacy ordering. Do not retry a
    // failed read; retrying would exceed the request-wide pre-read budget.
    throw new Error("spreadsheet_catalog_read_failed");
  }
  if (!receipt || receipt.success !== true || !Array.isArray(receipt.results)) {
    throw new Error("spreadsheet_catalog_read_failed");
  }
  const receiptRows = receipt.results;
  if (receiptRows.length === 0) throw new SpreadsheetError(SPREADSHEET_ERROR.UNKNOWN_TABLE);

  const aliases = {
    cid: SOFTWARE_CATALOG_SNAPSHOT_PREFIX + "cid",
    name: SOFTWARE_CATALOG_SNAPSHOT_PREFIX + "name",
    type: SOFTWARE_CATALOG_SNAPSHOT_PREFIX + "type",
    notNull: SOFTWARE_CATALOG_SNAPSHOT_PREFIX + "not_null",
    pk: SOFTWARE_CATALOG_SNAPSHOT_PREFIX + "pk",
    defaultValue: SOFTWARE_CATALOG_SNAPSHOT_PREFIX + "dflt_value",
    hidden: SOFTWARE_CATALOG_SNAPSHOT_PREFIX + "hidden",
    foreignKeys: SOFTWARE_CATALOG_SNAPSHOT_PREFIX + "foreign_keys_json",
    primaryKeys: SOFTWARE_CATALOG_SNAPSHOT_PREFIX + "primary_keys_json",
    snapshotCount: SOFTWARE_CATALOG_SNAPSHOT_PREFIX + "snapshot_count",
  };
  const first = receiptRows[0];
  if (!first || typeof first !== "object" || Array.isArray(first)) {
    throw new Error("spreadsheet_catalog_read_failed");
  }
  const firstRow = first as Record<string, unknown>;
  const snapshotCount = firstRow[aliases.snapshotCount];
  if (!Number.isSafeInteger(snapshotCount) || (snapshotCount as number) < 0 ||
      (snapshotCount as number) > 2) throw new Error("invalid_snapshot");
  for (const candidate of receiptRows) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      throw new Error("spreadsheet_catalog_read_failed");
    }
    const row = candidate as Record<string, unknown>;
    if (!Object.values(aliases).every(alias => Object.hasOwn(row, alias))) {
      throw new Error("spreadsheet_catalog_read_failed");
    }
    if (row[aliases.snapshotCount] !== snapshotCount) throw new Error("invalid_snapshot");
  }
  if ((snapshotCount as number) > 1) throw new Error("invalid_snapshot");
  if (receiptRows.length > SOFTWARE_CATALOG_SNAPSHOT_MAX_COLUMNS) {
    throw new Error("spreadsheet_catalog_read_failed");
  }

  const catalogRows: WriteColumnRow[] = [];
  let previousCid = -1;
  for (const candidate of receiptRows) {
    const row = candidate as Record<string, unknown>;
    const cid = row[aliases.cid];
    if (!Number.isSafeInteger(cid) || (cid as number) <= previousCid) {
      throw new Error("spreadsheet_catalog_read_failed");
    }
    previousCid = cid as number;
    catalogRows.push({
      name: row[aliases.name] as string,
      type: row[aliases.type] as string | null,
      not_null: row[aliases.notNull] as number,
      pk: row[aliases.pk] as number | null,
      dflt_value: row[aliases.defaultValue] as string | null,
      hidden: row[aliases.hidden] as number | null,
      foreign_keys_json: row[aliases.foreignKeys] as string,
      primary_keys_json: row[aliases.primaryKeys] as string,
    });
  }

  let catalog: ReturnType<typeof snapshotSpreadsheetWriteCatalog>;
  try {
    catalog = snapshotSpreadsheetWriteCatalog(catalogRows);
  } catch {
    throw new Error("spreadsheet_catalog_read_failed");
  }
  const resolved = buildSpreadsheetWriteContextFromCatalog(def, catalog, now);
  const { ctx, foreignKeys } = resolved;
  if (ctx.def.mode !== "editable" ||
      ctx.primaryKeys.length !== 1 || ctx.primaryKeys[0] !== "id" ||
      foreignKeys.length !== 0 ||
      ctx.columns.some(column => column.name.startsWith("__mig0638_"))) return null;
  if (receiptRows.length !== catalog.rows.length) throw new Error("invalid_snapshot");
  if ((snapshotCount as number) === 0) throw new Error("row_not_found");

  let beforeValues: Record<string, unknown> | null = null;
  for (const candidate of receiptRows) {
    const row = candidate as Record<string, unknown>;
    const cells: Array<[string, string | number | null]> = [];
    for (const column of ctx.columns) {
      if (!Object.hasOwn(row, column.name)) throw new Error("invalid_snapshot");
      const value = row[column.name];
      if (value !== null && typeof value !== "string" && typeof value !== "number") {
        throw new Error("invalid_snapshot");
      }
      if (typeof value === "number" && !Number.isFinite(value)) {
        throw new Error("invalid_snapshot");
      }
      cells.push([column.name, value]);
    }
    const candidateSnapshot = Object.freeze(Object.fromEntries(cells));
    if (beforeValues === null) beforeValues = candidateSnapshot;
    else if (ctx.columns.some(column =>
      !Object.is(beforeValues?.[column.name], candidateSnapshot[column.name]))) {
      throw new Error("invalid_snapshot");
    }
  }
  if (!beforeValues) throw new Error("invalid_snapshot");
  const before = snapshotSpreadsheetRawRow(ctx, { id }, beforeValues);
  return { ctx, foreignKeys, before };
}

function spreadsheetOriginOptions(c: Context<AppEnv>) {
  return {
    loadSiteUrl: () => c.env.NEXT_PUBLIC_SITE_URL ?? null,
    allowLocalPreview: () => c.env.FLAMENODE_LOCAL_PREVIEW === "1",
  };
}

function isSpreadsheetEnabled(c: Context<AppEnv>): boolean {
  const v = c.env?.ADMIN_SPREADSHEET_ENABLED?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

async function spreadsheetEnabledGuard(
  c: Context<AppEnv>,
  next: Next,
): Promise<Response | void> {
  if (!isSpreadsheetEnabled(c)) {
    return c.json({ error: "spreadsheet_disabled" }, 404, PRIVATE_HEADERS);
  }
  await next();
}

export function applySpreadsheetWriteMiddleware(
  routes: Hono<AppEnv>,
  path: string,
  session?: MiddlewareHandler<AppEnv>,
): void {
  routes.use(path, onlyMutating((c, next) => originGuardMiddleware(spreadsheetOriginOptions(c))(c, next)));
  routes.use(path, onlyMutating(spreadsheetEnabledGuard));
  routes.use(
    path,
    onlyMutating(
      (session ?? (sessionMiddleware() as unknown as MiddlewareHandler<AppEnv>)) as (
        c: Context,
        next: Next,
      ) => Promise<Response | void>,
    ),
  );
  routes.use(path, onlyMutating((c, next) => writeGuardMiddleware(spreadsheetOriginOptions(c))(c, next)));
  routes.use(path, onlyMutating(dbMiddleware));
  routes.use(path, onlyMutating(costGuardMiddleware("admin_spreadsheet")));
}

function mapSqliteMessage(message: string): string | null {
  if (/UNIQUE constraint failed/i.test(message)) return "unique_violation";
  if (/FOREIGN KEY constraint failed/i.test(message)) return "foreign_key_violation";
  if (/NOT NULL constraint failed/i.test(message)) return "not_null_violation";
  return null;
}

const CLIENT_ERROR_CODES_400 = new Set([
  SPREADSHEET_STATIC_REBUILD_SPLIT_REQUIRED,
  "unknown_table",
  "table_readonly",
  "column_not_editable",
  "physical_delete_requires_visibility_status",
  "unknown_column",
  "missing_fields",
  "empty_row",
  "missing_primary_key",
  "no_rows",
  "too_many_rows",
  "batch_too_large",
  "duplicate_primary_key",
  "unsupported_default",
  "missing_required_column",
  "value_too_long",
  "invalid_enum",
  "invalid_json_value",
  "invalid_url",
  "invalid_integer",
  "invalid_number",
  "payload_too_large",
  "invalid_json",
  "invalid_row",
  "unique_violation",
  "foreign_key_violation",
  "not_null_violation",
]);

export function spreadsheetWriteFailure(c: Context<AppEnv>, error: unknown): Response {
  let message = "";
  try {
    const columnMessage = SpreadsheetImportColumnError.readPublicMessage(error);
    if (columnMessage !== null) {
      return c.json({ error: columnMessage }, 400, PRIVATE_HEADERS);
    }
    if (error instanceof SpreadsheetError) {
      const code = error.code;
      if (code === SPREADSHEET_ERROR.DB_UNAVAILABLE || code === SPREADSHEET_ERROR.UNKNOWN_TABLE) {
        message = code;
      }
    } else if (error instanceof Error) {
      const rawMessage = error.message;
      if (typeof rawMessage === "string") {
        message = mapSqliteMessage(rawMessage) ?? rawMessage;
      }
    }
  } catch {
    // A provider error can have throwing accessors or proxy traps.
    message = "";
  }

  // Preserve fixed legacy codes and SQLite constraint categories, but never
  // expose arbitrary provider text by accepting a message prefix.
  if (CLIENT_ERROR_CODES_400.has(message)) {
    return c.json({ error: message }, 400, PRIVATE_HEADERS);
  }
  if (message === "row_not_found" || message === "spreadsheet_disabled") {
    return c.json({ error: message }, 404, PRIVATE_HEADERS);
  }
  if (message === "preview_required") {
    return c.json({ error: message }, 409, PRIVATE_HEADERS);
  }
  if (message === "preview_unavailable" || message === SPREADSHEET_ERROR.DB_UNAVAILABLE) {
    return c.json({ error: message }, 503, PRIVATE_HEADERS);
  }

  try {
    console.error("[spreadsheet] WRITE_FAILED");
  } catch {
    // Logging failure must not replace the stable HTTP error response.
  }
  return c.json({ error: "internal_error" }, 500, PRIVATE_HEADERS);
}

export type SpreadsheetStaticRebuildMutation = {
  table: string;
  operation: "CREATE" | "UPDATE" | "DELETE";
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  actorUserId: string;
  eventReleaseEventIds?: readonly string[];
};

const VIDEO_RANDOM_POOL_FIELDS = [
  "title",
  "youtube_video_id",
  "creator_display_name",
  "creator_icon_url",
  "creator_x_user_id",
  "primary_event_id",
  "scheduled_time",
  "visibility_status",
] as const;

const YOUTUBE_RELATED_STATUS_FIELDS = [
  "youtube_privacy_status",
  "youtube_availability_status",
] as const;

function valueFromMutation(mutation: SpreadsheetStaticRebuildMutation, key: string): string | null {
  const value = mutation.after?.[key] ?? mutation.before?.[key];
  if (value == null) return null;
  const normalized = String(value).trim();
  return normalized || null;
}

function valuesFromMutation(mutation: SpreadsheetStaticRebuildMutation, key: string): string[] {
  return [mutation.before?.[key], mutation.after?.[key]]
    .map((value) => {
      if (value == null) return null;
      const normalized = String(value).trim();
      return normalized || null;
    })
    .filter((value, index, values): value is string => value !== null && values.indexOf(value) === index);
}

function changed(mutation: SpreadsheetStaticRebuildMutation, fields: readonly string[]): boolean {
  if (mutation.operation !== "UPDATE") return true;
  return fields.some((field) => !Object.is(mutation.before?.[field], mutation.after?.[field]));
}

function addVideoCardGlobalTargets(
  mutation: SpreadsheetStaticRebuildMutation,
  add: (
    mutation: SpreadsheetStaticRebuildMutation,
    target: Omit<EnqueueStaticRebuildInput, "reason" | "requestedByUserId">,
  ) => void,
): void {
  add(mutation, { targetType: "random_video_pool", targetId: "global", priority: "low" });
  add(mutation, { targetType: "list_recent", targetId: "global" });
  add(mutation, { targetType: "list_popular", targetId: "global" });
  add(mutation, { targetType: "search_index", targetId: "global", priority: "low" });
  add(mutation, { targetType: "top_recommended", targetId: "global", priority: "low" });
  add(mutation, { targetType: "top_latest", targetId: "global", priority: "low" });
  add(mutation, { targetType: "top_nostalgic", targetId: "global", priority: "low" });
  add(mutation, { targetType: "recommend_core", targetId: "global", priority: "low" });
}

export function planSpreadsheetStaticRebuildTargets(
  mutations: readonly SpreadsheetStaticRebuildMutation[],
): EnqueueStaticRebuildInput[] {
  const targets = new Map<string, EnqueueStaticRebuildInput>();

  const add = (
    mutation: SpreadsheetStaticRebuildMutation,
    target: Omit<EnqueueStaticRebuildInput, "reason" | "requestedByUserId">,
  ) => {
    const planned: EnqueueStaticRebuildInput = {
      ...target,
      reason: `admin_spreadsheet_${mutation.table}_${mutation.operation.toLowerCase()}`,
      requestedByUserId: mutation.actorUserId,
    };
    targets.set(`${planned.targetType}:${planned.targetId}`, planned);
  };

  for (const mutation of mutations) {
    switch (mutation.table) {
      case "events": {
        const eventId = valueFromMutation(mutation, "id");
        if (!eventId) throw new Error("spreadsheet_static_rebuild_target_id_missing:events");
        add(mutation, { targetType: "event_base", targetId: eventId, priority: "high" });
        add(mutation, { targetType: "event_slots", targetId: eventId, priority: "high" });
        add(mutation, { targetType: "event_release", targetId: eventId, priority: "high" });
        add(mutation, { targetType: "events_index", targetId: "global", priority: "low" });
        add(mutation, { targetType: "search_index", targetId: "global", priority: "low" });
        add(mutation, { targetType: "top_events", targetId: "global" });
        add(mutation, { targetType: "top_stats", targetId: "global" });
        add(mutation, { targetType: "top_slot_stats", targetId: "global" });
        break;
      }
      case "event_groups": {
        add(mutation, { targetType: "events_index", targetId: "global", priority: "low" });
        break;
      }
      case "videos": {
        const videoId = valueFromMutation(mutation, "id");
        if (!videoId) throw new Error("spreadsheet_static_rebuild_target_id_missing:videos");
        add(mutation, { targetType: "video", targetId: videoId, priority: "high" });
        for (const eventId of valuesFromMutation(mutation, "primary_event_id")) {
          add(mutation, { targetType: "event_base", targetId: eventId, priority: "high" });
          add(mutation, { targetType: "event_release", targetId: eventId, priority: "high" });
        }
        for (const eventId of mutation.eventReleaseEventIds ?? []) {
          add(mutation, { targetType: "event_base", targetId: eventId, priority: "high" });
          add(mutation, { targetType: "event_release", targetId: eventId, priority: "high" });
        }
        if (changed(mutation, VIDEO_RANDOM_POOL_FIELDS)) {
          addVideoCardGlobalTargets(mutation, add);
        }
        if (changed(mutation, ["visibility_status"])) {
          add(mutation, { targetType: "youtube_related_blocklist", targetId: "global" });
          add(mutation, { targetType: "list_recent", targetId: "global" });
          add(mutation, { targetType: "list_popular", targetId: "global" });
          add(mutation, { targetType: "search_index", targetId: "global", priority: "low" });
        }
        break;
      }
      case "video_youtube_metadata": {
        const videoId = valueFromMutation(mutation, "video_id");
        if (!videoId) {
          throw new Error("spreadsheet_static_rebuild_target_id_missing:video_youtube_metadata");
        }
        add(mutation, { targetType: "video", targetId: videoId, priority: "high" });
        if (changed(mutation, YOUTUBE_RELATED_STATUS_FIELDS)) {
          add(mutation, { targetType: "youtube_related_blocklist", targetId: "global" });
          add(mutation, { targetType: "random_video_pool", targetId: "global", priority: "low" });
        }
        break;
      }
      case "video_events": {
        const videoIds = valuesFromMutation(mutation, "video_id");
        if (videoIds.length === 0) {
          throw new Error("spreadsheet_static_rebuild_target_id_missing:video_events");
        }
        for (const videoId of videoIds) {
          add(mutation, { targetType: "video", targetId: videoId, priority: "high" });
        }
        const eventIds = valuesFromMutation(mutation, "event_id");
        for (const eventId of eventIds) {
          add(mutation, { targetType: "event_base", targetId: eventId, priority: "high" });
          add(mutation, { targetType: "event_release", targetId: eventId, priority: "high" });
        }
        for (const eventId of mutation.eventReleaseEventIds ?? []) {
          add(mutation, { targetType: "event_base", targetId: eventId, priority: "high" });
          add(mutation, { targetType: "event_release", targetId: eventId, priority: "high" });
        }
        if (eventIds.includes(PVSF_SUMMARY_EVENT_ID)) {
          addVideoCardGlobalTargets(mutation, add);
        }
        add(mutation, { targetType: "random_video_pool", targetId: "global", priority: "low" });
        break;
      }
      case "video_members":
      case "video_chapters": {
        const videoId = valueFromMutation(mutation, "video_id");
        if (!videoId) {
          throw new Error(`spreadsheet_static_rebuild_target_id_missing:${mutation.table}`);
        }
        add(mutation, { targetType: "video", targetId: videoId, priority: "high" });
        if (mutation.table === "video_members") {
          add(mutation, { targetType: "users_index", targetId: "global", priority: "low" });
          for (const eventId of mutation.eventReleaseEventIds ?? []) {
            add(mutation, { targetType: "event_release", targetId: eventId, priority: "high" });
          }
        }
        break;
      }
      case "x_users": {
        const xUserId = valueFromMutation(mutation, "id");
        if (!xUserId) throw new Error("spreadsheet_static_rebuild_target_id_missing:x_users");
        add(mutation, { targetType: "user", targetId: xUserId });
        add(mutation, { targetType: "users_index", targetId: "global", priority: "low" });
        break;
      }
      default:
        break;
    }

    if (targets.size > SPREADSHEET_STATIC_REBUILD_TARGET_LIMIT) {
      throw new Error(SPREADSHEET_STATIC_REBUILD_SPLIT_REQUIRED);
    }
  }

  return [...targets.values()];
}

type SpreadsheetReleaseAudit = {
  table_name: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
};

function spreadsheetReleaseVideoIds(audits: readonly SpreadsheetReleaseAudit[]): string[] {
  return [
    ...new Set(
      audits
        .filter(
          (audit) =>
            audit.table_name === "video_members" ||
            audit.table_name === "video_events" ||
            audit.table_name === "videos",
        )
        .flatMap((audit) => {
          const col = audit.table_name === "videos" ? "id" : "video_id";
          return [audit.before?.[col], audit.after?.[col]]
            .map((value) => (value == null ? null : String(value).trim()))
            .filter((value): value is string => Boolean(value));
        }),
    ),
  ];
}

function spreadsheetVideoReleaseSelectSql(count: number): string {
  const placeholders = Array.from({ length: count }, () => "?").join(", ");
  return `SELECT v."id" AS videoId, ve."event_id" AS eventId, v."primary_event_id" AS primaryEventId
         FROM "videos" v
         LEFT JOIN "video_events" ve ON ve."video_id" = v."id"
         WHERE v."id" IN (${placeholders})
         LIMIT ${SPREADSHEET_STATIC_REBUILD_TARGET_LIMIT + 1}`;
}

/**
 * #893 T06: combine all supported video_members FK lookup groups and the
 * release lookup in one bounded statement. Unsupported/over-limit plans use
 * the caller's original FK-first fallback; no FK is skipped.
 * The caller passes complete effective FK rows and audit snapshots after the
 * guarded before-image read.
 */
const SPREADSHEET_MEMBER_FK_RELEASE_MAX_BINDS = 100;

export function buildSpreadsheetMemberFkReleaseLookup(
  foreignKeys: readonly SpreadsheetForeignKey[],
  rows: readonly Record<string, string | null>[],
  audits: readonly SpreadsheetReleaseAudit[],
): {
  statement: string;
  binds: readonly (string | number | null)[];
  fkLookups: readonly SpreadsheetForeignKeyLookup[];
  releaseIds: readonly string[];
} | null {
  if (audits.length < 1 || audits.length > SPREADSHEET_IMPORT_APPLY_MAX_ROWS ||
      audits.some(audit => audit.table_name !== "video_members")) return null;

  const lookups = buildSpreadsheetForeignKeyLookups(foreignKeys, rows);
  if (lookups.length < 1 || lookups.length > SPREADSHEET_FK_PREFLIGHT_MAX_QUERIES) return null;

  const videoFk = foreignKeys.filter(fk => fk.column === "video_id" &&
    fk.referencedTable === "videos" && fk.referencedColumn === "id");
  if (videoFk.length !== 1) return null;
  const videoLookups = buildSpreadsheetForeignKeyLookups(videoFk, rows);
  const sameLookup = (left: SpreadsheetForeignKeyLookup, right: SpreadsheetForeignKeyLookup): boolean =>
    left.statement === right.statement &&
    left.binds.length === right.binds.length &&
    left.binds.every((bind, index) => bind === right.binds[index]) &&
    left.values.length === right.values.length &&
    left.values.every((value, index) => value === right.values[index]);
  if (videoLookups.length < 1 ||
      !videoLookups.every(videoLookup => lookups.some(lookup => sameLookup(lookup, videoLookup)))) {
    return null;
  }

  const releaseIds = spreadsheetReleaseVideoIds(audits);
  if (releaseIds.length < 1 || releaseIds.length > 2 * SPREADSHEET_IMPORT_APPLY_MAX_ROWS ||
      releaseIds.some(id => id.includes("\0"))) return null;

  const totalBinds = lookups.reduce((total, lookup) => total + lookup.binds.length, 0) + releaseIds.length;
  if (!Number.isSafeInteger(totalBinds) || totalBinds > SPREADSHEET_MEMBER_FK_RELEASE_MAX_BINDS) return null;

  // Preserve the existing single-FK CTE name. Multi-FK plans use generated
  // ordinals, never request-controlled identifiers, and each CTE retains its
  // own lookup sentinel LIMIT so one FK cannot hide another FK's overflow.
  const cteNames = lookups.map((_, index) => lookups.length === 1 ? "fk" : "fk_" + index);
  const ctes = lookups.map((lookup, index) => cteNames[index] + " AS (" + lookup.statement + ")");
  ctes.push("release AS (" + spreadsheetVideoReleaseSelectSql(releaseIds.length) + ")");
  const fkSelects = lookups.map((_, index) =>
    "SELECT 'fk' AS kind, " + index + " AS fkIndex, value, NULL AS videoId, NULL AS eventId, NULL AS primaryEventId FROM " + cteNames[index]);
  const releaseSelect =
    "SELECT 'release' AS kind, NULL AS fkIndex, NULL AS value, videoId, eventId, primaryEventId FROM release";
  const fkRowLimit = lookups.reduce((total, lookup) => total + lookup.values.length + 1, 0);
  const totalRowLimit = fkRowLimit + SPREADSHEET_STATIC_REBUILD_TARGET_LIMIT + 1;
  const statement = "WITH " + ctes.join(", ") + "\n" +
    [...fkSelects, releaseSelect].join("\nUNION ALL\n") +
    "\nLIMIT " + totalRowLimit;

  const frozenLookups = Object.freeze(lookups.map(lookup => Object.freeze({
    ...lookup,
    binds: Object.freeze([...lookup.binds]),
    values: Object.freeze([...lookup.values]),
  })));
  return {
    statement,
    binds: Object.freeze([...lookups.flatMap(lookup => lookup.binds), ...releaseIds]),
    fkLookups: frozenLookups,
    releaseIds: Object.freeze(releaseIds),
  };
}


/**
 * Combine the fresh video_members before-image, every effective FK lookup,
 * and release-event rows in one bounded read. The result keeps the complete
 * snapshot as scalar columns (no JSON.parse/stringify of row data).
 */
function buildSpreadsheetMemberSnapshotFkReleaseLookup(
  ctx: SpreadsheetWriteTableContext,
  foreignKeys: readonly SpreadsheetForeignKey[],
  prepared: PreparedSpreadsheetCrudMutation,
): { statement: string; binds: readonly (string | number | null)[] } | null {
  if (ctx.def.table !== "video_members" ||
      (prepared.method !== "PATCH" && prepared.method !== "DELETE") ||
      ctx.primaryKeys.length !== 1 || ctx.primaryKeys[0] !== "id" ||
      foreignKeys.length < 1 || foreignKeys.length > SPREADSHEET_FK_PREFLIGHT_MAX_QUERIES ||
      ctx.columns.length < 1) {
    return null;
  }
  const names = ctx.columns.map(column => column.name);
  const prefix = "__mig0638_";
  if (new Set(names).size !== names.length ||
      names.some(name => !isValidSqliteTableName(name) || name.startsWith(prefix)) ||
      !names.includes("video_id") ||
      foreignKeys.some(fk => !names.includes(fk.column) ||
        !isValidSqliteTableName(fk.column) ||
        !isValidSqliteTableName(fk.referencedTable) ||
        !isValidSqliteTableName(fk.referencedColumn))) {
    return null;
  }
  const videoFkIndexes = foreignKeys
    .map((fk, index) => fk.column === "video_id" &&
      fk.referencedTable === "videos" && fk.referencedColumn === "id" ? index : -1)
    .filter(index => index >= 0);
  if (videoFkIndexes.length !== 1) return null;
  const videoFkIndex = videoFkIndexes[0]!;
  const mutationEntries = prepared.values ? Object.entries(prepared.values) : [];
  if ((prepared.method === "PATCH" && mutationEntries.length !== 1) ||
      (prepared.method === "DELETE" && mutationEntries.length !== 0)) {
    return null;
  }
  if (!Object.hasOwn(prepared.pk, "id") || typeof prepared.pk.id !== "string") return null;

  const fkAliases = foreignKeys.map((_, index) => prefix + "fk_" + index + "_value");
  const snapshotCountAlias = prefix + "snapshot_count";
  const releaseCountAlias = prefix + "release_count";
  const releaseVideoAlias = prefix + "release_video_id";
  const releaseEventAlias = prefix + "release_event_id";
  const releasePrimaryAlias = prefix + "release_primary_event_id";
  const keyWhere = ctx.primaryKeys.map(key => quoteIdent(key) + " = ?").join(" AND ");
  const mutationColumn = mutationEntries[0]?.[0] ?? null;
  const mutationValue = mutationEntries[0]?.[1] ?? null;
  const effectiveColumns = foreignKeys.map((fk, index) =>
    "CASE WHEN m.column_name = ? THEN NULLIF(m.cell_value, '') ELSE s." +
    quoteIdent(fk.column) + " END AS " + quoteIdent(fkAliases[index]!),
  );
  const ctes = [
    "snapshot AS (SELECT * FROM " + quoteIdent(ctx.def.table) +
      " WHERE " + keyWhere + " LIMIT 2)",
    'snapshot_count AS (SELECT COUNT(*) AS "count" FROM snapshot)',
    "snapshot_one AS (SELECT * FROM snapshot LIMIT 1)",
    "mutation_input AS (SELECT ? AS column_name, ? AS cell_value)",
    "effective AS (SELECT s.*, " + effectiveColumns.join(", ") +
      " FROM snapshot_one s CROSS JOIN mutation_input m)",
    "trim_chars AS (SELECT ? AS chars)",
    ...foreignKeys.map((fk, index) => {
      const alias = quoteIdent(fkAliases[index]!);
      const referenceColumn = quoteIdent(fk.referencedColumn);
      return "fk_" + index + " AS (SELECT " + referenceColumn + " AS value FROM " +
        quoteIdent(fk.referencedTable) + " WHERE " + referenceColumn +
        " IN (SELECT " + alias + " FROM effective WHERE " + alias +
        " IS NOT NULL AND " + alias + " <> '') LIMIT 2)";
    }),
    "release_ids AS (" +
      "SELECT trim(CAST(s." + quoteIdent("video_id") + " AS TEXT), (SELECT chars FROM trim_chars)) AS id " +
      "FROM snapshot_one s WHERE s." + quoteIdent("video_id") +
      " IS NOT NULL AND trim(CAST(s." + quoteIdent("video_id") + " AS TEXT), (SELECT chars FROM trim_chars)) <> '' " +
      "UNION " +
      "SELECT trim(CAST(e." + quoteIdent(fkAliases[videoFkIndex]!) +
      " AS TEXT), (SELECT chars FROM trim_chars)) AS id " +
      "FROM effective e WHERE e." + quoteIdent(fkAliases[videoFkIndex]!) +
      " IS NOT NULL AND trim(CAST(e." + quoteIdent(fkAliases[videoFkIndex]!) +
      " AS TEXT), (SELECT chars FROM trim_chars)) <> '')",
    "release AS (SELECT v." + quoteIdent("id") + " AS videoId, ve." +
      quoteIdent("event_id") + " AS eventId, v." + quoteIdent("primary_event_id") +
      " AS primaryEventId FROM " + quoteIdent("videos") + " v LEFT JOIN " +
      quoteIdent("video_events") + " ve ON ve." + quoteIdent("video_id") +
      " = v." + quoteIdent("id") + " WHERE v." + quoteIdent("id") +
      " IN (SELECT id FROM release_ids) LIMIT " +
      (SPREADSHEET_STATIC_REBUILD_TARGET_LIMIT + 1) + ")",
    'release_count AS (SELECT COUNT(*) AS "count" FROM release)',
    "snapshot_projection AS (SELECT * FROM snapshot_one UNION ALL SELECT " +
      ctx.columns.map(column => "NULL AS " + quoteIdent(column.name)).join(", ") +
      ' WHERE (SELECT "count" FROM snapshot_count) = 0)',
  ];
  const fkSelects = foreignKeys.flatMap((_, index) => {
    const alias = quoteIdent(fkAliases[index]!);
    return [
      "(SELECT " + alias + " FROM effective LIMIT 1) AS " + quoteIdent(prefix + "fk_" + index + "_expected"),
      '(SELECT COUNT(*) FROM fk_' + index + ") AS " + quoteIdent(prefix + "fk_" + index + "_count"),
      "(SELECT MAX(value) FROM fk_" + index + ") AS " + quoteIdent(prefix + "fk_" + index + "_found"),
    ];
  });
  const statement = "WITH " + ctes.join(",\n") + "\n" +
    'SELECT s.*, sc."count" AS ' + quoteIdent(snapshotCountAlias) +
    ' , rc."count" AS ' + quoteIdent(releaseCountAlias) + ", " +
    [...fkSelects,
      "r.videoId AS " + quoteIdent(releaseVideoAlias),
      "r.eventId AS " + quoteIdent(releaseEventAlias),
      "r.primaryEventId AS " + quoteIdent(releasePrimaryAlias),
    ].join(", ") +
    " FROM snapshot_projection s CROSS JOIN snapshot_count sc CROSS JOIN release_count rc " +
    "LEFT JOIN release r ON 1 = 1 LIMIT " + (SPREADSHEET_STATIC_REBUILD_TARGET_LIMIT + 1);
  const binds: (string | number | null)[] = [
    ...ctx.primaryKeys.map(key => prepared.pk[key]!),
    mutationColumn,
    mutationValue,
    ...foreignKeys.map(fk => fk.column),
    SPREADSHEET_JS_TRIM_CHARS,
  ];
  if (binds.length > SPREADSHEET_MEMBER_FK_RELEASE_MAX_BINDS) return null;
  return { statement, binds: Object.freeze(binds) };
}

/**
 * Validate the tagged result of the bounded member FK/release CTE.
 * Every FK group is validated in original planner order before release
 * overflow/row validation, preserving CURRENT's FK-first error precedence.
 */
function validateSpreadsheetMemberReleaseLookupRows(
  releaseIds: readonly string[],
  releaseRows: readonly unknown[],
): { eventIdsByVideo: Map<string, string[]> } {
  if (releaseRows.length > SPREADSHEET_STATIC_REBUILD_TARGET_LIMIT) {
    throw new Error(SPREADSHEET_STATIC_REBUILD_SPLIT_REQUIRED);
  }
  const requested = new Set(releaseIds);
  const seenReleaseTuples = new Set<string>();
  const eventIdsByVideo = new Map<string, Set<string>>();
  const linkedEventIds = new Set<string>();
  let overflow = false;
  try {
    for (const candidate of releaseRows) {
      if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
        throw new Error("invalid_snapshot");
      }
      const row = candidate as Record<string, unknown>;
      if (!Object.hasOwn(row, "value") || !Object.hasOwn(row, "videoId") ||
          !Object.hasOwn(row, "eventId") || !Object.hasOwn(row, "primaryEventId")) {
        throw new Error("invalid_snapshot");
      }
      const { value, videoId, eventId, primaryEventId } = row;
      if (value !== null || typeof videoId !== "string" || !requested.has(videoId) ||
          (eventId !== null && typeof eventId !== "string") ||
          (primaryEventId !== null && typeof primaryEventId !== "string")) {
        throw new Error("invalid_snapshot");
      }
      // Do not let a malformed provider receipt collapse into the event Sets.
      // Distinct rows may share primaryEventId, but an identical source tuple is invalid.
      const releaseTuple = JSON.stringify([videoId, eventId, primaryEventId]);
      if (seenReleaseTuples.has(releaseTuple)) throw new Error("invalid_snapshot");
      seenReleaseTuples.add(releaseTuple);
      const eventIds = eventIdsByVideo.get(videoId) ?? new Set<string>();
      for (const linkedId of [eventId, primaryEventId]) {
        const normalized = (linkedId as string | null)?.trim();
        if (normalized) {
          eventIds.add(normalized);
          linkedEventIds.add(normalized);
        }
      }
      if (linkedEventIds.size > SPREADSHEET_STATIC_REBUILD_TARGET_LIMIT) {
        overflow = true;
        break;
      }
      eventIdsByVideo.set(videoId, eventIds);
    }
  } catch {
    throw new Error("invalid_snapshot");
  }
  if (overflow) throw new Error(SPREADSHEET_STATIC_REBUILD_SPLIT_REQUIRED);
  return { eventIdsByVideo: new Map([...eventIdsByVideo].map(([id, ids]) => [id, [...ids]])) };
}

export function validateSpreadsheetMemberFkReleaseLookupReceipt(
  plan: { fkLookups: readonly SpreadsheetForeignKeyLookup[]; releaseIds: readonly string[] },
  result: { success: boolean; results: unknown[] },
): { eventIdsByVideo: Map<string, string[]> } {
  const fkRowsByIndex: Array<Array<{ value: string | number | null }>> = [];
  const releaseRows: unknown[] = [];
  // Provider receipt access (including accessors/proxy traps) is not a
  // domain decision. Never let it forge a preview, FK or constraint error.
  try {
    if (!plan || !Array.isArray(plan.fkLookups) ||
        plan.fkLookups.length < 1 ||
        plan.fkLookups.length > SPREADSHEET_FK_PREFLIGHT_MAX_QUERIES ||
        !Array.isArray(plan.releaseIds) || !result || result.success !== true) {
      throw new Error("invalid_snapshot");
    }
    const fkRowLimit = plan.fkLookups.reduce((total, lookup) => {
      if (!lookup || !Array.isArray(lookup.values) ||
          lookup.values.length < 1 || lookup.values.length > 99) {
        throw new Error("invalid_snapshot");
      }
      return total + lookup.values.length + 1;
    }, 0);
    const rows = result.results;
    const maxRows = fkRowLimit + SPREADSHEET_STATIC_REBUILD_TARGET_LIMIT + 1;
    if (!Array.isArray(rows) || rows.length > maxRows) throw new Error("invalid_snapshot");
    for (let index = 0; index < plan.fkLookups.length; index++) fkRowsByIndex.push([]);

    for (const row of rows) {
      if (!row || typeof row !== "object" || Array.isArray(row) ||
          !Object.hasOwn(row, "kind") || !Object.hasOwn(row, "fkIndex") ||
          !Object.hasOwn(row, "value") || !Object.hasOwn(row, "videoId") ||
          !Object.hasOwn(row, "eventId") || !Object.hasOwn(row, "primaryEventId")) {
        throw new Error("invalid_snapshot");
      }
      const kind = (row as { kind?: unknown }).kind;
      const fkIndex = (row as { fkIndex?: unknown }).fkIndex;
      const value = (row as { value?: unknown }).value;
      if (kind === "fk") {
        if (typeof fkIndex !== "number" || !Number.isSafeInteger(fkIndex) ||
            fkIndex < 0 || fkIndex >= fkRowsByIndex.length ||
            (row as { videoId: unknown }).videoId !== null ||
            (row as { eventId: unknown }).eventId !== null ||
            (row as { primaryEventId: unknown }).primaryEventId !== null) {
          throw new Error("invalid_snapshot");
        }
        fkRowsByIndex[fkIndex]!.push({ value: value as string | number | null });
      } else if (kind === "release") {
        if (fkIndex !== null || value !== null) throw new Error("invalid_snapshot");
        releaseRows.push(row);
      } else {
        throw new Error("invalid_snapshot");
      }
    }
  } catch {
    throw new Error("invalid_snapshot");
  }

  // Local arrays preserve the canonical lookup order. A genuine missing FK
  // remains distinguishable from malformed provider data and release overflow.
  for (let index = 0; index < plan.fkLookups.length; index++) {
    assertSpreadsheetForeignKeyLookup(plan.fkLookups[index]!, fkRowsByIndex[index]!);
  }
  return validateSpreadsheetMemberReleaseLookupRows(plan.releaseIds, releaseRows);
}


/**
 * Validate the one-read member snapshot/FK/release receipt. FK checks are
 * evaluated in catalog order before release overflow or target validation.
 */
export function validateSpreadsheetMemberSnapshotFkReleaseLookupReceipt(
  ctx: SpreadsheetWriteTableContext,
  foreignKeys: readonly SpreadsheetForeignKey[],
  prepared: PreparedSpreadsheetCrudMutation,
  result: { success: boolean; results: unknown[] },
): { before: Record<string, unknown>; eventIdsByVideo: Map<string, string[]> } {
  const prefix = "__mig0638_";
  const snapshotCountAlias = prefix + "snapshot_count";
  const releaseCountAlias = prefix + "release_count";
  const releaseVideoAlias = prefix + "release_video_id";
  const releaseEventAlias = prefix + "release_event_id";
  const releasePrimaryAlias = prefix + "release_primary_event_id";
  const fkStates: Array<{
    expected: string | number | null;
    count: number;
    found: string | number | null;
  } | null> = foreignKeys.map(() => null);
  const releaseRows: unknown[] = [];
  let snapshotCount: number | null = null;
  let releaseCount: number | null = null;
  let snapshotValues: Record<string, unknown> | null = null;

  try {
    if (!result || result.success !== true || !Array.isArray(result.results) ||
        result.results.length < 1 ||
        result.results.length > SPREADSHEET_STATIC_REBUILD_TARGET_LIMIT + 1) {
      throw new Error("invalid_snapshot");
    }
    const required = [
      ...ctx.columns.map(column => column.name),
      snapshotCountAlias,
      releaseCountAlias,
      releaseVideoAlias,
      releaseEventAlias,
      releasePrimaryAlias,
      ...foreignKeys.flatMap((_, index) => [
        prefix + "fk_" + index + "_expected",
        prefix + "fk_" + index + "_count",
        prefix + "fk_" + index + "_found",
      ]),
    ];
    for (const candidate of result.results) {
      if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
        throw new Error("invalid_snapshot");
      }
      const row = candidate as Record<string, unknown>;
      if (!required.every(key => Object.hasOwn(row, key))) throw new Error("invalid_snapshot");

      const nextSnapshotCount = row[snapshotCountAlias];
      const nextReleaseCount = row[releaseCountAlias];
      if (!Number.isSafeInteger(nextSnapshotCount) || (nextSnapshotCount as number) < 0 ||
          (nextSnapshotCount as number) > 2 ||
          !Number.isSafeInteger(nextReleaseCount) || (nextReleaseCount as number) < 0 ||
          (nextReleaseCount as number) > SPREADSHEET_STATIC_REBUILD_TARGET_LIMIT + 1) {
        throw new Error("invalid_snapshot");
      }
      if (snapshotCount === null) snapshotCount = nextSnapshotCount as number;
      else if (snapshotCount !== nextSnapshotCount) throw new Error("invalid_snapshot");
      if (releaseCount === null) releaseCount = nextReleaseCount as number;
      else if (releaseCount !== nextReleaseCount) throw new Error("invalid_snapshot");

      const cells: Array<[string, string | number | null]> = [];
      for (const column of ctx.columns) {
        const value = row[column.name];
        if (value !== null && typeof value !== "string" && typeof value !== "number") {
          throw new Error("invalid_snapshot");
        }
        if (typeof value === "number" && !Number.isFinite(value)) {
          throw new Error("invalid_snapshot");
        }
        cells.push([column.name, value]);
      }
      const candidateSnapshot = Object.fromEntries(cells);
      if (snapshotValues === null) snapshotValues = candidateSnapshot;
      else {
        for (const column of ctx.columns) {
          if (!Object.is(snapshotValues[column.name], candidateSnapshot[column.name])) {
            throw new Error("invalid_snapshot");
          }
        }
      }
      if (snapshotCount === 0 && cells.some(([, value]) => value !== null)) {
        throw new Error("invalid_snapshot");
      }

      for (let index = 0; index < foreignKeys.length; index++) {
        const expected = row[prefix + "fk_" + index + "_expected"];
        const count = row[prefix + "fk_" + index + "_count"];
        const found = row[prefix + "fk_" + index + "_found"];
        if ((expected !== null && typeof expected !== "string" && typeof expected !== "number") ||
            (typeof expected === "number" && !Number.isFinite(expected)) ||
            !Number.isSafeInteger(count) || (count as number) < 0 || (count as number) > 2 ||
            (found !== null && typeof found !== "string" && typeof found !== "number") ||
            (typeof found === "number" && !Number.isFinite(found)) ||
            ((count as number) === 0 && found !== null) ||
            ((count as number) > 0 && found === null)) {
          throw new Error("invalid_snapshot");
        }
        const state = {
          expected: expected as string | number | null,
          count: count as number,
          found: found as string | number | null,
        };
        const prior = fkStates[index];
        if (prior === null) fkStates[index] = state;
        else if (!Object.is(prior.expected, state.expected) ||
            prior.count !== state.count || !Object.is(prior.found, state.found)) {
          throw new Error("invalid_snapshot");
        }
      }

      const videoId = row[releaseVideoAlias];
      const eventId = row[releaseEventAlias];
      const primaryEventId = row[releasePrimaryAlias];
      if (videoId === null) {
        if (eventId !== null || primaryEventId !== null) throw new Error("invalid_snapshot");
      } else {
        if (typeof videoId !== "string" ||
            (eventId !== null && typeof eventId !== "string") ||
            (primaryEventId !== null && typeof primaryEventId !== "string")) {
          throw new Error("invalid_snapshot");
        }
        releaseRows.push({ value: null, videoId, eventId, primaryEventId });
      }
    }
    if (snapshotCount === null || releaseCount === null ||
        releaseRows.length !== releaseCount ||
        result.results.length !== Math.max(1, releaseCount)) {
      throw new Error("invalid_snapshot");
    }
  } catch {
    throw new Error("invalid_snapshot");
  }

  if (snapshotCount === 0) throw new Error("row_not_found");
  if (snapshotCount !== 1 || !snapshotValues) throw new Error("invalid_snapshot");
  const before = snapshotSpreadsheetRawRow(ctx, prepared.pk as Record<string, string>, snapshotValues);
  const effectiveEntries: Array<[string, unknown]> = Object.entries(before);
  if (prepared.values) {
    for (const [column, value] of Object.entries(prepared.values)) {
      const index = effectiveEntries.findIndex(([name]) => name === column);
      const normalized = value === "" ? null : value;
      if (index < 0) effectiveEntries.push([column, normalized]);
      else effectiveEntries[index] = [column, normalized];
    }
  }
  const effectiveRow = Object.fromEntries(effectiveEntries);

  // Keep the exact FK error precedence and canonical catalog order.
  for (let index = 0; index < foreignKeys.length; index++) {
    const fk = foreignKeys[index]!;
    if (!Object.hasOwn(effectiveRow, fk.column)) throw new Error("invalid_snapshot");
    const raw = effectiveRow[fk.column];
    let normalized: string | null;
    if (raw === null || raw === "") normalized = raw as null | "";
    else if (typeof raw === "string") {
      if (raw.includes("\0")) throw new Error("invalid_snapshot");
      normalized = raw;
    } else if (typeof raw === "number" && Number.isFinite(raw)) {
      normalized = String(raw);
    } else {
      throw new Error("invalid_snapshot");
    }
    const state = fkStates[index];
    if (!state) throw new Error("invalid_snapshot");
    const expected = state.expected === null ? null :
      typeof state.expected === "number" ? String(state.expected) : state.expected;
    if (expected !== normalized) throw new Error("invalid_snapshot");
    const lookupRow = Object.freeze({ [fk.column]: normalized });
    const lookups = buildSpreadsheetForeignKeyLookups([fk], [lookupRow]);
    if (lookups.length === 0) {
      if (state.count !== 0 || state.found !== null) throw new Error("invalid_snapshot");
      continue;
    }
    if (lookups.length !== 1 || state.count === 2) throw new Error("invalid_snapshot");
    const rows = state.count === 1 ? [{ value: state.found! }] : [];
    assertSpreadsheetForeignKeyLookup(lookups[0]!, rows);
  }

  const after = prepared.method === "PATCH" ? effectiveRow : null;
  const releaseIds = spreadsheetReleaseVideoIds([{
    table_name: "video_members",
    before,
    after,
  }]);
  const release = validateSpreadsheetMemberReleaseLookupRows(releaseIds, releaseRows);
  return { before, eventIdsByVideo: release.eventIdsByVideo };
}

export async function loadSpreadsheetVideoReleaseEvents(
  db: D1Database,
  audits: readonly SpreadsheetReleaseAudit[],
): Promise<{ eventIdsByVideo: Map<string, string[]>; reads: number }> {
  const videoIds = spreadsheetReleaseVideoIds(audits);
  const eventIdsByVideo = new Map<string, Set<string>>();
  if (videoIds.length === 0) return { eventIdsByVideo: new Map(), reads: 0 };

  let reads = 0;
  const linkedEventIds = new Set<string>();
  for (let offset = 0; offset < videoIds.length; offset += SPREADSHEET_VIDEO_EVENT_LOOKUP_CHUNK_SIZE) {
    const chunk = videoIds.slice(offset, offset + SPREADSHEET_VIDEO_EVENT_LOOKUP_CHUNK_SIZE);
    reads += 1;
    // A malformed receipt does not establish that no events are linked.
    // Keep provider faults separate from genuine split-limit errors.
    let overflow = false;
    try {
      const result = await db
        .prepare(
          spreadsheetVideoReleaseSelectSql(chunk.length),
        )
        .bind(...chunk)
        .all<{ videoId: string; eventId: string | null; primaryEventId: string | null }>();
      const rows = result.results;
      if (result.success !== true || !Array.isArray(rows)) {
        throw new Error("invalid_snapshot");
      }
      const rowCount = rows.length;
      if (!Number.isSafeInteger(rowCount) || rowCount < 0) {
        throw new Error("invalid_snapshot");
      }
      if (rowCount > SPREADSHEET_STATIC_REBUILD_TARGET_LIMIT) {
        overflow = true;
      } else {
        const requested = new Set(chunk);
        for (let i = 0; i < rowCount; i++) {
          const row = rows[i];
          if (!row || typeof row !== "object" || Array.isArray(row) ||
              !Object.hasOwn(row, "videoId") || !Object.hasOwn(row, "eventId") ||
              !Object.hasOwn(row, "primaryEventId")) {
            throw new Error("invalid_snapshot");
          }
          const { videoId, eventId, primaryEventId } = row;
          if (typeof videoId !== "string" || !requested.has(videoId) ||
              (eventId !== null && typeof eventId !== "string") ||
              (primaryEventId !== null && typeof primaryEventId !== "string")) {
            throw new Error("invalid_snapshot");
          }
          const eventIds = eventIdsByVideo.get(videoId) ?? new Set<string>();
          for (const linkedId of [eventId, primaryEventId]) {
            const normalized = linkedId?.trim();
            if (normalized) {
              eventIds.add(normalized);
              linkedEventIds.add(normalized);
            }
          }
          if (linkedEventIds.size > SPREADSHEET_STATIC_REBUILD_TARGET_LIMIT) {
            overflow = true;
            break;
          }
          eventIdsByVideo.set(videoId, eventIds);
        }
      }
    } catch {
      throw new Error("spreadsheet_release_lookup_failed");
    }
    if (overflow) throw new Error(SPREADSHEET_STATIC_REBUILD_SPLIT_REQUIRED);
  }
  return {
    eventIdsByVideo: new Map([...eventIdsByVideo].map(([videoId, eventIds]) => [videoId, [...eventIds]])),
    reads,
  };
}

export function deriveSpreadsheetQueueTargets(
  audits: readonly {
    table_name: string;
    operation: "CREATE" | "UPDATE" | "DELETE";
    before: Record<string, unknown> | null;
    after: Record<string, unknown> | null;
    actor_user_id: string;
  }[],
  videoReleaseEvents: ReadonlyMap<string, readonly string[]>,
): EnqueueStaticRebuildInput[] {
  return planSpreadsheetStaticRebuildTargets(
    audits.map((audit) => ({
      table: audit.table_name,
      operation: audit.operation,
      before: audit.before,
      after: audit.after,
      actorUserId: audit.actor_user_id,
      eventReleaseEventIds:
        audit.table_name === "video_members" ||
        audit.table_name === "video_events" ||
        audit.table_name === "videos"
          ? [
              ...new Set(
                [
                  audit.before?.[audit.table_name === "videos" ? "id" : "video_id"],
                  audit.after?.[audit.table_name === "videos" ? "id" : "video_id"],
                ]
                  .map((value) => (value == null ? null : String(value).trim()))
                  .filter((value): value is string => Boolean(value))
                  .flatMap((videoId) => videoReleaseEvents.get(videoId) ?? []),
              ),
            ]
          : undefined,
    })),
  );
}

export function countingRawDb(rawDb: D1Database, counter: { reads: number }): D1Database {
  // The CRUD/import planners use prepare/bind/all for read-only preflights.
  // Provider exceptions cannot establish a missing row, FK violation or
  // preview conflict. Keep actual planner and mutation errors outside this
  // boundary so their existing client-facing classifications remain intact.
  function guardPreflightSetup<T>(operation: () => T): T {
    try {
      return operation();
    } catch {
      throw new Error("spreadsheet_preflight_read_failed");
    }
  }
  const wrapExecutable = (stmt: D1PreparedStatement): D1PreparedStatement => ({
    ...stmt,
    bind(...values: unknown[]) {
      return guardPreflightSetup(() => wrapExecutable(stmt.bind(...values)));
    },
    first: async <T>(colName?: string) => {
      counter.reads += 1;
      return colName === undefined ? stmt.first<T>() : stmt.first<T>(colName);
    },
    all: async <T>() => {
      counter.reads += 1;
      try {
        const receipt = await stmt.all<T>();
        const success = receipt.success;
        const results = receipt.results;
        // Missing or unsuccessful read receipts cannot establish absence of
        // rows, a missing FK, an empty catalog or a new UPSERT identity.
        // Snapshot the envelope once before exposing it to the planners.
        if (success !== true || !Array.isArray(results)) {
          throw new Error("invalid_snapshot");
        }
        return { success: true, results, meta: receipt.meta };
      } catch {
        throw new Error("spreadsheet_preflight_read_failed");
      }
    },
    run: async <T>() => {
      counter.reads += 1;
      return stmt.run<T>();
    },
    raw: ((options?: { columnNames?: boolean }) => {
      counter.reads += 1;
      if (options?.columnNames === true) {
        return stmt.raw({ columnNames: true });
      }
      if (options) {
        return stmt.raw({ columnNames: false });
      }
      return stmt.raw();
    }) as D1PreparedStatement["raw"],
  }) as D1PreparedStatement;

  return {
    prepare(query: string) {
      return guardPreflightSetup(() => wrapExecutable(rawDb.prepare(query)));
    },
    batch: rawDb.batch.bind(rawDb),
    exec: rawDb.exec?.bind(rawDb),
    dump: rawDb.dump?.bind(rawDb),
    withSession: rawDb.withSession?.bind(rawDb),
  } as D1Database;
}

async function buildCrudAtomicBatch(
  db: ServerCoreDb,
  ctx: SpreadsheetWriteTableContext,
  plan: SpreadsheetAuditedSqlPlan,
  options: {
    authorizedActorId: string;
    callerQueryCount: number;
    queueTargets: readonly EnqueueStaticRebuildInput[];
    preloaded: ReturnType<typeof auditPreloaded>;
  },
): Promise<AtomicAuditMutationInput> {
  if (
    options.queueTargets.length >= 1 &&
    options.queueTargets.length <= SPREADSHEET_ATOMIC_MAX_REBUILD_TARGETS
  ) {
    return planSpreadsheetAtomicAuditedCrud(db, ctx, plan, options);
  }
  const mutation = db.run(spreadsheetMutationToBoundSql(ctx, plan));
  const queue =
    options.queueTargets.length > 0
      ? await buildStaticRebuildQueueBatch(db, [...options.queueTargets])
      : { statements: [], expectedChanges: [], acceptedTargetCount: 0 };
  if (queue.statements.length > SPREADSHEET_MAX_STATIC_REBUILD_QUEUE_STATEMENTS) {
    throw new Error(SPREADSHEET_STATIC_REBUILD_SPLIT_REQUIRED);
  }
  const input: AtomicAuditMutationInput = {
    mutationStatements: [mutation, ...queue.statements],
    expectedMutationChanges: [1, ...queue.expectedChanges],
    audits: [{ ...plan.audit }],
    callerQueryCount: options.callerQueryCount,
    preloaded: options.preloaded,
    staticRebuildWakeSource: queue.statements.length > 0 ? "admin" : undefined,
  };
  if (!planAtomicAuditMutationBudget(input).withinLimit) {
    throw new Error("batch_too_large");
  }
  assertAtomicAuditMutationBindLimits(db, input);
  return input;
}

export function spreadsheetMemberForeignKeyRowFromAudit(
  audit: SpreadsheetReleaseAudit,
  foreignKeys: readonly SpreadsheetForeignKey[],
): Record<string, string | null> {
  const inserted = audit.after ?? audit.before;
  if (!inserted) throw new Error("invalid_snapshot");
  const cells: Array<[string, string | null]> = [];
  for (const foreignKey of foreignKeys) {
    if (!Object.hasOwn(inserted, foreignKey.column)) throw new Error("invalid_snapshot");
    const value = inserted[foreignKey.column];
    if (value == null || value === "") cells.push([foreignKey.column, null]);
    else if (typeof value === "string") cells.push([foreignKey.column, value]);
    else if (typeof value === "number" && Number.isFinite(value)) cells.push([foreignKey.column, String(value)]);
    else throw new Error("invalid_snapshot");
  }
  return Object.freeze(Object.fromEntries(cells));
}

async function handleCrudWrite(
  c: Context<AppEnv>,
  method: SpreadsheetCrudMethod,
): Promise<Response> {
  const user = c.get("user");
  if (!user) return c.json({ ok: false, reason: "unauthenticated" }, 401, PRIVATE_HEADERS);

  try {
    const rawBody = await readSpreadsheetJsonBody<unknown>(c.req.raw);
    const crudBody = parseSpreadsheetCrudBody(method, rawBody);
    const rawDb = getSpreadsheetDb(c.env.DB);
    const db = c.get("db");
    const preloaded = auditPreloaded(c);

    // Track exact handler D1 pre-reads in addition to the shared middleware.
    const readCounter = { reads: 0 };
    const countedDb = countingRawDb(rawDb, readCounter);
    const catalogSnapshot = await resolveSoftwareCatalogWriteContextWithSnapshot(countedDb, crudBody);
    const { ctx, foreignKeys } = catalogSnapshot ?? await resolveSpreadsheetWriteTableContext(
      countedDb,
      crudBody.table,
    );
    const memberMutation = crudBody.table === "video_members";
    let plan: SpreadsheetAuditedSqlPlan;
    let eventIdsByVideo: Map<string, string[]>;
    let videoReads = 0;

    if (catalogSnapshot) {
      const prepared = prepareSpreadsheetGuardedCrudMutation(ctx, crudBody, user.id);
      plan = buildSpreadsheetGuardedCrudPlanFromSnapshot(
        ctx, prepared, catalogSnapshot.before, user.id,
      );
      eventIdsByVideo = new Map();
    } else if (memberMutation && (crudBody.method === "PATCH" || crudBody.method === "DELETE")) {
      const prepared = prepareSpreadsheetGuardedCrudMutation(ctx, crudBody, user.id);
      const snapshotLookup = buildSpreadsheetMemberSnapshotFkReleaseLookup(ctx, foreignKeys, prepared);
      if (snapshotLookup) {
        const receipt = await countedDb.prepare(snapshotLookup.statement)
          .bind(...snapshotLookup.binds).all<unknown>();
        const validated = validateSpreadsheetMemberSnapshotFkReleaseLookupReceipt(
          ctx, foreignKeys, prepared, receipt,
        );
        plan = buildSpreadsheetGuardedCrudPlanFromSnapshot(ctx, prepared, validated.before, user.id);
        eventIdsByVideo = validated.eventIdsByVideo;
      } else {
        // Unsupported schema/FK shapes retain the original fresh snapshot,
        // FK-first preflight and release lookup. No validation is skipped.
        plan = await planSpreadsheetGuardedCrud(
          countedDb, ctx, crudBody, [], user.id, SPREADSHEET_FK_PREFLIGHT_MAX_QUERIES,
        );
        const fkRow = spreadsheetMemberForeignKeyRowFromAudit(plan.audit, foreignKeys);
        const combined = buildSpreadsheetMemberFkReleaseLookup(foreignKeys, [fkRow], [plan.audit]);
        if (combined) {
          const receipt = await countedDb.prepare(combined.statement).bind(...combined.binds).all<unknown>();
          eventIdsByVideo = validateSpreadsheetMemberFkReleaseLookupReceipt(combined, receipt).eventIdsByVideo;
        } else {
          await validateSpreadsheetForeignKeys(
            countedDb, foreignKeys, [fkRow], SPREADSHEET_FK_PREFLIGHT_MAX_QUERIES,
          );
          const loaded = await loadSpreadsheetVideoReleaseEvents(rawDb, [plan.audit]);
          eventIdsByVideo = loaded.eventIdsByVideo;
          videoReads = loaded.reads;
        }
      }
    } else {
      plan = await planSpreadsheetGuardedCrud(
        countedDb,
        ctx,
        crudBody,
        memberMutation ? [] : foreignKeys,
        user.id,
        SPREADSHEET_FK_PREFLIGHT_MAX_QUERIES,
      );
      if (memberMutation) {
        // POST/import keep the existing bounded multi-FK/release CTE. PATCH
        // and DELETE use the snapshot-inclusive CTE above when eligible.
        const fkRow = spreadsheetMemberForeignKeyRowFromAudit(plan.audit, foreignKeys);
        const combined = buildSpreadsheetMemberFkReleaseLookup(foreignKeys, [fkRow], [plan.audit]);
        if (combined) {
          const receipt = await countedDb.prepare(combined.statement).bind(...combined.binds).all<unknown>();
          eventIdsByVideo = validateSpreadsheetMemberFkReleaseLookupReceipt(combined, receipt).eventIdsByVideo;
        } else {
          await validateSpreadsheetForeignKeys(
            countedDb, foreignKeys, [fkRow], SPREADSHEET_FK_PREFLIGHT_MAX_QUERIES,
          );
          const loaded = await loadSpreadsheetVideoReleaseEvents(rawDb, [plan.audit]);
          eventIdsByVideo = loaded.eventIdsByVideo;
          videoReads = loaded.reads;
        }
      } else {
        const loaded = await loadSpreadsheetVideoReleaseEvents(rawDb, [plan.audit]);
        eventIdsByVideo = loaded.eventIdsByVideo;
        videoReads = loaded.reads;
      }
    }

    const queueTargets = deriveSpreadsheetQueueTargets([plan.audit], eventIdsByVideo);
    const callerQueryCount = 3 + readCounter.reads + videoReads;

    const atomic = await buildCrudAtomicBatch(db, ctx, plan, {
      authorizedActorId: user.id,
      callerQueryCount,
      queueTargets,
      preloaded,
    });
    await mutateWithAudit(db, atomic, NOOP_WAKE_HOST);

    const response = AdminSpreadsheetMutationResponseSchema.parse({
      ok: true,
      pendingPublicReflection: queueTargets.length > 0,
    });
    return c.json(response, 200, PRIVATE_HEADERS);
  } catch (error) {
    return spreadsheetWriteFailure(c, error);
  }
}

export function createSpreadsheetWriteRoutes(
  options: { session?: MiddlewareHandler<AppEnv> } = {},
): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();
  applySpreadsheetWriteMiddleware(routes, "/data", options.session);

  // RH-004 PATCH /api/admin/spreadsheet/data
  routes.patch("/data", (c) => handleCrudWrite(c, "PATCH"));
  // RH-005 POST /api/admin/spreadsheet/data
  routes.post("/data", (c) => handleCrudWrite(c, "POST"));
  // RH-006 DELETE /api/admin/spreadsheet/data
  routes.delete("/data", (c) => handleCrudWrite(c, "DELETE"));

  return routes;
}
