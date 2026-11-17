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
  if (!input || typeof input !== "object") return null;
  // A legacy/injected object can expose stateful accessors. Read each source
  // property exactly once: the checked video ID must also be the path, lock
  // and body identity, and checked privilege intents must be the sent intents.
  const videoId = input.videoId;
  const mode = input.edit_privilege_mode;
  const notify = input.notify;
  const sourceIntents = input.intents;
  if (typeof videoId !== "string" ||
      videoId.length < 1 || videoId.length > 64 ||
      videoId.trim() !== videoId ||
      /[\/\\\x00-\x1f]/.test(videoId) ||
      videoId === "." || videoId === ".." ||
      notify !== true ||
      (mode !== undefined && mode !== "admin" && mode !== "event") ||
      !Array.isArray(sourceIntents)) return null;

  // Snapshot no more than the server's maximum by numeric index. Iterating a
  // hostile array's custom Symbol.iterator could yield arbitrary extra rows,
  // bypass the length gate or never terminate.
  const count = sourceIntents.length;
  if (count < 1 || count > MAX_COLLABORATOR_PERMISSION_BATCH) return null;
  const rows: AdminPermissionBatchInput["intents"] = [];
  for (let i = 0; i < count; i += 1) rows.push(sourceIntents[i]!);

  const seen = new Set<string>();
  const intents: AdminPermissionBatchInput["intents"] = [];
  for (const item of rows) {
    if (!item || typeof item !== "object") return null;
    const rawXId = item.x_user_id;
    const rawName = item.display_name;
    const intent = item.intent;
    if (typeof rawXId !== "string" || rawXId.length > 32 ||
        typeof rawName !== "string" ||
        (intent !== "on" && intent !== "off")) return null;
    const xid = normalizeXId(rawXId);
    const display = rawName.trim();
    if (!isCanonicalXId(xid) || !display || display.length > 80 || seen.has(xid)) return null;
    seen.add(xid);
    intents.push({ x_user_id: xid, display_name: display, intent });
  }

  let encodedId: string;
  try { encodedId = encodeURIComponent(videoId); }
  catch { return null; }
  return {
    encodedId,
    body: {
      video_id: videoId,
      ...(mode ? { edit_privilege_mode: mode } : {}),
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
    const receipt = json as Record<string, unknown>;
    // Keep this unmounted SA-084 success bound to the requested target.
    // An injected/mock json() object may expose changing getters. Capture
    // each receipt field only once before deciding whether to publish success.
    const ok = receipt.ok;
    const receiptVideoId = receipt.videoId;
    const message = receipt.message;
    // Upstream MIG-0650 Draft currently omits videoId, so this intentionally
    // fails closed until the backend's authoritative receipt is finalized.
    if (ok !== true || receiptVideoId !== videoId ||
        (message !== undefined &&
          (typeof message !== "string" || message.length > 300))) {
      return { ok: false, message: FAILURE };
    }
    return { ok: true, ...(typeof message === "string" ? { message } : {}) };
  } catch {
    return { ok: false, message: FAILURE };
  } finally {
    // Never replay an ambiguous committed write. Only an explicit new user
    // action after the first HTTP attempt settles may issue another request.
    releaseWrite();
  }
}
