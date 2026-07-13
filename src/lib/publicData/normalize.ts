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

export function normalizeNullableUnix(value: unknown): number | null {
  if (value == null || value === "") return null;

  const normalized = Number(value);
  return Number.isFinite(normalized) ? Math.floor(normalized) : null;
}

export function normalizeNumericUnix(value: unknown): number | null {
  const normalized =
    typeof value === "number" ? value : Number(value);

  return Number.isFinite(normalized)
    ? Math.floor(normalized)
    : null;
}

export function normalizeCount(value: unknown): number | null {
  const normalized = normalizeNumericUnix(value);
  return normalized != null && normalized >= 0
    ? normalized
    : null;
}
