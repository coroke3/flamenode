// Moderation case input normalization (moved from src/lib/admin/moderationCaseInput.ts;
// parseModerationDueAt now uses the strict JST datetime-local parser).
import { parseJstDatetimeLocalStrict } from "../datetime.ts";

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
  "pending",
  "public",
  "private",
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

// The only producer is the admin form's <input type="datetime-local">, so
// reuse the strict JST parser: overflow dates (2026-02-30) and other formats
// (no Date.parse fallback) map to null, the same result as malformed input.
export function parseModerationDueAt(
  value: string | null | undefined,
): number | null {
  const parsed = parseJstDatetimeLocalStrict(value);
  return parsed.ok ? parsed.value : null;
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
