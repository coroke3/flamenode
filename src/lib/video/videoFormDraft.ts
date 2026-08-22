import type { VideoMemberInput } from "./memberInput";

export const VIDEO_FORM_DRAFT_SCHEMA_VERSION = "video-form-v1" as const;

export const VIDEO_FORM_DRAFT_FIELD_NAMES = [
  "title",
  "scheduled_time",
  "music",
  "music_reference_url",
  "credit",
  "intro_comment",
  "highlights",
  "production_story",
  "used_software",
  "closing_comment",
  "display_name",
  "profile_text",
  "icon_url",
  "youtube_channel_url",
  "other_social_links",
  "youtube_url",
  "part",
] as const;

export type VideoFormDraftFieldName = (typeof VIDEO_FORM_DRAFT_FIELD_NAMES)[number];
export type VideoFormDraftFieldValue = string | string[];

export interface VideoFormDraftAnswer {
  key: string;
  value: string | string[];
}

export interface VideoFormDraftStageAnswer {
  id: string;
  value: string;
}

export interface VideoFormDraftMetadata {
  baselineUpdatedAt?: number | null;
  iconUploadSaved?: boolean;
}

export interface VideoFormDraftV1 {
  schemaVersion: typeof VIDEO_FORM_DRAFT_SCHEMA_VERSION;
  fields: Partial<Record<VideoFormDraftFieldName, VideoFormDraftFieldValue>>;
  customAnswers: VideoFormDraftAnswer[];
  stageAnswers: VideoFormDraftStageAnswer[];
  members: VideoMemberInput[];
  selectedEventIds: string[];
  selectedPart: string;
  isCollab: boolean;
  currentStep: number;
  maxReachedStep: number;
  metadata: VideoFormDraftMetadata;
}

export interface BuildVideoFormDraftInput {
  formData: FormData;
  customAnswers: Record<string, string | string[]>;
  stageAnswers: Record<string, string>;
  members: VideoMemberInput[];
  selectedEventIds: string[];
  selectedPart: string;
  isCollab: boolean;
  currentStep: number;
  maxReachedStep: number;
  baselineUpdatedAt?: number | null;
  iconUploadSaved?: boolean;
}

function appendValue(
  target: Record<string, VideoFormDraftFieldValue>,
  key: string,
  value: string,
): void {
  const previous = target[key];
  if (previous === undefined) {
    target[key] = value;
  } else if (Array.isArray(previous)) {
    target[key] = [...previous, value];
  } else {
    target[key] = [previous, value];
  }
}

function cleanMembers(members: VideoMemberInput[]): VideoMemberInput[] {
  return members.map((member) => ({
    name: String(member.name ?? "").slice(0, 200),
    x_user_id: String(member.x_user_id ?? "").slice(0, 100),
    role: String(member.role ?? "").slice(0, 200),
    comment: String(member.comment ?? "").slice(0, 2000),
    chapters: Array.isArray(member.chapters)
      ? member.chapters.slice(0, 100).map((chapter) => ({
          time: String(chapter.time ?? "").slice(0, 32),
          label: String(chapter.label ?? "").slice(0, 200),
          note: String(chapter.note ?? "").slice(0, 1000),
        }))
      : [],
  }));
}

function cleanAnswerValue(value: unknown): string | string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item ?? "").slice(0, 2000)).slice(0, 20);
  }
  return String(value ?? "").slice(0, 2000);
}

export function buildVideoFormDraft(
  input: BuildVideoFormDraftInput,
): VideoFormDraftV1 {
  const fields: Partial<Record<VideoFormDraftFieldName, VideoFormDraftFieldValue>> = {};
  for (const name of VIDEO_FORM_DRAFT_FIELD_NAMES) {
    for (const raw of input.formData.getAll(name)) {
      if (typeof raw === "string") appendValue(fields, name, raw.slice(0, 10_000));
    }
  }

  return {
    schemaVersion: VIDEO_FORM_DRAFT_SCHEMA_VERSION,
    fields,
    customAnswers: Object.entries(input.customAnswers)
      .map(([key, value]) => ({ key: key.slice(0, 300), value: cleanAnswerValue(value) }))
      .filter(({ key }) => key.length > 0),
    stageAnswers: Object.entries(input.stageAnswers)
      .map(([id, value]) => ({ id: id.slice(0, 200), value: String(value ?? "").slice(0, 2000) }))
      .filter(({ id }) => id.length > 0),
    members: cleanMembers(input.members),
    selectedEventIds: input.selectedEventIds.map((id) => String(id).slice(0, 128)).filter(Boolean),
    selectedPart: String(input.selectedPart ?? "").slice(0, 200),
    isCollab: Boolean(input.isCollab),
    currentStep: Math.max(0, Math.floor(input.currentStep)),
    maxReachedStep: Math.max(0, Math.floor(input.maxReachedStep)),
    metadata: {
      baselineUpdatedAt: input.baselineUpdatedAt ?? null,
      iconUploadSaved: Boolean(input.iconUploadSaved),
    },
  };
}

export function videoFormDraftToFields(
  draft: VideoFormDraftV1,
): Record<string, VideoFormDraftFieldValue> {
  return { ...draft.fields };
}

