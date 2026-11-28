/**
 * MIG-0651 SA-086: POST /api/videos/free (Hono counterpart to CURRENT
 * src/lib/actions/video/createFreeVideo.ts).
 *
 * Guard stack (mounted in ./index.ts):
 *   Cache-Control: private, no-store -> originGuardMiddleware -> session
 *   -> writeGuardMiddleware({ requiredRole: null, activeX: { requireApprovedActiveXId: true, feature: "post_video_unslotted" } })
 *   -> dbMiddleware -> limitVideoActionBody("SA-086") (8 MiB).
 *
 * Pre-batch D1 reads: 2 (guard user + CostGuard/audit settings) + 1 (combined
 * event/required-fields/YouTube-duplicate/question-policy read, or 1 duplicate
 * probe when unaffiliated) = 3 for base submissions (optional +1/+1 for
 * existing /api/media icon check, collab member X resolution, or software
 * lookup), followed by 1 audited atomic D1 batch via mutateWithAudit.
 * Custom R2 icon upload executes right before the D1 batch and is rolled back
 * by deleting only the uploaded R2 key if plan preparation or D1 commit fails.
 * Queue wake = 0 (NOOP_WAKE_HOST; DOCUMENTED DIFFERENCE D-0603-1).
 */
import type { VideoSubmitResult } from "@flamenode/contracts";
import { MAX_SLOTS_PER_VIDEO } from "@flamenode/domain/slots/limits";
import { canActAsSlotSubmitter, resolveSlotGroupIdentity, resolveSlotSubmissionRelation } from "@flamenode/domain/slots/slotIdentity";
import { resolveSlotReservationSubject } from "@flamenode/domain/slots/reservationGroups";
import { MAX_ATOMIC_VIDEO_SOFTWARES } from "@flamenode/domain/video/atomicLimits";
import { normalizeSoftwareLabels } from "@flamenode/domain/software/labels";
import {
  extractYoutubeId,
  firstMissingRequiredVideoField,
  missingRequiredVideoFieldMessage,
  normalizeIconUrl,
  parseVideoForm,
  UnslottedEventSyncError,
  validateFreeVideoMultipartPreflight,
  validateSubmissionCustomAnswers,
  validateUniqueUnslottedVideoScalarFields,
  type FreeVideoPreflightContext,
  type RequiredVideoFieldValues,
  type SubmissionCustomAnswerDraft,
  type VideoFormData,
} from "@flamenode/domain/video";
import { validateActiveXSnapshot } from "@flamenode/domain/xid";
import { mutateWithAudit } from "@flamenode/server-core/audit/mutate";
import type { ServerCoreDb } from "@flamenode/server-core/db";
import { generateId } from "@flamenode/server-core/id";
import {
  formatOpsActorSection,
  type NotificationActor,
} from "@flamenode/server-core/notifications/actor";
import {
  escapeDiscordMention,
  type DiscordBlock,
} from "@flamenode/server-core/notifications/discordText";
import { buildFreeVideoRow } from "@flamenode/server-core/video/freeVideoRow";
import {
  buildSlotSubmissionStagePermissionSubmission,
  decodeGeneralCustomQuestionPolicyProjection,
  decodeSlotSubmissionGeneralQuestions,
  loadEligibleUnslottedVideoRequiredFields,
  resolveSlotSubmissionStagePermissionFields,
  validateSlotSubmissionRequiredFields,
  type LoadedGeneralCustomQuestion,
  type SlotSubmissionEventConfig,
  type SlotSubmissionReceipt,
  type SlotSubmissionReceiptRow,
  type SlotSubmissionStagePermissionField,
  type SlotSubmissionVideoEventReceipt,
} from "@flamenode/server-core/video/requiredVideoFields";
import { buildFreeVideoSubmissionWithRebuildPlan } from "@flamenode/server-core/video/unslottedEventPlans";
import { areSlotsInSamePart, sortSlotsChronologically } from "@flamenode/server-core/video/slotGrouping";
import {
  checkYoutubeVideoDuplicate,
  isYoutubeIdUniqueConstraintError,
} from "@flamenode/server-core/video/youtubeDuplicate";
import { Hono, type Context, type MiddlewareHandler } from "hono";
import type { AppEnv } from "../../env.ts";
import { limitVideoActionBody } from "../../middleware/bodyLimit.ts";
import { auditPreloaded } from "../admin/body.ts";
import { normalizeYoutubeChannelInput } from "../personal/candidates.ts";
import { validateIconImageUpload } from "../xid/iconImage.ts";

const BAD_FORM_MESSAGE = "投稿フォームの入力が不正です。";
const UNEXPECTED_SUBMIT_ERROR_MESSAGE =
  "投稿処理中に一時的なエラーが発生しました。入力内容を確認して、もう一度お試しください。";
const CONFLICT_SAVE_ERROR_MESSAGE =
  "イベント設定が変更されたか、保存内容が競合しました。入力内容を確認して再試行してください。";
