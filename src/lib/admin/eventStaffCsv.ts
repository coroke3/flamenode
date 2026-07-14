import { detectDelimiter, parseDelimited } from "#utils/delimited";
import { canonicalizePermissionKey } from "../auth/permissions/aliases.ts";
import {
  isAdminOnlyKey,
  type PermissionKey,
} from "../auth/permissions/keys.ts";
import {
  isEventStaffPreset,
  PRESET_DEFINITIONS,
  type EventStaffPreset,
} from "../auth/permissions/presets.ts";

export type EventStaffCsvPreset = EventStaffPreset;
export type EventStaffCsvAction = "create" | "update";

export interface EventStaffCsvExistingSubject {
  x_user_id: string | null;
  user_id: string | null;
}

export interface EventStaffCsvRow {
  lineNumber: number;
  display_name: string;
  x_user_id: string;
  user_id: string;
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
  counts: {
    create: number;
    update: number;
    error: number;
  };
  hasErrors: boolean;
}

/**
 * CSV の第3列は Discord Snowflake ではなく Auth.js の内部ユーザー ID である。
 * 旧5列形式および旧識別子形式は本格運用前の整理として受け付けない。
 */
export const EVENT_STAFF_CSV_HEADER =
  "表示名,X ID,ユーザー ID,担当プリセット,公開フラグ,公開ラベル";

export const EVENT_STAFF_CSV_SAMPLE = [
  EVENT_STAFF_CSV_HEADER,
  "進行担当,yamada,,slot_manager,1,進行",
  "審査担当,sato,,reviewer,0,",
  "作品修正担当,tanaka,,content_editor,0,",
].join("\n");

function normalizeXIdForCsv(raw: string): string {
  return raw.replace(/^@+/, "").trim().toLowerCase();
}

function parseAssignment(raw: string): {
  preset: EventStaffCsvPreset;
  keys: PermissionKey[];
  errors: string[];
} {
  const value = raw.trim();
  if (!value) {
    return { preset: "public_staff", keys: [], errors: [] };
  }
  if (isEventStaffPreset(value)) {
    return { preset: value, keys: [], errors: [] };
  }

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
  const cells = row.map((cell) => cell.trim().toLowerCase());
  const first = cells[0] ?? "";
  const second = cells[1] ?? "";
  return (
    (first === "表示名" || first === "display_name" || first === "name") &&
    (second === "x id" || second === "x_id" || second === "x user id")
  );
}

function subjectKey(row: EventStaffCsvExistingSubject): string[] {
  const keys: string[] = [];
  if (row.x_user_id) keys.push(`x:${normalizeXIdForCsv(row.x_user_id)}`);
  if (row.user_id) keys.push(`u:${row.user_id.trim()}`);
  return keys;
}

function resolveAction(
  xUserId: string,
  userId: string,
  existingKeys: ReadonlySet<string>,
): EventStaffCsvAction {
  if (xUserId && existingKeys.has(`x:${xUserId}`)) return "update";
  if (userId && existingKeys.has(`u:${userId}`)) return "update";
  return "create";
}

export function buildEventStaffCsvPreview(args: {
  text: string;
  existingSubjects: readonly EventStaffCsvExistingSubject[];
  isSiteAdmin: boolean;
}): EventStaffCsvPreview {
  const existingKeys = new Set(args.existingSubjects.flatMap(subjectKey));
  const parsedRows = parseDelimited(args.text, detectDelimiter(args.text))
    .map((row) => row.map((cell) => cell.trim()))
    .filter((row) => row.some(Boolean));
  const rows: EventStaffCsvRow[] = [];

  parsedRows.forEach((cols, index) => {
    const lineNumber = index + 1;
    if (index === 0 && isHeaderRow(cols)) return;

    const [
      rawDisplayName = "",
      rawXUserId = "",
      rawUserId = "",
      rawAssignment = "",
      rawPublicFlag = "0",
      rawPublicLabel = "",
    ] = cols;
    const displayName = rawDisplayName.trim() || `共同編集者 ${lineNumber}`;
    const xUserId = normalizeXIdForCsv(rawXUserId);
    const userId = rawUserId.trim();
    const assignment = parseAssignment(rawAssignment);
    const errors = [...assignment.errors];
    const warnings: string[] = [];

    if (cols.length !== 6) {
      errors.push("正本CSVは「表示名,X ID,ユーザー ID,担当プリセット,公開フラグ,公開ラベル」の6列です。");
    }
    if (!xUserId && !userId) {
      errors.push("X ID か内部ユーザー ID のどちらかが必要です。");
    }
    if (rawXUserId.trim() && !/^[a-z0-9_]{1,64}$/.test(xUserId)) {
      errors.push("X ID の形式が正しくありません。");
    }
    if (assignment.preset === "owner") {
      errors.push("代表者の追加・変更はCSVでは行えません。専用の代表者移譲操作を使用してください。");
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
      user_id: userId,
      permission_preset: assignment.preset,
      permission_keys: assignment.keys,
      is_public_staff: rawPublicFlag.trim() === "1" ? "1" : "0",
      public_role_label: rawPublicLabel.trim(),
      action: resolveAction(xUserId, userId, existingKeys),
      errors: Array.from(new Set(errors)),
      warnings,
    });
  });

  const counts = rows.reduce(
    (acc, row) => {
      if (row.errors.length > 0) acc.error += 1;
      else if (row.action === "update") acc.update += 1;
      else acc.create += 1;
      return acc;
    },
    { create: 0, update: 0, error: 0 },
  );

  return {
    rows,
    counts,
    hasErrors: counts.error > 0,
  };
}

export function eventStaffCsvPresetLabel(preset: EventStaffCsvPreset): string {
  return PRESET_DEFINITIONS[preset].label;
}
