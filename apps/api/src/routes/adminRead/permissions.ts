import {
  PERMISSION_DEFINITIONS,
  canonicalizePermissionKey,
  type PermissionKey,
} from "@flamenode/domain/auth/permissions";

// Port of src/lib/auth/permissions/{presets,permissionResolver}.ts + simulateEventPermissions' labels
// (src/lib/admin/permissionSimulator.ts). Those modules import only the domain registry, so the logic is identical;
// the parity test compares every preset and custom case with the real module. Remove with the CURRENT modules.

const PRESETS = {
  owner: {
    label: "代表",
    permissions: [
      "event.basic", "event.publish", "event.slots", "event.members", "event.questions", "event.review",
      "event.notifications", "video.basics", "video.descriptions", "video.credits", "video.members",
      "video.member_chapters", "video.status", "video.permissions",
    ],
  },
  manager: {
    label: "運営",
    permissions: [
      "event.basic", "event.publish", "event.slots", "event.questions", "event.review", "event.notifications",
      "video.basics", "video.descriptions", "video.credits", "video.members", "video.member_chapters",
      "video.status", "video.permissions",
    ],
  },
  reviewer: { label: "レビュー担当", permissions: ["event.review", "video.status"] },
  slot_manager: { label: "枠管理担当", permissions: ["event.slots"] },
  content_editor: {
    label: "作品修正担当",
    permissions: ["video.basics", "video.descriptions", "video.credits", "video.members", "video.member_chapters"],
  },
  xid_reviewer: { label: "X ID確認担当", permissions: ["xid.link_requests"] },
  public_staff: { label: "表示のみスタッフ", permissions: [] },
  custom: { label: "カスタム", permissions: [] },
} as const satisfies Record<string, { label: string; permissions: readonly string[] }>;

type Preset = keyof typeof PRESETS;

function isPreset(value: unknown): value is Preset {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(PRESETS, value);
}

function customKeys(json: string | null | undefined): PermissionKey[] {
  if (!json) return [];
  try {
    const parsed: unknown = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    const out = new Set<PermissionKey>();
    for (const raw of parsed.filter((v): v is string => typeof v === "string")) {
      const key = canonicalizePermissionKey(raw);
      if (key) out.add(key); // allowAdminOnly: true -> no isAdminOnlyKey filter
    }
    return Array.from(out);
  } catch {
    return [];
  }
}

/** resolveStaffPermissionKeys */
export function resolveStaffPermissionKeys(row: {
  permission_preset?: string | null;
  custom_permission_keys_json?: string | null;
}): Set<PermissionKey> {
  const keys = new Set<PermissionKey>();
  if (row.permission_preset === "custom") {
    for (const key of customKeys(row.custom_permission_keys_json)) keys.add(key);
    return keys;
  }
  if (isPreset(row.permission_preset)) {
    for (const key of PRESETS[row.permission_preset].permissions) keys.add(key as PermissionKey);
  }
  return keys;
}

export const SPOTLIGHT_KEYS: PermissionKey[] = [
  "event.basic",
  "event.slots",
  "event.review",
  "event.members",
  "video.status",
  "video.descriptions",
  "event.notifications",
];

export function permissionLabel(key: PermissionKey): string {
  return PERMISSION_DEFINITIONS[key]?.label ?? key;
}

export function presetLabel(preset: string): string {
  return isPreset(preset) ? PRESETS[preset].label : preset;
}
