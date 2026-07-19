"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import styles from "./VideoForm.module.css";
import { Icon } from "@/components/ui/Icon";
import {
  extractYoutubeId,
  youtubeThumbUrl,
  youtubeWatchUrl,
} from "@/lib/youtube/id";
import {
  createFreeVideo,
  submitSlotVideo,
  updateVideo,
} from "@/lib/actions/video";
import type { VideoActionResult } from "@/lib/video/types";
import {
  VideoMembersField,
  type VideoMemberInput,
  type VideoMemberSuggestion,
} from "@/components/forms/VideoMembersField";
import { VideoIconPicker } from "@/components/forms/VideoIconPicker";
import { SocialLinksEditor } from "@/components/forms/SocialLinksEditor";
import { YoutubeChannelPicker } from "@/components/settings/YoutubeChannelPicker";
import { normalizeXId } from "@/lib/utils/xid";
import { redirectForGuardReason } from "@/lib/client/guardRedirect";
import {
  MAX_ATOMIC_VIDEO_EVENTS,
  MAX_ATOMIC_VIDEO_SOFTWARES,
} from "@/lib/video/atomicLimits";
import {
  parseCustomAnswerValuesJson,
  type CustomAnswerValue,
  type CustomQuestion,
} from "@/lib/video/customQuestions";
import { MAX_VIDEO_CUSTOM_QUESTIONS } from "@/lib/video/customQuestionLimits";

export interface VideoFormInitialValues {
  display_name?: string;
  creator_x_user_id?: string;
  icon_url?: string;
  profile_text?: string;
  youtube_channel_url?: string;
  other_social_links?: string;
  title?: string;
  youtube_url?: string;
  music?: string;
  music_reference_url?: string;
  credit?: string;
  intro_comment?: string;
  used_software?: string;
  custom_question_answers_json?: string;
  highlights?: string;
  production_story?: string;
  closing_comment?: string;
  is_collab?: boolean;
  members?: VideoMemberInput[];
  event_ids?: string[];
  part?: string | null;
}

export interface EventOption {
  id: string;
  title: string;
  custom_questions?: CustomQuestion[];
  parts_json?: string | null;
}

export interface XIdOption {
  id: string;
  x_name: string;
}

interface VideoFormProps {
  mode: "free" | "slot" | "edit";
  initial?: VideoFormInitialValues;
  slotId?: string;
  videoId?: string;
  memberSuggestions?: VideoMemberSuggestion[];
  softwareSuggestions?: string[];
  xIdOptions?: XIdOption[];
  activeXId?: string | null;
  disabledSections?: string[];
  disabledFields?: string[];
  submitBlockedReason?: string;
  iconCandidates?: string[];
  channelCandidates?: string[];
  eventOptions?: EventOption[];
  canEditEvents?: boolean;
  canChangeSubmitter?: boolean;
  editPrivilegeMode?: "normal" | "admin" | "event";
}

type WizardStepKey = "submitter" | "work" | "youtube" | "confirm";

type WizardValidationError = {
  step: WizardStepKey;
  message: string;
  fieldId?: string;
};

const WIZARD_STEPS: Array<{
  key: WizardStepKey;
  label: string;
  icon: React.ComponentProps<typeof Icon>["name"];
}> = [
  { key: "submitter", label: "提出者", icon: "user" },
  { key: "work", label: "作品情報", icon: "edit" },
  { key: "youtube", label: "YouTube", icon: "youtube" },
  { key: "confirm", label: "確認", icon: "check" },
];

function parsePartsJson(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is string => typeof item === "string" && item.trim().length > 0,
    );
  } catch {
    return [];
  }
}

function isSectionDisabled(
  disabledSections: string[] | undefined,
  key: string,
): boolean {
  return Array.isArray(disabledSections) && disabledSections.includes(key);
}

function isFieldDisabled(
  disabledFields: string[] | undefined,
  key: string,
): boolean {
  return Array.isArray(disabledFields) && disabledFields.includes(key);
}

function cx(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(" ");
}

function answerAsString(value: CustomAnswerValue | undefined): string {
  return typeof value === "string" ? value : "";
}

function answerAsArray(value: CustomAnswerValue | undefined): string[] {
  return Array.isArray(value) ? value : [];
}

function customFieldName(question: CustomQuestion): string {
  return `custom_answer:${question.event_id}:${question.question_key}`;
}

function customFieldId(question: CustomQuestion): string {
  return `custom_question_${question.id}`;
}

function questionCountForEvents(
  eventOptions: EventOption[],
  eventIds: readonly string[],
): number {
  const selected = new Set(eventIds);
  return eventOptions.reduce(
    (total, event) => total + (
      selected.has(event.id)
        ? (event.custom_questions ?? []).filter((question) => question.is_active).length
        : 0
    ),
    0,
  );
}

