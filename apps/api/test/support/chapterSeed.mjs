// MIG-0603 U02b: real-schema world (all migrations) for the chapter write tests.
import { Hono } from "hono";
import { createVideosRoutes } from "../../src/routes/videos/index.ts";
import { insert } from "./personalHarness.mjs";

/**
 * D1Database look-alike over node:sqlite for WRITES: batch() is atomic
 * (BEGIN/ROLLBACK) like D1, and every statement / bind count is recorded.
 * `beforeRead(sql, sqlite)` runs after a read statement (race injection).
 */
export function atomicD1(sqlite, { beforeRead } = {}) {
  const stats = { reads: 0, batches: 0, batchStatements: 0, maxBinds: 0, readSql: [] };
  const run = (sql, params) => {
    stats.maxBinds = Math.max(stats.maxBinds, params.length);
    return sqlite.prepare(sql).all(...params).map((row) => ({ ...row }));
  };
  const statement = (sql, params) => ({
    __sql: sql,
    __params: params,
    bind: (...values) => statement(sql, values),
    async first() {
      stats.reads += 1;
      stats.readSql.push(sql);
      const row = run(sql, params)[0] ?? null;
      beforeRead?.(sql, sqlite);
      return row;
    },
    async all() {
      stats.reads += 1;
      stats.readSql.push(sql);
      const results = run(sql, params);
      beforeRead?.(sql, sqlite);
      return { results };
    },
    // drizzle-orm/d1 (the CURRENT code path in the parity test) also uses run() and raw().
    async run() {
      return { results: run(sql, params), success: true, meta: { changes: 0 } };
    },
    async raw() {
      stats.reads += 1;
      const prepared = sqlite.prepare(sql);
      prepared.setReturnArrays(true);
      try {
        return prepared.all(...params).map((row) => [...row]);
      } finally {
        prepared.setReturnArrays(false);
      }
    },
  });
  return {
    stats,
    prepare: (sql) => statement(sql, []),
    async batch(statements) {
      stats.batches += 1;
      stats.batchStatements += statements.length;
      sqlite.exec("BEGIN");
      try {
        const results = statements.map((s) => ({ results: run(s.__sql, s.__params) }));
        sqlite.exec("COMMIT");
        return results;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    },
  };
}

export const SITE = "https://app.flamenode.example";

const USERS = [
  // id, role, active X, approved X ids
  ["u_admin", "admin", "x_admin", ["x_admin"]],
  ["u_owner", "user", "x_owner", ["x_owner"]],
  ["u_staff", "user", "x_staff", ["x_staff"]],
  ["u_other", "user", "x_other", ["x_other"]],
  ["u_nox", "user", null, []],
  ["u_pend", "user", "x_pend", []],
  ["u_mod", "moderator", "x_mod", ["x_mod"]],
  ["u_multi", "user", "x_m1", ["x_m1", "x_staff"]],
];

export function seedChapterWorld(sqlite) {
  // The baseline migration already inserts the "default" system_settings row.
  sqlite.prepare("UPDATE system_settings SET operation_mode = 'normal' WHERE id = 'default'").run();
  for (const [id, role, active, approved] of USERS) {
    insert(sqlite, "user", {
      id, name: id, discord_id: `d_${id}`, role, is_banned: 0, is_tos_accepted: 1, active_x_user_id: active,
    });
    for (const x of new Set([...(active ? [active] : []), ...approved])) {
      if (!sqlite.prepare("SELECT 1 FROM x_users WHERE id = ?").get(x)) {
        insert(sqlite, "x_users", {
          id: x, x_name: `name_${x}`, approval_status: approved.includes(x) ? "approved" : "pending",
        });
      }
      if (approved.includes(x)) insert(sqlite, "x_user_account_links", { auth_user_id: id, x_user_id: x });
    }
  }
  // x_staff is also approved for u_multi but is the active X of u_staff.
  insert(sqlite, "events", { id: "ev1", title: "Event 1" });
  insert(sqlite, "events", { id: "ev2", title: "Event 2" });
  const video = (id, extra) =>
    insert(sqlite, "videos", {
      id, submitted_by_user_id: "u_owner", creator_display_name: "Creator", title: `T ${id}`,
      creator_x_user_id: "x_owner", visibility_status: "public", ...extra,
    });
  video("v_pub", { primary_event_id: "ev1" });
  video("v_priv", { visibility_status: "private", primary_event_id: "ev1" });
  video("v_two", { primary_event_id: null });
  video("v_dur", { primary_event_id: null });
  insert(sqlite, "video_events", { video_id: "v_two", event_id: "ev2" });
  insert(sqlite, "video_youtube_metadata", { video_id: "v_dur", updated_at: 1, duration_seconds: 120 });
  const chapter = (id, video_id, x_user_id, extra = {}) =>
    insert(sqlite, "video_chapters", {
      id, video_id, x_user_id, chapter_time: 10, chapter_label: `L ${id}`, note: `N ${id}`,
      visibility: "public", created_at: 100, updated_at: 100, ...extra,
    });
  chapter("ch_owner", "v_pub", "x_owner");
  chapter("ch_other", "v_pub", "x_other", { note: null });
  chapter("ch_null", "v_pub", null);
  chapter("ch_two", "v_two", "x_owner");
  insert(sqlite, "event_staff", { id: "s1", event_id: "ev1", x_user_id: "x_staff", display_name: "S1", permission_preset: "content_editor" });
  insert(sqlite, "event_staff", { id: "s2", event_id: "ev2", x_user_id: "x_other", display_name: "S2", permission_preset: "reviewer" });
  insert(sqlite, "event_staff", { id: "s3", event_id: "ev2", x_user_id: "x_mod", display_name: "S3", permission_preset: "manager" });
}

export const SESSION_USER = (id, role = "user", active = null) => ({
  id, name: id, email: null, image: null, role, is_banned: 0, active_x_user_id: active,
});

export const ROLES = { u_admin: "admin", u_mod: "moderator" };
export const ACTIVE = {
  u_admin: "x_admin", u_owner: "x_owner", u_staff: "x_staff", u_other: "x_other",
  u_pend: "x_pend", u_mod: "x_mod", u_multi: "x_m1",
};

/** /api/videos mounted with a stub session for the user id (null = anonymous). */
export function chapterApp(d1, as) {
  const user = as ? SESSION_USER(as, ROLES[as] ?? "user", ACTIVE[as] ?? null) : null;
  const hono = new Hono();
  hono.route(
    "/api/videos",
    createVideosRoutes({
      session: async (c, next) => {
        c.set("user", user);
        c.set("sessionState", user ? "user" : "none");
        await next();
      },
    }),
  );
  return (method, path, body, headers = { Origin: SITE }) =>
    hono.request(
      path,
      {
        method,
        headers: { "content-type": "application/json", ...headers },
        body: body === undefined ? undefined : JSON.stringify(body),
      },
      { DB: d1, NEXT_PUBLIC_SITE_URL: SITE },
    );
}
