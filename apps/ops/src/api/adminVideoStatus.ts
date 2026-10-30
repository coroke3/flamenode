// D-16-1 provisional: replace with @flamenode/contracts at merge
/**
 * MIG-0729 U02: CURRENT SA-001..003/043 FormData -> staged Hono JSON.
 * API MIG-0603 is not yet on main. This adapter must remain UNMOUNTED until
 * canonical response schemas, admin authorization and post-commit effects pass.
 */
import type { OpsFetch } from "./read.js";

export interface AdminVideoMutationResult {
  ok: boolean;
  message?: string;
  nextHref?: string;
  pendingPublicReflection?: boolean;
  retryable?: boolean;
}
export type AdminVideoMutation = (data: FormData) => Promise<AdminVideoMutationResult>;
const ALLOWED_STATUSES = new Set(["pending", "public", "private", "voided"]);
const ALLOWED_CASE_TYPES = new Set(["rights", "duplicate", "void", "x_reapply", "operator"]);
const ALLOWED_CASE_VIDEO_STATUSES = new Set(["", "pending", "voided"]);

function resultFromResponse(data: unknown): AdminVideoMutationResult | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const x = data as Record<string, unknown>;
  if (typeof x.ok !== "boolean" ||
      (x.message !== undefined && typeof x.message !== "string") ||
      (x.nextHref !== undefined && typeof x.nextHref !== "string") ||
      (x.retryable !== undefined && typeof x.retryable !== "boolean") ||
      (x.pendingPublicReflection !== undefined && typeof x.pendingPublicReflection !== "boolean")) {
    return null;
  }
  const nextHref = typeof x.nextHref === "string" && safeAdminNextHref(x.nextHref)
    ? x.nextHref : undefined;
  return {
    ok: x.ok,
    ...(typeof x.message === "string" ? { message: x.message } : {}),
    ...(nextHref ? { nextHref } : {}),
    ...(x.pendingPublicReflection === true ? { pendingPublicReflection: true } : {}),
    ...(x.retryable === true ? { retryable: true } : {}),
  };
}
export function safeAdminNextHref(url: string): boolean {
  if (!url.startsWith("/admin/videos/") || /[\\\x00-\x1f]/.test(url)) return false;
  try {
    const parsed = new URL(url, "https://flamenode.invalid");
    return parsed.origin === "https://flamenode.invalid" &&
      /^\/admin\/videos\/[^/]+$/.test(parsed.pathname);
  } catch { return false; }
}
async function post(
  fetchFn: OpsFetch, url: string, body: Record<string, string>,
): Promise<AdminVideoMutationResult> {
  try {
    const res = await fetchFn(url, {
      method: "POST", credentials: "same-origin", cache: "no-store",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.status === 401) return { ok: false, message: "ログイン状態を再確認してください。", retryable: true };
    if (res.status === 403) return { ok: false, message: "管理者権限がありません。", retryable: true };
    if (res.status === 404 || res.status === 501)
      return { ok: false, message: "管理者APIを利用できません。" };
    const parsed = resultFromResponse(await res.json());
    if (!parsed) return { ok: false, message: "管理者APIの応答が不正です。", retryable: true };
    if (res.status >= 500 || res.status < 200 || res.status >= 300)
      return { ok: false, message: parsed.message ?? "作品状態を再取得してください。", retryable: true };
    return parsed;
  } catch {
    // No automatic replay after an uncertain write: the mutation may already be committed.
    return { ok: false, message: "通信状態を確認し、作品の現在の状態を再取得してください。", retryable: true };
  }
}
const value = (fd: FormData, name: string) => String(fd.get(name) ?? "").trim();

export function createAdminVideoStatusActions(fetchFn: OpsFetch): {
  approve: AdminVideoMutation;
  approveAndNext: AdminVideoMutation;
  setStatus: AdminVideoMutation;
} {
  async function mutate(fd: FormData, mode: "approve" | "approveAndNext" | "status"): Promise<AdminVideoMutationResult> {
    const videoId = value(fd, "video_id");
    const status = mode === "status" ? value(fd, "status") : "public";
    if (!videoId || videoId.length > 256 || !ALLOWED_STATUSES.has(status))
      return { ok: false, message: "作品または公開状態が正しくありません。" };
    const reason = value(fd, "reason");
    const caseId = value(fd, "case_id");
    const reviewEventId = value(fd, "review_event_id");
    if (reason.length > 500 || (reviewEventId && reviewEventId.length > 128))
      return { ok: false, message: "入力文字数が上限を超えています。" };
    const payload: Record<string, string> = { status, reason };
    if (caseId) payload.case_id = caseId;
    if (reviewEventId) payload.review_event_id = reviewEventId;
    if (mode === "approveAndNext") payload.and_next = "1";
    if (status === "voided") payload.void_reason_category = value(fd, "void_reason_category") || "operator_decision";
    return post(fetchFn, `/api/admin/videos/${encodeURIComponent(videoId)}/status`, payload);
  }
  return {
    approve: fd => mutate(fd, "approve"),
    approveAndNext: fd => mutate(fd, "approveAndNext"),
    setStatus: fd => mutate(fd, "status"),
  };
}

export function createModerationCaseAction(fetchFn: OpsFetch): AdminVideoMutation {
  return async (fd: FormData) => {
    const videoId = value(fd, "video_id");
    const caseType = value(fd, "case_type");
    if (!videoId || videoId.length > 256 || !ALLOWED_CASE_TYPES.has(caseType))
      return { ok: false, message: "作品またはケース種別が正しくありません。" };
    if (value(fd, "public_reason").length > 1000 ||
        value(fd, "private_note").length > 2000 ||
        value(fd, "related_x_user_id").length > 40 ||
        !ALLOWED_CASE_VIDEO_STATUSES.has(value(fd, "video_status")))
      return { ok: false, message: "入力が不正です。" };
    const body: Record<string, string> = { case_type: caseType };
    for (const field of ["public_reason", "private_note", "due_at", "related_x_user_id", "video_status"]) {
      body[field] = value(fd, field);
    }
    // Pathless SA-043 retains its authoritative video_id body key.
    body.video_id = videoId;
    return post(fetchFn, "/api/admin/moderation/cases", body);
  };
}
