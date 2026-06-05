import {
  detectDelimiter,
  parseDelimited,
  stripBom,
} from "#utils/delimited";

import { parseHtmlClipboardTable } from "#utils/clipboard-html";

function gridCellCount(grid: string[][]): number {
  return grid.reduce((n, row) => n + row.length, 0);
}

/** plain / html から最も情報量の多いグリッドを選ぶ */
export function parseClipboardContent(
  plain: string,
  html: string,
): string[][] {
  const normalized = stripBom(plain)
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
  const trimmed = normalized.replace(/\n$/, "");

  const plainGrid =
    trimmed.trim().length > 0
      ? parseDelimited(trimmed, detectDelimiter(trimmed))
      : [];

  const htmlGrid = html.trim() ? parseHtmlClipboardTable(html) : [];

  if (plainGrid.length === 0) return htmlGrid;
  if (htmlGrid.length === 0) return plainGrid;

  return gridCellCount(htmlGrid) > gridCellCount(plainGrid)
    ? htmlGrid
    : plainGrid;
}

export function looksLikeTabularClipboard(
  plain: string,
  html: string,
): boolean {
  if (plain.includes("\t")) return true;
  const lines = plain.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length > 1) return true;

  const grid = parseClipboardContent(plain, html);
  if (grid.length > 1) return true;
  return (grid[0]?.length ?? 0) > 1;
}
