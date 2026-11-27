/**
 * MIG-0657 U02/U03: SA-065..068 slot reservation / release / extend / merge core.
 *
 * Ports CURRENT src/lib/actions/slot.ts (:455..1009) to framework-neutral server-core:
 * - Same validation messages, actor/X-ID/group-integrity/adjacency/limit rules
 * - Single bounded D1 pre-read per request + 1 atomic mutateWithAudit batch (ZERO_1102 S3)
 * - Same notification_outbox + static_rebuild_queue rows, 0 Queue wakes (D-13-41)
 * - No Next revalidatePath; no ambient env/global access (D-10)
 */
import type { BatchItem } from "drizzle-orm/batch";
import type { slots } from "@flamenode/db/schema";
import { expandPermissionAliases } from "@flamenode/domain/auth/permissions";
import { staffRowHasPermissionKey, type StaffPermissionRow } from "@flamenode/domain/auth/permissions/resolver";
import { isAcceptingEntries } from "@flamenode/domain/event/status";
import { buildSlotReserveMutationPlan } from "@flamenode/domain/slots/reserveMutations";
import { buildSlotReleaseMutationPlan } from "@flamenode/domain/slots/releaseMutations";
import { buildRegroupMutations } from "@flamenode/domain/slots/regroupMutations";
import { assertBoundedSlotGroupIntegrity } from "@flamenode/domain/slots/boundedGroup";
import { MAX_SLOTS_PER_VIDEO, normalizeMaxSlotsPerVideo } from "@flamenode/domain/slots/limits";
import { canUseSlotOperatorOverride } from "@flamenode/domain/slots/operatorReservation";
import { slotPartGapSec } from "@flamenode/domain/slots/partGap";
import { resolveSlotReservationSubject, subjectsEqual } from "@flamenode/domain/slots/reservationGroups";
import {
  resolveReservationXIdentityFromPending,
  SLOT_RESERVATION_X_REQUEST_TYPES,
} from "@flamenode/domain/slots/reservationIdentity";
import { normalizeSlotReservationLimit, slotReservationLimitMessage } from "@flamenode/domain/slots/reservationLimit";
import {
  canActAsSlotActor,
  resolveSlotGroupIdentity,
  resolveSlotViewerRelation,
  type SlotViewerRelation,
} from "@flamenode/domain/slots/slotIdentity";
import { normalizeXId } from "@flamenode/domain/xid";
import type { PreloadedAuditContext } from "../audit/logger.ts";
import type { ServerCoreDb } from "../db.ts";
import { generateId } from "../id.ts";
import type { NotificationActor } from "../notifications/actor.ts";
import { buildOpsChannelWebhookStatement } from "../notifications/opsOutbox.ts";
import {
  buildChannelSlotReservedNotification,
  buildSlotReservedOpsThreadName,
} from "../notifications/slotReservedChannel.ts";
import type { QueueWakeHostLoader } from "../ports.ts";
import { commitSlotMutationPlanCore, type SlotCoreBulkMutation } from "./commitSlotMutationPlan.ts";
import {
  buildReservationLimitGuardStatement,
  loadLogicalReservationCountForXId,
} from "./reservationLimitGuard.ts";

export type SlotRow = typeof slots.$inferSelect;

export type SlotD1Like = {
  prepare(query: string): {
    bind(...values: unknown[]): {
      first<T = Record<string, unknown>>(): Promise<T | null>;
    };
  };
};

export type SlotMutationContext = {
  authUserId: string;
  activeXId: string | null;
  userRole: string | null;
  siteUrl: string | null | undefined;
  preloaded?: PreloadedAuditContext;
};

export type SlotMutationOutcome = {
  status: 200 | 400 | 403 | 404 | 409 | 503;
  body:
    | {
        ok: true;
        slotId: string;
        slotCount: number;
        groupSize: number;
        pendingPublicReflection: true;
      }
    | { ok: false; message: string };
};

type EventFacts = {
  id: string;
  title: string;
  visibility_status: "private" | "public";
  start_time: number | null;
  end_time: number | null;
  entry_start_time: number | null;
  entry_end_time: number | null;
  max_slots_per_video: number;
  max_slot_reservation_groups_per_xid: number;
  slot_part_gap_minutes: number | null;
};

const MAX_ATOMIC_SLOT_ROWS = 3;
const MAX_APPROVED_X_IDS = 100;
const MAX_PENDING_RESERVATION_REQUESTS = 100;
const MAX_OPERATOR_STAFF_ROWS = 100;
// SEC #716: SQLite length(TEXT) stops at NUL. Bound the complete legacy TEXT
// bytes in SQL before its first D1 JSON1 projection, not after JSON.parse.
// CURRENT legacy X identity uses up to 128 Unicode codepoints. The 128-emoji
// positive boundary occupies 512 UTF-8 bytes (same as viewer-overlay #705).
const MAX_LEGACY_X_ID_CODEPOINTS = 128;
const MAX_LEGACY_X_ID_BYTES = 512;
const MAX_X_ID_JSON_BUDGET_BYTES = 12 * 1024;
const MAX_ACTOR_NAME_BYTES = 512;
const MAX_ACTOR_USER_ID_BYTES = 128;
const MAX_ACTOR_DISCORD_ID_BYTES = 128;
// Staff permission JSON is joined from legacy TEXT: bound both the individual
// value and the worst-case escaped aggregate BEFORE constructing SQLite JSON1.
const MAX_STAFF_PRESET_BYTES = 128;
const MAX_STAFF_CUSTOM_KEYS_BYTES = 2048;
const MAX_STAFF_JSON_BUDGET_BYTES = 20 * 1024;
// Individual event/slot strings must never enter JSON1 unbounded. These are
// conservative byte limits for legacy data, NOT silent truncation limits.
const MAX_LEGACY_RECORD_ID_BYTES = 128;
const MAX_EVENT_TITLE_BYTES = 4096;
const MAX_SLOT_DISPLAY_NAME_BYTES = 512;
const MAX_SLOT_LABEL_BYTES = 2048;
const MAX_EVENT_STATUS_BYTES = 32;
const MAX_SLOT_STATUS_BYTES = 32;
// D1 transports every SQL string as an enclosing JSON string. JSON1 escape
// characters are escaped AGAIN on the wire, so raw SQL column bytes alone
// are NOT a safe response-size bound. Reserve ~6KiB for row keys/metadata.
const MAX_FIRST_D1_SNAPSHOT_BYTES = 58 * 1024;

function invalidSqlNumber(expr: string): string {
  return `(typeof(${expr}) NOT IN ('integer', 'real', 'null'))`;
}

function invalidJsonSnapshot(snapshot: object): boolean {
  // All first-D1 snapshots return a fixed synthetic error marker if their
  // projected row was over budget. Never parse/use partial authorized groups.
  return Object.entries(snapshot).some(
    ([key, value]) => (key === "invalid_snapshot" && value === 1) ||
      (typeof value === "string" && value.includes('"__invalid_projection":1')),
  );
}

// Only known aliases are passed by the four core mutation paths. The inner
// query remains ONE D1 statement with identical bind order. Preflight the
// actual outer JSON string quoting of each already-bounded SQL result field,
// including the *second* layer of escaping for embedded JSON strings. This
// prevents a 37KiB SQL string-row from becoming a >64KiB D1 transport row.
// Reject all oversized columns atomically with an explicit sentinel.
function boundedFirstD1SnapshotSql(
  query: string,
  fields: readonly string[],
  optionalField?: string,
): string {
  const items = fields.map(field => `p."${field}"`);
  const total = items.map(item =>
    `length(CAST(json_quote(${item}) AS BLOB))`).join(" + ");
  const projection = fields.map((field, index) =>
    `CASE WHEN sz."bytes" > ${MAX_FIRST_D1_SNAPSHOT_BYTES} THEN NULL ELSE ${items[index]} END AS "${field}"`,
  ).join(", ");
  // An optional optimization must not make an otherwise valid mandatory
  // snapshot fail the transport budget. Keep its value only if both fit.
  const optionalProjection = optionalField === undefined ? "" :
    `, CASE WHEN sz."bytes" + length(CAST(json_quote(p."${optionalField}") AS BLOB))
          > ${MAX_FIRST_D1_SNAPSHOT_BYTES} THEN NULL
          ELSE p."${optionalField}" END AS "${optionalField}"`;
  return `WITH projected_snapshot AS MATERIALIZED (${query}),
    snapshot_bytes AS MATERIALIZED (
      SELECT (${total}) AS "bytes" FROM projected_snapshot p
    )
    SELECT ${projection}${optionalProjection},
           CASE WHEN sz."bytes" > ${MAX_FIRST_D1_SNAPSHOT_BYTES}
             THEN 1 ELSE 0 END AS "invalid_snapshot"
    FROM projected_snapshot p CROSS JOIN snapshot_bytes sz`;
}

