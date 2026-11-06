"use client";

import * as React from "react";
import { SaveSuccessNotice } from "@/components/ui/SaveSuccessNotice";
import { parseModerationSaveNotice, type ModerationSaveNotice } from "./moderationFlashNoticeParse";

const STORAGE_KEY = "flamenode:moderation-save-notice";
export type { ModerationSaveNotice } from "./moderationFlashNoticeParse";

export function storeModerationSaveNotice(notice: ModerationSaveNotice): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(notice));
  } catch {
    // sessionStorage 不可時はページ内表示に頼らない
  }
}

export function ModerationFlashNotice(): React.ReactElement | null {
  const [notice, setNotice] = React.useState<ModerationSaveNotice | null>(null);

  React.useEffect(() => {
    let raw: string | null;
    try {
      raw = sessionStorage.getItem(STORAGE_KEY);
    } catch {
      // Some browsers can deny access to sessionStorage entirely.
      return;
    }
    if (raw === null) return;
    try {
      sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      // A failed cleanup must never crash the moderation page.
    }
    setNotice(parseModerationSaveNotice(raw));
  }, []);

  if (!notice) return null;

  return (
    <SaveSuccessNotice
      message={notice.message}
      pendingPublicReflection={notice.pendingPublicReflection}
      style={{ marginBottom: 12, fontSize: 12 }}
    />
  );
}
