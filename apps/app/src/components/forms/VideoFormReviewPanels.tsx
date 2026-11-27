// MIG-0714 B03R: CURRENT confirmation and live preview; wizard navigation/validation remain in the parent.
import * as React from "react";
import type { EntryCustomQuestion } from "@flamenode/contracts";
import { Icon } from "../../routes/ui/Icon.tsx";
import { cn as cx } from "../../lib/cn.ts";
import { youtubeThumbUrl } from "../../lib/youtubeId.ts";
import type { StagePermissionFieldSettings } from "../../lib/videoFormSettings.ts";
import type { VideoFormMode } from "./videoSubmitAdapter.ts";
import { acceptedCustomAnswerValues, customAnswerKey, type EventOption, type WizardStepKey } from "./videoFormFieldContracts.ts";

interface VideoFormReviewSummary {
  normalizedActiveXId: string;
  normalizedInitialXId: string;
  displayNamePreview: string;
  titlePreview: string;
  selectedEventLabels: string[];
  isCollab: boolean;
  memberCount: number;
  incompleteRequiredStageQuestionCount: number;
  selectedCustomQuestions: { event: EventOption; question: EntryCustomQuestion }[];
  youtubeId: string | null;
}

interface VideoFormConfirmationSectionProps extends VideoFormReviewSummary {
  mode: VideoFormMode;
  selectedEventIds: string[];
  customAnswers: Record<string, string | string[]>;
  jumpToWizardStep: (step: WizardStepKey) => void;
}

interface VideoFormSidePreviewProps extends VideoFormReviewSummary {
  isWizard: boolean;
  showSidePreview: boolean;
  sidePreviewTitle: string;
  sidePreviewName: string;
  youtubePreviewOk: boolean;
  youtubePreviewPending: boolean;
  youtubePreviewOptional: boolean;
  selectedStagePermissionFields: StagePermissionFieldSettings[];
  incompleteRequiredCustomQuestionCount: number;
}

// Keep the complete review summary together, including CURRENT answer filtering and edit destinations.
export function VideoFormConfirmationSection({
  normalizedActiveXId, normalizedInitialXId, displayNamePreview, titlePreview, selectedEventLabels,
  isCollab, memberCount, incompleteRequiredStageQuestionCount, selectedCustomQuestions, youtubeId,
  mode, selectedEventIds, customAnswers, jumpToWizardStep,
}: VideoFormConfirmationSectionProps): React.ReactElement {
  return (
    <section className={"vform-section"}>
            <h2 className={"vform-sectionTitle"}>
              <Icon name="check" size={14} aria-hidden /> 確認・送信
            </h2>
            <div className={"vform-confirmSummary"}>
              <p className={"vform-help"}>
                入力内容を確認して、問題なければ提出してください。
              </p>
              <div className={"vform-confirmSummaryGrid"}>
                <div className={"vform-confirmGroups"}>
                  <section className={"vform-confirmGroup"}>
                    <div className={"vform-confirmGroupHead"}>
                      <h3>投稿者情報</h3>
                      <button
                        type="button"
                        className={"vform-confirmEditButton"}
                        onClick={() =>
                          jumpToWizardStep("submitter")
                        }
                      >
                        修正
                      </button>
                    </div>

                    <dl className={"vform-confirmSummaryList"}>
                      <div>
                        <dt>X ID</dt>
                        <dd>
                          @
                          {normalizedActiveXId ||
                            normalizedInitialXId ||
                            "未設定"}
                        </dd>
                      </div>
                      <div>
                        <dt>表示名</dt>
                        <dd>
                          {displayNamePreview.trim() || "未入力"}
                        </dd>
                      </div>
                    </dl>
                  </section>

                  <section className={"vform-confirmGroup"}>
                    <div className={"vform-confirmGroupHead"}>
                      <h3>作品情報</h3>
                      <button
                        type="button"
                        className={"vform-confirmEditButton"}
                        onClick={() => jumpToWizardStep("work")}
                      >
                        修正
                      </button>
                    </div>

                    <dl className={"vform-confirmSummaryList"}>
                      <div>
                        <dt>タイトル</dt>
                        <dd>{titlePreview.trim() || "未入力"}</dd>
                      </div>
                      <div>
                        <dt>イベント</dt>
                        <dd>
                          {selectedEventLabels.length > 0
                            ? selectedEventLabels.join(" / ")
                            : "未選択"}
                        </dd>
                      </div>
                      <div>
                        <dt>合作</dt>
                        <dd>
                          {isCollab
                            ? `${memberCount}人の合作`
                            : "個人作品"}
                        </dd>
                      </div>
                      <div>
                        <dt>追加質問</dt>
                        <dd>
                          {incompleteRequiredStageQuestionCount > 0
                            ? `未入力 ${incompleteRequiredStageQuestionCount}件`
                            : "入力済み"}
                        </dd>
                      </div>
                      {selectedCustomQuestions.map(({ event, question }) => {
                        const values = acceptedCustomAnswerValues(
                          question,
                          customAnswers[
                            customAnswerKey(event.id, question.question_key)
                          ],
                        );
                        const label =
                          selectedEventIds.length > 1
                            ? `${event.title}: ${question.label}`
                            : question.label;
                        return (
                          <div key={`${event.id}:${question.id}`}>
                            <dt>
                              {label}
                              {question.required ? " *" : ""}
                            </dt>
                            <dd>
                              {values.length > 0 ? values.join("、") : "未入力"}
                            </dd>
                          </div>
                        );
                      })}
                    </dl>
                  </section>

                  <section className={"vform-confirmGroup"}>
                    <div className={"vform-confirmGroupHead"}>
                      <h3>YouTube</h3>
                      <button
                        type="button"
                        className={"vform-confirmEditButton"}
                        onClick={() =>
                          jumpToWizardStep("youtube")
                        }
                      >
                        修正
                      </button>
                    </div>

                    <div className={"vform-confirmYoutube"}>
                      <dl className={"vform-confirmSummaryList"}>
                        <div>
                          <dt>動画ID</dt>
                          <dd>
                            {youtubeId ??
                              (mode === "slot"
                                ? "未入力（後から追加可）"
                                : "未入力")}
                          </dd>
                        </div>
                      </dl>

                      {youtubeId ? (
                        <div className={"vform-confirmThumb"}>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={youtubeThumbUrl(
                              youtubeId,
                              "hqdefault",
                            )}
                            alt=""
                          />
                        </div>
                      ) : null}
                    </div>
                  </section>
                </div>
              </div>
            </div>
          </section>
  );
}

