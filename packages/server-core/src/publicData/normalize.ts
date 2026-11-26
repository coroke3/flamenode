export function normalizeTrimmedString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

export function normalizePresentString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

export function normalizeCoercedString(value: unknown): string | null {
  if (value == null) return null;

  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || null;
  }

  return String(value);
}

function normalizeFiniteNumericValue(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const decimal = value.trim();
  // Keep decimal fractions and exponent notation, but reject JS radix prefixes.
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(decimal)) {
    return null;
  }
  const normalized = Number(decimal);
  return Number.isFinite(normalized) ? normalized : null;
}

export function normalizeNullableUnix(value: unknown): number | null {
  if (value == null || value === "") return null;
  const normalized = normalizeFiniteNumericValue(value);
  if (normalized == null) return null;
  const unix = Math.floor(normalized);
  const ms = unix * 1000;
  if (!Number.isFinite(ms) || Math.abs(unix) > 8.64e12) return null;
  return unix;
}

export function normalizeUnixDate(value: unknown): Date | null {
  const unix = normalizeNullableUnix(value);
  if (unix == null) return null;
  const date = new Date(unix * 1000);
  return Number.isFinite(date.getTime()) ? date : null;
}

export function normalizeNumericUnix(value: unknown): number | null {
  // Preserve legacy null/empty defaults (Number(null) and Number("") were 0)
  // while rejecting other non-string/non-number coercions.
  if (value === null || value === "") return 0;
  const normalized = normalizeFiniteNumericValue(value);
  return normalized == null ? null : Math.floor(normalized);
}

export function normalizeCount(value: unknown): number | null {
  const normalized = normalizeNumericUnix(value);
  return normalized != null && normalized >= 0
    ? normalized
    : null;
}
