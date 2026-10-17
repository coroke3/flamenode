import React from "react";
import { cx } from "../cx.js";
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

type FocusTarget = { focus?: () => void } | null;
type DialogElement =
  | (FocusTarget & { contains?: (node: Node | null) => boolean; isConnected?: boolean })
  | null;

// Open dialogs, innermost last. Only the innermost one answers Esc.
const openDialogs: object[] = [];

/**
 * Side effects of an open dialog: body scroll lock, focus moves into the dialog
 * (unless a child such as an autoFocus input already has it), Esc calls the latest
 * onEscape of the innermost dialog, and closing restores focus to the opener.
 * Focus is not restored while the dialog is still in the document, which is the
 * StrictMode re-run of the effect, so an autoFocus child keeps its focus.
 */
export function openDialogBehavior(
  dialog: DialogElement,
  opener: FocusTarget,
  getOnEscape: () => (() => void) | undefined,
): () => void {
  if (typeof document === "undefined") return () => {};

  const token = {};
  openDialogs.push(token);
  const releaseScrollLock = acquireBodyScrollLock();
  if (!dialog?.contains?.(document.activeElement as Node | null)) dialog?.focus?.();

  function onKeyDown(e: KeyboardEvent) {
    if (e.key !== "Escape" || e.isComposing) return; // IME conversion uses Esc
    if (openDialogs[openDialogs.length - 1] !== token) return;
    const onEscape = getOnEscape();
    if (onEscape) {
      e.preventDefault();
      onEscape();
    }
  }
  document.addEventListener("keydown", onKeyDown);

  return () => {
    document.removeEventListener("keydown", onKeyDown);
    openDialogs.splice(openDialogs.indexOf(token), 1);
    releaseScrollLock();
    if (!dialog?.isConnected) opener?.focus?.();
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
  React.useEffect(() => {
    onEscapeRef.current = contained ? undefined : onClose;
  });

  // The opener is read when this first child's ref attaches. React attaches it
  // before a later child's autoFocus runs, and both happen at commit, not render.
  const openerRef = React.useRef<FocusTarget>(null);
  const recordOpener = React.useCallback((node: HTMLSpanElement | null) => {
    const active = node ? document.activeElement : null;
    if (active && !node?.parentElement?.contains(active)) openerRef.current = active as FocusTarget;
  }, []);

  React.useEffect(() => {
    if (!open) return undefined;
    return openDialogBehavior(dialogRef.current, openerRef.current, () => onEscapeRef.current);
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
      <span ref={recordOpener} hidden />
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

