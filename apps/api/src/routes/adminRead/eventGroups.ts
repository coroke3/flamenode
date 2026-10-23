import { Hono } from "hono";
import type {
  AdminEventGroupDetailResponse,
  AdminEventGroupMember,
  AdminEventGroupRow,
  AdminEventGroupsResponse,
} from "@flamenode/contracts";
import type { AppEnv } from "../../env.ts";
import { parseJsonColumn } from "../personal/context.ts";

// CURRENT: app/(admin)/admin/event-groups/page.tsx and event-groups/[id]/edit/page.tsx (+ src/lib/admin/eventGroupEventOptions.ts).
// `event-groups/new` renders a static form (no reads), so it needs no endpoint.
// D1: list 1 (+session); detail 2 (+session): group row + members as a bounded JSON column, then the option page.
// No try/catch in CURRENT -> D1 failure is 503. Unknown id -> 404.
// DIVERGENCE: members were unbounded in CURRENT; capped at ADMIN_EVENT_GROUP_MEMBERS_LIMIT.
export const ADMIN_EVENT_GROUPS_LIMIT = 100;
export const ADMIN_EVENT_GROUP_MEMBERS_LIMIT = 100;
export const EVENT_GROUP_EVENT_PAGE_SIZE = 80;
const GROUP_TYPE_LABELS: Record<string, true> = { series: true, genre: true, related: true, collection: true, other: true };

export const adminEventGroupsRoutes = new Hono<AppEnv>()
  .get("/", async (c) => {
    const visibilityParam = c.req.query("visibility");
    const visibility =
      visibilityParam === "public" || visibilityParam === "private" || visibilityParam === "archived" ? visibilityParam : "any";
    const typeParam = c.req.query("type");
    // CURRENT: `sp.type in GROUP_TYPE_LABELS` (prototype keys pass and then match no row)
    const type = typeParam && typeParam in GROUP_TYPE_LABELS ? typeParam : "any";
    const conds: string[] = [];
    const params: unknown[] = [];
    if (visibility !== "any") {
      conds.push("g.visibility_status = ?");
      params.push(visibility);
    }
    if (type !== "any") {
      conds.push("g.group_type = ?");
      params.push(type);
    }
    const { results } = await c.env.DB.prepare(
      `SELECT g.id AS id, g.name AS name, g.slug AS slug, g.group_type AS group_type,
         g.visibility_status AS visibility_status, g.sort_order AS sort_order, count(m.event_id) AS event_count
       FROM event_groups g LEFT JOIN event_group_events m ON m.event_group_id = g.id
       ${conds.length > 0 ? `WHERE ${conds.join(" AND ")}` : ""}
       GROUP BY g.id ORDER BY g.sort_order ASC, g.name ASC LIMIT ?`,
    )
      .bind(...params, ADMIN_EVENT_GROUPS_LIMIT)
      .all<AdminEventGroupRow>();
    const body: AdminEventGroupsResponse = { visibility, type, groups: results.map((r) => ({ ...r, event_count: Number(r.event_count) })) };
    return c.json(body);
  })
  .get("/:id", async (c) => {
    const id = c.req.param("id");
    const db = c.env.DB;
    const row = await db
      .prepare(
        `SELECT g.id AS id, g.name AS name, g.slug AS slug, g.description AS description, g.group_type AS group_type,
           g.icon_url AS icon_url, g.accent_color AS accent_color, g.visibility_status AS visibility_status,
           g.sort_order AS sort_order, g.updated_at AS updated_at,
           (SELECT json_group_array(json_object('event_id', q.event_id, 'title', q.title, 'start_time', q.start_time)) FROM (
              SELECT m.event_id AS event_id, e.title AS title, e.start_time AS start_time
              FROM event_group_events m INNER JOIN events e ON e.id = m.event_id
              WHERE m.event_group_id = g.id ORDER BY e.start_time DESC, e.id ASC LIMIT ?) q) AS members
         FROM event_groups g WHERE g.id = ? LIMIT 1`,
      )
      .bind(ADMIN_EVENT_GROUP_MEMBERS_LIMIT, id)
      .first<AdminEventGroupDetailResponse["group"] & { members: string | null }>();
    if (!row) return c.json({ error: "Not Found" }, 404);
    const { members, ...group } = row;
    const options = await db
      .prepare(
        `SELECT id, title, start_time, updated_at FROM events
         WHERE NOT EXISTS (SELECT 1 FROM event_group_events m WHERE m.event_group_id = ? AND m.event_id = events.id)
         ORDER BY updated_at DESC, id ASC LIMIT ?`,
      )
      .bind(id.trim(), EVENT_GROUP_EVENT_PAGE_SIZE + 1)
      .all<{ id: string; title: string; start_time: number | null; updated_at: number }>();
    const page = options.results.slice(0, EVENT_GROUP_EVENT_PAGE_SIZE);
    const last = page.at(-1);
    const body: AdminEventGroupDetailResponse = {
      group,
      members: parseJsonColumn<AdminEventGroupMember[]>(members, []),
      eventOptions: page.map(({ id: eventId, title, start_time }) => ({ id: eventId, title, start_time })),
      nextCursor: options.results.length > EVENT_GROUP_EVENT_PAGE_SIZE && last ? JSON.stringify({ updatedAt: last.updated_at, id: last.id }) : null,
    };
    return c.json(body);
  });
