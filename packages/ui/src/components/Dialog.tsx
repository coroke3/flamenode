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
  const previousActiveElementRef = React.useRef<HTMLElement | null>(null);

  React.useEffect(() => {
    if (!open) return undefined;

    // Track previously active element for focus restoration
    if (typeof document !== "undefined" && document.activeElement instanceof HTMLElement) {
      previousActiveElementRef.current = document.activeElement;
    }

    // Acquire body scroll lock
    const releaseScrollLock = acquireBodyScrollLock();

    // Focus the dialog container
    if (dialogRef.current) {
      dialogRef.current.focus?.();
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && onClose && !contained) {
        e.preventDefault();
        onClose();
      }
    }

    if (typeof document !== "undefined") {
      document.addEventListener("keydown", onKeyDown);
    }

    return () => {
      releaseScrollLock();
      if (typeof document !== "undefined") {
        document.removeEventListener("keydown", onKeyDown);
      }
      // Restore focus
      if (previousActiveElementRef.current?.focus) {
        previousActiveElementRef.current.focus();
      }
    };
  }, [open, onClose, contained]);

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
