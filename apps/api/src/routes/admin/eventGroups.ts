/**
 * MIG-0653 U02: SA-025 event-group membership candidate search.
 *
 * Intentionally unmounted until the admin router's existing owner PRs release
 * apps/api/src/routes/admin/index.ts. The caller supplies the existing session
 * middleware; this module also enforces admin-only access on every read.
 *
 * CURRENT: src/lib/admin/eventGroupEventOptions.ts. Keep its 80-row cursor,
 * NOT EXISTS membership filter, escaped LIKE and updated_at/id ordering.
 */
import { Hono } from "hono";
import type { AppEnv } from "../../env.ts";
import { adminReadGuardMiddleware } from "../../middleware/adminReadGuard.ts";

export const EVENT_GROUP_OPTION_PAGE_SIZE = 80;
const SEARCH_FAILED = "イベント候補の取得に失敗しました。もう一度お試しください。";

export type EventGroupOption = {
  id: string;
  title: string;
  start_time: number | null;
};
type OptionRow = EventGroupOption & { updated_at: number };
type Cursor = { updatedAt: number; id: string };

export function parseEventGroupOptionCursor(raw: string | null): Cursor | null {
  if (!raw) return null;
  if (raw.length > 200) throw new Error("event_group_cursor_invalid");
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error("event_group_cursor_invalid");
  }
  if (
    !value ||
    typeof value !== "object" ||
    typeof (value as Cursor).updatedAt !== "number" ||
    !Number.isSafeInteger((value as Cursor).updatedAt) ||
    typeof (value as Cursor).id !== "string" ||
    !(value as Cursor).id
  ) {
    throw new Error("event_group_cursor_invalid");
  }
  return value as Cursor;
}

export function escapeEventGroupLikeTerm(input: string): string {
  return input.replace(/[\\%_]/g, "\\$&");
}

export const adminEventGroupOptionsRoutes = new Hono<AppEnv>();

adminEventGroupOptionsRoutes.use("*", async (c, next) => {
  c.header("Cache-Control", "private, no-store");
  return adminReadGuardMiddleware()(c, next);
});

adminEventGroupOptionsRoutes.get("/event-options", async (c) => {
  const groupId = (c.req.query("groupId") ?? "").trim();
  const query = (c.req.query("q") ?? "").trim();
  let cursor: Cursor | null;
  try {
    if (!groupId || query.length > 64) throw new Error("event_group_search_invalid");
    cursor = parseEventGroupOptionCursor(c.req.query("cursor") ?? null);
  } catch {
    return c.json({ ok: false, message: SEARCH_FAILED }, 400);
  }

  const conditions = [
    "NOT EXISTS (SELECT 1 FROM event_group_events m WHERE m.event_group_id = ? AND m.event_id = e.id)",
  ];
  const params: Array<string | number> = [groupId];
  if (query) {
    conditions.push("e.title LIKE ? ESCAPE '\\'");
    params.push("%" + escapeEventGroupLikeTerm(query) + "%");
  }
  if (cursor) {
    conditions.push("(e.updated_at < ? OR (e.updated_at = ? AND e.id > ?))");
    params.push(cursor.updatedAt, cursor.updatedAt, cursor.id);
  }
  const statement = [
    "SELECT e.id, e.title, e.start_time, e.updated_at FROM events e",
    "WHERE " + conditions.join(" AND "),
    "ORDER BY e.updated_at DESC, e.id ASC LIMIT ?",
  ].join(" ");
  try {
    const { results } = await c.env.DB.prepare(statement)
      .bind(...params, EVENT_GROUP_OPTION_PAGE_SIZE + 1)
      .all<OptionRow>();
    const page = results.slice(0, EVENT_GROUP_OPTION_PAGE_SIZE);
    const last = page.at(-1);
    return c.json({
      ok: true,
      options: page.map(({ id, title, start_time }) => ({ id, title, start_time })),
      nextCursor: results.length > EVENT_GROUP_OPTION_PAGE_SIZE && last
        ? JSON.stringify({ updatedAt: last.updated_at, id: last.id })
        : null,
    });
  } catch {
    // No bound values, SQL details or user information leave the API on D1 failure.
    return c.json({ ok: false, message: SEARCH_FAILED }, 503);
  }
});
