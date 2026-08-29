"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/ui/Icon";
import styles from "./EventForm.module.css";
import { SaveSuccessNotice } from "@/components/ui/SaveSuccessNotice";
import { createEvent, updateEvent } from "@/lib/actions/event-admin";
import { PermissionKeysField } from "@/components/admin/PermissionKeysField";
import { YoutubeDescriptionTemplateEditor } from "@/components/admin/YoutubeDescriptionTemplateEditor";
import {
  EventSettingsPreview,
  type EventSettingsPreviewValue,
} from "@/components/admin/EventSettingsPreview";
import {
  DEFAULT_STAGE_PERMISSION_FIELD,
  filterImplicitEmptyStagePermissionQuestions,
  getStagePermissionQuestions,
  parseVideoFormSettings,
  type StagePermissionFieldSettings,
} from "@/lib/video/formSettings";
import { EventCustomQuestionsEditor } from "@/components/admin/EventCustomQuestionsEditor";
import {
  MAX_GENERAL_CUSTOM_QUESTIONS,
  MAX_STAGE_PERMISSION_QUESTIONS,
} from "@/lib/event/eventLimits";
import {
  generalCustomQuestionsPresent,
  readGeneralCustomQuestionsFromFormData,
  type EventGeneralCustomQuestionDraft,
} from "@/lib/event/generalCustomQuestionDraft";
import {
  normalizeOptionList,
  questionTypeNeedsOptions,
} from "@/lib/video/customQuestions";
import { formatJstDatetimeLocal } from "@/lib/utils/dateInput";
import {
  normalizeEventVisibility,
  type EventVisibilityStatus,
} from "@/lib/utils/eventStatus";
import {
  buildFormDraftStorageKey,
  type DraftMetadata,
  useFormDraft,
} from "@/lib/interactions/useFormDraft";
import { useUnsavedChangesGuard } from "@/lib/interactions/useUnsavedChangesGuard";
import {
  MAX_SLOTS_PER_VIDEO,
  MIN_SLOTS_PER_VIDEO,
} from "@/lib/slots/limits";
import {
  OPTIONAL_REQUIRED_VIDEO_FIELDS,
  parseRequiredVideoFields,
  REQUIRED_VIDEO_FIELD_GROUPS,
  REQUIRED_VIDEO_FIELD_LABELS,
  serializeRequiredVideoFields,
  type OptionalRequiredVideoField,
} from "@/lib/video/requiredVideoFields";

export interface EventFormInitial {
  id?: string;
  updated_at?: number | null;
  title?: string;
  event_type?: "event" | "collabo" | "type" | "other";
  explanation?: string | null;
  youtube_description_template?: string | null;
  required_video_fields_json?: string | null;
  icon_url?: string | null;
  img_url?: string | null;
  accent_color?: string | null;
  start_time?: number | null;
  end_time?: number | null;
  entry_start_time?: number | null;
  entry_end_time?: number | null;
  visibility_status?: string | null;
  allow_user_video_event_links?: number;
  allow_unslotted_posts?: number;
  allow_user_video_edits?: number;
  user_video_edit_permission_keys_json?: string | null;
  video_form_settings_json?: string | null;
  max_slots_per_video?: number;
  max_slot_reservation_groups_per_xid?: number;
  slot_interval_minutes?: number | null;
  slot_type?: "time" | "count";
  slot_visibility_mode?: "public_name" | "anonymous" | "hidden";
  slot_part_gap_minutes?: number | null;
  parts_json?: string | null;
  editable_fields?: string | null;
  review_settings?: string | null;
  custom_questions?: EventGeneralCustomQuestionDraft[];
}

interface EventFormProps {
  mode: "create" | "edit";
  initial?: EventFormInitial;
  templateId?: string;
  editableSections?: {
    basic: boolean;
    publish: boolean;
    questions: boolean;
    slots: boolean;
  };
  /** Auth user id used to isolate local drafts between accounts. */
  draftAuthUserId?: string;
  variant?: "admin" | "manage";
}

const MANAGE_SECTION_NAV = [
  { id: "section-basic", label: "基本情報" },
  { id: "section-publish", label: "公開・受付" },
  { id: "section-questions", label: "投稿・権限" },
  { id: "section-required", label: "必須項目" },
  { id: "section-slots", label: "枠" },
] as const;

type EventFormDraftValue = Record<string, string | string[]>;
const EMPTY_EVENT_FORM_INITIAL: EventFormInitial = {};

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

