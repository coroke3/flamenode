/**
 * `mm:ss` / `hh:mm:ss` / 秒数文字列を秒数 (number) に変換する。
 * 不正な入力は null を返す。負数や 24 時間超は拒否する。
 *
 * VideoMembersField / chapter.ts / CSV インポート等で共通利用する。
 */
export function parseChapterTime(raw: string | null | undefined): number | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  if (/^\d+(\.\d+)?$/.test(s)) {
    const n = Number(s);
    return n >= 0 && n <= 60 * 60 * 24 ? n : null;
  }
  const parts = s.split(":").map((p) => p.trim());
  if (parts.length < 2 || parts.length > 3) return null;
  if (!parts.every((p) => /^\d+(\.\d+)?$/.test(p))) return null;
  const nums = parts.map(Number);
  let total = 0;
  if (nums.length === 2) {
    total = nums[0]! * 60 + nums[1]!;
  } else {
    total = nums[0]! * 3600 + nums[1]! * 60 + nums[2]!;
  }
  return total >= 0 && total <= 60 * 60 * 24 ? total : null;
}

/** 秒数を `mm:ss` 文字列に整形する (CSV 出力用)。 */
export function formatChapterTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const total = Math.floor(sec);
  const mm = Math.floor(total / 60);
  const ss = total % 60;
  return `${mm}:${ss.toString().padStart(2, "0")}`;
}