function CustomQuestionInput({
  question,
  value,
  disabled,
  invalid,
  onChange,
}: {
  question: CustomQuestion;
  value: CustomAnswerValue | undefined;
  disabled: boolean;
  invalid: boolean;
  onChange: (value: CustomAnswerValue) => void;
}): React.ReactElement {
  const name = customFieldName(question);
  const id = customFieldId(question);
  const maxLength = question.max_length ?? (question.type === "text" ? 200 : 1000);

  return (
    <div className={cx(styles.field, styles.editableField)}>
      <label
        className={`${styles.label} ${question.required ? styles.required : ""}`}
        htmlFor={id}
      >
        {question.label}
      </label>
      {question.description ? (
        <p className={styles.help}>{question.description}</p>
      ) : null}

      {question.type === "text" ? (
        <input
          id={id}
          name={name}
          type="text"
          value={answerAsString(value)}
          onChange={(event) => onChange(event.target.value)}
          className="fn-input"
          placeholder={question.placeholder ?? undefined}
          maxLength={maxLength}
          required={question.required}
          disabled={disabled}
          aria-invalid={invalid || undefined}
        />
      ) : null}

      {question.type === "textarea" ? (
        <textarea
          id={id}
          name={name}
          value={answerAsString(value)}
          onChange={(event) => onChange(event.target.value)}
          className="fn-input"
          placeholder={question.placeholder ?? undefined}
          maxLength={maxLength}
          rows={4}
          required={question.required}
          disabled={disabled}
          aria-invalid={invalid || undefined}
        />
      ) : null}

      {question.type === "select" ? (
        <select
          id={id}
          name={name}
          value={answerAsString(value)}
          onChange={(event) => onChange(event.target.value)}
          className="fn-select"
          required={question.required}
          disabled={disabled}
          aria-invalid={invalid || undefined}
        >
          <option value="">選択してください</option>
          {question.options.map((option) => (
            <option key={option} value={option}>{option}</option>
          ))}
        </select>
      ) : null}

      {question.type === "radio" ? (
        <fieldset
          id={id}
          style={{ border: 0, padding: 0, margin: 0 }}
          aria-invalid={invalid || undefined}
        >
          <div style={{ display: "grid", gap: 8 }}>
            {question.options.map((option, index) => (
              <label
                key={option}
                style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 13 }}
              >
                <input
                  type="radio"
                  name={name}
                  value={option}
                  checked={answerAsString(value) === option}
                  onChange={() => onChange(option)}
                  required={question.required && index === 0}
                  disabled={disabled}
                />
                <span>{option}</span>
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}

      {question.type === "checkbox" ? (
        <fieldset
          id={id}
          style={{ border: 0, padding: 0, margin: 0 }}
          aria-invalid={invalid || undefined}
        >
          <div style={{ display: "grid", gap: 8 }}>
            {question.options.map((option) => {
              const selected = answerAsArray(value);
              return (
                <label
                  key={option}
                  style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 13 }}
                >
                  <input
                    type="checkbox"
                    name={name}
                    value={option}
                    checked={selected.includes(option)}
                    onChange={(event) => onChange(
                      event.target.checked
                        ? Array.from(new Set([...selected, option]))
                        : selected.filter((item) => item !== option),
                    )}
                    disabled={disabled}
                  />
                  <span>{option}</span>
                </label>
              );
            })}
          </div>
          {question.required ? (
            <p className={styles.help}>1件以上選択してください。</p>
          ) : null}
        </fieldset>
      ) : null}
    </div>
  );
}

