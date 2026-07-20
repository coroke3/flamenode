import { detectDelimiter, parseDelimited } from "#utils/delimited";
import { canonicalizePermissionKey } from "../auth/permissions/aliases.ts";
import { isAdminOnlyKey, type PermissionKey } from "../auth/permissions/keys.ts";
import {
  isEventStaffPreset,
  PRESET_DEFINITIONS,
  type EventStaffPreset,
} from "../auth/permissions/presets.ts";

export type EventStaffCsvPreset = EventStaffPreset;
export type EventStaffCsvAction = "create" | "update";

export interface EventStaffCsvExistingSubject {
  x_user_id: string;
}

export interface EventStaffCsvRow {
  lineNumber: number;
  display_name: string;
  x_user_id: string;
  permission_preset: EventStaffCsvPreset;
  permission_keys: PermissionKey[];
  is_public_staff: "0" | "1";
  public_role_label: string;
  action: EventStaffCsvAction;
  errors: string[];
  warnings: string[];
}

export interface EventStaffCsvPreview {
  rows: EventStaffCsvRow[];
  counts: { create: number; update: number; error: number };
  hasErrors: boolean;
}

export const EVENT_STAFF_CSV_HEADER =
  "表示名,X ID,担当プリセット,公開フラグ,公開ラベル";

export const EVENT_STAFF_CSV_SAMPLE = [
  EVENT_STAFF_CSV_HEADER,
  "進行担当,yamada,slot_manager,1,進行",
  "審査担当,sato,reviewer,0,",
  "作品修正担当,tanaka,content_editor,0,",
].join("\n");

function normalizeXId(raw: string): string {
  return raw.replace(/^@+/, "").trim().toLowerCase();
}

function parseAssignment(raw: string): {
  preset: EventStaffCsvPreset;
  keys: PermissionKey[];
  errors: string[];
} {
  const value = raw.trim();
  if (!value) return { preset: "public_staff", keys: [], errors: [] };
  if (isEventStaffPreset(value)) return { preset: value, keys: [], errors: [] };
  const keySource = value.startsWith("custom:")
    ? value.slice("custom:".length)
    : value;
  const keys: PermissionKey[] = [];
  const errors: string[] = [];
  for (const part of keySource.split(/[|;]/)) {
    const canonical = canonicalizePermissionKey(part.trim());
    if (!canonical) {
      if (part.trim()) errors.push("選べない権限が含まれています。");
      continue;
    }
    if (!keys.includes(canonical)) keys.push(canonical);
  }
  return {
    preset: keys.length > 0 ? "custom" : "public_staff",
    keys,
    errors: Array.from(new Set(errors)),
  };
}

function isHeaderRow(row: readonly string[]): boolean {
  const first = row[0]?.trim().toLowerCase() ?? "";
  const second = row[1]?.trim().toLowerCase() ?? "";
  return (
    (first === "表示名" || first === "display_name" || first === "name") &&
    (second === "x id" || second === "x_id" || second === "x user id")
  );
}

export function buildEventStaffCsvPreview(args: {
  text: string;
  existingSubjects: readonly EventStaffCsvExistingSubject[];
  isSiteAdmin: boolean;
}): EventStaffCsvPreview {
  const existing = new Set(
    args.existingSubjects.map((row) => normalizeXId(row.x_user_id)),
  );
  const parsedRows = parseDelimited(args.text, detectDelimiter(args.text))
    .map((row) => row.map((cell) => cell.trim()))
    .filter((row) => row.some(Boolean));
  const rows: EventStaffCsvRow[] = [];

  parsedRows.forEach((cols, index) => {
    if (index === 0 && isHeaderRow(cols)) return;
    const lineNumber = index + 1;
    const [
      rawDisplayName = "",
      rawXUserId = "",
      rawAssignment = "",
      rawPublicFlag = "0",
      rawPublicLabel = "",
    ] = cols;
    const displayName = rawDisplayName.trim() || `運営メンバー ${lineNumber}`;
    const xUserId = normalizeXId(rawXUserId);
    const assignment = parseAssignment(rawAssignment);
    const errors = [...assignment.errors];
    if (cols.length !== 5) {
      errors.push(
        "正本CSVは「表示名,X ID,担当プリセット,公開フラグ,公開ラベル」の5列です。",
      );
    }
    if (!/^[a-z0-9_]{1,32}$/.test(xUserId)) {
      errors.push("X ID の形式が正しくありません。");
    }
    if (assignment.preset === "owner") {
      errors.push(
        "代表者の追加・変更はCSVでは行えません。専用の代表者移譲操作を使用してください。",
      );
    }
    if (assignment.preset === "xid_reviewer" && !args.isSiteAdmin) {
      errors.push("X ID確認担当プリセットは site admin だけが付与できます。");
    }
    if (
      !args.isSiteAdmin &&
      assignment.keys.some((key) => isAdminOnlyKey(key))
    ) {
      errors.push("site admin 専用権限はイベント運営者から付与できません。");
    }
    rows.push({
      lineNumber,
      display_name: displayName,
      x_user_id: xUserId,
      permission_preset: assignment.preset,
      permission_keys: assignment.keys,
      is_public_staff: rawPublicFlag === "1" ? "1" : "0",
      public_role_label: rawPublicLabel.trim(),
      action: existing.has(xUserId) ? "update" : "create",
      errors: Array.from(new Set(errors)),
      warnings: [],
    });
  });

  const counts = rows.reduce(
    (acc, row) => {
      if (row.errors.length > 0) acc.error += 1;
      else acc[row.action] += 1;
      return acc;
    },
    { create: 0, update: 0, error: 0 },
  );
  return { rows, counts, hasErrors: counts.error > 0 };
}

export function eventStaffCsvPresetLabel(preset: EventStaffCsvPreset): string {
  return PRESET_DEFINITIONS[preset].label;
}
