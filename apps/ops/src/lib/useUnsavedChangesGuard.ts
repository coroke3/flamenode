// CURRENT native unload protection plus the Ops Data Router navigation guard (MIG-0721 T03).
"use client";

import * as React from "react";
import { useBlocker, type Blocker, type BlockerFunction } from "react-router-dom";

export interface UseUnsavedChangesGuardOptions {
  dirty: boolean;
  message?: string;
}

export function useUnsavedChangesGuard({
  dirty,
  message = "入力内容が保存されていません。このページを離れますか？",
}: UseUnsavedChangesGuardOptions): Blocker {
  const blocker = useBlocker(React.useCallback<BlockerFunction>(({ currentLocation, nextLocation }) =>
    dirty && (currentLocation.pathname !== nextLocation.pathname ||
      currentLocation.search !== nextLocation.search), [dirty]));

  React.useEffect(() => {
    if (!dirty) return;

    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = message;
    };

    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty, message]);

  React.useEffect(() => {
    if (!dirty && blocker.state === "blocked") blocker.reset();
  }, [dirty, blocker]);

  return blocker;
}
