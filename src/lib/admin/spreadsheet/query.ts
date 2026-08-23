import "server-only";
import { and, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { getDatabase } from "@/lib/cloudflare";
import { mutateWithAudit } from "@/lib/audit/mutate";
import { spreadsheetImportRuns, videoEvents, videos } from "@/lib/db/schema";
import { buildStaticRebuildQueueBatch } from "@/lib/staticRebuild/enqueue";
import type { SpreadsheetImportPreviewClaims } from "./importPreviewToken";
import type { SpreadsheetTableDef } from "./registry";
import {
  isSpreadsheetColumnEditable,
  isSpreadsheetSecretColumn,
  getSpreadsheetColumnPolicy,
  SPREADSHEET_DEFAULT_MAX_CELL_CHARS,
  isSpreadsheetPhysicalDeleteBlocked,
} from "./registry";
import { validateSpreadsheetDisabledFeaturesJson } from "./disabledFeaturesCore";
export { validateSpreadsheetDisabledFeaturesJson } from "./disabledFeaturesCore";
import {
  isSpreadsheetImportBatchSizeAllowed,
  SPREADSHEET_IMPORT_MAX_STATIC_REBUILD_QUEUE_STATEMENTS,
  SPREADSHEET_IMPORT_MAX_ROWS,
} from "./constants";
import {
  clampSpreadsheetPageLimit,
  normalizeSpreadsheetPage,
} from "./settings";

export { SPREADSHEET_IMPORT_MAX_ROWS } from "./constants";
export { SPREADSHEET_IMPORT_MAX_BATCH_ROWS } from "./constants";
import {
  assertColumnEditable,
  assertTableEditable,
  enrichSpreadsheetColumns,
  resolveSpreadsheetTableContext,
  quoteIdent,
  type SpreadsheetColumnMeta,
  type SpreadsheetTableContext,
} from "./tableContext";
import { getSpreadsheetD1 } from "./d1Access";
import {
  normalizePrimaryKeyRecord,
  primaryKeyFingerprint,
  primaryKeyFromRowValues,
  resolveSpreadsheetDefaultValue,
} from "./validation";
import {
  planSpreadsheetStaticRebuildTargets,
  SPREADSHEET_STATIC_REBUILD_SPLIT_REQUIRED,
} from "./staticRebuildPlan";

export type { SpreadsheetColumnMeta } from "./tableContext";
export const SPREADSHEET_EXPORT_MAX_ROWS = 5000;

const SPREADSHEET_IMPORT_EXISTING_LOOKUP_CHUNK_SIZE = 40;

export interface SpreadsheetPageResult {
  def: SpreadsheetTableDef;
  columns: SpreadsheetColumnMeta[];
  primaryKeys: string[];
  rows: Record<string, unknown>[];
  total: number;
  page: number;
  limit: number;
}

function maskValue(column: string, value: unknown): unknown {
  if (value == null) return value;
  if (!isSpreadsheetSecretColumn(column)) return value;
  const s = String(value);
  if (s.length <= 8) return "••••••••";
  return `${s.slice(0, 4)}…${s.slice(-4)}`;
}

function serializeRow(
  row: Record<string, unknown>,
  columns: SpreadsheetColumnMeta[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const col of columns) {
    out[col.name] = maskValue(col.name, row[col.name]);
  }
  return out;
}

function buildPkWhere(
  primaryKeys: string[],
  pk: Record<string, string>,
): { clause: string; binds: string[] } {
  if (primaryKeys.length === 0) {
    throw new Error("missing_primary_key");
  }
  const parts: string[] = [];
  const binds: string[] = [];
  for (const key of primaryKeys) {
    const v = pk[key];
    if (v === undefined || String(v).trim() === "") {
      throw new Error("missing_primary_key");
    }
    parts.push(`${quoteIdent(key)} = ?`);
    binds.push(String(v));
  }
  return { clause: parts.join(" AND "), binds };
}

async function fetchRowByPkRaw(
  ctx: SpreadsheetTableContext,
  pk: Record<string, string>,
): Promise<Record<string, unknown> | null> {
  const { clause, binds } = buildPkWhere(ctx.primaryKeys, pk);
  const stmt = `SELECT * FROM ${ctx.quotedTable} WHERE ${clause} LIMIT 1`;
  const db = await getSpreadsheetD1();
  return db
    .prepare(stmt)
    .bind(...binds)
    .first<Record<string, unknown>>();
}

function primaryKeyFromRawRow(
  row: Record<string, unknown>,
  primaryKeys: string[],
): Record<string, string> | null {
  const pk: Record<string, string> = {};
  for (const key of primaryKeys) {
    const value = row[key];
    if (value == null || String(value).trim() === "") return null;
    pk[key] = String(value);
  }
  return pk;
}

async function fetchExistingRowsByImportPk(
  ctx: SpreadsheetTableContext,
  rows: Record<string, string | null>[],
): Promise<Map<string, Record<string, unknown>>> {
  const out = new Map<string, Record<string, unknown>>();
  if (ctx.primaryKeys.length === 0 || rows.length === 0) return out;

  const pks: Record<string, string>[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    try {
      const pk = primaryKeyFromRowValues(row, ctx.primaryKeys);
      const fingerprint = primaryKeyFingerprint(pk);
      if (seen.has(fingerprint)) continue;
      seen.add(fingerprint);
      pks.push(pk);
    } catch {
      // Per-row import error handling below preserves the existing behavior.
    }
  }
  if (pks.length === 0) return out;

  const db = await getSpreadsheetD1();
  for (let i = 0; i < pks.length; i += SPREADSHEET_IMPORT_EXISTING_LOOKUP_CHUNK_SIZE) {
    const chunk = pks.slice(i, i + SPREADSHEET_IMPORT_EXISTING_LOOKUP_CHUNK_SIZE);
    const binds: string[] = [];
    const where = chunk
      .map((pk) => {
        const parts: string[] = [];
        for (const key of ctx.primaryKeys) {
          parts.push(`${quoteIdent(key)} = ?`);
          binds.push(pk[key]!);
        }
        return `(${parts.join(" AND ")})`;
      })
      .join(" OR ");
    const data = await db
      .prepare(`SELECT * FROM ${ctx.quotedTable} WHERE ${where}`)
      .bind(...binds)
      .all<Record<string, unknown>>();
    for (const raw of data.results ?? []) {
      const pk = primaryKeyFromRawRow(raw, ctx.primaryKeys);
      if (!pk) continue;
      out.set(primaryKeyFingerprint(pk), raw);
    }
  }

  return out;
}

async function queryTableRows(
  ctx: SpreadsheetTableContext,
  limit: number,
  offset?: number,
): Promise<{ total: number; rawRows: Record<string, unknown>[] }> {
  const db = await getSpreadsheetD1();
  const countStmt = db.prepare(
    `SELECT COUNT(*) AS c FROM ${ctx.quotedTable}`,
  );
  const dataStmt =
    offset != null
      ? db.prepare(
          `SELECT * FROM ${ctx.quotedTable} ORDER BY ${ctx.orderColumn} LIMIT ? OFFSET ?`,
        )
      : db.prepare(
          `SELECT * FROM ${ctx.quotedTable} ORDER BY ${ctx.orderColumn} LIMIT ?`,
        );

  const [countRow, data] = await Promise.all([
    countStmt.first<{ c: number }>(),
    offset != null
      ? dataStmt.bind(limit, offset).all<Record<string, unknown>>()
      : dataStmt.bind(limit).all<Record<string, unknown>>(),
  ]);

  return {
    total: Number(countRow?.c ?? 0),
    rawRows: data.results ?? [],
  };
}

function recordIdFromPk(pk: Record<string, string>): string {
  return Object.entries(pk)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, v]) => v)
    .join(":");
}

