import React from "react";
import { navigateGetForm } from "./AutoSubmitSelect.js";
import { useNavigateAdapter } from "../adapters/index.js";

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
  return Boolean(input.isCompositionSession || input.isComposing || input.keyCode === 229);
}

export function shouldBlockSearchFormSubmit(input: {
  isCompositionSession?: boolean;
  isNativeGuardActive?: boolean;
}): boolean {
  return Boolean(input.isCompositionSession || input.isNativeGuardActive);
}

/** Only GET forms use the client-side search navigation path. */
export function isGetSearchFormMethod(method: string | null): boolean {
  return (method ?? "get").trim().toLowerCase() === "get";
}

export interface ImeSafeGetFormProps
  extends React.FormHTMLAttributes<HTMLFormElement> {
  onNavigated?: () => void;
}

/**
 * CURRENTの GET 検索契約:
 * IME確定Enterでは送信せず、確定後のEnter・Shift+Enter・検索ボタンは同じGET検索に統一。
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
  // AdapterProvider can supply the router; without one this is a plain page load.
  const navigator = useNavigateAdapter();
  const composingRef = React.useRef(false);
  // compositionstart が到達しないIME環境でも、native.isComposing / keyCode=229
  // のEnter直後の暗黙的submitを禁止する。
  const suppressSubmitRef = React.useRef(false);
  const compositionEndTimerRef = React.useRef<number | null>(null);
  const submitGuardTimerRef = React.useRef<number | null>(null);

  const clearTimer = (ref: { current: number | null }) => {
    if (ref.current != null) {
      clearTimeout(ref.current);
      ref.current = null;
    }
  };

  React.useEffect(() => () => {
    clearTimer(compositionEndTimerRef);
    clearTimer(submitGuardTimerRef);
  }, []);

  const armSubmitGuard = () => {
    clearTimer(submitGuardTimerRef);
    suppressSubmitRef.current = true;
    submitGuardTimerRef.current = window.setTimeout(() => {
      suppressSubmitRef.current = false;
      submitGuardTimerRef.current = null;
    }, 0);
  };

  const runSearch = (form: HTMLFormElement) => {
    navigateGetForm(form, (href) => navigator.push(href));
    onNavigated?.();
  };

  return (
    <form
      {...props}
      ref={formRef}
      method={method}
      target={target}
      onCompositionStart={(event) => {
        clearTimer(compositionEndTimerRef);
        clearTimer(submitGuardTimerRef);
        suppressSubmitRef.current = true;
        composingRef.current = true;
        event.currentTarget.setAttribute(IME_COMPOSING_ATTR, "");
        onCompositionStart?.(event);
      }}
      onCompositionEnd={(event) => {
        onCompositionEnd?.(event);
        clearTimer(compositionEndTimerRef);
        const form = event.currentTarget;
        // IME確定Enterと同じtickに届くsubmitは必ず抑止。
        compositionEndTimerRef.current = window.setTimeout(() => {
          composingRef.current = false;
          suppressSubmitRef.current = false;
          form.removeAttribute(IME_COMPOSING_ATTR);
          compositionEndTimerRef.current = null;
        }, 0);
      }}
      onKeyDown={(event) => {
        onKeyDown?.(event);
        if (event.defaultPrevented || event.key !== "Enter") return;
        const native = event.nativeEvent;
        if (shouldBlockSearchKeySubmit({
          key: event.key,
          shiftKey: event.shiftKey,
          isComposing: native.isComposing,
          keyCode: native.keyCode,
          isCompositionSession: composingRef.current,
        })) {
          // IME変換確定キー自体はpreventDefaultしない。
          // onSubmitで、暗黙的submitのみを阻止する。
          armSubmitGuard();
          return;
        }

        // Leave non-GET methods to the browser's native submit path.
        // Calling navigateGetForm on POST would requestSubmit() again and recurse.
        if (!isGetSearchFormMethod(event.currentTarget.getAttribute("method"))) return;
        event.preventDefault();
        if (!shouldBlockSearchFormSubmit({ isCompositionSession: composingRef.current,
          isNativeGuardActive: suppressSubmitRef.current })) {
          runSearch(event.currentTarget);
        }
      }}
      onSubmit={(event) => {
        onSubmit?.(event);
        if (event.defaultPrevented) return;
        if (!isGetSearchFormMethod(event.currentTarget.getAttribute("method"))) {
          // Respect native POST submission while still suppressing IME implicit submits.
          if (shouldBlockSearchFormSubmit({
            isCompositionSession: composingRef.current,
            isNativeGuardActive: suppressSubmitRef.current,
          })) event.preventDefault();
          return;
        }
        event.preventDefault();
        if (shouldBlockSearchFormSubmit({ isCompositionSession: composingRef.current,
          isNativeGuardActive: suppressSubmitRef.current })) return;
        runSearch(event.currentTarget);
      }}
    >
      {children}
    </form>
  );
}
