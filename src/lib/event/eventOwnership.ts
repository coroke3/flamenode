import "server-only";

import { and, eq, inArray, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import type { DB } from "@/lib/db/client";
import { eventStaff, xUsers } from "@/lib/db/schema";
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
  syncLegacyRoleFromPreset,
  validateEventStaffSubject,
  validateEventStaffUniqueness as validateRowsForUniqueness,
  type EventStaffOwnershipRow,
  type EventStaffPreset,
} from "./eventOwnershipCore";

export {
  isActorTargetingSelf,
  LAST_OWNER_ERROR,
  syncLegacyRoleFromPreset,
  type EventStaffPreset,
} from "./eventOwnershipCore";

export type EventStaffRow = typeof eventStaff.$inferSelect;

export type EventStaffWriteValues = {
  user_id: string | null;
  x_user_id: string | null;
  display_name: string;
  permission_preset: EventStaffPreset;
  custom_permission_keys_json: string | null;
  is_public: number;
  public_role_label: string | null;
  internal_note: string | null;
};

/** event_staff と不可分に確定する補助 mutation（例: 新規 X ID の作成）。 */
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

/** 一括スタッフ更新で同じ D1 batch に含める補助 mutation。 */
export type EventStaffBulkAtomicExtras = {
  mutationStatements: readonly BatchItem<"sqlite">[];
  expectedMutationChanges: readonly (number | null)[];
  audits: readonly WriteAuditLogInput[];
};

/** 全置換を外部のより大きな D1 batch に組み込むための確定前 work。 */
export type EventStaffReplaceAtomicWork = {
  afterRows: EventStaffRow[];
  mutationStatements: BatchItem<"sqlite">[];
  expectedMutationChanges: Array<number | null>;
  audits: WriteAuditLogInput[];
};

export type EventStaffBulkUpsert = {
  /** 新規行では発行済みの ID、更新行では既存 ID。 */
  id: string;
  /** null は新規作成、文字列は同じイベント内の既存行を更新する。 */
  existingId: string | null;
  values: EventStaffWriteValues;
};

/**
 * イベントのスタッフ集合を置換するための正規化済み行。
 * import / spreadsheet のように delete → insert が必要な入口も、この型を経由する。
 */
export type EventStaffReplacement = {
  id: string;
  values: EventStaffWriteValues;
};

function asOwnershipRow(row: EventStaffRow): EventStaffOwnershipRow {
  return {
    id: row.id,
    event_id: row.event_id,
    user_id: row.user_id,
    x_user_id: row.x_user_id,
    permission_preset: row.permission_preset,
    role: row.role,
  };
}