function partsJsonToText(value: string | null | undefined): string {
  if (!value) return "";
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed
          .filter((item): item is string => typeof item === "string")
          .map((item) => item.trim())
          .filter(Boolean)
          .join("\n")
      : "";
  } catch {
    return "";
  }
}

function resolveInitialVisibility(
  initial: EventFormInitial,
): EventVisibilityStatus {
  return normalizeEventVisibility(initial.visibility_status);
}

function textValue(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function boolValue(value: FormDataEntryValue | undefined): boolean {
  return String(value ?? "") === "1";
}

function buildVideoFormSettingsFromQuestions(
  questions: readonly StagePermissionFieldSettings[],
): string {
  return JSON.stringify({
    stage_permissions: questions.map((question) => ({
      id: question.id,
      enabled: question.enabled,
      required: question.required,
      label: question.label.trim() || DEFAULT_STAGE_PERMISSION_FIELD.label,
      description:
        question.description.trim() || DEFAULT_STAGE_PERMISSION_FIELD.description,
      placeholder:
        question.placeholder.trim() || DEFAULT_STAGE_PERMISSION_FIELD.placeholder,
    })),
  });
}

function readQuestions(formData: FormData): StagePermissionFieldSettings[] {
  const ids = formData.getAll("custom_question_id");
  const enabled = formData.getAll("custom_question_enabled");
  const required = formData.getAll("custom_question_required");
  const labels = formData.getAll("custom_question_label");
  const descriptions = formData.getAll("custom_question_description");
  const placeholders = formData.getAll("custom_question_placeholder");
  return ids
    .map((rawId, index): StagePermissionFieldSettings | null => {
      const id = String(rawId ?? "").trim();
      if (!id) return null;
      return {
        id,
        enabled: boolValue(enabled[index]),
        required: boolValue(required[index]),
        label:
          String(labels[index] ?? "").trim() ||
          DEFAULT_STAGE_PERMISSION_FIELD.label,
        description:
          String(descriptions[index] ?? "").trim() ||
          DEFAULT_STAGE_PERMISSION_FIELD.description,
        placeholder:
          String(placeholders[index] ?? "").trim() ||
          DEFAULT_STAGE_PERMISSION_FIELD.placeholder,
      };
    })
    .filter((question): question is StagePermissionFieldSettings => question !== null);
}

function initialPreview(initial: EventFormInitial): EventSettingsPreviewValue {
  return {
    title: initial.title,
    event_type: initial.event_type ?? "event",
    explanation: initial.explanation,
    icon_url: initial.icon_url,
    img_url: initial.img_url,
    accent_color: initial.accent_color,
    start_time: initial.start_time,
    end_time: initial.end_time,
    entry_start_time: initial.entry_start_time,
    entry_end_time: initial.entry_end_time,
    visibility_status: resolveInitialVisibility(initial),
    allow_user_video_event_links: initial.allow_user_video_event_links ?? 0,
    allow_unslotted_posts: initial.allow_unslotted_posts ?? 0,
    allow_user_video_edits: initial.allow_user_video_edits ?? 0,
    user_video_edit_permission_keys_json:
      initial.user_video_edit_permission_keys_json,
    video_form_settings_json: initial.video_form_settings_json,
    max_slots_per_video: initial.max_slots_per_video ?? 1,
    max_slot_reservation_groups_per_xid:
      initial.max_slot_reservation_groups_per_xid ?? 0,
    slot_interval_minutes: initial.slot_interval_minutes ?? null,
    slot_type: initial.slot_type ?? "time",
    slot_visibility_mode: initial.slot_visibility_mode ?? "public_name",
    slot_part_gap_minutes: initial.slot_part_gap_minutes ?? 15,
    parts_text: partsJsonToText(initial.parts_json),
    parts_json: initial.parts_json,
    editable_fields: initial.editable_fields,
    review_settings: initial.review_settings,
    required_video_fields_json: initial.required_video_fields_json ?? null,
    general_custom_questions: initial.custom_questions ?? [],
  };
}

function formPreview(
  formData: FormData,
  initial: EventFormInitial,
): EventSettingsPreviewValue {
  const questions = readQuestions(formData);
  return {
    title: textValue(formData, "title"),
    event_type: textValue(formData, "event_type") || "event",
    explanation: textValue(formData, "explanation"),
    icon_url: textValue(formData, "icon_url"),
    img_url: textValue(formData, "img_url"),
    accent_color: textValue(formData, "accent_color"),
    start_time: textValue(formData, "start_time"),
    end_time: textValue(formData, "end_time"),
    entry_start_time: textValue(formData, "entry_start_time"),
    entry_end_time: textValue(formData, "entry_end_time"),
    visibility_status: textValue(formData, "visibility_status") || "private",
    allow_user_video_event_links:
      textValue(formData, "allow_user_video_event_links") || "0",
    allow_unslotted_posts: textValue(formData, "allow_unslotted_posts") || "0",
    allow_user_video_edits:
      textValue(formData, "allow_user_video_edits") || "0",
    user_video_edit_permission_keys_json: textValue(
      formData,
      "user_video_edit_permission_keys_json",
    ),
    video_form_settings_json: buildVideoFormSettingsFromQuestions(questions),
    max_slots_per_video: textValue(formData, "max_slots_per_video") || "1",
    max_slot_reservation_groups_per_xid:
      textValue(formData, "max_slot_reservation_groups_per_xid") || "0",
    slot_interval_minutes: textValue(formData, "slot_interval_minutes") || null,
    slot_type: textValue(formData, "slot_type") || "time",
    slot_visibility_mode:
      textValue(formData, "slot_visibility_mode") || "public_name",
    slot_part_gap_minutes:
      textValue(formData, "slot_part_gap_minutes") || "15",
    parts_text: textValue(formData, "parts_text"),
    editable_fields: initial.editable_fields,
    review_settings: initial.review_settings,
    required_video_fields_json:
      textValue(formData, "required_video_fields_json") || null,
    general_custom_questions: readGeneralCustomQuestionsFromFormData(formData),
  };
}

function gatedInputProps(
  allowed: boolean,
): React.InputHTMLAttributes<HTMLInputElement> {
  return allowed
    ? {}
    : { readOnly: true, tabIndex: -1, "aria-disabled": true };
}

function gatedTextareaProps(
  allowed: boolean,
): React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  return allowed
    ? {}
    : { readOnly: true, tabIndex: -1, "aria-disabled": true };
}

