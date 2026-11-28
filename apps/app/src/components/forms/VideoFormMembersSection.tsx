// MIG-0714 B03: CURRENT members section; parent owns state, permission derivation and form lifecycle.
import * as React from "react";
import { Icon } from "../../routes/ui/Icon.tsx";
import { cn as cx } from "../../lib/cn.ts";
import { resolvePermissionUnlockHint } from "../../lib/permissionUnlockHint.ts";
import { FieldLockNote } from "../permission/FieldLockNote.tsx";
import { PermissionGroupBadge } from "../permission/PermissionBadge.tsx";
import { VideoMembersField, type VideoMemberInput, type VideoMemberSuggestion } from "./VideoMembersField.tsx";
import type { VideoMemberAdapters } from "./videoSubmitAdapter.ts";
import type { VideoFieldPermission, VideoPermissionGroupState } from "../../lib/videoEditPermissionView.ts";
import { videoFormLockNoteId, mergeDescribedBy, type VideoFormSectionContext } from "./videoFormFieldContracts.ts";

interface VideoFormMembersSectionProps extends VideoFormSectionContext, VideoMemberAdapters {
  membersSectionDisabled: boolean;
  membersPermissionState: VideoPermissionGroupState;
  membersSectionPermissions: VideoFieldPermission[];
  isCollabFieldDisabled: boolean;
  isCollab: boolean;
  setIsCollab: (value: boolean) => void;
  membersFieldsKey: number;
  members: VideoMemberInput[];
  memberSuggestions: VideoMemberSuggestion[];
  membersListDisabled: boolean;
  chaptersFieldDisabled: boolean;
  handleMembersChange: NonNullable<React.ComponentProps<typeof VideoMembersField>["onChange"]>;
  videoId?: string;
}

// The full section stays together to preserve native field order, lock notes and CURRENT handlers.
export function VideoFormMembersSection({
  mode, showPermissionUi, permissionView, membersSectionDisabled, membersPermissionState,
  membersSectionPermissions, isCollabFieldDisabled, isCollab, setIsCollab, membersFieldsKey,
  members, memberSuggestions, membersListDisabled, chaptersFieldDisabled, handleMembersChange,
  videoId, searchXUsers, applyPermissionBatch,
}: VideoFormMembersSectionProps): React.ReactElement {
  return (
    <section
        className={cx(
          "vform-section",
          membersSectionDisabled && "vform-sectionDisabled",
        )}
        data-disabled={membersSectionDisabled || undefined}
        data-permission-state={showPermissionUi ? membersPermissionState : undefined}
        aria-labelledby="video-form-section-members-title"
        aria-describedby={
          showPermissionUi && permissionView
            ? mergeDescribedBy(
                !permissionView.members.editable
                  ? videoFormLockNoteId("members")
                  : undefined,
                !permissionView.memberChapters.editable
                  ? videoFormLockNoteId("memberChapters")
                  : undefined,
              )
            : undefined
        }
        tabIndex={
          showPermissionUi && membersPermissionState === "locked" ? 0 : undefined
        }
      >
        <h2 id="video-form-section-members-title" className={"vform-sectionTitle"}>
          <Icon name="users" size={14} aria-hidden /> 合作メンバー
          {showPermissionUi && permissionView ? (
            <PermissionGroupBadge
              permissions={membersSectionPermissions}
              className={"vform-sectionPermissionBadge"}
            />
          ) : membersSectionDisabled ? (
            <span className={"vform-sectionDisabledBadge"} aria-label="編集不可">
              <Icon name="alert" size={11} aria-hidden /> 編集権限なし
            </span>
          ) : null}
        </h2>
        {showPermissionUi && permissionView && membersPermissionState !== "editable" ? (
          <div className={"vform-permissionNoteStack"}>
            <FieldLockNote
              id={videoFormLockNoteId("members")}
              permission={permissionView.members}
              unlockHint={resolvePermissionUnlockHint(
                permissionView.members,
                permissionView,
              )}
            />
            <FieldLockNote
              id={videoFormLockNoteId("memberChapters")}
              permission={permissionView.memberChapters}
              unlockHint={resolvePermissionUnlockHint(
                permissionView.memberChapters,
                permissionView,
              )}
            />
          </div>
        ) : membersSectionDisabled && mode === "edit" ? (
          <p className={"vform-help"} role="status" id={videoFormLockNoteId("section-members")}>
            この項目は、現在の一般作品権限では編集できません。
          </p>
        ) : null}
          <label
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              cursor: isCollabFieldDisabled ? "default" : "pointer",
              fontSize: 13,
            }}
          >
          {isCollabFieldDisabled ? (
            <>
              <input
                type="hidden"
                name="is_collab"
                value={isCollab ? "true" : "false"}
              />
              <input
                type="checkbox"
                checked={isCollab}
                readOnly
                disabled
                aria-readonly
                aria-describedby={
                  showPermissionUi && permissionView && !permissionView.members.editable
                    ? videoFormLockNoteId("members")
                    : membersSectionDisabled
                      ? videoFormLockNoteId("section-members")
                    : undefined
                }
              />
            </>
          ) : (
            <>
              <input type="hidden" name="is_collab" value="false" />
              <input
                type="checkbox"
                name="is_collab"
                value="true"
                checked={isCollab}
                onChange={(e) => setIsCollab(e.target.checked)}
              />
            </>
          )}
          合作作品として登録する
        </label>
        {isCollab ? (
          <div
            style={{ marginTop: 12 }}
            role="group"
            aria-label="合作メンバーとチャプター"
            aria-describedby={
              showPermissionUi && permissionView
                ? mergeDescribedBy(
                    !permissionView.members.editable
                      ? videoFormLockNoteId("members")
                      : undefined,
                    !permissionView.memberChapters.editable
                      ? videoFormLockNoteId("memberChapters")
                      : undefined,
                  )
                : undefined
            }
          >
            <VideoMembersField
              key={`video-members-${membersFieldsKey}`}
              initialMembers={members}
              suggestions={memberSuggestions}
              disabled={membersListDisabled}
              chaptersDisabled={chaptersFieldDisabled}
              onChange={handleMembersChange}
              searchXUsers={searchXUsers}
              applyPermissionBatch={applyPermissionBatch}
              collabPermsHref="#video-collab-perms"
              permissionTargetVideoId={mode === "edit" ? (videoId ?? null) : null}
            />
            <p className={"vform-help"} style={{ marginTop: 8 }}>
              X ID 欄は @ 抜きで入力します。未承認 X ID も受け付け、後で本人連携時に紐付け可能です。
            </p>
          </div>
        ) : null}
      </section>
  );
}