function invalidSqlText(expr: string, bytes: number): string {
  return `(${expr} IS NOT NULL AND (
    typeof(${expr}) <> 'text' OR
    instr(${expr}, char(0)) > 0 OR
    length(CAST(${expr} AS BLOB)) > ${bytes}
  ))`;
}

// Preserve 128 Unicode codepoints, including 4-byte emoji. LENGTH(TEXT)
// counts SQLite Unicode codepoints, while BLOB covers all bytes after NUL.
function invalidLegacyXIdSql(expr: string): string {
  return `(${invalidSqlText(expr, MAX_LEGACY_X_ID_BYTES)} OR
    (${expr} IS NOT NULL AND length(${expr}) > ${MAX_LEGACY_X_ID_CODEPOINTS}))`;
}

function boundedReserveActorJsonSql(): string {
  const invalid = [
    invalidSqlText('u."id"', MAX_ACTOR_USER_ID_BYTES),
    invalidSqlText('u."discord_id"', MAX_ACTOR_DISCORD_ID_BYTES),
    invalidSqlText('u."name"', MAX_ACTOR_NAME_BYTES),
    invalidLegacyXIdSql('u."active_x_user_id"'),
    invalidSqlText('x."x_name"', MAX_ACTOR_NAME_BYTES),
  ].join(" OR ");
  // Keep a corrupted user row observable as an invalid sentinel: do not
  // treat it as signed out or silently select another Active X identity.
  return `(SELECT CASE WHEN ${invalid}
    THEN json_object('__invalid_projection', 1)
    ELSE json_object(
      'userId', u."id", 'discordId', u."discord_id",
      'discordName', u."name", 'activeXId', u."active_x_user_id",
      'activeXName', x."x_name"
    ) END
    FROM "user" u LEFT JOIN "x_users" x ON x."id" = u."active_x_user_id"
    WHERE u."id" = ? LIMIT 1)`;
}

function invalidArrayIdentity(values: readonly unknown[]): boolean {
  return values.some((value) => typeof value !== "string" ||
    value.includes(String.fromCharCode(0)) ||
    Array.from(value).length > MAX_LEGACY_X_ID_CODEPOINTS ||
    new TextEncoder().encode(value).byteLength > MAX_LEGACY_X_ID_BYTES);
}

function invalidStaffProjection(values: readonly unknown[]): boolean {
  // SQL uses a single null sentinel for any oversized or malformed row.
  // Never evaluate operator capabilities from a truncated staff set.
  return values.some((value) =>
    value === null || typeof value !== "object" || Array.isArray(value));
}

const JST_OFFSET_SEC = 9 * 60 * 60;
const DEFAULT_PART_GAP_SEC = 15 * 60;
// Auth.js session + merged route-scoped ToS/CostGuard/actor + slot snapshot.
const CALLER_PRE_READS_WITH_SESSION = 3;

const SLOT_ACCOUNT_OTHER_MESSAGE =
  "この枠は現在とは別の活動名義で確保されています。Active X IDを切り替えてから操作してください。";
const SLOT_OPERATOR_PERMISSION_MESSAGE =
  "イベント運営権限がないため、例外の枠確保は実行できません。";
const SLOT_OPERATOR_WINDOW_MESSAGE =
  "例外の枠確保は、受付開始前または受付中のイベントでのみ実行できます。";
const GENERIC_MUTATION_ERROR_MESSAGE =
  "枠の状態が変更されたか、安全な保存を完了できませんでした。画面を更新してもう一度お試しください。";

const KNOWN_MUTATION_MESSAGES = new Set([
  SLOT_ACCOUNT_OTHER_MESSAGE,
  "連続枠に別の利用者または状態が混在しています。",
  "連続枠の完全な状態を確認できませんでした。",
  `連続枠が上限 ${MAX_ATOMIC_SLOT_ROWS} 件を超えています。運営へ連絡してください。`,
  `連続枠が上限 ${MAX_SLOTS_PER_VIDEO} 件を超えています。運営へ連絡してください。`,
  "別の部または連続していない枠はまとめて操作できません。",
  "原子的に処理できる枠数を超えています。",
  "連続枠の状態を確定できませんでした。",
]);

// Drizzle select() column order of packages/db schema `slots` for byte-identical audit JSON.
const SLOT_COLUMNS = [
  "id",
  "event_id",
  "reserved_by_user_id",
  "x_user_id",
  "reserved_x_id_snapshot",
  "display_name",
  "slot_label",
  "start_time",
  "sort_order",
  "reservation_group_id",
  "video_id",
  "status",
  "updated_at",
  "version",
] as const;

const NOOP_WAKE_HOST = {
  readEnv: () => null,
  readWaitUntil: () => null,
  readKv: () => null,
};
const loadNoopWakeHost: QueueWakeHostLoader = async () => NOOP_WAKE_HOST;

function okOutcome(slotId: string, groupSize = 1): SlotMutationOutcome {
  return {
    status: 200,
    body: {
      ok: true,
      slotId,
      slotCount: groupSize,
      groupSize,
      pendingPublicReflection: true,
    },
  };
}

function failOutcome(status: 400 | 403 | 404 | 409 | 503, message: string): SlotMutationOutcome {
  return { status, body: { ok: false, message } };
}

function slotJsonObjectSql(alias: string): string {
  const textCaps: Record<string, number> = {
    id: MAX_LEGACY_RECORD_ID_BYTES,
    event_id: MAX_LEGACY_RECORD_ID_BYTES,
    reserved_by_user_id: MAX_LEGACY_RECORD_ID_BYTES,
    x_user_id: MAX_LEGACY_X_ID_BYTES,
    reserved_x_id_snapshot: MAX_LEGACY_X_ID_BYTES,
    display_name: MAX_SLOT_DISPLAY_NAME_BYTES,
    slot_label: MAX_SLOT_LABEL_BYTES,
    reservation_group_id: MAX_LEGACY_RECORD_ID_BYTES,
    video_id: MAX_LEGACY_RECORD_ID_BYTES,
    status: MAX_SLOT_STATUS_BYTES,
  };
  const numberFields = ["start_time", "sort_order", "updated_at", "version"];
  const invalid = [
    ...Object.entries(textCaps).map(([key, maxBytes]) =>
      invalidSqlText(`${alias}."${key}"`, maxBytes)),
    ...["x_user_id", "reserved_x_id_snapshot"].map(key =>
      `(${alias}."${key}" IS NOT NULL AND length(${alias}."${key}") > ${MAX_LEGACY_X_ID_CODEPOINTS})`),
    ...numberFields.map(key => invalidSqlNumber(`${alias}."${key}"`)),
  ].join(" OR ");
  return `(CASE WHEN ${invalid}
    THEN json_object('__invalid_projection', 1)
    ELSE json_object(${SLOT_COLUMNS.map((c) => `'${c}', ${alias}."${c}"`).join(", ")})
  END)`;
}

// All slot arrays (reserve neighbors/replay, release group, extend group,
// merge left/right) share this guard. Each row has already passed the
// per-column text/type check before being serialized as JSON in the bounded
// MATERIALIZED CTE. Large or corrupted groups are replaced with a sentinel
// BEFORE json_group_array/json(...) executes, never silently truncated.
const MAX_SLOT_GROUP_JSON_BYTES = 20 * 1024;
function boundedSlotArraySql(rowsSql: string, alias: string): string {
  return `(WITH raw_slot_rows AS MATERIALIZED (${rowsSql}),
    slot_json_rows AS MATERIALIZED (
      SELECT ${slotJsonObjectSql(alias)} AS "item"
      FROM raw_slot_rows ${alias}
    )
    SELECT CASE
      WHEN EXISTS (SELECT 1 FROM slot_json_rows
                   WHERE instr("item", '"__invalid_projection":1') > 0)
        THEN json_array(json_object('__invalid_projection', 1))
      WHEN (SELECT COALESCE(SUM(length(CAST("item" AS BLOB)) + 1), 0) + 2
            FROM slot_json_rows) > ${MAX_SLOT_GROUP_JSON_BYTES}
        THEN json_array(json_object('__invalid_projection', 1))
      ELSE (SELECT json_group_array(json("item")) FROM slot_json_rows)
    END)`;
}

function eventJsonObjectSql(alias: string): string {
  const cols = [
    "id",
    "title",
    "visibility_status",
    "start_time",
    "end_time",
    "entry_start_time",
    "entry_end_time",
    "max_slots_per_video",
    "max_slot_reservation_groups_per_xid",
    "slot_part_gap_minutes",
  ];
  const textCaps: Record<string, number> = {
    id: MAX_LEGACY_RECORD_ID_BYTES,
    title: MAX_EVENT_TITLE_BYTES,
    visibility_status: MAX_EVENT_STATUS_BYTES,
  };
  const numericFields = cols.filter(c => !(c in textCaps));
  const invalid = [
    ...Object.entries(textCaps).map(([key, maxBytes]) =>
      invalidSqlText(`${alias}."${key}"`, maxBytes)),
    ...numericFields.map(key => invalidSqlNumber(`${alias}."${key}"`)),
  ].join(" OR ");
  return `(CASE WHEN ${invalid}
    THEN json_object('__invalid_projection', 1)
    ELSE json_object(${cols.map((c) => `'${c}', ${alias}."${c}"`).join(", ")})
  END)`;
}

