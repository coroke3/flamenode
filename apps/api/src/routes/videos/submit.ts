/**
 * MIG-0651 SA-086: UNMOUNTED HTTP input transport candidate.
 *
 * This is NOT an authenticated or persistence-ready video submission route.
 * Caller MUST run: origin -> session -> writeGuard(CostGuard + approved Active X)
 * -> limitVideoActionBody("SA-086") before calling this helper with
 * { activeXId, nowSec } from trusted server state. This helper does the
 * canonical video schema parse itself, then derives isCollab from that schema.
 *
 * It performs no DB reads, R2 uploads, Queue work, mutations or post-commit
 * wake. Do not mount a POST route until all S3 parity/CPU and Lead gates pass.
 */
import {
  parseVideoForm,
  validateSubmissionCustomAnswers,
  type SubmissionCustomAnswerDraft,
  extractYoutubeId,
  firstMissingRequiredVideoField,
  missingRequiredVideoFieldMessage,
  UnslottedEventSyncError,
  validateUniqueUnslottedVideoScalarFields,
  validateFreeVideoMultipartPreflight,
  type VideoFormData,
  type FreeVideoPreflightContext,
} from "@flamenode/domain/video";
import type { Context } from "hono";
import type { AppEnv } from "../../env.ts";
import type { ServerCoreDb } from "@flamenode/server-core/db";
import { loadEligibleUnslottedVideoRequiredFields } from "@flamenode/server-core/video/requiredVideoFields";
import { checkYoutubeVideoDuplicate } from "@flamenode/server-core/video/youtubeDuplicate";
import { loadGeneralCustomQuestionsForFreeVideo, type LoadedGeneralCustomQuestion } from "@flamenode/server-core/video/requiredVideoFields";

const BAD_FORM_MESSAGE = "投稿フォームの入力が不正です。";

/** Parse exactly the multipart/urlencoded form transport, without first/last
 * key collapsing. FormData is fed to the shared duplicate-keys and identity
 * checks; malformed encoding/file boundaries fail closed before a write plan.
 * Bytes are bounded by the caller's limitVideoActionBody middleware.
 */
export async function readFreeVideoMultipartPreflight(
  c: Context<AppEnv>,
  trustedContext: Pick<FreeVideoPreflightContext, "activeXId" | "nowSec">,
): Promise<
  | { ok: false; message: string }
  | { ok: true; value: {
      requestedEventId: string | null;
      memberSubmission: Extract<ReturnType<typeof validateFreeVideoMultipartPreflight>, { ok: true }>["value"]["memberSubmission"];
      scheduledTime: number;
      videoForm: VideoFormData;
      formData: FormData;
    } }
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
  // Do not collapse FormData into an object until repeated scalar fields and
  // pathological entry counts have been rejected. CURRENT and target then
  // share exactly the same canonical Zod form schema.
  const unique = validateUniqueUnslottedVideoScalarFields(formData);
  if (!unique.ok) return unique;

  const parsed = parseVideoForm(Object.fromEntries(formData));
  if (!parsed.ok) return parsed;

  // Only the canonical validated schema may determine is_collab. The active X
  // ID and trusted nowSec are from the authenticated server-side guard.
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


/**
 * U02 read-only D1 candidate, called only after the authenticated transport
 * preflight. It follows CURRENT's YouTube -> event eligibility -> required
 * fields -> duplicate order and uses the same shared predicates/loaders.
 *
 * The caller must still validate custom answers, recheck event eligibility
 * inside its atomic D1 batch, persist member/derived rows, strict audit and
 * queue plans, and apply icon rollback/post-commit behavior. This helper must
 * never be treated as write authorization or mounted as an HTTP route alone.
 */
