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
 * via bucket.delete(uploadedKey) if plan preparation or D1 commit fails.
 * Queue wake = 0 (NOOP_WAKE_HOST; DOCUMENTED DIFFERENCE D-0603-1).
 */
import type { VideoSubmitResult } from "@flamenode/contracts";
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
  type SubmissionCustomAnswerDraft,
  type VideoFormData,
} from "@flamenode/domain/video";
import { validateActiveXSnapshot } from "@flamenode/domain/xid";
import { videos, xUsers } from "@flamenode/db/schema";
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
import { and, desc, eq, isNotNull } from "drizzle-orm";
import { buildFreeVideoRow } from "@flamenode/server-core/video/freeVideoRow";
import {
  decodeGeneralCustomQuestionPolicyProjection,
  loadEligibleUnslottedVideoRequiredFields,
  type LoadedGeneralCustomQuestion,
} from "@flamenode/server-core/video/requiredVideoFields";
import { buildFreeVideoSubmissionWithRebuildPlan } from "@flamenode/server-core/video/unslottedEventPlans";
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
    if (error instanceof UnslottedEventSyncError) {
      if (error.code === "unslotted_event_selection_invalid") {
        return {
          ok: false,
          message: "枠なし投稿で所属できるイベントは1件までです。",
          failureKind: "validation",
        };
      }
      if (error.code === "unslotted_event_not_allowed") {
        return {
          ok: false,
          message:
            "選択したイベントは枠なし投稿を受け付けていません。公開状態・終了日時・イベント設定を確認してください。",
          failureKind: "validation",
        };
      }
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
  db: ServerCoreDb,
  activeXId: string,
): Promise<{ candidates: string[]; queryCount: number }> {
  const candidates: string[] = [];
  const seen = new Set<string>();
  const xRow = (
    await db
      .select({ icon_url: xUsers.icon_url })
      .from(xUsers)
      .where(eq(xUsers.id, activeXId))
      .limit(1)
  )[0];
  if (xRow?.icon_url) {
    candidates.push(xRow.icon_url);
    seen.add(xRow.icon_url);
  }
  if (candidates.length >= MAX_ICON_CANDIDATES) {
    return { candidates, queryCount: 1 };
  }
  const videoRows = await db
    .select({ icon_url: videos.creator_icon_url })
    .from(videos)
    .where(
      and(
        eq(videos.creator_x_user_id, activeXId),
        isNotNull(videos.creator_icon_url),
        eq(videos.visibility_status, "public"),
      )!,
    )
    .orderBy(desc(videos.created_at))
    .limit(MAX_ICON_CANDIDATES * 2);
  for (const row of videoRows) {
    if (row.icon_url && !seen.has(row.icon_url)) {
      candidates.push(row.icon_url);
      seen.add(row.icon_url);
      if (candidates.length >= MAX_ICON_CANDIDATES) break;
    }
  }
  return { candidates, queryCount: 2 };
}

async function resolveHonoVideoCreatorIcon(args: {
  c: Context<AppEnv>;
  db: ServerCoreDb;
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
      let allowed: { candidates: string[]; queryCount: number };
      try {
        allowed = await loadAllowedXMediaIcons(args.db, args.activeXId);
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
    console.error("video_icon_orphan_cleanup_failed");
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
  return error instanceof Error && error.message.startsWith("free_video_new_member_");
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
      db,
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