function approvedXJsonSql(userIdParamPlaceholder = "?"): string {
  const invalid = invalidLegacyXIdSql('q."x_user_id"');
  // A first CASE branch rejects malformed raw TEXT before json_quote even runs.
  // The next branch measures JSON's actual escaped bytes on already-bounded
  // strings, so 100 valid 20-character IDs are not falsely rejected. Never
  // place JSON aggregation in the same SELECT as its byte preflight.
  return `(WITH approved_ids AS MATERIALIZED (
      SELECT DISTINCT l."x_user_id" AS "x_user_id"
      FROM "x_user_account_links" l
      INNER JOIN "x_users" x ON x."id" = l."x_user_id"
      WHERE l."auth_user_id" = ${userIdParamPlaceholder} AND x."approval_status" = 'approved'
      LIMIT ${MAX_APPROVED_X_IDS + 1}
    )
    SELECT CASE
      WHEN EXISTS (SELECT 1 FROM approved_ids q WHERE ${invalid})
        THEN json_array(NULL)
      WHEN (SELECT COALESCE(SUM(length(CAST(json_quote(q."x_user_id") AS BLOB)) + 1), 0) + 2
            FROM approved_ids q) > ${MAX_X_ID_JSON_BUDGET_BYTES}
        THEN json_array(NULL)
      ELSE (SELECT json_group_array(q."x_user_id") FROM approved_ids q)
    END)`;
}

function staffRowsJsonSql(): string {
  const invalid = [
    invalidSqlText('q."permission_preset"', MAX_STAFF_PRESET_BYTES),
    invalidSqlText('q."custom_permission_keys_json"', MAX_STAFF_CUSTOM_KEYS_BYTES),
  ].join(" OR ");
  // Scoping the JSON aggregator to a lazy ELSE scalar subquery is necessary:
  // aggregate functions in the same SELECT are evaluated before CASE. This
  // makes the first returned D1 row bounded even for corrupt legacy JSON.
  return `(WITH staff_entries AS MATERIALIZED (
    SELECT es."permission_preset" AS "permission_preset",
           es."custom_permission_keys_json" AS "custom_permission_keys_json"
    FROM "event_staff" es
    INNER JOIN "x_user_account_links" xl ON xl."x_user_id" = es."x_user_id"
    INNER JOIN "x_users" x ON x."id" = xl."x_user_id"
    WHERE es."event_id" = ? AND xl."auth_user_id" = ? AND x."approval_status" = 'approved'
    LIMIT ${MAX_OPERATOR_STAFF_ROWS + 1}
  )
  SELECT CASE WHEN
    EXISTS (SELECT 1 FROM staff_entries q WHERE ${invalid})
    THEN json_array(NULL)
    WHEN (SELECT COALESCE(SUM(
      length(CAST(json_quote(q."permission_preset") AS BLOB)) +
      length(CAST(json_quote(q."custom_permission_keys_json") AS BLOB)) + 70
    ), 0) FROM staff_entries q) > ${MAX_STAFF_JSON_BUDGET_BYTES}
    THEN json_array(NULL)
    ELSE (SELECT json_group_array(json_object(
      'permission_preset', q."permission_preset",
      'custom_permission_keys_json', q."custom_permission_keys_json"
    )) FROM staff_entries q)
  END)`;
}

function neighborConditionSql(alias: string, anchorAlias: string, direction: "forward" | "backward"): string {
  const op = direction === "forward" ? ">" : "<";
  return `(
    (${anchorAlias}."start_time" IS NOT NULL AND ${alias}."start_time" IS NOT NULL AND (
      ${alias}."start_time" ${op} ${anchorAlias}."start_time"
      OR (${alias}."start_time" = ${anchorAlias}."start_time" AND (
        COALESCE(${alias}."sort_order", 0) ${op} COALESCE(${anchorAlias}."sort_order", 0)
        OR (COALESCE(${alias}."sort_order", 0) = COALESCE(${anchorAlias}."sort_order", 0) AND ${alias}."id" ${op} ${anchorAlias}."id")
      ))
    ))
    OR
    (${anchorAlias}."start_time" IS NULL AND ${alias}."start_time" IS NULL AND (
      COALESCE(${alias}."sort_order", 0) ${op} COALESCE(${anchorAlias}."sort_order", 0)
      OR (COALESCE(${alias}."sort_order", 0) = COALESCE(${anchorAlias}."sort_order", 0) AND ${alias}."id" ${op} ${anchorAlias}."id")
    ))
  )`;
}

function neighborOrderSql(alias: string, direction: "forward" | "backward"): string {
  const dir = direction === "forward" ? "ASC" : "DESC";
  return `${alias}."start_time" ${dir}, COALESCE(${alias}."sort_order", 0) ${dir}, ${alias}."id" ${dir}`;
}

function parseJsonOrThrow<T>(raw: string | null | undefined, fallback: T): T {
  if (raw === null || raw === undefined) return fallback;
  return JSON.parse(raw) as T;
}

function sortSlotsChronologically<
  T extends { id?: string | null; start_time: number | null; sort_order?: number | null },
>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => {
    const aTimed = a.start_time != null;
    const bTimed = b.start_time != null;
    if (aTimed !== bTimed) return aTimed ? -1 : 1;
    const startDiff = (a.start_time ?? 0) - (b.start_time ?? 0);
    if (startDiff !== 0) return startDiff;
    const orderDiff = (a.sort_order ?? 0) - (b.sort_order ?? 0);
    return orderDiff || (a.id ?? "").localeCompare(b.id ?? "");
  });
}

function jstDayBucket(unixSec: number | null): number | null {
  return unixSec == null || !Number.isFinite(unixSec)
    ? null
    : Math.floor((unixSec + JST_OFFSET_SEC) / (24 * 60 * 60));
}

function normalizeGapSec(gapSec: number): number {
  return Number.isFinite(gapSec) && gapSec >= 0 ? gapSec : DEFAULT_PART_GAP_SEC;
}

function areSlotsInSamePart<T extends { start_time: number | null; sort_order?: number | null }>(
  prev: T,
  next: T,
  gapSec = DEFAULT_PART_GAP_SEC,
): boolean {
  if (prev.start_time != null && next.start_time != null) {
    if (next.start_time < prev.start_time) return false;
    if (jstDayBucket(prev.start_time) !== jstDayBucket(next.start_time)) return false;
    return next.start_time - prev.start_time <= normalizeGapSec(gapSec);
  }
  if (prev.start_time == null && next.start_time == null) {
    return (
      prev.sort_order != null &&
      next.sort_order != null &&
      next.sort_order === prev.sort_order + 1
    );
  }
  return false;
}

function assertAdjacentSequence(rows: readonly SlotRow[], gapSec: number): void {
  for (let index = 1; index < rows.length; index += 1) {
    if (!areSlotsInSamePart(rows[index - 1]!, rows[index]!, gapSec)) {
      throw new Error("別の部または連続していない枠はまとめて操作できません。");
    }
  }
}

function slotViewerRelation(row: SlotRow, userId: string, activeXId: string | null): SlotViewerRelation {
  return resolveSlotViewerRelation({
    reservedByUserId: row.reserved_by_user_id,
    slotXUserId: row.x_user_id,
    authUserId: userId,
    activeXId,
  });
}

function assertSlotActor(
  row: SlotRow,
  userId: string,
  activeXId: string | null,
): { ok: true } | { ok: false; message: string } {
  const relation = slotViewerRelation(row, userId, activeXId);
  if (!canActAsSlotActor(relation)) {
    return {
      ok: false,
      message:
        relation === "account_other"
          ? SLOT_ACCOUNT_OTHER_MESSAGE
          : "自分が確保した枠のみ操作できます。",
    };
  }
  return { ok: true };
}

function groupIdentityError(
  reason: "different_active_x" | "mixed_non_null_x" | "mixed_auth_user",
): string {
  return reason === "mixed_auth_user"
    ? "連続枠に別の利用者または状態が混在しています。"
    : SLOT_ACCOUNT_OTHER_MESSAGE;
}

function resolveBoundedGroupFromSnapshot(
  anchor: SlotRow,
  groupRowsSnapshot: readonly SlotRow[],
): SlotRow[] {
  const groupId = anchor.reservation_group_id?.trim() ? anchor.reservation_group_id : null;
  if (!groupId) return [anchor];
  assertBoundedSlotGroupIntegrity(groupRowsSnapshot, anchor, MAX_SLOTS_PER_VIDEO);
  return sortSlotsChronologically(groupRowsSnapshot);
}

