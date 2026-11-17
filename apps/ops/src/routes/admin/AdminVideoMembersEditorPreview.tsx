// MIG-0730 U02d: UNMOUNTED composition of the shared Personal field and Ops form.
// SA-085 (MIG-0650) and X-user search/permission APIs are not approved for route activation.
import * as React from "react";
import { VideoMembersField } from "@flamenode/ui";
import type { AdminVideoMembersResponse } from "@flamenode/contracts";
import { AdminVideoMembersResponseSchema } from "@flamenode/contracts";
import { MAX_VIDEO_MEMBERS } from "@flamenode/domain/video/atomicLimits";
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
    if (!save) return undefined;
    return async formData => {
      // FormData is mutable, not an authenticated submission. Independently
      // bind all transport keys before giving them to an injected SA-085 port:
      // hidden false + optional checked true, and one canonical member value.
      // A duplicate or reordered field could be interpreted differently by
      // another port (e.g. get() versus getAll()/getLast()).
      let canonicalForm = false;
      try {
        const ids = formData.getAll("video_id");
        const flags = formData.getAll("is_collab");
        const members = formData.getAll("members_json");
        const off = flags.length === 1 && flags[0] === "false";
        const on = flags.length === 2 &&
          flags[0] === "false" && flags[1] === "true";
        canonicalForm = ids.length === 1 && ids[0] === videoId &&
          members.length === 1 && typeof members[0] === "string" &&
          (on || (off && members[0] === "[]"));
      } catch { /* Malformed FormData is not a write capability. */ }
      if (!canonicalForm) {
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
        return await save(formData);
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
    if (!applyPermissionBatch) return undefined;
    return async input => {
      // One preview must not redirect another video's privilege write.
      if (!input || input.videoId !== videoId) {
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
        return await applyPermissionBatch(input);
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
  const rawMembers: unknown =
    data && typeof data === "object" && !Array.isArray(data)
      ? (data as { initialMembers?: unknown }).initialMembers
      : undefined;
  if (!Array.isArray(rawMembers) || rawMembers.length > MAX_VIDEO_MEMBERS) {
    return <p role="alert">参加者データを表示できません。</p>;
  }

  const parsed = AdminVideoMembersResponseSchema.safeParse(data);
  if (!parsed.success || parsed.data.video.id !== videoId ||
      parsed.data.initialMembers.some(member => member.is_public_member !== 1)) {
    return <p role="alert">参加者データを表示できません。</p>;
  }

  const valid = parsed.data;
  // Reset the member field and collaboration checkbox for a fresh authorized
  // membership snapshot. Changes to title/YouTube metadata alone should not
  // throw away local in-progress edits. Use only validated edit-relevant data,
  // not the entire DTO or its object identity, for the form's remount key.
  const canEdit = Boolean(save && searchXUsers && applyPermissionBatch);
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
      searchXUsers={searchXUsers ?? unavailableSearch}
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
