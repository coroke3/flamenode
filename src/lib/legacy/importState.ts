import type { EnqueueStaticRebuildInput } from "@/lib/staticRebuild/types";
import type { EventVisibilityStatus } from "@/lib/utils/eventStatusCore";

export type LegacyImportMode = "archive" | "preserve" | "active_event" | "draft";

export type StaticRebuildStrategy = "none" | "summary" | "event" | "full";

export type ImportedEventFlags = {
  visibility_status: EventVisibilityStatus;
  is_active: 0 | 1;
  is_entry_open: 0 | 1;
  is_archived: 0 | 1;
};

/** 旧インポートで event_staff.permission_mask に入れる代表者向けキー（adminOnly 除外） */
export const LEGACY_REPRESENTATIVE_PERMISSION_KEYS = [
  "event.basic",
  "event.publish",
  "event.slots",
  "event.members",
  "event.questions",
  "event.review",
  "event.notifications",
  "video.basics",
  "video.descriptions",
  "video.credits",
  "video.members",
  "video.member_chapters",
  "video.status",
] as const;

export const LEGACY_BASIC_STAFF_PERMISSION_KEYS = [
  "event.basic",
  "event.publish",
  "event.slots",
  "event.questions",
  "event.review",
  "event.notifications",
  "video.basics",
  "video.descriptions",
  "video.credits",
  "video.members",
  "video.member_chapters",
  "video.status",
] as const;

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
}): ImportedEventFlags {
  if (args.mode === "draft") {
    return {
      visibility_status: "draft",
      is_active: 0,
      is_entry_open: 0,
      is_archived: 0,
    };
  }

  if (args.mode === "active_event") {
    return {
      visibility_status: "public",
      is_active: 1,
      is_entry_open: 0,
      is_archived: 0,
    };
  }

  if (args.mode === "archive") {
    return {
      visibility_status: "archived",
      is_active: 0,
      is_entry_open: 0,
      is_archived: 1,
    };
  }

  const end = args.endTime ?? null;
  const start = args.startTime ?? null;

  if (end && end < args.now) {
    return {
      visibility_status: "archived",
      is_active: 0,
      is_entry_open: 0,
      is_archived: 1,
    };
  }

  if (start && start <= args.now && (!end || end >= args.now)) {
    return {
      visibility_status: "public",
      is_active: 1,
      is_entry_open: 0,
      is_archived: 0,
    };
  }

  if (start && start > args.now) {
    return {
      visibility_status: "draft",
      is_active: 0,
      is_entry_open: 0,
      is_archived: 0,
    };
  }

  return {
    visibility_status: "archived",
    is_active: 0,
    is_entry_open: 0,
    is_archived: 1,
  };
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
  importMode: LegacyImportMode,
  eventIds: string[],
): string[] {
  const items = planStaticRebuildEnqueues({
    strategy,
    importMode,
    eventIds,
    videoIds: strategy === "full" ? ["*"] : [],
    xUserIds: strategy === "full" ? ["*"] : [],
  });
  if (items.length === 0) return ["なし"];
  return items.map((item) =>
    item.targetId === "global"
      ? item.targetType
      : `${item.targetType}:${item.targetId}`,
  );
}

export function legacyImportDbReductionNotes(kind: "event" | "video"): string[] {
  const shared = [
    "動画統計テーブルは作成しません（videos の統計列を使用）",
    "公開APIテーブルは作成しません（events.public_api_enabled を使用）",
    "announcements は作成しません",
  ];
  if (kind === "event") {
    return [
      ...shared,
      "event_staff.permission_mask を設定します",
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
  const sourceItems = Array.isArray(raw)
    ? raw
    : raw.split(/[,、\n]/);
  const items: string[] = [];
  const seen = new Set<string>();
  for (const sourceItem of sourceItems) {
    const item = sourceItem.trim().replace(/\s+/g, " ").slice(0, 80);
    if (!item) continue;
    const key = item.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    items.push(item);
    if (items.length >= 20) break;
  }
  if (items.length === 0) return null;
  return JSON.stringify({
    source: "legacy",
    raw: items.join(", "),
    items,
  });
}

export function importedStateLabel(flags: ImportedEventFlags): string {
  if (flags.visibility_status === "public") return "public";
  if (flags.visibility_status === "archived") return "archived";
  if (flags.visibility_status === "private") return "private";
  if (flags.visibility_status === "draft") return "draft";
  if (flags.is_archived === 1) return "archived";
  if (flags.is_active === 1) return "active";
  if (flags.is_archived === 0 && flags.is_active === 0) return "draft / scheduled";
  return "inactive";
}

export function legacyStaffPermissionKeys(
  isRepresentativeCandidate: boolean,
): string[] {
  const keys = isRepresentativeCandidate
    ? filterSafePermissionKeys(LEGACY_REPRESENTATIVE_PERMISSION_KEYS)
    : [...LEGACY_BASIC_STAFF_PERMISSION_KEYS];
  return keys;
}
