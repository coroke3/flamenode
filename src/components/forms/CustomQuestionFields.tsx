"use client";

import * as React from "react";
import type { CustomQuestionType } from "@/lib/video/customQuestions";
import { questionTypeNeedsOptions } from "@/lib/video/customQuestions";
import styles from "./CustomQuestionFields.module.css";

export interface CustomQuestionFieldsProps {
  id: string;
  name?: string;
  type: CustomQuestionType;
  options: readonly string[];
  values: readonly string[];
  placeholder?: string | null;
  maxLength?: number;
  required?: boolean;
  disabled?: boolean;
  describedBy?: string;
  invalid?: boolean;
  preview?: boolean;
  onChange?: (next: string | string[]) => void;
}

export function CustomQuestionFields({
  id,
  name,
  type,
  options,
  values,
  placeholder,
  maxLength,
  required = false,
  disabled = false,
  describedBy,
  invalid,
  preview = false,
  onChange,
}: CustomQuestionFieldsProps): React.ReactElement {
  const textValue = values[0] ?? "";
  const choiceOptions = options.map((option) => option.trim()).filter(Boolean);
  const selectedValue = choiceOptions.includes(textValue) ? textValue : "";
  const fieldName = preview ? undefined : name;
  const update = (next: string | string[]) => {
    if (preview) return;
    onChange?.(next);
  };

  if (type === "textarea") {
    return (
      <textarea
        id={id}
        name={fieldName}
        value={textValue}
        onChange={(event) => update(event.target.value)}
        className="fn-input"
        rows={3}
        maxLength={maxLength}
        required={required && !preview}
        placeholder={placeholder ?? undefined}
        disabled={disabled}
        tabIndex={preview ? -1 : undefined}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
      />
    );
  }

  if (questionTypeNeedsOptions(type)) {
    if (choiceOptions.length === 0) {
      return (
        <p className="fn-hint">
          {preview
            ? "選択肢を追加すると、ここに投稿時の入力が表示されます。"
            : "この質問の選択肢がまだ設定されていません。"}
        </p>
      );
    }

    if (type === "select") {
      return (
        <select
          id={id}
          name={fieldName}
          value={selectedValue}
          onChange={(event) => update(event.target.value)}
          className="fn-select"
          required={required && !preview}
          disabled={disabled}
          tabIndex={preview ? -1 : undefined}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
        >
          <option value="">選択してください</option>
          {choiceOptions.map((option, optionIndex) => (
            <option key={`${optionIndex}:${option}`} value={option}>
              {option}
            </option>
          ))}
        </select>
      );
    }

    if (type === "radio") {
      return (
        <fieldset
          id={`${id}_group`}
          className={styles.customChoiceGroup}
          role="radiogroup"
          disabled={disabled}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
        >
          {choiceOptions.map((option, optionIndex) => (
            <label key={`${optionIndex}:${option}`} className={styles.customChoiceOption}>
              <input
                id={optionIndex === 0 ? id : `${id}_${optionIndex}`}
                type="radio"
                name={fieldName}
                value={option}
                checked={selectedValue === option}
                onChange={(event) => update(event.target.value)}
                required={required && !preview}
                disabled={disabled}
                tabIndex={preview ? -1 : undefined}
              />
              <span>{option}</span>
            </label>
          ))}
        </fieldset>
      );
    }

    if (type === "checkbox") {
      return (
        <fieldset
          id={`${id}_group`}
          className={styles.customChoiceGroup}
          disabled={disabled}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
        >
          {choiceOptions.map((option, optionIndex) => (
            <label key={`${optionIndex}:${option}`} className={styles.customChoiceOption}>
              <input
                id={optionIndex === 0 ? id : `${id}_${optionIndex}`}
                type="checkbox"
                name={fieldName}
                value={option}
                checked={values.includes(option)}
                onChange={(event) => {
                  const current = values.filter((value) => choiceOptions.includes(value));
                  const next = event.target.checked
                    ? Array.from(new Set([...current, option]))
                    : current.filter((value) => value !== option);
                  update(next);
                }}
                // checkbox の required を各選択肢へ付けると全選択必須になるため、
                // 必須判定は VideoForm の validateRequiredCustomQuestions で行う。
                required={false}
                disabled={disabled}
                tabIndex={preview ? -1 : undefined}
              />
              <span>{option}</span>
            </label>
          ))}
        </fieldset>
      );
    }

    return (
      <p className="fn-hint">
        {preview
          ? "選択肢を追加すると、ここに投稿時の入力が表示されます。"
          : "この質問の選択肢がまだ設定されていません。"}
      </p>
    );
  }

  return (
    <input
      id={id}
      name={fieldName}
      type="text"
      value={textValue}
      onChange={(event) => update(event.target.value)}
      className="fn-input"
      maxLength={maxLength}
      required={required && !preview}
      placeholder={placeholder ?? undefined}
      disabled={disabled}
      tabIndex={preview ? -1 : undefined}
      aria-invalid={invalid || undefined}
      aria-describedby={describedBy}
    />
  );
}