export async function validateFreeVideoDbReadPreflight(
  db: ServerCoreDb,
  input: Pick<
    Extract<Awaited<ReturnType<typeof readFreeVideoMultipartPreflight>>, { ok: true }>["value"],
    "requestedEventId" | "videoForm"
  >,
  nowSec: number,
): Promise<
  | { ok: false; message: string }
  | { ok: true; value: { youtubeId: string; eventId: string | null } }
> {
  if (!Number.isSafeInteger(nowSec) || nowSec < 0) {
    return { ok: false, message: BAD_FORM_MESSAGE };
  }
  const youtubeId = extractYoutubeId(input.videoForm.youtube_url);
  if (!youtubeId) {
    return { ok: false, message: "YouTube URLを解析できません。" };
  }

  let event: Awaited<ReturnType<typeof loadEligibleUnslottedVideoRequiredFields>>;
  try {
    event = await loadEligibleUnslottedVideoRequiredFields(db, input.requestedEventId, nowSec);
  } catch (error) {
    if (error instanceof UnslottedEventSyncError) {
      if (error.code === "unslotted_event_selection_invalid") {
        return { ok: false, message: "枠なし投稿で所属できるイベントは1件までです。" };
      }
      if (error.code === "unslotted_event_not_allowed") {
        return {
          ok: false,
          message: "選択したイベントは枠なし投稿を受け付けていません。公開状態・終了日時・イベント設定を確認してください。",
        };
      }
    }
    // A failed D1 read is NOT proof that a chosen event is ineligible.
    // Keep it fail-closed, but preserve the temporary-error classification.
    return {
      ok: false,
      message: "投稿処理中に一時的なエラーが発生しました。入力内容を確認して、もう一度お試しください。",
    };
  }

  const { eventId, requiredFields } = event;
  try {
    const missing = firstMissingRequiredVideoField(requiredFields, {
      ...input.videoForm,
      existing_icon_url: null,
    });
    if (missing) {
      return { ok: false, message: missingRequiredVideoFieldMessage(missing) };
    }

    if (await checkYoutubeVideoDuplicate(db, youtubeId)) {
      return { ok: false, message: "このYouTube動画は既に登録されています。" };
    }
  } catch {
    // Do not expose D1 internals at an eventual HTTP boundary; no writes made.
    return {
      ok: false,
      message: "投稿処理中に一時的なエラーが発生しました。入力内容を確認して、もう一度お試しください。",
    };
  }
  return { ok: true, value: { youtubeId, eventId } };
}


/**
 * Complete read-only candidate for SA-086. Composes the existing transport,
 * event, required-field and duplicate checks with CURRENT-compatible general
 * custom-question/answer validation. No HTTP route is mounted and a positive
 * result does NOT grant write authorization; atomic revalidation is still
 * mandatory before any D1 insert or icon upload.
 */
export async function validateFreeVideoSubmissionReadPreflight(
  db: ServerCoreDb,
  input: Extract<Awaited<ReturnType<typeof readFreeVideoMultipartPreflight>>, { ok: true }>["value"],
  nowSec: number,
): Promise<
  | { ok: false; message: string }
  | { ok: true; value: {
      youtubeId: string;
      eventId: string | null;
      customAnswerDrafts: SubmissionCustomAnswerDraft[];
      questionSnapshot: LoadedGeneralCustomQuestion[];
    } }
> {
  const base = await validateFreeVideoDbReadPreflight(db, input, nowSec);
  if (!base.ok) return base;
  try {
    const questions = await loadGeneralCustomQuestionsForFreeVideo(db, base.value.eventId);
    const custom = validateSubmissionCustomAnswers(input.formData, questions);
    if (!custom.ok) return custom;
    return { ok: true, value: { ...base.value, customAnswerDrafts: custom.drafts, questionSnapshot: questions } };
  } catch {
    // A read-limit/schema/D1 failure must stop submission before any writes.
    return {
      ok: false,
      message: "投稿処理中に一時的なエラーが発生しました。入力内容を確認して、もう一度お試しください。",
    };
  }
}
