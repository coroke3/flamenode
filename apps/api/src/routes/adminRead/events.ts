import { Hono } from "hono";
import type {
  AdminEventFilter,
  AdminEventRow,
  AdminEventSort,
  AdminEventsResponse,
} from "@flamenode/contracts";
import type { AppEnv } from "../../env.ts";
import { ADMIN_EVENTS_LIMIT } from "./shared.ts";

// CURRENT: app/(admin)/admin/events/page.tsx loadEvents (no try/catch -> D1 failure is 503).
// D1: 1 statement (+ the session lookup). Only the columns the page renders are returned.
// CURRENT acceptingEntriesWhere (src/lib/utils/eventStatus.ts) as SQL.
const ACCEPTING_SQL = `visibility_status = 'public'
  AND (entry_start_time IS NOT NULL OR entry_end_time IS NOT NULL)
  AND (entry_start_time IS NULL OR entry_start_time <= ?)
  AND (entry_end_time IS NULL OR entry_end_time > ?)
  AND (start_time IS NULL OR end_time IS NULL OR end_time > ?)`;

export const adminEventsRoutes = new Hono<AppEnv>().get("/", async (c) => {
  const sortParam = c.req.query("sort");
  const sort: AdminEventSort = sortParam === "oldest" || sortParam === "upcoming" ? sortParam : "newest";
  const filterParam = c.req.query("filter");
  const filter: AdminEventFilter =
    filterParam === "public" || filterParam === "private" || filterParam === "accepting" ? filterParam : "all";
  const q = (c.req.query("q") ?? "").trim();
  const now = Math.floor(Date.now() / 1000);

  const conds: string[] = [];
  const params: unknown[] = [];
  if (filter === "public" || filter === "private") {
    conds.push("visibility_status = ?");
    params.push(filter);
  }
  if (q) {
    // CURRENT passes the raw term to LIKE (no escapeLike): `%`/`_` in q are wildcards.
    conds.push("(title LIKE ? OR id LIKE ?)");
    params.push(`%${q}%`, `%${q}%`);
  }
  if (filter === "accepting") {
    conds.push(`(${ACCEPTING_SQL})`);
    params.push(now, now, now);
  }
  const where = conds.length > 0 ? `WHERE ${conds.join(" AND ")}` : "";
  const order = sort === "oldest" || sort === "upcoming" ? "ASC" : "DESC";
  const { results } = await c.env.DB.prepare(
    `SELECT id, title, visibility_status, start_time, end_time, entry_start_time, entry_end_time
     FROM events ${where} ORDER BY start_time ${order} LIMIT ?`,
  )
    .bind(...params, ADMIN_EVENTS_LIMIT)
    .all<AdminEventRow>();

  const body: AdminEventsResponse = { sort, filter, q, now, events: results };
  return c.json(body);
});
