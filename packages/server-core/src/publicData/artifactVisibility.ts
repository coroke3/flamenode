import type { StaticRebuildTargetType } from "../staticRebuild/types.ts";
import { PUBLIC_LISTABLE_X_APPROVAL_STATUSES } from "./publicXUser.ts";
import type { PublicVisibilityBlockedEntitiesManifest } from "../visibility/manifestCore.ts";

type PayloadRecord = Record<string, unknown>;
type RowPredicate = (row: unknown) => boolean;

export type PublicArtifactVisibilityContext = {
  blockedVideoIds: ReadonlySet<string>;
  blockedEventIds: ReadonlySet<string>;
  blockedEventGroupIds: ReadonlySet<string>;
  blockedUserIds: ReadonlySet<string>;
};

export function buildPublicArtifactVisibilityContext(
  manifest: PublicVisibilityBlockedEntitiesManifest | null | undefined,
): PublicArtifactVisibilityContext | undefined {
  if (!manifest) return undefined;
  const blockedVideoIds = new Set<string>();
  const blockedEventIds = new Set<string>();
  const blockedEventGroupIds = new Set<string>();
  const blockedUserIds = new Set<string>();
  for (const entry of manifest.entities) {
    if (entry.entity_type === "video") blockedVideoIds.add(entry.entity_id);
    if (entry.entity_type === "event") blockedEventIds.add(entry.entity_id);
    if (entry.entity_type === "event_group") {
      blockedEventGroupIds.add(entry.entity_id);
    }
    if (entry.entity_type === "x_user") {
      blockedUserIds.add(entry.entity_id.toLowerCase());
    }
  }
  return {
    blockedVideoIds,
    blockedEventIds,
    blockedEventGroupIds,
    blockedUserIds,
  };
}

function asRecord(value: unknown): PayloadRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as PayloadRecord)
    : null;
}

/**
 * Public artifacts historically omitted visibility columns because the
 * generator selected public rows before writing R2.  A stale or hand-edited
 * artifact can still carry those columns, however.  In that case the
 * explicit non-public marker must win; an omitted marker remains compatible
 * with the historical public artifact shape.
 */
function isPublicVideoRow(
  value: unknown,
  context?: PublicArtifactVisibilityContext,
): boolean {
  const row = asRecord(value);
  if (!row) return false;
  const id = typeof row.id === "string" ? row.id.trim() : "";
  if (id && context?.blockedVideoIds.has(id)) return false;
  if (
    row.visibility_status != null &&
    row.visibility_status !== "public"
  ) {
    return false;
  }
  if (row.status != null && row.status !== "public") return false;
  return true;
}

function isPublicEventRow(
  value: unknown,
  context?: PublicArtifactVisibilityContext,
): boolean {
  const row = asRecord(value);
  if (!row) return false;
  const id = typeof row.id === "string" ? row.id.trim() : "";
  if (id && context?.blockedEventIds.has(id)) return false;
  return row.visibility_status == null || row.visibility_status === "public";
}

function isPublicEventGroupRow(
  value: unknown,
  context?: PublicArtifactVisibilityContext,
): boolean {
  const row = asRecord(value);
  if (!row) return false;
  const id = typeof row.id === "string" ? row.id.trim() : "";
  if (id && context?.blockedEventGroupIds.has(id)) return false;
  return row.visibility_status == null || row.visibility_status === "public";
}

function isPublicUserRow(
  value: unknown,
  context?: PublicArtifactVisibilityContext,
): boolean {
  const row = asRecord(value);
  if (!row) return false;
  const username =
    typeof row.username === "string" ? row.username.trim().toLowerCase() : "";
  if (username && context?.blockedUserIds.has(username)) return false;
  const authorHandle =
    typeof row.author_x_handle === "string"
      ? row.author_x_handle.trim().toLowerCase()
      : "";
  if (authorHandle && context?.blockedUserIds.has(authorHandle)) return false;
  if (
    row.approval_status != null &&
    !PUBLIC_LISTABLE_X_APPROVAL_STATUSES.includes(
      row.approval_status as (typeof PUBLIC_LISTABLE_X_APPROVAL_STATUSES)[number],
    )
  ) {
    return false;
  }
  return true;
}

function filterArray(
  rows: unknown,
  predicate: RowPredicate,
): unknown[] | null {
  if (!Array.isArray(rows)) return null;
  return rows.filter(predicate);
}

function filterEventSections(
  sections: unknown,
  context?: PublicArtifactVisibilityContext,
): unknown[] | null {
  if (!Array.isArray(sections)) return null;
  return sections
    .map((section) => {
      const row = asRecord(section);
      if (!row || !isPublicEventGroupRow(row, context)) return null;
      const events = filterArray(row.events, (item) =>
        isPublicEventRow(item, context),
      );
      return {
        ...row,
        events: events ?? [],
      };
    })
    .filter((section): section is PayloadRecord => section !== null);
}

