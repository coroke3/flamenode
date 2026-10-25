/**
 * MIG-0603 U02b: bulk chapter CSV parsing. Copy of CURRENT
 * src/lib/utils/delimited.ts parseDelimited (comma, no maxRows) and
 * src/lib/actions/chapterLimits.ts parseChapterBulkCsv; the API cannot import
 * src/**. Parity is pinned against the real modules by
 * apps/api/test/videoChapters.parity.test.mjs.
 */

function parseCommaDelimited(input: string): string[][] {
  if (typeof input !== "string") return [];
  const text = input.replace(/^﻿/, "");
  const rows: string[][] = [];
  let cur: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  const len = text.length;

  const pushRow = (): void => {
    if (!(cur.length === 1 && cur[0] === "")) rows.push(cur);
  };

  while (i < len) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
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
    if (ch === ",") {
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
      pushRow();
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
    pushRow();
  }
  return rows;
}

export function parseChapterBulkCsv(input: string): string[][] {
  const rows = parseCommaDelimited(input);
  const first = rows[0]?.map((cell) => cell.trim().toLowerCase()) ?? [];
  return first.includes("time") || first.includes("label") || first.includes("visibility")
    ? rows.slice(1)
    : rows;
}