function resolveBoundedGroupIdentity(
  rows: readonly SlotRow[],
  authUserId: string,
  activeXId: string | null,
): { targetXId: string | null; adoptNullRows: boolean } {
  const result = resolveSlotGroupIdentity({
    reservedByUserIds: rows.map((row) => row.reserved_by_user_id),
    slotXUserIds: rows.map((row) => row.x_user_id),
    authUserId,
    activeXId,
  });
  if (!result.ok) {
    throw new Error(groupIdentityError(result.reason));
  }
  return result;
}

function resolveOperatorOverride(args: {
  requested: boolean;
  userRole: string | null;
  staffRows: readonly StaffPermissionRow[];
  event: EventFacts;
}): { ok: true; enabled: boolean } | { ok: false; status: 403 | 409; message: string } {
  if (!args.requested) return { ok: true, enabled: false };
  const candidateKeys = expandPermissionAliases("event.slots");
  const hasPermission =
    args.userRole === "admin" ||
    (candidateKeys.length > 0 &&
      args.staffRows.some((row) => candidateKeys.some((key) => staffRowHasPermissionKey(row, key))));
  if (!hasPermission) {
    return { ok: false, status: 403, message: SLOT_OPERATOR_PERMISSION_MESSAGE };
  }
  if (!canUseSlotOperatorOverride(args.event)) {
    return { ok: false, status: 409, message: SLOT_OPERATOR_WINDOW_MESSAGE };
  }
  return { ok: true, enabled: true };
}

function resolveSlotXUserId(activeXId: string | null, approvedXIds: readonly string[]): string | null {
  return activeXId && approvedXIds.includes(activeXId) ? activeXId : null;
}

function mapMutationError(error: unknown): SlotMutationOutcome {
  if (error instanceof Error && KNOWN_MUTATION_MESSAGES.has(error.message)) {
    const status = error.message === SLOT_ACCOUNT_OTHER_MESSAGE ? 403 : 409;
    return failOutcome(status, error.message);
  }
  return failOutcome(409, GENERIC_MUTATION_ERROR_MESSAGE);
}

// SEC #716: the optional tied-edge projection may be omitted. The
// compatibility fallback must obey the same D1 wire bounds, not select raw
// legacy slot rows. Keep the exact SQL neighbor ordering and captured edge.
async function loadOrderedNeighborFallback(
  rawDb: SlotD1Like,
  row: SlotRow,
  direction: "forward" | "backward",
): Promise<{ ok: true; candidate: SlotRow | undefined } | { ok: false }> {
  const query = `
    WITH fallback_edge("id", "event_id", "start_time", "sort_order") AS (VALUES (?, ?, ?, ?))
    SELECT (SELECT ${slotJsonObjectSql("n")}
      FROM "slots" n CROSS JOIN fallback_edge e
      WHERE n."event_id" = e."event_id" AND ${neighborConditionSql("n", "e", direction)}
      ORDER BY ${neighborOrderSql("n", direction)}
      LIMIT 1) AS neighbor_json
  `;
  const snapshot = await rawDb
    .prepare(boundedFirstD1SnapshotSql(query, ["neighbor_json"]))
    .bind(row.id, row.event_id, row.start_time, row.sort_order)
    .first<{ neighbor_json: string | null; invalid_snapshot: number }>();
  if (!snapshot || invalidJsonSnapshot(snapshot)) return { ok: false };
  return {
    ok: true,
    candidate: parseJsonOrThrow<SlotRow | null>(snapshot.neighbor_json, null) ?? undefined,
  };
}

function logicalCountSubquerySql(eventIdExpr: string, xIdExpr: string): string {
  return `(SELECT COUNT(DISTINCT CASE
    WHEN m.reservation_group_id IS NOT NULL AND TRIM(m.reservation_group_id) <> '' THEN 'group:' || TRIM(m.reservation_group_id)
    ELSE 'slot:' || m.id
  END) FROM (
    SELECT id, reservation_group_id FROM slots
    WHERE event_id = ${eventIdExpr} AND reserved_x_id_snapshot = ${xIdExpr} AND status IN ('reserved', 'submitted')
    UNION ALL
    SELECT id, reservation_group_id FROM slots
    WHERE event_id = ${eventIdExpr} AND reserved_x_id_snapshot IS NOT NULL AND reserved_x_id_snapshot <> ${xIdExpr}
      AND lower(trim(ltrim(trim(reserved_x_id_snapshot), '@'))) = ${xIdExpr}
      AND status IN ('reserved', 'submitted')
  ) m)`;
}

// normalizeXId trims ECMAScript whitespace, removes leading @, then
// lowercases. The logical reservation reader normalizes its already
// normalized identity again. SQLite lower() is ASCII-only, so this SQL key
// is an optimization, never identity authority: the caller must compare
// it to the exact JS count key before reusing the associated count.
function pendingReservationCountKeySql(expr: string): string {
  const whitespace = "char(9,10,11,12,13,32,160,5760,8192,8193,8194,8195,8196,8197,8198,8199,8200,8201,8202,8232,8233,8239,8287,12288,65279)";
  const normalize = (value: string) => `lower(ltrim(trim(${value}, ${whitespace}), '@'))`;
  return normalize(normalize(expr));
}

type ReserveSnapshotRow = {
  event_json: string | null;
  anchor_json: string | null;
  actor_json: string | null;
  approved_x_json: string | null;
  pending_x_json: string | null;
  staff_json: string | null;
  neighbors_json: string | null;
  replay_group_json: string | null;
  active_x_count: number | null;
  single_pending_count_key: string | null;
  pending_x_count: number | null;
};

async function loadReserveSnapshot(
  rawDb: SlotD1Like,
  args: { eventId: string; slotId: string; userId: string; activeXId: string | null; neighborLimit: number },
): Promise<ReserveSnapshotRow | null> {
  const types = SLOT_RESERVATION_X_REQUEST_TYPES;
  const activeCountKey = normalizeXId(normalizeXId(args.activeXId));
  const neighborRowsSql = `
        SELECT ${SLOT_COLUMNS.map((c) => `s."${c}"`).join(", ")}
        FROM "slots" s, anchor a
        WHERE s."event_id" = a."event_id" AND ${neighborConditionSql("s", "a", "forward")}
        ORDER BY ${neighborOrderSql("s", "forward")}
        LIMIT ?
      `;
  const replayRowsSql = `
        SELECT ${SLOT_COLUMNS.map((c) => `s."${c}"`).join(", ")}
        FROM "slots" s, anchor a
        WHERE a."reservation_group_id" IS NOT NULL AND TRIM(a."reservation_group_id") <> ''
          AND s."event_id" = a."event_id" AND s."reservation_group_id" = a."reservation_group_id"
        LIMIT ${MAX_SLOTS_PER_VIDEO + 1}
      `;
  const query = `
    WITH anchor AS (
      SELECT ${SLOT_COLUMNS.map((c) => `"${c}"`).join(", ")}
      FROM "slots" WHERE "id" = ? AND "event_id" = ? LIMIT 1
    ),
    ev AS (
      SELECT "id", "title", "visibility_status", "start_time", "end_time",
             "entry_start_time", "entry_end_time", "max_slots_per_video",
             "max_slot_reservation_groups_per_xid", "slot_part_gap_minutes"
      FROM "events" WHERE "id" = ? LIMIT 1
    ),
    pending_list AS (
      SELECT CASE WHEN ${invalidLegacyXIdSql('"requested_x_id"')}
                  THEN NULL ELSE "requested_x_id" END AS "requested_x_id"
      FROM "x_identity_requests"
      WHERE "requested_by_auth_user_id" = ? AND "status" = 'pending'
        AND "request_type" IN (${types.map(() => "?").join(", ")})
        AND "requested_x_id" IS NOT NULL
      ORDER BY "requested_at" DESC, "id" DESC
      LIMIT ${MAX_PENDING_RESERVATION_REQUESTS + 1}
    ),
    pending_count_keys AS (
      SELECT DISTINCT ${pendingReservationCountKeySql('"requested_x_id"')} AS "xid"
      FROM pending_list
    ),
    single_pending AS (
      SELECT CASE WHEN COUNT(*) = 1 THEN MIN("xid") ELSE NULL END AS "xid"
      FROM pending_count_keys WHERE "xid" <> ''
    )
    SELECT
      (SELECT ${eventJsonObjectSql("ev")} FROM ev) AS event_json,
      (SELECT ${slotJsonObjectSql("a")} FROM anchor a) AS anchor_json,
      ${boundedReserveActorJsonSql()} AS actor_json,
      ${approvedXJsonSql("?")} AS approved_x_json,
      (SELECT CASE
         WHEN EXISTS (SELECT 1 FROM pending_list WHERE "requested_x_id" IS NULL)
           THEN json_array(NULL)
         WHEN (SELECT COALESCE(SUM(length(CAST(json_quote("requested_x_id") AS BLOB)) + 1), 0) + 2
               FROM pending_list) > ${MAX_X_ID_JSON_BUDGET_BYTES}
           THEN json_array(NULL)
         ELSE (SELECT json_group_array("requested_x_id") FROM pending_list)
        END) AS pending_x_json,
      ${staffRowsJsonSql()} AS staff_json,
      ${boundedSlotArraySql(neighborRowsSql, "n")} AS neighbors_json,
      ${boundedSlotArraySql(replayRowsSql, "rg")} AS replay_group_json,
      CASE
        WHEN COALESCE((SELECT "max_slot_reservation_groups_per_xid" FROM ev), 0) > 0 AND ? <> ''
        THEN ${logicalCountSubquerySql("(SELECT id FROM ev)", "?")}
        ELSE 0
      END AS active_x_count,
      (SELECT "xid" FROM single_pending) AS single_pending_count_key,
      CASE
        WHEN COALESCE((SELECT "max_slot_reservation_groups_per_xid" FROM ev), 0) > 0
          AND (SELECT "xid" FROM single_pending) IS NOT NULL
        THEN ${logicalCountSubquerySql("(SELECT id FROM ev)", "(SELECT \"xid\" FROM single_pending)")}
        ELSE 0
      END AS pending_x_count
  `;
  return rawDb
    .prepare(boundedFirstD1SnapshotSql(query, [
      "event_json", "anchor_json", "actor_json", "approved_x_json",
      "pending_x_json", "staff_json", "neighbors_json", "replay_group_json",
      "active_x_count", "single_pending_count_key", "pending_x_count",
    ]))
    .bind(
      args.slotId,
      args.eventId,
      args.eventId,
      args.userId,
      ...types,
      args.userId,
      args.userId,
      args.eventId,
      args.userId,
      args.neighborLimit,
      activeCountKey, // nonempty active-X count key guard
      activeCountKey, // exact snapshot match
      activeCountKey, // legacy snapshot exclusion predicate
      activeCountKey, // normalized legacy snapshot match
    )
    .first<ReserveSnapshotRow>();
}

