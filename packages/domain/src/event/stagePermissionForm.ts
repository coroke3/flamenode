/**
 * MIG-0652 U01 — framework-neutral stage-permission form projection.
 *
 * Preserve CURRENT src/lib/event/eventForm.ts behavior. The Next adapter
 * supplies its existing Japanese fallback labels; the domain core owns only
 * normalization and the shared max-question limit. No auth/DB/IO.
 */
import { MAX_STAGE_PERMISSION_QUESTIONS } from "./limits.ts";

export type StagePermissionFallbacks = {
  label: string;
  description: string;
  placeholder: string;
};

function boolFormValue(value: FormDataEntryValue | undefined): boolean {
  return String(value ?? "") === "1";
}

function cleanQuestionId(
  value: FormDataEntryValue | undefined,
  index: number,
): string {
  const fallback =
    index === 0 ? "stage_permission" : `stage_permission_${index + 1}`;
  const cleaned = String(value ?? "")
    .trim()
    .replace(/[^A-Za-z0-9_-]/g, "_")
    .slice(0, 64);
  return cleaned || fallback;
}

/** Equivalent to CURRENT buildVideoFormSettingsJson with caller-owned labels. */
export function buildVideoFormSettingsJsonCore(
  formData: Pick<FormData, "get" | "getAll">,
  fallbacks: StagePermissionFallbacks,
): string {
  const ids = formData.getAll("custom_question_id");
  const enabled = formData.getAll("custom_question_enabled");
  const required = formData.getAll("custom_question_required");
  const labels = formData.getAll("custom_question_label");
  const descriptions = formData.getAll("custom_question_description");
  const placeholders = formData.getAll("custom_question_placeholder");
  const sentQuestionArray =
    String(formData.get("custom_questions_present") ?? "") === "1";

  if (sentQuestionArray || ids.length > 0) {
    const stagePermissions = ids.slice(0, MAX_STAGE_PERMISSION_QUESTIONS).map((id, index) => ({
      id: cleanQuestionId(id, index),
      enabled: boolFormValue(enabled[index]),
      required: boolFormValue(required[index]),
      label:
        String(labels[index] ?? "").trim().slice(0, 120) ||
        fallbacks.label,
      description:
        String(descriptions[index] ?? "").trim().slice(0, 1000) ||
        fallbacks.description,
      placeholder:
        String(placeholders[index] ?? "").trim().slice(0, 500) ||
        fallbacks.placeholder,
    }));
    return JSON.stringify({ stage_permissions: stagePermissions });
  }

  return JSON.stringify({ stage_permissions: [] });
}
