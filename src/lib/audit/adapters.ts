import type { BatchItem } from "drizzle-orm/batch";
import {
  and,
  asc,
  eq,
  sql,
  type SQL,
} from "drizzle-orm";
import type { DB } from "@/lib/db/client";
import {
  announcements,
  eventGroups,
  eventStaff,
  events,
  slots,
  videoMembers,
  videos,
  xAccountLinkRequests,
} from "@/lib/db/schema";
import { isEventOwner } from "@/lib/event/eventOwnershipCore";
import type { RestoreAdapter, RestoreStrategy } from "./types";
import { expectedRowCondition as buildExpectedRowCondition } from "./expectedRowCondition";
import {
  buildVideoMemberBulkInsertSql,
  buildVideoMemberSetGuardSql,
  buildVideoMemberSetSnapshot,
  parseVideoMemberSetSnapshot,
} from "@/lib/video/memberSetSnapshot";

export function expectedRowCondition(options: {
  forceOverwrite?: boolean;
  expectedCurrent?: Record<string, unknown> | null;
}): SQL {
  return buildExpectedRowCondition(options);
}

function unsupported(table: string, strategy: RestoreStrategy): never {
  throw new Error(`Unsupported ${table} restore strategy: ${strategy}`);
}

/**
 * restore の事前 read と確定 write の間に競合が起きても、非 force 操作は
 * mutation を成立させない。版列を持たない表は明示的な force 以外 fail-closed にする。
 */
/**
 * The preflight read and the restore write must observe the same row.  A
 * timestamp is useful as an index-friendly fast path, but it is not a proof
 * of freshness: callers can update a row without changing that timestamp.
 * Compare every scalar returned by the preflight read in the mutation WHERE
 * clause so a stale restore becomes a zero-change, fail-closed batch.
 */
const eventsAdapter: RestoreAdapter = {
  supportedStrategies: ["update_before"],
  async fetchCurrent(db, targetId) {
    const row = await db.select().from(events).where(eq(events.id, targetId)).get();
    return row ? (row as unknown as Record<string, unknown>) : null;
  },
  buildRestoreMutation(db, snapshot, strategy, options) {
    if (strategy !== "update_before") return unsupported("events", strategy);
    const { id, created_at, ...set } = snapshot;
    return {
      query: db.update(events).set(set as Partial<typeof events.$inferInsert>).where(and(
        eq(events.id, id as string),
        expectedRowCondition(options),
      )!),
      expectedChanges: 1,
    };
  },
};

const videosAdapter: RestoreAdapter = {
  supportedStrategies: ["update_before"],
  async fetchCurrent(db, targetId) {
    const row = await db.select().from(videos).where(eq(videos.id, targetId)).get();
    return row ? (row as unknown as Record<string, unknown>) : null;
  },
  buildRestoreMutation(db, snapshot, strategy, options) {
    if (strategy !== "update_before") return unsupported("videos", strategy);
    const { id, created_at, ...set } = snapshot;
    return {
      query: db.update(videos).set(set as Partial<typeof videos.$inferInsert>).where(and(
        eq(videos.id, id as string),
        expectedRowCondition(options),
      )!),
      expectedChanges: 1,
    };
  },
};

const slotsAdapter: RestoreAdapter = {
  supportedStrategies: ["update_before", "recreate_deleted"],
  async fetchCurrent(db, targetId) {
    const row = await db.select().from(slots).where(eq(slots.id, targetId)).get();
    return row ? (row as unknown as Record<string, unknown>) : null;
  },
  buildRestoreMutation(db, snapshot, strategy, options) {
    if (strategy === "update_before") {
      const { id, ...set } = snapshot;
      return {
        query: db.update(slots).set(set as Partial<typeof slots.$inferInsert>).where(and(
          eq(slots.id, id as string),
          expectedRowCondition(options),
        )!),
        expectedChanges: 1,
      };
    }
    if (strategy === "recreate_deleted") {
      return {
        query: db.insert(slots).values(snapshot as typeof slots.$inferInsert),
        expectedChanges: 1,
      };
    }
    return unsupported("slots", strategy);
  },
};