/** SA-065 reserveSlot */
export async function reserveSlotCore(
  rawDb: SlotD1Like,
  db: ServerCoreDb,
  ctx: SlotMutationContext,
  input: {
    eventId: string;
    slotId: string;
    display_name: string;
    consecutive_count: number;
    operator_override: boolean;
  },
): Promise<SlotMutationOutcome> {
  const snapshot = await loadReserveSnapshot(rawDb, {
    eventId: input.eventId,
    slotId: input.slotId,
    userId: ctx.authUserId,
    activeXId: ctx.activeXId,
    neighborLimit: Math.max(0, input.consecutive_count - 1),
  });
  if (!snapshot || invalidJsonSnapshot(snapshot)) {
    return failOutcome(503, GENERIC_MUTATION_ERROR_MESSAGE);
  }

  const approvedXIds = parseJsonOrThrow<string[]>(snapshot.approved_x_json, []);
  const pendingXIds = parseJsonOrThrow<string[]>(snapshot.pending_x_json, []);
  const staffRows = parseJsonOrThrow<StaffPermissionRow[]>(snapshot.staff_json, []);
  if (
    snapshot.actor_json?.includes('"__invalid_projection":1') ||
    invalidArrayIdentity(approvedXIds) ||
    invalidArrayIdentity(pendingXIds) ||
    invalidStaffProjection(staffRows) ||
    approvedXIds.length > MAX_APPROVED_X_IDS ||
    pendingXIds.length > MAX_PENDING_RESERVATION_REQUESTS ||
    staffRows.length > MAX_OPERATOR_STAFF_ROWS
  ) {
    return failOutcome(503, GENERIC_MUTATION_ERROR_MESSAGE);
  }

  const identity = resolveReservationXIdentityFromPending({
    activeXId: ctx.activeXId,
    approvedXIds,
    pendingRequestedXIds: pendingXIds,
  });
  const anchor = parseJsonOrThrow<SlotRow | null>(snapshot.anchor_json, null);
  if (!anchor) return failOutcome(404, "枠が見つかりません。");
  const event = parseJsonOrThrow<EventFacts | null>(snapshot.event_json, null);
  const actor = parseJsonOrThrow<NotificationActor | null>(snapshot.actor_json, null);

  if (anchor.status !== "available") {
    if (anchor.status === "reserved" && anchor.reserved_by_user_id === ctx.authUserId) {
      const relation = slotViewerRelation(anchor, ctx.authUserId, ctx.activeXId);
      if (relation === "account_other") return failOutcome(403, SLOT_ACCOUNT_OTHER_MESSAGE);
      if (canActAsSlotActor(relation)) {
        let slotCount = Math.max(1, Number(input.consecutive_count) || 1);
        try {
          const replayRows = parseJsonOrThrow<SlotRow[]>(snapshot.replay_group_json, []);
          slotCount = resolveBoundedGroupFromSnapshot(anchor, replayRows).length;
        } catch {
          // best-effort webhook requeue; dedupe key is anchor-scoped
        }
        try {
          const title = event?.title ?? "イベント";
          const payload = buildChannelSlotReservedNotification({
            eventId: anchor.event_id,
            eventTitle: title,
            slotCount,
            slotDisplayName: anchor.display_name ?? input.display_name,
            actor,
            siteUrl: ctx.siteUrl,
          });
          const webhook = await buildOpsChannelWebhookStatement(db, {
            target: "event",
            threadName: buildSlotReservedOpsThreadName(title, actor),
            actorUserId: ctx.authUserId,
            payload,
            dedupeKey: `channel_slot_reserved:${anchor.event_id}:${ctx.authUserId}:${anchor.id}:${anchor.reservation_group_id ?? "solo"}`,
            eventId: anchor.event_id,
            recipientExists: Boolean(actor),
          });
          await webhook.statement;
        } catch {
          // best-effort post-commit parity
        }
        return okOutcome(anchor.id, slotCount);
      }
    }
    return failOutcome(409, "この枠はすでに確保されています。");
  }

  if (!event) return failOutcome(404, "イベントが見つかりません。");
  const operatorCheck = resolveOperatorOverride({
    requested: input.operator_override,
    userRole: ctx.userRole,
    staffRows,
    event,
  });
  if (!operatorCheck.ok) return failOutcome(operatorCheck.status, operatorCheck.message);
  const operatorOverride = operatorCheck.enabled;
  if (!isAcceptingEntries(event) && !operatorOverride) {
    return failOutcome(409, "受付中ではないため枠を確保できません。");
  }

  const maxRows = operatorOverride ? MAX_SLOTS_PER_VIDEO : normalizeMaxSlotsPerVideo(event.max_slots_per_video);
  if (input.consecutive_count > maxRows) {
    return failOutcome(409, `一度に確保できる連続枠は ${maxRows} 件までです。`);
  }

  const xidReservationLimit = operatorOverride
    ? 0
    : normalizeSlotReservationLimit(event.max_slot_reservation_groups_per_xid);
  let callerQueryCount = CALLER_PRE_READS_WITH_SESSION;
  if (xidReservationLimit > 0 && identity.snapshotXId) {
    // Match loadLogicalReservationCountForXId's final JS normalization
    // exactly. The SQL pending key may differ for non-ASCII case folding;
    // never use a count for a different key or change the stored identity.
    const countKey = normalizeXId(identity.snapshotXId);
    const activeCountKey = normalizeXId(normalizeXId(ctx.activeXId));
    let currentReservations: number;
    if (!countKey) {
      currentReservations = 0;
    } else if (countKey === activeCountKey) {
      currentReservations = Number(snapshot.active_x_count ?? 0);
    } else if (countKey === snapshot.single_pending_count_key) {
      currentReservations = Number(snapshot.pending_x_count ?? 0);
    } else {
      callerQueryCount += 1;
      currentReservations = await loadLogicalReservationCountForXId(db, {
        eventId: anchor.event_id,
        xIdSnapshot: identity.snapshotXId,
      });
    }
    if (currentReservations >= xidReservationLimit) {
      return failOutcome(409, slotReservationLimitMessage(xidReservationLimit));
    }
  }

  const neighbors = sortSlotsChronologically(parseJsonOrThrow<SlotRow[]>(snapshot.neighbors_json, []));
  const targetRows = [anchor, ...neighbors];
  if (targetRows.length !== input.consecutive_count) {
    return failOutcome(409, "必要な数の連続空き枠がありません。");
  }
  if (targetRows.some((row) => row.status !== "available")) {
    return failOutcome(409, "連続枠の途中に確保済みの枠があります。");
  }
  try {
    assertAdjacentSequence(targetRows, slotPartGapSec(event));
  } catch (error) {
    return mapMutationError(error);
  }

  const groupId = targetRows.length > 1 ? generateId("sgrp") : null;
  const reserveMutations = buildSlotReserveMutationPlan({
    rows: targetRows,
    actorUserId: ctx.authUserId,
    identity,
    displayName: input.display_name,
    groupId,
  });
  const payload = buildChannelSlotReservedNotification({
    eventId: anchor.event_id,
    eventTitle: event.title ?? "イベント",
    slotCount: targetRows.length,
    slotDisplayName: input.display_name,
    actor,
    siteUrl: ctx.siteUrl,
  });
  const channelNotification = await buildOpsChannelWebhookStatement(db, {
    target: "event",
    threadName: buildSlotReservedOpsThreadName(event.title ?? "イベント", actor),
    actorUserId: ctx.authUserId,
    payload,
    dedupeKey: `channel_slot_reserved:${anchor.event_id}:${ctx.authUserId}:${anchor.id}:${groupId ?? "solo"}`,
    eventId: anchor.event_id,
    recipientExists: Boolean(actor),
  });
  const extraStatements: BatchItem<"sqlite">[] = [channelNotification.statement];
  const limitGuard = buildReservationLimitGuardStatement(db, {
    eventId: anchor.event_id,
    xIdSnapshot: identity.snapshotXId,
    limit: xidReservationLimit,
  });
  if (limitGuard) extraStatements.push(limitGuard);

  try {
    await commitSlotMutationPlanCore({
      db,
      mutations: reserveMutations,
      eventId: anchor.event_id,
      actorUserId: ctx.authUserId,
      reason: "slot_user_reserve",
      extraStatements,
      preloaded: ctx.preloaded,
      callerQueryCount,
      loadWakeHost: loadNoopWakeHost,
    });
  } catch (error) {
    if (xidReservationLimit > 0 && identity.snapshotXId) {
      try {
        const currentReservations = await loadLogicalReservationCountForXId(db, {
          eventId: anchor.event_id,
          xIdSnapshot: identity.snapshotXId,
        });
        if (currentReservations >= xidReservationLimit) {
          return failOutcome(409, slotReservationLimitMessage(xidReservationLimit));
        }
      } catch {
        // Fall back to standard atomic mutation error.
      }
    }
    return mapMutationError(error);
  }

  return okOutcome(anchor.id, targetRows.length);
}

