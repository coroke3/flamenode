"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/ui/Icon";
import styles from "./EventForm.module.css";
import { createEvent, updateEvent } from "@/lib/actions/event-admin";
import { PermissionKeysField } from "@/components/admin/PermissionKeysField";
import {
  EventSettingsPreview,
  type EventSettingsPreviewValue,
} from "@/components/admin/EventSettingsPreview";
import type {
  CustomQuestionType,
  CustomQuestionVisibility,
  EditableCustomQuestion,
} from "@/lib/video/customQuestions";
import {
  MAX_CUSTOM_QUESTION_TEXTAREA_LENGTH,
  MAX_CUSTOM_QUESTION_TEXT_LENGTH,
  MAX_EVENT_CUSTOM_QUESTIONS,
} from "@/lib/video/customQuestionLimits";

export interface EventFormInitial {
  id?: string;
  title?: string;
  event_type?: "event" | "collabo" | "type" | "other";
  explanation?: string | null;
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
  custom_questions?: EditableCustomQuestion[];
  max_slots_per_video?: number;
  slot_type?: "time" | "count";
  slot_visibility_mode?: "public_name" | "anonymous" | "hidden";
  slot_part_gap_minutes?: number | null;
  parts_json?: string | null;
  editable_fields?: string | null;
  review_settings?: string | null;
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
}

function partsJsonToText(value: string | null | undefined): string {
  if (!value) return "";
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return "";
    return parsed
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter(Boolean)
      .join("\n");
  } catch {
    return "";
  }
}

function unixToInputDateTime(timestamp: number | null | undefined): string {
  if (!timestamp) return "";
  const date = new Date(timestamp * 1000);
  const pad = (value: number) => value.toString().padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function resolveInitialVisibility(
  initial: EventFormInitial,
): "private" | "public" {
  return initial.visibility_status === "public" ? "public" : "private";
}

function inputGateProps(
  allowed: boolean,
): React.InputHTMLAttributes<HTMLInputElement> {
  return allowed ? {} : { readOnly: true, tabIndex: -1, "aria-disabled": true };
}

function textareaGateProps(
  allowed: boolean,
): React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  return allowed ? {} : { readOnly: true, tabIndex: -1, "aria-disabled": true };
}

function GatedSelect({
  allowed,
  name,
  defaultValue,
  className,
  children,
}: {
  allowed: boolean;
  name: string;
  defaultValue: string;
  className?: string;
  children: React.ReactNode;
}): React.ReactElement {
  if (!allowed) {
    return (
      <>
        <input type="hidden" name={name} value={defaultValue} />
        <select
          className={className}
          defaultValue={defaultValue}
          disabled
          aria-disabled
          tabIndex={-1}
        >
          {children}
        </select>
      </>
    );
  }
  return (
    <select name={name} defaultValue={defaultValue} className={className}>
      {children}
    </select>
  );
}

function textValue(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function createQuestion(index: number): EditableCustomQuestion {
  const suffix = `${Date.now().toString(36)}_${index + 1}`;
  return {
    id: `draft_${suffix}`,
    question_key: `question_${suffix}`,
    label: `追加質問 ${index + 1}`,
    description: null,
    type: "textarea",
    required: false,
    options: [],
    placeholder: null,
    max_length: MAX_CUSTOM_QUESTION_TEXTAREA_LENGTH,
    sort_order: index,
    is_active: true,
    visibility: "review",
  };
}

function buildInitialPreview(initial: EventFormInitial): EventSettingsPreviewValue {
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
    custom_questions: initial.custom_questions ?? [],
    max_slots_per_video: initial.max_slots_per_video ?? 1,
    slot_type: initial.slot_type ?? "time",
    slot_visibility_mode: initial.slot_visibility_mode ?? "public_name",
    slot_part_gap_minutes: initial.slot_part_gap_minutes ?? 15,
    parts_text: partsJsonToText(initial.parts_json),
    parts_json: initial.parts_json,
    editable_fields: initial.editable_fields,
    review_settings: initial.review_settings,
  };
}

