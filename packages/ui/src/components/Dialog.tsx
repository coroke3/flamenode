import React from "react";
import { acquireBodyScrollLock } from "../layout/bodyScrollLock.js";

export interface DialogProps {
  open: boolean;
  onClose?: () => void;
  title: React.ReactNode;
  icon?: React.ReactNode;
  children?: React.ReactNode;
  actions?: React.ReactNode;
  contained?: boolean;
  lang?: string;
  className?: string;
}

function cx(...classes: (string | boolean | undefined | null)[]): string {
  return classes.filter(Boolean).join(" ");
}

type FocusTarget = { focus?: () => void } | null;

/**
 * Side effects of an open dialog: body scroll lock, focus moves into the dialog,
 * Esc calls the latest onEscape, and closing restores focus to the opener.
 * Exported so the behaviour can be tested without a DOM renderer.
 */
export function openDialogBehavior(
  dialog: FocusTarget,
  getOnEscape: () => (() => void) | undefined,
): () => void {
  if (typeof document === "undefined") return () => {};

  const opener = document.activeElement as FocusTarget;
  const releaseScrollLock = acquireBodyScrollLock();
  dialog?.focus?.();

  function onKeyDown(e: KeyboardEvent) {
    const onEscape = getOnEscape();
    if (e.key === "Escape" && onEscape) {
      e.preventDefault();
      onEscape();
    }
  }
  document.addEventListener("keydown", onKeyDown);

  return () => {
    document.removeEventListener("keydown", onKeyDown);
    releaseScrollLock();
    opener?.focus?.();
  };
}

export function Dialog({
  open,
  onClose,
  title,
  icon,
  children,
  actions,
  contained = false,
  lang = "ja",
  className,
}: DialogProps) {
  const titleId = React.useId();
  const dialogRef = React.useRef<HTMLDivElement>(null);
  // Read through a ref so a new onClose on each parent render does not
  // re-run the effect (which would release the lock and move focus).
  const onEscapeRef = React.useRef<(() => void) | undefined>(undefined);
  onEscapeRef.current = contained ? undefined : onClose;

  React.useEffect(() => {
    if (!open) return undefined;
    return openDialogBehavior(dialogRef.current, () => onEscapeRef.current);
  }, [open]);

  if (!open) return null;

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget && onClose) {
      onClose();
    }
  };

  return (
    <div
      lang={lang}
      className={cx(
        "fn-modal-backdrop",
        contained && "fn-modal-backdrop--contained",
        className,
      )}
      onClick={handleBackdropClick}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="fn-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="fn-modal__content">
          {icon ? (
            <div className="fn-modal__icon">
              <span className="fn-icon" aria-hidden="true">
                {icon}
              </span>
            </div>
          ) : null}
          <h2 id={titleId} className="fn-modal__title">
            {title}
          </h2>
          {children ? <div className="fn-modal__body">{children}</div> : null}
        </div>
        {actions ? <div className="fn-modal__actions">{actions}</div> : null}
      </div>
    </div>
  );
}

// Alias matching mock component naming
export const Modal = Dialog;