function filterGroupRows(
  groups: unknown,
  context?: PublicArtifactVisibilityContext,
): unknown[] | null {
  if (!Array.isArray(groups)) return null;
  return groups
    .map((group) => {
      const row = asRecord(group);
      if (!row || !isPublicEventGroupRow(row, context)) return null;
      const events = filterArray(row.events, (item) =>
        isPublicEventRow(item, context),
      );
      return {
        ...row,
        events: events ?? [],
      };
    })
    .filter((group): group is PayloadRecord => group !== null);
}

function filterEventDetailGroupSections(
  sections: unknown,
  context?: PublicArtifactVisibilityContext,
): unknown[] | null {
  if (!Array.isArray(sections)) return null;
  return sections
    .map((section) => {
      const row = asRecord(section);
      if (!row || !isPublicEventGroupRow(row, context)) return null;
      const groups = filterGroupRows(row.groups, context);
      return {
        ...row,
        groups: groups ?? [],
      };
    })
    .filter((section): section is PayloadRecord => section !== null);
}

function filterScheduleEntries(
  entries: unknown,
  context?: PublicArtifactVisibilityContext,
): unknown[] | null {
  if (!Array.isArray(entries)) return null;
  return entries
    .map((entry) => {
      const row = asRecord(entry);
      if (!row || !isPublicVideoRow(row.video, context)) return null;
      return row;
    })
    .filter((entry): entry is PayloadRecord => entry !== null);
}

function filterPublicVideoRows(
  rows: unknown,
  context?: PublicArtifactVisibilityContext,
): unknown[] | null {
  return filterArray(rows, (item) => isPublicVideoRow(item, context));
}

function filterPublicEventRows(
  rows: unknown,
  context?: PublicArtifactVisibilityContext,
): unknown[] | null {
  return filterArray(rows, (item) => isPublicEventRow(item, context));
}

function filterPublicUserRows(
  rows: unknown,
  context?: PublicArtifactVisibilityContext,
): unknown[] | null {
  return filterArray(rows, (item) => isPublicUserRow(item, context));
}

/**
 * Filter an in-memory R2 payload before serving or snapshotting.  Returns a
 * shallow-copied payload whose nested collection rows have had non-public
 * items dropped.  Returns null when the root payload is not a record, or
 * when a single-entity target (e.g. video_detail) has been blocked.
 */
export function filterPublicArtifactPayload(
  targetType: StaticRebuildTargetType,
  payload: unknown,
  context?: PublicArtifactVisibilityContext,
): unknown {
  const root = asRecord(payload);
  if (!root) return null;

  switch (targetType) {
    case "top_videos":
    case "videos_index":
    case "ranking_videos":
    case "tag_detail": {
      const items = filterPublicVideoRows(root.items, context);
      return items ? { ...root, items } : root;
    }

    case "top_announcements": {
      return root;
    }

    case "events_index": {
      const items = filterPublicEventRows(root.items, context);
      const groupSections = filterEventSections(root.group_sections, context);
      return {
        ...root,
        ...(items ? { items } : {}),
        ...(groupSections ? { group_sections: groupSections } : {}),
      };
    }

    case "users_index": {
      const items = filterPublicUserRows(root.items, context);
      return items ? { ...root, items } : root;
    }

    case "user_detail": {
      const user = asRecord(root.user);
      if (user && !isPublicUserRow(user, context)) return null;
      const videos = filterPublicVideoRows(root.videos, context);
      const events = filterPublicEventRows(root.events, context);
      return {
        ...root,
        ...(videos ? { videos } : {}),
        ...(events ? { events } : {}),
      };
    }

    case "video_detail": {
      const video = asRecord(root.video);
      if (video && !isPublicVideoRow(video, context)) return null;
      return root;
    }

    case "event_detail": {
      const event = asRecord(root.event);
      if (event && !isPublicEventRow(event, context)) return null;
      const groupSections = filterEventDetailGroupSections(
        root.group_sections,
        context,
      );
      return {
        ...root,
        ...(groupSections ? { group_sections: groupSections } : {}),
      };
    }

    case "event_slots": {
      const slots = filterArray(root.slots, (item) => {
        const slot = asRecord(item);
        if (!slot) return false;
        return (
          slot.status == null ||
          slot.status === "public" ||
          slot.status === "available"
        );
      });
      return slots ? { ...root, slots } : root;
    }

    case "event_schedule": {
      const entries = filterScheduleEntries(root.entries, context);
      return entries ? { ...root, entries } : root;
    }

    case "event_release": {
      const event = asRecord(root.event);
      if (event && !isPublicEventRow(event, context)) return null;
      const videos = filterPublicVideoRows(root.videos, context);
      const count = videos ? videos.length : (root.videos as unknown[])?.length ?? 0;
      return {
        ...root,
        ...(videos ? { videos, total: count } : {}),
      };
    }

    case "tag_software_catalog":
    case "rules_page":
      return root;
  }
}
