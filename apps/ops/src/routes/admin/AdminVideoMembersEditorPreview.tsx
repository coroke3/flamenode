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

/**
 * Never show hidden edit-only rows from a forged/oversized snapshot; never turn
 * an incomplete set of injected adapters into a usable write interface.
 * This component is not imported by the Ops route table.
 */
export function AdminVideoMembersEditorPreview({
  videoId, data, searchXUsers, applyPermissionBatch, save, onSaved,
}: AdminVideoMembersEditorPreviewProps): React.ReactElement {
  // A fresh authorized same-video GET changes the form's snapshot key and
  // remounts its local submit latch. Keep a second, parent-scoped write latch
  // so that a prior possibly-committed PUT cannot overlap a new snapshot's
  // PUT. Retain A's latch across A -> B -> A navigation in this preview.
  const writesInFlight = React.useRef(new Set<string>());
  const guardedSave = React.useMemo<AdminVideoMembersSave | undefined>(() => {
    if (!save) return undefined;
    return async formData => {
      if (writesInFlight.current.has(videoId)) {
        return {
          ok: false,
          message: "前の保存処理が完了していません。結果を確認してから再度保存してください。",
        };
      }
      writesInFlight.current.add(videoId);
      try {
        return await save(formData);
      } finally {
        writesInFlight.current.delete(videoId);
      }
    };
  }, [save, videoId]);

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
      applyPermissionBatch={applyPermissionBatch ?? unavailablePermission}
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
