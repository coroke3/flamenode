// MIG-0730 U02d: UNMOUNTED composition of the shared Personal field and Ops form.
// SA-085 (MIG-0650) and X-user search/permission APIs are not approved for route activation.
import * as React from "react";
import { VideoMembersField } from "@flamenode/ui";
import type { AdminVideoMembersResponse } from "@flamenode/contracts";
import { AdminVideoMembersResponseSchema } from "@flamenode/contracts";
import { MAX_VIDEO_MEMBERS, MAX_COLLABORATOR_PERMISSION_BATCH } from "@flamenode/domain/video/atomicLimits";
import { normalizeXId, isCanonicalXId } from "@flamenode/domain/xid";
import { AdminVideoMembersForm, type AdminVideoMembersSave } from "./AdminVideoMembersForm.js";

type FieldProps = React.ComponentProps<typeof VideoMembersField>;

export interface AdminVideoMembersEditorPreviewProps {
  videoId: string;
  data: AdminVideoMembersResponse;
  searchXUsers?: FieldProps["searchXUsers"];
  applyPermissionBatch?: FieldProps["applyPermissionBatch"];
  save?: AdminVideoMembersSave;
  onSaved?: () => void;
}

const unavailableSearch: FieldProps["searchXUsers"] = async () => {
  throw new Error("MIG-0730: X-user search adapter is not wired");
};
const unavailablePermission: FieldProps["applyPermissionBatch"] = async () => {
  throw new Error("MIG-0730: permission mutation adapter is not wired");
};

// Best-effort in-tab deduplication across independent Preview React roots:
// member PUT and permission POST must not mutate the same video concurrently.
// Different tabs/devices still require the server-side D1 CAS (MIG-0650).
const writesInFlightByVideo = new Map<string, "save" | "permission">();

/**
 * Snapshot the exact SA-085 transport fields. Validating a mutable FormData
 * and forwarding that same object to an injected save port leaves a TOCTOU
 * gap for legacy/injected accessors or callers that mutate it.
 */
export function bindPreviewSaveFormData(
  formData: FormData,
  expectedVideoId: string,
): FormData | null {
  try {
    const ids = formData.getAll("video_id");
    const flags = formData.getAll("is_collab");
    const members = formData.getAll("members_json");
    let unexpectedField = false;
    formData.forEach((_, key) => {
      if (key !== "video_id" && key !== "is_collab" && key !== "members_json") {
        unexpectedField = true;
      }
    });
    const off = flags.length === 1 && flags[0] === "false";
    const on = flags.length === 2 && flags[0] === "false" && flags[1] === "true";
    if (unexpectedField || ids.length !== 1 || ids[0] !== expectedVideoId ||
        members.length !== 1 || typeof members[0] !== "string" ||
        !(on || (off && members[0] === "[]"))) return null;
    const bound = new FormData();
    bound.append("video_id", expectedVideoId);
    bound.append("is_collab", "false");
    if (on) bound.append("is_collab", "true");
    bound.append("members_json", members[0]);
    return bound;
  } catch {
    return null;
  }
}


type PermissionInput = Parameters<FieldProps["applyPermissionBatch"]>[0];

/**
 * Bind the preview's video identity and privileged intents to a fresh,
 * single-read DTO before forwarding them to any injected permission port.
 * The generic injected port might not perform the exact SA-084 validation.
 */
