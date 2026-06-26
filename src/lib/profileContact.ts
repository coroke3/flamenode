const CONTACT_PLACEHOLDER_VALUES = new Set([
  "portfolio_contact",
]);

export function normalizePortfolioContact(
  value: string | null | undefined,
): string | null {
  const text = String(value ?? "").trim();
  if (!text) return null;
  if (CONTACT_PLACEHOLDER_VALUES.has(text.toLowerCase())) return null;
  return text;
}

