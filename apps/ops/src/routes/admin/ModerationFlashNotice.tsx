/** MIG-0731 U03: CURRENT sessionStorage key and one-shot success notice parity. */
import * as React from "react";
import { SaveSuccessNotice } from "../../components/shared/SaveSuccessNotice.js";

export const MODERATION_FLASH_KEY = "flamenode:moderation-save-notice";
export type ModerationSaveNotice = {
  message: string;
  pendingPublicReflection?: boolean;
};

/** Validate untrusted persisted state before rendering. */
export function parseModerationSaveNotice(raw: string): ModerationSaveNotice | null {
  if (!raw || raw.length > 4096) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const record = value as Record<string, unknown>;
    if (typeof record.message !== "string" || !record.message.trim()) return null;
    if (record.pendingPublicReflection !== undefined &&
        typeof record.pendingPublicReflection !== "boolean") return null;
    return {
      message: record.message,
      ...(record.pendingPublicReflection === undefined
        ? {} : { pendingPublicReflection: record.pendingPublicReflection }),
    };
  } catch { return null; }
}

/** Storage errors never crash an admin action. */
export function storeModerationSaveNotice(
  notice: ModerationSaveNotice,
  storage?: Pick<Storage, "setItem">,
): void {
  try {
    (storage ?? sessionStorage).setItem(MODERATION_FLASH_KEY, JSON.stringify(notice));
  } catch { /* Browser may disable sessionStorage. */ }
}

/** Read and delete once. A cleanup error must not block showing a valid notice. */
export function consumeModerationSaveNotice(
  storage?: Pick<Storage, "getItem" | "removeItem">,
): ModerationSaveNotice | null {
  let store: Pick<Storage, "getItem" | "removeItem">;
  let raw: string | null;
  try {
    store = storage ?? sessionStorage;
    raw = store.getItem(MODERATION_FLASH_KEY);
  } catch { return null; }
  if (raw === null) return null;
  try { store.removeItem(MODERATION_FLASH_KEY); } catch { /* fail-soft cleanup */ }
  return parseModerationSaveNotice(raw);
}

/** Increment refreshKey after data refresh to consume exactly one stored notice. */
export function ModerationFlashNotice({ refreshKey = 0 }: { refreshKey?: number }): React.ReactElement | null {
  const [notice, setNotice] = React.useState<ModerationSaveNotice | null>(null);
  React.useEffect(() => { setNotice(consumeModerationSaveNotice()); }, [refreshKey]);
  if (!notice) return null;
  return <SaveSuccessNotice
    message={notice.message}
    pendingPublicReflection={notice.pendingPublicReflection}
    style={{ marginBottom: 12, fontSize: 12 }}
  />;
}
