export type CustomQuestionType =
  | "text"
  | "textarea"
  | "select"
  | "multi-select"
  | "number"
  | "date";

export interface CustomQuestion {
  id: string;
  label: string;
  type: CustomQuestionType;
  required: boolean;
  placeholder?: string;
  options?: string[];
  min?: number;
  max?: number;
  max_length?: number;
  order: number;
  help_text?: string;
  enabled?: boolean;
}

export type CustomAnswers = Record<
  string,
  Record<string, string | string[] | number | boolean | null>
>;

const VALID_TYPES: ReadonlySet<string> = new Set([
  "text",
  "textarea",
  "select",
  "multi-select",
  "number",
  "date",
]);

const ID_MAX_LEN = 64;
const LABEL_MAX_LEN = 120;
const TEXT_DEFAULT_MAX = 200;
const TEXTAREA_DEFAULT_MAX = 1000;
const MAX_QUESTIONS = 50;
const MAX_OPTIONS = 100;
const OPTION_MAX_LEN = 200;

export function normalizeQuestionId(value: unknown): string {
  if (typeof value !== "string") return "";
  const cleaned = value
    .trim()
    .replace(/[^A-Za-z0-9_-]/g, "_")
    .slice(0, ID_MAX_LEN);
  return cleaned;
}

export function normalizeQuestionOptions(options: unknown): string[] {
  if (!Array.isArray(options)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of options) {
    if (typeof raw !== "string") continue;
    const trimmed = raw.trim().slice(0, OPTION_MAX_LEN);
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
    if (out.length >= MAX_OPTIONS) break;
  }
  return out;
}

function normalizeQuestion(
  raw: Record<string, unknown>,
  index: number,
): CustomQuestion | null {
  const id = normalizeQuestionId(raw.id) || `q_${index}`;
  const label = typeof raw.label === "string" ? raw.label.trim().slice(0, LABEL_MAX_LEN) : "";
  if (!label) return null;

  const typeStr = typeof raw.type === "string" ? raw.type : "text";
  const type: CustomQuestionType = VALID_TYPES.has(typeStr)
    ? (typeStr as CustomQuestionType)
    : "text";

  const enabled = raw.enabled !== false;

  const question: CustomQuestion = {
    id,
    label,
    type,
    required: raw.required === true,
    order: typeof raw.order === "number" ? raw.order : index,
    enabled,
  };

  if (typeof raw.placeholder === "string" && raw.placeholder.trim()) {
    question.placeholder = raw.placeholder.trim().slice(0, 500);
  }
  if (typeof raw.help_text === "string" && raw.help_text.trim()) {
    question.help_text = raw.help_text.trim().slice(0, 500);
  }

  if (type === "select" || type === "multi-select") {
    question.options = normalizeQuestionOptions(raw.options);
  }

  if (type === "number") {
    if (typeof raw.min === "number" && Number.isFinite(raw.min)) {
      question.min = raw.min;
    }
    if (typeof raw.max === "number" && Number.isFinite(raw.max)) {
      question.max = raw.max;
    }
  }

  if (type === "text" || type === "textarea") {
    const defaultMax = type === "text" ? TEXT_DEFAULT_MAX : TEXTAREA_DEFAULT_MAX;
    if (typeof raw.max_length === "number" && raw.max_length > 0) {
      question.max_length = Math.min(Math.floor(raw.max_length), 5000);
    } else {
      question.max_length = defaultMax;
    }
  }

  return question;
}

export function parseCustomQuestions(
  raw: string | null | undefined,
): CustomQuestion[] {
  if (!raw || !raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const out: CustomQuestion[] = [];
    for (let i = 0; i < parsed.length && out.length < MAX_QUESTIONS; i++) {
      const item = parsed[i];
      if (!item || typeof item !== "object" || Array.isArray(item)) continue;
      const q = normalizeQuestion(item as Record<string, unknown>, i);
      if (q) out.push(q);
    }
    return out;
  } catch {
    return [];
  }
}

