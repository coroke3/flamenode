"use client";

/**
 * ConfirmDialog – 危険操作確認モーダル
 *
 * 使用例:
 *   <ConfirmDialog
 *     open={isOpen}
 *     title="削除しますか？"
 *     message="この操作は取り消せません。"
 *     confirmLabel="削除"
 *     cancelLabel="キャンセル"
 *     tone="danger"
 *     onConfirm={() => handleDelete()}
 *     onCancel={() => setIsOpen(false)}
 *   />
 */

import * as React from "react";
import styles from "./ConfirmDialog.module.css";

export interface ConfirmDialogProps {
  /** モーダルの開閉状態 */
  open: boolean;
  /** モーダルのタイトル */
  title: string;
  /** 本文メッセージ */
  message: string;
  /** 確認ボタンのラベル (デフォルト: "確認") */
  confirmLabel?: string;
  /** キャンセルボタンのラベル (デフォルト: "キャンセル") */
  cancelLabel?: string;
  /** ボタンの色調 (danger: 赤, default: プライマリ) */
  tone?: "danger" | "default";
  /** 確認ボタンを押したときのコールバック */
  onConfirm: () => void;
  /** キャンセルボタン or 背景クリック時のコールバック */
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "確認",
  cancelLabel = "キャンセル",
  tone = "default",
  onConfirm,
  onCancel,
}: ConfirmDialogProps): React.ReactElement | null {
  // ESC キーでキャンセル
  React.useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onCancel]);

  if (!open) return null;

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
        aria-labelledby="confirm-dialog-title"
        aria-describedby="confirm-dialog-message"
      >
        <div className={styles.body}>
          <p id="confirm-dialog-title" className={styles.title}>
            {title}
          </p>
          <p id="confirm-dialog-message" className={styles.message}>
            {message}
          </p>
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
            // eslint-disable-next-line jsx-a11y/no-autofocus
            autoFocus
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
