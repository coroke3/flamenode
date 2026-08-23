"use client";

import * as React from "react";
import styles from "./YoutubeDescriptionPreview.module.css";
import {
  YOUTUBE_DESCRIPTION_VARIABLES,
  renderYoutubeDescriptionTemplate,
  type YoutubeDescriptionContext,
  type YoutubeDescriptionLoopMember,
  type YoutubeDescriptionVariableKey,
} from "@/lib/event/youtubeDescriptionTemplate";

export interface YoutubeDescriptionPreviewProps {
  template: string;
  eventTitle: string;
  context: YoutubeDescriptionContext;
  /** {{#members}} ループ用の生メンバー行。未指定時はループが空で出力される。 */
  members?: readonly YoutubeDescriptionLoopMember[];
}

const VARIABLE_LABELS = new Map<YoutubeDescriptionVariableKey, string>(
  YOUTUBE_DESCRIPTION_VARIABLES.map((variable) => [variable.key, variable.label]),
);

function variableLabel(key: YoutubeDescriptionVariableKey): string {
  return VARIABLE_LABELS.get(key) ?? key;
}

function hasValue(value: unknown): boolean {
  return value != null && String(value).trim().length > 0;
}

async function copyText(text: string, textarea: HTMLTextAreaElement | null): Promise<void> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Permission-denied browsers can still support the selection fallback.
    }
  }
  if (!textarea) throw new Error("clipboard_unavailable");
  textarea.focus();
  textarea.select();
  if (!document.execCommand("copy")) throw new Error("clipboard_unavailable");
}

export function YoutubeDescriptionPreview({
  template,
  eventTitle,
  context,
  members,
}: YoutubeDescriptionPreviewProps): React.ReactElement {
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  const manualBaseTextRef = React.useRef("");
  const [copyState, setCopyState] = React.useState<"idle" | "copied" | "error">("idle");
  const [draftMode, setDraftMode] = React.useState<"auto" | "manual">("auto");
  const rendered = React.useMemo(
    () => renderYoutubeDescriptionTemplate(template, context, { members }),
    [context, members, template],
  );
  const [draftText, setDraftText] = React.useState(rendered.text);

  React.useEffect(() => {
    if (draftMode === "auto") {
      setDraftText(rendered.text);
      manualBaseTextRef.current = rendered.text;
    }
    setCopyState("idle");
  }, [draftMode, rendered.text]);

  const missingVariables = React.useMemo(
    () => rendered.usedVariables.filter((key) => !hasValue(context[key])),
    [context, rendered.usedVariables],
  );
  const sourceChangedWhileEditing =
    draftMode === "manual" && manualBaseTextRef.current !== rendered.text;

  const handleCopy = async () => {
    if (!draftText) return;
    setCopyState("idle");
    try {
      await copyText(draftText, textareaRef.current);
      setCopyState("copied");
    } catch {
      setCopyState("error");
    }
  };

  const restoreAuto = () => {
    setDraftMode("auto");
    setDraftText(rendered.text);
    manualBaseTextRef.current = rendered.text;
    setCopyState("idle");
  };

  const refreshManualFromSource = () => {
    setDraftMode("manual");
    setDraftText(rendered.text);
    manualBaseTextRef.current = rendered.text;
    setCopyState("idle");
  };

  return (
    <section className={styles.panel} aria-labelledby="youtube-description-preview-title">
      <div className={styles.head}>
        <div>
          <div className={styles.titleRow}>
            <h3 id="youtube-description-preview-title" className={styles.title}>
              YouTube概要欄（コピー用）
            </h3>
            <span
              className={styles.modeBadge}
              data-mode={draftMode}
              aria-label={draftMode === "auto" ? "自動生成モード" : "手動調整モード"}
            >
              {draftMode === "auto" ? "自動生成" : "手動調整中"}
            </span>
          </div>
          <p className={styles.event}>イベントテンプレート: {eventTitle}</p>
        </div>
        <button
          type="button"
          className={`fn-btn fn-btn-primary fn-btn-sm ${styles.copyButton}`}
          onClick={handleCopy}
          disabled={!draftText}
        >
          {copyState === "copied" ? "コピーしました" : "概要欄をコピー"}
        </button>
      </div>

      {missingVariables.length > 0 ? (
        <div className={styles.warning} role="status">
          <strong>テンプレートで使う情報に未入力があります。</strong>
          <ul className={styles.warningList}>
            {missingVariables.map((key) => (
              <li key={key}>{variableLabel(key)}が未入力です。</li>
            ))}
          </ul>
        </div>
      ) : null}

      {sourceChangedWhileEditing ? (
        <div className={styles.warningBox} role="status">
          <div>
            <strong>作品情報が更新されています。</strong>
            <p>
              手動調整した概要欄は保持しています。最新データへ置き換える場合だけ更新してください。
            </p>
          </div>
          <button
            type="button"
            className="fn-btn fn-btn-ghost fn-btn-sm"
            onClick={refreshManualFromSource}
          >
            最新の自動生成を反映
          </button>
        </div>
      ) : null}

      <textarea
        ref={textareaRef}
        className={`fn-input ${styles.textarea}`}
        value={draftText}
        onChange={(event) => {
          if (draftMode !== "manual") {
            manualBaseTextRef.current = rendered.text;
            setDraftMode("manual");
          }
          setDraftText(event.target.value);
          setCopyState("idle");
        }}
        aria-label={`${eventTitle} のYouTube概要欄`}
      />
      <div className={styles.footer}>
        <p className={styles.hint}>
          {draftMode === "manual"
            ? "手動調整中です。作品情報が変わっても自動では上書きしません。ここでの調整は作品データには保存されません。"
            : "入力中の作品情報から自動生成しています。ここでの最終調整は作品データには保存されません。"}
        </p>
        {draftMode === "manual" ? (
          <button
            type="button"
            className="fn-btn fn-btn-ghost fn-btn-sm"
            onClick={restoreAuto}
          >
            自動生成に戻す
          </button>
        ) : null}
      </div>

      {rendered.unknownVariables.length > 0 ? (
        <p className={styles.warning} role="alert">
          テンプレートに未登録の変数があります。空欄として出力しました: {rendered.unknownVariables.map((key) => `{{${key}}}`).join("、")}
        </p>
      ) : null}
      {copyState === "error" ? (
        <p className={styles.status} role="status">
          コピーに失敗しました。概要欄を選択して手動でコピーしてください。
        </p>
      ) : copyState === "copied" ? (
        <p className={styles.status} role="status">
          YouTubeの概要欄へ貼り付けできます。
        </p>
      ) : null}
    </section>
  );
}