export function serializeCustomQuestions(
  questions: readonly CustomQuestion[],
): string | null {
  if (questions.length === 0) return null;
  const cleaned = questions.map((q, i) => {
    const entry: Record<string, unknown> = {
      id: normalizeQuestionId(q.id) || `q_${i}`,
      label: q.label.trim().slice(0, LABEL_MAX_LEN),
      type: VALID_TYPES.has(q.type) ? q.type : "text",
      required: q.required === true,
      order: typeof q.order === "number" ? q.order : i,
      enabled: q.enabled !== false,
    };
    if (q.placeholder) entry.placeholder = q.placeholder;
    if (q.help_text) entry.help_text = q.help_text;
    if (q.options && (q.type === "select" || q.type === "multi-select")) {
      entry.options = normalizeQuestionOptions(q.options);
    }
    if (q.type === "number") {
      if (typeof q.min === "number") entry.min = q.min;
      if (typeof q.max === "number") entry.max = q.max;
    }
    if ((q.type === "text" || q.type === "textarea") && q.max_length) {
      entry.max_length = q.max_length;
    }
    return entry;
  });
  return JSON.stringify(cleaned);
}

export function parseCustomAnswers(
  raw: string | null | undefined,
): CustomAnswers {
  if (!raw || !raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as CustomAnswers;
  } catch {
    return {};
  }
}

export function getCustomAnswerValue(
  rawAnswers: string | null | undefined,
  eventId: string,
  questionId: string,
): string | string[] | number | boolean | null {
  const answers = parseCustomAnswers(rawAnswers);
  const eventAnswers = answers[eventId];
  if (!eventAnswers) return null;
  const val = eventAnswers[questionId];
  return val ?? null;
}

export function mergeCustomAnswers(
  existing: CustomAnswers,
  next: CustomAnswers,
  eventIds: readonly string[],
): string | null {
  const merged: CustomAnswers = { ...existing };
  for (const eid of eventIds) {
    if (next[eid] !== undefined) {
      merged[eid] = next[eid];
    }
  }
  const hasAny = Object.values(merged).some(
    (ea) => ea && Object.keys(ea).length > 0,
  );
  if (!hasAny) return null;
  return JSON.stringify(merged);
}

type ValidationResult =
  | { ok: true; value: string | null }
  | { ok: false; message: string };