export function bindPreviewPermissionInput(
  input: PermissionInput,
  expectedVideoId: string,
): PermissionInput | null {
  try {
    if (!input || typeof input !== "object") return null;
    const suppliedId = input.videoId;
    const mode = input.edit_privilege_mode;
    const notify = input.notify;
    const sourceIntents = input.intents;
    if (suppliedId !== expectedVideoId || typeof expectedVideoId !== "string" ||
        !expectedVideoId || expectedVideoId.length > 64 ||
        expectedVideoId.trim() !== expectedVideoId ||
        /[\/\\\x00-\x1f]/.test(expectedVideoId) ||
        expectedVideoId === "." || expectedVideoId === ".." ||
        notify !== true ||
        (mode !== undefined && mode !== "admin" && mode !== "event") ||
        !Array.isArray(sourceIntents)) return null;
    // Never trust an injected array's iterator; inspect only its bounded
    // indexed rows and never forward row objects or accessors to the port.
    const count = sourceIntents.length;
    if (count < 1 || count > MAX_COLLABORATOR_PERMISSION_BATCH) return null;
    const intents: PermissionInput["intents"] = [];
    const seen = new Set<string>();
    for (let i = 0; i < count; i += 1) {
      const row = sourceIntents[i];
      if (!row || typeof row !== "object") return null;
      const rawId = row.x_user_id;
      const rawName = row.display_name;
      const intent = row.intent;
      if (typeof rawId !== "string" || rawId.length > 32 ||
          typeof rawName !== "string" ||
          (intent !== "on" && intent !== "off")) return null;
      const xid = normalizeXId(rawId);
      const name = rawName.trim();
      if (!isCanonicalXId(xid) || !name || name.length > 80 || seen.has(xid)) return null;
      seen.add(xid);
      intents.push({ x_user_id: xid, display_name: name, intent });
    }
    try { encodeURIComponent(expectedVideoId); }
    catch { return null; }
    return {
      videoId: expectedVideoId,
      ...(mode ? { edit_privilege_mode: mode } : {}),
      notify: true,
      intents,
    };
  } catch {
    // Untrusted input accessors must not throw into the private member form.
    return null;
  }
}


/**
 * Never show hidden edit-only rows from a forged/oversized snapshot; never turn
 * an incomplete set of injected adapters into a usable write interface.
 * This component is not imported by the Ops route table.
 */
