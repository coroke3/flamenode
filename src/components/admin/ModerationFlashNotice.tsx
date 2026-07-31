"use client";

import * as React from "react";
import { SaveSuccessNotice } from "@/components/ui/SaveSuccessNotice";

const STORAGE_KEY = "flamenode:moderation-save-notice";

export type ModerationSaveNotice = {
  message: string;
  pendingPublicReflection?: boolean;
};

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
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      sessionStorage.removeItem(STORAGE_KEY);
      setNotice(JSON.parse(raw) as ModerationSaveNotice);
    } catch {
      sessionStorage.removeItem(STORAGE_KEY);
    }
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
