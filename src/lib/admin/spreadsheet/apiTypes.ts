/** API レスポンスとクライアントで共有するスプレッドシート型 */

export type SpreadsheetColumnMeta = {
  name: string;
  type: string;
  notNull: boolean;
  pk: number;
  editable: boolean;
};

export type SpreadsheetTableDefClient = {
  table: string;
  label: string;
  group: string;
  mode: "editable" | "readonly";
  inSchema?: boolean;
};

/** @alias クライアント向け */
export type SpreadsheetTableDef = SpreadsheetTableDefClient;

export type SpreadsheetPageData = {
  def: SpreadsheetTableDef;
  columns: SpreadsheetColumnMeta[];
  primaryKeys: string[];
  rows: Record<string, unknown>[];
  total: number;
  page: number;
  limit: number;
};

export type SpreadsheetCatalogResponse = {
  tables: SpreadsheetTableDef[];
  groups: Record<string, SpreadsheetTableDef[]>;
  pageSize?: number;
  notInSchema?: string[];
  inSchemaNotInDb?: string[];
};

export type SpreadsheetImportPreview = {
  previewToken?: string;
  rowCount: number;
  mappedColumns: string[];
  warnings: string[];
  preview: Record<string, string | null>[];
};

export type SpreadsheetImportResult = {
  inserted: number;
  updated: number;
  skipped: number;
  errors?: Array<{ index: number; message: string }>;
  warnings?: string[];
};
