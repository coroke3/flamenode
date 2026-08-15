import type { StaticRebuildTargetType } from "../staticRebuild/types";
import { PUBLIC_LISTABLE_X_APPROVAL_STATUSES } from "../utils/publicXUser.ts";
import type {
  PublicVisibilityBlockedEntitiesManifest,
} from "./publicVisibilityManifestCore";

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
  const id = String(row.x_id ?? row.id ?? "").trim().toLowerCase();
  if (id && context?.blockedUserIds.has(id)) return false;
  if (
    row.approval_status != null &&
    (typeof row.approval_status !== "string" ||
      !PUBLIC_LISTABLE_X_APPROVAL_STATUSES.includes(
        row.approval_status as (typeof PUBLIC_LISTABLE_X_APPROVAL_STATUSES)[number],
      ))
  ) {
    return false;
  }
  if (
    row.visibility_status != null &&
    row.visibility_status !== "public"
  ) {
    return false;
  }
  if (row.status != null && row.status !== "public") return false;
  return true;
}

function filterRows(
  value: unknown,
  predicate: RowPredicate,
): { value: unknown; changed: boolean } {
  if (!Array.isArray(value)) return { value, changed: false };
  const filtered = value.filter(predicate);
  if (filtered.length === value.length) return { value, changed: false };
  return { value: filtered, changed: true };
}

function withFilteredRows(
  payload: PayloadRecord,
  keys: readonly string[],
  predicate: RowPredicate,
): PayloadRecord {
  let next = payload;
  let changed = false;
  for (const key of keys) {
    const result = filterRows(next[key], predicate);
    if (!result.changed) continue;
    if (!changed) next = { ...next };
    next[key] = result.value;
    changed = true;
  }
  return next;
}

function withFilteredNestedRows(
  payload: PayloadRecord,
  key: string,
  nestedKeys: readonly string[],
  predicate: RowPredicate,
): PayloadRecord {
  const rows = payload[key];
  if (!Array.isArray(rows)) return payload;
  let changed = false;
  const nextRows = rows.map((value) => {
    const row = asRecord(value);
    if (!row) return value;
    const next = withFilteredRows(row, nestedKeys, predicate);
    if (next !== row) changed = true;
    return next;
  });
  return changed ? { ...payload, [key]: nextRows } : payload;
}

function withFilteredNestedObjectRows(
  payload: PayloadRecord,
  key: string,
  nestedKeys: readonly string[],
  predicate: RowPredicate,
): PayloadRecord {
  const nested = asRecord(payload[key]);
  if (!nested) return payload;
  const next = withFilteredRows(nested, nestedKeys, predicate);
  return next === nested ? payload : { ...payload, [key]: next };
}

/**
 * Remove explicitly non-public rows from an R2 public artifact without any
 * D1/KV/R2 access.  The function is deliberately payload-only and returns a
 * new object only when a row was removed, so it can be applied to both Cache
 * API and R2 reads without mutating the cached value.
 *
 * A top-level private video/event/user makes the artifact unusable and is
 * represented by `null`; callers then follow their existing miss/degraded
 * path.  Unknown/legacy rows without a visibility marker are preserved.
 */
export function filterPublicArtifactPayload<T>(
  targetType: StaticRebuildTargetType,
  payload: T | null | undefined,
  context?: PublicArtifactVisibilityContext,
): T | null {
  if (payload == null) return null;
  const root = asRecord(payload);
  if (!root) return payload;

  switch (targetType) {
    case "video": {
      const video = root.video;
      if (video != null && !isPublicVideoRow(video, context)) return null;
      let next = withFilteredRows(root, ["public_events"], (row) =>
        isPublicEventRow(row, context),
      );
      next = withFilteredRows(
        next,
        ["related_videos", "related_reserve", "related_random_reserve"],
        (row) => isPublicVideoRow(row, context),
      );
      return next as T;
    }
    case "event":
    case "event_base": {
      const event = root.event;
      if (event != null && !isPublicEventRow(event, context)) return null;
      return withFilteredRows(root, ["public_videos"], (row) =>
        isPublicVideoRow(row, context),
      ) as T;
    }
    case "events_index":
      return withFilteredNestedRows(
        withFilteredRows(
          withFilteredRows(root, ["items"], (row) =>
            isPublicEventRow(row, context),
          ),
          ["group_sections"],
          (row) => isPublicEventGroupRow(row, context),
        ),
        "group_sections",
        ["events"],
        (row) => isPublicEventRow(row, context),
      ) as T;
    case "top_events":
      return withFilteredRows(
        root,
        ["active_events", "latest_events"],
        (row) => isPublicEventRow(row, context),
      ) as T;
    case "top": {
      let next = withFilteredRows(
        root,
        ["recommended", "latest", "nostalgic", "nostalgic_pool", "items"],
        (row) => isPublicVideoRow(row, context),
      );
      next = withFilteredRows(
        next,
        ["active_events", "latest_events"],
        (row) => isPublicEventRow(row, context),
      );
      return withFilteredRows(next, ["creators"], (row) =>
        isPublicUserRow(row, context),
      ) as T;
    }
    case "top_recommended":
    case "top_latest":
      return withFilteredRows(
        root,
        ["items", "recommended", "latest"],
        (row) => isPublicVideoRow(row, context),
      ) as T;
    case "top_nostalgic":
      return withFilteredRows(
        root,
        ["pool", "display", "items"],
        (row) => isPublicVideoRow(row, context),
      ) as T;
    case "recommend":
    case "recommend_core":
      return withFilteredRows(
        withFilteredRows(
          root,
          ["recommended", "latest", "underrated"],
          (row) => isPublicVideoRow(row, context),
        ),
        ["creators"],
        (row) => isPublicUserRow(row, context),
      ) as T;
    case "list_recent":
    case "list_popular":
      return withFilteredRows(root, ["items"], (row) =>
        isPublicVideoRow(row, context),
      ) as T;
    case "search_index":
      return withFilteredRows(
        withFilteredRows(root, ["videos"], (row) =>
          isPublicVideoRow(row, context),
        ),
        ["users"],
        (row) => isPublicUserRow(row, context),
      ) as T;
    case "user": {
      const user = root.user;
      if (user != null && !isPublicUserRow(user, context)) return null;
      let next = withFilteredNestedObjectRows(
        root,
        "works",
        ["items"],
        (row) => isPublicVideoRow(row, context),
      );
      next = withFilteredNestedObjectRows(
        next,
        "collabs",
        ["items"],
        (row) => isPublicVideoRow(row, context),
      );
      return withFilteredRows(next, ["recent_videos", "items"], (row) =>
        isPublicVideoRow(row, context),
      ) as T;
    }
    case "users_index":
      return withFilteredRows(root, ["items"], (row) =>
        isPublicUserRow(row, context),
      ) as T;
    default:
      return payload;
  }
}
