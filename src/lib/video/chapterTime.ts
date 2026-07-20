const MAX_CHAPTER_TIME_SECONDS = 60 * 60 * 24;

function fractionToMilliseconds(raw: string | undefined): number {
  if (!raw) return 0;
  return Number(raw.padEnd(3, "0"));
}

/**
 * チャプター時刻入力を秒へ変換する。
 *
 * 対応形式:
 * - 秒: `83`, `83.5`
 * - 分:秒: `1:23`, `1:23.5`
 * - 時:分:秒: `1:23:45`, `1:23:45.5`
 *
 * `1:23:45` を小数秒付きの分:秒として誤解釈しないよう、
 * 時:分:秒を先に判定し、小数秒の区切りには `.` のみを許可する。
 */
export function parseChapterTimeInput(raw: string): number | null {
  const value = raw.trim();
  if (!value) return null;

  const secondsOnly = value.match(/^(\d+)(?:\.(\d{1,3}))?$/);
  if (secondsOnly) {
    const seconds =
      Number(secondsOnly[1]) + fractionToMilliseconds(secondsOnly[2]) / 1000;
    return Number.isFinite(seconds) && seconds <= MAX_CHAPTER_TIME_SECONDS
      ? seconds
      : null;
  }

  const hhmmss = value.match(
    /^(\d{1,2}):([0-5]\d):([0-5]\d)(?:\.(\d{1,3}))?$/,
  );
  if (hhmmss) {
    const seconds =
      Number(hhmmss[1]) * 3600 +
      Number(hhmmss[2]) * 60 +
      Number(hhmmss[3]) +
      fractionToMilliseconds(hhmmss[4]) / 1000;
    return seconds <= MAX_CHAPTER_TIME_SECONDS ? seconds : null;
  }

  const mmss = value.match(/^(\d{1,4}):([0-5]\d)(?:\.(\d{1,3}))?$/);
  if (mmss) {
    const seconds =
      Number(mmss[1]) * 60 +
      Number(mmss[2]) +
      fractionToMilliseconds(mmss[3]) / 1000;
    return seconds <= MAX_CHAPTER_TIME_SECONDS ? seconds : null;
  }

  return null;
}
