/**
 * CSV / TSV 共通の区切りテキスト処理。
 * parseCsv はカンマ固定のエイリアスとして csv.ts に残す。
 */

export type DelimiterChar = "," | "\t";

export function stripBom(input: string): string {
  return input.replace(/^\uFEFF/, "");
}

export function parseDelimited(
  input: string,
  delimiter: DelimiterChar = ",",
): string[][] {
  if (typeof input !== "string") return [];
  const text = stripBom(input);
  const rows: string[][] = [];
  let cur: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  const len = text.length;

  while (i < len) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        const next = text[i + 1];
        if (next === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }

    if (ch === delimiter) {
      cur.push(field);
      field = "";
      i += 1;
      continue;
    }

    if (ch === "\r") {
      i += 1;
      continue;
    }

    if (ch === "\n") {
      cur.push(field);
      rows.push(cur);
      cur = [];
      field = "";
      i += 1;
      continue;
    }

    field += ch;
    i += 1;
  }

  if (field.length > 0 || cur.length > 0) {
    cur.push(field);
    rows.push(cur);
  }

  return rows.filter((r) => !(r.length === 1 && r[0] === ""));
}

/** 先頭行から CSV / TSV を推定 */
export function detectDelimiter(text: string): DelimiterChar {
  const line = stripBom(text).split(/\r?\n/).find((l) => l.trim().length > 0) ?? "";
  const tabs = (line.match(/\t/g) ?? []).length;
  const commas = (line.match(/,/g) ?? []).length;
  return tabs > commas ? "\t" : ",";
}

function escapeCell(value: string, delimiter: DelimiterChar): string {
  const needsQuote =
    value.includes(delimiter) ||
    value.includes('"') ||
    value.includes("\n") ||
    value.includes("\r");
  if (!needsQuote) return value;
  return `"${value.replace(/"/g, '""')}"`;
}

export function serializeDelimited(
  rows: string[][],
  delimiter: DelimiterChar = ",",
): string {
  return rows
    .map((row) => row.map((cell) => escapeCell(String(cell ?? ""), delimiter)).join(delimiter))
    .join("\n");
}
