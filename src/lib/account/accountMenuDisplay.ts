import { normalizeXId } from "../utils/xid.ts";

export type AccountMenuActiveEntry = {
  x_user_id: string;
  x_name: string;
};

/** `@handle` だけを名前代わりにした synthetic X entry を判定する。 */
export function isSyntheticAccountMenuXName(
  entry: AccountMenuActiveEntry,
): boolean {
  const rawName = entry.x_name.trim();
  if (!rawName.startsWith("@")) return false;
  const normalizedId = normalizeXId(entry.x_user_id);
  return normalizedId !== "" && normalizeXId(rawName) === normalizedId;
}

export function resolveAccountMenuDisplayName(input: {
  accountName: string;
  activeEntry: AccountMenuActiveEntry | null | undefined;
  degraded?: boolean;
}): string {
  const fallbackName = input.accountName.trim() || "guest";
  const xName = input.activeEntry?.x_name.trim();
  if (
    input.degraded ||
    !xName ||
    (input.activeEntry && isSyntheticAccountMenuXName(input.activeEntry))
  ) {
    return fallbackName;
  }
  return xName;
}