function snapshot(row: EventStaffRow): Record<string, unknown> {
  return {
    id: row.id,
    event_id: row.event_id,
    user_id: row.user_id,
    x_user_id: row.x_user_id,
    display_name: row.display_name,
    role: row.role,
    permission_preset: row.permission_preset,
    custom_permission_keys_json: row.custom_permission_keys_json,
    is_public: row.is_public,
    public_role_label: row.public_role_label,
    internal_note: row.internal_note,
    approved_by_user_id: row.approved_by_user_id,
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
}export async function getApprovedXIdsForUser(
  db: DB,
  userId: string,
): Promise<string[]> {
  const rows = await db
    .select({ id: xUsers.id })
    .from(xUsers)
    .where(
      and(
        eq(xUsers.linked_user_id, userId),
        eq(xUsers.approval_status, "approved"),
      )!,
    );
  return rows.map((row) => row.id);
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
  candidate: Pick<EventStaffRow, "id" | "user_id" | "x_user_id">;
}): Promise<void> {
  validateEventStaffSubject({
    userId: args.candidate.user_id,
    xUserId: args.candidate.x_user_id,
  });
  const rows = await args.db
    .select()
    .from(eventStaff)
    .where(eq(eventStaff.event_id, args.eventId));
  validateRowsForUniqueness({
    rows: rows.map(asOwnershipRow),
    candidate: {
      id: args.candidate.id,
      event_id: args.eventId,
      user_id: args.candidate.user_id,
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
  const [owners, approvedXIds] = await Promise.all([
    getEventOwners(args.db, args.eventId),
    getApprovedXIdsForUser(args.db, args.actorUserId),
  ]);
  const isOwner = owners.some((owner) =>
    isActorTargetingSelf({
      actorUserId: args.actorUserId,
      target: asOwnershipRow(owner),
      approvedXIds,
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
  const approvedXIds = await getApprovedXIdsForUser(args.db, args.actorUserId);
  const selfTarget = isActorTargetingSelf({
    actorUserId: args.actorUserId,
    target: asOwnershipRow(args.target),
    approvedXIds,
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
    candidate: {
      id: args.id,
      user_id: args.values.user_id,
      x_user_id: args.values.x_user_id,
    },
  });

  const row: EventStaffRow = {
    id: args.id,
    event_id: args.eventId,
    user_id: args.values.user_id,
    x_user_id: args.values.x_user_id,
    display_name: args.values.display_name,
    role: syncLegacyRoleFromPreset(args.values.permission_preset),
    permission_preset: args.values.permission_preset,
    custom_permission_keys_json: args.values.custom_permission_keys_json,
    is_public: args.values.is_public,
    public_role_label: args.values.public_role_label,
    internal_note: args.values.internal_note,
    approved_by_user_id: args.actorUserId,
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
        id, event_id, user_id, x_user_id, display_name, role,
        permission_preset, custom_permission_keys_json, is_public,
        public_role_label, internal_note, approved_by_user_id, approved_at,
        created_at, updated_at
      ) VALUES (
        ${row.id}, ${row.event_id}, ${row.user_id}, ${row.x_user_id},
        ${row.display_name}, ${row.role}, ${row.permission_preset},
        ${row.custom_permission_keys_json}, ${row.is_public},
        ${row.public_role_label}, ${row.internal_note},
        ${row.approved_by_user_id}, ${row.approved_at},
        ${row.created_at}, ${row.updated_at}
      )
      `),
    ],
    expectedMutationChanges: [
      ...extras.expectedMutationChanges,
      1,
    ],
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
    candidate: {
      id: args.existing.id,
      user_id: args.values.user_id,
      x_user_id: args.values.x_user_id,
    },
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
    role: syncLegacyRoleFromPreset(args.values.permission_preset),
    updated_at: args.now,
  };
  const extras = normalizeEventStaffAtomicExtras(args.atomicExtras);
  const demotesLastOwner =
    isEventOwner(asOwnershipRow(args.existing)) &&
    args.values.permission_preset !== "owner";
  const ownerCondition = demotesLastOwner
    ? sql`(SELECT COUNT(*) FROM event_staff WHERE event_id = ${args.existing.event_id} AND permission_preset = 'owner') > 1`
    : sql`1 = 1`;

  await mutateWithAudit(args.db, {
    mutationStatements: [
      ...extras.mutationStatements,
      args.db.run(sql`
      UPDATE event_staff
      SET
        user_id = ${after.user_id},
        x_user_id = ${after.x_user_id},
        display_name = ${after.display_name},
        role = ${after.role},
        permission_preset = ${after.permission_preset},
        custom_permission_keys_json = ${after.custom_permission_keys_json},
        is_public = ${after.is_public},
        public_role_label = ${after.public_role_label},
        internal_note = ${after.internal_note},
        updated_at = ${after.updated_at}
      WHERE id = ${args.existing.id}
        AND event_id = ${args.existing.event_id}
        AND updated_at = ${args.existing.updated_at}
        AND (${ownerCondition})
      `),
    ],
    expectedMutationChanges: [
      ...extras.expectedMutationChanges,
      1,
    ],
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
  const ownerCondition = isEventOwner(asOwnershipRow(args.existing))
    ? sql`(SELECT COUNT(*) FROM event_staff WHERE event_id = ${args.existing.event_id} AND permission_preset = 'owner') > 1`
    : sql`1 = 1`;

  await mutateWithAudit(args.db, {
    mutationStatements: [args.db.run(sql`
      DELETE FROM event_staff
      WHERE id = ${args.existing.id} AND event_id = ${args.existing.event_id}
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

/**
 * CSV 等の複数スタッフ登録を、全行・補助 mutation・監査ログを一つの D1 batch
 * で確定する。代表者変更と自分自身の変更は、明示確認付きの個別操作/移譲操作に
 * 限定するためこの API では拒否する。
 */
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
  if (
    args.atomicExtras &&
    args.atomicExtras.mutationStatements.length !==
      args.atomicExtras.expectedMutationChanges.length
  ) {
    throw new Error("一括スタッフ更新の補助 mutation の件数検査が不正です。");
  }

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
    validateEventStaffSubject({
      userId: upsert.values.user_id,
      xUserId: upsert.values.x_user_id,
    });

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
      ? {
          ...existing,
          ...upsert.values,
          role: syncLegacyRoleFromPreset(upsert.values.permission_preset),
          updated_at: args.now,
        }
      : {
          id: upsert.id,
          event_id: args.eventId,
          user_id: upsert.values.user_id,
          x_user_id: upsert.values.x_user_id,
          display_name: upsert.values.display_name,
          role: syncLegacyRoleFromPreset(upsert.values.permission_preset),
          permission_preset: upsert.values.permission_preset,
          custom_permission_keys_json: upsert.values.custom_permission_keys_json,
          is_public: upsert.values.is_public,
          public_role_label: upsert.values.public_role_label,
          internal_note: upsert.values.internal_note,
          approved_by_user_id: args.actorUserId,
          approved_at: args.now,
          created_at: args.now,
          updated_at: args.now,
        };
    prospectiveById.set(after.id, after);
    afterRows.push({ before: existing, after });
  }

  const xSubjectOwners = new Map<string, string>();
  const userSubjectOwners = new Map<string, string>();
  let ownerCount = 0;
  for (const row of prospectiveById.values()) {
    if (row.permission_preset === "owner") ownerCount += 1;
    if (row.x_user_id) {
      const duplicate = xSubjectOwners.get(row.x_user_id);
      if (duplicate && duplicate !== row.id) {
        throw new Error("同じイベントに同一 X ID のスタッフを重複登録できません。");
      }
      xSubjectOwners.set(row.x_user_id, row.id);
    }
    if (row.user_id) {
      const duplicate = userSubjectOwners.get(row.user_id);
      if (duplicate && duplicate !== row.id) {
        throw new Error("同じイベントに同一の内部ユーザー ID を重複登録できません。");
      }
      userSubjectOwners.set(row.user_id, row.id);
    }
  }
  if (ownerCount < 1) {
    throw new Error(LAST_OWNER_ERROR);
  }

  const approvedXIds = await getApprovedXIdsForUser(args.db, args.actorUserId);
  for (const { after } of afterRows) {
    if (
      isActorTargetingSelf({
        actorUserId: args.actorUserId,
        target: asOwnershipRow(after),
        approvedXIds,
      })
    ) {
      throw new Error(
        "自分自身のスタッフ権限は一括更新できません。個別の確認付き操作を使用してください。",
      );
    }
  }

  const mutationStatements: BatchItem<"sqlite">[] = [
    ...(args.atomicExtras?.mutationStatements ?? []),
    ...afterRows.map(({ before, after }) =>
      before
        ? args.db.run(sql`
            UPDATE event_staff
            SET user_id = ${after.user_id}, x_user_id = ${after.x_user_id},
                display_name = ${after.display_name}, role = ${after.role},
                permission_preset = ${after.permission_preset},
                custom_permission_keys_json = ${after.custom_permission_keys_json},
                is_public = ${after.is_public}, public_role_label = ${after.public_role_label},
                internal_note = ${after.internal_note}, updated_at = ${after.updated_at}
            WHERE id = ${before.id} AND event_id = ${args.eventId}
              AND updated_at = ${before.updated_at}
          `)
        : args.db.run(sql`
            INSERT INTO event_staff (
              id, event_id, user_id, x_user_id, display_name, role,
              permission_preset, custom_permission_keys_json, is_public,
              public_role_label, internal_note, approved_by_user_id, approved_at,
              created_at, updated_at
            ) VALUES (
              ${after.id}, ${after.event_id}, ${after.user_id}, ${after.x_user_id},
              ${after.display_name}, ${after.role}, ${after.permission_preset},
              ${after.custom_permission_keys_json}, ${after.is_public},
              ${after.public_role_label}, ${after.internal_note},
              ${after.approved_by_user_id}, ${after.approved_at}, ${after.created_at},
              ${after.updated_at}
            )
          `),
    ),
  ];
  const expectedMutationChanges = [
    ...(args.atomicExtras?.expectedMutationChanges ?? []),
    ...afterRows.map(() => 1),
  ];
  const audits: WriteAuditLogInput[] = [
    ...(args.atomicExtras?.audits ?? []),
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
        WHERE id = ${row.id} AND event_id = ${args.eventId}
          AND updated_at = ${row.updated_at}
      )
    `,
  );
  const exactSet =
    args.rows.length === 0
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

/**
 * event_staff の全置換を単一の D1 batch で行う。
 *
 * delete → insert の途中状態を外へ出さず、最終集合の subject 一意性と owner 最低 1 人を
 * 先に検証する。legacy import と spreadsheet apply は直接 table を操作せずこの入口を使う。
 */
export async function buildReplaceEventStaffWithProtection(args: {
  db: DB;
  eventId: string;
  actorUserId: string;
  reason: string;
  context?: string | null;
  now: number;
  replacements: readonly EventStaffReplacement[];
  /** 既存の本人スタッフを降格・削除する場合だけ必要。 */
  confirmText?: string | null;
  atomicExtras?: EventStaffBulkAtomicExtras;
}): Promise<EventStaffReplaceAtomicWork> {
  if (!args.reason.trim()) {
    throw new Error("スタッフ一括置換には理由が必要です。");
  }
  if (args.replacements.length === 0) {
    throw new Error(LAST_OWNER_ERROR);
  }
  if (
    args.atomicExtras &&
    args.atomicExtras.mutationStatements.length !==
      args.atomicExtras.expectedMutationChanges.length
  ) {
    throw new Error("一括スタッフ置換の補助 mutation と変更件数が一致しません。");
  }

  const beforeRows = await args.db
    .select()
    .from(eventStaff)
    .where(eq(eventStaff.event_id, args.eventId));
  const ids = new Set<string>();
  const xSubjectOwners = new Map<string, string>();
  const userSubjectOwners = new Map<string, string>();
  let ownerCount = 0;
  const afterRows: EventStaffRow[] = [];

  for (const replacement of args.replacements) {
    if (!replacement.id || ids.has(replacement.id)) {
      throw new Error("一括スタッフ置換に重複または空のスタッフ ID があります。");
    }
    ids.add(replacement.id);
    validateEventStaffSubject({
      userId: replacement.values.user_id,
      xUserId: replacement.values.x_user_id,
    });
    if (replacement.values.x_user_id) {
      const duplicate = xSubjectOwners.get(replacement.values.x_user_id);
      if (duplicate) {
        throw new Error("同一イベントに同一 X ID のスタッフを重複登録できません。");
      }
      xSubjectOwners.set(replacement.values.x_user_id, replacement.id);
    }
    if (replacement.values.user_id) {
      const duplicate = userSubjectOwners.get(replacement.values.user_id);
      if (duplicate) {
        throw new Error("同一イベントに同一内部ユーザー ID のスタッフを重複登録できません。");
      }
      userSubjectOwners.set(replacement.values.user_id, replacement.id);
    }
    if (replacement.values.permission_preset === "owner") ownerCount += 1;
    afterRows.push({
      id: replacement.id,
      event_id: args.eventId,
      user_id: replacement.values.user_id,
      x_user_id: replacement.values.x_user_id,
      display_name: replacement.values.display_name,
      role: syncLegacyRoleFromPreset(replacement.values.permission_preset),
      permission_preset: replacement.values.permission_preset,
      custom_permission_keys_json: replacement.values.custom_permission_keys_json,
      is_public: replacement.values.is_public,
      public_role_label: replacement.values.public_role_label,
      internal_note: replacement.values.internal_note,
      approved_by_user_id: args.actorUserId,
      approved_at: args.now,
      created_at: args.now,
      updated_at: args.now,
    });
  }
  if (ownerCount < 1) throw new Error(LAST_OWNER_ERROR);

  const approvedXIds = await getApprovedXIdsForUser(args.db, args.actorUserId);
  for (const before of beforeRows) {
    if (
      !isActorTargetingSelf({
        actorUserId: args.actorUserId,
        target: asOwnershipRow(before),
        approvedXIds,
      })
    ) {
      continue;
    }
    const next = afterRows.find(
      (after) =>
        (after.user_id !== null && after.user_id === before.user_id) ||
        (after.x_user_id !== null && after.x_user_id === before.x_user_id),
    );
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
    ...(args.atomicExtras?.mutationStatements ?? []),
    args.db.run(eventStaffVersionGuard({ eventId: args.eventId, rows: beforeRows })),
    args.db.run(sql`DELETE FROM event_staff WHERE event_id = ${args.eventId}`),
    ...afterRows.map((after) =>
      args.db.run(sql`
        INSERT INTO event_staff (
          id, event_id, user_id, x_user_id, display_name, role,
          permission_preset, custom_permission_keys_json, is_public,
          public_role_label, internal_note, approved_by_user_id, approved_at,
          created_at, updated_at
        ) VALUES (
          ${after.id}, ${after.event_id}, ${after.user_id}, ${after.x_user_id},
          ${after.display_name}, ${after.role}, ${after.permission_preset},
          ${after.custom_permission_keys_json}, ${after.is_public},
          ${after.public_role_label}, ${after.internal_note},
          ${after.approved_by_user_id}, ${after.approved_at}, ${after.created_at},
          ${after.updated_at}
        )
      `),
    ),
  ];
  const expectedMutationChanges: Array<number | null> = [
    ...(args.atomicExtras?.expectedMutationChanges ?? []),
    null,
    beforeRows.length,
    ...afterRows.map(() => 1),
  ];
  const audits: WriteAuditLogInput[] = [
    ...(args.atomicExtras?.audits ?? []),
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

  return {
    afterRows,
    mutationStatements,
    expectedMutationChanges,
    audits,
  };
}export async function transferEventOwnership(args: {
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
  const approvedXIds = await getApprovedXIdsForUser(args.db, args.actorUserId);
  const actorIsFrom = from
    ? isActorTargetingSelf({
        actorUserId: args.actorUserId,
        target: asOwnershipRow(from),
        approvedXIds,
      })
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
    role: syncLegacyRoleFromPreset("manager"),
    updated_at: now,
  };
  const afterTo: EventStaffRow = {
    ...to!,
    permission_preset: "owner",
    custom_permission_keys_json: null,
    role: syncLegacyRoleFromPreset("owner"),
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
          role = CASE
            WHEN id = ${args.toStaffId} THEN 'representative'
            WHEN id = ${args.fromStaffId} THEN 'editor'
            ELSE role
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