export function validateCustomAnswersForEvents(args: {
  questionsByEvent: Map<string, readonly CustomQuestion[]>;
  rawAnswers: string | null | undefined;
  eventIds: readonly string[];
}): ValidationResult {
  const { questionsByEvent, rawAnswers, eventIds } = args;
  const answers = parseCustomAnswers(rawAnswers);

  for (const eventId of eventIds) {
    const questions = questionsByEvent.get(eventId) ?? [];
    const eventAnswers = answers[eventId] ?? {};

    for (const q of questions) {
      if (q.enabled === false) continue;
      const raw = eventAnswers[q.id];

      if (q.required) {
        const isEmpty =
          raw === null ||
          raw === undefined ||
          raw === "" ||
          (Array.isArray(raw) && raw.length === 0);
        if (isEmpty) {
          return { ok: false, message: `${q.label}を入力してください。` };
        }
      }

      if (raw === null || raw === undefined || raw === "") continue;

      switch (q.type) {
        case "text":
        case "textarea": {
          if (typeof raw !== "string") {
            return { ok: false, message: `${q.label}は文字列で入力してください。` };
          }
          const maxLen = q.max_length ?? (q.type === "text" ? TEXT_DEFAULT_MAX : TEXTAREA_DEFAULT_MAX);
          if (raw.length > maxLen) {
            return {
              ok: false,
              message: `${q.label}は${maxLen}文字以内で入力してください。`,
            };
          }
          break;
        }
        case "select": {
          if (typeof raw !== "string") {
            return { ok: false, message: `${q.label}は文字列で選択してください。` };
          }
          if (q.options && q.options.length > 0 && !q.options.includes(raw)) {
            return {
              ok: false,
              message: `${q.label}は選択肢から選んでください。`,
            };
          }
          break;
        }
        case "multi-select": {
          if (!Array.isArray(raw)) {
            return {
              ok: false,
              message: `${q.label}は選択肢から選んでください。`,
            };
          }
          for (const v of raw) {
            if (typeof v !== "string") {
              return {
                ok: false,
                message: `${q.label}は文字列で選択してください。`,
              };
            }
            if (q.options && q.options.length > 0 && !q.options.includes(v)) {
              return {
                ok: false,
                message: `${q.label}は選択肢から選んでください。`,
              };
            }
          }
          break;
        }
        case "number": {
          const num = typeof raw === "number" ? raw : Number(raw);
          if (!Number.isFinite(num)) {
            return {
              ok: false,
              message: `${q.label}は数値で入力してください。`,
            };
          }
          if (typeof q.min === "number" && num < q.min) {
            return {
              ok: false,
              message: `${q.label}は${q.min}以上で入力してください。`,
            };
          }
          if (typeof q.max === "number" && num > q.max) {
            return {
              ok: false,
              message: `${q.label}は${q.max}以下で入力してください。`,
            };
          }
          break;
        }
        case "date": {
          if (typeof raw !== "string") {
            return {
              ok: false,
              message: `${q.label}は日付形式で入力してください。`,
            };
          }
          if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
            return {
              ok: false,
              message: `${q.label}はYYYY-MM-DD形式で入力してください。`,
            };
          }
          break;
        }
      }
    }
  }

  return { ok: true, value: rawAnswers ?? null };
}

export function readCustomAnswersFromFormData(
  formData: FormData,
  eventIds: readonly string[],
  questionsByEvent: Map<string, readonly CustomQuestion[]>,
): CustomAnswers {
  const result: CustomAnswers = {};

  for (const eventId of eventIds) {
    const questions = questionsByEvent.get(eventId) ?? [];
    if (questions.length === 0) continue;
    const eventAnswers: Record<string, string | string[] | number | boolean | null> = {};

    for (const q of questions) {
      if (q.enabled === false) continue;
      const raw = formData.get(`custom_answer:${eventId}:${q.id}`);

      if (raw === null || raw === undefined) continue;

      switch (q.type) {
        case "multi-select": {
          const all = formData.getAll(`custom_answer:${eventId}:${q.id}`);
          const selected = all
            .map((v) => (typeof v === "string" ? v.trim() : ""))
            .filter(Boolean);
          eventAnswers[q.id] = selected.length > 0 ? selected : null;
          break;
        }
        case "number": {
          const str = typeof raw === "string" ? raw.trim() : "";
          if (str === "") {
            eventAnswers[q.id] = null;
          } else {
            const num = Number(str);
            eventAnswers[q.id] = Number.isFinite(num) ? num : null;
          }
          break;
        }
        default: {
          const str = typeof raw === "string" ? raw.trim() : "";
          eventAnswers[q.id] = str || null;
          break;
        }
      }
    }

    if (Object.keys(eventAnswers).length > 0) {
      result[eventId] = eventAnswers;
    }
  }

  return result;
}

export function getCustomQuestionsForEvents(
  rawQuestionsList: readonly (string | null | undefined)[],
): CustomQuestion[] {
  const byId = new Map<string, CustomQuestion>();
  for (const raw of rawQuestionsList) {
    const questions = parseCustomQuestions(raw);
    for (const q of questions) {
      if (q.enabled === false) continue;
      const existing = byId.get(q.id);
      if (existing) {
        byId.set(q.id, {
          ...existing,
          required: existing.required || q.required,
        });
      } else {
        byId.set(q.id, q);
      }
    }
  }
  return Array.from(byId.values()).sort((a, b) => a.order - b.order);
}
