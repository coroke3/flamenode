// MIG-0730 U02f: UNWIRED SA-084 client candidate for the unmounted
// MIG-0650 video collaborator batch route. This is not a substitute for the
// server's origin/session/CostGuard/authorization/atomic-audit validation.
import { MAX_COLLABORATOR_PERMISSION_BATCH } from "@flamenode/domain/video/atomicLimits";
import { isCanonicalXId, normalizeXId } from "@flamenode/domain/xid";
import type { OpsFetch } from "./read.js";
import { tryAcquireAdminVideoWrite } from "./adminVideoWriteLatch.js";

export type AdminPermissionBatchInput = {
  videoId: string;
  edit_privilege_mode?: "admin" | "event";
  notify: true;
  intents: { x_user_id: string; display_name: string; intent: "on" | "off" }[];
};

export type AdminPermissionBatchResult = { ok: boolean; message?: string };
const FAILURE = "権限変更を確認できませんでした。状態を再取得してください。";
const INVALID = "権限変更の入力に誤りがあります。";

// SA-084 and SA-085 must not concurrently mutate one video's participant
// and permission rows in the same browser module graph (U02bm).
const BUSY = "この作品の権限変更は処理中です。結果を確認してから操作してください。";

function validatedBatch(input: AdminPermissionBatchInput): {
  encodedId: string;
  body: {
    video_id: string;
    edit_privilege_mode?: "admin" | "event";
    notify: true;
    intents: AdminPermissionBatchInput["intents"];
  };
} | null {
  // Align privileged permission paths with SA-085 and admin GET path guards.
  if (!input || typeof input !== "object" ||
      typeof input.videoId !== "string" ||
      input.videoId.length < 1 || input.videoId.length > 64 ||
      input.videoId.trim() !== input.videoId ||
      /[\/\\\x00-\x1f]/.test(input.videoId) ||
      input.videoId === "." || input.videoId === ".." ||
      input.notify !== true ||
      (input.edit_privilege_mode !== undefined &&
        input.edit_privilege_mode !== "admin" &&
        input.edit_privilege_mode !== "event") ||
      !Array.isArray(input.intents) ||
      input.intents.length < 1 ||
      input.intents.length > MAX_COLLABORATOR_PERMISSION_BATCH) {
    return null;
  }

  const seen = new Set<string>();
  const intents: AdminPermissionBatchInput["intents"] = [];
  for (const item of input.intents) {
    if (!item || typeof item !== "object" ||
        typeof item.x_user_id !== "string" || item.x_user_id.length > 32 ||
        typeof item.display_name !== "string" ||
        typeof item.intent !== "string" ||
        (item.intent !== "on" && item.intent !== "off")) return null;
    const xid = normalizeXId(item.x_user_id);
    const display = item.display_name.trim();
    if (!isCanonicalXId(xid) || !display || display.length > 80 || seen.has(xid)) return null;
    seen.add(xid);
    intents.push({ x_user_id: xid, display_name: display, intent: item.intent });
  }

  let encodedId: string;
  try { encodedId = encodeURIComponent(input.videoId); }
  catch { return null; }
  return {
    encodedId,
    body: {
      video_id: input.videoId,
      ...(input.edit_privilege_mode ? { edit_privilege_mode: input.edit_privilege_mode } : {}),
      notify: true,
      intents,
    },
  };
}

/**
 * Before SA-084 mounts, this adapter is deliberately not imported by routes
 * or passed to the preview. Never retry an ambiguous mutation result.
 */
export async function applyAdminVideoMemberPermissionBatch(
  input: AdminPermissionBatchInput,
  fetchFn: OpsFetch = (path, init) => fetch(path, init),
): Promise<AdminPermissionBatchResult> {
  // A legacy/injected input can carry throwing getters or revoked Proxies.
  // An invalid permission batch must always settle without issuing HTTP.
  let parsed: ReturnType<typeof validatedBatch>;
  try {
    parsed = validatedBatch(input);
  } catch {
    return { ok: false, message: INVALID };
  }
  if (!parsed) return { ok: false, message: INVALID };
  // Freeze the request identity before any await; callers can mutate their
  // input object while the request is pending.
  const videoId = parsed.body.video_id;
  // Check and acquire synchronously, before the first await, to prevent two
  // confirmation submissions in the same JS runtime from issuing two POSTs.
  const releaseWrite = tryAcquireAdminVideoWrite(videoId);
  if (!releaseWrite) return { ok: false, message: BUSY };
  try {
    const response = await fetchFn(
      `/api/videos/${parsed.encodedId}/collaborators/batch`,
      {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: { accept: "application/json", "content-type": "application/json" },
        body: JSON.stringify(parsed.body),
      },
    );
    // The mutation may have committed even if the response was lost or invalid.
    // Never assume a failure response is proof of a rollback.
    if (response.status !== 200) return { ok: false, message: FAILURE };
    const json: unknown = await response.json();
    if (!json || typeof json !== "object" || Array.isArray(json)) {
      return { ok: false, message: FAILURE };
    }
    const body = json as Record<string, unknown>;
    // An unmounted SA-084 candidate must not optimistically apply edits on
    // an unbound {ok:true} receipt. The current upstream Draft still omits
    // videoId; keep this fail-closed until MIG-0650 agrees on the contract.
    if (body.ok !== true || body.videoId !== videoId ||
        (body.message !== undefined &&
        (typeof body.message !== "string" || body.message.length > 300))) {
      return { ok: false, message: FAILURE };
    }
    return { ok: true, ...(typeof body.message === "string" ? { message: body.message } : {}) };
  } catch {
    return { ok: false, message: FAILURE };
  } finally {
    // Never replay an ambiguous committed write. Only an explicit new user
    // action after the first HTTP attempt settles may issue another request.
    releaseWrite();
  }
}
