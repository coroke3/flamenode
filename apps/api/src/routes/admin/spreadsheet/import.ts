/**
 * MIG-0638 U02: Hono admin spreadsheet import route (RH-008 POST /api/admin/spreadsheet/import).
 * CURRENT: app/api/admin/spreadsheet/import/route.ts + src/lib/admin/spreadsheet/{query,importPrepCore,importPreviewToken}.ts.
 *
 * Security & atomicity invariants:
 *   - Guard order: origin -> ADMIN_SPREADSHEET_ENABLED -> session -> writeGuard -> db -> CostGuard("admin_spreadsheet").
 *   - Bounded 8 MiB UTF-8 JSON body reader, max 500 preview rows / max 7 apply rows.
 *   - Dry run issues an HMAC-SHA256 preview token and inserts an unconsumed nonce row in spreadsheet_import_runs.
 *   - Apply verifies the signed preview token BEFORE any D1 read, checks existing rows & FKs within S3 bounds,
 *     and executes nonce consumption + all row mutations + strict audit + static_rebuild_queue in ONE atomic D1 batch
 *     (partial failure rolls back every row, audit entry, queue entry, and nonce consumption).
 */
import { Hono, type Context, type MiddlewareHandler } from "hono";
import {
  AdminSpreadsheetImportApplyResponseSchema,
  AdminSpreadsheetImportDryRunResponseSchema,
} from "@flamenode/contracts";
import {
  assertAtomicAuditMutationBindLimits,
  mutateWithAudit,
  planAtomicAuditMutationBudget,
  type AtomicAuditMutationInput,
} from "@flamenode/server-core/audit/mutate";
import type { ServerCoreDb } from "@flamenode/server-core/db";
import { sql } from "@flamenode/server-core/sql";
import { buildStaticRebuildQueueBatch } from "@flamenode/server-core/staticRebuild/enqueue";
import type { EnqueueStaticRebuildInput } from "@flamenode/server-core/staticRebuild/types";
import type { AppEnv } from "../../../env.ts";
import { auditPreloaded } from "../body.ts";
import { getSpreadsheetDb } from "./catalog.ts";
import { assertSpreadsheetImportColumns, prepareSpreadsheetImportRows } from "./importPrepCore.ts";
import {
  buildSpreadsheetImportPreviewBinding,
  issueSpreadsheetImportPreviewToken,
  requireSpreadsheetImportPreviewSecret,
  verifySpreadsheetImportPreviewToken,
  type SpreadsheetImportPreviewClaims,
} from "./importPreviewToken.ts";
import type { SpreadsheetDelimiterMode } from "./paste.ts";
import { isSpreadsheetColumnEditable } from "./registry.ts";
import {
  applySpreadsheetWriteMiddleware,
  countingRawDb,
  deriveSpreadsheetQueueTargets,
  buildSpreadsheetMemberFkReleaseLookup,
  validateSpreadsheetMemberFkReleaseLookupReceipt,
  spreadsheetMemberForeignKeyRowFromAudit,
  loadSpreadsheetVideoReleaseEvents,
  NOOP_WAKE_HOST,
  PRIVATE_HEADERS,
  resolveSpreadsheetWriteTableContext,
  SPREADSHEET_MAX_STATIC_REBUILD_QUEUE_STATEMENTS,
  SPREADSHEET_STATIC_REBUILD_SPLIT_REQUIRED,
  spreadsheetWriteFailure,
  type SpreadsheetWriteTableContext,
} from "./write.ts";
import { readSpreadsheetJsonBody } from "./writeBody.ts";
import {
  buildSpreadsheetPreviewNonceConsumeSql,
  fetchSpreadsheetExistingImportRows,
  planSpreadsheetAtomicAuditedImport,
  planSpreadsheetImportMutations,
  prepareSpreadsheetImportMutationRows,
  SPREADSHEET_ATOMIC_MAX_REBUILD_TARGETS,
  SPREADSHEET_FK_PREFLIGHT_MAX_QUERIES,
  SPREADSHEET_IMPORT_APPLY_MAX_ROWS,
  SPREADSHEET_IMPORT_PREVIEW_MAX_ROWS,
  spreadsheetMutationToBoundSql,
  validateSpreadsheetPlannedImportForeignKeys,
  type SpreadsheetImportMutationPlan,
} from "./writeValidation.ts";

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeInputRows(rawRows: unknown): Record<string, string | null>[] | undefined {
  if (rawRows === undefined || rawRows === null) return undefined;
  if (!Array.isArray(rawRows)) throw new Error("invalid_row");
  if (rawRows.length > SPREADSHEET_IMPORT_PREVIEW_MAX_ROWS) {
    throw new Error("too_many_rows");
  }
  return rawRows.map((row) => {
    if (!isPlainRecord(row)) throw new Error("invalid_row");
    const entries: Array<[string, string | null]> = [];
    for (const [key, cell] of Object.entries(row)) {
      if (typeof cell !== "string" && cell !== null) {
        throw new Error("invalid_row");
      }
      entries.push([key, cell]);
    }
    return Object.freeze(Object.fromEntries(entries));
  });
}

