export const DEFAULT_STAGE_PERMISSION_QUESTION_KEY = "stage_permission";
const STAGE_PERMISSION_KEY_PREFIX = `${DEFAULT_STAGE_PERMISSION_QUESTION_KEY}_`;

export function isStagePermissionQuestionKey(questionKey: string): boolean {
  return (
    questionKey === DEFAULT_STAGE_PERMISSION_QUESTION_KEY ||
    questionKey.startsWith(STAGE_PERMISSION_KEY_PREFIX)
  );
}

export interface StagePermissionFieldSettings {
  id: string;
  enabled: boolean;
  required: boolean;
  label: string;
  description: string;
  placeholder: string;
}

export interface StagePermissionAnswer {
  id: string;
  label: string;
  value: string;
}

export interface VideoFormSettings {
  stage_permissions?: Partial<StagePermissionFieldSettings>[] | null;
}

export const DEFAULT_STAGE_PERMISSION_FIELD: StagePermissionFieldSettings = {
  id: DEFAULT_STAGE_PERMISSION_QUESTION_KEY,
  enabled: true,
  required: false,
  label: "ステージ・素材・権利まわりの使用許可",
  description:
    "ステージ、モデル、素材、その他権利確認が必要なものについて記入してください。",
  placeholder: "例：自作ステージ / 利用規約確認済み / 権利者許可済み など",
};

function cleanId(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const cleaned = value.trim().replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 64);
  return cleaned || fallback;
}

function cleanText(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function normalizeStagePermissionQuestion(
  value: Partial<StagePermissionFieldSettings> | null | undefined,
  index: number,
): StagePermissionFieldSettings {
  const fallbackId =
    index === 0
      ? DEFAULT_STAGE_PERMISSION_QUESTION_KEY
      : `${DEFAULT_STAGE_PERMISSION_QUESTION_KEY}_${index + 1}`;
  return {
    id: cleanId(value?.id, fallbackId),
    enabled: value?.enabled === true,
    required: value?.required === true,
    label: cleanText(value?.label, DEFAULT_STAGE_PERMISSION_FIELD.label),
    description: cleanText(
      value?.description,
      DEFAULT_STAGE_PERMISSION_FIELD.description,
    ),
    placeholder: cleanText(
      value?.placeholder,
      DEFAULT_STAGE_PERMISSION_FIELD.placeholder,
    ),
  };
}

export function parseVideoFormSettings(
  raw: string | null | undefined,
): VideoFormSettings {
  if (!raw || !raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    return parsed as VideoFormSettings;
  } catch {
    return {};
  }
}

export function getStagePermissionQuestions(
  settings: VideoFormSettings,
): StagePermissionFieldSettings[] {
  if (Array.isArray(settings.stage_permissions)) {
    return settings.stage_permissions.map(normalizeStagePermissionQuestion);
  }
  return [];
}

export function createDefaultStagePermissionQuestion(
  index = 0,
): StagePermissionFieldSettings {
  return {
    ...DEFAULT_STAGE_PERMISSION_FIELD,
    id:
      index === 0
        ? DEFAULT_STAGE_PERMISSION_QUESTION_KEY
        : `${DEFAULT_STAGE_PERMISSION_QUESTION_KEY}_${index + 1}`,
    enabled: false,
  };
}

/**
 * EventForm v1 used to materialize one disabled placeholder question even
 * when an event had no configured questions.  Do not resurrect that legacy
 * placeholder from an old draft or template snapshot.
 */
export function isImplicitEmptyStagePermissionQuestion(
  question: StagePermissionFieldSettings,
): boolean {
  return (
    question.id === DEFAULT_STAGE_PERMISSION_QUESTION_KEY &&
    !question.enabled &&
    !question.required &&
    question.label === DEFAULT_STAGE_PERMISSION_FIELD.label &&
    question.description === DEFAULT_STAGE_PERMISSION_FIELD.description &&
    question.placeholder === DEFAULT_STAGE_PERMISSION_FIELD.placeholder
  );
}

export function filterImplicitEmptyStagePermissionQuestions(
  questions: readonly StagePermissionFieldSettings[],
): StagePermissionFieldSettings[] {
  return questions.filter(
    (question) => !isImplicitEmptyStagePermissionQuestion(question),
  );
}

export function resolveStagePermissionFields(
  settingsList: readonly VideoFormSettings[],
): StagePermissionFieldSettings[] {
  const byId = new Map<string, StagePermissionFieldSettings>();

  for (const settings of settingsList) {
    for (const question of getStagePermissionQuestions(settings)) {
      if (!question.enabled) continue;
      const existing = byId.get(question.id);
      if (existing) {
        byId.set(question.id, {
          ...existing,
          required: existing.required || question.required,
        });
      } else {
        byId.set(question.id, question);
      }
    }
  }

  return Array.from(byId.values());
}

export function resolveStagePermissionFieldsFromJson(
  rawSettings: readonly (string | null | undefined)[],
): StagePermissionFieldSettings[] {
  return resolveStagePermissionFields(rawSettings.map(parseVideoFormSettings));
}

export function parseStagePermissionAnswers(
  raw: string | null | undefined,
): StagePermissionAnswer[] {
  if (!raw || !raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw.trim()) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return [];
    }
    const answers = (parsed as { answers?: unknown }).answers;
    if (!Array.isArray(answers)) return [];
    return answers
      .map((item): StagePermissionAnswer | null => {
        if (!item || typeof item !== "object") return null;
        const data = item as Record<string, unknown>;
        const id = cleanId(data.id, "");
        const label = cleanText(data.label, DEFAULT_STAGE_PERMISSION_FIELD.label);
        const value =
          typeof data.value === "string" && data.value.trim()
            ? data.value.trim()
            : "";
        if (!id || !value) return null;
        return { id, label, value };
      })
      .filter((item): item is StagePermissionAnswer => item !== null);
  } catch {
    return [];
  }
}

export function getStagePermissionAnswerValue(
  raw: string | null | undefined,
  questionId: string,
): string {
  const normalizedId = cleanId(questionId, DEFAULT_STAGE_PERMISSION_QUESTION_KEY);
  return (
    parseStagePermissionAnswers(raw).find((answer) => answer.id === normalizedId)
      ?.value ?? ""
  );
}

export function serializeStagePermissionAnswers(
  answers: readonly StagePermissionAnswer[],
): string | null {
  const cleaned = answers
    .map((answer) => ({
      id: cleanId(answer.id, ""),
      label: cleanText(answer.label, DEFAULT_STAGE_PERMISSION_FIELD.label),
      value: answer.value.trim(),
    }))
    .filter((answer) => answer.id && answer.value);

  if (cleaned.length === 0) return null;
  return JSON.stringify({ version: 1, answers: cleaned });
}
