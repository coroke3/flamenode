/** スプレッドシートセルの文字列化・入力正規化（クライアント・サーバー共通） */

export function formatSpreadsheetCellValue(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

export type ParseSpreadsheetCellInputOptions = {
  /** true のとき空白をトリムせず元文字列を返す（インライン編集向け） */
  preserveWhitespace?: boolean;
};

/** 貼り付け・インポート・編集で共通: 空 / NULL リテラル → null */
export function parseSpreadsheetCellInput(
  raw: string | undefined,
  opts?: ParseSpreadsheetCellInputOptions,
): string | null {
  const source = String(raw ?? "");
  const trimmed = source.trim();
  if (trimmed === "" || trimmed.toUpperCase() === "NULL") return null;
  return opts?.preserveWhitespace ? source : trimmed;
}

type ColumnRef = string | { name: string };

/** ヘッダー名をテーブル列にマッチ（大文字小文字無視） */
/** セル表示文字列にクエリが含まれるか（検索ハイライト・次へ検索） */
export function cellMatchesFind(
  value: unknown,
  query: string,
  caseSensitive: boolean,
): boolean {
  if (!query) return false;
  const text = formatSpreadsheetCellValue(value);
  if (caseSensitive) return text.includes(query);
  return text.toLowerCase().includes(query.toLowerCase());
}

export function matchSpreadsheetColumnName(
  header: string,
  columns: ColumnRef[],
): string | null {
  const h = header.trim();
  if (!h) return null;
  const lower = h.toLowerCase();
  for (const col of columns) {
    const name = typeof col === "string" ? col : col.name;
    if (name === h || name.toLowerCase() === lower) return name;
  }
  return null;
}
