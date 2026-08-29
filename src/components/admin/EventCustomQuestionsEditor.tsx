"use client";

import * as React from "react";
import { Icon } from "@/components/ui/Icon";
import { CustomQuestionFields } from "@/components/forms/CustomQuestionFields";
import styles from "./EventCustomQuestionsEditor.module.css";
import {
  GENERAL_CUSTOM_QUESTION_TYPE_LABELS,
  createEmptyGeneralCustomQuestion,
  type EventGeneralCustomQuestionDraft,
} from "@/lib/event/generalCustomQuestionDraft";
import {
  MAX_QUESTION_OPTIONS,
  OPTION_MAX_LEN,
  normalizeOptionList,
  questionTypeNeedsOptions,
  type CustomQuestionType,
} from "@/lib/video/customQuestions";

const TYPE_OPTIONS = Object.entries(GENERAL_CUSTOM_QUESTION_TYPE_LABELS) as Array<
  [CustomQuestionType, string]
>;

export interface EventCustomQuestionsEditorProps {
  questions: EventGeneralCustomQuestionDraft[];
  onChange: (next: EventGeneralCustomQuestionDraft[]) => void;
  disabled: boolean;
  maxQuestions?: number;
}

function normalizeOptions(options: string[]): string[] {
  return normalizeOptionList(options);
}

function optionsForType(
  type: CustomQuestionType,
  current: string[],
): string[] {
  if (!questionTypeNeedsOptions(type)) return current;
  return current.length > 0 ? current : ["", ""];
}