type SpreadsheetMutation = {
  statement: BatchItem<"sqlite">;
  audit: {
    table_name: string;
    target_id: string;
    operation: "CREATE" | "UPDATE" | "DELETE";
    before: Record<string, unknown> | null;
    after: Record<string, unknown> | null;
    actor_user_id: string;
    retention_class: "long_audit";
    strict: true;
    context: "admin_spreadsheet";
  };
};

function spreadsheetDb() {
  const db = getDatabase();
  if (!db) throw new Error("db_unavailable");
  return db;
}

const SPREADSHEET_VIDEO_EVENT_LOOKUP_CHUNK_SIZE = 80;

async function loadSpreadsheetVideoReleaseEvents(
  mutations: readonly SpreadsheetMutation[],
): Promise<Map<string, string[]>> {
  const videoIds = [
    ...new Set(
      mutations
        .filter((mutation) => mutation.audit.table_name === "video_members")
        .flatMap((mutation) =>
          [mutation.audit.before?.video_id, mutation.audit.after?.video_id]
            .map((value) => (value == null ? null : String(value).trim()))
            .filter((value): value is string => Boolean(value)),
        ),
    ),
  ];
  const eventIdsByVideo = new Map<string, Set<string>>();
  if (videoIds.length === 0) return new Map();

  const db = spreadsheetDb();
  for (
    let offset = 0;
    offset < videoIds.length;
    offset += SPREADSHEET_VIDEO_EVENT_LOOKUP_CHUNK_SIZE
  ) {
    const chunk = videoIds.slice(
      offset,
      offset + SPREADSHEET_VIDEO_EVENT_LOOKUP_CHUNK_SIZE,
    );
    const rows = await db
      .select({
        videoId: videos.id,
        eventId: videoEvents.event_id,
        primaryEventId: videos.primary_event_id,
      })
      .from(videos)
      .leftJoin(videoEvents, eq(videoEvents.video_id, videos.id))
      .where(inArray(videos.id, chunk));
    for (const row of rows) {
      const videoId = String(row.videoId ?? "").trim();
      if (!videoId) continue;
      const eventIds = eventIdsByVideo.get(videoId) ?? new Set<string>();
      for (const eventId of [row.eventId, row.primaryEventId]) {
        const normalized = String(eventId ?? "").trim();
        if (normalized) eventIds.add(normalized);
      }
      eventIdsByVideo.set(videoId, eventIds);
    }
  }
  return new Map(
    [...eventIdsByVideo].map(([videoId, eventIds]) => [videoId, [...eventIds]]),
  );
}

