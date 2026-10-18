/**
 * Video visibility decisions shared by the admin (SA-001..003) and manage
 * (SA-040..042) status actions. D1 writes, the R2 fence manifest,
 * notifications and the static-rebuild queue stay in the adapters.
 */

export const SAME_VIDEO_STATUS_MESSAGE = "すでに同じ状態へ更新されています。";

export function monotonicVideoUpdatedAt(
  videoUpdatedAt: number,
  nowSec = Math.floor(Date.now() / 1000),
): number {
  return Math.max(nowSec, videoUpdatedAt + 1);
}

export function mergeVideoRebuildEventIds(
  primaryEventId: string | null | undefined,
  linkedEventIds: readonly string[],
): string[] {
  return Array.from(
    new Set(
      [primaryEventId, ...linkedEventIds].filter((id): id is string => Boolean(id)),
    ),
  );
}

export type VideoPublicEligibilityResult =
  | { ok: true }
  | { ok: false; code: string; message: string };

/**
 * Public visibility only requires the normal video fields validated by the
 * action/schema.  A YouTube-backed work may intentionally have no YouTube ID:
 * its title, creator, event, and other video information can still be shown
 * on the public detail page while the player remains unavailable.
 *
 * Keep this server-side entry point so all visibility mutations share the same
 * future eligibility hook.  Do not reintroduce a YouTube-ID requirement here.
 */
export function validateVideoPublicEligibility(
  _video: {
    source_type: string | null | undefined;
    youtube_video_id: string | null | undefined;
  },
  _nextStatus: string,
): VideoPublicEligibilityResult {
  return { ok: true };
}

type InputCheck = { ok: true } | { ok: false; message: string };

/** Statuses an admin may set (SA-001..003). */
export const ADMIN_VIDEO_STATUSES: ReadonlySet<string> = new Set([
  "pending",
  "public",
  "private",
  "voided",
]);

export function validateAdminVideoStatusInput(input: {
  videoId: string;
  status: string;
  reason: string;
}): InputCheck {
  if (!input.videoId || input.videoId.length > 128) {
    return { ok: false, message: "video_idが不正です。" };
  }
  if (!ADMIN_VIDEO_STATUSES.has(input.status)) {
    return { ok: false, message: "不正なステータスです。" };
  }
  if (input.status === "voided" && !input.reason) {
    return { ok: false, message: "voidedへの変更には理由が必要です。" };
  }
  return { ok: true };
}

/** イベント運営者が通常操作で変更できる公開状態。内部状態は管理者側に集約する。 */
export const MANAGE_VIDEO_STATUSES: ReadonlySet<string> = new Set([
  "pending",
  "public",
  "private",
]);

export function validateManageVideoStatusInput(input: {
  eventId: string;
  videoId: string;
  status: string;
}): InputCheck {
  if (!input.eventId || !input.videoId) {
    return { ok: false, message: "event_id と video_id が必要です。" };
  }
  if (!MANAGE_VIDEO_STATUSES.has(input.status)) {
    return { ok: false, message: "このステータスへは変更できません。" };
  }
  return { ok: true };
}

export type VideoVisibilityFence = {
  /** public → non-public blocks at once; non-public → public waits for release. */
  state: "blocked" | "release_pending";
  depublicizedFromPublic: boolean;
};

/**
 * The fence a status change needs, or null when it does not cross the public
 * boundary (including no change at all).
 */
export function planVideoVisibilityFence(
  previousStatus: string,
  nextStatus: string,
): VideoVisibilityFence | null {
  const wasPublic = previousStatus === "public";
  const isPublic = nextStatus === "public";
  if (wasPublic && !isPublic) {
    return { state: "blocked", depublicizedFromPublic: true };
  }
  if (!wasPublic && isPublic) {
    return { state: "release_pending", depublicizedFromPublic: false };
  }
  return null;
}