/** SA-066 releaseOwnSlot */
export async function releaseSlotCore(
  rawDb: SlotD1Like,
  db: ServerCoreDb,
  ctx: SlotMutationContext,
  input: { eventId: string; slotId: string },
): Promise<SlotMutationOutcome> {
  const releaseGroupRowsSql = `
        SELECT ${SLOT_COLUMNS.map((c) => `s."${c}"`).join(", ")}
        FROM "slots" s, anchor a
        WHERE a."reservation_group_id" IS NOT NULL AND TRIM(a."reservation_group_id") <> ''
          AND s."event_id" = a."event_id" AND s."reservation_group_id" = a."reservation_group_id"
        LIMIT ${MAX_SLOTS_PER_VIDEO + 1}
      `;
  const query = `
    WITH anchor AS (
      SELECT ${SLOT_COLUMNS.map((c) => `"${c}"`).join(", ")}
      FROM "slots" WHERE "id" = ? AND "event_id" = ? LIMIT 1
    )
    SELECT
      (SELECT ${slotJsonObjectSql("a")} FROM anchor a) AS anchor_json,
      ${boundedSlotArraySql(releaseGroupRowsSql, "g")} AS group_json
  `;
  const snapshot = await rawDb
    .prepare(boundedFirstD1SnapshotSql(query, ["anchor_json", "group_json"]))
    .bind(input.slotId, input.eventId)
    .first<{ anchor_json: string | null; group_json: string | null; invalid_snapshot: number }>();
  if (!snapshot || invalidJsonSnapshot(snapshot)) {
    return failOutcome(503, GENERIC_MUTATION_ERROR_MESSAGE);
  }

  const anchor = parseJsonOrThrow<SlotRow | null>(snapshot.anchor_json, null);
  if (!anchor) return failOutcome(404, "枠が見つかりません。");
  const actorCheck = assertSlotActor(anchor, ctx.authUserId, ctx.activeXId);
  if (!actorCheck.ok) return failOutcome(403, actorCheck.message);
  if (anchor.status !== "reserved") {
    return failOutcome(409, "提出済みの枠は解放できません。先に作品取り下げを相談してください。");
  }

  let groupRows: SlotRow[];
  try {
    groupRows = resolveBoundedGroupFromSnapshot(
      anchor,
      parseJsonOrThrow<SlotRow[]>(snapshot.group_json, []),
    );
    resolveBoundedGroupIdentity(groupRows, ctx.authUserId, ctx.activeXId);
  } catch (error) {
    return mapMutationError(error);
  }
  if (groupRows.some((row) => row.status !== "reserved")) {
    return failOutcome(409, "予約中でない枠を含む連続枠は解放できません。");
  }

  try {
    await commitSlotMutationPlanCore({
      db,
      mutations: buildSlotReleaseMutationPlan(groupRows, anchor.id, generateId("sgrp")) as unknown as SlotCoreBulkMutation[],
      eventId: anchor.event_id,
      actorUserId: ctx.authUserId,
      reason: "slot_user_release",
      preloaded: ctx.preloaded,
      callerQueryCount: CALLER_PRE_READS_WITH_SESSION,
      loadWakeHost: loadNoopWakeHost,
    });
  } catch (error) {
    return mapMutationError(error);
  }

  return okOutcome(anchor.id, groupRows.length);
}

