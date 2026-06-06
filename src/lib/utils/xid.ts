export function normalizeXId(value: string | null | undefined): string {
  return String(value ?? "")
    .trim()
    .replace(/^@+/, "")
    .toLowerCase();
}
