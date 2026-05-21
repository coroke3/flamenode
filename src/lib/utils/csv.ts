/**
 * 軽量 CSV パーサ。RFC4180 風の処理を行う。
 *
 * 仕様:
 *   - 区切り文字: `,` (固定)
 *   - 行末: `\n` / `\r\n` (どちらも許容、出力には残さない)
 *   - クォート: `"..."` を 1 セルとして扱う。クォート内では `""` を 1 つのダブルクォートとして扱う。
 *   - クォートで囲まれていないセルは前後の空白をトリムしない (CSV としては原則トリムしない設計)。
 *     -> 呼び出し側で必要なら trim する。
 *   - 行数や列数は呼び出し側で検査する。
 *   - BOM (﻿) は先頭にあれば除去する。
 *
 * 設計理由: 外部ライブラリを追加せず、ブラウザでも Worker でも同じ実装を再利用したい。
 * NOTE: CSV 由来テキストは決して HTML として扱わない (CLAUDE.md 方針)。
 */
export function parseCsv(input: string): string[][] {
  if (typeof input !== "string") return [];
  const text = input.replace(/^﻿/, "");
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

    if (ch === ",") {
      cur.push(field);
      field = "";
      i += 1;
      continue;
    }

    if (ch === "\r") {
      // \r\n の \r は無視して \n 側で行確定する
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

  // 末尾フィールド処理: 空行だけの末尾は無視
  if (field.length > 0 || cur.length > 0) {
    cur.push(field);
    rows.push(cur);
  }

  // 完全な空行 (空文字 1 セルだけ) を取り除く。
  // CRLF や末尾改行で生まれるダミー行は除外する。
  return rows.filter((r) => !(r.length === 1 && r[0] === ""));
}

/**
 * ヘッダー行とデータ行を分離してオブジェクト化する。
 *
 * - ヘッダー名は trim + lower-case 化して扱う。
 * - 同名ヘッダーが複数ある場合は最後勝ち。
 * - データ行の列数がヘッダー数を超えても無視。足りない列は空文字。
 */
export interface CsvParsedTable {
  headers: string[];
  rows: Record<string, string>[];
}

export function parseCsvWithHeader(input: string): CsvParsedTable {
  const all = parseCsv(input);
  if (all.length === 0) return { headers: [], rows: [] };
  const headerRow = all[0]!;
  const headers = headerRow.map((h) => String(h ?? "").trim().toLowerCase());
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < all.length; i++) {
    const r = all[i]!;
    const obj: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) {
      const key = headers[j]!;
      obj[key] = j < r.length ? String(r[j] ?? "") : "";
    }
    rows.push(obj);
  }
  return { headers, rows };
}

/**
 * セル値を 1 段 trim して、空文字なら null を返す。
 * フォーム入力の正規化と同じ意図で使うため共通化しておく。
 */
export function trimToNull(value: string | null | undefined): string | null {
  if (value == null) return null;
  const v = String(value).trim();
  return v.length > 0 ? v : null;
}
