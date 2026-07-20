import "server-only";

import { and, eq, inArray, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import type { DB } from "@/lib/db/client";
import { eventStaff, xUserAccountLinks } from "@/lib/db/schema";
import { mutateWithAudit } from "@/lib/audit/mutate";
import type { WriteAuditLogInput } from "@/lib/audit/types";
import { generateId } from "@/lib/utils/id";
import {
  assertEventWillRetainOwner as assertOwnerRetained,
  assertOwnershipTransferInput,
  assertSelfChangeConfirmation,
  isActorTargetingSelf,
  isEventOwner,
  LAST_OWNER_ERROR,
  validateEventStaffSubject,
  validateEventStaffUniqueness as validateRowsForUniqueness,
  type EventStaffOwnershipRow,
  type EventStaffPreset,
} from "./eventOwnershipCore";

export {
  isActorTargetingSelf,
  LAST_OWNER_ERROR,
  type EventStaffPreset,
} from "./eventOwnershipCore";

export type EventStaffRow = typeof eventStaff.$inferSelect;

export type EventStaffWriteValues = {
  x_user_id: string;
  display_name: string;
  permission_preset: EventStaffPreset;
  custom_permission_keys_json: string | null;
  is_public: number;
  public_role_label: string | null;
};

export type EventStaffAtomicExtras = {
  mutationStatements: readonly BatchItem<"sqlite">[];
  expectedMutationChanges: readonly (number | null)[];
  audits: readonly WriteAuditLogInput[];
};

const EMPTY_EVENT_STAFF_ATOMIC_EXTRAS: EventStaffAtomicExtras = {
  mutationStatements: [],
  expectedMutationChanges: [],
  audits: [],
};

function normalizeEventStaffAtomicExtras(
  extras: EventStaffAtomicExtras | undefined,
): EventStaffAtomicExtras {
  const normalized = extras ?? EMPTY_EVENT_STAFF_ATOMIC_EXTRAS;
  if (
    normalized.mutationStatements.length !==
    normalized.expectedMutationChanges.length
  ) {
    throw new Error(
      "イベントスタッフ補助mutationと期待変更件数の数が一致しません。",
    );
  }
  return normalized;
}

export type EventStaffBulkAtomicExtras = EventStaffAtomicExtras;

export type EventStaffReplaceAtomicWork = {
  afterRows: EventStaffRow[];
  mutationStatements: BatchItem<"sqlite">[];
  expectedMutationChanges: Array<number | null>;
  audits: WriteAuditLogInput[];
};

export type EventStaffBulkUpsert = {
  id: string;
  existingId: string | null;
  values: EventStaffWriteValues;
};

export type EventStaffReplacement = {
  id: string;
  values: EventStaffWriteValues;
};

function asOwnershipRow(row: EventStaffRow): EventStaffOwnershipRow {
  return {
    id: row.id,
    event_id: row.event_id,
    x_user_id: row.x_user_id,
    permission_preset: row.permission_preset,
  };
}

function snapshot(row: EventStaffRow): Record<string, unknown> {
  return {
    id: row.id,
    event_id: row.event_id,
    x_user_id: row.x_user_id,
    display_name: row.display_name,
    permission_preset: row.permission_preset,
    custom_permission_keys_json: row.custom_permission_keys_json,
    is_public: row.is_public,
    public_role_label: row.public_role_label,
    approved_by_auth_user_id: row.approved_by_auth_user_id,
    approved_at: row.approved_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export async function getEventOwners(
  db: DB,
  eventId: string,
): Promise<EventStaffRow[]> {
  return db
    .select()
    .from(eventStaff)
    .where(
      and(
        eq(eventStaff.event_id, eventId),
        eq(eventStaff.permission_preset, "owner"),
      )!,
    );
}

/** 認証ユーザーに紐づく全X名義を正本リンクから解決する。 */
export async function getApprovedXIdsForUser(
  db: DB,
  authUserId: string,
): Promise<string[]> {
  const rows = await db
    .select({ x_user_id: xUserAccountLinks.x_user_id })
    .from(xUserAccountLinks)
    .where(eq(xUserAccountLinks.auth_user_id, authUserId));
  return Array.from(new Set(rows.map((row) => row.x_user_id)));
}

export async function assertEventWillRetainOwner(args: {
  db: DB;
  target: EventStaffRow;
  nextPreset: EventStaffPreset | null;
}): Promise<void> {
  const owners = await getEventOwners(args.db, args.target.event_id);
  assertOwnerRetained({
    owners: owners.map(asOwnershipRow),
    target: asOwnershipRow(args.target),
    nextPreset: args.nextPreset,
  });
}

export async function validateEventStaffUniqueness(args: {
  db: DB;
  eventId: string;
  candidate: Pick<EventStaffRow, "id" | "x_user_id">;
}): Promise<void> {
  validateEventStaffSubject({ xUserId: args.candidate.x_user_id });
  const rows = await args.db
    .select()
    .from(eventStaff)
    .where(eq(eventStaff.event_id, args.eventId));
  validateRowsForUniqueness({
    rows: rows.map(asOwnershipRow),
    candidate: {
      id: args.candidate.id,
      event_id: args.eventId,
      x_user_id: args.candidate.x_user_id,
    },
  });
}

export async function assertActorMayAssignOwner(args: {
  db: DB;
  eventId: string;
  actorUserId: string;
  isSiteAdmin: boolean;
}): Promise<void> {
  if (args.isSiteAdmin) return;
  const [owners, linkedXIds] = await Promise.all([
    getEventOwners(args.db, args.eventId),
    getApprovedXIdsForUser(args.db, args.actorUserId),
  ]);
  const isOwner = owners.some((owner) =>
    isActorTargetingSelf({
      target: asOwnershipRow(owner),
      linkedXIds,
    }),
  );
  if (!isOwner) {
    throw new Error("代表権限を付与できるのはイベント代表者または管理者だけです。");
  }
}

export async function assertSelfChangeRequirements(args: {
  db: DB;
  actorUserId: string;
  target: EventStaffRow;
  removesMembership: boolean;
  nextPreset: EventStaffPreset | null;
  confirmText: string | null | undefined;
  reason: string | null | undefined;
}): Promise<void> {
  const linkedXIds = await getApprovedXIdsForUser(args.db, args.actorUserId);
  const selfTarget = isActorTargetingSelf({
    target: asOwnershipRow(args.target),
    linkedXIds,
  });
  const losesMemberPermission =
    isEventOwner(asOwnershipRow(args.target)) && args.nextPreset !== "owner";
  assertSelfChangeConfirmation({
    eventId: args.target.event_id,
    isSelfTarget: selfTarget,
    removesMembership: args.removesMembership,
    losesMemberPermission,
    confirmText: args.confirmText,
    reason: args.reason,
  });
}

export async function createEventStaffWithProtection(args: {
  db: DB;
  id: string;
  eventId: string;
  values: EventStaffWriteValues;
  actorUserId: string;
  reason: string | null;
  context?: string | null;
  now: number;
  atomicExtras?: EventStaffAtomicExtras;
}): Promise<EventStaffRow> {
  await validateEventStaffUniqueness({
    db: args.db,
    eventId: args.eventId,
    candidate: { id: args.id, x_user_id: args.values.x_user_id },
  });

  const row: EventStaffRow = {
    id: args.id,
    event_id: args.eventId,
    x_user_id: args.values.x_user_id,
    display_name: args.values.display_name,
    permission_preset: args.values.permission_preset,
    custom_permission_keys_json: args.values.custom_permission_keys_json,
    is_public: args.values.is_public,
    public_role_label: args.values.public_role_label,
    approved_by_auth_user_id: args.actorUserId,
    approved_at: args.now,
    created_at: args.now,
    updated_at: args.now,
  };
  const extras = normalizeEventStaffAtomicExtras(args.atomicExtras);

  await mutateWithAudit(args.db, {
    mutationStatements: [
      ...extras.mutationStatements,
      args.db.run(sql`
        INSERT INTO event_staff (
          id, event_id, x_user_id, display_name, permission_preset,
          custom_permission_keys_json, is_public, public_role_label,
          approved_by_auth_user_id, approved_at, created_at, updated_at
        ) VALUES (
          ${row.id}, ${row.event_id}, ${row.x_user_id}, ${row.display_name},
          ${row.permission_preset}, ${row.custom_permission_keys_json},
          ${row.is_public}, ${row.public_role_label},
          ${row.approved_by_auth_user_id}, ${row.approved_at},
          ${row.created_at}, ${row.updated_at}
        )
      `),
    ],
    expectedMutationChanges: [...extras.expectedMutationChanges, 1],
    audits: [
      ...extras.audits,
      {
        table_name: "event_staff",
        target_id: row.id,
        operation: "CREATE",
        before: null,
        after: snapshot(row),
        actor_user_id: args.actorUserId,
        reason: args.reason,
        context: args.context ?? null,
        retention_class: "long_audit",
        restore_strategy: "delete_created",
        strict: true,
      },
    ],
  });
  return row;
}

export async function updateEventStaffWithProtection(args: {
  db: DB;
  existing: EventStaffRow;
  values: EventStaffWriteValues;
  actorUserId: string;
  reason: string | null;
  confirmText: string | null | undefined;
  context?: string | null;
  now: number;
  atomicExtras?: EventStaffAtomicExtras;
}): Promise<EventStaffRow> {
  await validateEventStaffUniqueness({
    db: args.db,
    eventId: args.existing.event_id,
    candidate: { id: args.existing.id, x_user_id: args.values.x_user_id },
  });
  await assertEventWillRetainOwner({
    db: args.db,
    target: args.existing,
    nextPreset: args.values.permission_preset,
  });
  await assertSelfChangeRequirements({
    db: args.db,
    actorUserId: args.actorUserId,
    target: args.existing,
    removesMembership: false,
    nextPreset: args.values.permission_preset,
    confirmText: args.confirmText,
    reason: args.reason,
  });

  const after: EventStaffRow = {
    ...args.existing,
    ...args.values,
    updated_at: args.now,
  };
  const extras = normalizeEventStaffAtomicExtras(args.atomicExtras);
  const demotesOwner =
    args.existing.permission_preset === "owner" &&
    args.values.permission_preset !== "owner";
  const ownerCondition = demotesOwner
    ? sql`(SELECT COUNT(*) FROM event_staff WHERE event_id = ${args.existing.event_id} AND permission_preset = 'owner') > 1`
    : sql`1 = 1`;

  await mutateWithAudit(args.db, {
    mutationStatements: [
      ...extras.mutationStatements,
      args.db.run(sql`
        UPDATE event_staff
        SET x_user_id = ${after.x_user_id},
            display_name = ${after.display_name},
            permission_preset = ${after.permission_preset},
            custom_permission_keys_json = ${after.custom_permission_keys_json},
            is_public = ${after.is_public},
            public_role_label = ${after.public_role_label},
            updated_at = ${after.updated_at}
        WHERE id = ${args.existing.id}
          AND event_id = ${args.existing.event_id}
          AND updated_at = ${args.existing.updated_at}
          AND (${ownerCondition})
      `),
    ],
    expectedMutationChanges: [...extras.expectedMutationChanges, 1],
    audits: [
      ...extras.audits,
      {
        table_name: "event_staff",
        target_id: after.id,
        operation: "UPDATE",
        before: snapshot(args.existing),
        after: snapshot(after),
        actor_user_id: args.actorUserId,
        reason: args.reason,
        context: args.context ?? null,
        retention_class: "long_audit",
        restore_strategy: "update_before",
        strict: true,
      },
    ],
  });
  return after;
}

export async function deleteEventStaffWithProtection(args: {
  db: DB;
  existing: EventStaffRow;
  actorUserId: string;
  reason: string | null;
  confirmText: string | null | undefined;
  context?: string | null;
}): Promise<void> {
  await assertEventWillRetainOwner({
    db: args.db,
    target: args.existing,
    nextPreset: null,
  });
  await assertSelfChangeRequirements({
    db: args.db,
    actorUserId: args.actorUserId,
    target: args.existing,
    removesMembership: true,
    nextPreset: null,
    confirmText: args.confirmText,
    reason: args.reason,
  });
  const ownerCondition = args.existing.permission_preset === "owner"
    ? sql`(SELECT COUNT(*) FROM event_staff WHERE event_id = ${args.existing.event_id} AND permission_preset = 'owner') > 1`
    : sql`1 = 1`;

  await mutateWithAudit(args.db, {
    mutationStatements: [args.db.run(sql`
      DELETE FROM event_staff
      WHERE id = ${args.existing.id}
        AND event_id = ${args.existing.event_id}
        AND updated_at = ${args.existing.updated_at}
        AND (${ownerCondition})
    `)],
    expectedMutationChanges: 1,
    audits: [{
      table_name: "event_staff",
      target_id: args.existing.id,
      operation: "DELETE",
      before: snapshot(args.existing),
      after: null,
      actor_user_id: args.actorUserId,
      reason: args.reason,
      context: args.context ?? null,
      retention_class: "long_audit",
      restore_strategy: "recreate_deleted",
      strict: true,
    }],
  });
}

export async function bulkUpsertEventStaffWithProtection(args: {
  db: DB;
  eventId: string;
  actorUserId: string;
  reason: string;
  context?: string | null;
  now: number;
  upserts: readonly EventStaffBulkUpsert[];
  atomicExtras?: EventStaffBulkAtomicExtras;
}): Promise<EventStaffRow[]> {
  if (args.upserts.length === 0) {
    throw new Error("一括スタッフ更新に対象行がありません。");
  }
  const extras = normalizeEventStaffAtomicExtras(args.atomicExtras);
  const existingRows = await args.db
    .select()
    .from(eventStaff)
    .where(eq(eventStaff.event_id, args.eventId));
  const existingById = new Map(existingRows.map((row) => [row.id, row]));
  const prospectiveById = new Map(existingRows.map((row) => [row.id, row]));
  const mutatedIds = new Set<string>();
  const afterRows: Array<{ before: EventStaffRow | null; after: EventStaffRow }> = [];

  for (const upsert of args.upserts) {
    if (!upsert.id || mutatedIds.has(upsert.id)) {
      throw new Error("一括スタッフ更新に重複した行があります。");
    }
    mutatedIds.add(upsert.id);
    validateEventStaffSubject({ xUserId: upsert.values.x_user_id });
    const existing = upsert.existingId
      ? existingById.get(upsert.existingId) ?? null
      : null;
    if (upsert.existingId && !existing) {
      throw new Error("更新対象のスタッフが見つからないため、一括更新を中止しました。");
    }
    if (!existing && existingById.has(upsert.id)) {
      throw new Error("新規スタッフ ID が既存行と衝突しています。");
    }
    if (
      existing?.permission_preset === "owner" ||
      upsert.values.permission_preset === "owner"
    ) {
      throw new Error(
        "代表者の追加・変更は一括更新では行えません。専用の代表者移譲操作を使用してください。",
      );
    }
    const after: EventStaffRow = existing
      ? { ...existing, ...upsert.values, updated_at: args.now }
      : {
          id: upsert.id,
          event_id: args.eventId,
          ...upsert.values,
          approved_by_auth_user_id: args.actorUserId,
          approved_at: args.now,
          created_at: args.now,
          updated_at: args.now,
        };
    prospectiveById.set(after.id, after);
    afterRows.push({ before: existing, after });
  }

  const xSubjects = new Map<string, string>();
  let ownerCount = 0;
  for (const row of prospectiveById.values()) {
    if (row.permission_preset === "owner") ownerCount += 1;
    const duplicate = xSubjects.get(row.x_user_id);
    if (duplicate && duplicate !== row.id) {
      throw new Error("同じイベントに同一 X ID のスタッフを重複登録できません。");
    }
    xSubjects.set(row.x_user_id, row.id);
  }
  if (ownerCount < 1) throw new Error(LAST_OWNER_ERROR);

  const linkedXIds = await getApprovedXIdsForUser(args.db, args.actorUserId);
  for (const { after } of afterRows) {
    if (isActorTargetingSelf({ target: asOwnershipRow(after), linkedXIds })) {
      throw new Error(
        "自分自身のスタッフ権限は一括更新できません。個別の確認付き操作を使用してください。",
      );
    }
  }

  const mutationStatements: BatchItem<"sqlite">[] = [
    ...extras.mutationStatements,
    ...afterRows.map(({ before, after }) =>
      before
        ? args.db.run(sql`
            UPDATE event_staff
            SET x_user_id = ${after.x_user_id},
                display_name = ${after.display_name},
                permission_preset = ${after.permission_preset},
                custom_permission_keys_json = ${after.custom_permission_keys_json},
                is_public = ${after.is_public},
                public_role_label = ${after.public_role_label},
                updated_at = ${after.updated_at}
            WHERE id = ${before.id}
              AND event_id = ${args.eventId}
              AND updated_at = ${before.updated_at}
          `)
        : args.db.run(sql`
            INSERT INTO event_staff (
              id, event_id, x_user_id, display_name, permission_preset,
              custom_permission_keys_json, is_public, public_role_label,
              approved_by_auth_user_id, approved_at, created_at, updated_at
            ) VALUES (
              ${after.id}, ${after.event_id}, ${after.x_user_id},
              ${after.display_name}, ${after.permission_preset},
              ${after.custom_permission_keys_json}, ${after.is_public},
              ${after.public_role_label}, ${after.approved_by_auth_user_id},
              ${after.approved_at}, ${after.created_at}, ${after.updated_at}
            )
          `),
    ),
  ];
  const expectedMutationChanges = [
    ...extras.expectedMutationChanges,
    ...afterRows.map(() => 1),
  ];
  const audits: WriteAuditLogInput[] = [
    ...extras.audits,
    ...afterRows.map<WriteAuditLogInput>(({ before, after }) => ({
      table_name: "event_staff",
      target_id: after.id,
      operation: before ? "UPDATE" : "CREATE",
      before: before ? snapshot(before) : null,
      after: snapshot(after),
      actor_user_id: args.actorUserId,
      reason: args.reason,
      context: args.context ?? null,
      retention_class: "long_audit",
      restore_strategy: before ? "update_before" : "delete_created",
      strict: true,
    })),
  ];

  await mutateWithAudit(args.db, {
    mutationStatements,
    expectedMutationChanges,
    audits,
  });
  return afterRows.map(({ after }) => after);
}

function eventStaffVersionGuard(args: {
  eventId: string;
  rows: readonly EventStaffRow[];
}) {
  const rowPredicates = args.rows.map(
    (row) => sql`
      EXISTS (
        SELECT 1 FROM event_staff
        WHERE id = ${row.id}
          AND event_id = ${args.eventId}
          AND updated_at = ${row.updated_at}
      )
    `,
  );
  const exactSet = args.rows.length === 0
    ? sql`NOT EXISTS (SELECT 1 FROM event_staff WHERE event_id = ${args.eventId})`
    : sql`
        (SELECT COUNT(*) FROM event_staff WHERE event_id = ${args.eventId}) = ${args.rows.length}
        AND ${sql.join(rowPredicates, sql` AND `)}
      `;
  return sql`
    SELECT CASE
      WHEN (${exactSet}) THEN 1
      ELSE json_extract('not-valid-json', '$')
    END
  `;
}

export async function buildReplaceEventStaffWithProtection(args: {
  db: DB;
  eventId: string;
  actorUserId: string;
  reason: string;
  context?: string | null;
  now: number;
  replacements: readonly EventStaffReplacement[];
  confirmText?: string | null;
  atomicExtras?: EventStaffBulkAtomicExtras;
}): Promise<EventStaffReplaceAtomicWork> {
  if (!args.reason.trim()) {
    throw new Error("スタッフ一括置換には理由が必要です。");
  }
  if (args.replacements.length === 0) throw new Error(LAST_OWNER_ERROR);
  const extras = normalizeEventStaffAtomicExtras(args.atomicExtras);
  const beforeRows = await args.db
    .select()
    .from(eventStaff)
    .where(eq(eventStaff.event_id, args.eventId));
  const ids = new Set<string>();
  const xSubjects = new Set<string>();
  let ownerCount = 0;
  const afterRows: EventStaffRow[] = [];

  for (const replacement of args.replacements) {
    if (!replacement.id || ids.has(replacement.id)) {
      throw new Error("一括スタッフ置換に重複または空のスタッフ ID があります。");
    }
    ids.add(replacement.id);
    validateEventStaffSubject({ xUserId: replacement.values.x_user_id });
    if (xSubjects.has(replacement.values.x_user_id)) {
      throw new Error("同一イベントに同一 X ID のスタッフを重複登録できません。");
    }
    xSubjects.add(replacement.values.x_user_id);
    if (replacement.values.permission_preset === "owner") ownerCount += 1;
    afterRows.push({
      id: replacement.id,
      event_id: args.eventId,
      ...replacement.values,
      approved_by_auth_user_id: args.actorUserId,
      approved_at: args.now,
      created_at: args.now,
      updated_at: args.now,
    });
  }
  if (ownerCount < 1) throw new Error(LAST_OWNER_ERROR);

  const linkedXIds = await getApprovedXIdsForUser(args.db, args.actorUserId);
  for (const before of beforeRows) {
    if (!isActorTargetingSelf({ target: asOwnershipRow(before), linkedXIds })) continue;
    const next = afterRows.find((after) => after.x_user_id === before.x_user_id);
    assertSelfChangeConfirmation({
      eventId: args.eventId,
      isSelfTarget: true,
      removesMembership: !next,
      losesMemberPermission:
        before.permission_preset === "owner" && next?.permission_preset !== "owner",
      confirmText: args.confirmText,
      reason: args.reason,
    });
  }

  const mutationStatements: BatchItem<"sqlite">[] = [
    ...extras.mutationStatements,
    args.db.run(eventStaffVersionGuard({ eventId: args.eventId, rows: beforeRows })),
    args.db.run(sql`DELETE FROM event_staff WHERE event_id = ${args.eventId}`),
    ...afterRows.map((after) =>
      args.db.run(sql`
        INSERT INTO event_staff (
          id, event_id, x_user_id, display_name, permission_preset,
          custom_permission_keys_json, is_public, public_role_label,
          approved_by_auth_user_id, approved_at, created_at, updated_at
        ) VALUES (
          ${after.id}, ${after.event_id}, ${after.x_user_id},
          ${after.display_name}, ${after.permission_preset},
          ${after.custom_permission_keys_json}, ${after.is_public},
          ${after.public_role_label}, ${after.approved_by_auth_user_id},
          ${after.approved_at}, ${after.created_at}, ${after.updated_at}
        )
      `),
    ),
  ];
  const expectedMutationChanges: Array<number | null> = [
    ...extras.expectedMutationChanges,
    null,
    beforeRows.length,
    ...afterRows.map(() => 1),
  ];
  const audits: WriteAuditLogInput[] = [
    ...extras.audits,
    ...beforeRows.map<WriteAuditLogInput>((before) => ({
      table_name: "event_staff",
      target_id: before.id,
      operation: "DELETE",
      before: snapshot(before),
      after: null,
      actor_user_id: args.actorUserId,
      reason: args.reason,
      context: args.context ?? null,
      retention_class: "long_audit",
      restore_strategy: "recreate_deleted",
      strict: true,
    })),
    ...afterRows.map<WriteAuditLogInput>((after) => ({
      table_name: "event_staff",
      target_id: after.id,
      operation: "CREATE",
      before: null,
      after: snapshot(after),
      actor_user_id: args.actorUserId,
      reason: args.reason,
      context: args.context ?? null,
      retention_class: "long_audit",
      restore_strategy: "delete_created",
      strict: true,
    })),
  ];

  return { afterRows, mutationStatements, expectedMutationChanges, audits };
}

export async function transferEventOwnership(args: {
  db: DB;
  eventId: string;
  fromStaffId: string;
  toStaffId: string;
  actorUserId: string;
  reason: string;
  confirmText: string;
  selfConfirmText?: string | null;
  context?: string | null;
  now?: number;
}): Promise<{ transferRunId: string }> {
  const rows = await args.db
    .select()
    .from(eventStaff)
    .where(
      and(
        eq(eventStaff.event_id, args.eventId),
        inArray(eventStaff.id, [args.fromStaffId, args.toStaffId]),
      )!,
    );
  const from = rows.find((row) => row.id === args.fromStaffId) ?? null;
  const to = rows.find((row) => row.id === args.toStaffId) ?? null;
  assertOwnershipTransferInput({
    eventId: args.eventId,
    from: from ? asOwnershipRow(from) : null,
    to: to ? asOwnershipRow(to) : null,
    confirmText: args.confirmText,
    reason: args.reason,
  });

  const linkedXIds = await getApprovedXIdsForUser(args.db, args.actorUserId);
  const actorIsFrom = from
    ? isActorTargetingSelf({ target: asOwnershipRow(from), linkedXIds })
    : false;
  assertSelfChangeConfirmation({
    eventId: args.eventId,
    isSelfTarget: actorIsFrom,
    removesMembership: false,
    losesMemberPermission: actorIsFrom,
    confirmText: actorIsFrom ? args.selfConfirmText : args.confirmText,
    reason: args.reason,
  });

  const now = args.now ?? Math.floor(Date.now() / 1000);
  const transferRunId = generateId("ownership-transfer");
  const afterFrom: EventStaffRow = {
    ...from!,
    permission_preset: "manager",
    custom_permission_keys_json: null,
    updated_at: now,
  };
  const afterTo: EventStaffRow = {
    ...to!,
    permission_preset: "owner",
    custom_permission_keys_json: null,
    updated_at: now,
  };
  const context = args.context ?? `ownership-transfer:${transferRunId}`;

  await mutateWithAudit(args.db, {
    mutationStatements: [args.db.run(sql`
      UPDATE event_staff
      SET permission_preset = CASE
            WHEN id = ${args.toStaffId} THEN 'owner'
            WHEN id = ${args.fromStaffId} THEN 'manager'
            ELSE permission_preset
          END,
          custom_permission_keys_json = CASE
            WHEN id IN (${args.toStaffId}, ${args.fromStaffId}) THEN NULL
            ELSE custom_permission_keys_json
          END,
          updated_at = ${now}
      WHERE event_id = ${args.eventId}
        AND id IN (${args.fromStaffId}, ${args.toStaffId})
        AND (SELECT permission_preset FROM event_staff WHERE id = ${args.fromStaffId} AND event_id = ${args.eventId}) = 'owner'
        AND (SELECT updated_at FROM event_staff WHERE id = ${args.fromStaffId} AND event_id = ${args.eventId}) = ${from!.updated_at}
        AND (SELECT updated_at FROM event_staff WHERE id = ${args.toStaffId} AND event_id = ${args.eventId}) = ${to!.updated_at}
        AND (SELECT COUNT(*) FROM event_staff WHERE event_id = ${args.eventId} AND id IN (${args.fromStaffId}, ${args.toStaffId})) = 2
    `)],
    expectedMutationChanges: 2,
    audits: [
      {
        table_name: "event_staff",
        target_id: afterFrom.id,
        operation: "UPDATE",
        before: snapshot(from!),
        after: snapshot(afterFrom),
        actor_user_id: args.actorUserId,
        reason: args.reason,
        context,
        retention_class: "long_audit",
        restore_strategy: "update_before",
        strict: true,
      },
      {
        table_name: "event_staff",
        target_id: afterTo.id,
        operation: "UPDATE",
        before: snapshot(to!),
        after: snapshot(afterTo),
        actor_user_id: args.actorUserId,
        reason: args.reason,
        context,
        retention_class: "long_audit",
        restore_strategy: "update_before",
        strict: true,
      },
    ],
  });

  return { transferRunId };
}
