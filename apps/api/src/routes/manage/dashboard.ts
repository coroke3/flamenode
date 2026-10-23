import { Hono } from "hono";
import type { ManageDashboardResponse } from "@flamenode/contracts";
import type { AppEnv } from "../../env.ts";
import { resolveActiveXUserId } from "../personal/context.ts";
import { accessOf, loadManageSnapshot, manageGate } from "./access.ts";
import { compareEventsByUpcomingPriority, isAcceptingEntries } from "./eventOrder.ts";
import { loadManageData, type ManageData } from "./events.ts";

// CURRENT: app/(manage)/manage/page.tsx (ManageTopPage).
// D1 (S2, 3 statements incl. the session lookup): staff snapshot (admins skip it), then one JSON-sections statement.
// CURRENT reads notification_outbox in a try/catch ("event_id migration not applied") and degrades to
// an empty list + warning; the same happens here with one extra statement on that failure path only.
export const manageDashboardRoutes = new Hono<AppEnv>().get("/", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  const db = c.env.DB;
  const snapshot = await loadManageSnapshot(db, user);
  const denied = manageGate(c, snapshot);
  if (denied) return denied;

  let data: ManageData;
  let notificationSchemaMissing = false;
  try {
    data = await loadManageData(db, user, snapshot, { inbox: true, notifications: true, linked: true });
  } catch {
    console.warn("[manage] notification_outbox.event_id unavailable");
    notificationSchemaMissing = true;
    data = await loadManageData(db, user, snapshot, { inbox: true, linked: true });
  }

  const isAdmin = snapshot.isAdmin;
  const events = [...data.events].sort(compareEventsByUpcomingPriority).map((row) => {
    const { created_at: _createdAt, ...event } = row;
    return { ...event, staff_role: isAdmin ? null : (snapshot.roleByEvent.get(row.id) ?? null) };
  });
  const body: ManageDashboardResponse = {
    access: accessOf(snapshot),
    activeXUserId: isAdmin ? null : resolveActiveXUserId(user.active_x_user_id, data.linked),
    manageStaffXUserIds: isAdmin ? [] : snapshot.manageStaffXUserIds,
    events,
    eventsTruncated: data.truncated || snapshot.rowsTruncated,
    pendingReviewTotal: events.reduce((total, event) => total + event.pending_review_count, 0),
    acceptingEventCount: events.filter((event) => isAcceptingEntries(event)).length,
    failedNotificationCount: data.notifications.filter((n) => n.status === "failed").length,
    notificationSchemaMissing,
    notifications: data.notifications,
    inbox: data.inbox,
  };
  return c.json(body);
});
