/**
 * Convert a stored custom-answer pair into the text shown on the review page.
 *
 * Checkbox questions persist `answer_json` (and leave `answer_text` null),
 * while text/select questions persist `answer_text`. Empty JSON values are
 * treated the same as an empty form submission.
 */
export function formatVideoReviewAnswer(
  answerText: string | null | undefined,
  answerJson: string | null | undefined,
): string {
  const text = answerText?.trim() ?? "";
  if (text) return text;

  const rawJson = answerJson?.trim() ?? "";
  if (!rawJson) return "";

  try {
    const parsed: unknown = JSON.parse(rawJson);
    if (Array.isArray(parsed)) {
      return parsed
        .filter((value): value is string => typeof value === "string")
        .map((value) => value.trim())
        .filter(Boolean)
        .join(", ");
    }
    if (typeof parsed === "string") return parsed.trim();
    if (parsed == null) return "";
    if (typeof parsed === "object") {
      return Object.keys(parsed).length === 0 ? "" : JSON.stringify(parsed);
    }
    return String(parsed);
  } catch {
    // Preserve a non-empty legacy value for reviewer visibility. New writes
    // are validated JSON, so this is only a defensive fallback.
    return rawJson;
  }
}