const DUPLICATE_YOUTUBE_MESSAGE = "このYouTube動画は既に登録されています。";
const INVALID_YOUTUBE_URL_MESSAGE = "YouTube URLを解析できません。";
const MAX_VIDEO_ICON_BYTES = 2 * 1024 * 1024;
const MAX_ICON_CANDIDATES = 40;

export const NOOP_SA086_WAKE_HOST = Object.freeze({
  mode: "noop_cron_only",
  wakeCount: 0,
  decision: "D-0603-1",
});

function failSubmit(
  c: Context<AppEnv>,
  status: 400 | 403 | 409 | 503,
  message: string,
) {
  c.header("Cache-Control", "private, no-store");
  const body: VideoSubmitResult = { ok: false, message };
  return c.json(body, status);
}

/** Parse exactly the multipart/urlencoded form transport, without first/last
 * key collapsing. FormData is fed to the shared duplicate-keys and identity
 * checks; malformed encoding/file boundaries fail closed before a write plan.
 * Bytes are bounded by the caller's limitVideoActionBody middleware.
 */
export async function readFreeVideoMultipartPreflight(
  c: Context<AppEnv>,
  trustedContext: Pick<FreeVideoPreflightContext, "activeXId" | "nowSec">,
): Promise<
  | { ok: false; message: string; failureKind?: "snapshot" | "validation" }
  | {
      ok: true;
      value: {
        requestedEventId: string | null;
        memberSubmission: Extract<
          ReturnType<typeof validateFreeVideoMultipartPreflight>,
          { ok: true }
        >["value"]["memberSubmission"];
        scheduledTime: number;
        videoForm: VideoFormData;
        formData: FormData;
      };
    }
> {
  const contentType = c.req.header("content-type")?.trim() ?? "";
  if (!/^(multipart\/form-data|application\/x-www-form-urlencoded)(?:\s*;|$)/i.test(contentType)) {
    return { ok: false, message: BAD_FORM_MESSAGE };
  }

  let formData: FormData;
  try {
    formData = await c.req.formData();
  } catch {
    return { ok: false, message: BAD_FORM_MESSAGE };
  }
  const unique = validateUniqueUnslottedVideoScalarFields(formData);
  if (!unique.ok) return unique;

  // Match CURRENT createFreeVideo order for active_x_snapshot before full form errors when stale.
  const rawSnapshot = formData.get("active_x_snapshot");
  const snapshotCheck = validateActiveXSnapshot({
    submittedSnapshot: typeof rawSnapshot === "string" ? rawSnapshot : null,
    currentActiveXId: trustedContext.activeXId,
  });
  if (!snapshotCheck.ok) {
    return { ok: false, message: snapshotCheck.message, failureKind: "snapshot" };
  }

  const parsed = parseVideoForm(Object.fromEntries(formData));
  if (!parsed.ok) return parsed;

  const preflight = validateFreeVideoMultipartPreflight(formData, {
    ...trustedContext,
    isCollab: parsed.data.is_collab,
  });
  if (!preflight.ok) return preflight;
  return {
    ok: true,
    value: { ...preflight.value, videoForm: parsed.data, formData },
  };
}

const SLOT_SUBMIT_REJECT_MESSAGE = "枠が見つかりません。";
const SLOT_GROUP_REJECT_MESSAGE =
  "この枠は現在とは別の活動名義で確保されています。Active X IDを切り替えてから操作してください。";

type SlotSubmissionActor = {
  authUserId: string;
  activeXId: string | null;
  approvedXIds: readonly string[];
};

/** SA-088 early authorization, before form validation and late group errors.
 * The caller has already run the trusted write guard and resolved slotId.
 * No receipt field grants permission on its own. No route is mounted here.
 */
export function validateSlotSubmissionAnchor(
  receipt: SlotSubmissionReceipt | null,
  actor: SlotSubmissionActor,
  submittedSnapshot: string | null,
): { ok: true; activeXId: string } | { ok: false; message: string } {
  if (!receipt) return { ok: false, message: SLOT_SUBMIT_REJECT_MESSAGE };
  const slotRow = receipt.anchor;
  const relation = resolveSlotSubmissionRelation({
    reservedByUserId: slotRow.reserved_by_user_id,
    slotXUserId: slotRow.x_user_id,
    authUserId: actor.authUserId,
    activeXId: actor.activeXId,
  });
  if (!canActAsSlotSubmitter(relation)) {
    return { ok: false, message: SLOT_SUBMIT_REJECT_MESSAGE };
  }
  const snapshot = validateActiveXSnapshot({
    submittedSnapshot,
    currentActiveXId: actor.activeXId,
  });
  if (!snapshot.ok) return { ok: false, message: snapshot.message };
  if (!actor.activeXId || !actor.approvedXIds.includes(actor.activeXId)) {
    return { ok: false, message: "承認済みのX IDを選択してください。" };
  }
  return { ok: true, activeXId: actor.activeXId };
}

/** SA-088 late group preflight: call only AFTER anchor authorization,
 * form, duplicate/member/event/stage/general-answer/required-field validation.
 * Uses the server-core CURRENT-compatible comparator, parity-tested against the
 * existing slot UI helper; no import across the Next boundary.
 * Never apply a new deadline or configured max-slots policy to this step.
 */
