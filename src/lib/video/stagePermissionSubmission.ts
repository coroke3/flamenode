import {
  parseStagePermissionAnswers,
  resolveStagePermissionFieldsFromJson,
  serializeStagePermissionAnswers,
  type StagePermissionAnswer,
  type StagePermissionFieldSettings,
} from "@/lib/video/formSettings";
import { loadStagePermissionFormSettingsJsonByEvents } from "@/lib/video/stagePermissionQuestions";
import type { DB } from "@/lib/db/client";

export async function getStagePermissionFieldsForEvents(
  db: DB,
  eventIds: readonly string[],
): Promise<StagePermissionFieldSettings[]> {
  const ids = Array.from(new Set(eventIds.filter(Boolean)));
  if (ids.length === 0) return [];
  const settingsByEvent = await loadStagePermissionFormSettingsJsonByEvents(db, ids);
  return resolveStagePermissionFieldsFromJson(
    ids.map((id) => settingsByEvent.get(id) ?? null),
  );
}

export function readStagePermissionAnswerMap(formData: FormData): Map<string, string> {
  const ids = formData.getAll("custom_question_answer_id");
  const values = formData.getAll("custom_question_answer_value");
  const out = new Map<string, string>();
  for (let i = 0; i < ids.length; i++) {
    const id = String(ids[i] ?? "").trim();
    if (!id) continue;
    out.set(id, String(values[i] ?? "").trim());
  }

  return out;
}

export function buildStagePermissionSubmission(
  formData: FormData,
  fields: readonly StagePermissionFieldSettings[],
  existingAnswersJson?: string | null,
):
  | { ok: true; value: string | null }
  | { ok: false; message: string } {
  if (fields.length === 0) return { ok: true, value: null };

  const submitted = readStagePermissionAnswerMap(formData);
  const fallback = new Map(
    parseStagePermissionAnswers(existingAnswersJson).map((answer) => [
      answer.id,
      answer.value,
    ]),
  );
  const answers: StagePermissionAnswer[] = [];

  for (const field of fields) {
    const raw = submitted.has(field.id)
      ? submitted.get(field.id)
      : fallback.get(field.id);
    const value = (raw ?? "").trim();
    if (value.length > 1000) {
      return {
        ok: false,
        message: `${field.label}は1000文字以内で入力してください。`,
      };
    }
    if (field.required && !value) {
      return { ok: false, message: `${field.label}を入力してください。` };
    }
    if (value) {
      answers.push({ id: field.id, label: field.label, value });
    }
  }

  return { ok: true, value: serializeStagePermissionAnswers(answers) };
}
