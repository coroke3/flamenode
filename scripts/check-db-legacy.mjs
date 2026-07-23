import { readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join, relative, sep } from "node:path";

const ROOT = process.cwd();
const SCAN_DIRS = ["src", "app", "workers"];
const SCAN_EXTENSIONS = new Set([".ts", ".tsx", ".mjs", ".cjs", ".js"]);
const SKIP_FILES = new Set(["instrumentation.ts"]);

const LEGACY_IMPORT_BOUNDARY_PREFIXES = [
  "src/lib/import/legacy/",
  "app/api/admin/import/legacy/",
  "app/(admin)/admin/import/",
];
const LEGACY_IMPORT_BOUNDARY_FILES = new Set([
  "src/components/admin/LegacyCanonicalImportClient.tsx",
  "src/lib/admin/adminNavGroups.tsx",
]);
const LEGACY_INPUT_RULE_IDS = new Set([
  "legacy-import-runtime",
  "legacy-event-flags",
  "legacy-permission-mask",
  "legacy-event-staff-permissions-table",
  "legacy-used-software-json",
  "legacy-video-member-chapters-table",
  "legacy-video-chapter-member-id",
  "legacy-event-group-id",
  "legacy-custom-question-json",
  "legacy-custom-answer-json",
  "legacy-video-form-settings-json",
  "legacy-stage-permission",
  "deleted-tables",
  "legacy-event-visibility-sync",
  "legacy-video-youtube-metadata-youtube-id",
  "legacy-event-staff-role",
  "legacy-event-staff-user-id",
  "legacy-video-members-user-id",
  "legacy-x-users-columns",
]);

