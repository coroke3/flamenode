// MIG-0714 B03: CURRENT descriptions section; parent owns state, permission derivation and form lifecycle.
import * as React from "react";
import { Icon } from "../../routes/ui/Icon.tsx";
import { cn as cx } from "../../lib/cn.ts";
import { resolvePermissionUnlockHint } from "../../lib/permissionUnlockHint.ts";
import { FieldLockNote } from "../permission/FieldLockNote.tsx";
import { PermissionBadge } from "../permission/PermissionBadge.tsx";
import { PermissionFieldLabel } from "../permission/PermissionFieldLabel.tsx";
import { YoutubeDescriptionPreview } from "./YoutubeDescriptionPreview.tsx";
import { CustomQuestionFields } from "./CustomQuestionFields.tsx";
import { MAX_ATOMIC_VIDEO_SOFTWARES } from "@flamenode/domain/video/atomicLimits";
import type { VideoMemberInput } from "../../lib/memberInput.ts";
import type { EntryCustomQuestion as CustomQuestion } from "@flamenode/contracts";
import type { StagePermissionFieldSettings } from "../../lib/videoFormSettings.ts";
import type { YoutubeDescriptionContext, YoutubeDescriptionDynamicVariableDefinition } from "../../lib/youtubeDescriptionTemplate.ts";
import { videoFormLockNoteId, mergeDescribedBy, customAnswerKey, customQuestionFieldId, acceptedCustomAnswerValues, type VideoFormInputContext, type VideoFormInitialValues, type EventOption } from "./videoFormFieldContracts.ts";

interface VideoFormDescriptionsSectionProps extends VideoFormInputContext {
  initial: VideoFormInitialValues;
  selectedDescriptionEvent: EventOption | null;
  youtubeDescriptionRenderContext: YoutubeDescriptionContext;
  members: VideoMemberInput[];
  youtubeDescriptionQuestionValues: { dynamicVariables: YoutubeDescriptionDynamicVariableDefinition[] };
  descriptionsDisabled: boolean;
  descriptionsPermissionState: "editable" | "locked";
  softwareSuggestions: string[];
  selectedStagePermissionFields: StagePermissionFieldSettings[];
  stageAnswers: Record<string, string>;
  setStageAnswers: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  selectedCustomQuestions: { event: EventOption; question: CustomQuestion }[];
  customAnswers: Record<string, string | string[]>;
  setCustomAnswers: React.Dispatch<React.SetStateAction<Record<string, string | string[]>>>;
  selectedEventIds: string[];
}