export function validateSlotSubmissionGroup(
  receipt: SlotSubmissionReceipt,
  guard: SlotSubmissionActor & { activeXId: string },
  eventConfig: { slot_part_gap_minutes: number | null } | null,
): { ok: true; rows: SlotSubmissionReceiptRow[]; groupIdentity: Extract<ReturnType<typeof resolveSlotGroupIdentity>, { ok: true }> } | { ok: false; message: string } {
  if (!eventConfig) return { ok: false, message: "イベントが見つかりません。" };
  const slotRow = receipt.anchor;
  const userId = guard.authUserId;
  const activeX = guard.activeXId;
  let submittedSlots: SlotSubmissionReceiptRow[];
  if (slotRow.reservation_group_id) {
    if (receipt.group.kind === "overflow") {
      return { ok: false, message: "連続枠の件数が上限を超えています。" };
    }
    const groupRows = sortSlotsChronologically(receipt.group.rows);
    if (groupRows.length > MAX_SLOTS_PER_VIDEO) {
      return { ok: false, message: "連続枠の件数が上限を超えています。" };
    }
    if (!groupRows.some((row) => row.id === slotRow.id)) {
      return {
        ok: false,
        message: "連続枠の予約者情報が不整合です。運営へ連絡してください。",
      };
    }
    const groupSnapshotXId = groupRows[0]?.reserved_x_id_snapshot ?? null;
    if (
      groupRows.some(
        (candidate) => candidate.reserved_x_id_snapshot !== groupSnapshotXId,
      )
    ) {
      return {
        ok: false,
        message: "予約グループのX IDスナップショットが一致しません。",
      };
    }
    const subjectResult = resolveSlotReservationSubject(groupRows);
    if (!subjectResult.ok) {
      return {
        ok: false,
        message: "連続枠の予約者情報が不整合です。運営へ連絡してください。",
      };
    }
    const subject = subjectResult.subject;
    const subjectRelation = resolveSlotSubmissionRelation({
      reservedByUserId: subject.reservedByUserId,
      slotXUserId: subject.xUserId,
      authUserId: userId,
      activeXId: activeX,
    });
    if (!canActAsSlotSubmitter(subjectRelation)) {
      return { ok: false, message: "枠が見つかりません。" };
    }
    if (subject.xUserId) {
      if (!guard.approvedXIds.includes(subject.xUserId)) {
        return { ok: false, message: "承認済みのX IDを選択してください。" };
      }
      if (activeX && subject.xUserId !== activeX) {
        return {
          ok: false,
          message: "投稿主体のX IDは予約時のIDに固定されています。",
        };
      }
    }
    if (groupRows.some((row) => row.status !== "reserved")) {
      return { ok: false, message: "予約中でない枠を含む連続枠は提出できません。" };
    }
    if (!groupRows.every((row) => row.id === slotRow.id || row.video_id === slotRow.video_id)) {
      return { ok: false, message: "連続枠に別の作品が紐づいています。" };
    }
    submittedSlots = groupRows;
  } else {
    submittedSlots = [slotRow];
  }

  if (submittedSlots.length === 0 || submittedSlots.length > MAX_SLOTS_PER_VIDEO) {
    return { ok: false, message: "同時に更新する枠数が上限を超えています。" };
  }
  if (submittedSlots.some((row) => row.status !== "reserved")) {
    return { ok: false, message: "予約中の枠だけ作品を提出できます。" };
  }
  const slotGapSec = (eventConfig.slot_part_gap_minutes ?? 15) * 60;
  const orderedSubmittedSlots = sortSlotsChronologically(submittedSlots);
  for (let index = 1; index < orderedSubmittedSlots.length; index += 1) {
    if (
      !areSlotsInSamePart(
        orderedSubmittedSlots[index - 1],
        orderedSubmittedSlots[index],
        slotGapSec,
      )
    ) {
      return { ok: false, message: "連続していない枠をまとめて提出できません。" };
    }
  }

  const groupIdentity = resolveSlotGroupIdentity({
    reservedByUserIds: submittedSlots.map((row) => row.reserved_by_user_id),
    slotXUserIds: submittedSlots.map((row) => row.x_user_id),
    authUserId: userId,
    activeXId: guard.activeXId,
    allowAuthMismatchWhenXIdMatches: true,
  });
  if (!groupIdentity.ok) {
    if (
      groupIdentity.reason === "mixed_non_null_x" ||
      groupIdentity.reason === "different_active_x"
    ) {
      return { ok: false, message: SLOT_GROUP_REJECT_MESSAGE };
    }
    return { ok: false, message: SLOT_SUBMIT_REJECT_MESSAGE };
  }
  for (const row of submittedSlots) {
    const relation = resolveSlotSubmissionRelation({
      reservedByUserId: row.reserved_by_user_id,
      slotXUserId: row.x_user_id,
      authUserId: userId,
      activeXId: guard.activeXId,
    });
    if (!canActAsSlotSubmitter(relation)) {
      return { ok: false, message: SLOT_SUBMIT_REJECT_MESSAGE };
    }
  }

  return { ok: true, rows: submittedSlots, groupIdentity };
}

