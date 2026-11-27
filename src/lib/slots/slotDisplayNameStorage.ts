/** CURRENT reservation display-name preference: a versioned, typed X identity only.
 * A viewer without an X ID has no stable safe browser-local identity; do not
 * persist or import the ambiguous legacy/unassigned key.
 */
const X_NAME_KEY_PREFIX = "fn:lastSlotDisplayName:v2:x:";

export function slotDisplayNameStorageKey(normalizedXId: string): string | null {
  return normalizedXId ? X_NAME_KEY_PREFIX + encodeURIComponent(normalizedXId) : null;
}

export function readPersistedSlotDisplayName(
  normalizedXId: string,
  getItem: (key: string) => string | null,
): string {
  const key = slotDisplayNameStorageKey(normalizedXId);
  if (!key) return "";
  try {
    return getItem(key) ?? "";
  } catch {
    return "";
  }
}

export function persistSlotDisplayName(
  normalizedXId: string,
  displayName: string,
  setItem: (key: string, value: string) => void,
): void {
  const key = slotDisplayNameStorageKey(normalizedXId);
  const trimmed = displayName.trim();
  if (!key || !trimmed) return;
  try {
    setItem(key, trimmed);
  } catch {
    // Browser storage may be disabled; UI state remains usable.
  }
}

/** The anonymous/null-X viewer has no account-stable cache scope, even in React memory. */
export function reusableSlotDisplayName(normalizedXId: string, savedName: string): string {
  return normalizedXId ? savedName : "";
}
