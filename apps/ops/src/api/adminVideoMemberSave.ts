// MIG-0730 U02g: UNWIRED SA-085 JSON client candidate, matched to
// MIG-0650's D-16-1 path-authoritative FormData bridge.
// Never mount until Hono admin authorization/CAS/audit/queue parity is reviewed.
import { MAX_VIDEO_MEMBERS } from "@flamenode/domain/video/atomicLimits";
import type { OpsFetch } from "./read.js";
import { tryAcquireAdminVideoWrite } from "./adminVideoWriteLatch.js";

export type AdminVideoMemberSaveResult = {
  ok: boolean;
  message?: string;
  pendingPublicReflection?: boolean;
};

const INVALID = "参加者設定の入力を確認してください。";
const TOO_LARGE = "参加者データが移行先の暫定256KiB制限を超えています。現行の管理画面で保存してください。";
const UNVERIFIED = "保存結果を確認できませんでした。最新状態を再取得してください。";
// SA-085 shares the same in-tab video lock with SA-084 collaborator writes.
// The Hono route still requires independent server CAS/audit/Queue.
const BUSY = "この作品の参加者保存は処理中です。完了後に最新状態を確認してください。";
// Match MIG-0650's unmounted SA-085 adminMembersBody.ts interim JSON limit.
// This is NOT a validated maximum for every legal CURRENT member payload;
// re-evaluate with that server policy before enabling the route.
const MAX_SA085_JSON_BODY_BYTES = 256 * 1024;

type ValidatedBody =
  | { kind: "ok"; encodedId: string; body: string }
  | { kind: "invalid" }
  | { kind: "too_large" };

function validatedBody(videoId: string, formData: FormData): ValidatedBody {
  if (typeof videoId !== "string" || !videoId || videoId.length > 64 ||
      videoId.trim() !== videoId || videoId === "." || videoId === ".." ||
      /[\/\\\x00-\x1f]/.test(videoId) ||
      !formData || typeof formData.getAll !== "function" ||
      typeof formData.forEach !== "function") return { kind: "invalid" };
  let encodedId: string;
  try { encodedId = encodeURIComponent(videoId); }
  catch { return { kind: "invalid" }; }

  // Preserve CURRENT hidden false + checked true FormData ordering, but the
  // HTTP body may contain only members_json and is_collab (never video_id).
  const ids = formData.getAll("video_id");
  const checkbox = formData.getAll("is_collab");
  const members = formData.getAll("members_json");
  // Reject unknown source keys even though the JSON transport below only
  // serializes allowlisted fields. Direct callers must not silently accept
  // forged privilege/legacy inputs bypassing the Preview's UI boundary.
  let unexpectedField = false;
  formData.forEach((_, key) => {
    if (key !== "video_id" && key !== "is_collab" && key !== "members_json") {
      unexpectedField = true;
    }
  });
  if (unexpectedField) return { kind: "invalid" };
  // Unlike the general-purpose CURRENT/Hono parser, this adapter only accepts
  // FormData produced by our exact Ops form (hidden "false", optional checked
  // "true"). Any altered order, duplicate, or alternate flag fails before PUT.
  const validCheckbox =
    checkbox.length === 1 && checkbox[0] === "false" ||
    checkbox.length === 2 && checkbox[0] === "false" && checkbox[1] === "true";
  if (ids.length !== 1 || ids[0] !== videoId || !validCheckbox ||
      members.length !== 1 || typeof members[0] !== "string") return { kind: "invalid" };

  const memberJson = members[0];
  // UTF-8 JSON transport cannot be smaller than this UTF-16 code-unit count.
  // Reject oversized input before parsing a potentially expensive nested array.
  if (memberJson.length > MAX_SA085_JSON_BODY_BYTES) return { kind: "too_large" };
  try {
    const parsed: unknown = JSON.parse(memberJson);
    if (!Array.isArray(parsed) || parsed.length > MAX_VIDEO_MEMBERS ||
        // A collaboration-OFF submission must not carry stale member rows.
        // The Ops form serializes a literal [] when the checkbox is off.
        (checkbox.length === 1 && parsed.length !== 0) ||
        parsed.some(item => !item || typeof item !== "object" || Array.isArray(item) ||
          // Editing privilege is never part of a public-membership PUT.
          // It belongs solely to the separate collaborator permission API.
          "can_edit" in item ||
          ("is_public_member" in item && item.is_public_member !== 1))) {
      return { kind: "invalid" };
    }
  } catch { return { kind: "invalid" }; }

  // Account for JSON escapes, the envelope and multi-byte UTF-8 on the exact
  // wire payload. A short UTF-16 member string can still exceed the HTTP limit.
  const body = JSON.stringify({
    is_collab: checkbox as string[],
    members_json: memberJson,
  });
  if (new TextEncoder().encode(body).byteLength > MAX_SA085_JSON_BODY_BYTES) {
    return { kind: "too_large" };
  }
  return { kind: "ok", encodedId, body };
}

