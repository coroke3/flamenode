export type AuditDiffKind = "added" | "removed" | "changed";

export interface AuditDiffEntry {
  key: string;
  label: string;
  kind: AuditDiffKind;
  before: unknown;
  after: unknown;
  beforeText: string;
  afterText: string;
  important: boolean;
}

export interface AuditDiffResult {
  beforeParsed: boolean;
  afterParsed: boolean;
  beforeRaw: string | null;
  afterRaw: string | null;
  beforePretty: string | null;
  afterPretty: string | null;
  changes: AuditDiffEntry[];
  changedKeys: string[];
}

const MISSING = Symbol("missing");
const DEFAULT_LIMIT = 160;

const KEY_LABELS: Record<string, string> = {
  title: "作品タイトル",
  youtube_video_id: "YouTube ID",
  creator_x_user_id: "投稿者X ID",
  creator_display_name: "投稿者名",
  visibility_status: "公開状態",
  primary_event_id: "主イベント",
  event_id: "イベント",
  stage_permission: "ステージ利用許可",
  music: "楽曲",
  credit: "クレジット",
  role: "権限",
  is_banned: "BAN状態",
  approval_status: "承認状態",
  status: "状態",
  slot_status: "枠状態",
  sync_status: "同期状態",
  sync_error: "同期エラー",
  can_edit: "編集権限",
  is_public_member: "公開メンバー",
  collaboration_type: "合作種別",
};

const IMPORTANT_KEYS = new Set([
  "visibility_status",
  "youtube_video_id",
  "creator_x_user_id",
  "role",
  "is_banned",
  "approval_status",
  "event_id",
  "primary_event_id",
  "slot_status",
  "status",
  "can_edit",
  "sync_status",
]);

function parseObject(raw: string | null): {
  parsed: boolean;
  value: Record<string, unknown> | null;
  pretty: string | null;
} {
  if (!raw) return { parsed: true, value: null, pretty: null };
  try {
    const value = JSON.parse(raw) as unknown;
    const pretty = JSON.stringify(value, null, 2);
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return { parsed: true, value: value as Record<string, unknown>, pretty };
    }
    return { parsed: true, value: { value }, pretty };
  } catch {
    return { parsed: false, value: null, pretty: raw };
  }
}

function stableStringify(value: unknown): string {
  if (value === MISSING) return "__missing__";
  if (value === undefined) return "__undefined__";
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function labelAuditKey(key: string): string {
  return KEY_LABELS[key] ?? key;
}

export function isImportantAuditKey(key: string): boolean {
  return IMPORTANT_KEYS.has(key);
}

export function formatAuditValue(value: unknown, limit = DEFAULT_LIMIT): string {
  if (value === MISSING) return "(未設定)";
  if (value === undefined) return "(undefined)";
  if (value === null) return "(null)";
  if (value === "") return "(空文字)";
  const text =
    typeof value === "string"
      ? value
      : (() => {
          try {
            return JSON.stringify(value);
          } catch {
            return String(value);
          }
        })();
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

export function parseAuditDiff(
  beforeRaw: string | null,
  afterRaw: string | null,
): AuditDiffResult {
  const before = parseObject(beforeRaw);
  const after = parseObject(afterRaw);
  if (!before.parsed || !after.parsed) {
    return {
      beforeParsed: before.parsed,
      afterParsed: after.parsed,
      beforeRaw,
      afterRaw,
      beforePretty: before.pretty,
      afterPretty: after.pretty,
      changes: [],
      changedKeys: [],
    };
  }

  const beforeObj = before.value ?? {};
  const afterObj = after.value ?? {};
  const keys = Array.from(
    new Set([...Object.keys(beforeObj), ...Object.keys(afterObj)]),
  ).sort();
  const changes: AuditDiffEntry[] = [];
  for (const key of keys) {
    const hasBefore = Object.prototype.hasOwnProperty.call(beforeObj, key);
    const hasAfter = Object.prototype.hasOwnProperty.call(afterObj, key);
    const beforeValue = hasBefore ? beforeObj[key] : MISSING;
    const afterValue = hasAfter ? afterObj[key] : MISSING;
    if (stableStringify(beforeValue) === stableStringify(afterValue)) continue;
    const kind: AuditDiffKind = !hasBefore
      ? "added"
      : !hasAfter
        ? "removed"
        : "changed";
    changes.push({
      key,
      label: labelAuditKey(key),
      kind,
      before: beforeValue,
      after: afterValue,
      beforeText: formatAuditValue(beforeValue),
      afterText: formatAuditValue(afterValue),
      important: isImportantAuditKey(key),
    });
  }

  return {
    beforeParsed: true,
    afterParsed: true,
    beforeRaw,
    afterRaw,
    beforePretty: before.pretty,
    afterPretty: after.pretty,
    changes,
    changedKeys: changes.map((c) => c.key),
  };
}
