/**
 * legacy / deleted DB 利用検査 (静的ソース解析、DB 不要)。
 * 旧互換が残っていたら失敗する。
 *
 * Usage:
 *   node scripts/check-db-legacy.mjs
 *
 * exit 0 = OK, exit 1 = 違反検出
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const ROOT = process.cwd();
const SCAN_DIRS = ["src", "app", "workers"];
const SCAN_EXT = new Set([".ts", ".tsx", ".mjs", ".cjs", ".js"]);

const FULL_ALLOW = new Set([
  "scripts/check-db-legacy.mjs",
]);

const PREFIX_ALLOW = [
  "migrations/",
  "docs/",
];

const FILE_ALLOW = new Set([
  "src/lib/auth/permissions/mask.ts",
  "instrumentation.ts",
]);

const DB_REDUCTION_RULES = [
  {
    id: "events-legacy-flags",
    label: "events.is_active / is_entry_open / is_archived column usage",
    pattern:
      /\b(is_active|is_entry_open|is_archived)\b/g,
    prefixAllow: [...PREFIX_ALLOW, "src/lib/import/legacy/"],
    fileAllow: new Set(["src/lib/api/eventEndpointPayload.ts"]),
    skipLine: (line) =>
      line.includes("is_active:") ||
      line.includes("is_entry_open:") ||
      line.includes("is_archived:"),
  },
  {
    id: "permission-mask",
    label: "event_staff.permission_mask / number bitmask usage",
    pattern: /\bpermission_mask\b/g,
    prefixAllow: PREFIX_ALLOW,
    fileAllow: new Set(["src/lib/auth/permissions/mask.ts", "instrumentation.ts", "src/lib/import/legacy/types.ts", "src/lib/import/legacy/plan.test.mjs"]),
  },
  {
    id: "event-staff-permissions-table",
    label: "event_staff_permissions usage (removed)",
    pattern: /\b(eventStaffPermissions|event_staff_permissions)\b/g,
    prefixAllow: PREFIX_ALLOW,
  },
  {
    id: "used-software-json",
    label: "videos.used_software_json usage (removed; use video_softwares)",
    pattern: /\bused_software_json\b/g,
    prefixAllow: [...PREFIX_ALLOW, "src/lib/import/legacy/"],
  },
  {
    id: "video-member-chapters-table",
    label: "video_member_chapters / videoMemberChapters usage (removed)",
    pattern: /\b(videoMemberChapters|video_member_chapters)\b/g,
    prefixAllow: PREFIX_ALLOW,
  },
  {
    id: "video-chapters-member-id",
    label: "video_chapters.video_member_id usage (removed)",
    pattern: /\bvideo_member_id\b/g,
    prefixAllow: PREFIX_ALLOW,
    fileAllow: new Set([
      "src/lib/db/videoDetailQueries.ts",
      "src/lib/video/memberChaptersJson.ts",
    ]),
    skipLine: (line) =>
      line.includes("video_member_id:") ||
      line.includes("video_member_id,") ||
      line.includes("video_member_id ") ||
      line.includes("video_member_id}") ||
      line.includes("video_member_id;"),
  },
  {
    id: "event-group-id-column",
    label: "events.event_group_id usage (removed; use event_group_events)",
    pattern: /\bevent_group_id\b/g,
    prefixAllow: PREFIX_ALLOW,
  },
  {
    id: "custom-questions-json",
    label: "events.custom_questions JSON column usage",
    pattern: /\bcustom_questions\b/g,
    prefixAllow: PREFIX_ALLOW,
  },
  {
    id: "custom-answers-json",
    label: "videos.custom_answers JSON column usage",
    pattern: /\bcustom_answers\b/g,
    prefixAllow: PREFIX_ALLOW,
  },
  {
    id: "video-form-settings-json",
    label: "events.video_form_settings_json column usage",
    pattern: /\bvideo_form_settings_json\b/g,
    prefixAllow: PREFIX_ALLOW,
  },
  {
    id: "videos-stage-permission-column",
    label: "videos.stage_permission column usage",
    pattern: /\bstage_permission\b/g,
    prefixAllow: [...PREFIX_ALLOW, "src/lib/import/legacy/"],
    fileAllow: new Set([
      "src/lib/video/stagePermissionAnswers.ts",
      "src/lib/video/stagePermissionQuestions.ts",
      "src/lib/admin/videoReviewDetail.ts",
    ]),
  },
  {
    id: "cost-guard-mode",
    label: "system_settings.cost_guard_mode (use operation_mode)",
    pattern: /\bcost_guard_mode\b/g,
    prefixAllow: PREFIX_ALLOW,
  },
  {
    id: "is-maintenance-mode",
    label: "system_settings.is_maintenance_mode (use operation_mode)",
    pattern: /\bis_maintenance_mode\b/g,
    prefixAllow: PREFIX_ALLOW,
  },
  {
    id: "query-fallback",
    label: "withMissingColumnFallback / withVideoScoreFallback usage",
    pattern: /\b(withMissingColumnFallback|withVideoScoreFallback|queryFallback)\b/g,
    prefixAllow: PREFIX_ALLOW,
  },
  {
    id: "legacy-import",
    label: "legacy import module usage (@/lib/legacy)",
    // @/lib/legacy (旧モジュール) を禁止。新モジュールは @/lib/import/legacy
    pattern: /@\/lib\/legacy\b/g,
    prefixAllow: [],
  },
  {
    id: "legacy-import-old-api",
    label: "旧 legacy-import API ルート参照 (廃止済み)",
    // 旧 /api/admin/legacy-import 参照を禁止 (410 stub 自体は許可)
    pattern: /\/api\/admin\/legacy-import/g,
    prefixAllow: [],
    fileAllow: new Set([
      "app/api/admin/legacy-import/route.ts",
    ]),
  },
];

const RULES = [
  {
    id: "video-comments-usage",
    label: "削除済み video_comments / videoComments 利用",
    pattern: /\b(videoComments|video_comments)\b/g,
  },
  {
    id: "video-stats-usage",
    label: "video_stats / videoStats usage (removed)",
    pattern: /\b(videoStats|video_stats)\b/g,
  },
  {
    id: "api-endpoints-usage",
    label: "api_endpoints / apiEndpoints usage (removed)",
    pattern: /\b(apiEndpoints|api_endpoints)\b/g,
  },
  {
    id: "history-logs-usage",
    label: "history_logs / historyLogs usage (removed; use audit_logs)",
    pattern: /\b(historyLogs|history_logs)\b/g,
    prefixAllow: [],
    fileAllow: new Set(["src/lib/audit/helpers.ts"]),
  },
  {
    id: "outro-comment-write",
    label: "outro_comment 新規書き込み",
    pattern: /\boutro_comment\s*:/g,
  },
  {
    id: "sync-legacy-event-visibility",
    label: "syncLegacyEventVisibilityFlags usage (removed)",
    pattern: /\bsyncLegacyEventVisibilityFlags\b/g,
  },
  {
    id: "legacy-permission-aliases",
    label: "LEGACY_PERMISSION_ALIASES usage (removed)",
    pattern: /\bLEGACY_PERMISSION_ALIASES\b/g,
  },
  {
    id: "has-permission-mask",
    label: "hasPermission(number mask) usage (removed)",
    pattern: /\bhasPermission\s*\(/g,
    fileAllow: new Set(["src/lib/auth/permissions/mask.ts"]),
  },
];

function walk(dir, files = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return files;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      if (entry === "node_modules" || entry === ".next" || entry === ".git") {
        continue;
      }
      walk(full, files);
    } else if (st.isFile()) {
      const ext = full.slice(full.lastIndexOf("."));
      if (SCAN_EXT.has(ext)) files.push(full);
    }
  }
  return files;
}

function toPosix(p) {
  return p.split(sep).join("/");
}

function isPrefixAllowed(relPath, prefixes) {
  return prefixes.some((p) => relPath === p || relPath.startsWith(p));
}

function isAllowed(relPath) {
  return (
    FULL_ALLOW.has(relPath) ||
    FILE_ALLOW.has(relPath) ||
    isPrefixAllowed(relPath, PREFIX_ALLOW)
  );
}

function isRuleAllowed(relPath, rule) {
  return (
    isAllowed(relPath) ||
    isPrefixAllowed(relPath, rule.prefixAllow ?? []) ||
    (rule.fileAllow?.has(relPath) ?? false)
  );
}

function lineNumber(src, index) {
  let line = 1;
  for (let i = 0; i < index && i < src.length; i++) {
    if (src.charCodeAt(i) === 10) line++;
  }
  return line;
}

function lineAt(src, index) {
  const start = src.lastIndexOf("\n", index) + 1;
  const end = src.indexOf("\n", index);
  return src.slice(start, end === -1 ? undefined : end);
}

let violations = 0;
const all = [];

for (const sub of SCAN_DIRS) {
  const abs = join(ROOT, sub);
  for (const file of walk(abs)) {
    const rel = toPosix(relative(ROOT, file));
    if (isAllowed(rel)) continue;
    let src;
    try {
      src = readFileSync(file, "utf-8");
    } catch {
      continue;
    }
    for (const rule of RULES) {
      if (isRuleAllowed(rel, rule)) continue;
      rule.pattern.lastIndex = 0;
      let m;
      while ((m = rule.pattern.exec(src)) !== null) {
        const line = lineNumber(src, m.index);
        all.push({ rule: rule.id, label: rule.label, file: rel, line, hit: m[0] });
        violations++;
      }
    }
    for (const rule of DB_REDUCTION_RULES) {
      if (isRuleAllowed(rel, rule)) continue;
      rule.pattern.lastIndex = 0;
      let m;
      while ((m = rule.pattern.exec(src)) !== null) {
        if (rule.skipLine?.(lineAt(src, m.index))) continue;
        const line = lineNumber(src, m.index);
        all.push({ rule: rule.id, label: rule.label, file: rel, line, hit: m[0] });
        violations++;
      }
    }
  }
}

if (violations === 0) {
  console.log("OK: no deprecated DB usage detected.");
  process.exit(0);
}

console.error(`Detected ${violations} deprecated DB usage hit(s):\n`);
const byRule = new Map();
for (const v of all) {
  let list = byRule.get(v.rule);
  if (!list) {
    list = { label: v.label, items: [] };
    byRule.set(v.rule, list);
  }
  list.items.push(v);
}
for (const [id, { label, items }] of byRule) {
  console.error(`[${id}] ${label}: ${items.length} hit(s)`);
  for (const it of items) {
    console.error(`  - ${it.file}:${it.line}  ${it.hit}`);
  }
  console.error("");
}
process.exit(1);