/**
 * Standalone candidate only: no imports from a mounted route or editor.
 * A failed/missing reply could follow a committed D1 batch. Never auto-retry.
 */
export async function saveAdminVideoMembers(
  videoId: string,
  formData: FormData,
  fetchFn: OpsFetch = (path, init) => fetch(path, init),
): Promise<AdminVideoMemberSaveResult> {
  // An injected/legacy FormData getter or iterator may throw before HTTP.
  // Treat it as invalid input, not a rejected save Promise or a write receipt.
  let parsed: ValidatedBody;
  try {
    parsed = validatedBody(videoId, formData);
  } catch {
    return { ok: false, message: INVALID };
  }
  if (parsed.kind === "invalid") return { ok: false, message: INVALID };
  if (parsed.kind === "too_large") return { ok: false, message: TOO_LARGE };
  // Use the validated call-time string, not a mutable FormData field or
  // response videoId, as the lock identity. Acquire before the first await.
  const releaseWrite = tryAcquireAdminVideoWrite(videoId);
  if (!releaseWrite) return { ok: false, message: BUSY };
  try {
    const response = await fetchFn(
      `/api/videos/${parsed.encodedId}/members`,
      {
        method: "PUT",
        credentials: "same-origin",
        cache: "no-store",
        headers: { accept: "application/json", "content-type": "application/json" },
        body: parsed.body,
      },
    );
    if (response.status !== 200) return { ok: false, message: UNVERIFIED };
    const json: unknown = await response.json();
    if (!json || typeof json !== "object" || Array.isArray(json)) {
      return { ok: false, message: UNVERIFIED };
    }
    const receipt = json as Record<string, unknown>;
    // Inspect each untrusted receipt property exactly once. A legacy/mock
    // json() port may return stateful getters even though normal JSON cannot.
    // The checked success + target must be the same values we return to Ops.
    const ok = receipt.ok;
    const receiptVideoId = receipt.videoId;
    const message = receipt.message;
    const pendingPublicReflection = receipt.pendingPublicReflection;
    if (ok !== true || receiptVideoId !== videoId ||
        (message !== undefined &&
          (typeof message !== "string" || message.length > 300)) ||
        (pendingPublicReflection !== undefined &&
          typeof pendingPublicReflection !== "boolean")) {
      return { ok: false, message: UNVERIFIED };
    }
    return {
      ok: true,
      ...(typeof message === "string" ? { message } : {}),
      ...(typeof pendingPublicReflection === "boolean"
        ? { pendingPublicReflection } : {}),
    };
  } catch {
    return { ok: false, message: UNVERIFIED };
  } finally {
    // A settled unknown result is not proof of rollback; never auto-retry.
    // Only a later explicit user action may attempt another PUT.
    releaseWrite();
  }
}
