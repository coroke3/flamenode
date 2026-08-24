import { EVENT_ID_PATTERN } from "@/lib/event/eventForm";
import { isCanonicalXId, normalizeXId } from "@/lib/utils/xid";

export const PUBLIC_EVENT_STAFF_SCHEMA_VERSION = 1 as const;
export const PUBLIC_EVENT_STAFF_MAX_ITEMS = 100;

export const PVSF_PUBLIC_API_ORIGIN = "https://pvsf.jp";
export const PVSF_PUBLIC_API_ORIGINS = [
  PVSF_PUBLIC_API_ORIGIN,
  "https://www.pvsf.jp",
] as const;

export type PublicEventStaffItemDto = {
  display_name: string;
  role_label: string | null;
  x_id: string | null;
  x_name: string | null;
  icon_url: string | null;
  has_public_profile: boolean;
};

export type PublicEventStaffDto = {
  schema_version: typeof PUBLIC_EVENT_STAFF_SCHEMA_VERSION;
  event_id: string;
  generated_at: number;
  staff: PublicEventStaffItemDto[];
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function requiredText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 && normalized.length <= maxLength
    ? normalized
    : null;
}

function optionalText(value: unknown, maxLength: number): string | null {
  if (value == null || value === "") return null;
  return requiredText(value, maxLength);
}

function normalizePublicIconUrl(value: unknown): string | null {
  const candidate = optionalText(value, 1_000);
  if (!candidate) return null;
  try {
    const parsed = new URL(candidate, "https://flamenode.invalid");
    if (
      parsed.protocol !== "https:" &&
      parsed.origin !== "https://flamenode.invalid"
    ) {
      return null;
    }
    return parsed.origin === "https://flamenode.invalid"
      ? `${parsed.pathname}${parsed.search}${parsed.hash}`
      : parsed.toString();
  } catch {
    return null;
  }
}

function normalizePublicXId(value: unknown): string | null {
  if (value == null || value === "") return null;
  if (typeof value !== "string") return null;
  const normalized = normalizeXId(value);
  return isCanonicalXId(normalized) ? normalized : null;
}

function normalizeStaffItem(value: unknown): PublicEventStaffItemDto | null {
  const row = asRecord(value);
  if (!row) return null;
  const displayName =
    requiredText(row.display_name, 200) ??
    requiredText(row.x_name, 200) ??
    normalizePublicXId(row.x_user_id);
  if (!displayName) return null;

  const xId = normalizePublicXId(row.x_user_id);
  return {
    display_name: displayName,
    role_label: optionalText(row.public_role_label, 200),
    x_id: xId,
    x_name: optionalText(row.x_name, 200),
    icon_url: normalizePublicIconUrl(row.icon_url),
    has_public_profile:
      xId !== null &&
      (row.has_public_profile === true || row.has_public_profile === 1),
  };
}

/** Route params are decoded once and constrained to the canonical event-ID alphabet. */
export function parsePublicEventId(raw: string | undefined): string | null {
  try {
    const decoded = decodeURIComponent(raw ?? "").trim();
    return EVENT_ID_PATTERN.test(decoded) ? decoded : null;
  } catch {
    return null;
  }
}

/**
 * Convert the event-base R2 artifact to a public API allowlist DTO.
 * Any malformed row makes the artifact unavailable instead of silently
 * returning a plausible partial staff list.
 */
export function normalizePublicEventStaffArtifact(
  value: unknown,
  expectedEventId: string,
): PublicEventStaffDto | null {
  const payload = asRecord(value);
  const event = asRecord(payload?.event);
  if (!payload || !event) return null;

  const generatedAt = payload.generated_at;
  if (
    typeof generatedAt !== "number" ||
    !Number.isSafeInteger(generatedAt) ||
    generatedAt <= 0
  ) {
    return null;
  }

  const id = requiredText(event.id, 64);
  const title = requiredText(event.title, 200);
  if (
    id !== expectedEventId ||
    !EVENT_ID_PATTERN.test(id) ||
    !title ||
    event.visibility_status !== "public"
  ) {
    return null;
  }

  if (
    !Array.isArray(payload.public_staff) ||
    payload.public_staff.length > PUBLIC_EVENT_STAFF_MAX_ITEMS
  ) {
    return null;
  }

  const staff: PublicEventStaffItemDto[] = [];
  for (const row of payload.public_staff) {
    const normalized = normalizeStaffItem(row);
    if (!normalized) return null;
    staff.push(normalized);
  }

  return {
    schema_version: PUBLIC_EVENT_STAFF_SCHEMA_VERSION,
    event_id: id,
    generated_at: generatedAt,
    staff,
  };
}

export function isPvsfPublicApiOrigin(origin: string | null): boolean {
  return origin !== null && PVSF_PUBLIC_API_ORIGINS.includes(
    origin as (typeof PVSF_PUBLIC_API_ORIGINS)[number],
  );
}

export function resolvePvsfPublicApiOrigin(origin: string | null): string | null {
  return isPvsfPublicApiOrigin(origin) ? origin : null;
}