const RULES = [
  {
    id: "legacy-import-runtime",
    label: "専用境界外の旧形式インポート参照",
    pattern:
      /src\/lib\/import\/legacy|@\/lib\/import\/legacy|\/admin\/import\b|\/api\/admin\/import\/legacy\b|ENABLE_LEGACY_IMPORT_TOOL|LEGACY_IMPORT_PREVIEW_SECRET/g,
  },
  {
    id: "legacy-query-fallback",
    label: "旧schema向けquery fallback",
    pattern: /\b(withMissingColumnFallback|withVideoScoreFallback|queryFallback)\b/g,
  },
  {
    id: "legacy-event-flags",
    label: "削除済みevents状態フラグ",
    pattern:
      /\b(?:events|eventsTable)\.(?:is_active|is_entry_open|is_archived)\b|\bsql`(?=[^`]*\b(?:FROM|UPDATE|JOIN)\s+events\b)[^`]*\b(?:is_active|is_entry_open|is_archived)\b[^`]*`/g,
  },
  {
    id: "legacy-permission-mask",
    label: "削除済みevent_staff.permission_mask",
    pattern:
      /\b(?:eventStaff|event_staff)\.permission_mask\b|\bsql`[^`]*\bevent_staff\.permission_mask\b[^`]*`/g,
  },
  {
    id: "legacy-event-staff-permissions-table",
    label: "削除済みevent_staff_permissions",
    pattern: /\b(eventStaffPermissions|event_staff_permissions)\b/g,
  },
  {
    id: "legacy-used-software-json",
    label: "削除済みvideos.used_software_json",
    pattern:
      /\b(?:videos|videosTable)\.used_software_json\b|\bsql`[^`]*\bvideos\.used_software_json\b[^`]*`/g,
  },
  {
    id: "legacy-video-member-chapters-table",
    label: "削除済みvideo_member_chapters",
    pattern: /\bvideoMemberChapters\b|\bsql`[^`]*\bvideo_member_chapters\b[^`]*`/g,
  },
  {
    id: "legacy-video-chapter-member-id",
    label: "削除済みvideo_chapters.video_member_id",
    pattern:
      /\bvideoChapters\.video_member_id\b|\bsql`[^`]*\bvideo_chapters\.video_member_id\b[^`]*`/g,
  },
  {
    id: "legacy-event-group-id",
    label: "削除済みevents.event_group_id",
    pattern:
      /\b(?:events|eventsTable)\.event_group_id\b|\bsql`[^`]*\bevents\.event_group_id\b[^`]*`/g,
  },
  {
    id: "legacy-custom-question-json",
    label: "削除済みevents.custom_questions",
    pattern:
      /\b(?:events|eventsTable)\.custom_questions\b|\bsql`[^`]*\bevents\.custom_questions\b[^`]*`/g,
  },
  {
    id: "legacy-custom-answer-json",
    label: "削除済みvideos.custom_answers",
    pattern:
      /\b(?:videos|videosTable)\.custom_answers\b|\bsql`[^`]*\bvideos\.custom_answers\b[^`]*`/g,
  },
  {
    id: "legacy-video-form-settings-json",
    label: "削除済みevents.video_form_settings_json",
    pattern:
      /\b(?:events|eventsTable)\.video_form_settings_json\b|\bsql`[^`]*\bevents\.video_form_settings_json\b[^`]*`/g,
  },
  {
    id: "legacy-stage-permission",
    label: "削除済みstage_permission",
    pattern:
      /\b(?:videos|videosTable)\.stage_permission\b|\bstage_permission_(?:enabled|required|label|description|placeholder|question|answer)(?:_[a-z]+)?\b/g,
  },
  {
    id: "legacy-cost-guard",
    label: "削除済みsystem_settings cost guard列",
    pattern:
      /\b(?:systemSettings|system_settings)\.(?:cost_guard_mode|is_maintenance_mode)\b|\bsql`[^`]*\bsystem_settings\.(?:cost_guard_mode|is_maintenance_mode)\b[^`]*`/g,
  },
  {
    id: "deleted-tables",
    label: "削除済みテーブル",
    pattern:
      /\b(videoComments|video_comments|videoStats|video_stats|apiEndpoints|eventStaffPermissions|event_staff_permissions)\b|\bsql`[^`]*\b(?:video_comments|video_stats|api_endpoints|event_staff_permissions)\b[^`]*`/g,
  },
  {
    id: "legacy-video-youtube-metadata-youtube-id",
    label: "削除済みvideo_youtube_metadata.youtube_video_id",
    pattern:
      /\b(?:videoYoutubeMetadata|video_youtube_metadata)\.youtube_video_id\b|\bym\.youtube_video_id\b|\bsql`[^`]*\b(?:video_youtube_metadata|ym)\.youtube_video_id\b[^`]*`/g,
  },
  {
    id: "legacy-event-staff-role",
    label: "削除済みevent_staff.role",
    pattern:
      /\b(?:eventStaff|event_staff)\.role\b|\bsql`(?=[^`]*\bevent_staff\b)[^`]*\brole\s*=\s*'representative'\b[^`]*`/g,
  },
  {
    id: "legacy-event-staff-user-id",
    label: "削除済みevent_staff.user_id",
    pattern:
      /\b(?:eventStaff|event_staff)\.user_id\b|\bsql`(?=[^`]*\bevent_staff\b)[^`]*(?<![\w.])user_id\b[^`]*`/g,
  },
  {
    id: "legacy-video-members-user-id",
    label: "削除済みvideo_members.user_id",
    pattern:
      /\b(?:videoMembers|video_members)\.user_id\b|\bsql`(?=[^`]*\bvideo_members\b)[^`]*(?<![\w.])user_id\b[^`]*`/g,
  },
  {
    id: "legacy-x-users-columns",
    label: "削除済みx_users旧列",
    pattern:
      /\b(?:xUsers|x_users)\.(?:linked_user_id|updated_at|created_at)\b|\bxu\.(?:linked_user_id|updated_at|created_at)\b/g,
  },
  {
    id: "legacy-event-visibility-sync",
    label: "削除済みイベント状態同期helper",
    pattern:
      /\b(?:syncLegacyEventVisibilityFlags|computedEventLegacyFlags|enrichEventRowForStaticJson)\b/g,
  },
  {
    id: "legacy-permission-api",
    label: "削除済みpermission互換API",
    pattern: /\bLEGACY_PERMISSION_ALIASES\b|\bhasPermission\s*\(/g,
  },
  {
    id: "outro-comment-write",
    label: "廃止済みoutro_commentへの書き込み",
    pattern: /\boutro_comment\s*:/g,
  },
  {
    id: "runtime-schema-ddl",
    label: "通常ランタイム内のschema DDL",
    pattern: /\b(?:ALTER\s+TABLE|CREATE\s+TABLE|CREATE\s+INDEX|DROP\s+TABLE|DROP\s+INDEX)\b/gi,
    allowPrefixes: ["src/lib/integration/"],
  },
  {
    id: "runtime-backfill",
    label: "通常ランタイム内のbackfill",
    pattern: /\bbackfill(?:ing)?\b/gi,
    allowPrefixes: ["src/lib/integration/"],
  },
  {
    id: "history-logs",
    label: "削除済みhistory_logs",
    pattern: /\bhistoryLogs\b|\bsql`[^`]*\bhistory_logs\b[^`]*`/g,
    allowFiles: new Set(["src/lib/audit/helpers.ts"]),
  },
];

function toPosix(path) {
  return path.split(sep).join("/");
}

function isLegacyImportBoundary(relativePath) {
  return (
    LEGACY_IMPORT_BOUNDARY_FILES.has(relativePath) ||
    LEGACY_IMPORT_BOUNDARY_PREFIXES.some((prefix) => relativePath.startsWith(prefix))
  );
}

function walk(directory, files = []) {
  let entries;
  try {
    entries = readdirSync(directory);
  } catch {
    return files;
  }

  for (const entry of entries) {
    if (entry === "node_modules" || entry === ".next" || entry === ".git") continue;
    const fullPath = join(directory, entry);
    let stat;
    try {
      stat = statSync(fullPath);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      walk(fullPath, files);
    } else if (stat.isFile() && SCAN_EXTENSIONS.has(extname(fullPath))) {
      files.push(fullPath);
    }
  }
  return files;
}

function lineNumber(source, index) {
  let line = 1;
  for (let cursor = 0; cursor < index; cursor += 1) {
    if (source.charCodeAt(cursor) === 10) line += 1;
  }
  return line;
}

const violations = [];

for (const directory of SCAN_DIRS) {
  for (const file of walk(join(ROOT, directory))) {
    const relativePath = toPosix(relative(ROOT, file));
    if (SKIP_FILES.has(relativePath)) continue;

    const source = readFileSync(file, "utf8");
    for (const rule of RULES) {
      if (rule.allowFiles?.has(relativePath)) continue;
      if (rule.allowPrefixes?.some((prefix) => relativePath.startsWith(prefix))) continue;
      if (isLegacyImportBoundary(relativePath) && LEGACY_INPUT_RULE_IDS.has(rule.id)) continue;

      rule.pattern.lastIndex = 0;
      let match;
      while ((match = rule.pattern.exec(source)) !== null) {
        violations.push({
          rule: rule.id,
          label: rule.label,
          file: relativePath,
          line: lineNumber(source, match.index),
          hit: match[0],
        });
      }
    }
  }
}

if (violations.length === 0) {
  console.log("OK: legacy input identifiers are isolated to the admin import boundary.");
  process.exit(0);
}

console.error(`Detected ${violations.length} deprecated runtime usage hit(s):\n`);
for (const violation of violations) {
  console.error(
    `[${violation.rule}] ${violation.file}:${violation.line} ${violation.label}: ${violation.hit}`,
  );
}
process.exit(1);
