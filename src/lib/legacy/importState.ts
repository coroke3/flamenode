import type { EnqueueStaticRebuildInput } from "@/lib/staticRebuild/types";

export type LegacyImportMode = "archive" | "preserve" | "active_event" | "draft";

export type StaticRebuildStrategy = "none" | "summary" | "event" | "full";

export type ImportedEventFlags = {
  is_active: 0 | 1;
  is_entry_open: 0 | 1;
  is_archived: 0 | 1;
};

/** 旧インポートで event_staff.permission_keys_json に入れる代表者向けキー（危険キー除外） */
export const LEGACY_REPRESENTATIVE_PERMISSION_KEYS = [
  "event.basic",
  "event.slots",
  "event.members",
  "event.questions",
  "videos.title",
  "videos.music_credit",
  "videos.members",
  "videos.review_data",
] as const;

export const LEGACY_BASIC_STAFF_PERMISSION_KEYS = ["event.basic"] as const;

const DANGEROUS_PERMISSION_PREFIXES = ["admin.", "system."] as const;
const DANGEROUS_PERMISSION_KEYS = new Set([
  "videos.youtube_id",
  "videos.primary_event",
  "video.identity",
  "video.chapter_admin",
]);

export function filterSafePermissionKeys(keys: readonly string[]): string[] {
  return keys.filter(
    (key) =>
      !DANGEROUS_PERMISSION_KEYS.has(key) &&
      !DANGEROUS_PERMISSION_PREFIXES.some((prefix) => key.startsWith(prefix)),
  );
}

export function resolveImportedEventState(args: {
  mode: LegacyImportMode;
  startTime: number | null;
  endTime: number | null;
  now: number;
  forceEntryOpen?: boolean;
}): ImportedEventFlags {
  if (args.mode === "draft") {
    return { is_active: 0, is_entry_open: 0, is_archived: 0 };
  }

  if (args.mode === "active_event") {
    return {
      is_active: 1,
      is_entry_open: args.forceEntryOpen ? 1 : 0,
      is_archived: 0,
    };
  }

  if (args.mode === "archive") {
    return { is_active: 0, is_entry_open: 0, is_archived: 1 };
  }

  const end = args.endTime ?? null;
  const start = args.startTime ?? null;

  if (end && end < args.now) {
    return { is_active: 0, is_entry_open: 0, is_archived: 1 };
  }

  if (start && start <= args.now && (!end || end >= args.now)) {
    return {
      is_active: 1,
      is_entry_open: args.forceEntryOpen ? 1 : 0,
      is_archived: 0,
    };
  }

  if (start && start > args.now) {
    return {
      is_active: 0,
      is_entry_open: args.forceEntryOpen ? 1 : 0,
      is_archived: 0,
    };
  }

  return { is_active: 0, is_entry_open: 0, is_archived: 1 };
}

export function defaultStaticRebuildStrategy(
  importMode: LegacyImportMode,
  dryRun: boolean,
): StaticRebuildStrategy {
  if (dryRun) return "none";
  if (importMode === "draft") return "none";
  if (importMode === "active_event") return "event";
  return "event";
}

export function planStaticRebuildEnqueues(args: {
  strategy: StaticRebuildStrategy;
  importMode: LegacyImportMode;
  eventIds: string[];
  videoIds: string[];
  xUserIds: string[];
}): EnqueueStaticRebuildInput[] {
  if (args.strategy === "none" || args.importMode === "draft") {
    return [];
  }

  const items: EnqueueStaticRebuildInput[] = [
    {
      targetType: "events_index",
      targetId: "global",
      reason: "legacy_import",
      priority: "low",
    },
    {
      targetType: "search_index",
      targetId: "global",
      reason: "legacy_import",
      priority: "low",
    },
  ];

  if (args.strategy === "summary" || args.strategy === "event" || args.strategy === "full") {
    if (args.importMode !== "archive") {
      items.push({
        targetType: "list_recent",
        targetId: "global",
        reason: "legacy_import",
        priority: "low",
      });
    }
  }

  if (args.strategy === "event" || args.strategy === "full") {
    for (const eventId of args.eventIds) {
      items.push({
        targetType: "event",
        targetId: eventId,
        reason: "legacy_import",
        priority: "low",
      });
    }
  }

  if (args.strategy === "full") {
    for (const videoId of args.videoIds) {
      items.push({
        targetType: "video",
        targetId: videoId,
        reason: "legacy_import",
        priority: "low",
      });
    }
    for (const xUserId of args.xUserIds) {
      items.push({
        targetType: "user",
        targetId: xUserId,
        reason: "legacy_import",
        priority: "low",
      });
    }
  }

  return items;
}

export function staticRebuildTargetLabels(
  strategy: StaticRebuildStrategy,
  eventIds: string[],
): string[] {
  if (strategy === "none") return ["なし"];
  const labels = ["events_index", "search_index"];
  if (strategy !== "summary") labels.push("list_recent");
  if (strategy === "event" || strategy === "full") {
    for (const id of eventIds) labels.push(`event:${id}`);
  }
  if (strategy === "full") labels.push("video:*", "user:*");
  return labels;
}

export function legacyImportDbReductionNotes(kind: "event" | "video"): string[] {
  const shared = [
    "video_stats は作成しません（videos の統計列を使用）",
    "api_endpoints は作成しません",
    "announcements は作成しません",
  ];
  if (kind === "event") {
    return [
      ...shared,
      "event_staff_permissions は作成しません（permission_keys_json に統合）",
      "public_api_enabled は 0 のままです",
    ];
  }
  return [
    ...shared,
    "video_softwares は作成しません（used_software_json に統合）",
    "video_youtube_metadata は作成します",
  ];
}

export function buildUsedSoftwareJson(
  raw: string | string[] | null | undefined,
): string | null {
  if (!raw) return null;
  const items = (
    Array.isArray(raw)
      ? raw
      : raw.split(/[,、\n]/).map((part) => part.trim())
  ).filter(Boolean);
  if (items.length === 0) return null;
  return JSON.stringify({
    source: "legacy",
    raw: items.join(", "),
    items,
  });
}

export function importedStateLabel(flags: ImportedEventFlags): string {
  if (flags.is_archived === 1) return "archived";
  if (flags.is_active === 1 && flags.is_entry_open === 1) return "active (entry open)";
  if (flags.is_active === 1) return "active";
  if (flags.is_archived === 0 && flags.is_active === 0) return "draft / scheduled";
  return "inactive";
}

export function legacyStaffPermissionKeysJson(
  isRepresentativeCandidate: boolean,
): string {
  const keys = isRepresentativeCandidate
    ? filterSafePermissionKeys(LEGACY_REPRESENTATIVE_PERMISSION_KEYS)
    : [...LEGACY_BASIC_STAFF_PERMISSION_KEYS];
  return JSON.stringify(keys);
}
