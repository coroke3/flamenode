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
import { ErrorCallout } from "@/components/ui/ErrorCallout";
import { PublicReflectionDelayNotice } from "@/components/ui/PublicReflectionDelayNotice";
import {
  getStagePermissionAnswerValue,
  resolveStagePermissionFieldsFromJson,
} from "@/lib/video/formSettings";
import { redirectForGuardReason } from "@/lib/client/guardRedirect";
import {
  ACTIVE_X_BEFORE_SWITCH_EVENT,
} from "@/lib/client/activeXSwitchEvents";
import {
  MAX_ATOMIC_VIDEO_EVENTS,
  MAX_ATOMIC_VIDEO_SOFTWARES,
} from "@/lib/video/atomicLimits";
import type { VideoEditPermissionViewModel } from "@/lib/video/videoEditPermissionView";
import {
  hasAnyEditableVideoFormSection,
  resolvePermissionUnlockHint,
} from "@/lib/video/permissionUnlockHint";
import { PermissionBadge } from "@/components/video/permission/PermissionBadge";
import { FieldLockNote } from "@/components/video/permission/FieldLockNote";
import { PermissionFieldLabel } from "@/components/video/permission/PermissionFieldLabel";
import { YoutubeDescriptionPreview } from "@/components/forms/YoutubeDescriptionPreview";
import {
  formatYoutubeDescriptionMembers,
  type YoutubeDescriptionContext,
} from "@/lib/event/youtubeDescriptionTemplate";
import type { CustomQuestion } from "@/lib/video/customQuestions";

/** X ID 既定プロフィール。「再適用」ボタン用。作品スナップショットとは別。 */
export interface VideoDefaultProfile {
  display_name?: string;
  icon_url?: string | null;
  profile_text?: string | null;
  youtube_channel_url?: string | null;
  other_social_links?: string | null;
}

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
  /** 一般イベント質問の既存回答。キーは `${eventId}:${questionKey}`。 */
  custom_answers?: Record<string, string | string[]>;
  highlights?: string;
  production_story?: string;
  closing_comment?: string;
  is_collab?: boolean;
  members?: VideoMemberInput[];
  /** この作品が所属するイベント ID 一覧 (video_events 経由)。 */
  event_ids?: string[];
  /** 作品が選択した「部」(events.parts_json の候補から)。未設定なら null/空文字。 */
  part?: string | null;
}

/** VideoForm のイベント選択肢。 */
export interface EventOption {
  id: string;
  title: string;
  video_form_settings_json?: string | null;
  youtube_description_template?: string | null;
  youtube_description_event_url?: string | null;
  /** イベントに設定された「部」候補 (JSON 文字列)。null/空配列なら部 UI を出さない。 */
  parts_json?: string | null;
  /** イベントに設定された一般カスタム質問。 */
  custom_questions?: CustomQuestion[];
}

function parsePartsJson(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v): v is string => typeof v === "string" && v.trim().length > 0);
  } catch {
    return [];
  }
}

function customAnswerKey(eventId: string, questionKey: string): string {
  return `${eventId}:${questionKey}`;
}

function customQuestionFieldId(eventId: string, questionKey: string): string {
  return `custom_answer_${eventId}_${questionKey}`;
}

function customAnswerValues(value: string | string[] | undefined): string[] {
  if (Array.isArray(value)) return value.map((item) => item.trim()).filter(Boolean);
  return value?.trim() ? [value.trim()] : [];
}

export interface XIdOption {
  id: string;
  x_name: string;
}

type WizardStepKey = "submitter" | "work" | "youtube" | "confirm";

export type WizardValidationError = {
  message: string;
  fieldId?: string;
  step: WizardStepKey;
};

const WIZARD_STEPS_SLOT: { key: WizardStepKey; label: string }[] = [
  { key: "submitter", label: "提出者情報" },
  { key: "work", label: "作品情報" },
  { key: "youtube", label: "YouTube URL" },
  { key: "confirm", label: "確認・送信" },
];

const WIZARD_STEPS_FREE = WIZARD_STEPS_SLOT;

interface VideoFormProps {
  mode: "free" | "slot" | "edit";
  initial?: VideoFormInitialValues;
  slotId?: string;
  videoId?: string;
  memberSuggestions?: VideoMemberSuggestion[];
  softwareSuggestions?: string[];
  xIdOptions?: XIdOption[];
  activeXId?: string | null;
  /** free/slot 提出時の active_x_snapshot 用。正規化済み Active X ID。 */
  activeXSnapshot?: string | null;
  /**
   * 編集権限がない section の key 一覧。
   * 指定された section は opacity / pointer-events で不活性化され、
   * 内部の input 類に disabled 属性が付与される。
   *
   * 取りうる値: "submitter" | "video" | "descriptions" | "members"
   *
   * 省略時はすべて編集可能 (既存動作を維持)。
   *
   * 注意: これはフロント表示の補助のみ。
   * サーバー側権限チェック (updateVideo Server Action) は独立して実行される。
   */
  disabledSections?: string[];
  disabledFields?: string[];
  /**
   * 投稿ボタンを押せないようにする理由文。
   * 未承認 Active X ID など、サーバー側 writeGuard で必ず弾かれる状態のとき、
   * 「押せるけど失敗する」UX を避けるためにフォーム側で表示・無効化する。
   */
  submitBlockedReason?: string;
  /**
   * 作品アイコンの候補リスト。サーバー側で `getXIconCandidates(db, xId)` から取得する。
   * x_users.icon_url / 同 X ID の過去 videos.creator_icon_url を新しい順で含む。
   */
  iconCandidates?: string[];
  /**
   * YouTube チャンネル URL の候補。`getYoutubeChannelCandidates(db, xId)` から取得
   * (当該 X ID が creator の作品投稿時に記録した URL を含む。アクティブ X ID とは無関係)。
   */
  channelCandidates?: string[];
  /**
   * 所属イベントの選択肢 (受付中のイベント等)。複数チェック可能で、
   * 出力は hidden input `event_ids` (改行区切り) で渡される。
   * 未指定なら所属イベント選択 UI は表示しない (現在の挙動互換)。
   */
  eventOptions?: EventOption[];
  /**
   * 所属イベントの編集権限。false なら表示のみ (チェックボックス操作不可)。
   * デフォルト true。slot モードでは slot.event_id は固定で含まれる。
   */
  canEditEvents?: boolean;
  /**
   * 提出主体 X ID を変更できるか。デフォルト false。
   * true でも UI は「解除チェックボックス → <select>」の二段階で、
   * 解除した時のみ hidden `allow_submitter_change=1` が送信される。
   * サーバー側でも `role === "admin"` を再検証するため、UI 操作だけでは突破できない。
   */
  canChangeSubmitter?: boolean;
  /**
   * 編集モード時のクライアント側 privilegeMode。サーバー側 hidden として
   * `edit_privilege_mode` で送信される。サーバーは別途 URL/セッションから再検証する。
   */
  editPrivilegeMode?: "normal" | "admin" | "event";
  /**
   * 現在の X ID 既定プロフィール。提出者情報の「再適用」ボタン用。
   * フォーム初期値とは別に渡す (編集時は video.creator_* が初期値)。
   */
  defaultProfile?: VideoDefaultProfile;
  /** 編集モード時の権限 ViewModel。指定時のみ権限 UI を有効化する。 */
  permissionView?: VideoEditPermissionViewModel;
  /** 選択中イベントの概要欄テンプレートに渡す、作品に紐づく固定値。 */
  youtubeDescriptionContext?: YoutubeDescriptionContext;
  /** 初期表示時に優先するイベント（通常は作品の primary event）。 */
  youtubeDescriptionEventId?: string | null;
}

/** section key が disabledSections に含まれているか確認する小関数。 */
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

/** CSS クラス名を条件結合する軽量ヘルパー。外部依存不要。 */
function cx(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(" ");
}

function videoFormLockNoteId(key: string): string {
  return `video-form-lock-${key}`;
}

function mergeDescribedBy(...ids: (string | undefined)[]): string | undefined {
  const filtered = ids.filter(Boolean);
  return filtered.length > 0 ? filtered.join(" ") : undefined;
}

const DESCRIPTION_FIELD_NAMES = [
  "display_name",
  "profile_text",
  "youtube_channel_url",
  "other_social_links",
  "title",
  "youtube_url",
  "music",
  "credit",
  "intro_comment",
  "highlights",
  "production_story",
  "used_software",
  "closing_comment",
  "creator_x_user_id",
] as const;

function readDescriptionFormValues(
  form: HTMLFormElement,
): Record<string, string> {
  const formData = new FormData(form);
  return Object.fromEntries(
    DESCRIPTION_FIELD_NAMES.map((name) => [
      name,
      String(formData.get(name) ?? ""),
    ]),
  );
}

function resolvePermissionSubmitBlockedHint(
  viewModel: VideoEditPermissionViewModel,
): string | null {
  if (hasAnyEditableVideoFormSection(viewModel)) return null;
  if (viewModel.canOfferEventMode) {
    return "イベント運営権限で編集できる項目があります。上部の「イベント運営権限で編集」を選択してください。";
  }
  if (viewModel.canOfferAdminMode) {
    return "管理者権限で編集できる項目があります。上部の「管理者権限で編集」を選択してください。";
  }
  return "現在の権限では編集できる項目がありません。";
}

/**
 * 作品投稿/編集フォーム。
 * 設計図 (post/page.md, post/slotted/page.md, edit/[id]/page.md) を統合。
 * Server Action と React 19 の `useTransition` で進行中状態と結果を扱う。
 */
