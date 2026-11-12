import { EditPermissionsResponseSchema, type EditPermissionsResponse } from "@flamenode/contracts";

/** MIG-0715 U01: read-only boundary; writes wait for the MIG-0650 API. */
export type EditPermissionsReadResult =
  | { status: "ok"; data: EditPermissionsResponse }
  | { status: "not_found" }
  | { status: "anonymous" }
  | { status: "banned" }
  | { status: "unavailable" };

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export async function getEditPermissions({
  videoId,
  privilegeModes,
  signal,
  fetchFn = (input, init) => fetch(input, init),
}: {
  videoId: string;
  privilegeModes: readonly string[];
  signal?: AbortSignal;
  fetchFn?: FetchLike;
}): Promise<EditPermissionsReadResult> {
  const params = new URLSearchParams();
  // Preserve repeated/unknown values: only Hono can decide explicit-mode fallback.
  for (const mode of privilegeModes) params.append("privileged", mode);
  const query = params.toString();
  const path = "/api/personal/edit/" + encodeURIComponent(videoId) + "/permissions" + (query ? "?" + query : "");

  let response: Response;
  try {
    response = await fetchFn(path, {
      method: "GET",
      credentials: "same-origin",
      cache: "no-store",
      headers: { accept: "application/json" },
      signal,
    });
  } catch {
    return { status: "unavailable" };
  }
  if (response.status === 401) return { status: "anonymous" };
  if (response.status === 403) return { status: "banned" };
  if (response.status === 404) return { status: "not_found" };
  if (response.status !== 200) return { status: "unavailable" };

  try {
    const parsed = EditPermissionsResponseSchema.safeParse(await response.json());
    return parsed.success ? { status: "ok", data: parsed.data } : { status: "unavailable" };
  } catch {
    return { status: "unavailable" };
  }
}


/**
 * MIG-0715 U02 / D-16-1: provisional write client. Do not mount a save UI or
 * claim route parity until MIG-0650 supplies the canonical Hono contracts.
 * CURRENT: upsertVideoCollaborator / applyVideoCollaboratorPermissionsBatch.
 */
import { parseCanonicalXId } from "@flamenode/domain/xid";
import { send, type WriteResult } from "./write.js";

export type CollaboratorPrivilegeMode = "normal" | "admin" | "event";

export interface VideoCollaboratorResult {
  ok: boolean;
  message?: string;
  granted?: string[];
  revoked?: string[];
  unchanged?: number;
}

export type VideoCollaboratorWriteResult =
  | WriteResult<VideoCollaboratorResult>
  | { status: "invalid"; message: string };

export interface CollaboratorPermissionIntent {
  x_user_id: string;
  display_name: string;
  intent: "on" | "off";
}

export interface UpsertVideoCollaboratorInput {
  videoId: string;
  xUserId: string;
  displayName: string;
  canEdit: boolean;
  notify: boolean;
  editPrivilegeMode?: CollaboratorPrivilegeMode;
}

export interface ApplyVideoCollaboratorBatchInput {
  videoId: string;
  notify: boolean;
  intents: readonly CollaboratorPermissionIntent[];
  editPrivilegeMode?: CollaboratorPrivilegeMode;
}

const INVALID_X_ID_MESSAGE = "X ID は英数字とアンダースコア20文字以内で入力してください。";

function writePath(videoId: string): string {
  return `/api/videos/${encodeURIComponent(videoId)}/collaborators`;
}

function privilegeFields(mode: CollaboratorPrivilegeMode | undefined): {
  edit_privilege_mode?: "admin" | "event";
} {
  return mode === "admin" || mode === "event"
    ? { edit_privilege_mode: mode }
    : {};
}

function validatedWriteResult(result: WriteResult<VideoCollaboratorResult>): VideoCollaboratorWriteResult {
  if (result.status !== "ok") return result;
  const data = result.data;
  // send() validates the ok boolean. Keep optional message/batch summary strict:
  // malformed 200 responses must never be presented as a successful grant.
  if (
    (data.message !== undefined && typeof data.message !== "string") ||
    (data.granted !== undefined && (!Array.isArray(data.granted) || !data.granted.every((x) => typeof x === "string"))) ||
    (data.revoked !== undefined && (!Array.isArray(data.revoked) || !data.revoked.every((x) => typeof x === "string"))) ||
    (data.unchanged !== undefined && (!Number.isSafeInteger(data.unchanged) || data.unchanged < 0))
  ) return { status: "unavailable" };
  return result;
}

/** SA-082 provisional: same-origin PUT; server alone decides the grant. */
export async function upsertVideoCollaborator(
  input: UpsertVideoCollaboratorInput,
  fetchFn: FetchLike = (url, init) => fetch(url, init),
): Promise<VideoCollaboratorWriteResult> {
  const xId = parseCanonicalXId(input.xUserId);
  if (!xId) return { status: "invalid", message: INVALID_X_ID_MESSAGE };
  return validatedWriteResult(await send<VideoCollaboratorResult>(
    fetchFn,
    "PUT",
    `${writePath(input.videoId)}/${encodeURIComponent(xId)}`,
    {
      display_name: input.displayName,
      can_edit: input.canEdit,
      notify: input.notify,
      ...privilegeFields(input.editPrivilegeMode),
    },
  ));
}

/** SA-084 provisional: no client-side optimistic permission changes or retries. */
export async function applyVideoCollaboratorPermissionsBatch(
  input: ApplyVideoCollaboratorBatchInput,
  fetchFn: FetchLike = (url, init) => fetch(url, init),
): Promise<VideoCollaboratorWriteResult> {
  const intents: CollaboratorPermissionIntent[] = [];
  if (!input.intents.length) return { status: "invalid", message: "変更する編集権限がありません。" };
  for (const intent of input.intents) {
    const xId = parseCanonicalXId(intent.x_user_id);
    if (!xId) return { status: "invalid", message: INVALID_X_ID_MESSAGE };
    intents.push({
      x_user_id: xId,
      display_name: intent.display_name,
      intent: intent.intent,
    });
  }
  return validatedWriteResult(await send<VideoCollaboratorResult>(
    fetchFn,
    "POST",
    `${writePath(input.videoId)}/batch`,
    {
      ...privilegeFields(input.editPrivilegeMode),
      notify: input.notify,
      intents,
    },
  ));
}