// The full section stays together to preserve native field order, lock notes and CURRENT handlers.
export function VideoFormDescriptionsSection({
  mode, showPermissionUi, permissionView, fieldDisabled, isOptionalFieldRequired, stepError, setDirty,
  initial, selectedDescriptionEvent, youtubeDescriptionRenderContext, members,
  youtubeDescriptionQuestionValues, descriptionsDisabled, descriptionsPermissionState,
  softwareSuggestions, selectedStagePermissionFields, stageAnswers, setStageAnswers,
  selectedCustomQuestions, customAnswers, setCustomAnswers, selectedEventIds,
}: VideoFormDescriptionsSectionProps): React.ReactElement {
  return (
    <>
      {selectedDescriptionEvent ? (
        <YoutubeDescriptionPreview
          template={selectedDescriptionEvent.youtube_description_template ?? ""}
          eventTitle={selectedDescriptionEvent.title}
          context={youtubeDescriptionRenderContext}
          members={members}
          dynamicVariables={youtubeDescriptionQuestionValues.dynamicVariables}
        />
      ) : null}

      <section
        className={cx(
          "vform-section",
          descriptionsDisabled && "vform-sectionDisabled",
        )}
        data-disabled={descriptionsDisabled || undefined}
        data-permission-state={
          showPermissionUi ? descriptionsPermissionState : undefined
        }
        aria-labelledby="video-form-section-descriptions-title"
        aria-describedby={
          descriptionsDisabled
            ? videoFormLockNoteId("section-descriptions")
            : undefined
        }
        tabIndex={
          showPermissionUi && descriptionsPermissionState === "locked"
            ? 0
            : undefined
        }
      >
        <h2 id="video-form-section-descriptions-title" className={"vform-sectionTitle"}>
          <Icon name="edit" size={14} aria-hidden /> 紹介文
          {showPermissionUi && permissionView ? (
            <PermissionBadge
              permission={permissionView.descriptions}
              className={"vform-sectionPermissionBadge"}
            />
          ) : descriptionsDisabled ? (
            <span className={"vform-sectionDisabledBadge"} aria-label="編集不可">
              <Icon name="alert" size={11} aria-hidden /> 編集権限なし
            </span>
          ) : null}
        </h2>
        {showPermissionUi && permissionView && descriptionsDisabled ? (
          <FieldLockNote
            id={videoFormLockNoteId("section-descriptions")}
            permission={permissionView.descriptions}
            unlockHint={resolvePermissionUnlockHint(
              permissionView.descriptions,
              permissionView,
            )}
          />
        ) : descriptionsDisabled && mode === "edit" ? (
          <p className={"vform-help"} role="status" id={videoFormLockNoteId("section-descriptions")}>
            この項目は、現在の一般作品権限では編集できません。
          </p>
        ) : null}

        <div className={cx("vform-field", "vform-editableField")}>
          {showPermissionUi && permissionView ? (
            <PermissionFieldLabel
              label="紹介コメント"
              htmlFor="intro_comment"
              permission={permissionView.descriptions}
              required={isOptionalFieldRequired("intro_comment")}
            />
          ) : (
            <label
              className={`${"vform-label"}${isOptionalFieldRequired("intro_comment") ? ` ${"vform-required"}` : ""}`}
              htmlFor="intro_comment"
            >
              紹介コメント
            </label>
          )}
          <textarea
            id="intro_comment"
            name="intro_comment"
            defaultValue={initial.intro_comment}
            className="fn-input"
            rows={3}
            maxLength={500}
            placeholder="作品の見どころを 1〜2 行で。"
            readOnly={fieldDisabled("descriptions.intro_comment")}
            aria-readonly={fieldDisabled("descriptions.intro_comment") || undefined}
            aria-describedby={
              descriptionsDisabled
                ? videoFormLockNoteId("section-descriptions")
                : undefined
            }
          />
        </div>

        <div className={cx("vform-field", "vform-editableField")}>
          <label
            className={`${"vform-label"}${isOptionalFieldRequired("highlights") ? ` ${"vform-required"}` : ""}`}
            htmlFor="highlights"
          >
            みどころ
          </label>
          <textarea
            id="highlights"
            name="highlights"
            defaultValue={initial.highlights}
            className="fn-input"
            rows={4}
            maxLength={1000}
            readOnly={fieldDisabled("descriptions.highlights")}
            aria-readonly={fieldDisabled("descriptions.highlights") || undefined}
            aria-describedby={
              descriptionsDisabled
                ? videoFormLockNoteId("section-descriptions")
                : undefined
            }
          />
        </div>

        <div className={cx("vform-field", "vform-editableField")}>
          <label
            className={`${"vform-label"}${isOptionalFieldRequired("production_story") ? ` ${"vform-required"}` : ""}`}
            htmlFor="production_story"
          >
            制作エピソード
          </label>
          <textarea
            id="production_story"
            name="production_story"
            defaultValue={initial.production_story}
            className="fn-input"
            rows={4}
            maxLength={1000}
            readOnly={fieldDisabled("descriptions.production_story")}
            aria-readonly={fieldDisabled("descriptions.production_story") || undefined}
            aria-describedby={
              descriptionsDisabled
                ? videoFormLockNoteId("section-descriptions")
                : undefined
            }
          />
        </div>

        <div className={cx("vform-field", "vform-editableField")}>
          <label
            className={`${"vform-label"}${isOptionalFieldRequired("used_software") ? ` ${"vform-required"}` : ""}`}
            htmlFor="used_software"
          >
            使用ソフト
          </label>
          <input
            id="used_software"
            name="used_software"
            type="text"
            defaultValue={initial.used_software}
            className="fn-input"
            maxLength={200}
            placeholder="AviUtl, After Effects, Vegas など"
            list="used-software-suggestions"
            disabled={fieldDisabled("descriptions.used_software")}
            aria-describedby={
              descriptionsDisabled
                ? videoFormLockNoteId("section-descriptions")
                : undefined
            }
          />
          <p className={"vform-help"}>
            カンマ区切りで最大{MAX_ATOMIC_VIDEO_SOFTWARES}件まで入力できます。
          </p>
          {softwareSuggestions.length > 0 ? (
            <p className={"vform-help"}>
              既存データから候補を出しています。該当しない場合はそのまま入力できます。
            </p>
          ) : null}
        </div>

        {selectedStagePermissionFields.map((question, index) => {
          const fieldId = `custom_question_${question.id}`;
          return (
            <div
              key={`${question.id}-${index}`}
              className={cx("vform-field", "vform-editableField")}
            >
              <input
                type="hidden"
                name="custom_question_answer_id"
                value={question.id}
              />
              <label
                className={`${"vform-label"} ${
                  question.required ? "vform-required" : ""
                }`}
                htmlFor={fieldId}
              >
                {question.label}
              </label>
              {question.description ? (
                <p className={"vform-help"}>{question.description}</p>
              ) : null}
              <textarea
                id={fieldId}
                name="custom_question_answer_value"
                value={stageAnswers[question.id] ?? ""}
                onChange={(event) => {
                  setStageAnswers((current) => ({
                    ...current,
                    [question.id]: event.target.value,
                  }));
                  setDirty(true);
                }}
                className="fn-input"
                rows={3}
                maxLength={1000}
                required={question.required}
                placeholder={question.placeholder}
                readOnly={fieldDisabled("descriptions.stage_permission")}
                aria-readonly={
                  fieldDisabled("descriptions.stage_permission") || undefined
                }
                aria-invalid={stepError?.fieldId === fieldId || undefined}
                aria-describedby={mergeDescribedBy(
                  stepError?.fieldId === fieldId
                    ? "wizard-validation-error"
                    : undefined,
                  descriptionsDisabled
                    ? videoFormLockNoteId("section-descriptions")
                    : undefined,
                )}
              />
            </div>
          );
        })}

        {selectedCustomQuestions.map(({ event, question }) => {
          const answerKey = customAnswerKey(event.id, question.question_key);
          const fieldId = customQuestionFieldId(event.id, question.question_key);
          const name = `custom_answer:${event.id}:${question.question_key}`;
          const values = acceptedCustomAnswerValues(
            question,
            customAnswers[answerKey],
          );
          const maxLength =
            question.max_length != null && question.max_length > 0
              ? question.max_length
              : question.type === "text"
                ? 200
                : 1000;
          const disabled = fieldDisabled("descriptions.custom_answers");
          const describedBy = mergeDescribedBy(
            stepError?.fieldId === fieldId
              ? "wizard-validation-error"
              : undefined,
            descriptionsDisabled
              ? videoFormLockNoteId("section-descriptions")
              : undefined,
          );
          const updateAnswer = (next: string | string[]) => {
            setCustomAnswers((current) => ({ ...current, [answerKey]: next }));
            setDirty(true);
          };
          const label =
            selectedEventIds.length > 1
              ? `${event.title}: ${question.label}`
              : question.label;

          return (
            <div
              key={`${event.id}:${question.id}`}
              className={cx("vform-field", "vform-editableField")}
            >
              <label
                className={`${"vform-label"} ${question.required ? "vform-required" : ""}`}
                htmlFor={fieldId}
              >
                {label}
              </label>
              {question.description ? (
                <p className={"vform-help"}>{question.description}</p>
              ) : null}
              <CustomQuestionFields
                id={fieldId}
                name={name}
                type={question.type}
                options={question.options}
                values={values}
                placeholder={question.placeholder}
                maxLength={maxLength}
                required={question.required}
                disabled={disabled}
                describedBy={describedBy}
                invalid={stepError?.fieldId === fieldId}
                onChange={updateAnswer}
              />
            </div>
          );
        })}

        <div className={cx("vform-field", "vform-editableField")}>
          <label
            className={`${"vform-label"}${isOptionalFieldRequired("closing_comment") ? ` ${"vform-required"}` : ""}`}
            htmlFor="closing_comment"
          >
            あとがき
          </label>
          <textarea
            id="closing_comment"
            name="closing_comment"
            defaultValue={initial.closing_comment}
            className="fn-input"
            rows={3}
            maxLength={500}
            readOnly={fieldDisabled("descriptions.closing_comment")}
            aria-readonly={fieldDisabled("descriptions.closing_comment") || undefined}
            aria-describedby={
              descriptionsDisabled
                ? videoFormLockNoteId("section-descriptions")
                : undefined
            }
          />
        </div>
      </section>
      </>
  );
}
