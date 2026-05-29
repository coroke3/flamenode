export const MODERATION_CASE_TYPES = [
  "x_reapply",
  "void",
  "duplicate",
  "rights",
  "operator",
] as const;

export const MODERATION_CASE_RESOLUTION_STATUSES = [
  "resolved",
  "rejected",
  "cancelled",
  "expired",
] as const;

export const MODERATION_VIDEO_STATUSES = [
  "draft",
  "pending",
  "public",
  "limited",
  "private",
  "hidden",
  "archived",
  "voided",
] as const;

export type ModerationCaseType = (typeof MODERATION_CASE_TYPES)[number];
export type ModerationCaseResolutionStatus =
  (typeof MODERATION_CASE_RESOLUTION_STATUSES)[number];
export type ModerationVideoStatus = (typeof MODERATION_VIDEO_STATUSES)[number];

export function normalizeModerationCaseType(
  value: string | null | undefined,
): ModerationCaseType | null {
  const normalized = String(value ?? "").trim();
  return MODERATION_CASE_TYPES.includes(normalized as ModerationCaseType)
    ? (normalized as ModerationCaseType)
    : null;
}

export function normalizeModerationResolutionStatus(
  value: string | null | undefined,
): ModerationCaseResolutionStatus | null {
  const normalized = String(value ?? "").trim();
  return MODERATION_CASE_RESOLUTION_STATUSES.includes(
    normalized as ModerationCaseResolutionStatus,
  )
    ? (normalized as ModerationCaseResolutionStatus)
    : null;
}

export function normalizeModerationVideoStatus(
  value: string | null | undefined,
): ModerationVideoStatus | null {
  const normalized = String(value ?? "").trim();
  if (!normalized) return null;
  return MODERATION_VIDEO_STATUSES.includes(normalized as ModerationVideoStatus)
    ? (normalized as ModerationVideoStatus)
    : null;
}

export function parseModerationDueAt(
  value: string | null | undefined,
): number | null {
  if (!value) return null;
  const s = value.trim();
  if (!s) return null;
  const m = s.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/,
  );
  if (!m) {
    const t = Date.parse(s);
    return Number.isNaN(t) ? null : Math.floor(t / 1000);
  }
  const [, y, mo, d, h, mi, sec = "0"] = m;
  return Math.floor(
    Date.UTC(
      Number(y),
      Number(mo) - 1,
      Number(d),
      Number(h) - 9,
      Number(mi),
      Number(sec),
    ) / 1000,
  );
}

export function normalizeModerationText(
  value: string | null | undefined,
  maxLength: number,
): string {
  return String(value ?? "").trim().slice(0, maxLength);
}

export function normalizeModerationXUserId(
  value: string | null | undefined,
): string | null {
  const normalized = String(value ?? "")
    .trim()
    .replace(/^@+/, "")
    .toLowerCase();
  return normalized || null;
}