async function validateSpreadsheetForeignKeys(
  ctx: SpreadsheetTableContext,
  rows: readonly Record<string, string | null>[],
): Promise<void> {
  const db = await getSpreadsheetD1();
  for (const foreignKey of ctx.foreignKeys) {
    const values = [
      ...new Set(
        rows
          .map((row) => row[foreignKey.column])
          .filter((value): value is string => value != null && value !== ""),
      ),
    ];
    if (values.length === 0) continue;
    for (let offset = 0; offset < values.length; offset += 99) {
      const chunk = values.slice(offset, offset + 99);
      const placeholders = chunk.map(() => "?").join(", ");
      const result = await db
        .prepare(
          `SELECT ${quoteIdent(foreignKey.referencedColumn)} AS value FROM ${quoteIdent(foreignKey.referencedTable)} WHERE ${quoteIdent(foreignKey.referencedColumn)} IN (${placeholders})`,
        )
        .bind(...chunk)
        .all<{ value: string }>();
      const found = new Set((result.results ?? []).map((row) => String(row.value)));
      if (chunk.some((value) => !found.has(String(value)))) {
        throw new Error("foreign_key_violation");
      }
    }
  }
}

function validateSpreadsheetInputValues(
  ctx: SpreadsheetTableContext,
  row: Record<string, string | null>,
): void {
  for (const key of Object.keys(row)) {
    if (!ctx.columnNames.includes(key)) throw new Error("unknown_column");
    if (!isSpreadsheetColumnEditable(ctx.def, key)) {
      throw new Error("column_not_editable");
    }
    const value = row[key];
    const meta = ctx.columns.find((column) => column.name === key)!;
    if (value == null && meta.notNull) throw new Error("not_null_violation");
    const policy = getSpreadsheetColumnPolicy(ctx.def.table, key, meta.enumValues);
    if (value != null && String(value).length > (policy?.maxLength ?? SPREADSHEET_DEFAULT_MAX_CELL_CHARS)) {
      throw new Error("value_too_long");
    }
    if (policy?.enum && value != null && !policy.enum.includes(String(value))) {
      throw new Error("invalid_enum");
    }
    if (policy?.json && value != null) {
      try { JSON.parse(String(value)); } catch { throw new Error("invalid_json_value"); }
    }
    if (
      ctx.def.table === "system_settings" &&
      key === "disabled_features_json" &&
      value != null
    ) {
      validateSpreadsheetDisabledFeaturesJson(String(value));
    }
    if (policy?.url && value != null) {
      try {
        const url = new URL(String(value));
        if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error();
      } catch { throw new Error("invalid_url"); }
    }
    if (value != null && meta.type.toUpperCase().includes("INT") && !/^-?\d+$/.test(String(value))) {
      throw new Error("invalid_integer");
    }
    if (value != null && /REAL|FLOA|DOUB|NUMERIC|DECIMAL/i.test(meta.type) && !/^-?\d+(?:\.\d+)?$/.test(String(value))) {
      throw new Error("invalid_number");
    }
  }
}

