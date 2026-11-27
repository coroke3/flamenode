// MIG-0714 B04: real CURRENT form controller with injected effects and the reviewed section components.
import * as React from "react";
import { flushSync } from "react-dom";
import { useNavigate } from "react-router-dom";
import { Icon } from "../../routes/ui/Icon.tsx";
import { cn as cx } from "../../lib/cn.ts";
import { extractYoutubeId, youtubeThumbUrl, youtubeWatchUrl } from "../../lib/youtubeId.ts";
import type { VideoActionResult } from "../../lib/videoTypes.ts";
import type { VideoMemberInput, VideoMemberSuggestion } from "../../lib/memberInput.ts";
import { normalizeXId } from "@flamenode/domain/xid";
import { getStagePermissionAnswerValue, resolveStagePermissionFieldsFromJson } from "../../lib/videoFormSettings.ts";
import { isRequiredVideoFieldFilled, missingRequiredVideoFieldMessage, REQUIRED_VIDEO_FIELD_WIZARD_STEP,
  unionRequiredVideoFields, type OptionalRequiredVideoField, type RequiredVideoField, type RequiredVideoFieldValues } from "../../lib/requiredVideoFields.ts";
import { redirectForGuardReason } from "../../lib/guardRedirect.ts";
import { submitFormCompat } from "../../lib/submitFormCompat.ts";
import { ACTIVE_X_BEFORE_SWITCH_EVENT } from "../../lib/activeXSwitchEvents.ts";
import { MAX_ATOMIC_VIDEO_CUSTOM_ANSWERS } from "@flamenode/domain/video/atomicLimits";
import { resolveVideoPermissionGroupState } from "../../lib/videoEditPermissionView.ts";
import { hasAnyEditableVideoFormSection, type VideoEditPermissionViewModel } from "../../lib/permissionUnlockHint.ts";
import { formatYoutubeDescriptionMembers, youtubeDescriptionCustomAnswerVariableKey, youtubeDescriptionStagePermissionVariableKey,
  type YoutubeDescriptionContext, type YoutubeDescriptionDynamicVariableDefinition } from "../../lib/youtubeDescriptionTemplate.ts";
import { buildFormDraftStorageKey, draftMetadataMatches, type DraftMetadata, useFormDraft } from "../../lib/useFormDraft.ts";
import { buildVideoFormDraft, parseVideoFormDraft, videoFormDraftToFields,
  VIDEO_FORM_DRAFT_SCHEMA_VERSION, type VideoFormDraftV1 } from "../../lib/videoFormDraft.ts";
import { cleanupExpiredDraftFiles, deleteDraftFile, DRAFT_FILE_TTL_MS, loadDraftFile, saveDraftFile } from "../../lib/draftFileStore.ts";
import { isSectionDisabled, isFieldDisabled, restoreVideoDraftControls, buildVideoDraftControlledState } from "./videoFormDraftFields.ts";
import { acceptedCustomAnswerValues, customAnswerKey, customQuestionFieldId, type VideoDefaultProfile,
  type VideoFormInitialValues, type EventOption, type WizardStepKey, type WizardValidationError } from "./videoFormFieldContracts.ts";
import type { XIdOption } from "./EditSubmitterField.tsx";
import { VideoFormSubmitterSection } from "./VideoFormSubmitterSection.tsx";
import { VideoFormBasicsSection } from "./VideoFormBasicsSection.tsx";
import { VideoFormDescriptionsSection } from "./VideoFormDescriptionsSection.tsx";
import { VideoFormMembersSection } from "./VideoFormMembersSection.tsx";
import { VideoFormConfirmationSection, VideoFormSidePreview } from "./VideoFormReviewPanels.tsx";
import { VideoFormFeedback } from "./VideoFormFeedback.tsx";
import { submitVideoForm, type VideoFormPorts } from "./videoSubmitAdapter.ts";

// Retain only ownership tokens, never draft contents. Accepted cleanup may
// drain after departure; returning to A publishes a new token before restore.
const latestVideoDraftOwners = new Map<string, symbol>();
const pendingVideoDraftFiles = new Map<string, Promise<void>>();

function enqueueVideoDraftFile(key: string, operation: () => Promise<unknown>): void {
  // A new mount must also wait for an old operation already inside IndexedDB.
  // Drain admitted user edits FIFO: remounting is not a new file selection.
  // A success may decline its own cleanup without discarding a prior upload;
  // later owners' writes always follow earlier accepted saves/deletes.
  const next = (pendingVideoDraftFiles.get(key) ?? Promise.resolve())
    .catch(() => undefined)
    .then(async () => { await operation(); });
  pendingVideoDraftFiles.set(key, next);
  void next.finally(() => {
    if (pendingVideoDraftFiles.get(key) === next) pendingVideoDraftFiles.delete(key);
  }).catch(() => undefined);
}

