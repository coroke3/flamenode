import { parseCsv } from "@/lib/utils/csv";

/** D1 の 100 bind / 50 query 制約内で監査・queueを原子的に保存できるCSV行数。 */
export const MAX_ATOMIC_CHAPTER_BULK_ROWS = 8;

/** UIとServer Actionで同じCSV解釈・ヘッダー除外を使う。 */
export function parseChapterBulkCsv(input: string): string[][] {
  const rows = parseCsv(input);
  const first = rows[0]?.map((cell) => cell.trim().toLowerCase()) ?? [];
  return first.includes("time") || first.includes("label") || first.includes("visibility")
    ? rows.slice(1)
    : rows;
}
