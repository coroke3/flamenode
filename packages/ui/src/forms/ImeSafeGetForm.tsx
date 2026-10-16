import React from "react";

export const IME_COMPOSING_ATTR = "data-fn-ime-composing";

export interface SearchKeyGuardInput {
  key: string;
  shiftKey?: boolean;
  isComposing?: boolean;
  keyCode?: number;
  isCompositionSession?: boolean;
}

export function shouldBlockSearchKeySubmit(input: SearchKeyGuardInput): boolean {
  if (input.key !== "Enter") return false;
  if (input.isCompositionSession) return true;
  if (input.isComposing) return true;
  if (input.keyCode === 229) return true;
  return false;
}

export function shouldBlockSearchFormSubmit(input: {
  isCompositionSession?: boolean;
}): boolean {
  return Boolean(input.isCompositionSession);
}

export interface ImeSafeGetFormProps
  extends React.FormHTMLAttributes<HTMLFormElement> {
  onNavigated?: () => void;
}

/**
 * Form component that prevents unintentional submission while IME is actively composing.
 */
export function ImeSafeGetForm({
  children,
  onNavigated,
  onSubmit,
  onKeyDown,
  onCompositionStart,
  onCompositionEnd,
  target = "_self",
  method = "get",
  ...props
}: ImeSafeGetFormProps): React.ReactElement {
  const formRef = React.useRef<HTMLFormElement>(null);
  const composingRef = React.useRef(false);
  const compositionEndTimerRef = React.useRef<number | null>(null);

  const clearCompositionEndTimer = () => {
    if (compositionEndTimerRef.current != null) {
      clearTimeout(compositionEndTimerRef.current);
      compositionEndTimerRef.current = null;
    }
  };

  React.useEffect(() => () => clearCompositionEndTimer(), []);

  return (
    <form
      {...props}
      ref={formRef}
      method={method}
      target={target}
      onCompositionStart={(event) => {
        clearCompositionEndTimer();
        composingRef.current = true;
        event.currentTarget.setAttribute(IME_COMPOSING_ATTR, "");
        onCompositionStart?.(event);
      }}
      onCompositionEnd={(event) => {
        onCompositionEnd?.(event);
        clearCompositionEndTimer();
        const form = event.currentTarget;
        compositionEndTimerRef.current = window.setTimeout(() => {
          composingRef.current = false;
          form.removeAttribute(IME_COMPOSING_ATTR);
          compositionEndTimerRef.current = null;
        }, 0);
      }}
      onKeyDown={(event) => {
        onKeyDown?.(event);
        if (event.defaultPrevented) return;
        if (event.key !== "Enter") return;

        const native = event.nativeEvent;
        const block = shouldBlockSearchKeySubmit({
          key: event.key,
          shiftKey: event.shiftKey,
          isComposing: native.isComposing,
          keyCode: native.keyCode,
          isCompositionSession: composingRef.current,
        });

        if (block) {
          // IME composition Enter should not trigger form submit
          return;
        }

        if (shouldBlockSearchFormSubmit({ isCompositionSession: composingRef.current })) {
          event.preventDefault();
          return;
        }

        onNavigated?.();
      }}
      onSubmit={(event) => {
        if (shouldBlockSearchFormSubmit({ isCompositionSession: composingRef.current })) {
          event.preventDefault();
          return;
        }
        onSubmit?.(event);
      }}
    >
      {children}
    </form>
  );
}