function buildPreviewFromForm(
  formData: FormData,
  initial: EventFormInitial,
  questions: EditableCustomQuestion[],
): EventSettingsPreviewValue {
  const questions = readQuestions(formData);
  return {
    title: textValue(fd, "title"),
    event_type: textValue(fd, "event_type") || "event",
    explanation: textValue(fd, "explanation"),
    icon_url: textValue(fd, "icon_url"),
    img_url: textValue(fd, "img_url"),
    accent_color: textValue(fd, "accent_color"),
    start_time: textValue(fd, "start_time"),
    end_time: textValue(fd, "end_time"),
    entry_start_time: textValue(fd, "entry_start_time"),
    entry_end_time: textValue(fd, "entry_end_time"),
    visibility_status: textValue(fd, "visibility_status") || "private",
    allow_user_video_event_links:
      textValue(formData, "allow_user_video_event_links") || "0",
    allow_unslotted_posts:
      textValue(formData, "allow_unslotted_posts") || "0",
    allow_user_video_edits:
      textValue(formData, "allow_user_video_edits") || "0",
    user_video_edit_permission_keys_json: textValue(
      formData,
      "user_video_edit_permission_keys_json",
    ),
    custom_questions: questions,
    max_slots_per_video: textValue(formData, "max_slots_per_video") || "1",
    max_consecutive_slots_per_entry:
      textValue(formData, "max_consecutive_slots_per_entry") || "3",
    slot_type: textValue(formData, "slot_type") || "time",
    slot_visibility_mode:
      textValue(formData, "slot_visibility_mode") || "public_name",
    slot_part_gap_minutes:
      textValue(formData, "slot_part_gap_minutes") || "15",
    parts_text: textValue(formData, "parts_text"),
    editable_fields: initial.editable_fields,
    review_settings: initial.review_settings,
  };
}

function questionTypeLabel(type: CustomQuestionType): string {
  switch (type) {
    case "text": return "1行テキスト";
    case "textarea": return "長文テキスト";
    case "select": return "プルダウン";
    case "radio": return "ラジオボタン";
    case "checkbox": return "チェックボックス（複数選択）";
  }
}

function visibilityLabel(visibility: CustomQuestionVisibility): string {
  switch (visibility) {
    case "review": return "審査・運営画面";
    case "private": return "管理者のみ";
    case "public": return "公開API・公開表示可";
  }
}