export function VideoForm({
  mode,
  initial = {},
  slotId,
  videoId,
  memberSuggestions = [],
  softwareSuggestions = [],
  xIdOptions = [],
  activeXId,
  disabledSections,
  disabledFields,
  submitBlockedReason,
  iconCandidates = [],
  channelCandidates = [],
  eventOptions = [],
  canEditEvents = true,
  canChangeSubmitter = false,
  editPrivilegeMode,
}: VideoFormProps): React.ReactElement {
  const router = useRouter();
  const formRef = React.useRef<HTMLFormElement>(null);
  const isWizard = mode !== "edit";
  const [currentStep, setCurrentStep] = React.useState<WizardStepKey>("submitter");
  const [maxReachedStepIndex, setMaxReachedStepIndex] = React.useState(0);
  const [stepError, setStepError] = React.useState<WizardValidationError | null>(null);
  const [pending, startTransition] = React.useTransition();
  const [result, setResult] = React.useState<VideoActionResult | null>(null);
  const [dirty, setDirty] = React.useState(false);
  const [youtubeUrl, setYoutubeUrl] = React.useState(initial.youtube_url ?? "");
  const [titlePreview, setTitlePreview] = React.useState(initial.title ?? "");
  const [displayNamePreview, setDisplayNamePreview] = React.useState(
    initial.display_name ?? "",
  );
  const [isCollab, setIsCollab] = React.useState(
    Boolean(initial.is_collab || (initial.members?.length ?? 0) > 0),
  );
  const [members, setMembers] = React.useState<VideoMemberInput[]>(
    initial.members ?? [],
  );
  const [selectedEventIds, setSelectedEventIds] = React.useState<string[]>(
    initial.event_ids ?? [],
  );
  const [selectedPart, setSelectedPart] = React.useState(initial.part ?? "");
  const [customAnswers, setCustomAnswers] = React.useState<
    Record<string, CustomAnswerValue>
  >(() => parseCustomAnswerValuesJson(initial.custom_question_answers_json));
  const [unlockSubmitter, setUnlockSubmitter] = React.useState(false);
  const [editedSubmitter, setEditedSubmitter] = React.useState(
    normalizeXId(initial.creator_x_user_id ?? ""),
  );

  React.useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => {
      if (!dirty || pending) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty, pending]);

  const selectedQuestions = React.useMemo(() => {
    const selected = new Set(selectedEventIds);
    return eventOptions
      .filter((event) => selected.has(event.id))
      .flatMap((event) => event.custom_questions ?? [])
      .filter((question) => question.is_active)
      .sort((a, b) => {
        const eventOrder = selectedEventIds.indexOf(a.event_id) - selectedEventIds.indexOf(b.event_id);
        return eventOrder !== 0 ? eventOrder : a.sort_order - b.sort_order;
      });
  }, [eventOptions, selectedEventIds]);

  const availableParts = React.useMemo(() => {
    const seen = new Set<string>();
    const parts: string[] = [];
    for (const event of eventOptions) {
      if (!selectedEventIds.includes(event.id)) continue;
      for (const part of parsePartsJson(event.parts_json)) {
        if (seen.has(part)) continue;
        seen.add(part);
        parts.push(part);
      }
    }
    return parts;
  }, [eventOptions, selectedEventIds]);

  React.useEffect(() => {
    if (selectedPart && !availableParts.includes(selectedPart)) {
      setSelectedPart("");
    }
  }, [availableParts, selectedPart]);

  const normalizedActiveXId = normalizeXId(activeXId ?? "");
  const normalizedInitialXId = normalizeXId(initial.creator_x_user_id ?? "");
  const fixedSubmitter = mode === "free" || mode === "slot";
  const submitterDisabled = isSectionDisabled(disabledSections, "submitter");
  const videoSectionDisabled = isSectionDisabled(disabledSections, "video");
  const descriptionsDisabled = isSectionDisabled(disabledSections, "descriptions");
  const membersDisabled = isSectionDisabled(disabledSections, "members");
  const fieldDisabled = (key: string): boolean =>
    isFieldDisabled(disabledFields, key) ||
    (key.startsWith("submitter.") && submitterDisabled) ||
    (key.startsWith("video.") && videoSectionDisabled) ||
    (key.startsWith("descriptions.") && descriptionsDisabled) ||
    (key.startsWith("members.") && membersDisabled);

  const canSubmit = !submitBlockedReason && (
    fixedSubmitter ? Boolean(normalizedActiveXId) : Boolean(normalizedInitialXId || editedSubmitter)
  );
  const youtubeId = extractYoutubeId(youtubeUrl);
  const selectedEventLabels = eventOptions
    .filter((event) => selectedEventIds.includes(event.id))
    .map((event) => event.title);
  const memberCount = members.filter(
    (member) => member.name.trim() || member.x_user_id.trim(),
  ).length;
  const currentStepIndex = WIZARD_STEPS.findIndex((step) => step.key === currentStep);

  const isStepVisible = (step: WizardStepKey): boolean =>
    !isWizard || currentStep === step;

  const customAnswerError = (): WizardValidationError | null => {
    if (selectedQuestions.length > MAX_VIDEO_CUSTOM_QUESTIONS) {
      return {
        step: "work",
        message: `カスタム質問は合計${MAX_VIDEO_CUSTOM_QUESTIONS}件までです。`,
      };
    }
    for (const question of selectedQuestions) {
      if (!question.required) continue;
      const value = customAnswers[question.id];
      const answered = Array.isArray(value)
        ? value.length > 0
        : Boolean(value?.trim());
      if (!answered) {
        return {
          step: "work",
          message: `「${question.label}」を入力してください。`,
          fieldId: customFieldId(question),
        };
      }
    }
    return null;
  };

  const validateStep = (step: WizardStepKey): WizardValidationError | null => {
    const formData = formRef.current ? new FormData(formRef.current) : new FormData();
    if (step === "submitter") {
      const displayName = String(formData.get("display_name") ?? "").trim();
      if (!displayName) {
        return { step, message: "表示名を入力してください。", fieldId: "display_name" };
      }
      if (fixedSubmitter && !normalizedActiveXId) {
        return { step, message: "承認済みのActive X IDを選択してください。", fieldId: "creator_x_user_id" };
      }
    }
    if (step === "work") {
      const title = String(formData.get("title") ?? "").trim();
      if (!title) {
        return { step, message: "作品タイトルを入力してください。", fieldId: "title" };
      }
      const questionError = customAnswerError();
      if (questionError) return questionError;
      if (isCollab && memberCount === 0) {
        return { step, message: "合作作品には1人以上のメンバーを入力してください。" };
      }
    }
    if (step === "youtube") {
      if (!extractYoutubeId(youtubeUrl)) {
        return { step, message: "有効なYouTube URLを入力してください。", fieldId: "youtube_url" };
      }
    }
    if (step === "confirm" && mode !== "edit") {
      if (String(formData.get("accept_policy") ?? "") !== "1") {
        return { step, message: "投稿内容と利用条件の確認に同意してください。", fieldId: "accept_policy" };
      }
    }
    return null;
  };

  const focusValidationError = (error: WizardValidationError) => {
    setStepError(error);
    setCurrentStep(error.step);
    window.setTimeout(() => {
      if (error.fieldId) document.getElementById(error.fieldId)?.focus();
      document.getElementById("wizard-validation-error")?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    }, 0);
  };

  const goNext = () => {
    const error = validateStep(currentStep);
    if (error) {
      focusValidationError(error);
      return;
    }
    setStepError(null);
    const nextIndex = Math.min(currentStepIndex + 1, WIZARD_STEPS.length - 1);
    setMaxReachedStepIndex((current) => Math.max(current, nextIndex));
    setCurrentStep(WIZARD_STEPS[nextIndex].key);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const goBack = () => {
    setStepError(null);
    const previousIndex = Math.max(currentStepIndex - 1, 0);
    setCurrentStep(WIZARD_STEPS[previousIndex].key);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    for (const step of WIZARD_STEPS) {
      const error = validateStep(step.key);
      if (error) {
        focusValidationError(error);
        return;
      }
    }

    const formData = new FormData(event.currentTarget);
    setResult(null);
    setStepError(null);
    startTransition(async () => {
      const action = mode === "slot"
        ? submitSlotVideo
        : mode === "edit"
          ? updateVideo
          : createFreeVideo;
      const response = await action(formData);
      const currentPath = typeof window === "undefined"
        ? "/"
        : `${window.location.pathname}${window.location.search}`;
      if (!response.ok && redirectForGuardReason(router, response.reason, currentPath)) {
        setDirty(false);
        return;
      }
      setResult(response);
      if (response.ok) {
        setDirty(false);
        if (mode === "edit") router.refresh();
      }
    });
  };

  return (
    <form
      ref={formRef}
      className={styles.form}
      onSubmit={handleSubmit}
      onChange={() => setDirty(true)}
      noValidate={isWizard}
    >
      {slotId ? <input type="hidden" name="slot_id" value={slotId} /> : null}
      {videoId ? <input type="hidden" name="video_id" value={videoId} /> : null}
      <input type="hidden" name="mode" value={mode} />
      {mode === "edit" && editPrivilegeMode ? (
        <input type="hidden" name="edit_privilege_mode" value={editPrivilegeMode} />
      ) : null}
      {softwareSuggestions.length > 0 ? (
        <datalist id="used-software-suggestions">
          {softwareSuggestions.map((name, index) => (
            <option key={`${name}-${index}`} value={name} />
          ))}
        </datalist>
      ) : null}

      {isWizard ? (
        <nav className={styles.stepper} aria-label="投稿手順">
          <div
            className={styles.stepProgress}
            style={{
              width: `${(currentStepIndex / (WIZARD_STEPS.length - 1)) * 100}%`,
            }}
            aria-hidden
          />
          {WIZARD_STEPS.map((step, index) => {
            const isCurrent = step.key === currentStep;
            const isComplete = index < currentStepIndex;
            const isReachable = index <= maxReachedStepIndex;
            return (
              <button
                key={step.key}
                type="button"
                className={cx(
                  styles.stepItem,
                  isCurrent && styles.stepCurrent,
                  isComplete && styles.stepComplete,
                  !isCurrent && !isComplete && styles.stepUpcoming,
                )}
                aria-current={isCurrent ? "step" : undefined}
                disabled={!isReachable}
                onClick={() => {
                  if (!isReachable) return;
                  setStepError(null);
                  setCurrentStep(step.key);
                }}
              >
                <span className={styles.stepDot}>
                  <Icon name={isComplete ? "check" : step.icon} size={13} aria-hidden />
                </span>
                <span className={styles.stepLabel}>{step.label}</span>
              </button>
            );
          })}
        </nav>
      ) : null}

      {stepError ? (
        <div
          id="wizard-validation-error"
          role="alert"
          className="fn-status-panel fn-status-panel--warn"
          style={{ marginBottom: 12 }}
        >
          <Icon name="warning" size={13} aria-hidden /> {stepError.message}
        </div>
      ) : null}

      <div className={styles.formMain}>
        <div
          className={cx(styles.stepPanel, !isStepVisible("submitter") && styles.stepPanelHidden)}
          hidden={!isStepVisible("submitter")}
        >
          <section
            className={cx(styles.section, submitterDisabled && styles.sectionDisabled)}
            data-disabled={submitterDisabled || undefined}
          >
            <h2 className={styles.sectionTitle}>
              <Icon name="user" size={14} aria-hidden /> 提出者情報
              {submitterDisabled ? (
                <span className={styles.sectionDisabledBadge}>編集権限なし</span>
              ) : null}
            </h2>

            <div className={`${styles.row} ${styles.cols2}`}>
              <div className={cx(styles.field, styles.editableField)}>
                <label className={`${styles.label} ${styles.required}`} htmlFor="creator_x_user_id">
                  提出主体 X ID
                </label>
                {fixedSubmitter ? (
                  <input
                    id="creator_x_user_id"
                    name="creator_x_user_id"
                    value={normalizedActiveXId}
                    readOnly
                    className="fn-input"
                    required
                  />
                ) : canChangeSubmitter ? (
                  <>
                    {!unlockSubmitter ? (
                      <input
                        id="creator_x_user_id"
                        name="creator_x_user_id"
                        value={normalizedInitialXId}
                        readOnly
                        className="fn-input"
                      />
                    ) : (
                      <>
                        <input type="hidden" name="allow_submitter_change" value="1" />
                        <select
                          id="creator_x_user_id"
                          name="creator_x_user_id"
                          value={editedSubmitter}
                          onChange={(event) => setEditedSubmitter(event.target.value)}
                          className="fn-select"
                          required
                        >
                          {xIdOptions.map((option) => (
                            <option key={option.id} value={normalizeXId(option.id)}>
                              {option.x_name} (@{normalizeXId(option.id)})
                            </option>
                          ))}
                        </select>
                      </>
                    )}
                    <label style={{ display: "flex", gap: 7, marginTop: 7, fontSize: 12 }}>
                      <input
                        type="checkbox"
                        checked={unlockSubmitter}
                        onChange={(event) => setUnlockSubmitter(event.target.checked)}
                      />
                      管理者権限で提出主体を変更する
                    </label>
                  </>
                ) : (
                  <input
                    id="creator_x_user_id"
                    name="creator_x_user_id"
                    value={normalizedInitialXId}
                    readOnly
                    className="fn-input"
                  />
                )}
              </div>

              <div className={cx(styles.field, styles.editableField)}>
                <label className={`${styles.label} ${styles.required}`} htmlFor="display_name">
                  表示名 / 活動名 / 団体名
                </label>
                <input
                  id="display_name"
                  name="display_name"
                  type="text"
                  defaultValue={initial.display_name}
                  onChange={(event) => setDisplayNamePreview(event.target.value)}
                  className="fn-input"
                  maxLength={80}
                  required
                  readOnly={fieldDisabled("submitter.display_name")}
                  aria-invalid={stepError?.fieldId === "display_name" || undefined}
                />
              </div>
            </div>

            <div className={cx(styles.field, styles.editableField)}>
              <label className={styles.label}>作品アイコン</label>
              <VideoIconPicker
                candidates={iconCandidates}
                initialIconUrl={initial.icon_url}
                disabled={fieldDisabled("submitter.icon_url")}
              />
            </div>

            <div className={cx(styles.field, styles.editableField)}>
              <label className={styles.label} htmlFor="profile_text">自分・団体の概要</label>
              <textarea
                id="profile_text"
                name="profile_text"
                defaultValue={initial.profile_text}
                className="fn-input"
                rows={3}
                maxLength={1000}
                disabled={fieldDisabled("submitter.profile_text")}
              />
            </div>

            <div className={cx(styles.field, styles.editableField)}>
              <span className={styles.label}>YouTube チャンネル</span>
              <YoutubeChannelPicker
                defaultValue={initial.youtube_channel_url ?? null}
                candidates={channelCandidates}
                disabled={fieldDisabled("submitter.youtube_channel_url")}
              />
            </div>

            <div className={cx(styles.field, styles.editableField)}>
              <SocialLinksEditor
                initialValue={initial.other_social_links ?? null}
                disabled={fieldDisabled("submitter.other_social_links")}
              />
            </div>
          </section>
        </div>

        <div
          className={cx(styles.stepPanel, !isStepVisible("work") && styles.stepPanelHidden)}
          hidden={!isStepVisible("work")}
        >
          <section
            className={cx(styles.section, videoSectionDisabled && styles.sectionDisabled)}
            data-disabled={videoSectionDisabled || undefined}
          >
            <h2 className={styles.sectionTitle}>
              <Icon name="edit" size={14} aria-hidden /> 作品基本情報
              {videoSectionDisabled ? (
                <span className={styles.sectionDisabledBadge}>編集権限なし</span>
              ) : null}
            </h2>

            <div className={cx(styles.field, styles.editableField)}>
              <label className={`${styles.label} ${styles.required}`} htmlFor="title">
                作品タイトル
              </label>
              <input
                id="title"
                name="title"
                type="text"
                defaultValue={initial.title}
                onChange={(event) => setTitlePreview(event.target.value)}
                className="fn-input"
                maxLength={120}
                required
                readOnly={fieldDisabled("video.title")}
                aria-invalid={stepError?.fieldId === "title" || undefined}
              />
            </div>

            <div className={`${styles.row} ${styles.cols2}`}>
              <div className={cx(styles.field, styles.editableField)}>
                <label className={styles.label} htmlFor="music">使用楽曲</label>
                <input
                  id="music"
                  name="music"
                  type="text"
                  defaultValue={initial.music}
                  className="fn-input"
                  placeholder="アーティスト名 - 曲名"
                  maxLength={200}
                  readOnly={fieldDisabled("video.music")}
                />
                <input
                  id="music_reference_url"
                  name="music_reference_url"
                  type="url"
                  defaultValue={initial.music_reference_url}
                  className="fn-input"
                  placeholder="楽曲リンク URL"
                  maxLength={500}
                  readOnly={fieldDisabled("video.music")}
                  style={{ marginTop: 6 }}
                />
              </div>
              <div className={cx(styles.field, styles.editableField)}>
                <label className={styles.label} htmlFor="credit">クレジット</label>
                <input
                  id="credit"
                  name="credit"
                  type="text"
                  defaultValue={initial.credit}
                  className="fn-input"
                  maxLength={200}
                  readOnly={fieldDisabled("video.credit")}
                />
              </div>
            </div>

            {eventOptions.length > 0 ? (
              <div className={cx(styles.field, styles.editableField)}>
                <label className={styles.label}>所属イベント</label>
                <p className={styles.help}>
                  複数選択できます。選択イベントをまたぐ追加質問は合計
                  {MAX_VIDEO_CUSTOM_QUESTIONS}件までです。
                </p>
                <input type="hidden" name="event_ids" value={selectedEventIds.join(",")} />
                <div className={styles.eventOptionGrid}>
                  {eventOptions.map((event) => {
                    const checked = selectedEventIds.includes(event.id);
                    const nextIds = checked
                      ? selectedEventIds
                      : [...selectedEventIds, event.id];
                    const exceedsEventLimit = !checked && selectedEventIds.length >= MAX_ATOMIC_VIDEO_EVENTS;
                    const exceedsQuestionLimit = !checked &&
                      questionCountForEvents(eventOptions, nextIds) > MAX_VIDEO_CUSTOM_QUESTIONS;
                    const locked = !canEditEvents || (
                      mode === "slot" && Boolean(initial.event_ids?.includes(event.id))
                    );
                    return (
                      <label
                        key={event.id}
                        className={`${styles.eventOption} ${checked ? styles.eventOptionChecked : ""} ${locked ? styles.eventOptionLocked : ""}`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={locked || exceedsEventLimit || exceedsQuestionLimit}
                          onChange={(changeEvent) => {
                            if (locked) return;
                            setSelectedEventIds((current) => changeEvent.target.checked
                              ? Array.from(new Set([...current, event.id]))
                              : current.filter((eventId) => eventId !== event.id));
                          }}
                        />
                        <span style={{ flex: 1, minWidth: 0 }}>{event.title}</span>
                        {(event.custom_questions?.length ?? 0) > 0 ? (
                          <span className="fn-badge fn-badge-soft">
                            質問 {event.custom_questions?.length}件
                          </span>
                        ) : null}
                      </label>
                    );
                  })}
                </div>
              </div>
            ) : null}

            {mode === "slot" ? (
              <input type="hidden" name="part" value={initial.part ?? ""} />
            ) : availableParts.length > 0 ? (
              <div className={cx(styles.field, styles.editableField)}>
                <label className={styles.label} htmlFor="part">部</label>
                <select
                  id="part"
                  name="part"
                  className="fn-select"
                  value={selectedPart}
                  onChange={(event) => setSelectedPart(event.target.value)}
                  disabled={fieldDisabled("video.part")}
                >
                  <option value="">(未設定)</option>
                  {availableParts.map((part) => (
                    <option key={part} value={part}>{part}</option>
                  ))}
                </select>
              </div>
            ) : (
              <input type="hidden" name="part" value="" />
            )}
          </section>

          <section
            className={cx(styles.section, descriptionsDisabled && styles.sectionDisabled)}
            data-disabled={descriptionsDisabled || undefined}
          >
            <h2 className={styles.sectionTitle}>
              <Icon name="edit" size={14} aria-hidden /> 紹介文・追加質問
              {descriptionsDisabled ? (
                <span className={styles.sectionDisabledBadge}>編集権限なし</span>
              ) : null}
            </h2>

            <div className={cx(styles.field, styles.editableField)}>
              <label className={styles.label} htmlFor="intro_comment">紹介コメント</label>
              <textarea
                id="intro_comment"
                name="intro_comment"
                defaultValue={initial.intro_comment}
                className="fn-input"
                rows={3}
                maxLength={500}
                disabled={fieldDisabled("descriptions.intro_comment")}
              />
            </div>

            <div className={cx(styles.field, styles.editableField)}>
              <label className={styles.label} htmlFor="highlights">みどころ</label>
              <textarea
                id="highlights"
                name="highlights"
                defaultValue={initial.highlights}
                className="fn-input"
                rows={4}
                maxLength={1000}
                disabled={fieldDisabled("descriptions.highlights")}
              />
            </div>

            <div className={cx(styles.field, styles.editableField)}>
              <label className={styles.label} htmlFor="production_story">制作エピソード</label>
              <textarea
                id="production_story"
                name="production_story"
                defaultValue={initial.production_story}
                className="fn-input"
                rows={4}
                maxLength={1000}
                disabled={fieldDisabled("descriptions.production_story")}
              />
            </div>

            <div className={cx(styles.field, styles.editableField)}>
              <label className={styles.label} htmlFor="used_software">使用ソフト</label>
              <input
                id="used_software"
                name="used_software"
                type="text"
                defaultValue={initial.used_software}
                className="fn-input"
                maxLength={200}
                list="used-software-suggestions"
                disabled={fieldDisabled("descriptions.used_software")}
              />
              <p className={styles.help}>
                カンマ区切りで最大{MAX_ATOMIC_VIDEO_SOFTWARES}件です。
              </p>
            </div>

            {selectedQuestions.length > 0 ? (
              <div style={{
                display: "grid",
                gap: 14,
                margin: "18px 0",
                padding: 14,
                border: "1px solid var(--border-subtle)",
                borderRadius: "var(--radius-sm)",
                background: "var(--bg-elevated)",
              }}>
                <div>
                  <h3 style={{ margin: 0, fontSize: 14 }}>イベント追加質問</h3>
                  <p className={styles.help} style={{ marginTop: 4 }}>
                    選択したイベントに設定された質問です。
                  </p>
                </div>
                {selectedQuestions.map((question) => (
                  <CustomQuestionInput
                    key={question.id}
                    question={question}
                    value={customAnswers[question.id]}
                    disabled={descriptionsDisabled}
                    invalid={stepError?.fieldId === customFieldId(question)}
                    onChange={(value) => {
                      setCustomAnswers((current) => ({
                        ...current,
                        [question.id]: value,
                      }));
                      setDirty(true);
                    }}
                  />
                ))}
              </div>
            ) : null}

            <div className={cx(styles.field, styles.editableField)}>
              <label className={styles.label} htmlFor="closing_comment">あとがき</label>
              <textarea
                id="closing_comment"
                name="closing_comment"
                defaultValue={initial.closing_comment}
                className="fn-input"
                rows={3}
                maxLength={500}
                disabled={fieldDisabled("descriptions.closing_comment")}
              />
            </div>
          </section>

          <section
            className={cx(styles.section, membersDisabled && styles.sectionDisabled)}
            data-disabled={membersDisabled || undefined}
          >
            <h2 className={styles.sectionTitle}>
              <Icon name="users" size={14} aria-hidden /> 合作メンバー
              {membersDisabled ? (
                <span className={styles.sectionDisabledBadge}>編集権限なし</span>
              ) : null}
            </h2>
            <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 13 }}>
              <input type="hidden" name="is_collab" value="false" />
              <input
                type="checkbox"
                name="is_collab"
                value="true"
                checked={isCollab}
                onChange={(event) => setIsCollab(event.target.checked)}
                disabled={membersDisabled}
              />
              合作作品として登録する
            </label>
            {isCollab ? (
              <div style={{ marginTop: 12 }}>
                <VideoMembersField
                  initialMembers={initial.members}
                  suggestions={memberSuggestions}
                  disabled={membersDisabled}
                  onChange={setMembers}
                  collabPermsHref="#video-collab-perms"
                />
              </div>
            ) : null}
          </section>
        </div>

        <div
          className={cx(styles.stepPanel, !isStepVisible("youtube") && styles.stepPanelHidden)}
          hidden={!isStepVisible("youtube")}
        >
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>
              <Icon name="youtube" size={14} aria-hidden /> YouTube URL 登録
            </h2>
            <div className={cx(styles.field, styles.editableField)}>
              <label className={`${styles.label} ${styles.required}`} htmlFor="youtube_url">
                YouTube URL
              </label>
              <input
                id="youtube_url"
                name="youtube_url"
                type="url"
                value={youtubeUrl}
                onChange={(event) => setYoutubeUrl(event.target.value)}
                className="fn-input"
                placeholder="https://www.youtube.com/watch?v=..."
                required
                readOnly={fieldDisabled("video.youtube_url")}
                aria-invalid={stepError?.fieldId === "youtube_url" || undefined}
              />
              {youtubeId ? (
                <div style={{ marginTop: 12, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={youtubeThumbUrl(youtubeId)}
                    alt="YouTube サムネイル"
                    style={{ width: 240, maxWidth: "100%", borderRadius: 8 }}
                  />
                  <a
                    href={youtubeWatchUrl(youtubeId)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="fn-btn fn-btn-ghost fn-btn-sm"
                  >
                    YouTube で確認
                  </a>
                </div>
              ) : (
                <p className={styles.help}>URLを入力すると動画IDとサムネイルを確認します。</p>
              )}
            </div>
          </section>
        </div>

        <div
          className={cx(styles.stepPanel, !isStepVisible("confirm") && styles.stepPanelHidden)}
          hidden={!isStepVisible("confirm")}
        >
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>
              <Icon name="check" size={14} aria-hidden /> 投稿内容の確認
            </h2>
            <div style={{ display: "grid", gap: 10, fontSize: 13 }}>
              <p style={{ margin: 0 }}><strong>作品:</strong> {titlePreview.trim() || "未入力"}</p>
              <p style={{ margin: 0 }}><strong>表示名:</strong> {displayNamePreview.trim() || "未入力"}</p>
              <p style={{ margin: 0 }}><strong>イベント:</strong> {selectedEventLabels.join(" / ") || "所属なし"}</p>
              <p style={{ margin: 0 }}><strong>追加質問:</strong> {selectedQuestions.length}件</p>
              <p style={{ margin: 0 }}><strong>合作メンバー:</strong> {memberCount}人</p>
              <p style={{ margin: 0 }}><strong>YouTube:</strong> {youtubeId ?? "未入力"}</p>
            </div>
            {youtubeId ? (
              <Link
                href={youtubeWatchUrl(youtubeId)}
                target="_blank"
                className="fn-btn fn-btn-ghost fn-btn-sm"
                style={{ marginTop: 12, justifySelf: "start" }}
              >
                YouTube動画を確認
              </Link>
            ) : null}
            {mode !== "edit" ? (
              <label style={{ display: "flex", gap: 8, alignItems: "flex-start", marginTop: 16, fontSize: 13 }}>
                <input id="accept_policy" name="accept_policy" type="checkbox" value="1" />
                <span>投稿内容と利用条件を確認し、この内容で送信することに同意します。</span>
              </label>
            ) : null}
          </section>
        </div>
      </div>

      {submitBlockedReason ? (
        <p role="alert" style={{ color: "var(--accent-danger)", fontSize: 13 }}>
          <Icon name="warning" size={13} aria-hidden /> {submitBlockedReason}
        </p>
      ) : null}
      {result ? (
        <div
          role={result.ok ? "status" : "alert"}
          className={result.ok ? "fn-status-panel" : "fn-status-panel fn-status-panel--warn"}
        >
          <p style={{ margin: 0 }}>{result.message ?? (result.ok ? "保存しました。" : "保存できませんでした。")}</p>
          {result.ok && result.videoId ? (
            <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
              <Link href={`/${result.youtubeVideoId ?? result.videoId}`} className="fn-btn fn-btn-primary fn-btn-sm">
                公開ページを見る
              </Link>
              <Link href={`/dashboard/edit/${result.videoId}`} className="fn-btn fn-btn-ghost fn-btn-sm">
                編集を続ける
              </Link>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className={cx(styles.actions, isWizard && styles.bottomNav)}>
        {isWizard && currentStepIndex > 0 ? (
          <button type="button" className="fn-btn fn-btn-ghost" onClick={goBack} disabled={pending}>
            戻る
          </button>
        ) : null}
        {isWizard && currentStepIndex < WIZARD_STEPS.length - 1 ? (
          <button type="button" className="fn-btn fn-btn-primary" onClick={goNext} disabled={pending}>
            次へ
          </button>
        ) : (
          <button
            type="submit"
            className="fn-btn fn-btn-primary"
            disabled={pending || !canSubmit}
            aria-busy={pending}
          >
            <Icon name="check" size={13} aria-hidden />
            {pending ? "保存中…" : mode === "edit" ? "変更を保存" : "作品を投稿"}
          </button>
        )}
      </div>
    </form>
  );
}