function snapshotCondition(
  ctx: SpreadsheetTableContext,
  row: Record<string, unknown>,
): ReturnType<typeof sql> {
  return sql.join(
    ctx.columns.map((column) =>
      sql`${sql.raw(quoteIdent(column.name))} IS ${row[column.name] ?? null}`,
    ),
    sql` AND `,
  );
}

function primaryKeyCondition(
  ctx: SpreadsheetTableContext,
  pk: Record<string, string>,
): ReturnType<typeof sql> {
  return sql.join(
    ctx.primaryKeys.map((key) =>
      sql`${sql.raw(quoteIdent(key))} = ${pk[key]}`,
    ),
    sql` AND `,
  );
}

function prepareCompleteInsertRow(
  ctx: SpreadsheetTableContext,
  rowInput: Record<string, string | null>,
): Record<string, string | number | null> {
  const row = rowInput;
  validateSpreadsheetInputValues(ctx, row);
  const complete: Record<string, string | number | null> = {};
  for (const column of ctx.columns) {
    if (column.generated) continue;
    if (row[column.name] !== undefined) {
      if (row[column.name] == null && column.notNull) throw new Error("not_null_violation");
      complete[column.name] = row[column.name] === "" ? null : row[column.name]!;
    } else if (column.defaultValue != null) {
      complete[column.name] = resolveSpreadsheetDefaultValue(column);
    } else if (column.notNull) {
      throw new Error("missing_required_column");
    } else {
      complete[column.name] = null;
    }
  }
  return complete;
}

function buildInsertMutation(
  ctx: SpreadsheetTableContext,
  rowInput: Record<string, string | null>,
  operatorId: string,
): SpreadsheetMutation {
  const row = prepareCompleteInsertRow(ctx, rowInput);
  const pk = normalizePrimaryKeyRecord(
    ctx.primaryKeys,
    Object.fromEntries(
      ctx.primaryKeys.map((key) => [key, String(row[key] ?? "")]),
    ),
  );
  const keys = Object.keys(row);
  if (keys.length === 0) throw new Error("empty_row");
  const db = spreadsheetDb();
  const values = keys.map((key) => row[key]);
  return {
    statement: db.run(sql`
      INSERT INTO ${sql.raw(ctx.quotedTable)} (${sql.raw(keys.map(quoteIdent).join(", "))})
      VALUES (${sql.join(values.map((value) => sql`${value}`), sql`, `)})
    `),
    audit: {
      table_name: ctx.def.table,
      target_id: recordIdFromPk(pk),
      operation: "CREATE",
      before: null,
      after: row,
      actor_user_id: operatorId,
      retention_class: "long_audit",
      strict: true,
      context: "admin_spreadsheet",
    },
  };
}