export function videoFormDraftAnswersToRecord(
  answers: VideoFormDraftAnswer[],
): Record<string, string | string[]> {
  return Object.fromEntries(answers.map((answer) => [answer.key, answer.value]));
}

export function videoFormDraftStageAnswersToRecord(
  answers: VideoFormDraftStageAnswer[],
): Record<string, string> {
  return Object.fromEntries(answers.map((answer) => [answer.id, answer.value]));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

/**
 * Reads both the new typed envelope and the earlier FormData-map draft so an
 * existing user draft is not discarded during the format migration.
 */
export function parseVideoFormDraft(value: unknown): VideoFormDraftV1 | null {
  if (!isRecord(value)) return null;
  if (value.schemaVersion === VIDEO_FORM_DRAFT_SCHEMA_VERSION && isRecord(value.fields)) {
    const fields: Partial<Record<VideoFormDraftFieldName, VideoFormDraftFieldValue>> = {};
    for (const name of VIDEO_FORM_DRAFT_FIELD_NAMES) {
      const raw = value.fields[name];
      if (typeof raw === "string" || (Array.isArray(raw) && raw.every((item) => typeof item === "string"))) {
        fields[name] = raw as VideoFormDraftFieldValue;
      }
    }
    const answers = Array.isArray(value.customAnswers)
      ? value.customAnswers
          .filter((item): item is Record<string, unknown> => isRecord(item))
          .filter((item) => typeof item.key === "string")
          .map((item) => ({ key: item.key as string, value: cleanAnswerValue(item.value) }))
      : [];
    const stageAnswers = Array.isArray(value.stageAnswers)
      ? value.stageAnswers
          .filter((item): item is Record<string, unknown> => isRecord(item))
          .filter((item) => typeof item.id === "string")
          .map((item) => ({ id: item.id as string, value: String(item.value ?? "") }))
      : [];
    const members = Array.isArray(value.members) ? cleanMembers(value.members as VideoMemberInput[]) : [];
    const metadata = isRecord(value.metadata)
      ? {
          baselineUpdatedAt:
            typeof value.metadata.baselineUpdatedAt === "number" || value.metadata.baselineUpdatedAt === null
              ? value.metadata.baselineUpdatedAt
              : null,
          iconUploadSaved: value.metadata.iconUploadSaved === true,
        }
      : {};
    return {
      schemaVersion: VIDEO_FORM_DRAFT_SCHEMA_VERSION,
      fields,
      customAnswers: answers,
      stageAnswers,
      members,
      selectedEventIds: Array.isArray(value.selectedEventIds)
        ? value.selectedEventIds.filter((id): id is string => typeof id === "string")
        : [],
      selectedPart: typeof value.selectedPart === "string" ? value.selectedPart : "",
      isCollab: value.isCollab === true,
      currentStep: typeof value.currentStep === "number" ? Math.max(0, Math.floor(value.currentStep)) : 0,
      maxReachedStep: typeof value.maxReachedStep === "number" ? Math.max(0, Math.floor(value.maxReachedStep)) : 0,
      metadata,
    };
  }

  // Legacy FormData map migration.
  const fields: Partial<Record<VideoFormDraftFieldName, VideoFormDraftFieldValue>> = {};
  for (const name of VIDEO_FORM_DRAFT_FIELD_NAMES) {
    const raw = value[name];
    if (typeof raw === "string" || (Array.isArray(raw) && raw.every((item) => typeof item === "string"))) {
      fields[name] = raw as VideoFormDraftFieldValue;
    }
  }
  const customAnswers: VideoFormDraftAnswer[] = [];
  for (const [key, raw] of Object.entries(value)) {
    if (key.startsWith("custom_answer:")) {
      customAnswers.push({ key: key.slice("custom_answer:".length), value: cleanAnswerValue(raw) });
    }
  }
  const membersRaw = value.members_json;
  let members: VideoMemberInput[] = [];
  if (typeof membersRaw === "string") {
    try {
      const parsed = JSON.parse(membersRaw);
      if (Array.isArray(parsed)) members = cleanMembers(parsed as VideoMemberInput[]);
    } catch {
      // Ignore malformed legacy member data and retain server values.
    }
  }
  return {
    schemaVersion: VIDEO_FORM_DRAFT_SCHEMA_VERSION,
    fields,
    customAnswers,
    stageAnswers: [],
    members,
    selectedEventIds: Array.isArray(value.event_ids)
      ? value.event_ids.filter((id): id is string => typeof id === "string")
      : typeof value.event_ids === "string"
        ? [value.event_ids]
        : [],
    selectedPart: typeof value.part === "string" ? value.part : "",
    isCollab: value.is_collab === "true" || value.is_collab === true,
    currentStep: 0,
    maxReachedStep: 0,
    metadata: {},
  };
}

export function videoFormDraftIsStale(
  draft: VideoFormDraftV1,
  currentBaselineUpdatedAt: number | null | undefined,
): boolean {
  const saved = draft.metadata.baselineUpdatedAt ?? null;
  const current = currentBaselineUpdatedAt ?? null;
  return saved !== current && (saved !== null || current !== null);
}