export function VideoForm(props: VideoFormProps): React.ReactElement {
  const auth = props.draftAuthUserId?.trim() ?? "";
  const identity = JSON.stringify([
    "video-form", auth ? "authenticated" : "guest", auth,
    normalizeXId(props.activeXId ?? ""), props.mode, props.slotId, props.videoId,
    props.editPrivilegeMode ?? "normal",
    props.mode === "free" ? normalizeXId(props.activeXId ?? props.initial?.creator_x_user_id ?? "") : null,
  ]);
  return <VideoFormForIdentity key={identity} {...props} />;
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

function draftText(formData: FormData, name: string): string {
  return String(formData.get(name) ?? "");
}

const WIZARD_STEPS_SLOT: { key: WizardStepKey; label: string }[] = [
  { key: "submitter", label: "提出者情報" },
  { key: "work", label: "作品情報" },
  { key: "youtube", label: "YouTube URL" },
  { key: "confirm", label: "確認・送信" },
];

const WIZARD_STEPS_FREE = WIZARD_STEPS_SLOT;

const REQUIRED_VIDEO_FIELD_PERMISSION_KEY: Record<
  OptionalRequiredVideoField,
  string
> = {
  icon_url: "submitter.icon_url",
  profile_text: "submitter.profile_text",
  youtube_channel_url: "submitter.youtube_channel_url",
  other_social_links: "submitter.other_social_links",
  music: "video.music",
  music_reference_url: "video.music_reference_url",
  credit: "video.credit",
  intro_comment: "descriptions.intro_comment",
  highlights: "descriptions.highlights",
  production_story: "descriptions.production_story",
  used_software: "descriptions.used_software",
  closing_comment: "descriptions.closing_comment",
  part: "video.part",
  youtube_url: "video.youtube_url",
};

const REQUIRED_VIDEO_FIELD_DOM_ID: Record<RequiredVideoField, string> = {
  display_name: "display_name",
  title: "title",
  icon_url: "video-form-icon-label",
  profile_text: "profile_text",
  youtube_channel_url: "video-form-channel-label",
  other_social_links: "social-type-0",
  music: "music",
  music_reference_url: "music_reference_url",
  credit: "credit",
  intro_comment: "intro_comment",
  highlights: "highlights",
  production_story: "production_story",
  used_software: "used_software",
  closing_comment: "closing_comment",
  part: "part",
  youtube_url: "youtube_url",
};

function isFilledRequiredText(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

interface VideoFormProps extends VideoFormPorts {
  onRefresh: () => void;
  onFormStateChanged?: () => void;
  mode: "free" | "slot" | "edit";
  initial?: VideoFormInitialValues;
  slotId?: string;
  videoId?: string;
  /** 編集対象が枠投稿の場合、部は slot の値を正本として読み取り専用にする。 */
  schedulingType?: "manual" | "slotted" | null;
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
  /** Auth user id used to isolate local post/edit drafts. */
  draftAuthUserId?: string;
  /** 枠なし投稿の外側draftを、作品保存成功時に削除するための通知。 */
  onSubmitSuccess?: () => void;
  /** 親のイベント切替前に最新の入力を同期保存するための登録口。 */
  onDraftFlushReady?: (flush: () => boolean) => void;
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
function VideoFormForIdentity({
  submit, searchXUsers, applyPermissionBatch, onRefresh, onFormStateChanged,
  mode,
  initial = {},
  slotId,
  videoId,
  schedulingType,
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
  draftAuthUserId,
  onSubmitSuccess,
  onDraftFlushReady,
}: VideoFormProps): React.ReactElement {
  const navigate = useNavigate();
  const formRef = React.useRef<HTMLFormElement>(null);
  // Wizard forms must only submit after an explicit confirmation-button click.
  // This blocks an implicit Enter-key submit from becoming a server action
  // while React is advancing from the previous step to confirmation.
  const wizardConfirmSubmitRequestedRef = React.useRef(false);
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
  const [membersFieldsKey, setMembersFieldsKey] = React.useState(0);
  const displayNamePreview = submitterDisplayName;
  const [isCollab, setIsCollab] = React.useState(
    Boolean(initial.is_collab || (initial.members?.length ?? 0) > 0),
  );
  const [members, setMembers] = React.useState<VideoMemberInput[]>(
    initial.members ?? [],
  );
  const membersRef = React.useRef(members);
  const membersEchoReady = React.useRef(false);
  React.useLayoutEffect(() => { membersRef.current = members; }, [members]);
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
  const initialEventIdsKey = (initial.event_ids ?? []).join("\u001f");
  const initialEventIdsForDraftSync = React.useMemo(
    () => (initialEventIdsKey ? initialEventIdsKey.split("\u001f") : []),
    [initialEventIdsKey],
  );
  React.useEffect(() => {
    // The shell owns event selection for free posts.  Keep the form's
    // questions/hidden event_ids in sync without remounting the whole form.
    if (mode === "free" && !canEditEvents) {
      setSelectedEventIds(initialEventIdsForDraftSync);
    }
  }, [canEditEvents, initialEventIdsForDraftSync, mode]);
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
  const selectedRequired = React.useMemo(
    () =>
      unionRequiredVideoFields(
        eventOptions
          .filter((event) => selectedEventIds.includes(event.id))
          .map((event) => event.required_video_fields_json),
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
  const [dirty, setDirtyState] = React.useState(false);
  const editRef = React.useRef({ revision: 0, dirty: false });
  const mountedRef = React.useRef(false);
  const draftOwner = React.useRef(Symbol("video-form-draft"));
  const authorityKey = JSON.stringify([
    initial, eventOptions, disabledSections, disabledFields, permissionView,
    canEditEvents, canChangeSubmitter, submitBlockedReason, schedulingType,
    normalizeXId(activeXSnapshot ?? activeXId ?? ""), xIdOptions,
  ]);
  const committed = React.useRef({ authorityKey, epoch: 0, onFormStateChanged,
    disabledSections, disabledFields, mode, canEditEvents, eventOptions, initialEventIdsForDraftSync });
  React.useLayoutEffect(() => {
    const epoch = committed.current.epoch + (committed.current.authorityKey === authorityKey ? 0 : 1);
    committed.current = { authorityKey, epoch, onFormStateChanged,
      disabledSections, disabledFields, mode, canEditEvents, eventOptions, initialEventIdsForDraftSync };
  });
  const markFormEdited = React.useCallback((notify = false) => {
    editRef.current.revision += 1;
    editRef.current.dirty = true;
    setDirtyState(true);
    if (notify) committed.current.onFormStateChanged?.();
  }, []);
  // Leaf sections retain their CURRENT setDirty port. Actual native events or
  // changed programmatic values own the revision; passive same-value echoes
  // (notably SocialLinksEditor) must neither notify the shell nor resurrect a
  // just-cleared draft. Clearing is also synchronous for departing cleanup.
  const setDirty = React.useCallback((value: boolean) => {
    if (!value) editRef.current.dirty = false;
    setDirtyState(value && editRef.current.dirty);
  }, []);
  const [draftFormReady, setDraftFormReady] = React.useState(false);
  const [draftStale, setDraftStale] = React.useState(false);
  const [draftFileError, setDraftFileError] = React.useState<string | null>(null);
  const [restoredUploadFile, setRestoredUploadFile] = React.useState<File | null>(null);
  const draftFileRestoreGenerationRef = React.useRef(0);
  // Metadata refresh invalidates reads, not a still-selected queued upload.
  const draftFileSelectionGenerationRef = React.useRef(0);
  const uploadFileRef = React.useRef<File | null>(null);
  const profileValuesRef = React.useRef({ icon: submitterIconUrl, channel: submitterYoutubeChannel,
    social: submitterSocialLinks, socialReady: false });
  React.useLayoutEffect(() => {
    uploadFileRef.current = restoredUploadFile;
    Object.assign(profileValuesRef.current, { icon: submitterIconUrl, channel: submitterYoutubeChannel, social: submitterSocialLinks });
  }, [restoredUploadFile, submitterIconUrl, submitterYoutubeChannel, submitterSocialLinks]);
  const changeIconUrl = (value: string) => {
    if (value !== profileValuesRef.current.icon) markFormEdited(true);
    profileValuesRef.current.icon = value;
    setSubmitterIconUrl(value);
  };
  const changeYoutubeChannel = (value: string) => {
    if (value !== profileValuesRef.current.channel) markFormEdited(true);
    profileValuesRef.current.channel = value;
    setSubmitterYoutubeChannel(value);
  };
  const changeSocialLinks = (value: string) => {
    const previous = profileValuesRef.current;
    if (previous.socialReady && value !== previous.social) markFormEdited(true);
    previous.socialReady = true;
    previous.social = value;
    setSubmitterSocialLinks(value);
  };

  React.useEffect(() => {
    setDraftFormReady(true);
  }, []);

  const normalizedDraftActiveXId = normalizeXId(
    activeXId ?? initial.creator_x_user_id ?? "",
  ) || "unassigned";
  const draftFormId =
    mode === "slot"
      ? `video-slot:${slotId ?? "unknown"}`
      : mode === "edit"
        ? `video-edit:${videoId ?? "unknown"}:${editPrivilegeMode ?? "normal"}`
        : `video-free:${normalizeXId(activeXId ?? "") === "unassigned" ? "xid:unassigned" : normalizedDraftActiveXId}`;
  const draftStorageKey = draftAuthUserId?.trim()
    ? buildFormDraftStorageKey({
        authUserId: draftAuthUserId.trim(),
        formId: draftFormId,
        schemaVersion: VIDEO_FORM_DRAFT_SCHEMA_VERSION,
      })
    : "";
  const draftFileStorageKey = draftStorageKey ? `${draftStorageKey}:icon` : "";
  const ownsDraft = React.useCallback(() => !draftStorageKey ||
    latestVideoDraftOwners.get(draftStorageKey) === draftOwner.current, [draftStorageKey]);
  React.useLayoutEffect(() => {
    mountedRef.current = true;
    if (draftStorageKey) {
      latestVideoDraftOwners.delete(draftStorageKey);
      latestVideoDraftOwners.set(draftStorageKey, draftOwner.current);
      if (latestVideoDraftOwners.size > 64) latestVideoDraftOwners.delete(latestVideoDraftOwners.keys().next().value!);
    }
    return () => { mountedRef.current = false; };
  }, [draftStorageKey]);
  const metadataActiveX = mode === "edit" ? null : normalizeXId(activeXId ?? "") || null;
  const metadataUser = draftAuthUserId?.trim() ?? null;
  const draftMetadata = React.useMemo<DraftMetadata>(
    () => ({
      schemaVersion: VIDEO_FORM_DRAFT_SCHEMA_VERSION,
      authUserId: metadataUser,
      mode,
      slotId: slotId ?? null,
      videoId: videoId ?? null,
      activeXId: metadataActiveX,
      baseRevision: mode === "edit" ? initial.updated_at ?? null : null,
    }),
    [metadataActiveX, metadataUser, initial.updated_at, mode, slotId, videoId],
  );
  const restoreVideoDraft = React.useCallback((rawDraft: VideoFormDraftV1 | unknown) => {
    const draft = parseVideoFormDraft(rawDraft);
    if (!draft) return;
    setDraftStale(false);
    const form = formRef.current;
    if (!form) return;
    const { disabledSections, disabledFields, mode, canEditEvents, eventOptions, initialEventIdsForDraftSync } = committed.current;
    const fields = videoFormDraftToFields(draft);
    restoreVideoDraftControls(form, fields, disabledSections, disabledFields);
    setDescriptionFormValues(readDescriptionFormValues(form));
    const patch = buildVideoDraftControlledState(draft, {
      disabledSections, disabledFields, mode, canEditEvents, eventOptions,
      initialEventIdsForDraftSync, currentMembers: membersRef.current, wizardStepCount: wizardSteps.length,
    });
    if (patch.text.youtube_url !== undefined) setYoutubeUrl(patch.text.youtube_url);
    if (patch.text.title !== undefined) setTitlePreview(patch.text.title);
    if (patch.text.display_name !== undefined) setSubmitterDisplayName(patch.text.display_name);
    if (patch.text.profile_text !== undefined) setSubmitterProfileText(patch.text.profile_text);
    if (patch.text.icon_url !== undefined) setSubmitterIconUrl(patch.text.icon_url);
    if (patch.text.youtube_channel_url !== undefined) setSubmitterYoutubeChannel(patch.text.youtube_channel_url);
    if (patch.text.other_social_links !== undefined) setSubmitterSocialLinks(patch.text.other_social_links);
    if (patch.selectedEventIds !== undefined) setSelectedEventIds(patch.selectedEventIds);
    if (patch.selectedPart !== undefined) setSelectedPart(patch.selectedPart);
    if (patch.isCollab !== undefined) setIsCollab(patch.isCollab);
    if (patch.members !== undefined) {
      membersRef.current = patch.members;
      membersEchoReady.current = false;
      setMembers(patch.members);
    }
    if (patch.customAnswers !== undefined) setCustomAnswers(patch.customAnswers);
    if (patch.stageAnswers !== undefined) setStageAnswers(patch.stageAnswers);
    setCurrentStep(patch.currentStep);
    setMaxReachedStep(patch.maxReachedStep);
    setSubmitterFieldsKey((current) => current + 1);
    setMembersFieldsKey((current) => current + 1);
    markFormEdited(true);
  }, [markFormEdited, wizardSteps.length]);
  const buildCurrentDraft = React.useCallback((): VideoFormDraftV1 | null => {
    if (!draftFormReady || !formRef.current) return null;
    // descriptionFormValues is the change signal for otherwise uncontrolled
    // inputs; reading it here keeps the synchronous submit flush current.
    void descriptionFormValues;
    return buildVideoFormDraft({
      formData: new FormData(formRef.current),
      customAnswers,
      stageAnswers,
      members,
      selectedEventIds,
      selectedPart,
      isCollab,
      currentStep,
      maxReachedStep,
      baselineUpdatedAt: initial.updated_at,
      iconUploadSaved: Boolean(restoredUploadFile),
    });
  }, [
    customAnswers,
    currentStep,
    descriptionFormValues,
    draftFormReady,
    initial.updated_at,
    isCollab,
    maxReachedStep,
    members,
    restoredUploadFile,
    selectedEventIds,
    selectedPart,
    stageAnswers,
  ]);
  const draftSnapshot = React.useMemo(
    () => buildCurrentDraft(),
    [buildCurrentDraft],
  );
  const handleStaleVideoDraft = React.useCallback(() => {
    setDraftStale(true);
  }, []);
  const {
    clearDraft,
    flushDraft,
    restoreStaleDraft,
    restored,
    lastSavedAt,
    saveError,
  } = useFormDraft<VideoFormDraftV1 | null>({
    storageKey: draftStorageKey || "fn:draft:disabled:video-form-v1",
    value: draftSnapshot,
    enabled: Boolean(draftAuthUserId?.trim()),
    ttlMs: 7 * 24 * 60 * 60 * 1000,
    debounceMs: 500,
    shouldSave: dirty,
    metadata: draftMetadata,
    onRestore: restoreVideoDraft,
    onStale: handleStaleVideoDraft,
  });

  const clearVideoDraft = React.useCallback((current: () => boolean = () => true) => {
    if (!mountedRef.current || !ownsDraft() || !current()) return;
    draftFileRestoreGenerationRef.current += 1;
    draftFileSelectionGenerationRef.current += 1;
    clearDraft();
    if (mountedRef.current && ownsDraft()) setRestoredUploadFile(null);
    if (draftFileStorageKey) {
      enqueueVideoDraftFile(draftFileStorageKey, async () => {
        if (current()) await deleteDraftFile(draftFileStorageKey);
      });
    }
  }, [clearDraft, draftFileStorageKey, ownsDraft]);

  const restoreDraftFile = React.useCallback(async (generation: number, clearError = false) => {
    // A fresh owner may restore while the departed owner's write is still in
    // IndexedDB. Do not read an earlier icon or publish into a detached form.
    await pendingVideoDraftFiles.get(draftFileStorageKey)?.catch(() => undefined);
    if (!mountedRef.current || !ownsDraft() || generation !== draftFileRestoreGenerationRef.current) return;
    const file = await loadDraftFile(draftFileStorageKey);
    if (file && mountedRef.current && ownsDraft() && generation === draftFileRestoreGenerationRef.current) {
      if (clearError) setDraftFileError(null);
      setRestoredUploadFile(file);
    }
  }, [draftFileStorageKey, ownsDraft]);

  const restoreStaleVideoDraft = React.useCallback(() => {
    const restored = restoreStaleDraft();
    if (!restored || !draftFileStorageKey) return restored;

    // Stale edit drafts deliberately do not auto-restore their icon. Once the
    // user explicitly chooses the old draft, restore the matching file too,
    // while still guarding against a concurrent clear or unmount.
    const generation = ++draftFileRestoreGenerationRef.current;
    void restoreDraftFile(generation, true);
    return restored;
  }, [draftFileStorageKey, restoreDraftFile, restoreStaleDraft]);

  const handleUploadFileChange = React.useCallback(
    (file: File | null) => {
      if (!mountedRef.current || !ownsDraft()) return;
      if (file && file === uploadFileRef.current) return;
      const changed = file !== uploadFileRef.current;
      uploadFileRef.current = file;
      if (!draftFileStorageKey) {
        if (changed) markFormEdited(true);
        return;
      }
      draftFileRestoreGenerationRef.current += 1;
      const generation = ++draftFileSelectionGenerationRef.current;
      const current = () => ownsDraft() && generation === draftFileSelectionGenerationRef.current;
      setDraftFileError(null);
      setRestoredUploadFile(file);
      if (!file) {
        enqueueVideoDraftFile(draftFileStorageKey, () => deleteDraftFile(draftFileStorageKey));
      } else enqueueVideoDraftFile(draftFileStorageKey, () => saveDraftFile(draftFileStorageKey, file).then((saved) => {
        if (!saved && current() && mountedRef.current) {
          setDraftFileError(
            "文章の下書きは保存されていますが、アップロード画像は保存できませんでした。",
          );
        }
      }));
      // Publish the admitted operation before a host notification can unmount
      // this form and synchronously enqueue a successor's image selection.
      if (changed) markFormEdited(true);
    },
    [draftFileStorageKey, markFormEdited, ownsDraft],
  );

  React.useEffect(() => {
    if (!draftFileStorageKey || typeof window === "undefined") return;
    const generation = ++draftFileRestoreGenerationRef.current;
    let hasCurrentDraft = false;
    try {
      const raw = window.localStorage.getItem(draftStorageKey);
      if (raw) {
        const envelope = JSON.parse(raw) as {
          savedAt?: unknown;
          metadata?: unknown;
        };
        const savedAt = envelope?.savedAt;
        hasCurrentDraft =
          typeof savedAt === "number" &&
          Number.isFinite(savedAt) &&
          Date.now() - savedAt <= 7 * 24 * 60 * 60 * 1000 &&
          savedAt <= Date.now() + 60_000 &&
          draftMetadataMatches(draftMetadata, envelope.metadata);
      }
    } catch {
      hasCurrentDraft = false;
    }
    void cleanupExpiredDraftFiles(DRAFT_FILE_TTL_MS);
    // A file is meaningful only when its text draft is still current.  This
    // prevents an edit draft's stale icon from being restored before the user
    // chooses between the database version and the older draft.
    if (!hasCurrentDraft) return;
    void restoreDraftFile(generation);
  }, [draftFileStorageKey, draftMetadata, draftStorageKey, restoreDraftFile]);

  const flushCurrentDraft = React.useCallback(() => {
    if (!editRef.current.dirty || !ownsDraft()) return false;
    const snapshot = buildCurrentDraft();
    return snapshot ? flushDraft(snapshot) : false;
  }, [buildCurrentDraft, flushDraft, ownsDraft]);
  const departingFlush = React.useRef(flushCurrentDraft);
  React.useLayoutEffect(() => { departingFlush.current = flushCurrentDraft; });
  React.useLayoutEffect(() => () => { departingFlush.current(); }, []);
  React.useEffect(() => {
    onDraftFlushReady?.(flushCurrentDraft);
    return () => onDraftFlushReady?.(() => false);
  }, [flushCurrentDraft, onDraftFlushReady]);

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
      flushDraft();
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
  }, [dirty, flushDraft, pending]);

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
  const videoSectionPermissions = permissionView
    ? [
        permissionView.basics,
        permissionView.youtube,
        permissionView.credits,
        ...(eventOptions.length > 0 ? [permissionView.primaryEvent] : []),
      ]
    : [];
  const membersSectionPermissions = permissionView
    ? [permissionView.members, permissionView.memberChapters]
    : [];
  const videoPermissionState = resolveVideoPermissionGroupState(
    videoSectionPermissions,
  );
  const membersPermissionState = resolveVideoPermissionGroupState(
    membersSectionPermissions,
  );
  const identityPermissionState = permissionView?.identity.editable
    ? "editable"
    : "locked";
  const descriptionsPermissionState = permissionView?.descriptions.editable
    ? "editable"
    : "locked";
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
  const youtubeDescriptionQuestionValues = React.useMemo(() => {
    const context: YoutubeDescriptionContext = {
      stage_permissions: "",
      custom_answers: "",
    };
    const dynamicVariables: YoutubeDescriptionDynamicVariableDefinition[] = [];
    if (!selectedDescriptionEvent) return { context, dynamicVariables };

    const stageLines: string[] = [];
    const stageFields = resolveStagePermissionFieldsFromJson([
      selectedDescriptionEvent.video_form_settings_json,
    ]);
    for (const question of stageFields) {
      const key = youtubeDescriptionStagePermissionVariableKey(question.id);
      if (!key) continue;
      const value = stageAnswers[question.id]?.trim() ?? "";
      context[key] = value;
      dynamicVariables.push({
        key,
        label: `ステージ・権利確認: ${question.label}`,
        sampleValue: value,
      });
      if (value) stageLines.push(`${question.label}: ${value}`);
    }

    const customLines: string[] = [];
    for (const question of selectedDescriptionEvent.custom_questions ?? []) {
      if (!question.is_active) continue;
      const key = youtubeDescriptionCustomAnswerVariableKey(question.question_key);
      if (!key) continue;
      const value = acceptedCustomAnswerValues(
        question,
        customAnswers[
          customAnswerKey(selectedDescriptionEvent.id, question.question_key)
        ],
      ).join(" / ");
      context[key] = value;
      dynamicVariables.push({
        key,
        label: `カスタム質問: ${question.label}`,
        sampleValue: value,
      });
      if (value) customLines.push(`${question.label}: ${value}`);
    }

    context.stage_permissions = stageLines.join("\n");
    context.custom_answers = customLines.join("\n");
    return { context, dynamicVariables };
  }, [customAnswers, selectedDescriptionEvent, stageAnswers]);
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
      creator_icon_url: submitterIconUrl,
      creator_channel_url: submitterYoutubeChannel,
      creator_profile: submitterProfileText,
      creator_social_links: submitterSocialLinks,
      ...memberDescriptionValues,
      part: selectedPart,
      collaboration_type: isCollab ? "合作" : "個人",
      music: readDescriptionValue("music", initial.music),
      music_reference_url: readDescriptionValue(
        "music_reference_url",
        initial.music_reference_url,
      ),
      credit: readDescriptionValue("credit", initial.credit),
      intro_comment: readDescriptionValue("intro_comment", initial.intro_comment),
      highlights: readDescriptionValue("highlights", initial.highlights),
      production_story: readDescriptionValue(
        "production_story",
        initial.production_story,
      ),
      used_software: readDescriptionValue("used_software", initial.used_software),
      closing_comment: readDescriptionValue("closing_comment", initial.closing_comment),
      ...youtubeDescriptionQuestionValues.context,
    };
  }, [
    initial,
    isCollab,
    members,
    readDescriptionValue,
    selectedDescriptionEvent,
    selectedPart,
    submitterDisplayName,
    submitterIconUrl,
    submitterProfileText,
    submitterSocialLinks,
    submitterYoutubeChannel,
    youtubeDescriptionContext,
    youtubeDescriptionQuestionValues.context,
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
    membersSectionDisabled || isFieldDisabled(disabledFields, "members");
  const isCollabFieldDisabled =
    membersListDisabled || isFieldDisabled(disabledFields, "members.is_collab");
  const chaptersFieldDisabled = isFieldDisabled(disabledFields, "chapters");
  const fieldDisabled = (key: string) =>
    isFieldDisabled(disabledFields, key) ||
    (key.startsWith("submitter.") && submitterDisabled) ||
    (key.startsWith("video.") && videoSectionDisabled) ||
    (key.startsWith("descriptions.") && descriptionsDisabled) ||
    (key.startsWith("members.") && key !== "members.is_collab" && membersListDisabled);
  const hasInitialYoutube = Boolean(initial.youtube_url?.trim());
  // updateVideo intentionally keeps the established admin/event privilege
  // path able to clear or replace an attached YouTube ID.  The normal-owner
  // convenience rule must not add a browser-only required constraint that
  // makes that existing privileged path impossible from this form.
  const privilegedYoutubeEdit =
    mode === "edit" &&
    hasInitialYoutube &&
    permissionView?.privilegeMode !== "normal" &&
    permissionView?.youtube.editable === true;
  const isYoutubeUrlRequired =
    !privilegedYoutubeEdit &&
    (mode === "free" ||
      (mode === "edit" && hasInitialYoutube) ||
      selectedRequired.includes("youtube_url"));
  const isYoutubeFieldDisabled = fieldDisabled("video.youtube_url");
  const showYoutubeAddBlockedHint =
    mode === "edit" &&
    !hasInitialYoutube &&
    !youtubeUrl.trim() &&
    isFieldDisabled(disabledFields, "video.youtube_url");
  const youtubePreviewOptional =
    mode === "slot" && !isYoutubeUrlRequired && !youtubeUrl.trim();
  const youtubePreviewOk = Boolean(youtubeId) || youtubePreviewOptional;
  const youtubePreviewPending =
    !youtubePreviewOk && (mode === "free" || Boolean(youtubeUrl.trim()));
  const incompleteRequiredStageQuestionCount = selectedStagePermissionFields.filter(
    (question) => question.required && !stageAnswers[question.id]?.trim(),
  ).length;
  const incompleteRequiredCustomQuestionCount = selectedCustomQuestions.filter(
    ({ event, question }) =>
      question.required &&
      acceptedCustomAnswerValues(
        question,
        customAnswers[customAnswerKey(event.id, question.question_key)],
      ).length === 0,
  ).length;
  const memberCount = members.filter(
    (member) => member.name.trim() || member.x_user_id.trim(),
  ).length;
  const handleMembersChange = React.useCallback((next: VideoMemberInput[]) => {
    const changed = JSON.stringify(next) !== JSON.stringify(membersRef.current);
    if (membersEchoReady.current && changed) markFormEdited(true);
    membersEchoReady.current = true;
    membersRef.current = next;
    if (changed) setMembers(next);
  }, [markFormEdited]);

  const currentStepKey = isWizard ? wizardSteps[currentStep]?.key : null;
  // The confirmation step is the only step allowed to submit.  Use the
  // semantic key instead of the array index so a future step insertion or a
  // restored draft can never turn the YouTube step into a submit action.
  const isWizardLastStep = isWizard && currentStepKey === "confirm";
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
    if (fieldDisabled("descriptions.custom_answers")) return null;
    for (const { event, question } of selectedCustomQuestions) {
      if (!question.required) continue;
      const key = customAnswerKey(event.id, question.question_key);
      if (
        acceptedCustomAnswerValues(question, customAnswers[key]).length > 0
      ) {
        continue;
      }
      return {
        step: "work",
        fieldId: customQuestionFieldId(event.id, question.question_key),
        message: `「${question.label}」を入力してください。`,
      };
    }
    return null;
  };

  const isOptionalFieldRequired = (field: OptionalRequiredVideoField): boolean =>
    selectedRequired.includes(field);

  const isRequiredVideoFieldEditable = (field: RequiredVideoField): boolean => {
    if (field === "display_name") {
      return !fieldDisabled("submitter.display_name") && !submitterDisabled;
    }
    if (field === "title") {
      return !fieldDisabled("video.title") && !videoSectionDisabled;
    }
    return !fieldDisabled(
      REQUIRED_VIDEO_FIELD_PERMISSION_KEY[field as OptionalRequiredVideoField],
    );
  };

  const buildRequiredVideoFieldValues = (): RequiredVideoFieldValues => {
    const form = formRef.current;
    const readNamedValue = (name: string): string | undefined => {
      const element = form?.elements.namedItem(name);
      return element instanceof HTMLInputElement ||
        element instanceof HTMLTextAreaElement ||
        element instanceof HTMLSelectElement
        ? element.value
        : undefined;
    };
    const iconModeElement = form?.elements.namedItem("icon_mode");
    return {
      display_name: submitterDisplayName,
      title: readNamedValue("title") ?? titlePreview,
      icon_mode:
        iconModeElement instanceof HTMLInputElement
          ? iconModeElement.value
          : undefined,
      icon_url: submitterIconUrl,
      // keep は編集開始時に保存済みだった値だけを採用する。現在の選択値を
      // 入れると、picker state がずれた際に未保存URLを既存値と誤認する。
      existing_icon_url: initial.icon_url ?? null,
      profile_text: submitterProfileText,
      youtube_channel_url: submitterYoutubeChannel,
      other_social_links: submitterSocialLinks,
      music: readNamedValue("music"),
      music_reference_url: readNamedValue("music_reference_url"),
      credit: readNamedValue("credit"),
      intro_comment: readNamedValue("intro_comment"),
      highlights: readNamedValue("highlights"),
      production_story: readNamedValue("production_story"),
      used_software: readNamedValue("used_software"),
      closing_comment: readNamedValue("closing_comment"),
      part: selectedPart,
      youtube_url: youtubeUrl,
    };
  };

  const validateRequiredVideoFieldsForStep = (
    stepKey: WizardStepKey,
  ): WizardValidationError | null => {
    const fieldsToCheck: RequiredVideoField[] = [];
    if (stepKey === "submitter") fieldsToCheck.push("display_name");
    if (stepKey === "work") fieldsToCheck.push("title");
    for (const field of selectedRequired) {
      if (REQUIRED_VIDEO_FIELD_WIZARD_STEP[field] === stepKey) {
        fieldsToCheck.push(field);
      }
    }
    const values = buildRequiredVideoFieldValues();
    for (const field of fieldsToCheck) {
      if (!isRequiredVideoFieldEditable(field)) continue;
      if (field === "youtube_url" && !isYoutubeUrlRequired) continue;
      const filled =
        field === "display_name" || field === "title"
          ? isFilledRequiredText(values[field])
          : isRequiredVideoFieldFilled(field, values);
      if (!filled) {
        return {
          step: stepKey,
          fieldId: REQUIRED_VIDEO_FIELD_DOM_ID[field],
          message: missingRequiredVideoFieldMessage(field),
        };
      }
    }
    if (stepKey === "youtube" && isYoutubeUrlRequired) {
      const trimmed = values.youtube_url?.trim() ?? "";
      if (trimmed && !extractYoutubeId(trimmed)) {
        return {
          step: "youtube",
          fieldId: "youtube_url",
          message: "有効な YouTube URL または動画 ID を入力してください。",
        };
      }
    }
    return null;
  };

  const validateSelectedRequiredVideoFields =
    (): WizardValidationError | null => {
      for (const step of ["submitter", "work", "youtube"] as const) {
        const err = validateRequiredVideoFieldsForStep(step);
        if (err) return err;
      }
      return null;
    };

  const validateCustomAnswerLimit = (): WizardValidationError | null => {
    if (fieldDisabled("descriptions.custom_answers")) return null;
    const filled = selectedCustomQuestions.filter(
      ({ event, question }) =>
        acceptedCustomAnswerValues(
          question,
          customAnswers[customAnswerKey(event.id, question.question_key)],
        ).length > 0,
    ).length;
    if (filled <= MAX_ATOMIC_VIDEO_CUSTOM_ANSWERS) return null;
    return {
      step: "work",
      message: `カスタム質問の回答は最大${MAX_ATOMIC_VIDEO_CUSTOM_ANSWERS}件まで保存できます。`,
    };
    };

  const validateWizardStep = (
    stepKey: WizardStepKey,
  ): WizardValidationError | null => {
    if (stepKey === "submitter") {
      if (isActiveXFixed && !normalizedActiveXId) {
        return {
          step: "submitter",
          fieldId: "creator_x_user_id",
          message: "承認済み X ID がありません。設定画面から連携してください。",
        };
      }
      const requiredFieldError = validateRequiredVideoFieldsForStep("submitter");
      if (requiredFieldError) return requiredFieldError;
      return null;
    }

    if (stepKey === "work") {
      const requiredFieldError = validateRequiredVideoFieldsForStep("work");
      if (requiredFieldError) return requiredFieldError;

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
      return validateCustomAnswerLimit();
    }

    if (stepKey === "youtube") {
      const trimmed = youtubeUrl.trim();
      if (!trimmed) {
        if (!isYoutubeUrlRequired) return null;
        return {
          step: "youtube",
          fieldId: "youtube_url",
          message: missingRequiredVideoFieldMessage("youtube_url"),
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

  const validateWizardSubmission = (): WizardValidationError | null => {
    for (const step of wizardSteps) {
      if (step.key === "confirm") continue;
      const error = validateWizardStep(step.key);
      if (error) return error;
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

  const submitWizardFromConfirmation = () => {
    if (!isWizard || !isWizardLastStep || pending || !canSubmit) return;
    const form = formRef.current;
    if (!form) return;
    const validationError = validateWizardSubmission();
    if (validationError) {
      setStepError(validationError);
      return;
    }
    wizardConfirmSubmitRequestedRef.current = true;
    try {
      submitFormCompat(form);
    } finally {
      // requestSubmit dispatches synchronously; reset as well when native
      // constraint validation prevents the submit event from firing.
      wizardConfirmSubmitRequestedRef.current = false;
    }
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
    markFormEdited(true);
  };

  const handleSubmit = (ev: React.FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    if (pending || submitInFlightRef.current) return;
    const form = ev.currentTarget;
    // Persist the latest keystroke before validation/action invocation.  A
    // Worker 1102 or a thrown Server Action must leave this draft intact.
    if (dirty) flushDraft(buildCurrentDraft() ?? undefined);
    // A browser/keyboard submit can fire even when the visible wizard control
    // is meant to be "次へ" (for example, pressing Enter in the YouTube
    // field). Never send from steps 1–3; advance to the explicit confirmation
    // step and keep the server action untouched until the user submits there.
    if (isWizard) {
      if (currentStepKey !== "confirm") {
        wizardConfirmSubmitRequestedRef.current = false;
        goWizardNext();
        return;
      }
      if (!wizardConfirmSubmitRequestedRef.current) {
        setStepError({
          step: "confirm",
          message: "内容を確認してから「提出する」を押してください。",
        });
        return;
      }
      wizardConfirmSubmitRequestedRef.current = false;
    }
    if (isWizard) {
      for (const stepKey of ["submitter", "work", "youtube"] as const) {
        const wizardStepError = validateWizardStep(stepKey);
        if (wizardStepError) {
          setStepError(wizardStepError);
          setResult({ ok: false, message: wizardStepError.message });
          return;
        }
      }
    } else {
      if (mode === "edit") {
        const requiredFieldError = validateSelectedRequiredVideoFields();
        if (requiredFieldError) {
          setStepError(requiredFieldError);
          setResult({ ok: false, message: requiredFieldError.message });
          return;
        }
      }
      const customQuestionError =
        validateRequiredCustomQuestions() ?? validateCustomAnswerLimit();
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
    const revision = editRef.current.revision;
    const authority = committed.current.epoch;
    const requestUnchanged = () => revision === editRef.current.revision && authority === committed.current.epoch;
    const requestCurrent = () => ownsDraft() && requestUnchanged();
    const requestSuccess = onSubmitSuccess;
    const requestRefresh = onRefresh;
    setResult(null);
    submitInFlightRef.current = true;
    startTransition(async () => {
      try {
        const r = await submitVideoForm(mode, formData, submit);
        // Departure can mean revoked selection/authority without a successor
        // at this key. Only a still-mounted request may accept its response.
        if (!mountedRef.current || !requestCurrent()) return;
        const currentPath =
          typeof window === "undefined"
            ? "/"
            : `${window.location.pathname}${window.location.search}`;
        if (!r.ok && requestCurrent() && redirectForGuardReason({ push: navigate }, r.reason, currentPath)) {
          // リダイレクトで離脱するので dirty 警告は不要にする。
          setDirty(false);
          return;
        }
        setResult(r);
        if (r.ok && requestCurrent()) {
          // Commit the clean draft-hook lifecycle before any success callback
          // can synchronously navigate/pagehide. Same-value child echoes stay
          // clean; queued icon deletion rechecks this exact request later.
          flushSync(() => setDirty(false));
          if (!mountedRef.current || !requestCurrent()) return;
          clearVideoDraft(requestUnchanged);
          flushSync(() => requestSuccess?.());
          if (mode === "edit" && mountedRef.current && requestCurrent()) requestRefresh();
        }
        // 新規投稿後は自動遷移をやめて成功 CTA (公開ページ / イベント / 編集を続ける) を出す。
        // 「投稿できた → 公開ページ確認したい」「→ イベントに戻りたい」を選べるようにする。
        // 編集モードはその場に留まり、router.refresh で最新値を反映する。
      } catch (error) {
        console.error("[VideoForm] submit failed", error);
        if (!mountedRef.current || !requestCurrent()) return;
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
        "vform-form",
        mode === "edit" ? "vform-formEditMode" : "",
        !isWizard && mode !== "edit" ? "vform-formMobileDock" : "",
        isWizard ? "vform-formWizardMode" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      // Hidden wizard steps intentionally remain mounted so their values are
      // included in the final FormData. Native validation would nevertheless
      // stop requestSubmit() on an off-screen required control before React
      // can move the user to that step, so the wizard performs the complete
      // validation above and delegates the final result to the server action.
      noValidate={isWizard}
      onSubmit={handleSubmit}
      onChange={(event) => {
        markFormEdited();
        setDescriptionFormValues(readDescriptionFormValues(event.currentTarget));
      }}
    >
      {slotId ? <input type="hidden" name="slot_id" value={slotId} /> : null}
      {videoId ? <input type="hidden" name="video_id" value={videoId} /> : null}
      {mode === "edit" && initial.updated_at != null ? (
        <input type="hidden" name="revision" value={initial.updated_at} />
      ) : null}
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
        <nav className={"vform-stepProgress"} aria-label="投稿ステップ">
          <ol className={"vform-stepProgressList"}>
            {wizardSteps.map((step, index) => {
              const state =
                index < currentStep
                  ? "done"
                  : index === currentStep
                    ? "current"
                    : "pending";
              const clickable = index <= maxReachedStep && index !== currentStep;
              return (
                <li key={step.key} className={"vform-stepProgressItem"}>
                  <button
                    type="button"
                    className={"vform-stepProgressButton"}
                    data-state={state}
                    data-clickable={clickable ? "true" : undefined}
                    disabled={!clickable}
                    onClick={() => goToWizardStep(index)}
                    aria-current={index === currentStep ? "step" : undefined}
                  >
                    <span className={"vform-stepProgressIndex"} aria-hidden>
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

      <div className={"vform-formMain"}>

      {draftStale ? (
        <div className={"vform-stepError"} role="alert">
          <Icon name="warning" size={13} aria-hidden />
          <span>
            この下書きの保存後に作品が更新されています。現在のDB内容を使うか、古い下書きを復元してください。
          </span>
          <button
            type="button"
            className="fn-btn fn-btn-ghost fn-btn-sm"
            onClick={() => {
              setDraftStale(false);
              restoreStaleVideoDraft();
            }}
          >
            古い下書きを復元
          </button>
          <button
            type="button"
            className="fn-btn fn-btn-ghost fn-btn-sm"
            onClick={() => {
              setDraftStale(false);
              clearVideoDraft();
            }}
          >
            現在のDB内容を使う
          </button>
        </div>
      ) : null}
      {saveError || draftFileError ? (
        <div className={"vform-stepError"} role="status" aria-live="polite">
          <Icon name="warning" size={13} aria-hidden />
          <span>{saveError ?? draftFileError}</span>
        </div>
      ) : restored || lastSavedAt ? (
        <p className={"vform-help"} aria-live="polite">
          {restored ? "前回の下書きを復元しました。" : "下書き保存済み "}
          {!restored && lastSavedAt
            ? new Intl.DateTimeFormat("ja-JP", { hour: "2-digit", minute: "2-digit" }).format(lastSavedAt)
            : null}
        </p>
      ) : null}

      {stepError ? (
        <div id="wizard-validation-error" className={"vform-stepError"} role="alert">
          <Icon name="warning" size={13} aria-hidden />
          <span>{stepError.message}</span>
        </div>
      ) : null}

      <div
        className={cx(
          "vform-stepPanel",
          isWizard && !isStepVisible("submitter") && "vform-stepPanelHidden",
        )}
        hidden={isWizard ? !isStepVisible("submitter") : undefined}
      >
      <VideoFormSubmitterSection
        mode={mode}
        showPermissionUi={showPermissionUi}
        permissionView={permissionView}
        fieldDisabled={fieldDisabled}
        isOptionalFieldRequired={isOptionalFieldRequired}
        stepError={stepError}
        setDirty={setDirty}
        initial={initial}
        defaultProfile={defaultProfile}
        submitterDisabled={submitterDisabled}
        identityPermissionState={identityPermissionState}
        handleReapplyDefaultProfile={handleReapplyDefaultProfile}
        isActiveXFixed={isActiveXFixed}
        normalizedActiveXId={normalizedActiveXId}
        normalizedInitialXId={normalizedInitialXId}
        xIdOptions={xIdOptions}
        hasSelectableXIds={hasSelectableXIds}
        selectedDefault={selectedDefault}
        disabledSections={disabledSections}
        canChangeSubmitter={canChangeSubmitter}
        submitterDisplayName={submitterDisplayName}
        setSubmitterDisplayName={setSubmitterDisplayName}
        submitterFieldsKey={submitterFieldsKey}
        iconCandidates={iconCandidates}
        submitterIconUrl={submitterIconUrl}
        setSubmitterIconUrl={changeIconUrl}
        restoredUploadFile={restoredUploadFile}
        handleUploadFileChange={handleUploadFileChange}
        setDraftFileError={setDraftFileError}
        submitterProfileText={submitterProfileText}
        setSubmitterProfileText={setSubmitterProfileText}
        submitterYoutubeChannel={submitterYoutubeChannel}
        setSubmitterYoutubeChannel={changeYoutubeChannel}
        channelCandidates={channelCandidates}
        submitterSocialLinks={submitterSocialLinks}
        setSubmitterSocialLinks={changeSocialLinks}
      />
      </div>

      <div
        className={cx(
          "vform-stepPanel",
          isWizard && !isStepVisible("work") && "vform-stepPanelHidden",
        )}
        hidden={isWizard ? !isStepVisible("work") : undefined}
      >
      <VideoFormBasicsSection
        mode={mode}
        showPermissionUi={showPermissionUi}
        permissionView={permissionView}
        fieldDisabled={fieldDisabled}
        isOptionalFieldRequired={isOptionalFieldRequired}
        stepError={stepError}
        setDirty={setDirty}
        initial={initial}
        videoSectionDisabled={videoSectionDisabled}
        videoPermissionState={videoPermissionState}
        videoSectionPermissions={videoSectionPermissions}
        eventOptions={eventOptions}
        setTitlePreview={setTitlePreview}
        isWizard={isWizard}
        isYoutubeUrlRequired={isYoutubeUrlRequired}
        youtubeUrl={youtubeUrl}
        setYoutubeUrl={setYoutubeUrl}
        isYoutubeFieldDisabled={isYoutubeFieldDisabled}
        showYoutubeAddBlockedHint={showYoutubeAddBlockedHint}
        youtubeId={youtubeId}
        slotId={slotId}
        selectedEventIds={selectedEventIds}
        canEditEvents={canEditEvents}
        setSelectedEventIds={setSelectedEventIds}
        schedulingType={schedulingType}
        availableParts={availableParts}
        selectedPart={selectedPart}
        setSelectedPart={setSelectedPart}
      />

      <VideoFormDescriptionsSection
        mode={mode}
        showPermissionUi={showPermissionUi}
        permissionView={permissionView}
        fieldDisabled={fieldDisabled}
        isOptionalFieldRequired={isOptionalFieldRequired}
        stepError={stepError}
        setDirty={setDirty}
        initial={initial}
        selectedDescriptionEvent={selectedDescriptionEvent}
        youtubeDescriptionRenderContext={youtubeDescriptionRenderContext}
        members={members}
        youtubeDescriptionQuestionValues={youtubeDescriptionQuestionValues}
        descriptionsDisabled={descriptionsDisabled}
        descriptionsPermissionState={descriptionsPermissionState}
        softwareSuggestions={softwareSuggestions}
        selectedStagePermissionFields={selectedStagePermissionFields}
        stageAnswers={stageAnswers}
        setStageAnswers={setStageAnswers}
        selectedCustomQuestions={selectedCustomQuestions}
        customAnswers={customAnswers}
        setCustomAnswers={setCustomAnswers}
        selectedEventIds={selectedEventIds}
      />

      <VideoFormMembersSection
        mode={mode}
        showPermissionUi={showPermissionUi}
        permissionView={permissionView}
        membersSectionDisabled={membersSectionDisabled}
        membersPermissionState={membersPermissionState}
        membersSectionPermissions={membersSectionPermissions}
        isCollabFieldDisabled={isCollabFieldDisabled}
        isCollab={isCollab}
        setIsCollab={setIsCollab}
        membersFieldsKey={membersFieldsKey}
        members={members}
        memberSuggestions={memberSuggestions}
        membersListDisabled={membersListDisabled}
        chaptersFieldDisabled={chaptersFieldDisabled}
        handleMembersChange={handleMembersChange}
        videoId={videoId}
        searchXUsers={searchXUsers}
        applyPermissionBatch={applyPermissionBatch}
      />
      </div>

      {isWizard ? (
        <div
          className={cx(
            "vform-stepPanel",
            !isStepVisible("youtube") && "vform-stepPanelHidden",
          )}
          hidden={!isStepVisible("youtube")}
        >
          <section className={"vform-section"}>
            <h2 className={"vform-sectionTitle"}>
              <Icon name="youtube" size={14} aria-hidden /> YouTube URL 登録
            </h2>
            <div className={"vform-youtubeStepSection"}>
              <div className={cx("vform-field", "vform-editableField")}>
                <label
                  className={`${"vform-label"}${isYoutubeUrlRequired ? ` ${"vform-required"}` : ""}`}
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
                  required={isYoutubeUrlRequired}
                  readOnly={isYoutubeFieldDisabled}
                  aria-readonly={isYoutubeFieldDisabled || undefined}
                  aria-invalid={stepError?.fieldId === "youtube_url" || undefined}
                  aria-describedby={
                    stepError?.fieldId === "youtube_url"
                      ? "wizard-validation-error"
                      : undefined
                  }
                />
                <p className={"vform-help"}>
                  {isYoutubeUrlRequired
                    ? "イベント設定により必須です。限定公開でも登録可能です。"
                    : mode === "slot"
                      ? "任意。後から編集で追加できます。入力すると下にサムネイルが表示されます。"
                      : "限定公開でも登録可能です。URL を入力すると下にサムネイルが表示されます。"}
                </p>
              </div>
              {youtubeId ? (
                <div className={"vform-youtubeStepPreview"}>
                  <div className={"vform-youtubeStepThumb"}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={youtubeThumbUrl(youtubeId, "hqdefault")} alt="" />
                  </div>
                  <div className={"vform-youtubeStepMeta"}>
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
              ) : mode === "slot" && !isYoutubeUrlRequired ? (
                <p className={"vform-help"}>
                  未入力のまま次へ進めます。後から編集で追加できます。
                </p>
              ) : (
                <p className={"vform-help"}>
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
            "vform-stepPanel",
            !isStepVisible("confirm") && "vform-stepPanelHidden",
          )}
          hidden={!isStepVisible("confirm")}
        >
          <VideoFormConfirmationSection
        normalizedActiveXId={normalizedActiveXId}
        normalizedInitialXId={normalizedInitialXId}
        displayNamePreview={displayNamePreview}
        titlePreview={titlePreview}
        selectedEventLabels={selectedEventLabels}
        isCollab={isCollab}
        memberCount={memberCount}
        incompleteRequiredStageQuestionCount={incompleteRequiredStageQuestionCount}
        selectedCustomQuestions={selectedCustomQuestions}
        youtubeId={youtubeId}
        mode={mode}
        selectedEventIds={selectedEventIds}
        customAnswers={customAnswers}
        jumpToWizardStep={jumpToWizardStep}
      />
        </div>
      ) : null}

      <VideoFormFeedback mode={mode} result={result} submitBlockedReason={submitBlockedReason}
        noEditableFormSections={noEditableFormSections} permissionSubmitBlockedHint={permissionSubmitBlockedHint} />
      </div>

      <VideoFormSidePreview
        normalizedActiveXId={normalizedActiveXId}
        normalizedInitialXId={normalizedInitialXId}
        displayNamePreview={displayNamePreview}
        titlePreview={titlePreview}
        selectedEventLabels={selectedEventLabels}
        isCollab={isCollab}
        memberCount={memberCount}
        incompleteRequiredStageQuestionCount={incompleteRequiredStageQuestionCount}
        selectedCustomQuestions={selectedCustomQuestions}
        youtubeId={youtubeId}
        isWizard={isWizard}
        showSidePreview={showSidePreview}
        sidePreviewTitle={sidePreviewTitle}
        sidePreviewName={sidePreviewName}
        youtubePreviewOk={youtubePreviewOk}
        youtubePreviewPending={youtubePreviewPending}
        youtubePreviewOptional={youtubePreviewOptional}
        selectedStagePermissionFields={selectedStagePermissionFields}
        incompleteRequiredCustomQuestionCount={incompleteRequiredCustomQuestionCount}
      />

      {!isWizard && mode !== "edit" ? (
        <div className={"vform-actions"}>
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
          className={"vform-submitDock"}
          aria-label={mode === "edit" ? "保存操作" : "送信操作"}
        >
          <div className={"vform-submitDockInner"}>
            <span className={"vform-submitDockHint"}>
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
        <div className={"vform-wizardDock"} aria-label="ステップ操作">
          <div className={"vform-wizardDockInner"}>
            <button
              type="button"
              className="fn-btn fn-btn-ghost"
              onClick={goWizardBack}
              disabled={isWizardFirstStep || pending}
            >
              戻る
            </button>
            <span className={"vform-wizardNavHint"}>
              {wizardSteps[currentStep]?.label ?? ""}
            </span>
            {isWizardLastStep ? (
              <button
                type="button"
                className="fn-btn fn-btn-primary"
                onClick={submitWizardFromConfirmation}
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
