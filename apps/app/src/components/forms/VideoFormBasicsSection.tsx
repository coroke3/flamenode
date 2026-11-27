// MIG-0714 B03: CURRENT video section; parent owns state, permission derivation and form lifecycle.
import * as React from "react";
import { Icon } from "../../routes/ui/Icon.tsx";
import { cn as cx } from "../../lib/cn.ts";
import { resolvePermissionUnlockHint } from "../../lib/permissionUnlockHint.ts";
import { FieldLockNote } from "../permission/FieldLockNote.tsx";
import { PermissionGroupBadge } from "../permission/PermissionBadge.tsx";
import { PermissionFieldLabel } from "../permission/PermissionFieldLabel.tsx";
import { youtubeThumbUrl, youtubeWatchUrl } from "../../lib/youtubeId.ts";
import { MAX_ATOMIC_VIDEO_EVENTS } from "@flamenode/domain/video/atomicLimits";
import type { VideoFieldPermission, VideoPermissionGroupState } from "../../lib/videoEditPermissionView.ts";
import { videoFormLockNoteId, mergeDescribedBy, type VideoFormInputContext, type VideoFormInitialValues, type EventOption } from "./videoFormFieldContracts.ts";

interface VideoFormBasicsSectionProps extends VideoFormInputContext {
  initial: VideoFormInitialValues;
  videoSectionDisabled: boolean;
  videoPermissionState: VideoPermissionGroupState;
  videoSectionPermissions: VideoFieldPermission[];
  eventOptions: EventOption[];
  setTitlePreview: (value: string) => void;
  isWizard: boolean;
  isYoutubeUrlRequired: boolean;
  youtubeUrl: string;
  setYoutubeUrl: (value: string) => void;
  isYoutubeFieldDisabled: boolean;
  showYoutubeAddBlockedHint: boolean;
  youtubeId: string | null;
  slotId?: string;
  selectedEventIds: string[];
  canEditEvents: boolean;
  setSelectedEventIds: React.Dispatch<React.SetStateAction<string[]>>;
  schedulingType?: "manual" | "slotted" | null;
  availableParts: string[];
  selectedPart: string;
  setSelectedPart: (value: string) => void;
}