const announcementsAdapter: RestoreAdapter = {
  supportedStrategies: ["update_before", "recreate_deleted"],
  async fetchCurrent(db, targetId) {
    const row = await db.select().from(announcements).where(eq(announcements.id, targetId)).get();
    return row ? (row as unknown as Record<string, unknown>) : null;
  },
  buildRestoreMutation(db, snapshot, strategy, options) {
    if (strategy === "update_before") {
      const { id, created_at, ...set } = snapshot;
      return {
        query: db.update(announcements).set(set as Partial<typeof announcements.$inferInsert>).where(and(
          eq(announcements.id, id as string),
          expectedRowCondition(options),
        )!),
        expectedChanges: 1,
      };
    }
    if (strategy === "recreate_deleted") {
      return {
        query: db.insert(announcements).values(snapshot as typeof announcements.$inferInsert),
        expectedChanges: 1,
      };
    }
    return unsupported("announcements", strategy);
  },
};

const eventGroupsAdapter: RestoreAdapter = {
  supportedStrategies: ["update_before", "recreate_deleted"],
  async fetchCurrent(db, targetId) {
    const row = await db.select().from(eventGroups).where(eq(eventGroups.id, targetId)).get();
    return row ? (row as unknown as Record<string, unknown>) : null;
  },
  buildRestoreMutation(db, snapshot, strategy, options) {
    if (strategy === "update_before") {
      const { id, created_at, ...set } = snapshot;
      return {
        query: db.update(eventGroups).set(set as Partial<typeof eventGroups.$inferInsert>).where(and(
          eq(eventGroups.id, id as string),
          expectedRowCondition(options),
        )!),
        expectedChanges: 1,
      };
    }
    if (strategy === "recreate_deleted") {
      return {
        query: db.insert(eventGroups).values(snapshot as typeof eventGroups.$inferInsert),
        expectedChanges: 1,
      };
    }
    return unsupported("event_groups", strategy);
  },
};

const xAccountLinkRequestsAdapter: RestoreAdapter = {
  supportedStrategies: ["update_before", "recreate_deleted"],
  async fetchCurrent(db, targetId) {
    const row = await db.select().from(xAccountLinkRequests).where(eq(xAccountLinkRequests.id, targetId)).get();
    return row ? (row as unknown as Record<string, unknown>) : null;
  },
  buildRestoreMutation(db, snapshot, strategy, options) {
    if (strategy === "update_before") {
      const { id, ...set } = snapshot;
      return {
        query: db.update(xAccountLinkRequests).set(set as Partial<typeof xAccountLinkRequests.$inferInsert>).where(and(
          eq(xAccountLinkRequests.id, id as string),
          expectedRowCondition(options),
        )!),
        expectedChanges: 1,
      };
    }
    if (strategy === "recreate_deleted") {
      return {
        query: db.insert(xAccountLinkRequests).values(snapshot as typeof xAccountLinkRequests.$inferInsert),
        expectedChanges: 1,
      };
    }
    return unsupported("x_account_link_requests", strategy);
  },
};