/** SA-088 stage/general/required policy validation in CURRENT denial order.
 * The receipt is server-owned and contains all resolved target-event policies;
 * event existence remains the final check.
 */
export function validateSlotSubmissionPolicies(
  receipt: SlotSubmissionVideoEventReceipt,
  formData: FormData,
  values: Omit<RequiredVideoFieldValues, "existing_icon_url">,
  slotPart: string | null,
  existingIconUrl: string | null,
):
  | {
      ok: true;
      stagePermission: string | null;
      customAnswerDrafts: SubmissionCustomAnswerDraft[];
      stageFields: SlotSubmissionStagePermissionField[];
      questionSnapshot: LoadedGeneralCustomQuestion[];
      event: SlotSubmissionEventConfig;
    }
  | { ok: false; message: string } {
  const stageFields = resolveSlotSubmissionStagePermissionFields(
    receipt.targetEventIds,
    receipt.stageQuestions,
  );
  const stage = buildSlotSubmissionStagePermissionSubmission(formData, stageFields);
  if (!stage.ok) return stage;

  const questionSnapshot = decodeSlotSubmissionGeneralQuestions(receipt);
  const custom = validateSubmissionCustomAnswers(formData, questionSnapshot);
  if (!custom.ok) return custom;

  const required = validateSlotSubmissionRequiredFields(
    receipt.events.map((event) => event.required_video_fields_json),
    values,
    formData,
    slotPart,
    existingIconUrl,
  );
  if (!required.ok) return required;

  if (!receipt.event) return { ok: false, message: "イベントが見つかりません。" };
  return {
    ok: true,
    stagePermission: stage.value,
    customAnswerDrafts: custom.drafts,
    stageFields,
    questionSnapshot,
    event: receipt.event,
  };
}
type DbReadPreflightInternalResult =
  | { ok: false; message: string; failureKind: "validation" | "duplicate" | "temporary" }
  | {
      ok: true;
      value: {
        youtubeId: string;
        eventId: string | null;
        requiredFieldsSnapshot: string | null;
        questionPolicyJson?: string;
        eventTitle?: string | null;
      };
    };

async function validateFreeVideoDbReadPreflightInternal(
  db: ServerCoreDb,
  input: Pick<
    Extract<Awaited<ReturnType<typeof readFreeVideoMultipartPreflight>>, { ok: true }>["value"],
    "requestedEventId" | "videoForm"
  >,
  nowSec: number,
  includeQuestionPolicy: boolean,
  includeEventTitle: boolean,
): Promise<DbReadPreflightInternalResult> {
  if (!Number.isSafeInteger(nowSec) || nowSec < 0) {
    return { ok: false, message: BAD_FORM_MESSAGE, failureKind: "validation" };
  }
  const youtubeId = extractYoutubeId(input.videoForm.youtube_url);
  if (!youtubeId) {
    return { ok: false, message: INVALID_YOUTUBE_URL_MESSAGE, failureKind: "validation" };
  }

  let event: Awaited<ReturnType<typeof loadEligibleUnslottedVideoRequiredFields>>;
  try {
    event = await loadEligibleUnslottedVideoRequiredFields(
      db,
      input.requestedEventId,
      nowSec,
      youtubeId,
      includeQuestionPolicy,
      includeEventTitle,
    );
  } catch (error) {
    // Provider exceptions can have throwing prototype/code accessors. Keep
    // typed domain denials, but fail closed if classification itself fails.
    try {
      if (error instanceof UnslottedEventSyncError) {
        const code = error.code;
        if (code === "unslotted_event_selection_invalid") {
          return {
            ok: false,
            message: "枠なし投稿で所属できるイベントは1件までです。",
            failureKind: "validation",
          };
        }
        if (code === "unslotted_event_not_allowed") {
          return {
            ok: false,
            message:
              "選択したイベントは枠なし投稿を受け付けていません。公開状態・終了日時・イベント設定を確認してください。",
            failureKind: "validation",
          };
        }
      }
    } catch {
      // Fall through to the same sanitized temporary failure below.
    }
    return {
      ok: false,
      message: UNEXPECTED_SUBMIT_ERROR_MESSAGE,
      failureKind: "temporary",
    };
  }

  const { eventId, requiredFields } = event;
  try {
    const missing = firstMissingRequiredVideoField(requiredFields, {
      ...input.videoForm,
      existing_icon_url: null,
    });
    if (missing) {
      return {
        ok: false,
        message: missingRequiredVideoFieldMessage(missing),
        failureKind: "validation",
      };
    }

    const duplicate = eventId
      ? event.youtubeDuplicate
      : await checkYoutubeVideoDuplicate(db, youtubeId);
    if (duplicate) {
      return {
        ok: false,
        message: DUPLICATE_YOUTUBE_MESSAGE,
        failureKind: "duplicate",
      };
    }
  } catch {
    return {
      ok: false,
      message: UNEXPECTED_SUBMIT_ERROR_MESSAGE,
      failureKind: "temporary",
    };
  }

  return {
    ok: true,
    value: {
      youtubeId,
      eventId,
      requiredFieldsSnapshot: event.requiredFieldsSnapshot,
      ...(includeQuestionPolicy ? { questionPolicyJson: event.questionPolicyJson } : {}),
      ...(includeEventTitle ? { eventTitle: event.eventTitle ?? null } : {}),
    },
  };
}