// The full section stays together to preserve native field order, lock notes and CURRENT handlers.
export function VideoFormBasicsSection({
  mode, showPermissionUi, permissionView, fieldDisabled, isOptionalFieldRequired, stepError, setDirty,
  initial, videoSectionDisabled, videoPermissionState, videoSectionPermissions, eventOptions,
  setTitlePreview, isWizard, isYoutubeUrlRequired, youtubeUrl, setYoutubeUrl, isYoutubeFieldDisabled,
  showYoutubeAddBlockedHint, youtubeId, slotId, selectedEventIds, canEditEvents, setSelectedEventIds,
  schedulingType, availableParts, selectedPart, setSelectedPart,
}: VideoFormBasicsSectionProps): React.ReactElement {
  return (
    <section
        className={cx(
          "vform-section",
          videoSectionDisabled && "vform-sectionDisabled",
        )}
        data-disabled={videoSectionDisabled || undefined}
        data-permission-state={showPermissionUi ? videoPermissionState : undefined}
        aria-labelledby="video-form-section-video-title"
        aria-describedby={
          showPermissionUi && permissionView
            ? mergeDescribedBy(
                !permissionView.basics.editable
                  ? videoFormLockNoteId("basics")
                  : undefined,
                !permissionView.youtube.editable
                  ? videoFormLockNoteId("youtube")
                  : undefined,
                !permissionView.credits.editable
                  ? videoFormLockNoteId("credits-music")
                  : undefined,
                !permissionView.credits.editable
                  ? videoFormLockNoteId("credits-credit")
                  : undefined,
                eventOptions.length > 0 && !permissionView.primaryEvent.editable
                  ? videoFormLockNoteId("primaryEvent")
                  : undefined,
              )
            : videoSectionDisabled
              ? videoFormLockNoteId("section-video")
              : undefined
        }
        tabIndex={
          showPermissionUi && videoPermissionState === "locked" ? 0 : undefined
        }
      >
        <h2 id="video-form-section-video-title" className={"vform-sectionTitle"}>
          <Icon name="youtube" size={14} aria-hidden /> 動画と基本情報
          {showPermissionUi && permissionView ? (
            <PermissionGroupBadge
              permissions={videoSectionPermissions}
              className={"vform-sectionPermissionBadge"}
            />
          ) : videoSectionDisabled ? (
            <span className={"vform-sectionDisabledBadge"} aria-label="編集不可">
              <Icon name="alert" size={11} aria-hidden /> 編集権限なし
            </span>
          ) : null}
        </h2>
        {!showPermissionUi && videoSectionDisabled && mode === "edit" ? (
          <p className={"vform-help"} role="status" id={videoFormLockNoteId("section-video")}>
            この項目は、現在の一般作品権限では編集できません。
          </p>
        ) : null}

        <div className={cx("vform-field", "vform-editableField")}>
          {showPermissionUi && permissionView ? (
            <PermissionFieldLabel
              label="作品タイトル"
              htmlFor="title"
              permission={permissionView.basics}
              required
            />
          ) : (
            <label className={`${"vform-label"} ${"vform-required"}`} htmlFor="title">
              作品タイトル
            </label>
          )}
          <input
            id="title"
            name="title"
            type="text"
            defaultValue={initial.title}
            className="fn-input"
            placeholder="例: First Light - 春の輪"
            maxLength={120}
              required
              onChange={(e) => {
                setTitlePreview(e.target.value);
                setDirty(true);
              }}
              aria-invalid={stepError?.fieldId === "title" || undefined}
              aria-describedby={mergeDescribedBy(
                stepError?.fieldId === "title"
                  ? "wizard-validation-error"
                  : undefined,
                showPermissionUi &&
                  permissionView &&
                  !permissionView.basics.editable
                  ? videoFormLockNoteId("basics")
                  : undefined,
                !showPermissionUi && videoSectionDisabled
                  ? videoFormLockNoteId("section-video")
                  : undefined,
              )}
            readOnly={fieldDisabled("video.title")}
            aria-readonly={fieldDisabled("video.title") || undefined}
          />
          {showPermissionUi && permissionView ? (
            <FieldLockNote
              id={videoFormLockNoteId("basics")}
              permission={permissionView.basics}
              unlockHint={resolvePermissionUnlockHint(
                permissionView.basics,
                permissionView,
              )}
            />
          ) : null}
        </div>

        {mode === "free" ? (
          <div className={cx("vform-field", "vform-editableField")}>
            <label className={"vform-label"} htmlFor="scheduled_time">
              投稿日時 / 公開日時
            </label>
            <input
              id="scheduled_time"
              name="scheduled_time"
              type="datetime-local"
              className="fn-input"
              disabled={fieldDisabled("video.scheduled_time")}
            />
            <p className={"vform-help"}>
              未入力の場合は提出時刻が使われます。入力値は日本時間 (JST) として扱われます。
            </p>
          </div>
        ) : null}

        {!isWizard ? (
        <div className={cx("vform-field", "vform-editableField")}>
          {showPermissionUi && permissionView ? (
            <PermissionFieldLabel
              label="YouTube URL"
              htmlFor="youtube_url"
              permission={permissionView.youtube}
              required={isYoutubeUrlRequired}
            />
          ) : (
            <label
              className={`${"vform-label"} ${isYoutubeUrlRequired ? "vform-required" : ""}`}
              htmlFor="youtube_url"
            >
              YouTube URL
            </label>
          )}
          <input
            id="youtube_url"
            name="youtube_url"
            type="text"
            inputMode="url"
            value={youtubeUrl}
            onChange={(e) => setYoutubeUrl(e.target.value)}
            className="fn-input"
            placeholder="https://www.youtube.com/watch?v=..."
            required={isYoutubeUrlRequired}
            readOnly={isYoutubeFieldDisabled}
            aria-readonly={isYoutubeFieldDisabled || undefined}
            aria-describedby={mergeDescribedBy(
              showPermissionUi &&
                permissionView &&
                !permissionView.youtube.editable
                ? videoFormLockNoteId("youtube")
                : undefined,
            )}
          />
          {showPermissionUi && permissionView ? (
            <FieldLockNote
              id={videoFormLockNoteId("youtube")}
              permission={permissionView.youtube}
              unlockHint={resolvePermissionUnlockHint(
                permissionView.youtube,
                permissionView,
              )}
            />
          ) : null}
          {showYoutubeAddBlockedHint ? (
            <p className={"vform-help"}>
              YouTube URL は未登録です。追加する権限がありません。
            </p>
          ) : (
            <p className={"vform-help"}>
              {isYoutubeUrlRequired
                ? "限定公開でも登録可能ですが、編集時の動画 ID 変更は管理者の事前承認が必要です。"
                : "任意。後から追加できます。限定公開でも登録可能です。"}
            </p>
          )}
          {youtubeId ? (
            <div className={"vform-preview"}>
              <div className={"vform-previewThumb"}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={youtubeThumbUrl(youtubeId, "hqdefault")} alt="" />
              </div>
              <div className={"vform-previewBody"}>
                <strong style={{ color: "var(--text-primary)" }}>
                  YouTube ID: {youtubeId}
                </strong>
                <br />
                <a
                  href={youtubeWatchUrl(youtubeId)}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  YouTube で確認 →
                </a>
              </div>
            </div>
          ) : null}
        </div>
        ) : null}

        <div className={`${"vform-row"} ${"vform-cols2"}`}>
          <div className={cx("vform-field", "vform-editableField")}>
            {showPermissionUi && permissionView ? (
              <PermissionFieldLabel
                label="使用楽曲"
                htmlFor="music"
                permission={permissionView.credits}
                required={
                  isOptionalFieldRequired("music") ||
                  isOptionalFieldRequired("music_reference_url")
                }
              />
            ) : (
              <label
                className={`${"vform-label"}${
                  isOptionalFieldRequired("music") ||
                  isOptionalFieldRequired("music_reference_url")
                    ? ` ${"vform-required"}`
                    : ""
                }`}
                htmlFor="music"
              >
                使用楽曲
              </label>
            )}
            <input
              id="music"
              name="music"
              type="text"
              defaultValue={initial.music}
              className="fn-input"
              placeholder="アーティスト名 - 曲名"
              maxLength={200}
              disabled={fieldDisabled("video.music")}
              aria-describedby={mergeDescribedBy(
                  showPermissionUi &&
                    permissionView &&
                    !permissionView.credits.editable
                  ? videoFormLockNoteId("credits-music")
                  : undefined,
              )}
            />
            <input
              id="music_reference_url"
              name="music_reference_url"
              type="url"
              defaultValue={initial.music_reference_url}
              className="fn-input"
              placeholder="楽曲リンク URL (任意, https://...)"
              maxLength={500}
              disabled={fieldDisabled("video.music_reference_url")}
              style={{ marginTop: 6 }}
              aria-describedby={
                showPermissionUi &&
                permissionView &&
                !permissionView.credits.editable
                  ? videoFormLockNoteId("credits-music")
                  : undefined
              }
            />
            {showPermissionUi && permissionView ? (
              <FieldLockNote
                id={videoFormLockNoteId("credits-music")}
                permission={permissionView.credits}
                unlockHint={resolvePermissionUnlockHint(
                  permissionView.credits,
                  permissionView,
                )}
              />
            ) : null}
            <p className={"vform-help"}>
              楽曲ページ・ニコニコ動画・YouTube などのリンクを入れると、視聴者に楽曲ページへ飛んでもらえます。
            </p>
          </div>
          <div className={cx("vform-field", "vform-editableField")}>
            {showPermissionUi && permissionView ? (
              <PermissionFieldLabel
                label="クレジット"
                htmlFor="credit"
                permission={permissionView.credits}
                required={isOptionalFieldRequired("credit")}
              />
            ) : (
              <label
                className={`${"vform-label"}${isOptionalFieldRequired("credit") ? ` ${"vform-required"}` : ""}`}
                htmlFor="credit"
              >
                クレジット
              </label>
            )}
            <input
              id="credit"
              name="credit"
              type="text"
              defaultValue={initial.credit}
              className="fn-input"
              placeholder="提供 / 作詞作曲 など"
              maxLength={200}
              disabled={fieldDisabled("video.credit")}
              aria-describedby={mergeDescribedBy(
                  showPermissionUi &&
                    permissionView &&
                    !permissionView.credits.editable
                  ? videoFormLockNoteId("credits-credit")
                  : undefined,
              )}
            />
            {showPermissionUi && permissionView ? (
              <FieldLockNote
                id={videoFormLockNoteId("credits-credit")}
                permission={permissionView.credits}
                unlockHint={resolvePermissionUnlockHint(
                  permissionView.credits,
                  permissionView,
                )}
              />
            ) : null}
          </div>
        </div>

        {eventOptions.length > 0 ? (
          <div className={cx("vform-field", "vform-editableField")}>
            {showPermissionUi && permissionView ? (
              <PermissionFieldLabel
                label="所属イベント"
                id="video-form-primary-event-label"
                permission={permissionView.primaryEvent}
              />
            ) : (
              <span id="video-form-primary-event-label" className={"vform-label"}>
                所属イベント
              </span>
            )}
            {showPermissionUi && permissionView ? (
              <FieldLockNote
                id={videoFormLockNoteId("primaryEvent")}
                permission={permissionView.primaryEvent}
                unlockHint={resolvePermissionUnlockHint(
                  permissionView.primaryEvent,
                  permissionView,
                )}
              />
            ) : null}
            <p className={"vform-help"}>
              この作品を関連付けるイベントを選択します。複数選択可。
              {slotId
                ? " 確保した枠のイベントは固定で含まれます。"
                : mode === "free"
                  ? " 枠なし投稿を受け付けるイベントのみ表示されます。"
                  : ""}
            </p>
            <input
              type="hidden"
              name="event_ids"
              value={selectedEventIds.join(",")}
            />
            <div
              className={"vform-eventOptionGrid"}
              role="group"
              aria-labelledby="video-form-primary-event-label"
              aria-describedby={
                showPermissionUi &&
                permissionView &&
                !permissionView.primaryEvent.editable
                  ? videoFormLockNoteId("primaryEvent")
                  : undefined
              }
            >
              {eventOptions.map((ev) => {
                const checked = selectedEventIds.includes(ev.id);
                const atEventLimit =
                  !checked && selectedEventIds.length >= MAX_ATOMIC_VIDEO_EVENTS;
                // slot モードでは slot.event_id を固定で含めるため、編集者でも外せない。
                const locked =
                  !canEditEvents ||
                  (mode === "slot" &&
                    !!initial.event_ids?.includes(ev.id) &&
                    initial.event_ids.length === 1);
                return (
                  <label
                    key={ev.id}
                    className={`${"vform-eventOption"} ${checked ? "vform-eventOptionChecked" : ""} ${locked ? "vform-eventOptionLocked" : ""}`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={locked || atEventLimit}
                      onChange={(e) => {
                        if (locked) return;
                        setSelectedEventIds((prev) =>
                          e.target.checked
                            ? Array.from(new Set([...prev, ev.id]))
                            : prev.filter((id) => id !== ev.id),
                        );
                      }}
                    />
                    <span style={{ flex: 1, minWidth: 0 }}>{ev.title}</span>
                    {locked ? (
                      <Icon
                        name="alert"
                        size={11}
                        aria-hidden
                        title="このイベントは固定です"
                      />
                    ) : null}
                  </label>
                );
              })}
            </div>
            <p className={"vform-help"}>
              所属イベントは最大{MAX_ATOMIC_VIDEO_EVENTS}件です。
            </p>
          </div>
        ) : null}

        {mode === "slot" ? (
          <input type="hidden" name="part" value={initial.part ?? ""} />
        ) : schedulingType === "slotted" ? (
          <div className={cx("vform-field", "vform-editableField")}>
            <label className={"vform-label"} htmlFor="part-readonly">
              部
            </label>
            <p className={"vform-help"}>
              枠に設定された部を自動で使用します。作品編集画面から変更できません。
            </p>
            <output id="part-readonly" className="fn-input">
              {initial.part?.trim() || "未設定"}
            </output>
            <input type="hidden" name="part" value={initial.part ?? ""} />
          </div>
        ) : availableParts.length > 0 ? (
          <div className={cx("vform-field", "vform-editableField")}>
            <label
              className={`${"vform-label"}${isOptionalFieldRequired("part") ? ` ${"vform-required"}` : ""}`}
              htmlFor="part"
            >
              部
            </label>
            <p className={"vform-help"}>
              所属イベントで設定された「部」(セクション/カテゴリ) から 1 つ選択します。
              {isOptionalFieldRequired("part")
                ? "イベント設定により必須です。"
                : "未選択でも投稿できます。"}
            </p>
            <select
              id="part"
              name="part"
              className="fn-select"
              value={selectedPart}
              onChange={(e) => {
                setSelectedPart(e.target.value);
                setDirty(true);
              }}
              disabled={fieldDisabled("video.part")}
              aria-describedby={
                showPermissionUi &&
                permissionView &&
                !permissionView.basics.editable
                  ? videoFormLockNoteId("basics")
                  : undefined
              }
            >
              <option value="">(未設定)</option>
              {availableParts.map((part) => (
                <option key={part} value={part}>
                  {part}
                </option>
              ))}
            </select>
          </div>
        ) : (
          // フォーム送信時に常に part キーを含めるため、UI 非表示時も hidden で送る。
          <input type="hidden" name="part" value="" />
        )}
      </section>
  );
}
