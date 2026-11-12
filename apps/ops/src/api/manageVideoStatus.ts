/**
 * MIG-0724 U04 provisional client (D-16-1): mirrors CURRENT manage-video.ts FormData
 * keys, but MUST NOT be mounted or enabled before MIG-0603's Hono endpoint and
 * canonical contracts are main-DONE and cross-checked. No automatic write retry.
 */
import type { OpsFetch } from "./read.js";
import type { ReviewAction, ReviewActionResult } from "../components/videoReview/shared.js";

function validMutationResponse(body: unknown): ReviewActionResult | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const data = body as Record<string, unknown>;
  if (typeof data.ok !== "boolean") return null;
  if (data.message != null && typeof data.message !== "string") return null;
  if (data.nextHref != null && typeof data.nextHref !== "string") return null;
  if (data.pendingPublicReflection != null && typeof data.pendingPublicReflection !== "boolean") return null;
  if (data.retryable != null && typeof data.retryable !== "boolean") return null;
  return {
    ok: data.ok,
    ...(typeof data.message === "string" ? { message: data.message } : {}),
    ...(typeof data.nextHref === "string" ? { nextHref: data.nextHref } : {}),
    ...(typeof data.retryable === "boolean" ? { retryable: data.retryable } : {}),
    ...(data.pendingPublicReflection === true ? { pendingPublicReflection: true } : {}),
  };
}
export function createManageVideoStatusActions(fetchFn: OpsFetch, eventId: string): {
  approve: ReviewAction;
  approveAndNext: ReviewAction;
  setStatus: ReviewAction;
} {
  const mutate = async (fd: FormData, mode: "approve" | "approveAndNext" | "status"):
    Promise<ReviewActionResult> => {
    // Never permit an action to write a different event's video.
    const formEvent = String(fd.get("event_id") ?? "");
    const videoId = String(fd.get("video_id") ?? "").trim();
    if (!eventId || formEvent !== eventId || !videoId) {
      return { ok: false, message: "イベントまたは作品の指定が正しくありません。" };
    }
    const status = mode === "status" ? String(fd.get("status") ?? "").trim() : "public";
    if (!["pending", "public", "private"].includes(status)) {
      return { ok: false, message: "変更先ステータスが正しくありません。" };
    }
    const payload = {
      status,
      reason: String(fd.get("reason") ?? "").trim(),
      and_next: mode === "approveAndNext" ? "1" : "0",
    };
    const path = `/api/manage/events/${encodeURIComponent(eventId)}/videos/${encodeURIComponent(videoId)}/status`;
    try {
      const response = await fetchFn(path, {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: { accept: "application/json", "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      // Reject success-looking JSON on failed HTTP responses. Do not automatically retry writes.
      if (response.status === 401) return { ok: false, message: "ログイン状態を再確認してください。", retryable: true };
      if (response.status === 403) return { ok: false, message: "このイベントの作品審査権限がありません。", retryable: true };
      if (response.status === 404 || response.status === 501)
        return { ok: false, message: "作品審査APIを利用できません。" };
      const raw: unknown = await response.json();
      const parsed = validMutationResponse(raw);
      if (!parsed) return { ok: false, message: "作品審査APIの応答が不正です。", retryable: true };
      if (response.status >= 500 || response.status < 200 || response.status >= 300)
        return { ok: false, message: parsed.message ?? "作品状態を再確認してください。", retryable: true };
      return parsed;
    } catch {
      return { ok: false, message: "通信状態を確認し、作品の現在の状態を再取得してください。", retryable: true };
    }
  };
  return {
    approve: fd => mutate(fd, "approve"),
    approveAndNext: fd => mutate(fd, "approveAndNext"),
    setStatus: fd => mutate(fd, "status"),
  };
}