function buildUpdateMutation(
  ctx: SpreadsheetTableContext,
  pk: Record<string, string>,
  before: Record<string, unknown>,
  values: Record<string, string | null>,
  operatorId: string,
): SpreadsheetMutation {
  validateSpreadsheetInputValues(ctx, values);
  const setCols = ctx.columns.filter(
    (column) =>
      column.pk === 0 &&
      isSpreadsheetColumnEditable(ctx.def, column.name) &&
      values[column.name] !== undefined,
  );
  if (setCols.length === 0) throw new Error("empty_row");
  const pkWhere = primaryKeyCondition(ctx, pk);
  const optimistic = snapshotCondition(ctx, before);
  const after = { ...before };
  for (const column of setCols) {
    after[column.name] = values[column.name] === "" ? null : values[column.name];
  }
  const db = spreadsheetDb();
  return {
    statement: db.run(sql`
      UPDATE ${sql.raw(ctx.quotedTable)}
      SET ${sql.join(
        setCols.map((column) =>
          sql`${sql.raw(quoteIdent(column.name))} = ${values[column.name] === "" ? null : values[column.name]}`,
        ),
        sql`, `,
      )}
      WHERE ${pkWhere} AND ${optimistic}
    `),
    audit: {
      table_name: ctx.def.table,
      target_id: recordIdFromPk(pk),
      operation: "UPDATE",
      before,
      after,
      actor_user_id: operatorId,
      retention_class: "long_audit",
      strict: true,
      context: "admin_spreadsheet",
    },
  };
}

function buildDeleteMutation(
  ctx: SpreadsheetTableContext,
  pk: Record<string, string>,
  before: Record<string, unknown>,
  operatorId: string,
): SpreadsheetMutation {
  const pkWhere = primaryKeyCondition(ctx, pk);
  const optimistic = snapshotCondition(ctx, before);
  const db = spreadsheetDb();
  return {
    statement: db.run(sql`
      DELETE FROM ${sql.raw(ctx.quotedTable)}
      WHERE ${pkWhere} AND ${optimistic}
    `),
    audit: {
      table_name: ctx.def.table,
      target_id: recordIdFromPk(pk),
      operation: "DELETE",
      before,
      after: null,
      actor_user_id: operatorId,
      retention_class: "long_audit",
      strict: true,
      context: "admin_spreadsheet",
    },
  };
}

async function executeSpreadsheetMutations(
  mutations: SpreadsheetMutation[],
  previewRun?: SpreadsheetImportPreviewClaims,
): Promise<boolean> {
  const allMutations = previewRun
    ? [buildPreviewRunConsumptionMutation(previewRun), ...mutations]
    : mutations;
  if (allMutations.length === 0) return false;
  const db = spreadsheetDb();
  const videoReleaseEvents = await loadSpreadsheetVideoReleaseEvents(mutations);
  const staticRebuildTargets = planSpreadsheetStaticRebuildTargets(
    mutations.map((mutation) => ({
      table: mutation.audit.table_name,
      operation: mutation.audit.operation,
      before: mutation.audit.before,
      after: mutation.audit.after,
      actorUserId: mutation.audit.actor_user_id,
      eventReleaseEventIds:
        mutation.audit.table_name === "video_members"
          ? [
              ...new Set(
                [mutation.audit.before?.video_id, mutation.audit.after?.video_id]
                  .map((value) => (value == null ? null : String(value).trim()))
                  .filter((value): value is string => Boolean(value))
                  .flatMap((videoId) => videoReleaseEvents.get(videoId) ?? []),
              ),
            ]
          : undefined,
    })),
  );
  const queue = await buildStaticRebuildQueueBatch(db, staticRebuildTargets);
  if (
    queue.statements.length >
    SPREADSHEET_IMPORT_MAX_STATIC_REBUILD_QUEUE_STATEMENTS
  ) {
    throw new Error(SPREADSHEET_STATIC_REBUILD_SPLIT_REQUIRED);
  }
  await mutateWithAudit(db, {
    mutationStatements: [
      ...allMutations.map((mutation) => mutation.statement),
      ...queue.statements,
    ],
    expectedMutationChanges: [
      ...allMutations.map(() => 1),
      ...queue.expectedChanges,
    ],
    audits: allMutations.map((mutation) => mutation.audit),
    staticRebuildWakeSource: queue.statements.length > 0 ? "admin" : undefined,
  });
  return queue.statements.length > 0;
}