function GatedSelect({
  allowed,
  name,
  defaultValue,
  children,
}: {
  allowed: boolean;
  name: string;
  defaultValue: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <>
      {!allowed ? <input type="hidden" name={name} value={defaultValue} /> : null}
      <select
        name={allowed ? name : undefined}
        defaultValue={defaultValue}
        className="fn-select"
        disabled={!allowed}
        aria-disabled={!allowed}
      >
        {children}
      </select>
    </>
  );
}

function FormSection({
  title,
  allowed,
  sectionId,
  children,
}: {
  title: string;
  allowed: boolean;
  sectionId?: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <fieldset
      id={sectionId}
      className={`${styles.formSection} ${allowed ? "" : styles.formSectionDisabled}`}
    >
      <legend className={styles.formSectionLegend}>{title}</legend>
      {!allowed ? (
        <p className={styles.formSectionDenied} role="status">
          変更権限がありません
        </p>
      ) : null}
      {children}
    </fieldset>
  );
}

export function EventForm({
  mode,
  initial: initialProp,
  templateId,
  editableSections,
  draftAuthUserId,
  variant = "admin",
}: EventFormProps): React.ReactElement {
  const isManage = variant === "manage";
  const initial = initialProp ?? EMPTY_EVENT_FORM_INITIAL;
  const router = useRouter();
  const formRef = React.useRef<HTMLFormElement>(null);
  const submitInFlightRef = React.useRef(false);
  const [busy, startTransition] = React.useTransition();
  const [dirty, setDirty] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [success, setSuccess] = React.useState<{
    message: string;
    pendingPublicReflection?: boolean;
  } | null>(null);
  const [youtubeDescriptionTemplate, setYoutubeDescriptionTemplate] =
    React.useState(initial.youtube_description_template ?? "");
  const [preview, setPreview] = React.useState<EventSettingsPreviewValue>(() =>
    initialPreview(initial),
  );
  const [questions, setQuestions] = React.useState<StagePermissionFieldSettings[]>(
    () => {
      const current = getStagePermissionQuestions(
        parseVideoFormSettings(initial.video_form_settings_json),
      );
      return filterImplicitEmptyStagePermissionQuestions(current);
    },
  );
  const [requiredOptionalFields, setRequiredOptionalFields] = React.useState<
    OptionalRequiredVideoField[]
  >(() => parseRequiredVideoFields(initial.required_video_fields_json));
  const requiredVideoFieldsJson = React.useMemo(
    () => serializeRequiredVideoFields(requiredOptionalFields) ?? "[]",
    [requiredOptionalFields],
  );
  const [generalQuestions, setGeneralQuestions] = React.useState<
    EventGeneralCustomQuestionDraft[]
  >(() => initial.custom_questions ?? []);
  const generalQuestionCap = Math.max(
    MAX_GENERAL_CUSTOM_QUESTIONS,
    initial.custom_questions?.length ?? 0,
  );

  const canBasic = mode === "create" || editableSections?.basic !== false;
  const canPublish = mode === "create" || editableSections?.publish !== false;
  const canQuestions = mode === "create" || editableSections?.questions !== false;
  const canSlots = mode === "create" || editableSections?.slots !== false;

  const draftStorageKey = draftAuthUserId?.trim()
    ? buildFormDraftStorageKey({
        authUserId: draftAuthUserId.trim(),
        formId: `event-${mode}-${initial.id ?? templateId ?? "new"}`,
        schemaVersion: "event-form-v3",
      })
    : "";
  const draftMetadata = React.useMemo<DraftMetadata>(
    () => ({
      schemaVersion: "event-form-v3",
      authUserId: draftAuthUserId?.trim() ?? null,
      mode,
      eventId: initial.id ?? null,
      baseRevision: mode === "edit" ? initial.updated_at ?? null : null,
    }),
    [draftAuthUserId, initial.id, initial.updated_at, mode],
  );
  const handleStaleDraft = React.useCallback(() => {
    setError(
      "以前の編集内容は現在のイベント状態と一致しないため自動復元しませんでした。必要なら内容を確認してから手動で反映してください。",
    );
  }, []);
  const restoreDraft = React.useCallback((draft: EventFormDraftValue) => {
    const form = formRef.current;
    if (!form) return;
    const restored = draftValueToFormData(draft);
    const pendingValues = new Map<string, string[]>();
    const takeValues = (fieldName: string): string[] => {
      let values = pendingValues.get(fieldName);
      if (!values) {
        values = restored.getAll(fieldName).map(String);
        pendingValues.set(fieldName, values);
      }
      return values;
    };
    for (const element of Array.from(form.elements)) {
      if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement)) continue;
      const name = element.name;
      if (!name) continue;
      const values = takeValues(name);
      if (element instanceof HTMLInputElement && element.type === "checkbox") {
        element.checked = values.includes("1");
      } else if (values.length > 0) {
        element.value = values.shift() ?? "";
        if (element.name === "youtube_description_template") {
          element.dispatchEvent(new Event("input", { bubbles: true }));
        }
      }
    }
    setYoutubeDescriptionTemplate(
      textValue(restored, "youtube_description_template"),
    );
    setQuestions(
      filterImplicitEmptyStagePermissionQuestions(readQuestions(restored)),
    );
    const restoredRequiredJson = textValue(restored, "required_video_fields_json");
    if (String(restored.get("required_video_fields_present") ?? "") === "1") {
      setRequiredOptionalFields(parseRequiredVideoFields(restoredRequiredJson));
    }
    if (generalCustomQuestionsPresent(restored)) {
      setGeneralQuestions(readGeneralCustomQuestionsFromFormData(restored));
    }
    setPreview(formPreview(restored, initial));
    setDirty(true);
  }, [initial]);
  const draftSnapshot = React.useMemo(() => {
    void preview;
    void questions;
    void generalQuestions;
    void youtubeDescriptionTemplate;
    void requiredOptionalFields;
    return formRef.current
      ? formDataToDraftValue(new FormData(formRef.current))
      : {};
  }, [
    preview,
    questions,
    generalQuestions,
    requiredOptionalFields,
    youtubeDescriptionTemplate,
  ]);
  const { clearDraft } = useFormDraft<EventFormDraftValue>({
    storageKey: draftStorageKey || "fn:draft:disabled:event-form-v1",
    value: draftSnapshot,
    enabled: Boolean(draftAuthUserId?.trim()),
    metadata: draftMetadata,
    onRestore: restoreDraft,
    onStale: handleStaleDraft,
  });
  useUnsavedChangesGuard({ dirty: dirty && !busy });

  React.useEffect(() => {
    setPreview((current) => ({
      ...current,
      video_form_settings_json: buildVideoFormSettingsFromQuestions(questions),
    }));
  }, [questions]);

  React.useEffect(() => {
    setPreview((current) => ({
      ...current,
      required_video_fields_json:
        requiredVideoFieldsJson === "[]" ? null : requiredVideoFieldsJson,
    }));
  }, [requiredVideoFieldsJson]);

  const toggleRequiredOptionalField = (field: OptionalRequiredVideoField) => {
    setRequiredOptionalFields((current) => {
      const next = new Set(current);
      if (next.has(field)) next.delete(field);
      else next.add(field);
      return OPTIONAL_REQUIRED_VIDEO_FIELDS.filter((item) => next.has(item));
    });
    setDirty(true);
  };
  React.useEffect(() => {
    setPreview((current) => ({
      ...current,
      general_custom_questions: generalQuestions,
    }));
  }, [generalQuestions]);

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy || submitInFlightRef.current) return;
    if (canQuestions) {
      const invalidChoice = generalQuestions.find(
        (question) =>
          questionTypeNeedsOptions(question.type) &&
          normalizeOptionList(question.options).length === 0,
      );
      if (invalidChoice) {
        setError(
          `${invalidChoice.label.trim() || "カスタム質問"}の選択肢を1件以上入力してください。`,
        );
        setSuccess(null);
        return;
      }
    }
    submitInFlightRef.current = true;
    setError(null);
    setSuccess(null);
    const formData = new FormData(event.currentTarget);
    startTransition(async () => {
      try {
        const result =
        mode === "create" ? await createEvent(formData) : await updateEvent(formData);
      if (!result.ok) {
        setError(result.message ?? "保存に失敗しました。");
        return;
      }
      clearDraft();
      setDirty(false);
      setSuccess({
        message: "保存しました。",
        pendingPublicReflection: result.pendingPublicReflection,
      });
      if (mode === "create" && result.eventId) {
        router.push(`/manage/events/${encodeURIComponent(result.eventId)}/edit`);
      } else {
        router.refresh();
        }
      } catch (submitError) {
        console.error("[EventForm] submit failed", submitError);
        setError("保存中に予期しないエラーが発生しました。入力内容を保持したまま再試行してください。");
      } finally {
        submitInFlightRef.current = false;
      }
    });
  };

  const submitLabel =
    busy ? "保存中…" : mode === "create" ? "イベントを作成" : "変更を保存";

  return (
    <form
      ref={formRef}
      onSubmit={submit}
      onChange={(event) =>
        (() => {
          setDirty(true);
          setPreview(formPreview(new FormData(event.currentTarget), initial));
        })()
      }
      className={`${styles.eventForm}${isManage || mode === "create" ? ` ${styles.eventFormManage}` : ""}`}
    >
      {isManage || mode === "create" ? (
        <nav className={styles.manageSectionNav} aria-label="設定セクション">
          {MANAGE_SECTION_NAV.map((item) => (
            <a key={item.id} href={`#${item.id}`}>
              {item.label}
            </a>
          ))}
        </nav>
      ) : null}
      {mode === "edit" && initial.id ? (
        <input type="hidden" name="id" value={initial.id} />
      ) : null}
      {mode === "edit" && initial.id && initial.updated_at != null ? (
        <input type="hidden" name="revision" value={initial.updated_at} />
      ) : null}
      {mode === "create" && templateId ? (
        <input type="hidden" name="template_id" value={templateId} />
      ) : null}

      <FormSection title="基本情報" allowed={canBasic} sectionId="section-basic">
        <div className={styles.formGrid2}>
          <div>
            <label className="fn-label">ID</label>
            <input
              name="id"
              defaultValue={initial.id ?? ""}
              className="fn-input"
              readOnly={mode === "edit"}
              pattern="[A-Za-z0-9_-]*"
              maxLength={64}
              placeholder="空欄で自動生成"
            />
          </div>
          <div>
            <label className="fn-label">種別</label>
            <GatedSelect
              allowed={canBasic}
              name="event_type"
              defaultValue={initial.event_type ?? "event"}
            >
              <option value="event">通常イベント</option>
              <option value="collabo">コラボ</option>
              <option value="type">タイプ別</option>
              <option value="other">その他</option>
            </GatedSelect>
          </div>
        </div>
        <div>
          <label className="fn-label">タイトル *</label>
          <input
            name="title"
            defaultValue={initial.title ?? ""}
            className="fn-input"
            required
            maxLength={200}
            {...gatedInputProps(canBasic)}
          />
        </div>
        <div>
          <label className="fn-label">説明</label>
          <textarea
            name="explanation"
            defaultValue={initial.explanation ?? ""}
            className="fn-input"
            rows={4}
            maxLength={4000}
            {...gatedTextareaProps(canBasic)}
          />
        </div>
        <YoutubeDescriptionTemplateEditor
          value={youtubeDescriptionTemplate}
          onChange={(next) => {
            setYoutubeDescriptionTemplate(next);
            setDirty(true);
          }}
          eventTitle={preview.title}
          disabled={!canBasic}
        />
        <div className={styles.formGrid2}>
          <div>
            <label className="fn-label">アイコンURL</label>
            <input
              name="icon_url"
              type="url"
              defaultValue={initial.icon_url ?? ""}
              className="fn-input"
              {...gatedInputProps(canBasic)}
            />
          </div>
          <div>
            <label className="fn-label">バナー画像URL</label>
            <input
              name="img_url"
              type="url"
              defaultValue={initial.img_url ?? ""}
              className="fn-input"
              {...gatedInputProps(canBasic)}
            />
          </div>
          <div>
            <label className="fn-label">アクセントカラー</label>
            <input
              name="accent_color"
              defaultValue={initial.accent_color ?? ""}
              className="fn-input"
              maxLength={20}
              placeholder="#ffd400"
              {...gatedInputProps(canBasic)}
            />
          </div>
        </div>
        <div className={styles.formGrid2}>
          <div>
            <label className="fn-label">開始日時</label>
            <input
              name="start_time"
              type="datetime-local"
              defaultValue={formatJstDatetimeLocal(initial.start_time)}
              className="fn-input"
              {...gatedInputProps(canBasic)}
            />
          </div>
          <div>
            <label className="fn-label">終了日時</label>
            <input
              name="end_time"
              type="datetime-local"
              defaultValue={formatJstDatetimeLocal(initial.end_time)}
              className="fn-input"
              {...gatedInputProps(canBasic)}
            />
          </div>
        </div>
      </FormSection>

      <FormSection title="公開・受付" allowed={canPublish} sectionId="section-publish">
        <div className={styles.formGrid2}>
          <div>
            <label className="fn-label">募集開始日時</label>
            <input
              name="entry_start_time"
              type="datetime-local"
              defaultValue={formatJstDatetimeLocal(initial.entry_start_time)}
              className="fn-input"
              {...gatedInputProps(canPublish)}
            />
          </div>
          <div>
            <label className="fn-label">募集終了日時</label>
            <input
              name="entry_end_time"
              type="datetime-local"
              defaultValue={formatJstDatetimeLocal(initial.entry_end_time)}
              className="fn-input"
              {...gatedInputProps(canPublish)}
            />
          </div>
          <div>
            <label className="fn-label">公開状態</label>
            <GatedSelect
              allowed={canPublish}
              name="visibility_status"
              defaultValue={resolveInitialVisibility(initial)}
            >
              <option value="private">非公開</option>
              <option value="public">公開</option>
            </GatedSelect>
          </div>
          <div>
            <label className="fn-label">一般ユーザーの追加紐付け</label>
            <GatedSelect
              allowed={canPublish}
              name="allow_user_video_event_links"
              defaultValue={String(initial.allow_user_video_event_links ?? 0)}
            >
              <option value="0">運営承認制</option>
              <option value="1">許可</option>
            </GatedSelect>
          </div>
          <div>
            <label className="fn-label">枠なし投稿の紐付け</label>
            <GatedSelect
              allowed={canPublish}
              name="allow_unslotted_posts"
              defaultValue={String(initial.allow_unslotted_posts ?? 0)}
            >
              <option value="0">不許可</option>
              <option value="1">許可</option>
            </GatedSelect>
          </div>
        </div>
      </FormSection>

      <FormSection title="投稿・権限" allowed={canQuestions} sectionId="section-questions">
        <div className={styles.formGrid2}>
          <div>
            <label className="fn-label">所有者の一般作品権限</label>
            <GatedSelect
              allowed={canQuestions}
              name="allow_user_video_edits"
              defaultValue={String(initial.allow_user_video_edits ?? 0)}
            >
              <option value="0">既定（イベント個別設定なし）</option>
              <option value="1">個別指定</option>
            </GatedSelect>
          </div>
        </div>
        <p className="fn-text-muted-sm" style={{ marginBottom: 12 }}>
          作品の作者・編集権限付き合作メンバーが通常モードで編集できる項目を指定します。
          非所有者への編集開放ではありません。
        </p>
        <PermissionKeysField
          name="user_video_edit_permission_keys_json"
          defaultValue={initial.user_video_edit_permission_keys_json}
          allowUserVideoEdits={initial.allow_user_video_edits ?? 0}
          disabled={!canQuestions}
        />
        <input type="hidden" name="custom_questions_present" value="1" />
        <h3 className={styles.customQuestionsHeading}>ステージ・権利確認</h3>
        <p className="fn-hint">
          ステージ・素材・権利まわりの確認は長文入力です。チェックボックスや選択ボタンは下のカスタム質問で指定します。
        </p>
        <div style={{ display: "grid", gap: 10 }}>
          {questions.map((question, index) => (
            <article
              key={question.id}
              className="fn-card"
              style={{ padding: 12, display: "grid", gap: 10 }}
            >
              <input type="hidden" name="custom_question_id" value={question.id} />
              <input type="hidden" name="custom_question_enabled" value={question.enabled ? "1" : "0"} />
              <input type="hidden" name="custom_question_required" value={question.required ? "1" : "0"} />
              <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <strong>質問 {index + 1}</strong>
                <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                  <label>
                    <input
                      type="checkbox"
                      checked={question.enabled}
                      disabled={!canQuestions}
                      onChange={(event) => setQuestions((current) => current.map((item) => item.id === question.id ? { ...item, enabled: event.target.checked } : item))}
                    />{" "}表示
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={question.required}
                      disabled={!canQuestions}
                      onChange={(event) => setQuestions((current) => current.map((item) => item.id === question.id ? { ...item, required: event.target.checked } : item))}
                    />{" "}必須
                  </label>
                  <button
                    type="button"
                    className="fn-btn fn-btn-ghost fn-btn-sm"
                    disabled={!canQuestions}
                    onClick={() => {
                      setDirty(true);
                      setQuestions((current) => current.filter((item) => item.id !== question.id));
                    }}
                  >
                    <Icon name="trash" size={12} aria-hidden /> 削除
                  </button>
                </div>
              </header>
              {(["label", "description", "placeholder"] as const).map((key) => (
                <div key={key}>
                  <label className="fn-label">
                    {key === "label" ? "質問名" : key === "description" ? "補足文" : "入力例"}
                  </label>
                  {key === "description" ? (
                    <textarea
                      name="custom_question_description"
                      value={question.description}
                      readOnly={!canQuestions}
                      className="fn-input"
                      onChange={(event) => setQuestions((current) => current.map((item) => item.id === question.id ? { ...item, description: event.target.value } : item))}
                    />
                  ) : (
                    <input
                      name={key === "label" ? "custom_question_label" : "custom_question_placeholder"}
                      value={question[key]}
                      readOnly={!canQuestions}
                      className="fn-input"
                      onChange={(event) => setQuestions((current) => current.map((item) => item.id === question.id ? { ...item, [key]: event.target.value } : item))}
                    />
                  )}
                </div>
              ))}
            </article>
          ))}
        </div>
        <button
          type="button"
          className="fn-btn fn-btn-ghost"
          disabled={!canQuestions || questions.length >= MAX_STAGE_PERMISSION_QUESTIONS}
          onClick={() => {
            if (questions.length >= MAX_STAGE_PERMISSION_QUESTIONS) return;
            setDirty(true);
            setQuestions((current) => [
              ...current,
              {
                ...DEFAULT_STAGE_PERMISSION_FIELD,
                id: `stage_permission_${Date.now().toString(36)}`,
                enabled: true,
                required: false,
                label: `追加質問 ${current.length + 1}`,
                description: "",
                placeholder: "",
              },
            ]);
          }}
        >
          <Icon name="plus" size={13} aria-hidden /> 質問を追加
        </button>
        {questions.length >= MAX_STAGE_PERMISSION_QUESTIONS ? (
          <p className="fn-hint">ステージ・権利確認質問は最大{MAX_STAGE_PERMISSION_QUESTIONS}件です</p>
        ) : null}
        <h3 className={styles.customQuestionsHeading}>カスタム質問</h3>
        <EventCustomQuestionsEditor
          questions={generalQuestions}
          disabled={!canQuestions}
          maxQuestions={generalQuestionCap}
          onChange={(next) => {
            setDirty(true);
            setGeneralQuestions(next);
          }}
        />
      </FormSection>

      <FormSection
        title="投稿の必須項目"
        allowed={canQuestions}
        sectionId="section-required"
      >
        <input type="hidden" name="required_video_fields_present" value="1" />
        <input
          type="hidden"
          name="required_video_fields_json"
          value={requiredVideoFieldsJson}
        />
        <p className="fn-text-muted-sm">
          表示名と作品タイトルは常に必須です。ここで選んだ項目は、このイベントへの投稿・枠提出・作品編集でも必須になります。
        </p>
        {REQUIRED_VIDEO_FIELD_GROUPS.map((group) => (
          <article key={group.id} className={styles.requiredFieldsCard}>
            <h3>{group.label}</h3>
            <div className={styles.requiredFieldsChecks}>
              {group.always.map((field) => (
                <label key={field} className={styles.requiredFieldsCheck}>
                  <input type="checkbox" checked disabled readOnly />
                  <span>
                    {REQUIRED_VIDEO_FIELD_LABELS[field]}
                    <span className="fn-muted">（常に必須）</span>
                  </span>
                </label>
              ))}
              {group.optional.map((field) => (
                <label key={field} className={styles.requiredFieldsCheck}>
                  <input
                    type="checkbox"
                    checked={requiredOptionalFields.includes(field)}
                    disabled={!canQuestions}
                    onChange={() => toggleRequiredOptionalField(field)}
                  />
                  <span>{REQUIRED_VIDEO_FIELD_LABELS[field]}</span>
                </label>
              ))}
            </div>
          </article>
        ))}
      </FormSection>

      <FormSection title="枠" allowed={canSlots} sectionId="section-slots">
        <div className={styles.formGrid2}>
          <div>
            <label className="fn-label">枠タイプ</label>
            <GatedSelect allowed={canSlots} name="slot_type" defaultValue={initial.slot_type ?? "time"}>
              <option value="time">時間枠</option>
              <option value="count">件数枠</option>
            </GatedSelect>
          </div>
          <div>
            <label className="fn-label">1作品あたり最大枠数</label>
            <input
              name="max_slots_per_video"
              type="number"
              min={MIN_SLOTS_PER_VIDEO}
              max={MAX_SLOTS_PER_VIDEO}
              defaultValue={initial.max_slots_per_video ?? 1}
              className="fn-input"
              {...gatedInputProps(canSlots)}
            />
            <p className="fn-muted fn-text-sm">1つの作品で連続して確保・使用できる枠数の上限です。1〜20枠で設定できます。</p>
          </div>
          <div>
            <label className="fn-label">1 X IDあたりの確保上限</label>
            <input
              name="max_slot_reservation_groups_per_xid"
              type="number"
              min={0}
              max={100}
              defaultValue={initial.max_slot_reservation_groups_per_xid ?? 0}
              className="fn-input"
              {...gatedInputProps(canSlots)}
            />
            <p className="fn-muted fn-text-sm">単枠は1件、連続枠は複数枠使用していても1件として数えます。0は無制限です。</p>
          </div>
          <div>
            <label className="fn-label">確保者表示</label>
            <GatedSelect allowed={canSlots} name="slot_visibility_mode" defaultValue={initial.slot_visibility_mode ?? "public_name"}>
              <option value="public_name">公開名</option>
              <option value="anonymous">匿名</option>
              <option value="hidden">非表示</option>
            </GatedSelect>
          </div>
          <div>
            <label className="fn-label">枠同士の間隔（分）</label>
            <input
              name="slot_interval_minutes"
              type="number"
              min={1}
              max={1440}
              defaultValue={initial.slot_interval_minutes ?? ""}
              className="fn-input"
              placeholder="自動判定"
              {...gatedInputProps(canSlots)}
            />
            <p className="fn-muted fn-text-sm">連続枠の案内文に使います。空欄の場合は実際の枠時刻から自動判定します。</p>
          </div>
          <div>
            <label className="fn-label">部の分割閾値（分）</label>
            <input
              name="slot_part_gap_minutes"
              type="number"
              min={1}
              max={1440}
              defaultValue={initial.slot_part_gap_minutes ?? 15}
              className="fn-input"
              {...gatedInputProps(canSlots)}
            />
          </div>
        </div>
        <div>
          <label className="fn-label">部（1行1件）</label>
          <textarea
            name="parts_text"
            defaultValue={partsJsonToText(initial.parts_json)}
            className="fn-input"
            rows={4}
            placeholder={"1部\n2部"}
            {...gatedTextareaProps(canSlots)}
          />
        </div>
      </FormSection>

      {error ? <p className="fn-error">{error}</p> : null}
      {success ? <SaveSuccessNotice message={success.message} pendingPublicReflection={success.pendingPublicReflection} /> : null}

      {isManage ? (
        <div className={`${styles.manageSaveBar}${dirty ? ` ${styles.manageSaveBarDirty}` : ""}`} role="status">
          <span className={styles.manageSaveBarStatus}>{dirty ? "未保存の変更があります" : "保存済み"}</span>
          <button type="submit" className="fn-btn fn-btn-primary" disabled={busy}>{submitLabel}</button>
        </div>
      ) : (
        <button type="submit" className="fn-btn fn-btn-primary" disabled={busy}>{submitLabel}</button>
      )}

      {isManage ? (
        <details className={styles.managePreviewCollapsible}>
          <summary>設定プレビュー</summary>
          <EventSettingsPreview event={preview} />
        </details>
      ) : (
        <EventSettingsPreview event={preview} />
      )}
    </form>
  );
}