export function AdminVideoMembersEditorPreview({
  videoId, data, searchXUsers, applyPermissionBatch, save, onSaved,
}: AdminVideoMembersEditorPreviewProps): React.ReactElement {
  // Both keyed form remounts and full Preview remounts must keep an old PUT
  // latched until it settles; never retry an ambiguous possibly-committed PUT.
  const guardedSave = React.useMemo<AdminVideoMembersSave | undefined>(() => {
    if (typeof save !== "function") return undefined;
    return async formData => {
      // FormData is mutable, not an authenticated submission. Independently
      // bind all transport keys before giving them to an injected SA-085 port:
      // hidden false + optional checked true, and one canonical member value.
      // A duplicate or reordered field could be interpreted differently by
      // another port (e.g. get() versus getAll()/getLast()).
      const boundForm = bindPreviewSaveFormData(formData, videoId);
      if (!boundForm) {
        return { ok: false, message: "参加者設定の入力を確認してください。" };
      }
      const ongoing = writesInFlightByVideo.get(videoId);
      if (ongoing) {
        return {
          ok: false,
          message: ongoing === "save"
            ? "前の保存処理が完了していません。結果を確認してから再度保存してください。"
            : "前の権限変更処理が完了していません。最新状態を確認してください。",
        };
      }
      writesInFlightByVideo.set(videoId, "save");
      try {
        return await save(boundForm);
      } finally {
        if (writesInFlightByVideo.get(videoId) === "save") {
          writesInFlightByVideo.delete(videoId);
        }
      }
    };
  }, [save, videoId]);

  // The shared Personal field deliberately preserves its CURRENT fallback
  // wording, but Ops' injected permission port can lose the response AFTER
  // the server commits. Report uncertainty without leaking provider details
  // or telling an admin that the permission change definitely failed.
  const guardedPermission = React.useMemo<FieldProps["applyPermissionBatch"] | undefined>(() => {
    if (typeof applyPermissionBatch !== "function") return undefined;
    return async input => {
      // Bind the target once. A getter can otherwise report this preview's
      // ID here and a different video ID to the injected POST adapter.
      const boundInput = bindPreviewPermissionInput(input, videoId);
      if (!boundInput) {
        return {
          ok: false,
          message: "編集権限の反映結果を確認できませんでした。状態を再取得してください。",
        };
      }
      if (writesInFlightByVideo.has(videoId)) {
        return {
          ok: false,
          message: "前の変更処理が完了していません。最新状態を確認してください。",
        };
      }
      // Acquire synchronously, before the first await. A second Preview root
      // must respect an in-flight PUT/POST even after a React remount.
      writesInFlightByVideo.set(videoId, "permission");
      try {
        return await applyPermissionBatch(boundInput);
      } catch {
        return {
          ok: false,
          message: "編集権限の反映結果を確認できませんでした。状態を再取得してください。",
        };
      } finally {
        if (writesInFlightByVideo.get(videoId) === "permission") {
          writesInFlightByVideo.delete(videoId);
        }
      }
    };
  }, [applyPermissionBatch, videoId]);

  // This unmounted preview is also callable directly. Reject malformed IDs
  // before touching a potentially private server response.
  if (typeof videoId !== "string" || !videoId || videoId.length > 64 ||
      videoId.trim() !== videoId || videoId === "." || videoId === ".." ||
      /[\/\\\x00-\x1f]/.test(videoId)) {
    return <p role="alert">参加者データを表示できません。</p>;
  }
  try { encodeURIComponent(videoId); }
  catch { return <p role="alert">参加者データを表示できません。</p>; }
  // Limit the array BEFORE schema traversal. A forged snapshot with 101+ rows
  // must not cause even one member getter / nested chapter to be inspected.
  // This preview is callable directly: malicious legacy getters/proxies can
  // throw during the initialMembers access or Zod traversal. Reject them
  // without crashing the entire editor or exposing a hidden member row.
  let parsed: ReturnType<typeof AdminVideoMembersResponseSchema.safeParse>;
  try {
    const rawMembers: unknown =
      data && typeof data === "object" && !Array.isArray(data)
        ? (data as { initialMembers?: unknown }).initialMembers
        : undefined;
    if (!Array.isArray(rawMembers) || rawMembers.length > MAX_VIDEO_MEMBERS) {
      return <p role="alert">参加者データを表示できません。</p>;
    }
    // Do not let an injected getter replace the bounded public list while
    // Zod traverses it. Both checks must operate on one member snapshot.
    parsed = AdminVideoMembersResponseSchema.safeParse({
      video: (data as { video?: unknown }).video,
      initialMembers: rawMembers,
    });
  } catch {
    return <p role="alert">参加者データを表示できません。</p>;
  }
  if (!parsed.success || parsed.data.video.id !== videoId ||
      parsed.data.initialMembers.some(member => member.is_public_member !== 1)) {
    return <p role="alert">参加者データを表示できません。</p>;
  }

  const valid = parsed.data;
  // Reset the member field and collaboration checkbox for a fresh authorized
  // membership snapshot. Changes to title/YouTube metadata alone should not
  // throw away local in-progress edits. Use only validated edit-relevant data,
  // not the entire DTO or its object identity, for the form's remount key.
  // Injected preview ports can be malformed at runtime. Never let truthy
  // non-functions grant edit/write capability or reach the shared field.
  const canEdit = typeof save === "function" &&
    typeof searchXUsers === "function" && typeof applyPermissionBatch === "function";
  // Capability loss/regrant is an authorization boundary. Retire the old form
  // including pending permission callbacks, private edits and confirmation UI.
  // Changes to title/YouTube metadata alone still preserve the local draft.
  const snapshotKey = JSON.stringify([
    valid.video.id, valid.video.collaboration_type, valid.initialMembers, canEdit,
  ]);
  const field = (
    <VideoMembersField
      key={videoId}
      initialMembers={valid.initialMembers}
      disabled={!canEdit}
      searchXUsers={typeof searchXUsers === "function" ? searchXUsers : unavailableSearch}
      applyPermissionBatch={guardedPermission ?? unavailablePermission}
      permissionTargetVideoId={canEdit ? videoId : null}
    />
  );

  return (
    <AdminVideoMembersForm
      key={snapshotKey}
      video={valid.video}
      initialMembersCount={valid.initialMembers.length}
      membersField={field}
      save={canEdit ? guardedSave : undefined}
      onSaved={canEdit ? onSaved : undefined}
    />
  );
}
