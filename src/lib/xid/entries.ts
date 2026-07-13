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

export function normalizeXIdApprovalStatus(
  status: string | null | undefined,
): XIdEntry["approval_status"] {
  return status === "approved" || status === "rejected" ? status : "pending";
}

export function xIdApprovalRank(status: string | null | undefined): number {
  if (status === "approved") return 0;
  if (status === "rejected") return 2;
  return 1;
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
      xIdApprovalRank(a.approval_status) -
        xIdApprovalRank(b.approval_status) ||
      a.x_name.localeCompare(b.x_name, "ja")
    );
  });
}