function buildPreviewRunConsumptionMutation(
  claims: SpreadsheetImportPreviewClaims,
): SpreadsheetMutation {
  const consumedAt = Math.floor(Date.now() / 1000);
  const before = {
    nonce: claims.nonce,
    operator_user_id: claims.operatorUserId,
    table_name: claims.table,
    mode: claims.mode,
    payload_hash: claims.payloadHash,
    schema_fingerprint: claims.schemaFingerprint,
    expires_at: claims.expiresAt,
    consumed_at: null,
    created_at: claims.issuedAt,
  };
  const after = { ...before, consumed_at: consumedAt };
  const db = spreadsheetDb();
  return {
    statement: db
      .update(spreadsheetImportRuns)
      .set({ consumed_at: consumedAt })
      .where(and(
        eq(spreadsheetImportRuns.nonce, claims.nonce),
        eq(spreadsheetImportRuns.operator_user_id, claims.operatorUserId),
        eq(spreadsheetImportRuns.table_name, claims.table),
        eq(spreadsheetImportRuns.mode, claims.mode),
        eq(spreadsheetImportRuns.payload_hash, claims.payloadHash),
        eq(spreadsheetImportRuns.schema_fingerprint, claims.schemaFingerprint),
        eq(spreadsheetImportRuns.expires_at, claims.expiresAt),
        eq(spreadsheetImportRuns.created_at, claims.issuedAt),
        isNull(spreadsheetImportRuns.consumed_at),
        gte(spreadsheetImportRuns.expires_at, consumedAt),
      )!),
    audit: {
      table_name: "spreadsheet_import_runs",
      target_id: claims.nonce,
      operation: "UPDATE",
      before,
      after,
      actor_user_id: claims.operatorUserId,
      retention_class: "long_audit",
      strict: true,
      context: "admin_spreadsheet",
    },
  };
}

export async function fetchSpreadsheetPage(opts: {
  table: string;
  page: number;
  limit: number;
}): Promise<SpreadsheetPageResult> {
  const ctx = await resolveSpreadsheetTableContext(opts.table);
  const limit = clampSpreadsheetPageLimit(opts.limit);
  let page = normalizeSpreadsheetPage(opts.page);

  let { total, rawRows } = await queryTableRows(
    ctx,
    limit,
    (page - 1) * limit,
  );
  const maxPage = Math.max(1, Math.ceil(total / Math.max(1, limit)));
  if (page > maxPage) {
    page = maxPage;
    ({ total, rawRows } = await queryTableRows(
      ctx,
      limit,
      (page - 1) * limit,
    ));
  }

  const columns = enrichSpreadsheetColumns(ctx.def, ctx.columns);

  return {
    def: ctx.def,
    columns,
    primaryKeys: ctx.primaryKeys,
    rows: rawRows.map((r) => serializeRow(r, columns)),
    total,
    page,
    limit,
  };
}

export type SpreadsheetMutationOutcome = {
  pendingPublicReflection: boolean;
};

export async function updateSpreadsheetCell(opts: {
  table: string;
  primaryKey: Record<string, string>;
  column: string;
  value: string | null;
  operatorId: string;
}): Promise<SpreadsheetMutationOutcome> {
  const ctx = await resolveSpreadsheetTableContext(opts.table);
  assertTableEditable(ctx);
  assertColumnEditable(ctx, opts.column);
  const primaryKey = normalizePrimaryKeyRecord(
    ctx.primaryKeys,
    opts.primaryKey,
  );
  validateSpreadsheetInputValues(ctx, primaryKey);

  const beforeRaw = await fetchRowByPkRaw(ctx, primaryKey);
  if (!beforeRaw) throw new Error("row_not_found");
  await validateSpreadsheetForeignKeys(ctx, [{ [opts.column]: opts.value }]);

  const pendingPublicReflection = await executeSpreadsheetMutations([
    buildUpdateMutation(
      ctx,
      primaryKey,
      beforeRaw,
      { [opts.column]: opts.value },
      opts.operatorId,
    ),
  ]);
  return { pendingPublicReflection };
}

