"use client";

import * as React from "react";
import styles from "./YoutubeDescriptionPreview.module.css";
import {
  renderYoutubeDescriptionTemplate,
  type YoutubeDescriptionContext,
} from "@/lib/event/youtubeDescriptionTemplate";

export interface YoutubeDescriptionPreviewProps {
  template: string;
  eventTitle: string;
  context: YoutubeDescriptionContext;
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
}: YoutubeDescriptionPreviewProps): React.ReactElement {
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  const [copyState, setCopyState] = React.useState<"idle" | "copied" | "error">("idle");
  const rendered = React.useMemo(
    () => renderYoutubeDescriptionTemplate(template, context),
    [context, template],
  );

  const handleCopy = async () => {
    if (!rendered.text) return;
    setCopyState("idle");
    try {
      await copyText(rendered.text, textareaRef.current);
      setCopyState("copied");
    } catch {
      setCopyState("error");
    }
  };

  return (
    <section className={styles.panel} aria-labelledby="youtube-description-preview-title">
      <div className={styles.head}>
        <div>
          <h3 id="youtube-description-preview-title" className={styles.title}>
            YouTube概要欄（コピー用）
          </h3>
          <p className={styles.event}>テンプレート: {eventTitle}</p>
        </div>
        <button
          type="button"
          className={`fn-btn fn-btn-primary fn-btn-sm ${styles.copyButton}`}
          onClick={handleCopy}
          disabled={!rendered.text}
        >
          {copyState === "copied" ? "コピーしました" : "概要欄をコピー"}
        </button>
      </div>
      <textarea
        ref={textareaRef}
        className={`fn-input ${styles.textarea}`}
        value={rendered.text}
        readOnly
        aria-label={`${eventTitle} のYouTube概要欄`}
      />
      {rendered.unknownVariables.length > 0 ? (
        <p className={styles.warning} role="alert">
          未知の変数を空欄にしました: {rendered.unknownVariables.map((key) => `{{${key}}}`).join("、")}
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
      ) : (
        <p className={styles.hint}>
          入力中の作品情報を反映しています。保存前でもコピーできます。
        </p>
      )}
    </section>
  );
}