/**
 * U02 read-only D1 candidate (kept compatible with existing unit tests).
 */
export async function validateFreeVideoDbReadPreflight(
  db: ServerCoreDb,
  input: Pick<
    Extract<Awaited<ReturnType<typeof readFreeVideoMultipartPreflight>>, { ok: true }>["value"],
    "requestedEventId" | "videoForm"
  >,
  nowSec: number,
  includeQuestionPolicy = false,
): Promise<
  | { ok: false; message: string }
  | {
      ok: true;
      value: {
        youtubeId: string;
        eventId: string | null;
        requiredFieldsSnapshot: string | null;
        questionPolicyJson?: string;
      };
    }
> {
  const result = await validateFreeVideoDbReadPreflightInternal(
    db,
    input,
    nowSec,
    includeQuestionPolicy,
    false,
  );
  if (!result.ok) return { ok: false, message: result.message };
  return { ok: true, value: result.value };
}

/**
 * Complete read-only preflight helper (kept compatible with existing tests).
 */
export async function validateFreeVideoSubmissionReadPreflight(
  db: ServerCoreDb,
  input: Extract<Awaited<ReturnType<typeof readFreeVideoMultipartPreflight>>, { ok: true }>["value"],
  nowSec: number,
): Promise<
  | { ok: false; message: string }
  | {
      ok: true;
      value: {
        youtubeId: string;
        eventId: string | null;
        requiredFieldsSnapshot: string | null;
        customAnswerDrafts: SubmissionCustomAnswerDraft[];
        questionSnapshot: LoadedGeneralCustomQuestion[];
      };
    }
> {
  const result = await validateFreeVideoSubmissionReadInternal(db, input, nowSec, false);
  if (!result.ok) return { ok: false, message: result.message };
  const { eventTitle: _unused, ...rest } = result.value;
  return { ok: true, value: rest };
}

async function validateFreeVideoSubmissionReadInternal(
  db: ServerCoreDb,
  input: Extract<Awaited<ReturnType<typeof readFreeVideoMultipartPreflight>>, { ok: true }>["value"],
  nowSec: number,
  includeEventTitle: boolean,
): Promise<
  | { ok: false; message: string; failureKind: "validation" | "duplicate" | "temporary" }
  | {
      ok: true;
      value: {
        youtubeId: string;
        eventId: string | null;
        requiredFieldsSnapshot: string | null;
        customAnswerDrafts: SubmissionCustomAnswerDraft[];
        questionSnapshot: LoadedGeneralCustomQuestion[];
        eventTitle: string | null;
      };
    }
> {
  const base = await validateFreeVideoDbReadPreflightInternal(
    db,
    input,
    nowSec,
    true,
    includeEventTitle,
  );
  if (!base.ok) return base;
  try {
    const { questionPolicyJson, eventTitle = null, ...validated } = base.value;
    if (typeof questionPolicyJson !== "string") {
      throw new Error("video_custom_question_projection_missing");
    }
    const questions = validated.eventId
      ? decodeGeneralCustomQuestionPolicyProjection(questionPolicyJson, validated.eventId)
      : [];
    const custom = validateSubmissionCustomAnswers(input.formData, questions);
    if (!custom.ok) {
      return { ok: false, message: custom.message, failureKind: "validation" };
    }
    return {
      ok: true,
      value: {
        ...validated,
        customAnswerDrafts: custom.drafts,
        questionSnapshot: questions,
        eventTitle,
      },
    };
  } catch {
    return {
      ok: false,
      message: UNEXPECTED_SUBMIT_ERROR_MESSAGE,
      failureKind: "temporary",
    };
  }
}

async function loadAllowedXMediaIcons(
  rawD1: D1Database,
  activeXId: string,
): Promise<{ candidates: string[]; queryCount: number }> {
  const row = await rawD1
    .prepare(
      `SELECT
         (SELECT icon_url FROM x_users WHERE id = ? LIMIT 1) AS x_icon,
         (SELECT json_group_array(q.icon_url) FROM (
           SELECT creator_icon_url AS icon_url FROM videos
           WHERE creator_x_user_id = ? AND creator_icon_url IS NOT NULL AND visibility_status = 'public'
           ORDER BY created_at DESC
           LIMIT ${MAX_ICON_CANDIDATES * 2}
         ) q) AS video_icons_json`,
    )
    .bind(activeXId, activeXId)
    .first<{ x_icon: string | null; video_icons_json: string | null }>();

  const candidates: string[] = [];
  const seen = new Set<string>();
  const push = (url: unknown) => {
    if (typeof url !== "string" || !url || seen.has(url) || candidates.length >= MAX_ICON_CANDIDATES) return;
    seen.add(url);
    candidates.push(url);
  };
  push(row?.x_icon);
  if (row?.video_icons_json) {
    const parsed: unknown = JSON.parse(row.video_icons_json);
    if (Array.isArray(parsed)) {
      for (const item of parsed) push(item);
    }
  }
  return { candidates, queryCount: 1 };
}

