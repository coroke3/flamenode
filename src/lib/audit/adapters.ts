import { eq } from "drizzle-orm";
import type { DB } from "@/lib/db/client";
import {
  events,
  videos,
  slots,
  announcements,
  eventGroups,
  xAccountLinkRequests,
} from "@/lib/db/schema";
import type { RestoreAdapter, RestoreStrategy } from "./types";

// ============================================================
// リストア可能テーブルホワイトリスト
// ============================================================

export const RESTORABLE_TABLES = new Set([
  "events",
  "videos",
  "slots",
  "announcements",
  "event_groups",
  "x_account_link_requests",
]);

// ============================================================
// events アダプター
// ============================================================

const eventsAdapter: RestoreAdapter = {
  async fetchCurrent(db: DB, targetId: string) {
    const row = await db
      .select()
      .from(events)
      .where(eq(events.id, targetId))
      .get();
    return row ? (row as unknown as Record<string, unknown>) : null;
  },

  async applyRestore(
    db: DB,
    before: Record<string, unknown>,
    strategy: RestoreStrategy,
    _options,
  ) {
    if (strategy === "delete_created") {
      await db
        .update(events)
        .set({
          visibility_status: "archived",
          updated_at: Math.floor(Date.now() / 1000),
        })
        .where(eq(events.id, before.id as string));
      return;
    }

    if (strategy === "recreate_deleted") {
      // events は物理削除しないので visibility_status=archived に戻す
      await db
        .update(events)
        .set({
          visibility_status: (before.visibility_status as "draft" | "private" | "public" | "archived") ?? "draft",
          updated_at: Math.floor(Date.now() / 1000),
        })
        .where(eq(events.id, before.id as string));
      return;
    }

    if (strategy === "update_before") {
      const { id, created_at, ...updateFields } = before;
      await db
        .update(events)
        .set({
          ...(updateFields as Partial<typeof events.$inferInsert>),
          updated_at: Math.floor(Date.now() / 1000),
        })
        .where(eq(events.id, id as string));
      return;
    }
  },
};

// ============================================================
// videos アダプター
// ============================================================

const videosAdapter: RestoreAdapter = {
  async fetchCurrent(db: DB, targetId: string) {
    const row = await db
      .select()
      .from(videos)
      .where(eq(videos.id, targetId))
      .get();
    return row ? (row as unknown as Record<string, unknown>) : null;
  },

  async applyRestore(
    db: DB,
    before: Record<string, unknown>,
    strategy: RestoreStrategy,
    _options,
  ) {
    if (strategy === "delete_created") {
      await db
        .update(videos)
        .set({
          visibility_status: "archived",
          updated_at: Math.floor(Date.now() / 1000),
        })
        .where(eq(videos.id, before.id as string));
      return;
    }

    if (strategy === "recreate_deleted") {
      // videos は物理削除しないので visibility_status を before の値に戻す
      await db
        .update(videos)
        .set({
          visibility_status: (before.visibility_status as "draft" | "pending" | "public" | "limited" | "private" | "hidden" | "archived" | "voided") ?? "archived",
          updated_at: Math.floor(Date.now() / 1000),
        })
        .where(eq(videos.id, before.id as string));
      return;
    }

    if (strategy === "update_before") {
      const { id, created_at, ...updateFields } = before;
      await db
        .update(videos)
        .set({
          ...(updateFields as Partial<typeof videos.$inferInsert>),
          updated_at: Math.floor(Date.now() / 1000),
        })
        .where(eq(videos.id, id as string));
      return;
    }
  },
};

// ============================================================
// slots アダプター
// ============================================================

const slotsAdapter: RestoreAdapter = {
  async fetchCurrent(db: DB, targetId: string) {
    const row = await db
      .select()
      .from(slots)
      .where(eq(slots.id, targetId))
      .get();
    return row ? (row as unknown as Record<string, unknown>) : null;
  },

  async applyRestore(
    db: DB,
    before: Record<string, unknown>,
    strategy: RestoreStrategy,
    _options,
  ) {
    if (strategy === "update_before") {
      const { id, ...updateFields } = before;
      await db
        .update(slots)
        .set({
          ...(updateFields as Partial<typeof slots.$inferInsert>),
          updated_at: Math.floor(Date.now() / 1000),
        })
        .where(eq(slots.id, id as string));
      return;
    }

    if (strategy === "recreate_deleted") {
      // slots は物理削除される場合があるので INSERT を試みる
      await db
        .insert(slots)
        .values(before as typeof slots.$inferInsert)
        .onConflictDoUpdate({
          target: slots.id,
          set: before as Partial<typeof slots.$inferInsert>,
        });
      return;
    }
  },
};

