export function parseEventIdsFromForm(formData: FormData): string[] {
  const raw = formData.get("event_ids");
  if (typeof raw !== "string") return [];
  return Array.from(
    new Set(
      raw
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0 && s.length <= 64),
    ),
  );
}

export function parseEventPartsJson(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => (typeof item === "string" ? item.trim() : ""))
      .filter(Boolean);
  } catch {
    return [];
  }
}