// The parent derives these statuses; this panel only renders the existing checklist and visibility.
export function VideoFormSidePreview({
  normalizedActiveXId, normalizedInitialXId, displayNamePreview, titlePreview, selectedEventLabels,
  isCollab, memberCount, incompleteRequiredStageQuestionCount, selectedCustomQuestions, youtubeId,
  isWizard, showSidePreview, sidePreviewTitle, sidePreviewName, youtubePreviewOk,
  youtubePreviewPending, youtubePreviewOptional, selectedStagePermissionFields,
  incompleteRequiredCustomQuestionCount,
}: VideoFormSidePreviewProps): React.ReactElement {
  return (
    <aside
        className={cx(
          "vform-sidePreview",
          isWizard && !showSidePreview && "vform-sidePreviewHidden",
        )}
        aria-label="投稿内容プレビュー"
        hidden={isWizard ? !showSidePreview : undefined}
      >
        <span className={"vform-sideEyebrow"}>live preview</span>
        <div className={"vform-previewCard"}>
          <div className={"vform-previewVisual"}>
            {youtubeId ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img src={youtubeThumbUrl(youtubeId, "hqdefault")} alt="" />
            ) : null}
            <span className={"vform-previewCode"}>
              {youtubeId ? `yt / ${youtubeId}` : "youtube url"}
            </span>
            <span className={"vform-previewPlay"} aria-hidden>
              <Icon name="play" size={18} />
            </span>
          </div>
          <div className={"vform-previewInfo"}>
            <h3>{sidePreviewTitle}</h3>
            <p>{sidePreviewName}</p>
            <span>{isCollab ? "合作作品" : "個人作品"}</span>
          </div>
        </div>
        <dl className={"vform-previewChecklist"}>
          <PreviewCheck
            ok={youtubePreviewOk}
            pending={youtubePreviewPending}
            label={
              youtubePreviewOptional
                ? "YouTube URL (任意)"
                : "YouTube URL"
            }
          />
          <PreviewCheck ok={Boolean(titlePreview.trim())} label="作品タイトル" />
          <PreviewCheck ok={Boolean(displayNamePreview.trim())} label="表示名" />
          <PreviewCheck
            ok={incompleteRequiredStageQuestionCount === 0}
            label={
              incompleteRequiredStageQuestionCount > 0
                ? `追加質問 ${incompleteRequiredStageQuestionCount} 件は入力必須`
                : selectedStagePermissionFields.length > 0
                  ? `追加質問 ${selectedStagePermissionFields.length} 件は任意`
                  : "追加質問なし"
            }
            pending={incompleteRequiredStageQuestionCount > 0}
          />
          {selectedCustomQuestions.length > 0 ? (
            <PreviewCheck
              ok={incompleteRequiredCustomQuestionCount === 0}
              label={
                incompleteRequiredCustomQuestionCount > 0
                  ? `カスタム質問 ${incompleteRequiredCustomQuestionCount} 件は入力必須`
                  : `カスタム質問 ${selectedCustomQuestions.length} 件`
              }
              pending={incompleteRequiredCustomQuestionCount > 0}
            />
          ) : null}
          <PreviewCheck
            ok={!isCollab || memberCount > 0}
            label={
              isCollab
                ? `合作メンバー ${memberCount}人`
                : "メンバー入力なし"
            }
            pending={isCollab && memberCount === 0}
          />
        </dl>
        <div className={"vform-saveId"}>
          <span className={"vform-sideEyebrow"}>保存名義 / active X ID</span>
          <div className={"vform-saveIdRow"}>
            <span className={"vform-saveIdAvatar"}>
              {sidePreviewName.slice(0, 1).toLowerCase()}
            </span>
            <span>
              <strong>{sidePreviewName}</strong>
              <small>
                @{normalizedActiveXId || normalizedInitialXId || "not-selected"}
              </small>
            </span>
          </div>
        </div>
        {selectedEventLabels.length > 0 ? (
          <div className={"vform-previewEvents"}>
            <span className={"vform-sideEyebrow"}>events</span>
            {selectedEventLabels.slice(0, 3).map((label) => (
              <span key={label}>{label}</span>
            ))}
            {selectedEventLabels.length > 3 ? (
              <span>ほか {selectedEventLabels.length - 3} 件</span>
            ) : null}
          </div>
        ) : null}
      </aside>
  );
}

function PreviewCheck({
  ok,
  pending = false,
  label,
}: {
  ok: boolean;
  pending?: boolean;
  label: string;
}): React.ReactElement {
  const mark = ok ? "✓" : pending ? "!" : "·";
  return (
    <div className={ok ? "vform-checkOk" : pending ? "vform-checkPending" : "vform-checkTodo"}>
      <dt>{mark}</dt>
      <dd>{label}</dd>
    </div>
  );
}
