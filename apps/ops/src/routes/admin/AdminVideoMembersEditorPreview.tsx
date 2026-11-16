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
  const parsed = AdminVideoMembersResponseSchema.safeParse(data);
  if (!videoId || !parsed.success || parsed.data.video.id !== videoId ||
      parsed.data.initialMembers.length > MAX_VIDEO_MEMBERS ||
      parsed.data.initialMembers.some(member => member.is_public_member !== 1)) {
    return <p role="alert">参加者データを表示できません。</p>;
  }

  const valid = parsed.data;
  const canEdit = Boolean(save && searchXUsers && applyPermissionBatch);
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
      video={valid.video}
      initialMembersCount={valid.initialMembers.length}
      membersField={field}
      save={canEdit ? save : undefined}
      onSaved={canEdit ? onSaved : undefined}
    />
  );
}
