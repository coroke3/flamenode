import { Hono } from "hono";
import type { ManageNotificationCenterResponse } from "@flamenode/contracts";
import { TERMINAL_NOTIFICATION_FAILURE_STATUSES, isTerminalNotificationFailure } from "@flamenode/domain/admin";
import type { AppEnv } from "../../env.ts";
import { resolveActiveXUserId } from "../personal/context.ts";
import { loadManageSnapshot, manageGate } from "./access.ts";
import { loadManageData, type ManageData } from "./events.ts";
import {
  notificationRowsPiece,
  notifFilterCondition,
  parseNotifFilter,
  toNotification,
  type RawNotificationRow,
} from "./notifications.ts";

// CURRENT: app/(manage)/manage/notifications/page.tsx.
// Authorization (CURRENT): ?event= must be admin or one of the caller's manageable events (else notFound -> 404);
// without it the scope is every accessible event (admin: all events).
// D1 (S2, <= 3 statements incl. the session lookup): staff snapshot (admins skip it), then one statement with the
// sidebar events, the linked X rows and the notification rows. CURRENT's try/catch around the rows read
// (missing event_id column) degrades to schemaMissing with one extra statement on that failure path only.
const MAX_CENTER_ROWS = 50;
const PENDING_LIKE_STATUSES = ["pending", "processing", "sent", "cancelled"];

export const manageNotificationCenterRoutes = new Hono<AppEnv>().get("/", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  const eventFilter = (c.req.query("event") ?? "").trim();
  const notifFilter = parseNotifFilter(c.req.query("notif"));
  const statusFilter = (c.req.query("status") ?? "").trim();
  const db = c.env.DB;

  const snapshot = await loadManageSnapshot(db, user);
  const denied = manageGate(c, snapshot);
  if (denied) return denied;
  if (eventFilter && !snapshot.isAdmin && !snapshot.manageableEventIds.includes(eventFilter)) {
    return c.json({ error: "Not Found" }, 404);
  }

  const conditions: string[] = [];
  const params: unknown[] = [];
  if (eventFilter) {
    conditions.push("n.event_id = ?");
    params.push(eventFilter);
  } else if (snapshot.isAdmin) {
    conditions.push("n.event_id IN (SELECT id FROM events)");
  } else {
    conditions.push("n.event_id IN (SELECT CAST(value AS TEXT) FROM json_each(?))");
    params.push(JSON.stringify(snapshot.manageableEventIds));
  }
  const typeCondition = notifFilterCondition(notifFilter, "n.type");
  if (typeCondition) conditions.push(typeCondition);
  if (statusFilter === "failed") {
    conditions.push(`n.status IN (${TERMINAL_NOTIFICATION_FAILURE_STATUSES.map(() => "?").join(", ")})`);
    params.push(...TERMINAL_NOTIFICATION_FAILURE_STATUSES);
  } else if (PENDING_LIKE_STATUSES.includes(statusFilter)) {
    conditions.push("n.status = ?");
    params.push(statusFilter);
  }

  let data: ManageData;
  let schemaMissing = false;
  try {
    data = await loadManageData(db, user, snapshot, {
      linked: true,
      extra: { center: notificationRowsPiece(conditions.join(" AND "), params, MAX_CENTER_ROWS) },
    });
  } catch {
    schemaMissing = true;
    data = await loadManageData(db, user, snapshot, { linked: true });
  }

  const rows = ((data.extra.center as RawNotificationRow[] | null | undefined) ?? []).map(toNotification);
  const body: ManageNotificationCenterResponse = {
    isAdmin: snapshot.isAdmin,
    activeXUserId: resolveActiveXUserId(user.active_x_user_id, data.linked),
    manageStaffXUserIds: snapshot.manageStaffXUserIds,
    eventFilter,
    notifFilter,
    statusFilter,
    managedEvents: snapshot.isAdmin ? [] : data.events.map(({ id, title }) => ({ id, title })),
    eventTitles: Object.fromEntries(data.events.map((event) => [event.id, event.title])),
    schemaMissing,
    failedCount: rows.filter((row) => isTerminalNotificationFailure(row.status)).length,
    notifications: rows,
  };
  return c.json(body);
});
