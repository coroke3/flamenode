export const YOUTUBE_DEFAULT_DAILY_QUOTA_UNITS = 10_000;
export const YOUTUBE_TARGET_USAGE_PERCENT = 80;
export const YOUTUBE_PROVIDER_KEY = "youtube";

const MIN_CONFIGURED_DAILY_QUOTA_UNITS = 100;
const MAX_CONFIGURED_DAILY_QUOTA_UNITS = 10_000_000;

export function resolveYoutubeDailyQuotaUnits(raw: string | undefined): number {
  const parsed = Number.parseInt(raw?.trim() ?? "", 10);
  if (
    Number.isSafeInteger(parsed) &&
    parsed >= MIN_CONFIGURED_DAILY_QUOTA_UNITS &&
    parsed <= MAX_CONFIGURED_DAILY_QUOTA_UNITS
  ) {
    return parsed;
  }
  return YOUTUBE_DEFAULT_DAILY_QUOTA_UNITS;
}

export function youtubeDailyBudgetUnits(raw: string | undefined): number {
  return Math.floor(
    (resolveYoutubeDailyQuotaUnits(raw) * YOUTUBE_TARGET_USAGE_PERCENT) / 100,
  );
}

/** YouTube quotaのリセット基準であるAmerica/Los_Angelesの日付を返す。 */
export function youtubeQuotaDay(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = new Map(parts.map((part) => [part.type, part.value]));
  return `${values.get("year")}-${values.get("month")}-${values.get("day")}`;
}