export function EventForm({
  mode,
  initial = {},
  templateId,
  editableSections,
}: EventFormProps): React.ReactElement {
  const router = useRouter();
  const [busy, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const [success, setSuccess] = React.useState<string | null>(null);
  const [questions, setQuestions] = React.useState<EditableCustomQuestion[]>(() =>
    (initial.custom_questions ?? [])
      .filter((question) => question.is_active)
      .slice(0, MAX_EVENT_CUSTOM_QUESTIONS)
      .map((question, index) => ({ ...question, sort_order: index })),
  );
  const [preview, setPreview] = React.useState<EventSettingsPreviewValue>(() =>
    initialPreview(initial),
  );

  React.useEffect(() => {
    setPreview((current) => ({ ...current, custom_questions: questions }));
  }, [questions]);

  const canEditBasic = mode === "create" || editableSections?.basic !== false;
  const canEditPublish = mode === "create" || editableSections?.publish !== false;
  const canEditQuestions = mode === "create" || editableSections?.questions !== false;
  const canEditSlots = mode === "create" || editableSections?.slots !== false;

  const sectionGateStyle = (
    allowed: boolean,
    base: React.CSSProperties = {},
  ): React.CSSProperties => ({
    ...base,
    opacity: allowed ? base.opacity : 0.58,
  });

  const updateQuestion = (
    id: string,
    patch: Partial<EditableCustomQuestion>,
  ) => {
    setQuestions((current) => current.map((question) =>
      question.id === id ? { ...question, ...patch } : question,
    ));
  };

  const moveQuestion = (index: number, direction: -1 | 1) => {
    setQuestions((current) => {
      const target = index + direction;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next.map((question, sortOrder) => ({
        ...question,
        sort_order: sortOrder,
      }));
    });
  };

  const onSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setSuccess(null);
    const formData = new FormData(event.currentTarget);
    startTransition(async () => {
      const result = mode === "create"
        ? await createEvent(formData)
        : await updateEvent(formData);
      if (!result.ok) {
        setError(result.message ?? "失敗しました。");
        return;
      }
      setSuccess("保存しました。");
      if (mode === "create" && result.eventId) {
        router.push(`/manage/events/${result.eventId}/edit`);
      } else {
        router.refresh();
      }
    });
  };

  const sectionStatus = mode === "edit" && editableSections
    ? [
        ["基本情報", editableSections.basic],
        ["公開・受付", editableSections.publish],
        ["投稿フォーム", editableSections.questions],
        ["枠設定", editableSections.slots],
      ] as const
    : [];

  return (
    <form
      onSubmit={onSubmit}
      onChange={(event) => {
        setPreview(buildPreviewFromForm(
          new FormData(event.currentTarget),
          initial,
          questions,
        ));
      }}
      style={{ display: "flex", flexDirection: "column", gap: 12 }}
    >
      {mode === "edit" && initial.id ? (
        <input type="hidden" name="id" value={initial.id} />
      ) : null}
      {mode === "create" && templateId ? (
        <input type="hidden" name="template_id" value={templateId} />
      ) : null}

      {sectionStatus.length > 0 ? (
        <div style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 6,
          padding: 10,
          border: "1px solid var(--border-subtle)",
          borderRadius: "var(--radius-sm)",
          background: "var(--bg-surface)",
        }}>
          {sectionStatus.map(([label, allowed]) => (
            <span
              key={label}
              className={allowed ? "fn-badge fn-badge-soft" : "fn-badge"}
              style={{ opacity: allowed ? 1 : 0.55 }}
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
              defaultValue={unixToInputDateTime(initial.start_time)}
              className="fn-input"
              {...gatedInputProps(canBasic)}
            />
          </div>
          <div>
            <label className="fn-label">終了日時</label>
            <input
              name="end_time"
              type="datetime-local"
              defaultValue={unixToInputDateTime(initial.end_time)}
              className="fn-input"
              {...gatedInputProps(canBasic)}
            />
          </div>
        </div>
      </FormSection>

      <FormSection title="公開・受付" allowed={canPublish}>
        <div className={styles.formGrid2}>
          <div>
            <label className="fn-label">募集開始日時</label>
            <input
              name="entry_start_time"
              type="datetime-local"
              defaultValue={unixToInputDateTime(initial.entry_start_time)}
              className="fn-input"
              {...gatedInputProps(canPublish)}
            />
          </div>
          <div>
            <label className="fn-label">募集終了日時</label>
            <input
              name="entry_end_time"
              type="datetime-local"
              defaultValue={unixToInputDateTime(initial.entry_end_time)}
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
              <option value="draft">下書き</option>
              <option value="private">非公開</option>
              <option value="public">公開</option>
              <option value="archived">アーカイブ</option>
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

      <FormSection title="投稿フォーム・権限" allowed={canQuestions}>
        <div className={styles.formGrid2}>
          <div>
            <label className="fn-label">一般ユーザー編集</label>
            <GatedSelect
              allowed={canQuestions}
              name="allow_user_video_edits"
              defaultValue={String(initial.allow_user_video_edits ?? 0)}
            >
              <option value="0">通常権限</option>
              <option value="1">一部許可</option>
            </GatedSelect>
          </div>
        </div>
        <PermissionKeysField
          name="user_video_edit_permission_keys_json"
          defaultValue={initial.user_video_edit_permission_keys_json}
          disabled={!canQuestions}
        />
      </div>

      <div style={sectionGateStyle(canEditBasic)}>
        <label className="fn-label">タイトル *</label>
        <input
          name="title"
          type="text"
          defaultValue={initial.title ?? ""}
          className="fn-input"
          maxLength={200}
          required
          {...inputGateProps(canEditBasic)}
        />
      </div>

      <div className={styles.formGrid2}>
        <div style={sectionGateStyle(canEditBasic)}>
          <label className="fn-label">種別</label>
          <GatedSelect
            allowed={canEditBasic}
            name="event_type"
            defaultValue={initial.event_type ?? "event"}
            className="fn-select"
          >
            <option value="event">event (通常)</option>
            <option value="collabo">collabo (コラボ)</option>
            <option value="type">type (タイプ別)</option>
            <option value="other">other</option>
          </GatedSelect>
        </div>
        <div style={sectionGateStyle(canEditSlots)}>
          <label className="fn-label">枠タイプ</label>
          <GatedSelect
            allowed={canEditSlots}
            name="slot_type"
            defaultValue={initial.slot_type ?? "time"}
            className="fn-select"
          >
            <option value="time">時間付き</option>
            <option value="count">時間なし (番号のみ)</option>
          </GatedSelect>
        </div>
      </div>

      <div style={sectionGateStyle(canEditBasic)}>
        <label className="fn-label">説明</label>
        <textarea
          name="explanation"
          defaultValue={initial.explanation ?? ""}
          className="fn-input"
          rows={4}
          maxLength={4000}
          {...textareaGateProps(canEditBasic)}
        />
      </div>

      <div className={styles.formGrid2} style={sectionGateStyle(canEditBasic)}>
        <div>
          <label className="fn-label">アイコン URL</label>
          <input
            name="icon_url"
            type="url"
            defaultValue={initial.icon_url ?? ""}
            className="fn-input"
            {...inputGateProps(canEditBasic)}
          />
        </div>
        <div>
          <label className="fn-label">バナー画像 URL</label>
          <input
            name="img_url"
            type="url"
            defaultValue={initial.img_url ?? ""}
            className="fn-input"
            {...inputGateProps(canEditBasic)}
          />
        </div>
      </div>

      <div className={styles.formGrid2} style={sectionGateStyle(canEditBasic)}>
        <div>
          <label className="fn-label">開始日時</label>
          <input
            name="start_time"
            type="datetime-local"
            defaultValue={unixToInputDateTime(initial.start_time)}
            className="fn-input"
            {...inputGateProps(canEditBasic)}
          />
        </div>
        <div>
          <label className="fn-label">終了日時</label>
          <input
            name="end_time"
            type="datetime-local"
            defaultValue={unixToInputDateTime(initial.end_time)}
            className="fn-input"
            {...inputGateProps(canEditBasic)}
          />
        </div>
      </div>

      <div className={styles.formGrid2} style={sectionGateStyle(canEditPublish)}>
        <div>
          <label className="fn-label">募集開始日時</label>
          <input
            name="entry_start_time"
            type="datetime-local"
            defaultValue={unixToInputDateTime(initial.entry_start_time)}
            className="fn-input"
            {...inputGateProps(canEditPublish)}
          />
        </div>
        <div>
          <label className="fn-label">募集終了日時</label>
          <input
            name="entry_end_time"
            type="datetime-local"
            defaultValue={unixToInputDateTime(initial.entry_end_time)}
            className="fn-input"
            {...inputGateProps(canEditPublish)}
          />
        </div>
      </div>

      <div style={sectionGateStyle(canEditBasic)}>
        <label className="fn-label">アクセントカラー (HEX)</label>
        <input
          name="accent_color"
          type="text"
          defaultValue={initial.accent_color ?? ""}
          className="fn-input"
          maxLength={20}
          placeholder="#ffd400"
          {...inputGateProps(canEditBasic)}
        />
      </div>

      <div className={styles.formGrid3} style={sectionGateStyle(canEditPublish)}>
        <div>
          <label className="fn-label">公開状態</label>
          <GatedSelect
            allowed={canEditPublish}
            name="visibility_status"
            defaultValue={resolveInitialVisibility(initial)}
            className="fn-select"
          >
            <option value="private">非公開・準備中</option>
            <option value="public">公開</option>
          </GatedSelect>
        </div>
        <div>
          <label className="fn-label">一般ユーザーの追加紐付け</label>
          <GatedSelect
            allowed={canEditPublish}
            name="allow_user_video_event_links"
            defaultValue={String(initial.allow_user_video_event_links ?? 0)}
            className="fn-select"
          >
            <option value="0">運営承認制 (既定)</option>
            <option value="1">許可</option>
          </GatedSelect>
        </div>
        <div>
          <label className="fn-label">枠なし投稿の紐づけ</label>
          <GatedSelect
            allowed={canEditPublish}
            name="allow_unslotted_posts"
            defaultValue={String(initial.allow_unslotted_posts ?? 0)}
            className="fn-select"
          >
            <option value="0">不許可 (既定)</option>
            <option value="1">許可</option>
          </GatedSelect>
        </div>
      </div>

      <fieldset style={sectionGateStyle(canEditQuestions, {
        marginTop: 16,
        padding: "14px 0 0",
        border: 0,
        borderTop: "1px solid var(--border-subtle)",
        display: "grid",
        gap: 12,
      })}>
        <legend style={{ padding: "0 10px 0 0", fontSize: 13, fontWeight: 800 }}>
          一般作品権限の上書き
        </legend>
        <div>
          <label className="fn-label">編集できる人</label>
          <GatedSelect
            allowed={canEditQuestions}
            name="allow_user_video_edits"
            defaultValue={String(initial.allow_user_video_edits ?? 0)}
            className="fn-select"
          >
            <option value="0">設定しない (通常権限を採用)</option>
            <option value="1">投稿者・共同編集者にも一部変更を許可</option>
          </GatedSelect>
        </div>
        <div>
          <label className="fn-label">許可する編集内容</label>
          <PermissionKeysField
            name="user_video_edit_permission_keys_json"
            defaultValue={initial.user_video_edit_permission_keys_json}
            disabled={!canEditQuestions}
          />
        </div>
      </fieldset>

      <fieldset style={sectionGateStyle(canEditSlots, {
        marginTop: 16,
        padding: "14px 0 0",
        border: 0,
        borderTop: "1px solid var(--border-subtle)",
        display: "grid",
        gap: 8,
      })}>
        <legend style={{ padding: "0 10px 0 0", fontSize: 13, fontWeight: 800 }}>
          部 (作品の分類)
        </legend>
        <p className="fn-muted" style={{ margin: 0, fontSize: 12 }}>
          作品が選択できる部を1行に1件ずつ入力します。
        </p>
        <textarea
          name="parts_text"
          defaultValue={partsJsonToText(initial.parts_json)}
          className="fn-input"
          rows={4}
          placeholder={"1部\n2部"}
          {...textareaGateProps(canEditSlots)}
        />
      </fieldset>

      <fieldset style={sectionGateStyle(canEditQuestions, {
        marginTop: 16,
        padding: "14px 0 0",
        border: 0,
        borderTop: "1px solid var(--border-subtle)",
        display: "grid",
        gap: 12,
      })}>
        <legend style={{ padding: "0 10px 0 0", fontSize: 13, fontWeight: 800 }}>
          投稿フォームの追加質問
        </legend>
        <input type="hidden" name="custom_questions_present" value="1" />
        <p className="fn-muted" style={{ margin: 0, fontSize: 12, lineHeight: 1.6 }}>
          質問定義はデータベースを正本として保存します。最大{MAX_EVENT_CUSTOM_QUESTIONS}件です。
          削除した質問は投稿フォームから外れますが、過去の回答は保持されます。
        </p>

        <div style={{ display: "grid", gap: 12 }}>
          {questions.length === 0 ? (
            <p className="fn-muted" style={{ margin: 0, fontSize: 12 }}>
              追加質問は設定されていません。
            </p>
          ) : null}

          {questions.map((question, index) => {
            const optionType = question.type === "select" ||
              question.type === "radio" || question.type === "checkbox";
            const textType = question.type === "text" || question.type === "textarea";
            return (
              <article
                key={question.id}
                style={{
                  display: "grid",
                  gap: 10,
                  padding: 14,
                  border: "1px solid var(--border-subtle)",
                  borderRadius: "var(--radius-sm)",
                  background: "var(--bg-surface)",
                }}
              >
                <input type="hidden" name="custom_question_active" value="1" />
                <input
                  type="hidden"
                  name="custom_question_required"
                  value={question.required ? "1" : "0"}
                />
                <input type="hidden" name="custom_question_type" value={question.type} />
                <input
                  type="hidden"
                  name="custom_question_visibility"
                  value={question.visibility}
                />
                <input
                  type="hidden"
                  name="custom_question_options"
                  value={question.options.join("\n")}
                />
                <input
                  type="hidden"
                  name="custom_question_max_length"
                  value={question.max_length ?? ""}
                />

                <header style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 8,
                  flexWrap: "wrap",
                }}>
                  <strong style={{ fontSize: 13 }}>質問 {index + 1}</strong>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    <button
                      type="button"
                      className="fn-btn fn-btn-ghost fn-btn-sm"
                      disabled={!canEditQuestions || index === 0}
                      onClick={() => moveQuestion(index, -1)}
                    >
                      上へ
                    </button>
                    <button
                      type="button"
                      className="fn-btn fn-btn-ghost fn-btn-sm"
                      disabled={!canEditQuestions || index === questions.length - 1}
                      onClick={() => moveQuestion(index, 1)}
                    >
                      下へ
                    </button>
                    <button
                      type="button"
                      className="fn-btn fn-btn-ghost fn-btn-sm"
                      disabled={!canEditQuestions}
                      onClick={() => setQuestions((current) =>
                        current
                          .filter((item) => item.id !== question.id)
                          .map((item, sortOrder) => ({ ...item, sort_order: sortOrder })),
                      )}
                    >
                      <Icon name="trash" size={12} aria-hidden /> 削除
                    </button>
                  </div>
                </header>

                <div className={styles.formGrid2}>
                  <div>
                    <label className="fn-label">識別子 *</label>
                    <input
                      name="custom_question_key"
                      type="text"
                      value={question.question_key}
                      onChange={(event) => updateQuestion(question.id, {
                        question_key: event.target.value,
                      })}
                      className="fn-input"
                      pattern="[A-Za-z0-9_-]+"
                      maxLength={64}
                      readOnly={!canEditQuestions}
                      required
                    />
                  </div>
                  <div>
                    <label className="fn-label">質問名 *</label>
                    <input
                      name="custom_question_label"
                      type="text"
                      value={question.label}
                      onChange={(event) => updateQuestion(question.id, {
                        label: event.target.value,
                      })}
                      className="fn-input"
                      maxLength={120}
                      readOnly={!canEditQuestions}
                      required
                    />
                  </div>
                </div>

                <div className={styles.formGrid2}>
                  <div>
                    <label className="fn-label">回答形式</label>
                    <select
                      className="fn-select"
                      value={question.type}
                      disabled={!canEditQuestions}
                      onChange={(event) => {
                        const type = event.target.value as CustomQuestionType;
                        updateQuestion(question.id, {
                          type,
                          max_length: type === "text"
                            ? MAX_CUSTOM_QUESTION_TEXT_LENGTH
                            : type === "textarea"
                              ? MAX_CUSTOM_QUESTION_TEXTAREA_LENGTH
                              : null,
                        });
                      }}
                    >
                      {(["text", "textarea", "select", "radio", "checkbox"] as const).map((type) => (
                        <option key={type} value={type}>{questionTypeLabel(type)}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="fn-label">回答の公開範囲</label>
                    <select
                      className="fn-select"
                      value={question.visibility}
                      disabled={!canEditQuestions}
                      onChange={(event) => updateQuestion(question.id, {
                        visibility: event.target.value as CustomQuestionVisibility,
                      })}
                    >
                      {(["review", "private", "public"] as const).map((visibility) => (
                        <option key={visibility} value={visibility}>
                          {visibilityLabel(visibility)}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <label style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 7,
                  fontSize: 12,
                }}>
                  <input
                    type="checkbox"
                    checked={question.required}
                    disabled={!canEditQuestions}
                    onChange={(event) => updateQuestion(question.id, {
                      required: event.target.checked,
                    })}
                  />
                  必須回答にする
                </label>

                <div>
                  <label className="fn-label">補足文</label>
                  <textarea
                    name="custom_question_description"
                    value={question.description ?? ""}
                    onChange={(event) => updateQuestion(question.id, {
                      description: event.target.value,
                    })}
                    className="fn-input"
                    rows={2}
                    maxLength={1000}
                    readOnly={!canEditQuestions}
                  />
                </div>

                <div>
                  <label className="fn-label">入力例・案内</label>
                  <input
                    name="custom_question_placeholder"
                    type="text"
                    value={question.placeholder ?? ""}
                    onChange={(event) => updateQuestion(question.id, {
                      placeholder: event.target.value,
                    })}
                    className="fn-input"
                    maxLength={500}
                    readOnly={!canEditQuestions}
                  />
                </div>

                {optionType ? (
                  <div>
                    <label className="fn-label">選択肢 *（1行に1件）</label>
                    <textarea
                      value={question.options.join("\n")}
                      onChange={(event) => updateQuestion(question.id, {
                        options: event.target.value.split(/\r?\n/),
                      })}
                      className="fn-input"
                      rows={4}
                      readOnly={!canEditQuestions}
                      placeholder={"許可済み\n確認中\n該当なし"}
                      required
                    />
                  </div>
                ) : null}

                {textType ? (
                  <div style={{ maxWidth: 240 }}>
                    <label className="fn-label">最大文字数</label>
                    <input
                      type="number"
                      value={question.max_length ?? ""}
                      min={1}
                      max={5000}
                      onChange={(event) => updateQuestion(question.id, {
                        max_length: Number.parseInt(event.target.value, 10) || null,
                      })}
                      className="fn-input"
                      readOnly={!canEditQuestions}
                    />
                  </div>
                ) : null}
              </article>
            );
          })}

          <button
            type="button"
            className="fn-btn fn-btn-ghost fn-btn-sm"
            disabled={!canEditQuestions || questions.length >= MAX_EVENT_CUSTOM_QUESTIONS}
            onClick={() => setQuestions((current) => [
              ...current,
              createQuestion(current.length),
            ])}
            style={{ justifySelf: "start" }}
          >
            <Icon name="plus" size={12} aria-hidden /> 質問を追加
          </button>
        </div>
        <button
          type="button"
          className="fn-btn fn-btn-ghost"
          disabled={!canQuestions}
          onClick={() =>
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
            ])
          }
        >
          <Icon name="plus" size={13} aria-hidden /> 質問を追加
        </button>
      </FormSection>

      <div className={styles.formGrid3} style={sectionGateStyle(canEditSlots)}>
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
        <div>
          <label className="fn-label">連続取得上限</label>
          <input
            name="max_consecutive_slots_per_entry"
            type="number"
            min={1}
            max={20}
            defaultValue={initial.max_consecutive_slots_per_entry ?? 3}
            className="fn-input"
            {...inputGateProps(canEditSlots)}
          />
        </div>
        <div>
          <label className="fn-label">部の分割閾値 (分)</label>
          <input
            name="slot_part_gap_minutes"
            type="number"
            min={1}
            max={1440}
            defaultValue={initial.slot_part_gap_minutes ?? 15}
            className="fn-input"
            {...inputGateProps(canEditSlots)}
          />
        </div>
        <div>
          <label className="fn-label">確保者表示</label>
          <GatedSelect
            allowed={canEditSlots}
            name="slot_visibility_mode"
            defaultValue={initial.slot_visibility_mode ?? "public_name"}
            className="fn-select"
          >
            <option value="public_name">名前公開</option>
            <option value="anonymous">匿名</option>
            <option value="hidden">非表示</option>
          </GatedSelect>
        </div>
      </div>

      <EventSettingsPreview event={preview} />
    </form>
  );
}