// ============================================================
// announcements アダプター
// ============================================================

const announcementsAdapter: RestoreAdapter = {
  async fetchCurrent(db: DB, targetId: string) {
    const row = await db
      .select()
      .from(announcements)
      .where(eq(announcements.id, targetId))
      .get();
    return row ? (row as unknown as Record<string, unknown>) : null;
  },

  async applyRestore(
    db: DB,
    before: Record<string, unknown>,
    strategy: RestoreStrategy,
    _options,
  ) {
    if (strategy === "update_before") {
      const { id, created_at, ...updateFields } = before;
      await db
        .update(announcements)
        .set({
          ...(updateFields as Partial<typeof announcements.$inferInsert>),
          updated_at: Math.floor(Date.now() / 1000),
        })
        .where(eq(announcements.id, id as string));
      return;
    }

    if (strategy === "recreate_deleted") {
      await db
        .insert(announcements)
        .values(before as typeof announcements.$inferInsert)
        .onConflictDoUpdate({
          target: announcements.id,
          set: before as Partial<typeof announcements.$inferInsert>,
        });
      return;
    }
  },
};

// ============================================================
// event_groups アダプター
// ============================================================

const eventGroupsAdapter: RestoreAdapter = {
  async fetchCurrent(db: DB, targetId: string) {
    const row = await db
      .select()
      .from(eventGroups)
      .where(eq(eventGroups.id, targetId))
      .get();
    return row ? (row as unknown as Record<string, unknown>) : null;
  },

  async applyRestore(
    db: DB,
    before: Record<string, unknown>,
    strategy: RestoreStrategy,
    _options,
  ) {
    if (strategy === "update_before") {
      const { id, created_at, ...updateFields } = before;
      await db
        .update(eventGroups)
        .set({
          ...(updateFields as Partial<typeof eventGroups.$inferInsert>),
          updated_at: Math.floor(Date.now() / 1000),
        })
        .where(eq(eventGroups.id, id as string));
      return;
    }

    if (strategy === "recreate_deleted") {
      await db
        .insert(eventGroups)
        .values(before as typeof eventGroups.$inferInsert)
        .onConflictDoUpdate({
          target: eventGroups.id,
          set: before as Partial<typeof eventGroups.$inferInsert>,
        });
      return;
    }
  },
};

// ============================================================
// x_account_link_requests アダプター
// ============================================================

const xAccountLinkRequestsAdapter: RestoreAdapter = {
  async fetchCurrent(db: DB, targetId: string) {
    const row = await db
      .select()
      .from(xAccountLinkRequests)
      .where(eq(xAccountLinkRequests.id, targetId))
      .get();
    return row ? (row as unknown as Record<string, unknown>) : null;
  },

  async applyRestore(
    db: DB,
    before: Record<string, unknown>,
    strategy: RestoreStrategy,
    _options,
  ) {
    if (strategy === "update_before") {
      const { id, ...updateFields } = before;
      await db
        .update(xAccountLinkRequests)
        .set(updateFields as Partial<typeof xAccountLinkRequests.$inferInsert>)
        .where(eq(xAccountLinkRequests.id, id as string));
      return;
    }

    if (strategy === "recreate_deleted") {
      await db
        .insert(xAccountLinkRequests)
        .values(before as typeof xAccountLinkRequests.$inferInsert)
        .onConflictDoUpdate({
          target: xAccountLinkRequests.id,
          set: before as Partial<typeof xAccountLinkRequests.$inferInsert>,
        });
      return;
    }
  },
};

// ============================================================
// アダプター取得
// ============================================================

const ADAPTERS: Record<string, RestoreAdapter> = {
  events: eventsAdapter,
  videos: videosAdapter,
  slots: slotsAdapter,
  announcements: announcementsAdapter,
  event_groups: eventGroupsAdapter,
  x_account_link_requests: xAccountLinkRequestsAdapter,
};

/**
 * テーブル名に対応するリストアアダプターを返す。
 * ホワイトリスト外は null。
 */
export function getAdapter(tableName: string): RestoreAdapter | null {
  return ADAPTERS[tableName] ?? null;
}
