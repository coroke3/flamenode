// MIG-0721 U01b-1: exact CURRENT EventForm draft serialization, without Next.js dependencies.
// Source: src/components/admin/EventForm.tsx (formDataToDraftValue / draftValueToFormData).
// No UI consumer is mounted until U01b EventForm is ported.
type EventFormDraftValue = Record<string, string | string[]>;

function formDataToDraftValue(formData: FormData): EventFormDraftValue {
  const value: EventFormDraftValue = {};
  for (const [key, raw] of formData.entries()) {
    if (typeof raw !== "string") continue;
    const current = value[key];
    value[key] = current === undefined
      ? raw
      : Array.isArray(current)
        ? [...current, raw]
        : [current, raw];
  }
  return value;
}

function draftValueToFormData(value: EventFormDraftValue): FormData {
  const formData = new FormData();
  for (const [key, raw] of Object.entries(value)) {
    for (const item of Array.isArray(raw) ? raw : [raw]) {
      formData.append(key, item);
    }
  }
  return formData;
}

export { formDataToDraftValue, draftValueToFormData };
export type { EventFormDraftValue };
