export function normalizeXId(value: string | null | undefined): string {
  return String(value ?? "")
    .trim()
    .replace(/^@+/, "")
    .toLowerCase();
}

export function isValidXId(value: string | null | undefined): boolean {
  const id = normalizeXId(value);
  return /^[a-z0-9_]{1,32}$/.test(id);
}
