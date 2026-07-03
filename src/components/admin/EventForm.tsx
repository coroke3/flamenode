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
import {
  createDefaultStagePermissionQuestion,
  DEFAULT_STAGE_PERMISSION_FIELD,
  getStagePermissionQuestions,
  parseVideoFormSettings,
  type StagePermissionFieldSettings,
} from "@/lib/video/formSettings";

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
  visibility_status?: "draft" | "private" | "public" | "archived" | null;
  is_active?: number;
  is_archived?: number;
  allow_user_video_event_links?: number;
  allow_user_video_edits?: number;
  user_video_edit_permission_keys_json?: string | null;
  video_form_settings_json?: string | null;
  max_slots_per_video?: number;
  max_consecutive_slots_per_entry?: number;
  slot_type?: "time" | "count";
  slot_visibility_mode?: "public_name" | "anonymous" | "hidden";
  slot_part_gap_minutes?: number | null;
  parts_json?: string | null;
  editable_fields?: string | null;
  review_settings?: string | null;
}

function partsJsonToText(value: string | null | undefined): string {
  if (!value) return "";
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return "";
    return parsed
      .filter((v): v is string => typeof v === "string")
      .map((v) => v.trim())
      .filter(Boolean)
      .join("\n");
  } catch {
    return "";
  }
}

function resolveInitialVisibility(
  initial: EventFormInitial,
): "draft" | "private" | "public" | "archived" {
  if (
    initial.visibility_status === "draft" ||
    initial.visibility_status === "private" ||
    initial.visibility_status === "public" ||
    initial.visibility_status === "archived"
  ) {
    return initial.visibility_status;
  }
  if (initial.is_archived === 1) return "archived";
  if (initial.is_active === 1) return "public";
  return "draft";
}

function inputGateProps(allowed: boolean): React.InputHTMLAttributes<HTMLInputElement> {
  return allowed
    ? {}
    : { readOnly: true, tabIndex: -1, "aria-disabled": true };
}

function textareaGateProps(
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

interface EventFormProps {
  mode: "create" | "edit";
  initial?: EventFormInitial;
  /** 作成時にテンプレート由来の JSON 項目をサーバーへ渡す */
  templateId?: string;
  editableSections?: {
    basic: boolean;
    publish: boolean;
    questions: boolean;
    slots: boolean;
  };
}

function unixToInputDateTime(ts: number | null | undefined): string {
  if (!ts) return "";
  const d = new Date(ts * 1000);
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function hasCheckedValue(fd: FormData, name: string): boolean {
  return fd.getAll(name).some((v) => String(v) === "1");
}

function textValue(fd: FormData, name: string): string {
  const value = fd.get(name);
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
        question.description.trim() ||
        DEFAULT_STAGE_PERMISSION_FIELD.description,
      placeholder:
        question.placeholder.trim() ||
        DEFAULT_STAGE_PERMISSION_FIELD.placeholder,
    })),
  });
}