/** SA-067 extendOwnSlotGroup */
export async function extendSlotGroupCore(
  rawDb: SlotD1Like,
  db: ServerCoreDb,
  ctx: SlotMutationContext,
  input: {
    eventId: string;
    slotId: string;
    direction: "forward" | "backward";
    operator_override: boolean;
  },
): Promise<SlotMutationOutcome> {
  const edgeDir = input.direction === "backward" ? "ASC" : "DESC";
  const edgeNullDir = input.direction === "backward" ? "ASC" : "DESC";
  const query = `
    WITH anchor AS (
      SELECT ${SLOT_COLUMNS.map((c) => `"${c}"`).join(", ")}
      FROM "slots" WHERE "id" = ? AND "event_id" = ? LIMIT 1
    ),
    group_rows AS (
      SELECT ${SLOT_COLUMNS.map((c) => `s."${c}"`).join(", ")}
      FROM "slots" s, anchor a
      WHERE a."reservation_group_id" IS NOT NULL AND TRIM(a."reservation_group_id") <> ''
        AND s."event_id" = a."event_id" AND s."reservation_group_id" = a."reservation_group_id"
      LIMIT ${MAX_SLOTS_PER_VIDEO + 1}
    ),
    cte_edge AS (
      SELECT * FROM (
        SELECT * FROM group_rows
        UNION ALL
        SELECT * FROM anchor WHERE NOT EXISTS (SELECT 1 FROM group_rows)
      )
      ORDER BY CASE WHEN "start_time" IS NULL THEN 1 ELSE 0 END ${edgeNullDir},
               "start_time" ${edgeDir},
               COALESCE("sort_order", 0) ${edgeDir},
               "id" ${edgeDir}
      LIMIT 1
    )
    SELECT
      (SELECT ${eventJsonObjectSql("e")} FROM "events" e WHERE e."id" = ? LIMIT 1) AS event_json,
      (SELECT ${slotJsonObjectSql("a")} FROM anchor a) AS anchor_json,
      ${approvedXJsonSql("?")} AS approved_x_json,
      ${staffRowsJsonSql()} AS staff_json,
      ${boundedSlotArraySql("SELECT * FROM group_rows", "g")} AS group_json,
      (SELECT CASE
        WHEN ${invalidSqlText('"id"', MAX_LEGACY_RECORD_ID_BYTES)}
          THEN '{"__invalid_projection":1}'
        ELSE "id" END FROM cte_edge) AS cte_edge_id,
      (SELECT ${slotJsonObjectSql("n")} FROM (
        SELECT ${SLOT_COLUMNS.map((c) => `s."${c}"`).join(", ")}
        FROM "slots" s, cte_edge ce
        WHERE s."event_id" = ce."event_id" AND ${neighborConditionSql("s", "ce", input.direction)}
        ORDER BY ${neighborOrderSql("s", input.direction)}
        LIMIT 1
      ) n) AS neighbor_json,
      -- CURRENT uses JS localeCompare for the group's edge, while the
      -- neighbor lookup uses SQLite binary order. Only equal-time/order
      -- group members can disagree with cte_edge. Project their corresponding
      -- SQL neighbors in this same snapshot, bounded by the existing group
      -- JSON and outer wire limits. Omit the optional projection on overflow.
      (WITH alternate_neighbors AS MATERIALIZED (
        SELECT CASE WHEN ${invalidSqlText('g."id"', MAX_LEGACY_RECORD_ID_BYTES)}
                    THEN NULL ELSE g."id" END AS edge_id,
               (SELECT ${slotJsonObjectSql("n")}
                  FROM "slots" n
                 WHERE n."event_id" = g."event_id"
                   AND ${neighborConditionSql("n", "g", input.direction)}
                 ORDER BY ${neighborOrderSql("n", input.direction)}
                 LIMIT 1) AS neighbor_json
        FROM group_rows g CROSS JOIN cte_edge ce
        WHERE g."id" <> ce."id"
          AND g."start_time" IS ce."start_time"
          AND COALESCE(g."sort_order", 0) = COALESCE(ce."sort_order", 0)
      ), alternate_items AS MATERIALIZED (
        SELECT json_object('edge_id', edge_id, 'neighbor', json(neighbor_json)) AS item
        FROM alternate_neighbors WHERE edge_id IS NOT NULL
      )
      SELECT CASE
        WHEN NOT EXISTS (SELECT 1 FROM alternate_neighbors)
          OR EXISTS (SELECT 1 FROM alternate_neighbors
                     WHERE edge_id IS NULL OR instr(neighbor_json, '"__invalid_projection":1') > 0)
          OR (SELECT COALESCE(SUM(length(CAST(item AS BLOB)) + 1), 0) + 2
              FROM alternate_items) > ${MAX_SLOT_GROUP_JSON_BYTES}
        THEN NULL
        ELSE (SELECT json_group_array(json(item)) FROM alternate_items)
      END) AS alternate_neighbors_json
  `;
  const snapshot = await rawDb
    .prepare(boundedFirstD1SnapshotSql(query, [
      "event_json", "anchor_json", "approved_x_json", "staff_json",
      "group_json", "cte_edge_id", "neighbor_json",
    ], "alternate_neighbors_json"))
    .bind(input.slotId, input.eventId, input.eventId, ctx.authUserId, input.eventId, ctx.authUserId)
    .first<{
      event_json: string | null;
      anchor_json: string | null;
      approved_x_json: string | null;
      staff_json: string | null;
      group_json: string | null;
      cte_edge_id: string | null;
      neighbor_json: string | null;
      alternate_neighbors_json: string | null;
    }>();
  if (!snapshot || invalidJsonSnapshot(snapshot)) {
    return failOutcome(503, GENERIC_MUTATION_ERROR_MESSAGE);
  }

  const approvedXIds = parseJsonOrThrow<string[]>(snapshot.approved_x_json, []);
  const staffRows = parseJsonOrThrow<StaffPermissionRow[]>(snapshot.staff_json, []);
  if (invalidArrayIdentity(approvedXIds) ||
      invalidStaffProjection(staffRows) ||
      approvedXIds.length > MAX_APPROVED_X_IDS ||
      staffRows.length > MAX_OPERATOR_STAFF_ROWS) {
    return failOutcome(503, GENERIC_MUTATION_ERROR_MESSAGE);
  }

  const anchor = parseJsonOrThrow<SlotRow | null>(snapshot.anchor_json, null);
  if (!anchor) return failOutcome(404, "枠が見つかりません。");
  const actorCheck = assertSlotActor(anchor, ctx.authUserId, ctx.activeXId);
  if (anchor.status !== "reserved" || !actorCheck.ok) {
    return failOutcome(
      actorCheck.ok ? 409 : 403,
      actorCheck.ok ? "自分の予約中の枠のみ拡張できます。" : actorCheck.message,
    );
  }
  const event = parseJsonOrThrow<EventFacts | null>(snapshot.event_json, null);
  if (!event) return failOutcome(404, "イベントが見つかりません。");

  const operatorCheck = resolveOperatorOverride({
    requested: input.operator_override,
    userRole: ctx.userRole,
    staffRows,
    event,
  });
  if (!operatorCheck.ok) return failOutcome(operatorCheck.status, operatorCheck.message);
  const operatorOverride = operatorCheck.enabled;
  if (!isAcceptingEntries(event) && !operatorOverride) {
    return failOutcome(409, "受付中ではないため枠を拡張できません。");
  }

  const slotXUserId = resolveSlotXUserId(ctx.activeXId, approvedXIds);
  let groupRows: SlotRow[];
  let identity: { targetXId: string | null; adoptNullRows: boolean };
  try {
    groupRows = resolveBoundedGroupFromSnapshot(
      anchor,
      parseJsonOrThrow<SlotRow[]>(snapshot.group_json, []),
    );
    identity = resolveBoundedGroupIdentity(groupRows, ctx.authUserId, ctx.activeXId);
  } catch (error) {
    return mapMutationError(error);
  }

  const maxRows = operatorOverride ? MAX_SLOTS_PER_VIDEO : normalizeMaxSlotsPerVideo(event.max_slots_per_video);
  if (groupRows.length + 1 > maxRows) {
    return failOutcome(409, "連続枠の上限を超えるため拡張できません。");
  }
  if (groupRows.some((row) => row.status !== "reserved")) {
    return failOutcome(409, "予約中でない枠を含む連続枠は拡張できません。");
  }
  const subjectResult = resolveSlotReservationSubject(groupRows);
  if (!subjectResult.ok) {
    return failOutcome(409, "連続枠の予約者情報が不整合です。運営へ連絡してください。");
  }
  if (ctx.authUserId !== subjectResult.subject.reservedByUserId) {
    return failOutcome(403, "自分の予約中の枠のみ拡張できます。");
  }

  const edge = input.direction === "backward" ? groupRows[0]! : groupRows[groupRows.length - 1]!;
  let candidate: SlotRow | undefined;
  let callerQueryCount = CALLER_PRE_READS_WITH_SESSION;
  if (edge.id === snapshot.cte_edge_id) {
    candidate = parseJsonOrThrow<SlotRow | null>(snapshot.neighbor_json, null) ?? undefined;
  } else {
    const alternatives = parseJsonOrThrow<{ edge_id: string; neighbor: SlotRow | null }[]>(
      snapshot.alternate_neighbors_json, [],
    );
    const alternate = alternatives.find((entry) => entry.edge_id === edge.id);
    // A present null neighbor is authoritative. If the optional projection
    // did not fit, retain CURRENT's lookup rather than change valid behavior.
    // The remaining fallback is still an S3 gate, not a budget waiver.
    if (alternate) {
      candidate = alternate.neighbor ?? undefined;
    } else {
      callerQueryCount += 1;
      const fallback = await loadOrderedNeighborFallback(rawDb, edge, input.direction);
      if (!fallback.ok) return failOutcome(503, GENERIC_MUTATION_ERROR_MESSAGE);
      candidate = fallback.candidate;
    }
  }
  if (!candidate || candidate.status !== "available") {
    return failOutcome(409, "拡張可能な隣接空き枠がありません。");
  }
  try {
    assertAdjacentSequence(
      input.direction === "backward" ? [candidate, edge] : [edge, candidate],
      slotPartGapSec(event),
    );
  } catch (error) {
    return mapMutationError(error);
  }

  const groupXUserId = groupRows[0]?.x_user_id ?? null;
  const groupSnapshotXId = groupRows[0]?.reserved_x_id_snapshot ?? null;
  if (groupXUserId != null && slotXUserId != null && groupXUserId !== slotXUserId) {
    return failOutcome(409, "この連続枠は別の X ID で確保されているため拡張できません。");
  }

  const groupId = anchor.reservation_group_id || generateId("sgrp");
  const targetXId = identity.targetXId ?? slotXUserId;
  const displayName = groupRows[0]!.display_name;
  const candidateMutations = buildSlotReserveMutationPlan({
    rows: [candidate],
    actorUserId: ctx.authUserId,
    identity: { canonicalXUserId: targetXId, snapshotXId: groupSnapshotXId },
    displayName,
    groupId,
  });

  try {
    await commitSlotMutationPlanCore({
      db,
      mutations: [
        ...buildRegroupMutations(groupRows, { reservation_group_id: groupId }, identity),
        ...candidateMutations,
      ],
      eventId: anchor.event_id,
      actorUserId: ctx.authUserId,
      reason: "slot_user_extend",
      preloaded: ctx.preloaded,
      callerQueryCount,
      loadWakeHost: loadNoopWakeHost,
    });
  } catch (error) {
    return mapMutationError(error);
  }

  return okOutcome(candidate.id, groupRows.length + 1);
}

