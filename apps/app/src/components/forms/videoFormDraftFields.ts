import { videoFormDraftAnswersToRecord, videoFormDraftStageAnswersToRecord, type VideoFormDraftV1 } from "../../lib/videoFormDraft.js";

// MIG-0714 part A: CURRENT VideoForm draft field permissions (UI only).
// Ported without changing field keys or defaults; server authorization remains independent.
/** section key が disabledSections に含まれているか確認する小関数。 */
export function isSectionDisabled(
  disabledSections: string[] | undefined,
  key: string,
): boolean {
  return Array.isArray(disabledSections) && disabledSections.includes(key);
}

export function isFieldDisabled(
  disabledFields: string[] | undefined,
  key: string,
): boolean {
  return Array.isArray(disabledFields) && disabledFields.includes(key);
}

export function canRestoreDraftField(
  name: string,
  disabledSections: string[] | undefined,
  disabledFields: string[] | undefined,
): boolean {
  const permissionByName: Record<string, { section?: string; field?: string }> = {
    display_name: { section: "submitter", field: "submitter.display_name" },
    profile_text: { section: "submitter", field: "submitter.profile_text" },
    icon_url: { section: "submitter", field: "submitter.icon_url" },
    youtube_channel_url: {
      section: "submitter",
      field: "submitter.youtube_channel_url",
    },
    other_social_links: {
      section: "submitter",
      field: "submitter.other_social_links",
    },
    title: { section: "video", field: "video.title" },
    scheduled_time: { section: "video", field: "video.scheduled_time" },
    music: { section: "video", field: "video.music" },
    music_reference_url: { section: "video", field: "video.music_reference_url" },
    credit: { section: "video", field: "video.credit" },
    youtube_url: { section: "video", field: "video.youtube_url" },
    part: { section: "video", field: "video.part" },
    intro_comment: { section: "descriptions", field: "descriptions.intro_comment" },
    highlights: { section: "descriptions", field: "descriptions.highlights" },
    production_story: {
      section: "descriptions",
      field: "descriptions.production_story",
    },
    used_software: { section: "descriptions", field: "descriptions.used_software" },
    closing_comment: { section: "descriptions", field: "descriptions.closing_comment" },
    event_ids: { field: "event_ids" },
    is_collab: { section: "members", field: "members.is_collab" },
    members: { section: "members", field: "members" },
    chapters: { section: "members", field: "chapters" },
    custom_answers: { section: "descriptions", field: "descriptions.custom_answers" },
    stage_permission: {
      section: "descriptions",
      field: "descriptions.stage_permission",
    },
  };
  const permission = permissionByName[name];
  if (!permission) return true;
  return !(
    (permission.section && isSectionDisabled(disabledSections, permission.section)) ||
    (permission.field && isFieldDisabled(disabledFields, permission.field))
  );
}

// Only pass fields produced by videoFormDraftToFields after parsing the draft.
// Controlled React values and draft authority remain the host's responsibility.
export function restoreVideoDraftControls(
  form: HTMLFormElement,
  fields: Record<string, string | string[]>,
  disabledSections: string[] | undefined,
  disabledFields: string[] | undefined,
): void {
  const { HTMLInputElement, HTMLTextAreaElement, HTMLSelectElement } =
    form.ownerDocument.defaultView ?? globalThis;
  const restored = new FormData();
  for (const [key, raw] of Object.entries(fields)) {
    for (const item of Array.isArray(raw) ? raw : [raw]) restored.append(key, item);
  }
  for (const element of Array.from(form.elements)) {
    if (
      !(
        element instanceof HTMLInputElement ||
        element instanceof HTMLTextAreaElement ||
        element instanceof HTMLSelectElement
      )
    ) continue;
    if (!element.name || !canRestoreDraftField(element.name, disabledSections, disabledFields)) continue;
    const values = restored.getAll(element.name).map(String);
    if (element instanceof HTMLInputElement && element.type === "checkbox") {
      element.checked = values.includes("1") || values.includes("true");
    } else if (element instanceof HTMLInputElement && element.type === "radio") {
      element.checked = values.includes(element.value);
    } else if (values.length > 0) {
      element.value = values[0] ?? "";
    }
  }
}

// A missing patch key means retain the current controlled value, not clear it.
// The host still parses the draft, checks authority, restores native controls,
// reads descriptions from the form, and applies the patch in the same callback.
export function buildVideoDraftControlledState(draft: VideoFormDraftV1, input: {
  disabledSections?: string[];
  disabledFields?: string[];
  mode: "free" | "slot" | "edit";
  canEditEvents: boolean;
  eventOptions: readonly { id: string }[];
  initialEventIdsForDraftSync: string[];
  currentMembers: VideoFormDraftV1["members"];
  wizardStepCount: number;
}) {
  const canRestore = (name: string) => canRestoreDraftField(name, input.disabledSections, input.disabledFields);
  const textFields = ["youtube_url", "title", "display_name", "profile_text", "icon_url", "youtube_channel_url", "other_social_links"] as const;
  const text: Partial<Record<(typeof textFields)[number], string>> = {};
  for (const name of textFields) {
    if (!canRestore(name)) continue;
    const value = draft.fields[name];
    text[name] = Array.isArray(value) ? (value[0] ?? "") : value ?? "";
  }
  let selectedEventIds: string[] | undefined;
  if (canRestore("event_ids")) {
    const availableEventIds = new Set(input.eventOptions.map((event) => event.id));
    selectedEventIds = input.mode === "slot" || !input.canEditEvents
      ? input.initialEventIdsForDraftSync
      : draft.selectedEventIds.filter((id) => availableEventIds.has(id));
  }
  let members: VideoFormDraftV1["members"] | undefined;
  if (canRestore("members") && (draft.members.length > 0 || draft.isCollab)) {
    members = draft.members.map((member, index) => ({
      ...member,
      chapters: canRestore("chapters") ? member.chapters : input.currentMembers[index]?.chapters ?? [],
    }));
  }
  return {
    text,
    ...(selectedEventIds !== undefined ? { selectedEventIds } : {}),
    ...(canRestore("part") ? { selectedPart: draft.selectedPart } : {}),
    ...(canRestore("is_collab") ? { isCollab: draft.isCollab } : {}),
    ...(members !== undefined ? { members } : {}),
    ...(canRestore("custom_answers") ? { customAnswers: videoFormDraftAnswersToRecord(draft.customAnswers) } : {}),
    ...(canRestore("stage_permission") ? { stageAnswers: videoFormDraftStageAnswersToRecord(draft.stageAnswers) } : {}),
    currentStep: Math.min(draft.currentStep, input.wizardStepCount - 1),
    maxReachedStep: Math.min(Math.max(draft.maxReachedStep, draft.currentStep), input.wizardStepCount - 1),
  };
}
