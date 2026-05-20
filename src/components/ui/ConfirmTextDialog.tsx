"use client";

/**
 * ConfirmTextDialog – 確認文字列入力式の危険操作モーダル
 *
 * X ID 連携解除のような取り消しにくい操作で、ユーザーに
 * `DELETE xid` のような確認文字列を入力させてから実行する。
 *
 * 入力欄を通常画面に常時露出させるよりも、ダイアログ内で
 * 「ここに `DELETE xid` と入力」のラベル付きで提示する方が
 * 何を入力すべきか分かりやすく、誤操作も減らせる。
 */

import * as React from "react";
import styles from "./ConfirmDialog.module.css";

export interface ConfirmTextDialogProps {
  open: boolean;
  title: string;
  /** 本文。複数行は ReactNode で渡せる。 */
  description?: React.ReactNode;
  /** 入力欄の上に表示する説明 (例: "削除するには次の文字列を入力してください")。 */
  inputLabel?: string;
  /** ユーザーが入力すべき確認文字列。これと完全一致したときだけ confirm を有効化する。 */
  expectedText: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "danger" | "default";
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmTextDialog({
  open,
  title,
  description,
  inputLabel = "確認のため次の文字列を入力してください",
  expectedText,
  confirmLabel = "実行",
  cancelLabel = "キャンセル",
  tone = "default",
  onConfirm,
  onCancel,
}: ConfirmTextDialogProps): React.ReactElement | null {
  const [input, setInput] = React.useState("");

  // 開閉時に入力欄をリセットする (再オープン時に前回値が残らないようにする)。
  React.useEffect(() => {
    if (open) setInput("");
  }, [open]);

  React.useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onCancel]);

  if (!open) return null;

  const canConfirm = input.trim() === expectedText;
  const confirmClassName =
    tone === "danger" ? "fn-btn fn-btn-danger" : "fn-btn fn-btn-primary";

  return (
    <div
      className={styles.backdrop}
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        className={styles.dialog}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-text-title"
      >
        <div className={styles.body}>
          <p id="confirm-text-title" className={styles.title}>
            {title}
          </p>
          {description ? (
            <div className={styles.message}>{description}</div>
          ) : null}
          <label
            className="fn-text-sm"
            style={{ display: "grid", gap: 6, marginTop: 8 }}
          >
            <span>
              {inputLabel}: <code>{expectedText}</code>
            </span>
            <input
              type="text"
              className="fn-input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={expectedText}
              // eslint-disable-next-line jsx-a11y/no-autofocus
              autoFocus
              autoComplete="off"
              spellCheck={false}
              onKeyDown={(e) => {
                if (e.key === "Enter" && canConfirm) {
                  e.preventDefault();
                  onConfirm();
                }
              }}
            />
          </label>
        </div>
        <div className={styles.footer}>
          <button
            type="button"
            className="fn-btn fn-btn-ghost"
            onClick={onCancel}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            className={confirmClassName}
            onClick={onConfirm}
            disabled={!canConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
