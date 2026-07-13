import { normalizeXId } from "@/lib/utils/xid";

export interface XIdEntry {
  x_user_id: string;
  x_name: string;
  icon_url: string | null;
  approval_status:
    | "approved"
    | "pending"
    | "rejected";
  is_active: boolean;
}

export function normalizeXIdEntries(
  entries: readonly XIdEntry[],
): XIdEntry[] {
  const seen = new Set<string>();
  const normalized: XIdEntry[] = [];

  for (const entry of entries) {
    const xUserId = normalizeXId(entry.x_user_id);

    if (!xUserId || seen.has(xUserId)) {
      continue;
    }

    seen.add(xUserId);
    normalized.push({
      ...entry,
      x_user_id: xUserId,
      x_name:
        entry.x_name?.trim() ||
        `@${xUserId}`,
    });
  }

  return normalized;
}

function approvalOrder(
  status: XIdEntry["approval_status"],
): number {
  if (status === "approved") return 0;
  if (status === "pending") return 1;
  return 2;
}

export function sortXIdEntries(
  entries: readonly XIdEntry[],
  options: {
    activeId?: string | null;
    activeFirst?: boolean;
  } = {},
): XIdEntry[] {
  const {
    activeId = null,
    activeFirst = false,
  } = options;

  return [...entries].sort((a, b) => {
    if (activeFirst) {
      if (a.x_user_id === activeId) return -1;
      if (b.x_user_id === activeId) return 1;
    }

    return (
      approvalOrder(a.approval_status) -
        approvalOrder(b.approval_status) ||
      a.x_name.localeCompare(b.x_name, "ja")
    );
  });
}