async function insertSpreadsheetRowWithContext(
  ctx: SpreadsheetTableContext,
  opts: {
    row: Record<string, string | null>;
    operatorId: string;
  },
): Promise<SpreadsheetMutationOutcome> {
  assertTableEditable(ctx);
  for (const column of Object.keys(opts.row)) {
    // INSERT も UPDATE / import と同じ列ポリシーを通す。ここを省くと
    // secret・CostGuard・visibility_status を単発 API から直接書けてしまう。
    assertColumnEditable(ctx, column);
  }
  await validateSpreadsheetForeignKeys(ctx, [opts.row]);
  const pendingPublicReflection = await executeSpreadsheetMutations([
    buildInsertMutation(ctx, opts.row, opts.operatorId),
  ]);
  return { pendingPublicReflection };
}

export async function insertSpreadsheetRow(opts: {
  table: string;
  row: Record<string, string | null>;
  operatorId: string;
}): Promise<SpreadsheetMutationOutcome> {
  const ctx = await resolveSpreadsheetTableContext(opts.table);
  return insertSpreadsheetRowWithContext(ctx, {
    row: opts.row,
    operatorId: opts.operatorId,
  });
}

export async function deleteSpreadsheetRow(opts: {
  table: string;
  primaryKey: Record<string, string>;
  operatorId: string;
}): Promise<SpreadsheetMutationOutcome> {
  const ctx = await resolveSpreadsheetTableContext(opts.table);
  assertTableEditable(ctx);
  if (isSpreadsheetPhysicalDeleteBlocked(ctx.def.table)) {
    throw new Error("physical_delete_requires_visibility_status");
  }
  const primaryKey = normalizePrimaryKeyRecord(
    ctx.primaryKeys,
    opts.primaryKey,
  );
  validateSpreadsheetInputValues(ctx, primaryKey);

  const beforeRaw = await fetchRowByPkRaw(ctx, primaryKey);
  if (!beforeRaw) throw new Error("row_not_found");

  const pendingPublicReflection = await executeSpreadsheetMutations([
    buildDeleteMutation(ctx, primaryKey, beforeRaw, opts.operatorId),
  ]);
  return { pendingPublicReflection };
}

export interface SpreadsheetExportResult {
  def: SpreadsheetTableDef;
  columns: SpreadsheetColumnMeta[];
  primaryKeys: string[];
  rows: Record<string, unknown>[];
  truncated: boolean;
}

export async function fetchSpreadsheetExport(
  table: string,
  maxRows = SPREADSHEET_EXPORT_MAX_ROWS,
): Promise<SpreadsheetExportResult> {
  const ctx = await resolveSpreadsheetTableContext(table);
  const limit = Math.min(Math.max(1, maxRows), SPREADSHEET_EXPORT_MAX_ROWS);
  const { total, rawRows } = await queryTableRows(ctx, limit);

  const columns = enrichSpreadsheetColumns(ctx.def, ctx.columns);

  return {
    def: ctx.def,
    columns,
    primaryKeys: ctx.primaryKeys,
    rows: rawRows.map((r) => serializeRow(r, columns)),
    truncated: total > limit,
  };
}

export type SpreadsheetImportMode = "insert" | "upsert";

export interface SpreadsheetImportResult {
  inserted: number;
  updated: number;
  skipped: number;
  errors: Array<{ index: number; message: string }>;
  pendingPublicReflection?: boolean;
}

async function planUpsertSpreadsheetRow(
  ctx: SpreadsheetTableContext,
  opts: {
    row: Record<string, string | null>;
    operatorId: string;
    existingRow?: Record<string, unknown> | null;
    existingRowKnown?: boolean;
  },
): Promise<{ kind: "inserted" | "updated" | "skipped"; mutation?: SpreadsheetMutation }> {
  const pk = primaryKeyFromRowValues(opts.row, ctx.primaryKeys);

  const existing = opts.existingRowKnown
    ? (opts.existingRow ?? null)
    : await fetchRowByPkRaw(ctx, pk);

  if (existing) {
    const setCols = ctx.columns.filter(
      (c) =>
        c.pk === 0 &&
        isSpreadsheetColumnEditable(ctx.def, c.name) &&
        opts.row[c.name] !== undefined,
    );
    if (setCols.length === 0) return { kind: "skipped" };
    return {
      kind: "updated",
      mutation: buildUpdateMutation(ctx, pk, existing, opts.row, opts.operatorId),
    };
  }
  return {
    kind: "inserted",
    mutation: buildInsertMutation(ctx, opts.row, opts.operatorId),
  };
}

