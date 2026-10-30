// Port of CURRENT src/components/ui/ConfirmDialog.tsx (MIG-0707 U05, D-17-6). Same output.
import * as React from "react";

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message?: React.ReactNode;
  expectedText?: string;
  inputLabel?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "danger" | "default";
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  message,
  expectedText,
  inputLabel = "確認のため次の文字列を入力してください",
  confirmLabel = "確認",
  cancelLabel = "キャンセル",
  tone = "default",
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps): React.ReactElement | null {
  const [input, setInput] = React.useState("");
  const titleId = React.useId();
  const messageId = React.useId();
  const requiresText = expectedText !== undefined;
  const canConfirm = !requiresText || input.trim() === expectedText;

  React.useEffect(() => {
    if (open) setInput("");
  }, [open, expectedText]);

  React.useEffect(() => {
    if (!open) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) {
        onCancel();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [busy, onCancel, open]);

  if (!open) return null;

  const confirmClassName =
    tone === "danger" ? "fn-btn fn-btn-danger" : "fn-btn fn-btn-primary";

  return (
    <div
      className={"confirm-backdrop"}
      role="presentation"
      onClick={(event) => {
        if (!busy && event.target === event.currentTarget) {
          onCancel();
        }
      }}
    >
      <div
        className={"confirm-dialog"}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={message ? messageId : undefined}
      >
        <div className={"confirm-body"}>
          <p id={titleId} className={"confirm-title"}>
            {title}
          </p>

          {message ? (
            <div id={messageId} className={"confirm-message"}>
              {message}
            </div>
          ) : null}

          {requiresText ? (
            <label className={"confirm-confirmation"}>
              <span className={"confirm-confirmationLabel"}>
                {inputLabel}: <code>{expectedText}</code>
              </span>
              <input
                type="text"
                className="fn-input"
                value={input}
                onChange={(event) => setInput(event.target.value)}
                placeholder={expectedText}
                autoComplete="off"
                spellCheck={false}
                disabled={busy}
                // eslint-disable-next-line jsx-a11y/no-autofocus
                autoFocus
                onKeyDown={(event) => {
                  if (event.key === "Enter" && canConfirm && !busy) {
                    event.preventDefault();
                    onConfirm();
                  }
                }}
              />
            </label>
          ) : null}
        </div>

        <div className={"confirm-footer"}>
          <button
            type="button"
            className="fn-btn fn-btn-ghost"
            onClick={onCancel}
            disabled={busy}
          >
            {cancelLabel}
          </button>

          <button
            type="button"
            className={confirmClassName}
            onClick={onConfirm}
            disabled={busy || !canConfirm}
            autoFocus={!requiresText}
          >
            {busy ? "処理中…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
