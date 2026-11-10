/** MIG-0721 U01b-3: CURRENT pure custom question normalization/validation helpers; no DB dependency. */
export type CustomQuestionType = "text" | "textarea" | "select" | "radio" | "checkbox";
export type CustomQuestionVisibility = "review" | "private" | "public";

export interface CustomQuestion {
  id: string;
  event_id: string;
  question_key: string;
  label: string;
  description: string | null;
  type: CustomQuestionType;
  required: boolean;
  options: string[];
  placeholder: string | null;
  max_length: number | null;
  sort_order: number;
  is_active: boolean;
  visibility: CustomQuestionVisibility;
}

const VALID_TYPES: ReadonlySet<string> = new Set([
  "text", "textarea", "select", "radio", "checkbox",
]);
const VALID_VISIBILITY: ReadonlySet<string> = new Set([
  "review", "private", "public",
]);
const KEY_MAX_LEN = 64;
export const MAX_QUESTION_OPTIONS = 50;
export const OPTION_MAX_LEN = 200;
const MAX_OPTIONS = MAX_QUESTION_OPTIONS;

export function questionTypeNeedsOptions(type: CustomQuestionType): boolean {
  return type === "select" || type === "radio" || type === "checkbox";
}

export function normalizeOptionList(
  options: readonly string[] | null | undefined,
): string[] {
  return parseOptionsJson(JSON.stringify(options ?? []));
}

export function serializeOptionsJson(
  options: readonly string[] | null | undefined,
): string | null {
  const normalized = normalizeOptionList(options);
  return normalized.length > 0 ? JSON.stringify(normalized) : null;
}

export function normalizeQuestionKey(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw.trim().replace(/[^A-Za-z0-9_-]/g, "_").slice(0, KEY_MAX_LEN);
}

export function parseQuestionType(value: unknown): CustomQuestionType {
  if (typeof value === "string" && VALID_TYPES.has(value)) {
    return value as CustomQuestionType;
  }
  return "textarea";
}

export function parseVisibility(value: unknown): CustomQuestionVisibility {
  if (typeof value === "string" && VALID_VISIBILITY.has(value)) {
    return value as CustomQuestionVisibility;
  }
  return "review";
}

export function parseOptionsJson(raw: string | null | undefined): string[] {
  if (!raw || !raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const item of parsed) {
      if (typeof item !== "string") continue;
      const clipped = item.trim().slice(0, OPTION_MAX_LEN);
      // Do not persist an orphan high surrogate when the UTF-16 limit cuts an emoji.
      const trimmed = /[\uD800-\uDBFF]$/.test(clipped) ? clipped.slice(0, -1) : clipped;
      if (!trimmed || seen.has(trimmed)) continue;
      seen.add(trimmed);
      out.push(trimmed);
      if (out.length >= MAX_OPTIONS) break;
    }
    return out;
  } catch {
    return [];
  }
}

