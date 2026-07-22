"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { setActiveXId } from "@/lib/actions/xid";
import {
  normalizeXIdEntries,
  type XIdEntry,
} from "@/lib/xid/entries";

interface UseActiveXSwitcherOptions {
  entries: readonly XIdEntry[];
  onSwitch?: (xUserId: string) => void;
  onSuccess?: () => void;
}

export function useActiveXSwitcher({
  entries,
  onSwitch,
  onSuccess,
}: UseActiveXSwitcherOptions) {
  const router = useRouter();

  const normalizedEntries = React.useMemo(
    () => normalizeXIdEntries(entries),
    [entries],
  );

  const [activeId, setActiveId] =
    React.useState<string | null>(
      normalizedEntries.find(
        (entry) => entry.is_active,
      )?.x_user_id ?? null,
    );

  const [error, setError] =
    React.useState<string | null>(null);

  const [pending, startTransition] =
    React.useTransition();

  React.useEffect(() => {
    setActiveId(
      normalizedEntries.find(
        (entry) => entry.is_active,
      )?.x_user_id ?? null,
    );
  }, [normalizedEntries]);

  const activeEntry =
    normalizedEntries.find(
      (entry) => entry.x_user_id === activeId,
    ) ?? null;

  const switchTo = React.useCallback(
    (entry: XIdEntry) => {
      setError(null);

      if (entry.x_user_id === activeId) {
        onSuccess?.();
        return;
      }

      if (entry.approval_status !== "approved") {
        setError(
          entry.approval_status === "rejected"
            ? "却下された X ID はアクティブにできません。"
            : "承認済みの X ID だけをアクティブにできます。",
        );
        return;
      }

      const previousActiveId = activeId;
      setActiveId(entry.x_user_id);

      const formData = new FormData();
      formData.set(
        "x_user_id",
        entry.x_user_id,
      );

      startTransition(async () => {
        const result =
          await setActiveXId(formData);

        if (!result.ok) {
          setActiveId(previousActiveId);
          setError(
            result.message ??
              "X ID の切り替えに失敗しました。",
          );
          return;
        }

        onSwitch?.(entry.x_user_id);
        onSuccess?.();
        router.refresh();
      });
    },
    [
      activeId,
      onSuccess,
      onSwitch,
      router,
    ],
  );

  return {
    entries: normalizedEntries,
    activeId,
    activeEntry,
    pending,
    error,
    clearError: () => setError(null),
    switchTo,
  };
}