async function buildImportAtomicBatch(
  db: ServerCoreDb,
  ctx: SpreadsheetWriteTableContext,
  planned: SpreadsheetImportMutationPlan,
  claims: SpreadsheetImportPreviewClaims,
  options: {
    authorizedActorId: string;
    consumedAt: number;
    callerQueryCount: number;
    queueTargets: readonly EnqueueStaticRebuildInput[];
    preloaded: ReturnType<typeof auditPreloaded>;
  },
): Promise<AtomicAuditMutationInput> {
  if (
    (planned.mutations.length === 0 && options.queueTargets.length === 0) ||
    (planned.mutations.length > 0 &&
      options.queueTargets.length >= 1 &&
      options.queueTargets.length <= SPREADSHEET_ATOMIC_MAX_REBUILD_TARGETS)
  ) {
    return planSpreadsheetAtomicAuditedImport(db, ctx, planned, claims, options);
  }

  const nonce = buildSpreadsheetPreviewNonceConsumeSql(claims, options.consumedAt);
  const nonceStatement = db.run(sql`
    UPDATE "spreadsheet_import_runs" SET "consumed_at" = ${options.consumedAt}
    WHERE "nonce" = ${claims.nonce}
      AND "operator_user_id" = ${claims.operatorUserId}
      AND "table_name" = ${claims.table}
      AND "mode" = ${claims.mode}
      AND "payload_hash" = ${claims.payloadHash}
      AND "schema_fingerprint" = ${claims.schemaFingerprint}
      AND "expires_at" = ${claims.expiresAt}
      AND "created_at" = ${claims.issuedAt}
      AND "consumed_at" IS NULL
      AND "expires_at" >= ${options.consumedAt}
  `);
  const rowStatements = planned.mutations.map((plan) =>
    db.run(spreadsheetMutationToBoundSql(ctx, plan)),
  );
  const queue =
    options.queueTargets.length > 0
      ? await buildStaticRebuildQueueBatch(
          db,
          options.queueTargets.map((target) => ({
            ...target,
            requestedByUserId: options.authorizedActorId,
          })),
        )
      : { statements: [], expectedChanges: [], acceptedTargetCount: 0 };
  if (queue.statements.length > SPREADSHEET_MAX_STATIC_REBUILD_QUEUE_STATEMENTS) {
    throw new Error(SPREADSHEET_STATIC_REBUILD_SPLIT_REQUIRED);
  }
  const mutationStatements = [nonceStatement, ...rowStatements, ...queue.statements];
  const expectedMutationChanges = [
    1,
    ...rowStatements.map(() => 1),
    ...queue.expectedChanges,
  ];
  const input: AtomicAuditMutationInput = {
    mutationStatements,
    expectedMutationChanges,
    audits: [nonce.audit, ...planned.mutations.map((m) => ({ ...m.audit }))],
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

async function handleImportPost(c: Context<AppEnv>): Promise<Response> {
  const user = c.get("user");
  if (!user) return c.json({ ok: false, reason: "unauthenticated" }, 401, PRIVATE_HEADERS);

  try {
    const rawBody = await readSpreadsheetJsonBody<unknown>(c.req.raw);
    if (!isPlainRecord(rawBody)) {
      return c.json({ error: "invalid_json" }, 400, PRIVATE_HEADERS);
    }

    const table = typeof rawBody.table === "string" ? rawBody.table.trim() : "";
    if (!table) {
      return c.json({ error: "unknown_table" }, 400, PRIVATE_HEADERS);
    }

    const mode = rawBody.mode === "upsert" ? "upsert" : "insert";
    const hasHeader = rawBody.hasHeader !== false;
    const delimiter: SpreadsheetDelimiterMode =
      rawBody.delimiter === "csv" || rawBody.delimiter === "tsv" ? rawBody.delimiter : "auto";
    if (rawBody.text !== undefined && rawBody.text !== null && typeof rawBody.text !== "string") {
      throw new Error("invalid_row");
    }
    const text = typeof rawBody.text === "string" ? rawBody.text : undefined;
    const inputRows = normalizeInputRows(rawBody.rows);
    const dryRun = rawBody.dryRun === true;

    const rawDb = getSpreadsheetDb(c.env.DB);
    const db = c.get("db");
    const preloaded = auditPreloaded(c);

    const readCounter = { reads: 0 };
    const countedDb = countingRawDb(rawDb, readCounter);
    const { ctx, foreignKeys } = await resolveSpreadsheetWriteTableContext(countedDb, table);
    if (ctx.def.mode !== "editable") {
      return c.json({ error: "table_readonly" }, 400, PRIVATE_HEADERS);
    }

    const { rows, warnings, mappedColumns, invalidColumns } = prepareSpreadsheetImportRows({
      text,
      rows: inputRows,
      columnNames: ctx.columnNames,
      hasHeader,
      delimiter,
    });
    const importedColumns = new Set(
      mappedColumns.length > 0 ? mappedColumns : rows.flatMap((row) => Object.keys(row)),
    );
    const readonlyColumns = [...importedColumns].filter((column) => {
      const meta = ctx.columns.find((item) => item.name === column);
      return meta && !isSpreadsheetColumnEditable(ctx.def, column);
    });
    assertSpreadsheetImportColumns({
      mappedColumns: mappedColumns.length > 0 ? mappedColumns : [...importedColumns],
      invalidColumns,
      columnNames: ctx.columnNames,
      readonlyColumns,
    });

    const importWarnings = [...warnings];
    if (rows.length > SPREADSHEET_IMPORT_APPLY_MAX_ROWS) {
      importWarnings.push(
        `一括反映は ${SPREADSHEET_IMPORT_APPLY_MAX_ROWS} 行までです。500 行まではプレビューできますが、分割して反映してください。`,
      );
    }

    const secret = requireSpreadsheetImportPreviewSecret(
      (c.env as { SPREADSHEET_IMPORT_PREVIEW_SECRET?: string }).SPREADSHEET_IMPORT_PREVIEW_SECRET,
    );
    const previewBinding = await buildSpreadsheetImportPreviewBinding({
      operatorUserId: user.id,
      table: ctx.def.table,
      mode,
      columns: ctx.columnNames,
      primaryKeys: [...ctx.primaryKeys],
      schemaColumns: ctx.columns.map((col) => ({
        ...col,
        enumValues: col.enumValues ? [...col.enumValues] : undefined,
      })),
      rows,
    });

    if (dryRun) {
      const issued = await issueSpreadsheetImportPreviewToken(previewBinding, secret);
      await db.run(sql`
        INSERT INTO "spreadsheet_import_runs" (
          "nonce", "operator_user_id", "table_name", "mode",
          "payload_hash", "schema_fingerprint", "expires_at", "consumed_at", "created_at"
        ) VALUES (
          ${issued.claims.nonce},
          ${issued.claims.operatorUserId},
          ${issued.claims.table},
          ${issued.claims.mode},
          ${issued.claims.payloadHash},
          ${issued.claims.schemaFingerprint},
          ${issued.claims.expiresAt},
          ${null},
          ${issued.claims.issuedAt}
        )
      `);
      const response = AdminSpreadsheetImportDryRunResponseSchema.parse({
        ok: true,
        dryRun: true,
        previewToken: issued.token,
        applyMaxRows: SPREADSHEET_IMPORT_APPLY_MAX_ROWS,
        rowCount: rows.length,
        mappedColumns,
        warnings: importWarnings,
        preview: rows.slice(0, 20),
      });
      return c.json(response, 200, PRIVATE_HEADERS);
    }

    const previewToken = typeof rawBody.previewToken === "string" ? rawBody.previewToken : "";
    if (!previewToken) {
      return c.json({ error: "preview_required" }, 409, PRIVATE_HEADERS);
    }
    const nowSeconds = Math.floor(Date.now() / 1000);
    const claims = await verifySpreadsheetImportPreviewToken(previewToken, secret, previewBinding, {
      now: nowSeconds,
    });
    if (!claims) {
      return c.json({ error: "preview_required" }, 409, PRIVATE_HEADERS);
    }

    const prepared = prepareSpreadsheetImportMutationRows(ctx, rows);
    if (prepared.errors.length > 0) {
      const response = AdminSpreadsheetImportApplyResponseSchema.parse({
        ok: true,
        inserted: 0,
        updated: 0,
        skipped: 0,
        errors: prepared.errors,
        mappedColumns,
        warnings: importWarnings,
      });
      return c.json(response, 200, PRIVATE_HEADERS);
    }

    const upsertReads = mode === "upsert" ? 1 : 0;
    if (SPREADSHEET_FK_PREFLIGHT_MAX_QUERIES < upsertReads) {
      throw new Error("batch_too_large");
    }
    const existing =
      upsertReads > 0
        ? await fetchSpreadsheetExistingImportRows(
            countedDb,
            ctx,
            prepared,
            SPREADSHEET_FK_PREFLIGHT_MAX_QUERIES,
          )
        : null;
    const planned = planSpreadsheetImportMutations(ctx, prepared, mode, existing, user.id);
    const remainingReadBudget = SPREADSHEET_FK_PREFLIGHT_MAX_QUERIES - upsertReads;
    let eventIdsByVideo: Map<string, string[]>;
    let videoReads = 0;
    if (ctx.def.table === "video_members" && planned.mutations.length > 0) {
      // Run existing structural/identity/audit-after-image checks first.
      // Empty FK list suppresses only the separate FK SELECT; the tagged CTE
      // below performs the same FK proof together with release lookup.
      await validateSpreadsheetPlannedImportForeignKeys(
        countedDb, ctx, [], prepared, planned, remainingReadBudget,
      );
      const fkRows = prepared.preparedRows.map((entry) => entry.row);
      for (const mutation of planned.mutations) {
        if (mutation.audit.operation === "CREATE") {
          fkRows.push(spreadsheetMemberForeignKeyRowFromAudit(mutation.audit, foreignKeys));
        }
      }
      const audits = planned.mutations.map((mutation) => mutation.audit);
      const combined = buildSpreadsheetMemberFkReleaseLookup(foreignKeys, fkRows, audits);
      if (combined) {
        const receipt = await countedDb.prepare(combined.statement).bind(...combined.binds).all<unknown>();
        eventIdsByVideo = validateSpreadsheetMemberFkReleaseLookupReceipt(combined, receipt).eventIdsByVideo;
      } else {
        await validateSpreadsheetPlannedImportForeignKeys(
          countedDb, ctx, foreignKeys, prepared, planned, remainingReadBudget,
        );
        const loaded = await loadSpreadsheetVideoReleaseEvents(rawDb, audits);
        eventIdsByVideo = loaded.eventIdsByVideo;
        videoReads = loaded.reads;
      }
    } else {
      await validateSpreadsheetPlannedImportForeignKeys(
        countedDb, ctx, foreignKeys, prepared, planned, remainingReadBudget,
      );
      const loaded = planned.mutations.length > 0
        ? await loadSpreadsheetVideoReleaseEvents(rawDb, planned.mutations.map((m) => m.audit))
        : { eventIdsByVideo: new Map<string, string[]>(), reads: 0 };
      eventIdsByVideo = loaded.eventIdsByVideo;
      videoReads = loaded.reads;
    }
    const queueTargets =
      planned.mutations.length > 0
        ? deriveSpreadsheetQueueTargets(
            planned.mutations.map((m) => m.audit),
            eventIdsByVideo,
          )
        : [];
    const callerQueryCount = 3 + readCounter.reads + videoReads;

    const atomic = await buildImportAtomicBatch(db, ctx, planned, claims, {
      authorizedActorId: user.id,
      consumedAt: nowSeconds,
      callerQueryCount,
      queueTargets,
      preloaded,
    });
    await mutateWithAudit(db, atomic, NOOP_WAKE_HOST);

    const response = AdminSpreadsheetImportApplyResponseSchema.parse({
      ok: true,
      inserted: planned.inserted,
      updated: planned.updated,
      skipped: planned.skipped,
      errors: [],
      pendingPublicReflection: queueTargets.length > 0,
      mappedColumns,
      warnings: importWarnings,
    });
    return c.json(response, 200, PRIVATE_HEADERS);
  } catch (error) {
    return spreadsheetWriteFailure(c, error);
  }
}

export function createSpreadsheetImportRoutes(
  options: { session?: MiddlewareHandler<AppEnv> } = {},
): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();
  applySpreadsheetWriteMiddleware(routes, "/import", options.session);

  // RH-008 POST /api/admin/spreadsheet/import
  routes.post("/import", handleImportPost);

  return routes;
}