async function resolveHonoVideoCreatorIcon(args: {
  c: Context<AppEnv>;
  formData: FormData;
  parsed: Pick<VideoFormData, "icon_mode" | "icon_url">;
  activeXId: string;
  videoId: string;
}): Promise<
  | {
      ok: true;
      iconUrl: string | null;
      uploadedKey: string | null;
      bucket: R2Bucket | null;
      queryCount: number;
    }
  | { ok: false; status: 400 | 503; message: string }
> {
  const mode = args.parsed.icon_mode ?? "existing";
  if (mode === "keep" || mode === "none") {
    return { ok: true, iconUrl: null, uploadedKey: null, bucket: null, queryCount: 0 };
  }

  if (mode === "existing") {
    const iconUrl = normalizeIconUrl(args.parsed.icon_url);
    if (!iconUrl) {
      return { ok: false, status: 400, message: "アイコン URL が不正です。" };
    }
    if (iconUrl.startsWith("/api/media/")) {
      let rawD1: D1Database | undefined;
      try {
        rawD1 = args.c.env?.DB;
      } catch {
        return { ok: false, status: 503, message: UNEXPECTED_SUBMIT_ERROR_MESSAGE };
      }
      if (!rawD1) {
        return { ok: false, status: 503, message: UNEXPECTED_SUBMIT_ERROR_MESSAGE };
      }
      let allowed: { candidates: string[]; queryCount: number };
      try {
        allowed = await loadAllowedXMediaIcons(rawD1, args.activeXId);
      } catch {
        return { ok: false, status: 503, message: UNEXPECTED_SUBMIT_ERROR_MESSAGE };
      }
      if (!allowed.candidates.includes(iconUrl)) {
        return { ok: false, status: 400, message: "選択できないアイコンです。" };
      }
      return {
        ok: true,
        iconUrl,
        uploadedKey: null,
        bucket: null,
        queryCount: allowed.queryCount,
      };
    }
    return { ok: true, iconUrl, uploadedKey: null, bucket: null, queryCount: 0 };
  }

  const file = args.formData.get("icon_file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, status: 400, message: "画像ファイルが必要です。" };
  }
  if (file.size > MAX_VIDEO_ICON_BYTES) {
    return { ok: false, status: 400, message: "変換後の画像サイズが2MBを超えています。" };
  }

  let bucket: R2Bucket | undefined;
  try {
    bucket = args.c.env?.BUCKET;
  } catch {
    return { ok: false, status: 503, message: "ストレージが利用できません。" };
  }
  if (!bucket) {
    return { ok: false, status: 503, message: "ストレージが利用できません。" };
  }

  let buffer: ArrayBuffer;
  try {
    buffer = await file.arrayBuffer();
  } catch {
    return { ok: false, status: 400, message: "画像の読み込みに失敗しました。再度お試しください。" };
  }
  const validated = validateIconImageUpload({
    buffer,
    declaredType: file.type,
    maxBytes: MAX_VIDEO_ICON_BYTES,
  });
  if (!validated.ok) {
    return { ok: false, status: 400, message: validated.message };
  }

  const key = `video-icons/${args.activeXId}/${args.videoId}/${crypto.randomUUID()}.${validated.image.ext}`;
  try {
    await bucket.put(key, buffer, {
      httpMetadata: { contentType: validated.image.contentType },
    });
  } catch {
    return { ok: false, status: 503, message: "ストレージが利用できません。" };
  }
  return {
    ok: true,
    iconUrl: `/api/media/${key}`,
    uploadedKey: key,
    bucket,
    queryCount: 0,
  };
}

async function rollbackUploadedVideoIcon(
  bucket: R2Bucket | null,
  uploadedKey: string | null | undefined,
): Promise<void> {
  if (!bucket || !uploadedKey) return;
  try {
    await bucket.delete(uploadedKey);
  } catch {
    // Fixed-code diagnostic only; never leak storage internals or input data.
    try {
      console.error("video_icon_orphan_cleanup_failed");
    } catch {
      // A failed diagnostic sink must not replace the original mutation error.
      // The failed deletion still leaves an orphan for storage remediation.
    }
  }
}

function buildNotificationBlocks(blocks: DiscordBlock[]): string {
  const sections: string[] = [];
  for (const block of blocks) {
    const lines = block.lines.filter(
      (line): line is string => typeof line === "string" && line.trim().length > 0,
    );
    if (block.heading) sections.push(block.heading);
    if (lines.length > 0) sections.push(lines.join("\n"));
  }
  return sections.join("\n\n");
}

