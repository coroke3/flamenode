import { Hono } from "hono";
import type { ManageNavigationResponse } from "@flamenode/contracts";
import type { AppEnv } from "../../env.ts";
import { accessOf, loadManageSnapshot, manageGate } from "./access.ts";
import { loadManageData } from "./events.ts";

// CURRENT: app/(manage)/layout.tsx (gate) + src/lib/manage/navigationEvents.ts (ConsoleSidebar events, pending counts).
// D1 (S2, <= 3 statements incl. the session lookup): staff snapshot (admins skip it), then one events statement.
export const manageNavigationRoutes = new Hono<AppEnv>().get("/", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  const db = c.env.DB;
  const snapshot = await loadManageSnapshot(db, user);
  const denied = manageGate(c, snapshot);
  if (denied) return denied;
  const data = await loadManageData(db, user, snapshot, {});
  const body: ManageNavigationResponse = {
    access: accessOf(snapshot),
    events: data.events.map((row) => {
      const { created_at: _createdAt, ...event } = row;
      return event;
    }),
    truncated: data.truncated || snapshot.rowsTruncated,
  };
  return c.json(body);
});