export function VideoForm({
  mode,
  initial = {},
  slotId,
  videoId,
  memberSuggestions = [],
  softwareSuggestions = [],
  xIdOptions = [],
  activeXId,
  activeXSnapshot,
  disabledSections,
  disabledFields,
  submitBlockedReason,
  iconCandidates = [],
  channelCandidates = [],
  eventOptions = [],
  canEditEvents = true,
  canChangeSubmitter = false,
  editPrivilegeMode,
  defaultProfile,
  permissionView,
  youtubeDescriptionContext,
  youtubeDescriptionEventId,
}: VideoFormProps): React.ReactElement {
  const router = useRouter();
  const formRef = React.useRef<HTMLFormElement>(null);
  const isWizard = mode === "slot" || mode === "free";
  const wizardSteps = mode === "slot" ? WIZARD_STEPS_SLOT : WIZARD_STEPS_FREE;
  const [currentStep, setCurrentStep] = React.useState(0);
  const [maxReachedStep, setMaxReachedStep] = React.useState(0);
  const [stepError, setStepError] = React.useState<WizardValidationError | null>(null);
  const [youtubeUrl, setYoutubeUrl] = React.useState(initial.youtube_url ?? "");
  const [titlePreview, setTitlePreview] = React.useState(initial.title ?? "");
  const [submitterDisplayName, setSubmitterDisplayName] = React.useState(
    initial.display_name ?? "",
  );
  const [submitterProfileText, setSubmitterProfileText] = React.useState(
    initial.profile_text ?? "",
  );
  const [submitterIconUrl, setSubmitterIconUrl] = React.useState(
    initial.icon_url ?? "",
  );
  const [submitterYoutubeChannel, setSubmitterYoutubeChannel] = React.useState(
    initial.youtube_channel_url ?? "",
  );
  const [submitterSocialLinks, setSubmitterSocialLinks] = React.useState(
    initial.other_social_links ?? "",
  );
  const [submitterFieldsKey, setSubmitterFieldsKey] = React.useState(0);
  const displayNamePreview = submitterDisplayName;
  const [isCollab, setIsCollab] = React.useState(
    Boolean(initial.is_collab || (initial.members?.length ?? 0) > 0),
  );
  const [members, setMembers] = React.useState<VideoMemberInput[]>(
    initial.members ?? [],
  );
  const [descriptionFormValues, setDescriptionFormValues] = React.useState<
    Record<string, string>
  >({});
  // 所属イベントの選択状態。slot モードでは slot.event_id が initial.event_ids
  // に含まれている前提で、固定として扱う (UI でも変更不可)。
  const [selectedEventIds, setSelectedEventIds] = React.useState<string[]>(
    initial.event_ids ?? [],
  );
  // 部 (作品の分類)。所属イベントの parts_json から選ぶ。
  const [selectedPart, setSelectedPart] = React.useState<string>(
    initial.part ?? "",
  );
  const [customAnswers, setCustomAnswers] = React.useState<
    Record<string, string | string[]>
  >(initial.custom_answers ?? {});
  // 所属イベントの parts_json から、選択可能な部の候補 (重複排除) を作る。
  const availableParts = React.useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const event of eventOptions) {
      if (!selectedEventIds.includes(event.id)) continue;
      for (const part of parsePartsJson(event.parts_json)) {
        if (seen.has(part)) continue;
        seen.add(part);
        out.push(part);
      }
    }
    return out;
  }, [eventOptions, selectedEventIds]);
  // 選択中の部が、現在の候補に含まれていない場合は自動でクリアする。
  // (イベント所属を外したときに古い値が残らないようにする)
  React.useEffect(() => {
    if (selectedPart && !availableParts.includes(selectedPart)) {
      setSelectedPart("");
    }
  }, [availableParts, selectedPart]);
  const selectedStagePermissionFields = React.useMemo(
    () =>
      resolveStagePermissionFieldsFromJson(
        eventOptions
          .filter((event) => selectedEventIds.includes(event.id))
          .map((event) => event.video_form_settings_json),
      ),
    [eventOptions, selectedEventIds],
  );
  const selectedCustomQuestions = React.useMemo(
    () =>
      eventOptions.flatMap((event) =>
        selectedEventIds.includes(event.id)
          ? (event.custom_questions ?? []).map((question) => ({
              event,
              question,
            }))
          : [],
      ),
    [eventOptions, selectedEventIds],
  );
  const [stageAnswers, setStageAnswers] = React.useState<Record<string, string>>({});

  React.useEffect(() => {
    setStageAnswers((current) => {
      let changed = false;
      const next = { ...current };
      for (const question of selectedStagePermissionFields) {
        if (Object.hasOwn(next, question.id)) continue;
        next[question.id] = getStagePermissionAnswerValue(
          initial.custom_question_answers_json,
          question.id,
        );
        changed = true;
      }
      return changed ? next : current;
    });
  }, [initial.custom_question_answers_json, selectedStagePermissionFields]);

  const [pending, startTransition] = React.useTransition();
  // useTransition の pending が反映される前の同一イベントループでも、
  // 2つある submit ボタン（PC / モバイル）からの二重送信を拒否する。
  const submitInFlightRef = React.useRef(false);
  const [result, setResult] = React.useState<VideoActionResult | null>(null);
  // 未保存変更がある状態でブラウザを離れようとしたときに警告を出すための dirty 判定。
  // 入力長文 (紹介文・メンバー編集・アイコン選択) を持つフォームなので、
  // 誤ってリロード / タブ閉じが起きると入力が失われる事故を避ける。
  const [dirty, setDirty] = React.useState(false);

  React.useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      // 送信中・送信完了直後・dirty でない場合は警告しない。
      if (!dirty || pending) return;
      e.preventDefault();
      // Chrome 系では returnValue を空文字でも default 警告を出す。
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty, pending]);

  React.useEffect(() => {
    const handler = (event: Event) => {
      if (!dirty || pending) return;
      const confirmed = window.confirm(
        "入力中の作品情報があります。Active X ID を切り替えると内容が失われます。切り替えますか？",
      );
      if (!confirmed) {
        event.preventDefault();
      }
    };
    window.addEventListener(ACTIVE_X_BEFORE_SWITCH_EVENT, handler);
    return () =>
      window.removeEventListener(ACTIVE_X_BEFORE_SWITCH_EVENT, handler);
  }, [dirty, pending]);

  const normalizedInitialXId = normalizeXId(initial.creator_x_user_id || activeXId || "");
  const normalizedActiveXId = normalizeXId(activeXId || "");
  const normalizedActiveXSnapshot = normalizeXId(
    activeXSnapshot ?? activeXId ?? "",
  );
  const hasSelectableXIds = xIdOptions.length > 0;
  const initialIsSelectable = xIdOptions.some(
    (opt) => normalizeXId(opt.id) === normalizedInitialXId,
  );
  const selectedDefault =
    (initialIsSelectable && normalizedInitialXId) ||
    (xIdOptions[0] ? normalizeXId(xIdOptions[0].id) : "");
  // free/slot モードでは Active X ID が投稿主体に固定される。
  // edit モードでは admin のみ変更可。
  const isActiveXFixed = mode === "free" || mode === "slot";
  const showPermissionUi = mode === "edit" && Boolean(permissionView);
  const noEditableFormSections =
    showPermissionUi &&
    permissionView != null &&
    !hasAnyEditableVideoFormSection(permissionView);
  const permissionSubmitBlockedHint =
    showPermissionUi && permissionView && !submitBlockedReason
      ? resolvePermissionSubmitBlockedHint(permissionView)
      : null;
  const canSubmit =
    !submitBlockedReason &&
    !noEditableFormSections &&
    ((isActiveXFixed && !!normalizedActiveXId) ||
      (!isActiveXFixed && (hasSelectableXIds || !!normalizedInitialXId)));

  const youtubeId = extractYoutubeId(youtubeUrl);
  const selectedEventLabels = eventOptions
    .filter((event) => selectedEventIds.includes(event.id))
    .map((event) => event.title);
  const selectedDescriptionEvent = React.useMemo(() => {
    const preferredIds = [
      youtubeDescriptionEventId && selectedEventIds.includes(youtubeDescriptionEventId)
        ? youtubeDescriptionEventId
        : null,
      ...selectedEventIds,
    ].filter((eventId): eventId is string => Boolean(eventId));
    const seen = new Set<string>();
    for (const eventId of preferredIds) {
      if (seen.has(eventId)) continue;
      seen.add(eventId);
      const event = eventOptions.find((candidate) => candidate.id === eventId);
      if (event?.youtube_description_template?.trim()) return event;
    }
    return null;
  }, [eventOptions, selectedEventIds, youtubeDescriptionEventId]);
  const readDescriptionValue = React.useCallback(
    (name: string, fallback: string | null | undefined): string =>
      descriptionFormValues[name] ?? fallback ?? "",
    [descriptionFormValues],
  );
  const youtubeDescriptionRenderContext = React.useMemo<YoutubeDescriptionContext>(() => {
    const youtubeUrlValue = readDescriptionValue("youtube_url", initial.youtube_url);
    const memberDescriptionValues = formatYoutubeDescriptionMembers(members);
    return {
      ...youtubeDescriptionContext,
      event_title:
        selectedDescriptionEvent?.title ?? youtubeDescriptionContext?.event_title,
      event_id:
        selectedDescriptionEvent?.id ?? youtubeDescriptionContext?.event_id,
      event_url:
        selectedDescriptionEvent?.youtube_description_event_url ??
        youtubeDescriptionContext?.event_url,
      title: readDescriptionValue("title", initial.title),
      youtube_url: youtubeUrlValue,
      youtube_video_id: extractYoutubeId(youtubeUrlValue) ?? "",
      creator_name: submitterDisplayName,
      creator_x_id: readDescriptionValue("creator_x_user_id", initial.creator_x_user_id),
      creator_channel_url: submitterYoutubeChannel,
      creator_profile: submitterProfileText,
      creator_social_links: submitterSocialLinks,
      ...memberDescriptionValues,
      part: selectedPart,
      music: readDescriptionValue("music", initial.music),
      credit: readDescriptionValue("credit", initial.credit),
      intro_comment: readDescriptionValue("intro_comment", initial.intro_comment),
      highlights: readDescriptionValue("highlights", initial.highlights),
      production_story: readDescriptionValue(
        "production_story",
        initial.production_story,
      ),
      used_software: readDescriptionValue("used_software", initial.used_software),
      closing_comment: readDescriptionValue("closing_comment", initial.closing_comment),
    };
  }, [
    initial,
    members,
    readDescriptionValue,
    selectedDescriptionEvent,
    selectedPart,
    submitterDisplayName,
    submitterProfileText,
    submitterSocialLinks,
    submitterYoutubeChannel,
    youtubeDescriptionContext,
  ]);
  const sidePreviewTitle = titlePreview.trim() || "作品タイトル未入力";
  const sidePreviewName =
    displayNamePreview.trim() ||
    normalizedActiveXId ||
    normalizedInitialXId ||
    "提出者未設定";
  const submitterDisabled = isSectionDisabled(disabledSections, "submitter");
  const videoSectionDisabled = isSectionDisabled(disabledSections, "video");
  const descriptionsDisabled = isSectionDisabled(disabledSections, "descriptions");
  const membersSectionDisabled = isSectionDisabled(disabledSections, "members");
  const membersListDisabled =
    membersSectionDisabled || isFieldDisabled(disabledFields, "members.list");
  const chaptersFieldDisabled = isFieldDisabled(disabledFields, "chapters");
  const fieldDisabled = (key: string) =>
    isFieldDisabled(disabledFields, key) ||
    (key.startsWith("submitter.") && submitterDisabled) ||
    (key.startsWith("video.") && videoSectionDisabled) ||
    (key.startsWith("descriptions.") && descriptionsDisabled) ||
    (key.startsWith("members.") && membersListDisabled);
  const hasInitialYoutube = Boolean(initial.youtube_url?.trim());
  const isYoutubeUrlRequired =
    mode === "free" || (mode === "edit" && hasInitialYoutube);
  const isYoutubeFieldDisabled = fieldDisabled("video.youtube_url");
  const showYoutubeAddBlockedHint =
    mode === "edit" &&
    !hasInitialYoutube &&
    !youtubeUrl.trim() &&
    isFieldDisabled(disabledFields, "video.youtube_url");
  const youtubePreviewOptional = mode === "slot" && !youtubeUrl.trim();
  const youtubePreviewOk = Boolean(youtubeId) || youtubePreviewOptional;
  const youtubePreviewPending =
    !youtubePreviewOk && (mode === "free" || Boolean(youtubeUrl.trim()));
  const incompleteRequiredStageQuestionCount = selectedStagePermissionFields.filter(
    (question) => question.required && !stageAnswers[question.id]?.trim(),
  ).length;
  const memberCount = members.filter(
    (member) => member.name.trim() || member.x_user_id.trim(),
  ).length;
  const handleMembersChange = React.useCallback((next: VideoMemberInput[]) => {
    setMembers(next);
  }, []);

  const currentStepKey = isWizard ? wizardSteps[currentStep]?.key : null;
  const isWizardLastStep = isWizard && currentStep === wizardSteps.length - 1;
  const isWizardFirstStep = isWizard && currentStep === 0;
  const showSidePreview =
    !isWizard ||
    currentStepKey === "youtube" ||
    currentStepKey === "confirm";

  const isStepVisible = (key: WizardStepKey): boolean => {
    if (!isWizard) return true;
    if (key === "confirm") {
      return currentStepKey === key;
    }
    if (key === "submitter") return currentStepKey === "submitter";
    if (key === "work") return currentStepKey === "work";
    if (key === "youtube") return currentStepKey === "youtube";
    return false;
  };

  const validateRequiredCustomQuestions = (): WizardValidationError | null => {
    if (descriptionsDisabled) return null;
    for (const { event, question } of selectedCustomQuestions) {
      if (!question.required) continue;
      const key = customAnswerKey(event.id, question.question_key);
      if (customAnswerValues(customAnswers[key]).length > 0) continue;
      return {
        step: "work",
        fieldId: customQuestionFieldId(event.id, question.question_key),
        message: `「${question.label}」を入力してください。`,
      };
    }
    return null;
  };

  const validateWizardStep = (
    stepKey: WizardStepKey,
  ): WizardValidationError | null => {
    const form = formRef.current;

    if (stepKey === "submitter") {
      if (isActiveXFixed && !normalizedActiveXId) {
        return {
          step: "submitter",
          fieldId: "creator_x_user_id",
          message: "承認済み X ID がありません。設定画面から連携してください。",
        };
      }
      const displayName = form?.elements.namedItem("display_name");
      const displayValue =
        displayName instanceof HTMLInputElement ? displayName.value.trim() : "";
      if (!displayValue) {
        return {
          step: "submitter",
          fieldId: "display_name",
          message: "表示名 / 活動名 / 団体名を入力してください。",
        };
      }
      return null;
    }

    if (stepKey === "work") {
      const titleEl = form?.elements.namedItem("title");
      const titleValue =
        titleEl instanceof HTMLInputElement ? titleEl.value.trim() : "";
      if (!titleValue) {
        return {
          step: "work",
          fieldId: "title",
          message: "作品タイトルを入力してください。",
        };
      }

      for (const question of selectedStagePermissionFields) {
        if (!question.required) continue;
        const fieldId = `custom_question_${question.id}`;
        const answerValue = stageAnswers[question.id]?.trim() ?? "";
        if (!answerValue) {
          return {
            step: "work",
            fieldId,
            message: `「${question.label}」を入力してください。`,
          };
        }
      }
      const customQuestionError = validateRequiredCustomQuestions();
      if (customQuestionError) return customQuestionError;
      return null;
    }

    if (stepKey === "youtube") {
      const trimmed = youtubeUrl.trim();
      if (!trimmed) {
        if (mode === "slot") return null;
        return {
          step: "youtube",
          fieldId: "youtube_url",
          message: "YouTube URL を入力してください。",
        };
      }
      if (!extractYoutubeId(trimmed)) {
        return {
          step: "youtube",
          fieldId: "youtube_url",
          message: "有効な YouTube URL または動画 ID を入力してください。",
        };
      }
      return null;
    }

    return null;
  };

  const goToWizardStep = (index: number) => {
    if (!isWizard || index > maxReachedStep || index === currentStep) return;
    setStepError(null);
    setCurrentStep(index);
  };

  const goWizardNext = () => {
    if (!isWizard || !currentStepKey) return;
    const err = validateWizardStep(currentStepKey);
    if (err) {
      setStepError(err);
      return;
    }
    setStepError(null);
    const next = Math.min(currentStep + 1, wizardSteps.length - 1);
    setCurrentStep(next);
    setMaxReachedStep((prev) => Math.max(prev, next));
  };

  const goWizardBack = () => {
    if (!isWizard || isWizardFirstStep) return;
    setStepError(null);
    setCurrentStep((prev) => Math.max(0, prev - 1));
  };

  const jumpToWizardStep = React.useCallback(
    (key: WizardStepKey) => {
      const nextIndex = wizardSteps.findIndex(
        (step) => step.key === key,
      );
      if (nextIndex < 0) return;

      setStepError(null);
      setCurrentStep(nextIndex);
      setMaxReachedStep((current) =>
        Math.max(current, nextIndex),
      );
    },
    [wizardSteps],
  );

  React.useEffect(() => {
    if (!stepError || !isWizard) return;
    const index = wizardSteps.findIndex((step) => step.key === stepError.step);
    if (index >= 0) setCurrentStep(index);
    const frame = window.requestAnimationFrame(() => {
      const target = stepError.fieldId
        ? document.getElementById(stepError.fieldId)
        : null;
      if (!(target instanceof HTMLElement)) return;
      target.scrollIntoView({ behavior: "smooth", block: "center" });
      target.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [isWizard, stepError, wizardSteps]);

  const handleReapplyDefaultProfile = () => {
    if (!defaultProfile || submitterDisabled) return;
    const nextDisplayName = defaultProfile.display_name ?? "";
    setSubmitterDisplayName(nextDisplayName);
    setSubmitterProfileText(defaultProfile.profile_text ?? "");
    setSubmitterIconUrl(defaultProfile.icon_url ?? "");
    setSubmitterYoutubeChannel(defaultProfile.youtube_channel_url ?? "");
    setSubmitterSocialLinks(defaultProfile.other_social_links ?? "");
    setSubmitterFieldsKey((current) => current + 1);
    setDirty(true);
  };

  const handleSubmit = (ev: React.FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    if (pending || submitInFlightRef.current) return;
    const form = ev.currentTarget;
    if (mode === "edit") {
      const customQuestionError = validateRequiredCustomQuestions();
      if (customQuestionError) {
        setStepError(customQuestionError);
        setResult({ ok: false, message: customQuestionError.message });
        return;
      }
    }
    if (mode === "edit") {
      const allowChange =
        String(new FormData(form).get("allow_submitter_change") ?? "").trim() ===
        "1";
      if (allowChange) {
        const creatorField = form.elements.namedItem("creator_x_user_id");
        const nextX =
          creatorField instanceof HTMLInputElement ||
          creatorField instanceof HTMLSelectElement
            ? normalizeXId(creatorField.value)
            : "";
        const profileAction = String(
          new FormData(form).get("submitter_profile_action") ?? "",
        ).trim();
        if (nextX && nextX !== normalizedInitialXId && !profileAction) {
          setResult({
            ok: false,
            message:
              "提出主体 X ID を変更する場合、提出者情報の扱いを選択してください。",
          });
          return;
        }
      }
    }
    const formData = new FormData(form);
    setResult(null);
    submitInFlightRef.current = true;
    startTransition(async () => {
      try {
        const action =
          mode === "slot"
            ? submitSlotVideo
            : mode === "edit"
              ? updateVideo
              : createFreeVideo;
        const r = await action(formData);
        const currentPath =
          typeof window === "undefined"
            ? "/"
            : `${window.location.pathname}${window.location.search}`;
        if (!r.ok && redirectForGuardReason(router, r.reason, currentPath)) {
          // リダイレクトで離脱するので dirty 警告は不要にする。
          setDirty(false);
          return;
        }
        setResult(r);
        if (r.ok) {
          // 保存成功時は dirty を解除し、編集画面遷移時の警告を抑制する。
          setDirty(false);
        }
        // 新規投稿後は自動遷移をやめて成功 CTA (公開ページ / イベント / 編集を続ける) を出す。
        // 「投稿できた → 公開ページ確認したい」「→ イベントに戻りたい」を選べるようにする。
        // 編集モードはその場に留まり、router.refresh で最新値を反映する。
        if (r.ok && mode === "edit") {
          router.refresh();
        }
      } catch (error) {
        console.error("[VideoForm] submit failed", error);
        setResult({
          ok: false,
          message: "送信中に予期しないエラーが発生しました。もう一度お試しください。",
        });
      } finally {
        submitInFlightRef.current = false;
      }
    });
  };

  return (
    <form
      ref={formRef}
      className={[
        styles.form,
        mode === "edit" ? styles.formEditMode : "",
        !isWizard && mode !== "edit" ? styles.formMobileDock : "",
        isWizard ? styles.formWizardMode : "",
      ]
        .filter(Boolean)
        .join(" ")}
      onSubmit={handleSubmit}
      onChange={(event) => {
        if (!dirty) setDirty(true);
        setDescriptionFormValues(readDescriptionFormValues(event.currentTarget));
      }}
    >
      {slotId ? <input type="hidden" name="slot_id" value={slotId} /> : null}
      {videoId ? <input type="hidden" name="video_id" value={videoId} /> : null}
      {mode === "free" || mode === "slot" ? (
        <input
          type="hidden"
          name="active_x_snapshot"
          value={normalizedActiveXSnapshot}
        />
      ) : null}
      <input type="hidden" name="mode" value={mode} />
      {mode === "edit" && editPrivilegeMode ? (
        <input
          type="hidden"
          name="edit_privilege_mode"
          value={editPrivilegeMode}
        />
      ) : null}
      {softwareSuggestions.length > 0 ? (
        <datalist id="used-software-suggestions">
          {softwareSuggestions.map((name, index) => (
            <option key={`${name}-software-${index}`} value={name} />
          ))}
        </datalist>
      ) : null}

      {isWizard ? (
        <nav className={styles.stepProgress} aria-label="投稿ステップ">
          <ol className={styles.stepProgressList}>
            {wizardSteps.map((step, index) => {
              const state =
                index < currentStep
                  ? "done"
                  : index === currentStep
                    ? "current"
                    : "pending";
              const clickable = index <= maxReachedStep && index !== currentStep;
              return (
                <li key={step.key} className={styles.stepProgressItem}>
                  <button
                    type="button"
                    className={styles.stepProgressButton}
                    data-state={state}
                    data-clickable={clickable ? "true" : undefined}
                    disabled={!clickable}
                    onClick={() => goToWizardStep(index)}
                    aria-current={index === currentStep ? "step" : undefined}
                  >
                    <span className={styles.stepProgressIndex} aria-hidden>
                      {state === "done" ? (
                        <Icon name="check" size={11} />
                      ) : (
                        index + 1
                      )}
                    </span>
                    <span>{step.label}</span>
                  </button>
                </li>
              );
            })}
          </ol>
        </nav>
      ) : null}

      <div className={styles.formMain}>

      {stepError ? (
        <div id="wizard-validation-error" className={styles.stepError} role="alert">
          <Icon name="warning" size={13} aria-hidden />
          <span>{stepError.message}</span>
        </div>
      ) : null}

      <div
        className={cx(
          styles.stepPanel,
          isWizard && !isStepVisible("submitter") && styles.stepPanelHidden,
        )}
        hidden={isWizard ? !isStepVisible("submitter") : undefined}
      >
      <section
        className={cx(
          styles.section,
          submitterDisabled && styles.sectionDisabled,
        )}
        data-disabled={submitterDisabled || undefined}
      >
        <h2 className={styles.sectionTitle}>
          <Icon name="user" size={14} aria-hidden /> 提出者情報
          {showPermissionUi && permissionView ? (
            <PermissionBadge
              permission={permissionView.identity}
              className={styles.sectionPermissionBadge}
            />
          ) : submitterDisabled ? (
            <span className={styles.sectionDisabledBadge} aria-label="編集不可">
              <Icon name="alert" size={11} aria-hidden /> 編集権限なし
            </span>
          ) : null}
        </h2>
        {showPermissionUi && permissionView && submitterDisabled ? (
          <FieldLockNote
            id={videoFormLockNoteId("section-identity")}
            permission={permissionView.identity}
            unlockHint={resolvePermissionUnlockHint(
              permissionView.identity,
              permissionView,
            )}
          />
        ) : submitterDisabled && mode === "edit" ? (
          <p className={styles.help} role="status" id={videoFormLockNoteId("section-identity")}>
            この項目は、現在の一般作品権限では編集できません。
          </p>
        ) : null}
        <p className={styles.help}>
          {mode === "edit" ? (
            <>
              この作品に保存されている提出者情報を編集しています。
              変更はこの作品にだけ適用されます。
              X IDの既定プロフィールや、ほかの作品には影響しません。
            </>
          ) : (
            <>
              X IDに設定された既定プロフィールを入力しています。
              ここで変更した内容は、この作品にだけ適用されます。
              X IDの既定プロフィールや、ほかの作品には影響しません。
            </>
          )}
        </p>
        {defaultProfile && !submitterDisabled ? (
          <p style={{ margin: "0 0 12px" }}>
            <button
              type="button"
              className="fn-btn fn-btn-ghost fn-btn-sm"
              onClick={handleReapplyDefaultProfile}
            >
              現在の既定プロフィールを再適用
            </button>
          </p>
        ) : null}
        <div className={`${styles.row} ${styles.cols2}`}>
          <div className={cx(styles.field, styles.editableField)}>
            <label className={`${styles.label} ${styles.required}`} htmlFor="creator_x_user_id">
              提出主体 X ID
            </label>
            {isActiveXFixed ? (
              // free / slot モード: Active X ID に固定。変更不可。
              normalizedActiveXId ? (
                <>
                  <input
                    id="creator_x_user_id"
                    name="creator_x_user_id"
                    type="text"
                    value={normalizedActiveXId}
                    readOnly
                    className="fn-input"
                    aria-readonly="true"
                    disabled={fieldDisabled("submitter.creator_x_user_id")}
                    style={{ opacity: 0.75, cursor: "default" }}
                  />
                  <p className={styles.help} style={{ marginTop: 4 }}>
                    提出主体は現在の Active X ID に固定されます。変更する場合は上部バーから X ID を切り替えてください。
                  </p>
                </>
              ) : (
                <div className="fn-muted fn-text-sm">
                  承認済み X ID がありません。
                  <Link href="/dashboard/settings" style={{ marginLeft: 6 }}>
                    設定で連携
                  </Link>
                </div>
              )
            ) : mode === "edit" ? (
              // edit モード: 既定では readOnly で表示し、admin が明示的に解錠した場合のみ
              // <select> を出して提出主体 X ID を変更できる。
              // 解錠時は allow_submitter_change=1 を hidden で送り、サーバー側でも
              // role==="admin" と二重ゲートで検証する。
              <EditSubmitterField
                initialXId={normalizedInitialXId}
                xIdOptions={xIdOptions}
                hasSelectableXIds={hasSelectableXIds}
                selectedDefault={selectedDefault}
                disabled={fieldDisabled("submitter.creator_x_user_id")}
                sectionDisabled={isSectionDisabled(disabledSections, "submitter")}
                canChangeSubmitter={canChangeSubmitter}
              />
            ) : null}
          </div>
          <div className={cx(styles.field, styles.editableField)}>
            <label className={`${styles.label} ${styles.required}`} htmlFor="display_name">
              表示名 / 活動名 / 団体名
            </label>
            <input
              id="display_name"
              name="display_name"
              type="text"
              value={submitterDisplayName}
              className="fn-input"
              maxLength={80}
              required
              onChange={(e) => {
                setSubmitterDisplayName(e.target.value);
                setDirty(true);
              }}
              aria-invalid={stepError?.fieldId === "display_name" || undefined}
              aria-describedby={mergeDescribedBy(
                stepError?.fieldId === "display_name"
                  ? "wizard-validation-error"
                  : undefined,
                submitterDisabled
                  ? videoFormLockNoteId("section-identity")
                  : undefined,
              )}
              readOnly={fieldDisabled("submitter.display_name")}
              aria-readonly={fieldDisabled("submitter.display_name") || undefined}
              style={fieldDisabled("submitter.display_name") ? { opacity: 0.65, cursor: "default" } : undefined}
            />
          </div>
        </div>
        <div className={cx(styles.field, styles.editableField)}>
          <label className={styles.label}>作品アイコン</label>
          <p className={styles.help}>
            この作品で表示するアイコンを選択します。X ID 既定アイコンは変更されません。
          </p>
          <VideoIconPicker
            key={`video-icon-${submitterFieldsKey}`}
            candidates={iconCandidates}
            initialIconUrl={submitterIconUrl}
            persistedIconUrl={initial.icon_url}
            defaultIconUrl={defaultProfile?.icon_url}
            value={submitterIconUrl}
            onChange={(url) => {
              setSubmitterIconUrl(url);
              setDirty(true);
            }}
            disabled={fieldDisabled("submitter.icon_url")}
            isEdit={mode === "edit"}
          />
        </div>
        <div className={cx(styles.field, styles.editableField)}>
          <label className={styles.label} htmlFor="profile_text">
            自分・団体の概要
          </label>
          <textarea
            id="profile_text"
            name="profile_text"
            value={submitterProfileText}
            onChange={(e) => {
              setSubmitterProfileText(e.target.value);
              setDirty(true);
            }}
            className="fn-input"
            rows={3}
            maxLength={1000}
            readOnly={fieldDisabled("submitter.profile_text")}
            aria-readonly={fieldDisabled("submitter.profile_text") || undefined}
            style={
              fieldDisabled("submitter.profile_text")
                ? { opacity: 0.65, cursor: "default" }
                : undefined
            }
          />
        </div>
        <div className={cx(styles.field, styles.editableField)}>
          <span className={styles.label}>YouTube チャンネル</span>
          <YoutubeChannelPicker
            key={`youtube-channel-${submitterFieldsKey}`}
            defaultValue={submitterYoutubeChannel || null}
            candidates={channelCandidates}
            disabled={fieldDisabled("submitter.youtube_channel_url")}
            onValueChange={(url) => {
              setSubmitterYoutubeChannel(url);
              setDirty(true);
            }}
          />
        </div>
        <div className={cx(styles.field, styles.editableField)}>
          <SocialLinksEditor
            key={`social-links-${submitterFieldsKey}`}
            initialValue={submitterSocialLinks || null}
            disabled={fieldDisabled("submitter.other_social_links")}
            onValueChange={(json) => {
              setSubmitterSocialLinks(json);
              setDirty(true);
            }}
          />
        </div>
      </section>
      </div>

      <div
        className={cx(
          styles.stepPanel,
          isWizard && !isStepVisible("work") && styles.stepPanelHidden,
        )}
        hidden={isWizard ? !isStepVisible("work") : undefined}
      >
      <section
        className={cx(
          styles.section,
          videoSectionDisabled && styles.sectionDisabled,
        )}
        data-disabled={videoSectionDisabled || undefined}
      >
        <h2 className={styles.sectionTitle}>
          <Icon name="youtube" size={14} aria-hidden /> 動画と基本情報
          {showPermissionUi && permissionView ? (
            <PermissionBadge
              permission={permissionView.basics}
              className={styles.sectionPermissionBadge}
            />
          ) : videoSectionDisabled ? (
            <span className={styles.sectionDisabledBadge} aria-label="編集不可">
              <Icon name="alert" size={11} aria-hidden /> 編集権限なし
            </span>
          ) : null}
        </h2>
        {showPermissionUi && permissionView && videoSectionDisabled ? (
          <FieldLockNote
            id={videoFormLockNoteId("section-video")}
            permission={permissionView.basics}
            unlockHint={resolvePermissionUnlockHint(
              permissionView.basics,
              permissionView,
            )}
          />
        ) : videoSectionDisabled && mode === "edit" ? (
          <p className={styles.help} role="status" id={videoFormLockNoteId("section-video")}>
            この項目は、現在の一般作品権限では編集できません。
          </p>
        ) : null}

        <div className={cx(styles.field, styles.editableField)}>
          {showPermissionUi && permissionView && !videoSectionDisabled ? (
            <PermissionFieldLabel
              label="作品タイトル"
              htmlFor="title"
              permission={permissionView.basics}
              required
              noteId={videoFormLockNoteId("basics")}
            />
          ) : (
            <label className={`${styles.label} ${styles.required}`} htmlFor="title">
              作品タイトル
            </label>
          )}
          <input
            id="title"
            name="title"
            type="text"
            defaultValue={initial.title}
            className="fn-input"
            placeholder="例: First Light - 春の輪"
            maxLength={120}
              required
              onChange={(e) => {
                setTitlePreview(e.target.value);
                setDirty(true);
              }}
              aria-invalid={stepError?.fieldId === "title" || undefined}
              aria-describedby={mergeDescribedBy(
                stepError?.fieldId === "title"
                  ? "wizard-validation-error"
                  : undefined,
                showPermissionUi &&
                  permissionView &&
                  !videoSectionDisabled &&
                  !permissionView.basics.editable
                  ? videoFormLockNoteId("basics")
                  : undefined,
                videoSectionDisabled
                  ? videoFormLockNoteId("section-video")
                  : undefined,
              )}
            readOnly={fieldDisabled("video.title")}
            aria-readonly={fieldDisabled("video.title") || undefined}
            style={fieldDisabled("video.title") ? { opacity: 0.65, cursor: "default" } : undefined}
          />
          {showPermissionUi && permissionView && !videoSectionDisabled ? (
            <FieldLockNote
              id={videoFormLockNoteId("basics")}
              permission={permissionView.basics}
              unlockHint={resolvePermissionUnlockHint(
                permissionView.basics,
                permissionView,
              )}
            />
          ) : null}
        </div>

        {mode === "free" ? (
          <div className={cx(styles.field, styles.editableField)}>
            <label className={styles.label} htmlFor="scheduled_time">
              投稿日時 / 公開日時
            </label>
            <input
              id="scheduled_time"
              name="scheduled_time"
              type="datetime-local"
              className="fn-input"
              disabled={fieldDisabled("video.scheduled_time")}
            />
            <p className={styles.help}>
              未入力の場合は提出時刻が使われます。入力値は日本時間 (JST) として扱われます。
            </p>
          </div>
        ) : null}

        {!isWizard ? (
        <div className={cx(styles.field, styles.editableField)}>
          {showPermissionUi && permissionView && !videoSectionDisabled ? (
            <PermissionFieldLabel
              label="YouTube URL"
              htmlFor="youtube_url"
              permission={permissionView.youtube}
              required={isYoutubeUrlRequired}
              noteId={videoFormLockNoteId("youtube")}
            />
          ) : (
            <label
              className={`${styles.label} ${isYoutubeUrlRequired ? styles.required : ""}`}
              htmlFor="youtube_url"
            >
              YouTube URL
            </label>
          )}
          <input
            id="youtube_url"
            name="youtube_url"
            type="text"
            inputMode="url"
            value={youtubeUrl}
            onChange={(e) => setYoutubeUrl(e.target.value)}
            className="fn-input"
            placeholder="https://www.youtube.com/watch?v=..."
            required={isYoutubeUrlRequired}
            readOnly={isYoutubeFieldDisabled}
            aria-readonly={isYoutubeFieldDisabled || undefined}
            style={isYoutubeFieldDisabled ? { opacity: 0.65, cursor: "default" } : undefined}
            aria-describedby={mergeDescribedBy(
              showPermissionUi &&
                permissionView &&
                !videoSectionDisabled &&
                !permissionView.youtube.editable
                ? videoFormLockNoteId("youtube")
                : undefined,
            )}
          />
          {showPermissionUi && permissionView && !videoSectionDisabled ? (
            <FieldLockNote
              id={videoFormLockNoteId("youtube")}
              permission={permissionView.youtube}
              unlockHint={resolvePermissionUnlockHint(
                permissionView.youtube,
                permissionView,
              )}
            />
          ) : null}
          {showYoutubeAddBlockedHint ? (
            <p className={styles.help}>
              YouTube URL は未登録です。追加する権限がありません。
            </p>
          ) : (
            <p className={styles.help}>
              {isYoutubeUrlRequired
                ? "限定公開でも登録可能ですが、編集時の動画 ID 変更は管理者の事前承認が必要です。"
                : "任意。後から追加できます。限定公開でも登録可能です。"}
            </p>
          )}
          {youtubeId ? (
            <div className={styles.preview}>
              <div className={styles.previewThumb}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={youtubeThumbUrl(youtubeId, "hqdefault")} alt="" />
              </div>
              <div className={styles.previewBody}>
                <strong style={{ color: "var(--text-primary)" }}>
                  YouTube ID: {youtubeId}
                </strong>
                <br />
                <a
                  href={youtubeWatchUrl(youtubeId)}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  YouTube で確認 →
                </a>
              </div>
            </div>
          ) : null}
        </div>
        ) : null}

        <div className={`${styles.row} ${styles.cols2}`}>
          <div className={cx(styles.field, styles.editableField)}>
            {showPermissionUi && permissionView && !videoSectionDisabled ? (
              <PermissionFieldLabel
                label="使用楽曲"
                htmlFor="music"
                permission={permissionView.credits}
                noteId={videoFormLockNoteId("credits-music")}
              />
            ) : (
              <label className={styles.label} htmlFor="music">
                使用楽曲
              </label>
            )}
            <input
              id="music"
              name="music"
              type="text"
              defaultValue={initial.music}
              className="fn-input"
              placeholder="アーティスト名 - 曲名"
              maxLength={200}
              disabled={fieldDisabled("video.music")}
              aria-describedby={mergeDescribedBy(
                showPermissionUi &&
                  permissionView &&
                  !videoSectionDisabled &&
                  !permissionView.credits.editable
                  ? videoFormLockNoteId("credits-music")
                  : undefined,
              )}
            />
            <input
              id="music_reference_url"
              name="music_reference_url"
              type="url"
              defaultValue={initial.music_reference_url}
              className="fn-input"
              placeholder="楽曲リンク URL (任意, https://...)"
              maxLength={500}
              disabled={fieldDisabled("video.music")}
              style={{ marginTop: 6 }}
            />
            {showPermissionUi && permissionView && !videoSectionDisabled ? (
              <FieldLockNote
                id={videoFormLockNoteId("credits-music")}
                permission={permissionView.credits}
                unlockHint={resolvePermissionUnlockHint(
                  permissionView.credits,
                  permissionView,
                )}
              />
            ) : null}
            <p className={styles.help}>
              楽曲ページ・ニコニコ動画・YouTube などのリンクを入れると、視聴者に楽曲ページへ飛んでもらえます。
            </p>
          </div>
          <div className={cx(styles.field, styles.editableField)}>
            {showPermissionUi && permissionView && !videoSectionDisabled ? (
              <PermissionFieldLabel
                label="クレジット"
                htmlFor="credit"
                permission={permissionView.credits}
                noteId={videoFormLockNoteId("credits-credit")}
              />
            ) : (
              <label className={styles.label} htmlFor="credit">
                クレジット
              </label>
            )}
            <input
              id="credit"
              name="credit"
              type="text"
              defaultValue={initial.credit}
              className="fn-input"
              placeholder="提供 / 作詞作曲 など"
              maxLength={200}
              disabled={fieldDisabled("video.credit")}
              aria-describedby={mergeDescribedBy(
                showPermissionUi &&
                  permissionView &&
                  !videoSectionDisabled &&
                  !permissionView.credits.editable
                  ? videoFormLockNoteId("credits-credit")
                  : undefined,
              )}
            />
            {showPermissionUi && permissionView && !videoSectionDisabled ? (
              <FieldLockNote
                id={videoFormLockNoteId("credits-credit")}
                permission={permissionView.credits}
                unlockHint={resolvePermissionUnlockHint(
                  permissionView.credits,
                  permissionView,
                )}
              />
            ) : null}
          </div>
        </div>

        {eventOptions.length > 0 ? (
          <div className={cx(styles.field, styles.editableField)}>
            {showPermissionUi && permissionView ? (
              <PermissionFieldLabel
                label="所属イベント"
                permission={permissionView.primaryEvent}
                noteId={videoFormLockNoteId("primaryEvent")}
              />
            ) : (
              <label className={styles.label}>所属イベント</label>
            )}
            {showPermissionUi && permissionView ? (
              <FieldLockNote
                id={videoFormLockNoteId("primaryEvent")}
                permission={permissionView.primaryEvent}
                unlockHint={resolvePermissionUnlockHint(
                  permissionView.primaryEvent,
                  permissionView,
                )}
              />
            ) : null}
            <p className={styles.help}>
              この作品を関連付けるイベントを選択します。複数選択可。
              {slotId
                ? " 確保した枠のイベントは固定で含まれます。"
                : mode === "free"
                  ? " 枠なし投稿を受け付けるイベントのみ表示されます。"
                  : ""}
            </p>
            <input
              type="hidden"
              name="event_ids"
              value={selectedEventIds.join(",")}
            />
            <div className={styles.eventOptionGrid}>
              {eventOptions.map((ev) => {
                const checked = selectedEventIds.includes(ev.id);
                const atEventLimit =
                  !checked && selectedEventIds.length >= MAX_ATOMIC_VIDEO_EVENTS;
                // slot モードでは slot.event_id を固定で含めるため、編集者でも外せない。
                const locked =
                  !canEditEvents ||
                  (mode === "slot" &&
                    !!initial.event_ids?.includes(ev.id) &&
                    initial.event_ids.length === 1);
                return (
                  <label
                    key={ev.id}
                    className={`${styles.eventOption} ${checked ? styles.eventOptionChecked : ""} ${locked ? styles.eventOptionLocked : ""}`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={locked || atEventLimit}
                      onChange={(e) => {
                        if (locked) return;
                        setSelectedEventIds((prev) =>
                          e.target.checked
                            ? Array.from(new Set([...prev, ev.id]))
                            : prev.filter((id) => id !== ev.id),
                        );
                      }}
                    />
                    <span style={{ flex: 1, minWidth: 0 }}>{ev.title}</span>
                    {locked ? (
                      <Icon
                        name="alert"
                        size={11}
                        aria-hidden
                        title="このイベントは固定です"
                      />
                    ) : null}
                  </label>
                );
              })}
            </div>
            <p className={styles.help}>
              所属イベントは最大{MAX_ATOMIC_VIDEO_EVENTS}件です。
            </p>
          </div>
        ) : null}

        {mode === "slot" ? (
          <input type="hidden" name="part" value={initial.part ?? ""} />
        ) : availableParts.length > 0 ? (
          <div className={cx(styles.field, styles.editableField)}>
            <label className={styles.label} htmlFor="part">
              部
            </label>
            <p className={styles.help}>
              所属イベントで設定された「部」(セクション/カテゴリ) から 1 つ選択します。
              未選択でも投稿できます。
            </p>
            <select
              id="part"
              name="part"
              className="fn-select"
              value={selectedPart}
              onChange={(e) => {
                setSelectedPart(e.target.value);
                setDirty(true);
              }}
              disabled={fieldDisabled("video.part")}
            >
              <option value="">(未設定)</option>
              {availableParts.map((part) => (
                <option key={part} value={part}>
                  {part}
                </option>
              ))}
            </select>
          </div>
        ) : (
          // フォーム送信時に常に part キーを含めるため、UI 非表示時も hidden で送る。
          <input type="hidden" name="part" value="" />
        )}
      </section>

      {selectedDescriptionEvent ? (
        <YoutubeDescriptionPreview
          template={selectedDescriptionEvent.youtube_description_template ?? ""}
          eventTitle={selectedDescriptionEvent.title}
          context={youtubeDescriptionRenderContext}
          members={members}
        />
      ) : null}

      <section
        className={cx(
          styles.section,
          descriptionsDisabled && styles.sectionDisabled,
        )}
        data-disabled={descriptionsDisabled || undefined}
      >
        <h2 className={styles.sectionTitle}>
          <Icon name="edit" size={14} aria-hidden /> 紹介文
          {showPermissionUi && permissionView ? (
            <PermissionBadge
              permission={permissionView.descriptions}
              className={styles.sectionPermissionBadge}
            />
          ) : descriptionsDisabled ? (
            <span className={styles.sectionDisabledBadge} aria-label="編集不可">
              <Icon name="alert" size={11} aria-hidden /> 編集権限なし
            </span>
          ) : null}
        </h2>
        {showPermissionUi && permissionView && descriptionsDisabled ? (
          <FieldLockNote
            id={videoFormLockNoteId("section-descriptions")}
            permission={permissionView.descriptions}
            unlockHint={resolvePermissionUnlockHint(
              permissionView.descriptions,
              permissionView,
            )}
          />
        ) : descriptionsDisabled && mode === "edit" ? (
          <p className={styles.help} role="status" id={videoFormLockNoteId("section-descriptions")}>
            この項目は、現在の一般作品権限では編集できません。
          </p>
        ) : null}

        <div className={cx(styles.field, styles.editableField)}>
          {showPermissionUi && permissionView ? (
            <PermissionFieldLabel
              label="紹介コメント"
              htmlFor="intro_comment"
              permission={permissionView.descriptions}
            />
          ) : (
            <label className={styles.label} htmlFor="intro_comment">
              紹介コメント
            </label>
          )}
          <textarea
            id="intro_comment"
            name="intro_comment"
            defaultValue={initial.intro_comment}
            className="fn-input"
            rows={3}
            maxLength={500}
            placeholder="作品の見どころを 1〜2 行で。"
            readOnly={fieldDisabled("descriptions.intro_comment")}
            aria-readonly={fieldDisabled("descriptions.intro_comment") || undefined}
            style={
              fieldDisabled("descriptions.intro_comment")
                ? { opacity: 0.65, cursor: "default" }
                : undefined
            }
            aria-describedby={
              descriptionsDisabled
                ? videoFormLockNoteId("section-descriptions")
                : undefined
            }
          />
        </div>

        <div className={cx(styles.field, styles.editableField)}>
          <label className={styles.label} htmlFor="highlights">
            みどころ
          </label>
          <textarea
            id="highlights"
            name="highlights"
            defaultValue={initial.highlights}
            className="fn-input"
            rows={4}
            maxLength={1000}
            readOnly={fieldDisabled("descriptions.highlights")}
            aria-readonly={fieldDisabled("descriptions.highlights") || undefined}
            style={
              fieldDisabled("descriptions.highlights")
                ? { opacity: 0.65, cursor: "default" }
                : undefined
            }
          />
        </div>

        <div className={cx(styles.field, styles.editableField)}>
          <label className={styles.label} htmlFor="production_story">
            制作エピソード
          </label>
          <textarea
            id="production_story"
            name="production_story"
            defaultValue={initial.production_story}
            className="fn-input"
            rows={4}
            maxLength={1000}
            readOnly={fieldDisabled("descriptions.production_story")}
            aria-readonly={fieldDisabled("descriptions.production_story") || undefined}
            style={
              fieldDisabled("descriptions.production_story")
                ? { opacity: 0.65, cursor: "default" }
                : undefined
            }
          />
        </div>

        <div className={cx(styles.field, styles.editableField)}>
          <label className={styles.label} htmlFor="used_software">
            使用ソフト
          </label>
          <input
            id="used_software"
            name="used_software"
            type="text"
            defaultValue={initial.used_software}
            className="fn-input"
            maxLength={200}
            placeholder="AviUtl, After Effects, Vegas など"
            list="used-software-suggestions"
            disabled={fieldDisabled("descriptions.used_software")}
          />
          <p className={styles.help}>
            カンマ区切りで最大{MAX_ATOMIC_VIDEO_SOFTWARES}件まで入力できます。
          </p>
          {softwareSuggestions.length > 0 ? (
            <p className={styles.help}>
              既存データから候補を出しています。該当しない場合はそのまま入力できます。
            </p>
          ) : null}
        </div>

        {selectedStagePermissionFields.map((question, index) => {
          const fieldId = `custom_question_${question.id}`;
          return (
            <div
              key={`${question.id}-${index}`}
              className={cx(styles.field, styles.editableField)}
            >
              <input
                type="hidden"
                name="custom_question_answer_id"
                value={question.id}
              />
              <label
                className={`${styles.label} ${
                  question.required ? styles.required : ""
                }`}
                htmlFor={fieldId}
              >
                {question.label}
              </label>
              {question.description ? (
                <p className={styles.help}>{question.description}</p>
              ) : null}
              <textarea
                id={fieldId}
                name="custom_question_answer_value"
                value={stageAnswers[question.id] ?? ""}
                onChange={(event) => {
                  setStageAnswers((current) => ({
                    ...current,
                    [question.id]: event.target.value,
                  }));
                  setDirty(true);
                }}
                className="fn-input"
                rows={3}
                maxLength={1000}
                required={question.required}
                placeholder={question.placeholder}
                readOnly={fieldDisabled("descriptions.stage_permission")}
                aria-readonly={
                  fieldDisabled("descriptions.stage_permission") || undefined
                }
                style={
                  fieldDisabled("descriptions.stage_permission")
                    ? { opacity: 0.65, cursor: "default" }
                    : undefined
                }
                aria-invalid={stepError?.fieldId === fieldId || undefined}
                aria-describedby={
                  stepError?.fieldId === fieldId
                    ? "wizard-validation-error"
                    : undefined
                }
              />
            </div>
          );
        })}

        {selectedCustomQuestions.map(({ event, question }) => {
          const answerKey = customAnswerKey(event.id, question.question_key);
          const fieldId = customQuestionFieldId(event.id, question.question_key);
          const name = `custom_answer:${event.id}:${question.question_key}`;
          const values = customAnswerValues(customAnswers[answerKey]);
          const textValue = values[0] ?? "";
          const maxLength =
            question.max_length != null && question.max_length > 0
              ? question.max_length
              : question.type === "text"
                ? 200
                : 1000;
          const disabled = fieldDisabled("descriptions.custom_answers");
          const describedBy =
            stepError?.fieldId === fieldId
              ? "wizard-validation-error"
              : undefined;
          const updateAnswer = (next: string | string[]) => {
            setCustomAnswers((current) => ({ ...current, [answerKey]: next }));
            setDirty(true);
          };
          const label =
            selectedEventIds.length > 1
              ? `${event.title}: ${question.label}`
              : question.label;

          return (
            <div
              key={`${event.id}:${question.id}`}
              className={cx(styles.field, styles.editableField)}
            >
              <label
                className={`${styles.label} ${question.required ? styles.required : ""}`}
                htmlFor={fieldId}
              >
                {label}
              </label>
              {question.description ? (
                <p className={styles.help}>{question.description}</p>
              ) : null}
              {question.type === "textarea" ? (
                <textarea
                  id={fieldId}
                  name={name}
                  value={textValue}
                  onChange={(event) => updateAnswer(event.target.value)}
                  className="fn-input"
                  rows={3}
                  maxLength={maxLength}
                  required={question.required}
                  placeholder={question.placeholder ?? undefined}
                  disabled={disabled}
                  aria-invalid={stepError?.fieldId === fieldId || undefined}
                  aria-describedby={describedBy}
                />
              ) : question.type === "select" && question.options.length > 0 ? (
                <select
                  id={fieldId}
                  name={name}
                  value={textValue}
                  onChange={(event) => updateAnswer(event.target.value)}
                  className="fn-select"
                  required={question.required}
                  disabled={disabled}
                  aria-invalid={stepError?.fieldId === fieldId || undefined}
                  aria-describedby={describedBy}
                >
                  <option value="">選択してください</option>
                  {question.options.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              ) : question.type === "radio" && question.options.length > 0 ? (
                <div
                  id={`${fieldId}_group`}
                  role="radiogroup"
                  aria-describedby={describedBy}
                  aria-invalid={stepError?.fieldId === fieldId || undefined}
                  style={{ display: "grid", gap: 6 }}
                >
                  {question.options.map((option, optionIndex) => (
                    <label key={option} style={{ display: "flex", gap: 8 }}>
                      <input
                        id={optionIndex === 0 ? fieldId : `${fieldId}_${optionIndex}`}
                        type="radio"
                        name={name}
                        value={option}
                        checked={textValue === option}
                        onChange={(event) => updateAnswer(event.target.value)}
                        required={question.required}
                        disabled={disabled}
                      />
                      <span>{option}</span>
                    </label>
                  ))}
                </div>
              ) : question.type === "checkbox" && question.options.length > 0 ? (
                <div
                  id={`${fieldId}_group`}
                  role="group"
                  aria-describedby={describedBy}
                  aria-invalid={stepError?.fieldId === fieldId || undefined}
                  style={{ display: "grid", gap: 6 }}
                >
                  {question.options.map((option, optionIndex) => (
                    <label key={option} style={{ display: "flex", gap: 8 }}>
                      <input
                        id={optionIndex === 0 ? fieldId : `${fieldId}_${optionIndex}`}
                        type="checkbox"
                        name={name}
                        value={option}
                        checked={values.includes(option)}
                        onChange={(event) => {
                          const next = event.target.checked
                            ? Array.from(new Set([...values, option]))
                            : values.filter((value) => value !== option);
                          updateAnswer(next);
                        }}
                        // checkbox の required を各選択肢へ付けると全選択必須になるため、
                        // 必須判定は validateRequiredCustomQuestions で行う。
                        required={false}
                        disabled={disabled}
                      />
                      <span>{option}</span>
                    </label>
                  ))}
                </div>
              ) : (
                <input
                  id={fieldId}
                  name={name}
                  type="text"
                  value={textValue}
                  onChange={(event) => updateAnswer(event.target.value)}
                  className="fn-input"
                  maxLength={maxLength}
                  required={question.required}
                  placeholder={question.placeholder ?? undefined}
                  disabled={disabled}
                  aria-invalid={stepError?.fieldId === fieldId || undefined}
                  aria-describedby={describedBy}
                />
              )}
            </div>
          );
        })}

        <div className={cx(styles.field, styles.editableField)}>
          <label className={styles.label} htmlFor="closing_comment">
            あとがき
          </label>
          <textarea
            id="closing_comment"
            name="closing_comment"
            defaultValue={initial.closing_comment}
            className="fn-input"
            rows={3}
            maxLength={500}
            readOnly={fieldDisabled("descriptions.closing_comment")}
            aria-readonly={fieldDisabled("descriptions.closing_comment") || undefined}
            style={
              fieldDisabled("descriptions.closing_comment")
                ? { opacity: 0.65, cursor: "default" }
                : undefined
            }
          />
        </div>
      </section>

      <section
        className={cx(
          styles.section,
          membersSectionDisabled && styles.sectionDisabled,
        )}
        data-disabled={membersSectionDisabled || undefined}
      >
        <h2 className={styles.sectionTitle}>
          <Icon name="users" size={14} aria-hidden /> 合作メンバー
          {showPermissionUi && permissionView ? (
            <PermissionBadge
              permission={permissionView.members}
              className={styles.sectionPermissionBadge}
            />
          ) : membersSectionDisabled ? (
            <span className={styles.sectionDisabledBadge} aria-label="編集不可">
              <Icon name="alert" size={11} aria-hidden /> 編集権限なし
            </span>
          ) : null}
        </h2>
        {showPermissionUi && permissionView && membersSectionDisabled ? (
          <FieldLockNote
            id={videoFormLockNoteId("section-members")}
            permission={permissionView.members}
            unlockHint={resolvePermissionUnlockHint(
              permissionView.members,
              permissionView,
            )}
          />
        ) : membersSectionDisabled && mode === "edit" ? (
          <p className={styles.help} role="status" id={videoFormLockNoteId("section-members")}>
            この項目は、現在の一般作品権限では編集できません。
          </p>
        ) : null}
        <label
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            cursor: membersListDisabled ? "default" : "pointer",
            fontSize: 13,
          }}
        >
          {membersListDisabled ? (
            <>
              <input
                type="hidden"
                name="is_collab"
                value={isCollab ? "true" : "false"}
              />
              <input
                type="checkbox"
                checked={isCollab}
                readOnly
                disabled
                aria-readonly
                aria-describedby={
                  membersSectionDisabled
                    ? videoFormLockNoteId("section-members")
                    : undefined
                }
              />
            </>
          ) : (
            <>
              <input type="hidden" name="is_collab" value="false" />
              <input
                type="checkbox"
                name="is_collab"
                value="true"
                checked={isCollab}
                onChange={(e) => setIsCollab(e.target.checked)}
              />
            </>
          )}
          合作作品として登録する
        </label>
        {isCollab ? (
          <div style={{ marginTop: 12 }}>
            <VideoMembersField
              initialMembers={initial.members}
              suggestions={memberSuggestions}
              disabled={membersListDisabled}
              chaptersDisabled={chaptersFieldDisabled}
              onChange={handleMembersChange}
              collabPermsHref="#video-collab-perms"
              permissionTargetVideoId={mode === "edit" ? (videoId ?? null) : null}
            />
            <p className={styles.help} style={{ marginTop: 8 }}>
              X ID 欄は @ 抜きで入力します。未承認 X ID も受け付け、後で本人連携時に紐付け可能です。
            </p>
          </div>
        ) : null}
      </section>
      </div>

      {isWizard ? (
        <div
          className={cx(
            styles.stepPanel,
            !isStepVisible("youtube") && styles.stepPanelHidden,
          )}
          hidden={!isStepVisible("youtube")}
        >
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>
              <Icon name="youtube" size={14} aria-hidden /> YouTube URL 登録
            </h2>
            <div className={styles.youtubeStepSection}>
              <div className={cx(styles.field, styles.editableField)}>
                <label
                  className={`${styles.label} ${mode !== "slot" ? styles.required : ""}`}
                  htmlFor="youtube_url"
                >
                  YouTube URL
                </label>
                <input
                  id="youtube_url"
                  name="youtube_url"
                  type="text"
                  inputMode="url"
                  value={youtubeUrl}
                  onChange={(e) => {
                    setYoutubeUrl(e.target.value);
                    setDirty(true);
                  }}
                  className="fn-input"
                  placeholder="https://www.youtube.com/watch?v=..."
                  required={mode !== "slot"}
                  readOnly={isYoutubeFieldDisabled}
                  aria-readonly={isYoutubeFieldDisabled || undefined}
                  style={
                    isYoutubeFieldDisabled
                      ? { opacity: 0.65, cursor: "default" }
                      : undefined
                  }
                  aria-invalid={stepError?.fieldId === "youtube_url" || undefined}
                  aria-describedby={
                    stepError?.fieldId === "youtube_url"
                      ? "wizard-validation-error"
                      : undefined
                  }
                />
                <p className={styles.help}>
                  {mode === "slot"
                    ? "任意。後から編集で追加できます。入力すると下にサムネイルが表示されます。"
                    : "限定公開でも登録可能です。URL を入力すると下にサムネイルが表示されます。"}
                </p>
              </div>
              {youtubeId ? (
                <div className={styles.youtubeStepPreview}>
                  <div className={styles.youtubeStepThumb}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={youtubeThumbUrl(youtubeId, "hqdefault")} alt="" />
                  </div>
                  <div className={styles.youtubeStepMeta}>
                    <strong style={{ color: "var(--text-primary)" }}>
                      YouTube ID: {youtubeId}
                    </strong>
                    <br />
                    <a
                      href={youtubeWatchUrl(youtubeId)}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      YouTube で確認 →
                    </a>
                  </div>
                </div>
              ) : mode === "slot" ? (
                <p className={styles.help}>
                  未入力のまま次へ進めます。後から編集で追加できます。
                </p>
              ) : (
                <p className={styles.help}>
                  動画の URL または 11 桁の動画 ID を入力してください。
                </p>
              )}
            </div>
          </section>
        </div>
      ) : null}

      {isWizard ? (
        <div
          className={cx(
            styles.stepPanel,
            !isStepVisible("confirm") && styles.stepPanelHidden,
          )}
          hidden={!isStepVisible("confirm")}
        >
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>
              <Icon name="check" size={14} aria-hidden /> 確認・送信
            </h2>
            <div className={styles.confirmSummary}>
              <p className={styles.help}>
                入力内容を確認して、問題なければ提出してください。
              </p>
              <div className={styles.confirmSummaryGrid}>
                <div className={styles.confirmGroups}>
                  <section className={styles.confirmGroup}>
                    <div className={styles.confirmGroupHead}>
                      <h3>投稿者情報</h3>
                      <button
                        type="button"
                        className={styles.confirmEditButton}
                        onClick={() =>
                          jumpToWizardStep("submitter")
                        }
                      >
                        修正
                      </button>
                    </div>

                    <dl className={styles.confirmSummaryList}>
                      <div>
                        <dt>X ID</dt>
                        <dd>
                          @
                          {normalizedActiveXId ||
                            normalizedInitialXId ||
                            "未設定"}
                        </dd>
                      </div>
                      <div>
                        <dt>表示名</dt>
                        <dd>
                          {displayNamePreview.trim() || "未入力"}
                        </dd>
                      </div>
                    </dl>
                  </section>

                  <section className={styles.confirmGroup}>
                    <div className={styles.confirmGroupHead}>
                      <h3>作品情報</h3>
                      <button
                        type="button"
                        className={styles.confirmEditButton}
                        onClick={() => jumpToWizardStep("work")}
                      >
                        修正
                      </button>
                    </div>

                    <dl className={styles.confirmSummaryList}>
                      <div>
                        <dt>タイトル</dt>
                        <dd>{titlePreview.trim() || "未入力"}</dd>
                      </div>
                      <div>
                        <dt>イベント</dt>
                        <dd>
                          {selectedEventLabels.length > 0
                            ? selectedEventLabels.join(" / ")
                            : "未選択"}
                        </dd>
                      </div>
                      <div>
                        <dt>合作</dt>
                        <dd>
                          {isCollab
                            ? `${memberCount}人の合作`
                            : "個人作品"}
                        </dd>
                      </div>
                      <div>
                        <dt>追加質問</dt>
                        <dd>
                          {incompleteRequiredStageQuestionCount > 0
                            ? `未入力 ${incompleteRequiredStageQuestionCount}件`
                            : "入力済み"}
                        </dd>
                      </div>
                    </dl>
                  </section>

                  <section className={styles.confirmGroup}>
                    <div className={styles.confirmGroupHead}>
                      <h3>YouTube</h3>
                      <button
                        type="button"
                        className={styles.confirmEditButton}
                        onClick={() =>
                          jumpToWizardStep("youtube")
                        }
                      >
                        修正
                      </button>
                    </div>

                    <div className={styles.confirmYoutube}>
                      <dl className={styles.confirmSummaryList}>
                        <div>
                          <dt>動画ID</dt>
                          <dd>
                            {youtubeId ??
                              (mode === "slot"
                                ? "未入力（後から追加可）"
                                : "未入力")}
                          </dd>
                        </div>
                      </dl>

                      {youtubeId ? (
                        <div className={styles.confirmThumb}>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={youtubeThumbUrl(
                              youtubeId,
                              "hqdefault",
                            )}
                            alt=""
                          />
                        </div>
                      ) : null}
                    </div>
                  </section>
                </div>
              </div>
            </div>
          </section>
        </div>
      ) : null}

      {result && !result.ok ? (
        <ErrorCallout
          reason={result.reason}
          message={result.message ?? "提出に失敗しました。"}
        />
      ) : null}
      {result && result.ok ? (
        <div
          role="status"
          style={{
            padding: "12px 14px",
            border: "1px solid var(--accent-primary)",
            borderRadius: "var(--radius-sm)",
            background: "var(--accent-primary-soft)",
            color: "var(--text-primary)",
            fontSize: 13,
            display: "grid",
            gap: 10,
          }}
        >
          <div>
            <Icon name="check" size={13} aria-hidden />{" "}
            {mode === "edit"
              ? "保存しました。"
              : "提出が完了しました。続けて以下から進めてください。"}
          </div>
          {result.pendingPublicReflection ? <PublicReflectionDelayNotice /> : null}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {result.youtubeVideoId || result.videoId ? (
              <Link
                href={`/${result.youtubeVideoId ?? result.videoId}`}
                className="fn-btn fn-btn-primary fn-btn-sm"
              >
                <Icon name="external" size={12} aria-hidden /> 公開ページを見る
              </Link>
            ) : null}
            {result.eventId ? (
              <Link
                href={`/event/${result.eventId}`}
                className="fn-btn fn-btn-ghost fn-btn-sm"
              >
                <Icon name="calendar" size={12} aria-hidden /> イベントへ戻る
              </Link>
            ) : null}
            {mode !== "edit" && result.videoId ? (
              <Link
                href={`/dashboard/edit/${result.videoId}`}
                className="fn-btn fn-btn-ghost fn-btn-sm"
              >
                <Icon name="edit" size={12} aria-hidden /> 編集を続ける
              </Link>
            ) : null}
          </div>
        </div>
      ) : null}
      {submitBlockedReason ? (
        <div
          role="alert"
          style={{
            padding: "12px 14px",
            border: "1px solid var(--accent-warning, #c08a00)",
            borderRadius: "var(--radius-sm)",
            background: "var(--accent-warning-soft, rgba(255, 200, 0, 0.08))",
            color: "var(--text-primary)",
            fontSize: 13,
            display: "flex",
            alignItems: "flex-start",
            gap: 8,
          }}
        >
          <Icon name="warning" size={13} aria-hidden />
          <span>{submitBlockedReason}</span>
        </div>
      ) : noEditableFormSections && permissionSubmitBlockedHint ? (
        <div
          role="status"
          style={{
            padding: "12px 14px",
            border: "1px solid var(--border-subtle)",
            borderRadius: "var(--radius-sm)",
            background: "var(--bg-elevated)",
            color: "var(--text-primary)",
            fontSize: 13,
            display: "flex",
            alignItems: "flex-start",
            gap: 8,
          }}
        >
          <Icon name="info" size={13} aria-hidden />
          <span>{permissionSubmitBlockedHint}</span>
        </div>
      ) : null}
      </div>

      <aside
        className={cx(
          styles.sidePreview,
          isWizard && !showSidePreview && styles.sidePreviewHidden,
        )}
        aria-label="投稿内容プレビュー"
        hidden={isWizard ? !showSidePreview : undefined}
      >
        <span className={styles.sideEyebrow}>live preview</span>
        <div className={styles.previewCard}>
          <div className={styles.previewVisual}>
            {youtubeId ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img src={youtubeThumbUrl(youtubeId, "hqdefault")} alt="" />
            ) : null}
            <span className={styles.previewCode}>
              {youtubeId ? `yt / ${youtubeId}` : "youtube url"}
            </span>
            <span className={styles.previewPlay} aria-hidden>
              <Icon name="play" size={18} />
            </span>
          </div>
          <div className={styles.previewInfo}>
            <h3>{sidePreviewTitle}</h3>
            <p>{sidePreviewName}</p>
            <span>{isCollab ? "合作作品" : "個人作品"}</span>
          </div>
        </div>
        <dl className={styles.previewChecklist}>
          <PreviewCheck
            ok={youtubePreviewOk}
            pending={youtubePreviewPending}
            label={
              youtubePreviewOptional
                ? "YouTube URL (任意)"
                : "YouTube URL"
            }
          />
          <PreviewCheck ok={Boolean(titlePreview.trim())} label="作品タイトル" />
          <PreviewCheck ok={Boolean(displayNamePreview.trim())} label="表示名" />
          <PreviewCheck
            ok={incompleteRequiredStageQuestionCount === 0}
            label={
              incompleteRequiredStageQuestionCount > 0
                ? `追加質問 ${incompleteRequiredStageQuestionCount} 件は入力必須`
                : selectedStagePermissionFields.length > 0
                  ? `追加質問 ${selectedStagePermissionFields.length} 件は任意`
                  : "追加質問なし"
            }
            pending={incompleteRequiredStageQuestionCount > 0}
          />
          <PreviewCheck
            ok={!isCollab || memberCount > 0}
            label={
              isCollab
                ? `合作メンバー ${memberCount}人`
                : "メンバー入力なし"
            }
            pending={isCollab && memberCount === 0}
          />
        </dl>
        <div className={styles.saveId}>
          <span className={styles.sideEyebrow}>保存名義 / active X ID</span>
          <div className={styles.saveIdRow}>
            <span className={styles.saveIdAvatar}>
              {sidePreviewName.slice(0, 1).toLowerCase()}
            </span>
            <span>
              <strong>{sidePreviewName}</strong>
              <small>
                @{normalizedActiveXId || normalizedInitialXId || "not-selected"}
              </small>
            </span>
          </div>
        </div>
        {selectedEventLabels.length > 0 ? (
          <div className={styles.previewEvents}>
            <span className={styles.sideEyebrow}>events</span>
            {selectedEventLabels.slice(0, 3).map((label) => (
              <span key={label}>{label}</span>
            ))}
            {selectedEventLabels.length > 3 ? (
              <span>ほか {selectedEventLabels.length - 3} 件</span>
            ) : null}
          </div>
        ) : null}
      </aside>

      {!isWizard && mode !== "edit" ? (
        <div className={styles.actions}>
          <button
            type="submit"
            className="fn-btn fn-btn-primary"
            disabled={pending || !canSubmit}
            aria-busy={pending}
          >
            <Icon name="upload" size={14} aria-hidden />
            {pending ? "送信中…" : "提出する"}
          </button>
        </div>
      ) : null}

      {mode === "edit" || !isWizard ? (
        <div
          className={styles.submitDock}
          aria-label={mode === "edit" ? "保存操作" : "送信操作"}
        >
          <div className={styles.submitDockInner}>
            <span className={styles.submitDockHint}>
              {submitBlockedReason
                ? "投稿できません"
                : noEditableFormSections && permissionSubmitBlockedHint
                  ? permissionSubmitBlockedHint
                  : pending
                    ? "送信中…"
                    : mode === "edit"
                      ? "変更を保存できます"
                      : "入力後に提出できます"}
            </span>
            <button
              type="submit"
              className="fn-btn fn-btn-primary"
              disabled={pending || !canSubmit}
              aria-busy={pending}
            >
              <Icon name="upload" size={14} aria-hidden />
              {pending ? "送信中…" : mode === "edit" ? "保存する" : "提出する"}
            </button>
          </div>
        </div>
      ) : (
        <div className={styles.wizardDock} aria-label="ステップ操作">
          <div className={styles.wizardDockInner}>
            <button
              type="button"
              className="fn-btn fn-btn-ghost"
              onClick={goWizardBack}
              disabled={isWizardFirstStep || pending}
            >
              戻る
            </button>
            <span className={styles.wizardNavHint}>
              {wizardSteps[currentStep]?.label ?? ""}
            </span>
            {isWizardLastStep ? (
              <button
                type="submit"
                className="fn-btn fn-btn-primary"
                disabled={pending || !canSubmit}
                aria-busy={pending}
              >
                <Icon name="upload" size={14} aria-hidden />
                {pending ? "送信中…" : "提出する"}
              </button>
            ) : (
              <button
                type="button"
                className="fn-btn fn-btn-primary"
                onClick={goWizardNext}
                disabled={pending}
              >
                次へ
                <Icon name="chevron-right" size={14} aria-hidden />
              </button>
            )}
          </div>
        </div>
      )}
    </form>
  );
}

function PreviewCheck({
  ok,
  pending = false,
  label,
}: {
  ok: boolean;
  pending?: boolean;
  label: string;
}): React.ReactElement {
  const mark = ok ? "✓" : pending ? "!" : "·";
  return (
    <div className={ok ? styles.checkOk : pending ? styles.checkPending : styles.checkTodo}>
      <dt>{mark}</dt>
      <dd>{label}</dd>
    </div>
  );
}

/**
 * 編集モードの提出主体 X ID フィールド。
 *
 * 既定状態:
 *   - 既存の creator_x_user_id / creator_x_user_id を **readOnly** で表示。
 *   - 一切送信されない (hidden name="creator_x_user_id" を出さない) わけにはいかない
 *     ので、視覚的に readOnly な input を出しつつサーバー側が現在値を維持する。
 *
 * 解錠 (admin がチェックボックスを ON):
 *   - <select> に切り替えて xIdOptions から選択させる。
 *   - hidden `allow_submitter_change=1` を一緒に送る。サーバー側は
 *     `role === "admin"` と二重ゲートで検証するので、UI 操作だけでは突破できない。
 *
 * 操作可能な admin がいないケース (xIdOptions が空) では unlock UI 自体を出さない。
 */
function EditSubmitterField({
  initialXId,
  xIdOptions,
  hasSelectableXIds,
  selectedDefault,
  disabled,
  sectionDisabled,
  canChangeSubmitter,
}: {
  initialXId: string;
  xIdOptions: readonly XIdOption[];
  hasSelectableXIds: boolean;
  selectedDefault: string;
  disabled: boolean;
  sectionDisabled: boolean;
  canChangeSubmitter: boolean;
}): React.ReactElement {
  const [unlocked, setUnlocked] = React.useState(false);
  const [selectedXId, setSelectedXId] = React.useState(selectedDefault);
  const [profileAction, setProfileAction] = React.useState<
    "keep" | "copy_default" | ""
  >("");

  const xIdChanged =
    unlocked && normalizeXId(selectedXId) !== normalizeXId(initialXId);

  React.useEffect(() => {
    if (!xIdChanged) setProfileAction("");
  }, [xIdChanged]);

  if (!initialXId && !hasSelectableXIds) {
    return (
      <div className="fn-muted fn-text-sm">提出主体 X ID が設定されていません。</div>
    );
  }

  // 非 admin (canChangeSubmitter === false) は unlock UI を一切出さず、
  // 既存の提出主体 X ID を読み取り専用で表示するだけ。
  if (!unlocked) {
    return (
      <>
        <input
          id="creator_x_user_id"
          name="creator_x_user_id"
          type="text"
          defaultValue={initialXId}
          className="fn-input"
          readOnly
          aria-readonly="true"
          disabled={sectionDisabled}
          style={{ opacity: 0.75, cursor: "default" }}
        />
        {canChangeSubmitter && hasSelectableXIds ? (
          <label
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              marginTop: 6,
              fontSize: 11,
              color: "var(--text-muted)",
              cursor: "pointer",
            }}
          >
            <input
              type="checkbox"
              checked={false}
              onChange={() => setUnlocked(true)}
              disabled={disabled || sectionDisabled}
            />
            提出主体 X ID を変更する (管理者のみ)
          </label>
        ) : (
          <p className="fn-text-sm" style={{ marginTop: 4, color: "var(--text-muted)" }}>
            提出主体 X ID は変更できません。
          </p>
        )}
      </>
    );
  }

  return (
    <>
      <input type="hidden" name="allow_submitter_change" value="1" />
      <select
        id="creator_x_user_id"
        name="creator_x_user_id"
        className="fn-select"
        value={selectedXId}
        onChange={(event) => setSelectedXId(event.currentTarget.value)}
        required
        disabled={disabled}
      >
        {xIdOptions.map((opt, index) => (
          <option
            key={`${opt.id}-xid-option-${index}`}
            value={normalizeXId(opt.id)}
          >
            @{opt.id} ({opt.x_name})
          </option>
        ))}
      </select>
      {xIdChanged ? (
        <fieldset
          style={{
            margin: "10px 0 0",
            padding: 12,
            border: "1px solid var(--border-subtle)",
            borderRadius: "var(--radius-sm)",
            display: "grid",
            gap: 8,
          }}
        >
          <legend style={{ fontSize: 12, fontWeight: 700, padding: "0 6px" }}>
            提出者情報の扱い
          </legend>
          <label
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 8,
              fontSize: 12,
              cursor: "pointer",
            }}
          >
            <input
              type="radio"
              name="submitter_profile_action"
              value="keep"
              checked={profileAction === "keep"}
              onChange={() => setProfileAction("keep")}
              required
            />
            <span>
              <strong>提出者情報を維持</strong>
              <br />
              表示名・アイコン・概要などはこの作品の現状のまま残し、提出主体 X ID だけ変更します。
            </span>
          </label>
          <label
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 8,
              fontSize: 12,
              cursor: "pointer",
            }}
          >
            <input
              type="radio"
              name="submitter_profile_action"
              value="copy_default"
              checked={profileAction === "copy_default"}
              onChange={() => setProfileAction("copy_default")}
              required
            />
            <span>
              <strong>新 X ID の既定を作品へコピー</strong>
              <br />
              変更先 X ID の既定プロフィールで、この作品の提出者情報を上書きします。
            </span>
          </label>
        </fieldset>
      ) : null}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginTop: 6,
          flexWrap: "wrap",
          fontSize: 11,
          color: "var(--accent-danger, #b91c1c)",
        }}
      >
        <Icon name="alert" size={11} aria-hidden />
        提出主体 X ID を変更しようとしています。サーバー側でも管理者権限を再検証します。
        <button
          type="button"
          className="fn-btn fn-btn-ghost fn-btn-sm"
          onClick={() => setUnlocked(false)}
          style={{ marginLeft: "auto" }}
        >
          キャンセル
        </button>
      </div>
    </>
  );
}