function notificationActorFromContext(
  c: Context<AppEnv>,
  userId: string,
  activeXId: string,
): NotificationActor {
  const raw = c.get("actorSnapshotJsonById")?.[userId];
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw) as {
        discord_id?: string | null;
        discord_name?: string | null;
        x_name?: string | null;
      };
      return {
        userId,
        discordId: parsed.discord_id ?? null,
        discordName: parsed.discord_name ?? null,
        activeXId,
        activeXName: parsed.x_name ?? null,
      };
    } catch {
      // Fall back to guard session identity if snapshot JSON is absent in unit mocks.
    }
  }
  const sessionUser = c.get("user");
  return {
    userId,
    discordId: null,
    discordName: sessionUser?.name ?? null,
    activeXId,
    activeXName: null,
  };
}

function buildFreeVideoNotifications(args: {
  siteOrigin: string;
  actor: NotificationActor;
  videoId: string;
  videoTitle: string;
  youtubeVideoId: string;
  eventId: string | null;
  eventTitle: string | null;
  creatorDisplayName: string;
}) {
  const videoPath = `/${args.youtubeVideoId.trim() || args.videoId}`;
  const videoUrl = new URL(videoPath, `${args.siteOrigin}/`).href;
  const editUrl = new URL(`/dashboard/edit/${args.videoId}`, `${args.siteOrigin}/`).href;
  const adminUrl = new URL(
    `/admin/videos?q=${encodeURIComponent(args.videoId)}`,
    `${args.siteOrigin}/`,
  ).href;

  const dmEscapedTitle = escapeDiscordMention(args.videoTitle);
  const dmContent = buildNotificationBlocks([
    {
      heading: "【FlameNode】作品を受け付けました",
      lines: [
        `作品「${dmEscapedTitle}」の登録が完了しました。`,
        "作品ページから内容を確認できます。",
      ],
    },
    {
      heading: "■ 状況",
      lines: [
        "登録種別: 自由投稿",
        args.eventId
          ? "イベントへの紐付けあり（反映まで時間がかかる場合があります）"
          : "イベント未紐付け",
      ],
    },
    {
      heading: "■ 次に行うこと",
      lines: [
        "作品ページで表示を確認し、必要なら編集画面から内容を修正してください。",
        `作品ページを開く\n${videoUrl}`,
        `編集画面を開く\n${editUrl}`,
      ],
    },
  ]);

  const channelTitle = escapeDiscordMention(args.videoTitle.trim() || "（タイトル未設定）");
  const kindLabel = args.eventId ? "自由投稿" : "未所属";
  const creatorName = args.creatorDisplayName.trim();
  const eventLines = args.eventId
    ? [`イベントを見る\n${new URL(`/event/${args.eventId}`, `${args.siteOrigin}/`).href}`]
    : [];
  const channelContent = buildNotificationBlocks([
    {
      heading: "【運営通知】作品が新規登録されました",
      lines: [
        `作品名: ${channelTitle}`,
        `登録種別: ${kindLabel}`,
        args.eventTitle ? `イベント: ${escapeDiscordMention(args.eventTitle)}` : null,
      ],
    },
    formatOpsActorSection(args.actor),
    ...(creatorName
      ? [{ heading: "■ 作品の表示名", lines: [escapeDiscordMention(creatorName)] }]
      : []),
    {
      heading: "■ 確認",
      lines: [
        `作品ページを見る\n${videoUrl}`,
        `管理画面で作品を見る\n${adminUrl}`,
        ...eventLines,
      ],
    },
  ]);

  const actorLabel = args.actor.activeXId?.trim()
    ? `@${args.actor.activeXId.trim()}`
    : args.actor.discordName?.trim() || args.actor.userId;

  return {
    submittedNotificationPayload: {
      content: dmContent,
      video_id: args.videoId,
      url: videoUrl,
    },
    registeredChannelNotification: {
      threadName: `[作品登録] ${args.videoTitle.trim() || "作品"} / ${actorLabel}`,
      payload: {
        content: channelContent,
        video_id: args.videoId,
        ...(args.eventId ? { event_id: args.eventId } : {}),
        url: videoUrl,
      },
    },
  };
}

function isMemberValidationError(error: unknown): boolean {
  // Provider errors are untrusted. A throwing prototype/message accessor or
  // malformed message must not mask the original failed mutation response.
  try {
    if (!(error instanceof Error)) return false;
    const message = error.message;
    return typeof message === "string" && message.startsWith("free_video_new_member_");
  } catch {
    return false;
  }
}

/**
 * Mounted SA-086 route factory (`POST /api/videos/free`).
 */
