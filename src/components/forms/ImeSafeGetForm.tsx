"use client";

import * as React from "react";
import { navigateGetForm } from "@/components/forms/AutoSubmitSelect";
import {
  IME_COMPOSING_FORM_ATTR,
  shouldBlockSearchFormSubmit,
  shouldBlockSearchKeySubmit,
} from "@/lib/forms/imeSafeSearch";

type ImeSafeGetFormProps = React.FormHTMLAttributes<HTMLFormElement> & {
  /** 実際に同一タブ検索を実行した直後（IME 確定のみでは呼ばない） */
  onNavigated?: () => void;
};

/**
 * 公開 GET 検索用。IME 変換中の Enter では submit せず、
 * 確定後 / 非 IME の Enter・Shift+Enter・検索ボタンは同一タブ遷移。
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
    if (compositionEndTimerRef.current == null) return;
    window.clearTimeout(compositionEndTimerRef.current);
    compositionEndTimerRef.current = null;
  };

  React.useEffect(() => () => clearCompositionEndTimer(), []);

  const runSearch = (form: HTMLFormElement) => {
    navigateGetForm(form);
    onNavigated?.();
  };

  return (
    <form
      {...props}
      ref={formRef}
      method={method}
      target={target}
      onCompositionStart={(event) => {
        clearCompositionEndTimer();
        composingRef.current = true;
        event.currentTarget.setAttribute(IME_COMPOSING_FORM_ATTR, "");
        onCompositionStart?.(event);
      }}
      onCompositionEnd={(event) => {
        onCompositionEnd?.(event);
        // 確定 Enter と同じ tick での form submit を避ける（IME 自体は壊さない）
        clearCompositionEndTimer();
        const form = event.currentTarget;
        compositionEndTimerRef.current = window.setTimeout(() => {
          composingRef.current = false;
          form.removeAttribute(IME_COMPOSING_FORM_ATTR);
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
          // IME 確定 Enter 自体は preventDefault しない（submit 側で抑止）
          return;
        }
        // Shift+Enter 等も同一タブ検索に統一
        event.preventDefault();
        const form = event.currentTarget;
        if (shouldBlockSearchFormSubmit({ isCompositionSession: composingRef.current })) {
          return;
        }
        runSearch(form);
      }}
      onSubmit={(event) => {
        onSubmit?.(event);
        if (event.defaultPrevented) return;
        event.preventDefault();
        if (
          shouldBlockSearchFormSubmit({
            isCompositionSession: composingRef.current,
          })
        ) {
          return;
        }
        runSearch(event.currentTarget);
      }}
    >
      {children}
    </form>
  );
}
