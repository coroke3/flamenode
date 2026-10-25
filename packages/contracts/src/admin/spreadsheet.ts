import { z } from "zod";

// MIG-0605 U02: admin spreadsheet READ DTOs (RH-003 GET, RH-007 GET, RH-009 GET).
// CURRENT: app/api/admin/spreadsheet/{data,export,tables}/route.ts + src/lib/admin/spreadsheet/apiTypes.ts.
// `truncated` is the only field not in CURRENT: S2 caps a page at 64 KiB, so rows that do not fit are dropped
// and the flag tells the client the page is partial (hasMore is then true as well).

export const AdminSpreadsheetColumnMetaSchema = z.object({
  name: z.string(),
  type: z.string(),
  notNull: z.boolean(),
  pk: z.number(),
  editable: z.boolean(),
  defaultValue: z.string().nullable().optional(),
  generated: z.boolean().optional(),
  enumValues: z.array(z.string()).optional(),
});

export const AdminSpreadsheetTableDefSchema = z.object({
  table: z.string(),
  label: z.string(),
  group: z.string(),
  mode: z.enum(["editable", "readonly"]),
  inSchema: z.boolean().optional(),
});

export const AdminSpreadsheetPageResponseSchema = z.object({
  def: AdminSpreadsheetTableDefSchema,
  columns: z.array(AdminSpreadsheetColumnMetaSchema),
  primaryKeys: z.array(z.string()),
  rows: z.array(z.record(z.unknown())),
  hasMore: z.boolean(),
  page: z.number(),
  limit: z.number(),
  truncated: z.literal(true).optional(),
});

export const AdminSpreadsheetTablesResponseSchema = z.object({
  tables: z.array(AdminSpreadsheetTableDefSchema),
  groups: z.record(z.array(AdminSpreadsheetTableDefSchema)),
  pageSize: z.number(),
  discoveredAt: z.string(),
  notInSchema: z.array(z.string()).optional(),
  inSchemaNotInDb: z.array(z.string()).optional(),
});

export const AdminSpreadsheetErrorSchema = z.object({ error: z.string() });

export type AdminSpreadsheetColumnMeta = z.infer<typeof AdminSpreadsheetColumnMetaSchema>;
export type AdminSpreadsheetTableDef = z.infer<typeof AdminSpreadsheetTableDefSchema>;
export type AdminSpreadsheetPageResponse = z.infer<typeof AdminSpreadsheetPageResponseSchema>;
export type AdminSpreadsheetTablesResponse = z.infer<typeof AdminSpreadsheetTablesResponseSchema>;
export type AdminSpreadsheetError = z.infer<typeof AdminSpreadsheetErrorSchema>;