export function createFreeVideoSubmitRoutes(
  guard: MiddlewareHandler<AppEnv>,
  options: { nowSec?: () => number } = {},
): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();

  routes.post("/free", guard, limitVideoActionBody("SA-086"), async (c) => {
    c.header("Cache-Control", "private, no-store");
    const sessionUser = c.get("user")!;
    const userId = sessionUser.id;
    const db = c.get("db");
    const activeXState = c.get("activeX");
    const activeX = activeXState?.activeXId ?? null;
    if (!activeX || !activeXState?.approvedXIds.includes(activeX)) {
      return failSubmit(c, 403, "承認済みのX IDを選択してください。");
    }

    const nowSec = options.nowSec ? options.nowSec() : Math.floor(Date.now() / 1000);
    const transport = await readFreeVideoMultipartPreflight(c, { activeXId: activeX, nowSec });
    if (!transport.ok) {
      return failSubmit(
        c,
        transport.failureKind === "snapshot" ? 409 : 400,
        transport.message,
      );
    }

    const { videoForm, memberSubmission, scheduledTime, formData } = transport.value;
    const softwareLabels = normalizeSoftwareLabels(videoForm.used_software);
    if (softwareLabels.length > MAX_ATOMIC_VIDEO_SOFTWARES) {
      return failSubmit(
        c,
        400,
        `使用ソフトウェアは最大${MAX_ATOMIC_VIDEO_SOFTWARES}件までです。`,
      );
    }

    const preflight = await validateFreeVideoSubmissionReadInternal(
      db,
      transport.value,
      nowSec,
      true,
    );
    if (!preflight.ok) {
      const status =
        preflight.failureKind === "duplicate"
          ? 409
          : preflight.failureKind === "temporary"
            ? 503
            : 400;
      return failSubmit(c, status, preflight.message);
    }

    const { youtubeId, eventId, requiredFieldsSnapshot, customAnswerDrafts, questionSnapshot, eventTitle } =
      preflight.value;

    let siteOrigin: string;
    try {
      siteOrigin = new URL((c.env?.NEXT_PUBLIC_SITE_URL ?? "").trim()).origin;
    } catch {
      return failSubmit(c, 503, UNEXPECTED_SUBMIT_ERROR_MESSAGE);
    }

    const videoId = generateId("v");
    const iconResolved = await resolveHonoVideoCreatorIcon({
      c,
      formData,
      parsed: videoForm,
      activeXId: activeX,
      videoId,
    });
    if (!iconResolved.ok) {
      return failSubmit(c, iconResolved.status, iconResolved.message);
    }

    const videoAfter = buildFreeVideoRow({
      videoId,
      eventId,
      activeX,
      userId,
      data: videoForm,
      iconUrl: iconResolved.iconUrl,
      creatorYoutubeChannelUrl: normalizeYoutubeChannelInput(videoForm.youtube_channel_url),
      creatorOtherSocialLinks: videoForm.other_social_links ?? null,
      youtubeId,
      scheduledTime,
      now: nowSec,
    });

    const notifications = buildFreeVideoNotifications({
      siteOrigin,
      actor: notificationActorFromContext(c, userId, activeX),
      videoId,
      videoTitle: videoForm.title,
      youtubeVideoId: youtubeId,
      eventId,
      eventTitle,
      creatorDisplayName: videoForm.display_name,
    });

    const hasCollab = videoAfter.collaboration_type === "collab";
    const hasMemberXIds = hasCollab && memberSubmission.members.some((m) => Boolean(m.x_user_id?.trim()));
    const callerQueryCount =
      2 + // writeGuard (TOS/activeX + CostGuard)
      1 + // combined event/required/duplicate/question or unlinked duplicate read
      iconResolved.queryCount +
      (hasMemberXIds ? 1 : 0) +
      (softwareLabels.length > 0 ? 1 : 0);

    try {
      const plan = await buildFreeVideoSubmissionWithRebuildPlan(db, {
        videoAfter,
        actorUserId: userId,
        trustedActiveXId: activeX,
        eventId,
        requiredFieldsSnapshot,
        now: nowSec,
        questions: questionSnapshot,
        customAnswerDrafts,
        usedSoftware: videoForm.used_software ?? null,
        ...(hasCollab ? { memberSubmission } : {}),
        submittedNotificationPayload: notifications.submittedNotificationPayload,
        registeredChannelNotification: notifications.registeredChannelNotification,
      });

      // D-0603-1: notificationWakeSource and staticRebuildWakeSource omitted (wake=0).
      await mutateWithAudit(db, {
        mutationStatements: plan.statements,
        expectedMutationChanges: plan.expectedChanges,
        audits: plan.audits,
        preloaded: auditPreloaded(c),
        callerQueryCount,
      });
    } catch (error) {
      await rollbackUploadedVideoIcon(iconResolved.bucket, iconResolved.uploadedKey);
      if (isMemberValidationError(error)) {
        return failSubmit(c, 400, "合作メンバーの入力内容を確認してください。");
      }
      if (isYoutubeIdUniqueConstraintError(error)) {
        return failSubmit(c, 409, DUPLICATE_YOUTUBE_MESSAGE);
      }
      return failSubmit(c, 409, CONFLICT_SAVE_ERROR_MESSAGE);
    }

    const response: VideoSubmitResult = {
      ok: true,
      videoId,
      youtubeVideoId: youtubeId,
      ...(eventId ? { eventId } : {}),
      pendingPublicReflection: true,
    };
    return c.json(response, 200);
  });

  return routes;
}
