"use client";

import * as React from "react";

export interface UseUnsavedChangesGuardOptions {
  dirty: boolean;
  message?: string;
}

export function useUnsavedChangesGuard({
  dirty,
  message = "入力内容が保存されていません。このページを離れますか？",
}: UseUnsavedChangesGuardOptions): void {
  React.useEffect(() => {
    if (!dirty) return;

    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = message;
    };

    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty, message]);
}