/** SA-068 mergeOwnSlotGroups */
export async function mergeSlotGroupsCore(
  rawDb: SlotD1Like,
  db: ServerCoreDb,
  ctx: SlotMutationContext,
  input: {
    eventId: string;
    gap_slot_id: string;
    display_name: string;
    operator_override: boolean;
  },
): Promise<SlotMutationOutcome> {
  const leftGroupRowsSql = `
        SELECT ${SLOT_COLUMNS.map((c) => `s."${c}"`).join(", ")}
        FROM "slots" s, left_cte l
        WHERE l."reservation_group_id" IS NOT NULL AND TRIM(l."reservation_group_id") <> ''
          AND s."event_id" = l."event_id" AND s."reservation_group_id" = l."reservation_group_id"
        LIMIT ${MAX_SLOTS_PER_VIDEO + 1}
      `;
  const rightGroupRowsSql = `
        SELECT ${SLOT_COLUMNS.map((c) => `s."${c}"`).join(", ")}
        FROM "slots" s, right_cte r
        WHERE r."reservation_group_id" IS NOT NULL AND TRIM(r."reservation_group_id") <> ''
          AND s."event_id" = r."event_id" AND s."reservation_group_id" = r."reservation_group_id"
        LIMIT ${MAX_SLOTS_PER_VIDEO + 1}
      `;
  const query = `
    WITH gap AS (
      SELECT ${SLOT_COLUMNS.map((c) => `"${c}"`).join(", ")}
      FROM "slots" WHERE "id" = ? AND "event_id" = ? LIMIT 1
    ),
    left_cte AS (
      SELECT ${SLOT_COLUMNS.map((c) => `s."${c}"`).join(", ")}
      FROM "slots" s, gap g
      WHERE s."event_id" = g."event_id" AND ${neighborConditionSql("s", "g", "backward")}
      ORDER BY ${neighborOrderSql("s", "backward")}
      LIMIT 1
    ),
    right_cte AS (
      SELECT ${SLOT_COLUMNS.map((c) => `s."${c}"`).join(", ")}
      FROM "slots" s, gap g
      WHERE s."event_id" = g."event_id" AND ${neighborConditionSql("s", "g", "forward")}
      ORDER BY ${neighborOrderSql("s", "forward")}
      LIMIT 1
    )
    SELECT
      (SELECT ${eventJsonObjectSql("e")} FROM "events" e WHERE e."id" = ? LIMIT 1) AS event_json,
      (SELECT ${slotJsonObjectSql("g")} FROM gap g) AS gap_json,
      ${approvedXJsonSql("?")} AS approved_x_json,
      ${staffRowsJsonSql()} AS staff_json,
      (SELECT ${slotJsonObjectSql("l")} FROM left_cte l) AS left_json,
      (SELECT ${slotJsonObjectSql("r")} FROM right_cte r) AS right_json,
      ${boundedSlotArraySql(leftGroupRowsSql, "lg")} AS left_group_json,
      ${boundedSlotArraySql(rightGroupRowsSql, "rg")} AS right_group_json
  `;
  const snapshot = await rawDb
    .prepare(boundedFirstD1SnapshotSql(query, [
      "event_json", "gap_json", "approved_x_json", "staff_json", "left_json",
      "right_json", "left_group_json", "right_group_json",
    ]))
    .bind(input.gap_slot_id, input.eventId, input.eventId, ctx.authUserId, input.eventId, ctx.authUserId)
    .first<{
      event_json: string | null;
      gap_json: string | null;
      approved_x_json: string | null;
      staff_json: string | null;
      left_json: string | null;
      right_json: string | null;
      left_group_json: string | null;
      right_group_json: string | null;
    }>();
  if (!snapshot || invalidJsonSnapshot(snapshot)) {
    return failOutcome(503, GENERIC_MUTATION_ERROR_MESSAGE);
  }

  const approvedXIds = parseJsonOrThrow<string[]>(snapshot.approved_x_json, []);
  const staffRows = parseJsonOrThrow<StaffPermissionRow[]>(snapshot.staff_json, []);
  if (invalidArrayIdentity(approvedXIds) ||
      invalidStaffProjection(staffRows) ||
      approvedXIds.length > MAX_APPROVED_X_IDS ||
      staffRows.length > MAX_OPERATOR_STAFF_ROWS) {
    return failOutcome(503, GENERIC_MUTATION_ERROR_MESSAGE);
  }

  const gap = parseJsonOrThrow<SlotRow | null>(snapshot.gap_json, null);
  if (!gap) return failOutcome(404, "枠が見つかりません。");
  if (gap.status !== "available") return failOutcome(409, "対象の枠はすでに確保されています。");
  const event = parseJsonOrThrow<EventFacts | null>(snapshot.event_json, null);
  if (!event) return failOutcome(404, "イベントが見つかりません。");

  const operatorCheck = resolveOperatorOverride({
    requested: input.operator_override,
    userRole: ctx.userRole,
    staffRows,
    event,
  });
  if (!operatorCheck.ok) return failOutcome(operatorCheck.status, operatorCheck.message);
  const operatorOverride = operatorCheck.enabled;
  if (!isAcceptingEntries(event) && !operatorOverride) {
    return failOutcome(409, "受付中ではないため結合できません。");
  }

  const left = parseJsonOrThrow<SlotRow | null>(snapshot.left_json, null);
  const right = parseJsonOrThrow<SlotRow | null>(snapshot.right_json, null);
  if (!left || !right) return failOutcome(409, "結合対象の隣接枠がありません。");

  const partGap = slotPartGapSec(event);
  try {
    assertAdjacentSequence([left, gap, right], partGap);
  } catch (error) {
    return mapMutationError(error);
  }

  const leftActor = assertSlotActor(left, ctx.authUserId, ctx.activeXId);
  const rightActor = assertSlotActor(right, ctx.authUserId, ctx.activeXId);
  if (left.status !== "reserved" || right.status !== "reserved" || !leftActor.ok || !rightActor.ok) {
    return failOutcome(
      !leftActor.ok || !rightActor.ok ? 403 : 409,
      !leftActor.ok
        ? leftActor.message
        : !rightActor.ok
          ? rightActor.message
          : "自分の予約中の隣接枠どうしのみ結合できます。",
    );
  }
  if (left.x_user_id !== right.x_user_id || left.reserved_x_id_snapshot !== right.reserved_x_id_snapshot) {
    return failOutcome(409, "連続枠に別の X ID が混在しているため結合できません。");
  }

  let leftGroup: SlotRow[];
  let rightGroup: SlotRow[];
  try {
    leftGroup = resolveBoundedGroupFromSnapshot(
      left,
      parseJsonOrThrow<SlotRow[]>(snapshot.left_group_json, []),
    );
    rightGroup = resolveBoundedGroupFromSnapshot(
      right,
      parseJsonOrThrow<SlotRow[]>(snapshot.right_group_json, []),
    );
  } catch (error) {
    return mapMutationError(error);
  }
  if (left.event_id !== right.event_id) {
    return failOutcome(409, "異なるイベントの枠は結合できません。");
  }
  const leftSubject = resolveSlotReservationSubject(leftGroup);
  const rightSubject = resolveSlotReservationSubject(rightGroup);
  if (!leftSubject.ok || !rightSubject.ok) {
    return failOutcome(409, "連続枠の予約者情報が不整合です。運営へ連絡してください。");
  }
  if (!subjectsEqual(leftSubject.subject, rightSubject.subject)) {
    return failOutcome(409, "異なるX IDの連続枠は結合できません。");
  }

  const byId = new Map<string, SlotRow>();
  for (const row of [...leftGroup, ...rightGroup]) byId.set(row.id, row);
  const reservedRows = sortSlotsChronologically([...byId.values()]);
  for (const row of reservedRows) {
    const actorCheck = assertSlotActor(row, ctx.authUserId, ctx.activeXId);
    if (row.status !== "reserved" || !actorCheck.ok) {
      return failOutcome(
        actorCheck.ok ? 409 : 403,
        actorCheck.ok ? "連続枠に別の利用者または状態が混在しています。" : actorCheck.message,
      );
    }
  }

  let identity: { targetXId: string | null; adoptNullRows: boolean };
  try {
    identity = resolveBoundedGroupIdentity(reservedRows, ctx.authUserId, ctx.activeXId);
    const maxRows = operatorOverride ? MAX_SLOTS_PER_VIDEO : normalizeMaxSlotsPerVideo(event.max_slots_per_video);
    if (reservedRows.length + 1 > maxRows) {
      return failOutcome(409, "連続枠の上限を超えるため結合できません。");
    }
    assertAdjacentSequence(sortSlotsChronologically([...reservedRows, gap]), partGap);
  } catch (error) {
    return mapMutationError(error);
  }

  const slotXUserId = resolveSlotXUserId(ctx.activeXId, approvedXIds);
  const groupId = generateId("sgrp");
  const targetXId = identity.targetXId ?? slotXUserId;
  const inheritedSnapshot = reservedRows[0]?.reserved_x_id_snapshot ?? left.reserved_x_id_snapshot;
  const gapMutations = buildSlotReserveMutationPlan({
    rows: [gap],
    actorUserId: ctx.authUserId,
    identity: { canonicalXUserId: targetXId, snapshotXId: inheritedSnapshot },
    displayName: input.display_name,
    groupId,
  });

  try {
    await commitSlotMutationPlanCore({
      db,
      mutations: [
        ...buildRegroupMutations(
          reservedRows,
          { display_name: input.display_name, reservation_group_id: groupId },
          identity,
        ),
        ...gapMutations,
      ],
      eventId: gap.event_id,
      actorUserId: ctx.authUserId,
      reason: "slot_user_merge",
      preloaded: ctx.preloaded,
      callerQueryCount: CALLER_PRE_READS_WITH_SESSION,
      loadWakeHost: loadNoopWakeHost,
    });
  } catch (error) {
    return mapMutationError(error);
  }

  return okOutcome(gap.id, reservedRows.length + 1);
}