export function EventCustomQuestionsEditor({
  questions,
  onChange,
  disabled,
  maxQuestions = 4,
}: EventCustomQuestionsEditorProps): React.ReactElement {
  const atMax = questions.length >= maxQuestions;

  const updateQuestion = (
    clientId: string,
    patch: Partial<EventGeneralCustomQuestionDraft>,
  ) => {
    onChange(
      questions.map((question) =>
        question.clientId === clientId ? { ...question, ...patch } : question,
      ),
    );
  };

  const removeQuestion = (clientId: string) => {
    onChange(questions.filter((question) => question.clientId !== clientId));
  };

  const moveQuestion = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= questions.length) return;
    const next = [...questions];
    const [item] = next.splice(index, 1);
    next.splice(target, 0, item);
    onChange(next);
  };

  const duplicateQuestion = (clientId: string) => {
    if (atMax) return;
    const source = questions.find((question) => question.clientId === clientId);
    if (!source) return;
    const copy = createEmptyGeneralCustomQuestion(questions.length);
    onChange([
      ...questions,
      {
        ...copy,
        label: source.label,
        description: source.description,
        type: source.type,
        required: source.required,
        options: [...source.options],
        placeholder: source.placeholder,
        enabled: source.enabled,
      },
    ]);
  };

  const moveOption = (clientId: string, optionIndex: number, delta: number) => {
    const source = questions.find((question) => question.clientId === clientId);
    if (!source) return;
    const target = optionIndex + delta;
    if (target < 0 || target >= source.options.length) return;
    const next = [...source.options];
    const [item] = next.splice(optionIndex, 1);
    if (item == null) return;
    next.splice(target, 0, item);
    updateQuestion(clientId, { options: next });
  };

  const addQuestion = () => {
    if (atMax) return;
    onChange([...questions, createEmptyGeneralCustomQuestion(questions.length)]);
  };

  return (
    <>
      <input type="hidden" name="general_custom_questions_present" value="1" />
      <p className="fn-hint">
        入力形式を選ぶと、投稿フォームの見た目が下のプレビューと一致します。投稿時に保存できる回答は4件までです。
      </p>
      <div className={styles.questionList}>
        {questions.map((question, index) => {
          const showOptions = questionTypeNeedsOptions(question.type);
          const optionsForSubmit = normalizeOptions(question.options);

          return (
            <article key={question.clientId} className={`fn-card ${styles.questionCard}`}>
              <input
                type="hidden"
                name="general_custom_question_key"
                value={question.question_key}
              />
              <input
                type="hidden"
                name="general_custom_question_enabled"
                value={question.enabled ? "1" : "0"}
              />
              <input
                type="hidden"
                name="general_custom_question_required"
                value={question.required ? "1" : "0"}
              />
              <input
                type="hidden"
                name="general_custom_question_type"
                value={question.type}
              />
              <input
                type="hidden"
                name="general_custom_question_options"
                value={optionsForSubmit.join("\n")}
              />
              <header className={styles.questionHeader}>
                <strong>質問 {index + 1}</strong>
                <div className={styles.questionControls}>
                  <label>
                    <input
                      type="checkbox"
                      checked={question.enabled}
                      disabled={disabled}
                      onChange={(event) =>
                        updateQuestion(question.clientId, {
                          enabled: event.target.checked,
                        })
                      }
                    />{" "}
                    表示
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={question.required}
                      disabled={disabled}
                      onChange={(event) =>
                        updateQuestion(question.clientId, {
                          required: event.target.checked,
                        })
                      }
                    />{" "}
                    必須
                  </label>
                  <button
                    type="button"
                    className="fn-btn fn-btn-ghost fn-btn-sm"
                    disabled={disabled || index === 0}
                    onClick={() => moveQuestion(index, -1)}
                  >
                    <Icon name="chevron-up" size={12} aria-hidden /> 上へ
                  </button>
                  <button
                    type="button"
                    className="fn-btn fn-btn-ghost fn-btn-sm"
                    disabled={disabled || index === questions.length - 1}
                    onClick={() => moveQuestion(index, 1)}
                  >
                    <Icon name="chevron-down" size={12} aria-hidden /> 下へ
                  </button>
                  <button
                    type="button"
                    className="fn-btn fn-btn-ghost fn-btn-sm"
                    disabled={disabled || atMax}
                    onClick={() => duplicateQuestion(question.clientId)}
                  >
                    <Icon name="copy" size={12} aria-hidden /> 複製
                  </button>
                  <button
                    type="button"
                    className="fn-btn fn-btn-ghost fn-btn-sm"
                    disabled={disabled}
                    onClick={() => removeQuestion(question.clientId)}
                  >
                    <Icon name="trash" size={12} aria-hidden /> 削除
                  </button>
                </div>
              </header>
              <div>
                <span className="fn-label" id={`general-question-type-${question.clientId}`}>
                  入力形式
                </span>
                <div
                  className={styles.typePicker}
                  role="group"
                  aria-labelledby={`general-question-type-${question.clientId}`}
                >
                  {TYPE_OPTIONS.map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      className={`fn-btn fn-btn-ghost fn-btn-sm ${styles.typeButton}`}
                      aria-pressed={question.type === value}
                      disabled={disabled}
                      onClick={() =>
                        updateQuestion(question.clientId, {
                          type: value,
                          options: optionsForType(value, question.options),
                        })
                      }
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="fn-label">質問名</label>
                <input
                  name="general_custom_question_label"
                  value={question.label}
                  readOnly={disabled}
                  className="fn-input"
                  maxLength={120}
                  required={!disabled}
                  onChange={(event) =>
                    updateQuestion(question.clientId, { label: event.target.value })
                  }
                />
              </div>
              <div>
                <label className="fn-label">補足文</label>
                <textarea
                  name="general_custom_question_description"
                  value={question.description}
                  readOnly={disabled}
                  className="fn-input"
                  maxLength={1000}
                  onChange={(event) =>
                    updateQuestion(question.clientId, {
                      description: event.target.value,
                    })
                  }
                />
              </div>
              <div>
                <label className="fn-label">入力例</label>
                <input
                  name="general_custom_question_placeholder"
                  value={question.placeholder}
                  readOnly={disabled}
                  className="fn-input"
                  maxLength={500}
                  onChange={(event) =>
                    updateQuestion(question.clientId, {
                      placeholder: event.target.value,
                    })
                  }
                />
              </div>
              {showOptions ? (
                <div className={styles.optionsEditor}>
                  <label className="fn-label">選択肢</label>
                  {question.options.length === 0 ? (
                    <p className="fn-hint">選択肢を追加してください。</p>
                  ) : null}
                  {question.options.map((option, optionIndex) => (
                    <div
                      key={`${question.clientId}-option-${optionIndex}`}
                      className={styles.optionRow}
                    >
                      <input
                        value={option}
                        readOnly={disabled}
                        className="fn-input"
                        maxLength={OPTION_MAX_LEN}
                        placeholder={`選択肢 ${optionIndex + 1}`}
                        onChange={(event) => {
                          const next = [...question.options];
                          next[optionIndex] = event.target.value;
                          updateQuestion(question.clientId, { options: next });
                        }}
                      />
                      <div className={styles.optionRowControls}>
                        <button
                          type="button"
                          className="fn-btn fn-btn-ghost fn-btn-sm"
                          disabled={disabled || optionIndex === 0}
                          onClick={() =>
                            moveOption(question.clientId, optionIndex, -1)
                          }
                        >
                          <Icon name="chevron-up" size={12} aria-hidden /> 上へ
                        </button>
                        <button
                          type="button"
                          className="fn-btn fn-btn-ghost fn-btn-sm"
                          disabled={
                            disabled || optionIndex === question.options.length - 1
                          }
                          onClick={() =>
                            moveOption(question.clientId, optionIndex, 1)
                          }
                        >
                          <Icon name="chevron-down" size={12} aria-hidden /> 下へ
                        </button>
                        <button
                          type="button"
                          className="fn-btn fn-btn-ghost fn-btn-sm"
                          disabled={disabled || question.options.length <= 1}
                          onClick={() => {
                            const next = question.options.filter(
                              (_, itemIndex) => itemIndex !== optionIndex,
                            );
                            updateQuestion(question.clientId, { options: next });
                          }}
                        >
                          <Icon name="trash" size={12} aria-hidden /> 削除
                        </button>
                      </div>
                    </div>
                  ))}
                  <button
                    type="button"
                    className="fn-btn fn-btn-ghost fn-btn-sm"
                    disabled={disabled || question.options.length >= MAX_QUESTION_OPTIONS}
                    onClick={() =>
                      updateQuestion(question.clientId, {
                        options: [...question.options, ""],
                      })
                    }
                  >
                    <Icon name="plus" size={13} aria-hidden /> 選択肢を追加
                  </button>
                </div>
              ) : null}
              <div className={styles.preview}>
                <p className="fn-label">投稿時の見え方</p>
                <CustomQuestionFields
                  id={`preview_${question.clientId}`}
                  type={question.type}
                  options={optionsForSubmit}
                  values={[]}
                  placeholder={question.placeholder}
                  disabled
                  preview
                />
              </div>
            </article>
          );
        })}
      </div>
      <button
        type="button"
        className="fn-btn fn-btn-ghost"
        disabled={disabled || atMax}
        onClick={addQuestion}
      >
        <Icon name="plus" size={13} aria-hidden /> カスタム質問を追加
      </button>
      {atMax ? (
        <p className="fn-hint">カスタム質問は最大{maxQuestions}件です</p>
      ) : null}
    </>
  );
}
