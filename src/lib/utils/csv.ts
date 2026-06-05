/**
 * 軽量 CSV パーサ。RFC4180 風の処理は delimited.ts に集約。
 */
import { parseDelimited } from "#utils/delimited";

export function parseCsv(input: string): string[][] {
  return parseDelimited(input, ",");
}
