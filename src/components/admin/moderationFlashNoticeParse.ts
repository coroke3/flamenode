/** Validate the sessionStorage payload before passing it to React for rendering. */
export type ModerationSaveNotice = {
  message: string;
  pendingPublicReflection?: boolean;
};

export function parseModerationSaveNotice(raw: string): ModerationSaveNotice | null {
  // A browser storage value is untrusted, even when the writer is our own UI.
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
        ? {}
        : { pendingPublicReflection: record.pendingPublicReflection }),
    };
  } catch {
    return null;
  }
}
