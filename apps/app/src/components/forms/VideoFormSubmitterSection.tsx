// MIG-0714 B03: CURRENT identity section; parent owns state, permission derivation and form lifecycle.
import * as React from "react";
import { Icon } from "../../routes/ui/Icon.tsx";
import { cn as cx } from "../../lib/cn.ts";
import { resolvePermissionUnlockHint } from "../../lib/permissionUnlockHint.ts";
import { FieldLockNote } from "../permission/FieldLockNote.tsx";
import { PermissionBadge } from "../permission/PermissionBadge.tsx";
import { EditSubmitterField, type XIdOption } from "./EditSubmitterField.tsx";
import { VideoIconPicker, type VideoIconPickerProps } from "./VideoIconPicker.tsx";
import { YoutubeChannelPicker } from "../shared/YoutubeChannelPicker.tsx";
import { SocialLinksEditor } from "../shared/SocialLinksEditor.tsx";
import { isSectionDisabled } from "./videoFormDraftFields.ts";
import { videoFormLockNoteId, mergeDescribedBy, type VideoFormInputContext, type VideoFormInitialValues, type VideoDefaultProfile } from "./videoFormFieldContracts.ts";

interface VideoFormSubmitterSectionProps extends VideoFormInputContext {
  initial: VideoFormInitialValues;
  defaultProfile?: VideoDefaultProfile;
  submitterDisabled: boolean;
  identityPermissionState: "editable" | "locked";
  handleReapplyDefaultProfile: () => void;
  isActiveXFixed: boolean;
  normalizedActiveXId: string;
  normalizedInitialXId: string;
  xIdOptions: XIdOption[];
  hasSelectableXIds: boolean;
  selectedDefault: string;
  disabledSections?: string[];
  canChangeSubmitter: boolean;
  submitterDisplayName: string;
  setSubmitterDisplayName: (value: string) => void;
  submitterFieldsKey: number;
  iconCandidates: string[];
  submitterIconUrl: string;
  setSubmitterIconUrl: (value: string) => void;
  restoredUploadFile: File | null;
  handleUploadFileChange: NonNullable<VideoIconPickerProps["onUploadFileChange"]>;
  setDraftFileError: NonNullable<VideoIconPickerProps["onDraftFileError"]>;
  submitterProfileText: string;
  setSubmitterProfileText: (value: string) => void;
  submitterYoutubeChannel: string;
  setSubmitterYoutubeChannel: (value: string) => void;
  channelCandidates: string[];
  submitterSocialLinks: string;
  setSubmitterSocialLinks: (value: string) => void;
}