function readStagePermissionQuestionsFromFormData(
  fd: FormData,
): StagePermissionFieldSettings[] {
  const ids = fd.getAll("stage_permission_question_id");
  const enabled = fd.getAll("stage_permission_question_enabled");
  const required = fd.getAll("stage_permission_question_required");
  const labels = fd.getAll("stage_permission_question_label");
  const descriptions = fd.getAll("stage_permission_question_description");
  const placeholders = fd.getAll("stage_permission_question_placeholder");

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

function buildPreviewFormSettings(fd: FormData): string {
  const questions = readStagePermissionQuestionsFromFormData(fd);
  if (questions.length > 0) {
    return buildVideoFormSettingsFromQuestions(questions);
  }
  return JSON.stringify({
    stage_permission: {
      enabled: hasCheckedValue(fd, "stage_permission_enabled"),
      required: hasCheckedValue(fd, "stage_permission_required"),
      label:
        textValue(fd, "stage_permission_label").trim() ||
        DEFAULT_STAGE_PERMISSION_FIELD.label,
      description:
        textValue(fd, "stage_permission_description").trim() ||
        DEFAULT_STAGE_PERMISSION_FIELD.description,
      placeholder:
        textValue(fd, "stage_permission_placeholder").trim() ||
        DEFAULT_STAGE_PERMISSION_FIELD.placeholder,
    },
  });
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
    is_active: initial.is_active ?? 0,
    is_archived: initial.is_archived ?? 0,
    allow_user_video_event_links: initial.allow_user_video_event_links ?? 0,
    allow_user_video_edits: initial.allow_user_video_edits ?? 0,
    user_video_edit_permission_keys_json:
      initial.user_video_edit_permission_keys_json,
    video_form_settings_json: initial.video_form_settings_json,
    max_slots_per_video: initial.max_slots_per_video ?? 1,
    max_consecutive_slots_per_entry:
      initial.max_consecutive_slots_per_entry ?? 3,
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
  fd: FormData,
  initial: EventFormInitial,
): EventSettingsPreviewValue {
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
    visibility_status: textValue(fd, "visibility_status") || "draft",
    is_active: textValue(fd, "is_active") || "0",
    is_archived: textValue(fd, "is_archived") || "0",
    allow_user_video_event_links:
      textValue(fd, "allow_user_video_event_links") || "0",
    allow_user_video_edits: textValue(fd, "allow_user_video_edits") || "0",
    user_video_edit_permission_keys_json: textValue(
      fd,
      "user_video_edit_permission_keys_json",
    ),
    video_form_settings_json: buildPreviewFormSettings(fd),
    max_slots_per_video: textValue(fd, "max_slots_per_video") || "1",
    max_consecutive_slots_per_entry:
      textValue(fd, "max_consecutive_slots_per_entry") || "3",
    slot_type: textValue(fd, "slot_type") || "time",
    slot_visibility_mode: textValue(fd, "slot_visibility_mode") || "public_name",
    slot_part_gap_minutes: textValue(fd, "slot_part_gap_minutes") || "15",
    parts_text: textValue(fd, "parts_text"),
    editable_fields: initial.editable_fields,
    review_settings: initial.review_settings,
  };
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
  const [preview, setPreview] = React.useState<EventSettingsPreviewValue>(() =>
    buildInitialPreview(initial),
  );
  const [stageQuestions, setStageQuestions] = React.useState<
    StagePermissionFieldSettings[]
  >(() => {
    const questions = getStagePermissionQuestions(
      parseVideoFormSettings(initial.video_form_settings_json),
    );
    return questions.length > 0
      ? questions
      : [createDefaultStagePermissionQuestion()];
  });

  React.useEffect(() => {
    setPreview((current) => ({
      ...current,
      video_form_settings_json: buildVideoFormSettingsFromQuestions(stageQuestions),
    }));
  }, [stageQuestions]);

  const updateStageQuestion = (
    id: string,
    patch: Partial<StagePermissionFieldSettings>,
  ) => {
    setStageQuestions((current) =>
      current.map((question) =>
        question.id === id ? { ...question, ...patch } : question,
      ),
    );
  };

  const addStageQuestion = () => {
    setStageQuestions((current) => [
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
  };

  const removeStageQuestion = (id: string) => {
    setStageQuestions((current) =>
      current.filter((question) => question.id !== id),
    );
  };

  const sectionStatus =
    mode === "edit" && editableSections
      ? [
          ["基本情報", editableSections.basic],
          ["公開・受付", editableSections.publish],
          ["投稿フォーム", editableSections.questions],
          ["枠設定", editableSections.slots],
        ] as const
      : [];
  const canEditBasic = mode === "create" || editableSections?.basic !== false;
  const canEditPublish = mode === "create" || editableSections?.publish !== false;
  const canEditQuestions =
    mode === "create" || editableSections?.questions !== false;
  const canEditSlots = mode === "create" || editableSections?.slots !== false;
  const sectionGateStyle = (
    allowed: boolean,
    base: React.CSSProperties = {},
  ): React.CSSProperties => ({
    ...base,
    opacity: allowed ? base.opacity : 0.58,
  });

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const r = mode === "create" ? await createEvent(fd) : await updateEvent(fd);
      if (!r.ok) {
        setError(r.message ?? "失敗しました。");
        return;
      }
      setSuccess("保存しました。");
      if (mode === "create" && r.eventId) {
        router.push(`/manage/events/${r.eventId}/edit`);
      } else {
        router.refresh();
      }
    });
  };

  return (
    <form
      onSubmit={onSubmit}
      onChange={(e) => {
        setPreview(buildPreviewFromForm(new FormData(e.currentTarget), initial));
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
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 6,
            padding: 10,
            border: "1px solid var(--border-subtle)",
            borderRadius: "var(--radius-sm)",
            background: "var(--bg-surface)",
          }}
        >
          {sectionStatus.map(([label, allowed]) => (
            <span
              key={label}
              className={allowed ? "fn-badge fn-badge-soft" : "fn-badge"}
              style={{
                opacity: allowed ? 1 : 0.55,
              }}
            >
              {label}: {allowed ? "変更可" : "権限なし"}
            </span>
          ))}
        </div>
      ) : null}

      <div>
        <label className="fn-label">
          ID {mode === "create" ? "(空欄で自動生成)" : "(変更不可)"}
        </label>
        <input
          name="id"
          type="text"
          defaultValue={initial.id ?? ""}
          className="fn-input"
          readOnly={mode === "edit"}
          placeholder="例: spring_2026"
          pattern="[A-Za-z0-9_-]*"
          maxLength={64}
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

      <div
        className={styles.formGrid2}
        style={sectionGateStyle(canEditBasic)}
      >
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

      <div
        className={styles.formGrid2}
        style={sectionGateStyle(canEditBasic)}
      >
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

      <div
        className={styles.formGrid2}
        style={sectionGateStyle(canEditPublish)}
      >
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

      <div
        className={styles.formGrid2}
        style={sectionGateStyle(canEditPublish)}
      >
        <div>
          <label className="fn-label">公開状態</label>
          <GatedSelect
            allowed={canEditPublish}
            name="visibility_status"
            defaultValue={resolveInitialVisibility(initial)}
            className="fn-select"
          >
            <option value="draft">下書き</option>
            <option value="private">非公開</option>
            <option value="public">公開</option>
            <option value="archived">アーカイブ</option>
          </GatedSelect>
        </div>
        <div>
          <label
            className="fn-label"
            title="このイベントで作品投稿者が VideoForm の所属イベント選択でこのイベントを追加できるかどうか"
          >
            一般ユーザーの追加紐付け
          </label>
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
      </div>

      <fieldset
        style={sectionGateStyle(canEditQuestions, {
          marginTop: 16,
          padding: "14px 0 0",
          border: 0,
          borderTop: "1px solid var(--border-subtle)",
          display: "grid",
          gap: 12,
        })}
      >
        <legend
          style={{
            padding: "0 10px 0 0",
            fontSize: 13,
            fontWeight: 800,
            color: "var(--text-primary)",
          }}
        >
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
          <p
            style={{
              marginTop: 4,
              fontSize: 11.5,
              color: "var(--text-muted)",
              lineHeight: 1.5,
            }}
          >
            「設定しない」を選んだ場合、このイベントでは上書きせず、ユーザー管理 &gt; 権限
            タブで設定した一般作品権限が採用されます。
          </p>
        </div>
        <div>
          <label className="fn-label">許可する編集内容</label>
          <p
            style={{
              marginTop: 0,
              marginBottom: 6,
              fontSize: 11.5,
              color: "var(--text-muted)",
              lineHeight: 1.5,
            }}
          >
            「投稿者・共同編集者にも一部変更を許可」を選んだときのみ有効です。
          </p>
          <PermissionKeysField
            name="user_video_edit_permission_keys_json"
            defaultValue={initial.user_video_edit_permission_keys_json}
            disabled={!canEditQuestions}
          />
        </div>
      </fieldset>

      <fieldset
        style={sectionGateStyle(canEditSlots, {
          marginTop: 16,
          padding: "14px 0 0",
          border: 0,
          borderTop: "1px solid var(--border-subtle)",
          display: "grid",
          gap: 8,
        })}
      >
        <legend
          style={{
            padding: "0 10px 0 0",
            fontSize: 13,
            fontWeight: 800,
            color: "var(--text-primary)",
          }}
        >
          部 (作品の分類)
        </legend>
        <p
          style={{
            margin: 0,
            fontSize: 11.5,
            color: "var(--text-muted)",
            lineHeight: 1.5,
          }}
        >
          このイベントで作品が選択できる「部」を 1 行に 1 件ずつ入力します
          (例: 1部 / 2部 / 演出部門 など)。空欄なら作品フォームに「部」項目を出しません。
          旧データの type に相当する分類項目です。
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

      <fieldset
        style={sectionGateStyle(canEditQuestions, {
          marginTop: 16,
          padding: "14px 0 0",
          border: 0,
          borderTop: "1px solid var(--border-subtle)",
          display: "grid",
          gap: 12,
        })}
      >
        <legend
          style={{
            padding: "0 10px 0 0",
            fontSize: 13,
            fontWeight: 800,
            color: "var(--text-primary)",
          }}
        >
          投稿フォームの追加質問
        </legend>
        <input type="hidden" name="stage_permission_questions_present" value="1" />
        <p className="fn-muted" style={{ margin: "0 0 2px", fontSize: 12, lineHeight: 1.6 }}>
          投稿者に確認しておきたい内容を複数設定できます。各質問は投稿フォームに順番どおり表示されます。
        </p>
        <div style={{ display: "grid", gap: 10 }}>
          {stageQuestions.length === 0 ? (
            <p className="fn-muted" style={{ margin: 0, fontSize: 12 }}>
              追加質問は設定されていません。
            </p>
          ) : null}
          {stageQuestions.map((question, index) => (
            <article
              key={question.id}
              style={{
                display: "grid",
                gap: 10,
                padding: 12,
                border: "1px solid var(--border-subtle)",
                borderRadius: "var(--radius-sm)",
                background: "var(--bg-surface)",
              }}
            >
              <input
                type="hidden"
                name="stage_permission_question_id"
                value={question.id}
              />
              <input
                type="hidden"
                name="stage_permission_question_enabled"
                value={question.enabled ? "1" : "0"}
              />
              <input
                type="hidden"
                name="stage_permission_question_required"
                value={question.required ? "1" : "0"}
              />
              <header
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 8,
                  flexWrap: "wrap",
                }}
              >
                <strong style={{ fontSize: 13 }}>質問 {index + 1}</strong>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <label
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                      fontSize: 12,
                      cursor: "pointer",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={question.enabled}
                      disabled={!canEditQuestions}
                      onChange={(ev) =>
                        updateStageQuestion(question.id, {
                          enabled: ev.target.checked,
                        })
                      }
                      style={{ accentColor: "var(--accent-primary)" }}
                    />
                    表示する
                  </label>
                  <label
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                      fontSize: 12,
                      cursor: "pointer",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={question.required}
                      disabled={!canEditQuestions}
                      onChange={(ev) =>
                        updateStageQuestion(question.id, {
                          required: ev.target.checked,
                        })
                      }
                      style={{ accentColor: "var(--accent-primary)" }}
                    />
                    必須
                  </label>
                  <button
                    type="button"
                    className="fn-btn fn-btn-ghost fn-btn-sm"
                    disabled={!canEditQuestions}
                    onClick={() => removeStageQuestion(question.id)}
                  >
                    <Icon name="trash" size={12} aria-hidden /> 削除
                  </button>
                </div>
              </header>
              <div>
                <label className="fn-label">質問名</label>
                <input
                  name="stage_permission_question_label"
                  type="text"
                  value={question.label}
                  readOnly={!canEditQuestions}
                  onChange={(ev) =>
                    updateStageQuestion(question.id, {
                      label: ev.target.value,
                    })
                  }
                  className="fn-input"
                  maxLength={120}
                />
              </div>
              <div>
                <label className="fn-label">補足文</label>
                <textarea
                  name="stage_permission_question_description"
                  value={question.description}
                  readOnly={!canEditQuestions}
                  onChange={(ev) =>
                    updateStageQuestion(question.id, {
                      description: ev.target.value,
                    })
                  }
                  className="fn-input"
                  rows={3}
                  maxLength={1000}
                />
              </div>
              <div>
                <label className="fn-label">入力例</label>
                <input
                  name="stage_permission_question_placeholder"
                  type="text"
                  value={question.placeholder}
                  readOnly={!canEditQuestions}
                  onChange={(ev) =>
                    updateStageQuestion(question.id, {
                      placeholder: ev.target.value,
                    })
                  }
                  className="fn-input"
                  maxLength={500}
                />
              </div>
            </article>
          ))}
          <button
            type="button"
            className="fn-btn fn-btn-ghost fn-btn-sm"
            disabled={!canEditQuestions}
            onClick={addStageQuestion}
            style={{ justifySelf: "start" }}
          >
            <Icon name="plus" size={12} aria-hidden /> 質問を追加
          </button>
        </div>
      </fieldset>

      <div
        className={styles.formGrid3}
        style={sectionGateStyle(canEditSlots)}
      >
        <div>
          <label className="fn-label">1作品あたり最大枠数</label>
          <input
            name="max_slots_per_video"
            type="number"
            min={1}
            max={20}
            defaultValue={initial.max_slots_per_video ?? 1}
            className="fn-input"
            {...inputGateProps(canEditSlots)}
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
          <label className="fn-label">
            部の分割閾値 (分) <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>デフォルト 15</span>
          </label>
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

      {error ? (
        <p role="alert" style={{ color: "var(--accent-danger)", fontSize: 13 }}>
          <Icon name="warning" size={13} aria-hidden /> {error}
        </p>
      ) : null}
      {success ? (
        <p role="status" style={{ color: "var(--accent-primary)", fontSize: 13 }}>
          <Icon name="check" size={13} aria-hidden /> {success}
        </p>
      ) : null}

      <div style={{ display: "flex", gap: 8 }}>
        <button
          type="submit"
          className="fn-btn fn-btn-primary"
          disabled={busy}
          aria-busy={busy}
        >
          <Icon name="check" size={13} aria-hidden />
          {busy ? "保存中…" : mode === "create" ? "作成" : "保存"}
        </button>
      </div>
    </form>
  );
}