const eventStaffAdapter: RestoreAdapter = {
  supportedStrategies: ["delete_created", "update_before", "recreate_deleted"],
  async fetchCurrent(db, targetId) {
    const row = await db.select().from(eventStaff).where(eq(eventStaff.id, targetId)).get();
    return row ? (row as unknown as Record<string, unknown>) : null;
  },
  buildRestoreMutation(db, snapshot, strategy, options) {
    const id = snapshot.id as string;
    const eventId = snapshot.event_id as string;
    const expectedPreset = options.expectedCurrent?.permission_preset;
    const hasExpectedPreset = typeof expectedPreset === "string";
    const currentIsOwner = hasExpectedPreset && isEventOwner({
      permission_preset: expectedPreset,
    });
    const ownerMutationGuard = (nextPreset: string | null): SQL => sql`
      ${hasExpectedPreset ? 1 : 0} = 1 AND (
        ${currentIsOwner ? 0 : 1} = 1
        OR ${nextPreset} = 'owner'
        OR (
          SELECT COUNT(*) FROM event_staff
          WHERE event_id = ${eventId} AND permission_preset = 'owner'
        ) > 1
      )
    `;
    if (strategy === "delete_created") {
      return {
        query: db.delete(eventStaff).where(and(
          eq(eventStaff.id, id),
          eq(eventStaff.event_id, eventId),
          ownerMutationGuard(null),
          expectedRowCondition(options),
        )!),
        expectedChanges: 1,
      };
    }
    if (strategy === "update_before") {
      const { id: _id, created_at, ...set } = snapshot;
      const nextPreset = snapshot.permission_preset as string;
      return {
        query: db.update(eventStaff).set(set as Partial<typeof eventStaff.$inferInsert>).where(and(
          eq(eventStaff.id, id),
          eq(eventStaff.event_id, eventId),
          ownerMutationGuard(nextPreset),
          expectedRowCondition(options),
        )!),
        expectedChanges: 1,
      };
    }
    if (strategy === "recreate_deleted") {
      return {
        query: db.insert(eventStaff).values(snapshot as typeof eventStaff.$inferInsert),
        expectedChanges: 1,
      };
    }
    return unsupported("event_staff", strategy);
  },
};

const videoMembersSetAdapter: RestoreAdapter = {
  supportedStrategies: ["custom_adapter"],

  async fetchCurrent(db, targetId) {
    const rows = await db
      .select()
      .from(videoMembers)
      .where(
        and(
          eq(videoMembers.video_id, targetId),
          eq(videoMembers.is_public_member, 1),
        )!,
      )
      .orderBy(
        asc(videoMembers.order_index),
        asc(videoMembers.id),
      );

    return buildVideoMemberSetSnapshot(
      targetId,
      rows,
    ) as unknown as Record<string, unknown>;
  },

  buildRestoreMutation(
    db,
    snapshot,
    strategy,
    options,
  ) {
    if (strategy !== "custom_adapter") {
      return unsupported(
        "video_members_set",
        strategy,
      );
    }

    const target =
      parseVideoMemberSetSnapshot(snapshot);
    const expected =
      parseVideoMemberSetSnapshot(
        options.expectedCurrent,
      );

    if (!target || !expected) {
      throw new Error(
        "video_members_set_snapshot_invalid",
      );
    }

    if (target.id !== expected.id) {
      throw new Error(
        "video_members_set_target_mismatch",
      );
    }

    const statements: BatchItem<"sqlite">[] = [
      db.run(
        buildVideoMemberSetGuardSql(
          target.id,
          expected.rows,
        ),
      ),
    ];
    const expectedMutationChanges: Array<
      number | null
    > = [null];

    if (expected.rows.length > 0) {
      statements.push(
        db
          .delete(videoMembers)
          .where(
            and(
              eq(videoMembers.video_id, target.id),
              eq(videoMembers.is_public_member, 1),
            )!,
          ),
      );
      expectedMutationChanges.push(
        expected.rows.length,
      );
    }

    if (target.rows.length > 0) {
      statements.push(
        db.run(
          buildVideoMemberBulkInsertSql(
            target.rows,
          ),
        ),
      );
      expectedMutationChanges.push(
        target.rows.length,
      );
    }

    return {
      statements,
      expectedMutationChanges,
    };
  },
};

export const RESTORE_ADAPTERS = {
  events: eventsAdapter,
  videos: videosAdapter,
  slots: slotsAdapter,
  announcements: announcementsAdapter,
  event_groups: eventGroupsAdapter,
  event_staff: eventStaffAdapter,
  x_account_link_requests: xAccountLinkRequestsAdapter,
  video_members_set: videoMembersSetAdapter,
} as const satisfies Record<string, RestoreAdapter>;

export type RegisteredRestoreTableName = keyof typeof RESTORE_ADAPTERS;

export function getAdapter(
  tableName: string,
): RestoreAdapter | null {
  return Object.prototype.hasOwnProperty.call(
    RESTORE_ADAPTERS,
    tableName,
  )
    ? RESTORE_ADAPTERS[
        tableName as RegisteredRestoreTableName
      ]
    : null;
}
