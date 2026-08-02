/**
 * `mm:ss` / `hh:mm:ss` / 秒数文字列を検証・変換する。
 * VideoMembersField / chapter.ts / CSV インポート等で共通利用する。
 */

export type ChapterTimeErrorCode =
  | "empty"
  | "invalid_format"
  | "negative"
  | "seconds_out_of_range"
  | "exceeds_day_limit"
  | "exceeds_video_duration";

export type ChapterTimeValidationResult =
  | { ok: true; seconds: number }
  | { ok: false; code: ChapterTimeErrorCode; message: string };

const MAX_CHAPTER_SECONDS = 60 * 60 * 24;

export interface ValidateChapterTimeOptions {
  videoDurationSeconds?: number | null;
}

export function validateChapterTime(
  raw: string | null | undefined,
  options?: ValidateChapterTimeOptions,
): ChapterTimeValidationResult {
  const s = String(raw ?? "").trim();
  if (!s) {
    return { ok: false, code: "empty", message: "時刻を入力してください。" };
  }

  if (/^-?\d+(\.\d+)?$/.test(s)) {
    const n = Number(s);
    if (n < 0) {
      return { ok: false, code: "negative", message: "負の時刻は指定できません。" };
    }
    if (n > MAX_CHAPTER_SECONDS) {
      return {
        ok: false,
        code: "exceeds_day_limit",
        message: "24時間を超える時刻は指定できません。",
      };
    }
    const videoDuration = options?.videoDurationSeconds;
    if (videoDuration != null && n > videoDuration) {
      return {
        ok: false,
        code: "exceeds_video_duration",
        message: "動画の長さを超える時刻は指定できません。",
      };
    }
    return { ok: true, seconds: n };
  }

  if (!s.includes(":")) {
    return { ok: false, code: "invalid_format", message: "時刻の形式が不正です。" };
  }

  const parts = s.split(":").map((p) => p.trim());
  if (parts.length < 2 || parts.length > 3) {
    return { ok: false, code: "invalid_format", message: "時刻の形式が不正です。" };
  }
  if (!parts.every((p) => /^\d+$/.test(p))) {
    return { ok: false, code: "invalid_format", message: "時刻の形式が不正です。" };
  }

  const nums = parts.map(Number);
  let total: number;
  if (nums.length === 2) {
    const [minutes, seconds] = nums;
    if (seconds! > 59) {
      return {
        ok: false,
        code: "seconds_out_of_range",
        message: "秒は0〜59の範囲で指定してください。",
      };
    }
    total = minutes! * 60 + seconds!;
  } else {
    const [hours, minutes, seconds] = nums;
    if (minutes! > 59 || seconds! > 59) {
      return {
        ok: false,
        code: "seconds_out_of_range",
        message: "分・秒は0〜59の範囲で指定してください。",
      };
    }
    total = hours! * 3600 + minutes! * 60 + seconds!;
  }

  if (total < 0) {
    return { ok: false, code: "negative", message: "負の時刻は指定できません。" };
  }
  if (total > MAX_CHAPTER_SECONDS) {
    return {
      ok: false,
      code: "exceeds_day_limit",
      message: "24時間を超える時刻は指定できません。",
    };
  }
  const videoDuration = options?.videoDurationSeconds;
  if (videoDuration != null && total > videoDuration) {
    return {
      ok: false,
      code: "exceeds_video_duration",
      message: "動画の長さを超える時刻は指定できません。",
    };
  }
  return { ok: true, seconds: total };
}

/** 不正な入力は null。後方互換の薄いラッパー。 */
export function parseChapterTime(raw: string | null | undefined): number | null {
  const result = validateChapterTime(raw);
  return result.ok ? result.seconds : null;
}

/** 秒数を `mm:ss` 文字列に整形する (CSV 出力用)。 */
export function formatChapterTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const total = Math.floor(sec);
  const mm = Math.floor(total / 60);
  const ss = total % 60;
  return `${mm}:${ss.toString().padStart(2, "0")}`;
}