// The full section stays together to preserve native field order, lock notes and CURRENT handlers.
export function VideoFormSubmitterSection({
  mode, showPermissionUi, permissionView, fieldDisabled, isOptionalFieldRequired, stepError, setDirty,
  initial, defaultProfile, submitterDisabled, identityPermissionState, handleReapplyDefaultProfile,
  isActiveXFixed, normalizedActiveXId, normalizedInitialXId, xIdOptions, hasSelectableXIds,
  selectedDefault, disabledSections, canChangeSubmitter, submitterDisplayName, setSubmitterDisplayName,
  submitterFieldsKey, iconCandidates, submitterIconUrl, setSubmitterIconUrl, restoredUploadFile,
  handleUploadFileChange, setDraftFileError, submitterProfileText, setSubmitterProfileText,
  submitterYoutubeChannel, setSubmitterYoutubeChannel, channelCandidates, submitterSocialLinks,
  setSubmitterSocialLinks,
}: VideoFormSubmitterSectionProps): React.ReactElement {
  return (
    <section
        className={cx(
          "vform-section",
          submitterDisabled && "vform-sectionDisabled",
        )}
        data-disabled={submitterDisabled || undefined}
        data-permission-state={
          showPermissionUi ? identityPermissionState : undefined
        }
        aria-labelledby="video-form-section-identity-title"
        aria-describedby={
          submitterDisabled ? videoFormLockNoteId("section-identity") : undefined
        }
        tabIndex={
          showPermissionUi && identityPermissionState === "locked" ? 0 : undefined
        }
      >
        <h2 id="video-form-section-identity-title" className={"vform-sectionTitle"}>
          <Icon name="user" size={14} aria-hidden /> 提出者情報
          {showPermissionUi && permissionView ? (
            <PermissionBadge
              permission={permissionView.identity}
              className={"vform-sectionPermissionBadge"}
            />
          ) : submitterDisabled ? (
            <span className={"vform-sectionDisabledBadge"} aria-label="編集不可">
              <Icon name="alert" size={11} aria-hidden /> 編集権限なし
            </span>
          ) : null}
        </h2>
        {showPermissionUi && permissionView && submitterDisabled ? (
          <FieldLockNote
            id={videoFormLockNoteId("section-identity")}
            permission={permissionView.identity}
            unlockHint={resolvePermissionUnlockHint(
              permissionView.identity,
              permissionView,
            )}
          />
        ) : submitterDisabled && mode === "edit" ? (
          <p className={"vform-help"} role="status" id={videoFormLockNoteId("section-identity")}>
            この項目は、現在の一般作品権限では編集できません。
          </p>
        ) : null}
        <p className={"vform-help"}>
          {mode === "edit" ? (
            <>
              この作品に保存されている提出者情報を編集しています。
              変更はこの作品にだけ適用されます。
              X IDの既定プロフィールや、ほかの作品には影響しません。
            </>
          ) : (
            <>
              X IDに設定された既定プロフィールを入力しています。
              ここで変更した内容は、この作品にだけ適用されます。
              X IDの既定プロフィールや、ほかの作品には影響しません。
            </>
          )}
        </p>
        {defaultProfile && !submitterDisabled ? (
          <p style={{ margin: "0 0 12px" }}>
            <button
              type="button"
              className="fn-btn fn-btn-ghost fn-btn-sm"
              onClick={handleReapplyDefaultProfile}
            >
              現在の既定プロフィールを再適用
            </button>
          </p>
        ) : null}
        <div className={`${"vform-row"} ${"vform-cols2"}`}>
          <div className={cx("vform-field", "vform-editableField")}>
            <label className={`${"vform-label"} ${"vform-required"}`} htmlFor="creator_x_user_id">
              提出主体 X ID
            </label>
            {isActiveXFixed ? (
              // free / slot モード: Active X ID に固定。変更不可。
              normalizedActiveXId ? (
                <>
                  <input
                    id="creator_x_user_id"
                    name="creator_x_user_id"
                    type="text"
                    value={normalizedActiveXId}
                    readOnly
                    className="fn-input"
                    aria-readonly="true"
                    disabled={fieldDisabled("submitter.creator_x_user_id")}
                  />
                  <p className={"vform-help"} style={{ marginTop: 4 }}>
                    提出主体は現在の Active X ID に固定されます。変更する場合は上部バーから X ID を切り替えてください。
                  </p>
                </>
              ) : (
                <div className="fn-muted fn-text-sm">
                  承認済み X ID がありません。
                  <a href="/dashboard/settings" style={{ marginLeft: 6 }}>
                    設定で連携
                  </a>
                </div>
              )
            ) : mode === "edit" ? (
              // edit モード: 既定では readOnly で表示し、admin が明示的に解錠した場合のみ
              // <select> を出して提出主体 X ID を変更できる。
              // 解錠時は allow_submitter_change=1 を hidden で送り、サーバー側でも
              // role==="admin" と二重ゲートで検証する。
              <EditSubmitterField
                initialXId={normalizedInitialXId}
                xIdOptions={xIdOptions}
                hasSelectableXIds={hasSelectableXIds}
                selectedDefault={selectedDefault}
                disabled={fieldDisabled("submitter.creator_x_user_id")}
                sectionDisabled={isSectionDisabled(disabledSections, "submitter")}
                canChangeSubmitter={canChangeSubmitter}
                lockNoteId={
                  submitterDisabled
                    ? videoFormLockNoteId("section-identity")
                    : undefined
                }
              />
            ) : null}
          </div>
          <div className={cx("vform-field", "vform-editableField")}>
            <label className={`${"vform-label"} ${"vform-required"}`} htmlFor="display_name">
              表示名 / 活動名 / 団体名
            </label>
            <input
              id="display_name"
              name="display_name"
              type="text"
              value={submitterDisplayName}
              className="fn-input"
              maxLength={80}
              required
              onChange={(e) => {
                setSubmitterDisplayName(e.target.value);
                setDirty(true);
              }}
              aria-invalid={stepError?.fieldId === "display_name" || undefined}
              aria-describedby={mergeDescribedBy(
                stepError?.fieldId === "display_name"
                  ? "wizard-validation-error"
                  : undefined,
                submitterDisabled
                  ? videoFormLockNoteId("section-identity")
                  : undefined,
              )}
              readOnly={fieldDisabled("submitter.display_name")}
              aria-readonly={fieldDisabled("submitter.display_name") || undefined}
            />
          </div>
        </div>
        <div
          className={cx("vform-field", "vform-editableField")}
          role="group"
          aria-labelledby="video-form-icon-label"
          aria-describedby={
            submitterDisabled
              ? videoFormLockNoteId("section-identity")
              : undefined
          }
        >
          <span
            id="video-form-icon-label"
            className={`${"vform-label"}${isOptionalFieldRequired("icon_url") ? ` ${"vform-required"}` : ""}`}
          >
            作品アイコン
          </span>
          <p className={"vform-help"}>
            この作品で表示するアイコンを選択します。X ID 既定アイコンは変更されません。
          </p>
          <VideoIconPicker
            key={`video-icon-${submitterFieldsKey}`}
            candidates={iconCandidates}
            initialIconUrl={submitterIconUrl}
            persistedIconUrl={initial.icon_url}
            defaultIconUrl={defaultProfile?.icon_url}
            value={submitterIconUrl}
            onChange={(url) => {
              setSubmitterIconUrl(url);
              setDirty(true);
            }}
            restoredUploadFile={restoredUploadFile}
            onUploadFileChange={handleUploadFileChange}
            onDraftFileError={setDraftFileError}
            disabled={fieldDisabled("submitter.icon_url")}
            isEdit={mode === "edit"}
          />
        </div>
        <div className={cx("vform-field", "vform-editableField")}>
          <label
            className={`${"vform-label"}${isOptionalFieldRequired("profile_text") ? ` ${"vform-required"}` : ""}`}
            htmlFor="profile_text"
          >
            自分・団体の概要
          </label>
          <textarea
            id="profile_text"
            name="profile_text"
            value={submitterProfileText}
            onChange={(e) => {
              setSubmitterProfileText(e.target.value);
              setDirty(true);
            }}
            className="fn-input"
            rows={3}
            maxLength={1000}
            readOnly={fieldDisabled("submitter.profile_text")}
            aria-readonly={fieldDisabled("submitter.profile_text") || undefined}
            aria-describedby={
              submitterDisabled
                ? videoFormLockNoteId("section-identity")
                : undefined
            }
          />
        </div>
        <div
          className={cx("vform-field", "vform-editableField")}
          role="group"
          aria-labelledby="video-form-channel-label"
          aria-describedby={
            submitterDisabled
              ? videoFormLockNoteId("section-identity")
              : undefined
          }
        >
          <span
            id="video-form-channel-label"
            className={`${"vform-label"}${isOptionalFieldRequired("youtube_channel_url") ? ` ${"vform-required"}` : ""}`}
          >
            YouTube チャンネル
          </span>
          <YoutubeChannelPicker
            key={`youtube-channel-${submitterFieldsKey}`}
            defaultValue={submitterYoutubeChannel || null}
            candidates={channelCandidates}
            disabled={fieldDisabled("submitter.youtube_channel_url")}
            onValueChange={(url) => {
              setSubmitterYoutubeChannel(url);
              setDirty(true);
            }}
          />
        </div>
        <div
          className={cx("vform-field", "vform-editableField")}
          role="group"
          aria-label="その他のSNSリンク"
          aria-describedby={
            submitterDisabled
              ? videoFormLockNoteId("section-identity")
              : undefined
          }
        >
          {isOptionalFieldRequired("other_social_links") ? (
            <span className={`${"vform-label"} ${"vform-required"}`}>
              その他のSNSリンク
            </span>
          ) : null}
          <SocialLinksEditor
            key={`social-links-${submitterFieldsKey}`}
            initialValue={submitterSocialLinks || null}
            disabled={fieldDisabled("submitter.other_social_links")}
            onValueChange={(json) => {
              setSubmitterSocialLinks(json);
              setDirty(true);
            }}
          />
        </div>
      </section>
  );
}