export async function applySpreadsheetImport(
  opts: {
    table: string;
    mode: SpreadsheetImportMode;
    rows: Record<string, string | null>[];
    operatorId: string;
    previewRun: SpreadsheetImportPreviewClaims;
  },
  existingCtx?: SpreadsheetTableContext,
): Promise<SpreadsheetImportResult> {
  const ctx = existingCtx ?? (await resolveSpreadsheetTableContext(opts.table));
  assertTableEditable(ctx);

  if (
    opts.previewRun.operatorUserId !== opts.operatorId ||
    opts.previewRun.table !== ctx.def.table ||
    opts.previewRun.mode !== opts.mode ||
    JSON.stringify(opts.previewRun.columns) !== JSON.stringify(ctx.columnNames) ||
    JSON.stringify(opts.previewRun.primaryKeys) !== JSON.stringify(ctx.primaryKeys)
  ) {
    throw new Error("preview_required");
  }

  if (opts.rows.length > SPREADSHEET_IMPORT_MAX_ROWS) {
    throw new Error("too_many_rows");
  }
  if (!isSpreadsheetImportBatchSizeAllowed(opts.rows.length)) {
    throw new Error("batch_too_large");
  }

  const errors: Array<{ index: number; message: string }> = [];
  const seenPks = new Set<string>();
  const preparedRows: Array<{ row: Record<string, string | null>; pk: Record<string, string>; fingerprint: string }> = [];
  for (let index = 0; index < opts.rows.length; index++) {
    const row = opts.rows[index]!;
    try {
      for (const key of Object.keys(row)) {
        if (!ctx.columnNames.includes(key)) throw new Error("unknown_column");
        if (!isSpreadsheetColumnEditable(ctx.def, key)) {
          throw new Error("column_not_editable");
        }
      }
      const pk = primaryKeyFromRowValues(row, ctx.primaryKeys);
      const fingerprint = primaryKeyFingerprint(pk);
      if (seenPks.has(fingerprint)) throw new Error("duplicate_primary_key");
      seenPks.add(fingerprint);
      if (Object.keys(row).length === 0) throw new Error("empty_row");
      validateSpreadsheetInputValues(ctx, row);
      preparedRows.push({ row, pk, fingerprint });
    } catch (error) {
      errors.push({
        index,
        message: error instanceof Error ? error.message : "invalid_row",
      });
    }
  }
  if (errors.length > 0) return { inserted: 0, updated: 0, skipped: 0, errors };
  await validateSpreadsheetForeignKeys(ctx, preparedRows.map((prepared) => prepared.row));

  const existingRowsByPk =
    opts.mode === "upsert"
      ? await fetchExistingRowsByImportPk(ctx, opts.rows)
      : null;
  const mutations: SpreadsheetMutation[] = [];
  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  for (const prepared of preparedRows) {
    if (opts.mode === "insert") {
      mutations.push(buildInsertMutation(ctx, prepared.row, opts.operatorId));
      inserted += 1;
      continue;
    }
    const existing = existingRowsByPk?.get(prepared.fingerprint) ?? null;
    const planned = await planUpsertSpreadsheetRow(ctx, {
      row: prepared.row,
      operatorId: opts.operatorId,
      existingRow: existing,
      existingRowKnown: true,
    });
    if (planned.mutation) mutations.push(planned.mutation);
    if (planned.kind === "inserted") inserted += 1;
    else if (planned.kind === "updated") updated += 1;
    else skipped += 1;
  }
  const pendingPublicReflection = await executeSpreadsheetMutations(mutations, opts.previewRun);
  return { inserted, updated, skipped, errors: [], pendingPublicReflection };
}
