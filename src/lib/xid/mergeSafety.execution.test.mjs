import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { runTestWithTsx } from "../testing/runTestWithTsx.mjs";

if (runTestWithTsx(import.meta.url)) {
  const { sql } = await import("drizzle-orm");
  const { SQLiteSyncDialect } = await import("drizzle-orm/sqlite-core");
  const {
    buildXIdMergeAfterState,
    buildXIdMergeBeforeState,
    xIdMergeStateMatchesSql,
  } = await import("./mergeSafety.ts");
  const dialect = new SQLiteSyncDialect();

  const source = "old_name";
  const target = "current_name";
  const now = 200;

  function snapshot() {
    const staffRow = (id, eventId, xUserId, preset, updatedAt = 10) => ({
      id,
      event_id: eventId,
      x_user_id: xUserId,
      display_name: id,
      permission_preset: preset,
      custom_permission_keys_json: preset === "custom" ? '["events.read"]' : null,
      is_public: 1,
      public_role_label: null,
      approved_by_auth_user_id: "admin-1",
      approved_at: 1,
      created_at: 2,
      updated_at: updatedAt,
    });
    return {
      source_x_user: { id: source, approval_status: "approved" },
      target_x_user: { id: target, approval_status: "approved" },
      active_users: [
        { id: "auth-source", active_x_user_id: source },
        { id: "auth-target", active_x_user_id: target },
      ],
      account_links: [
        {
          x_user_id: source,
          auth_user_id: "auth-shared",
          link_role: "owner",
          created_by_request_id: "source-request",
          created_at: 10,
          updated_at: 11,
        },
        {
          x_user_id: target,
          auth_user_id: "auth-shared",
          link_role: "manager",
          created_by_request_id: "target-request",
          created_at: 12,
          updated_at: 13,
        },
        {
          x_user_id: source,
          auth_user_id: "auth-source-only",
          link_role: "manager",
          created_by_request_id: null,
          created_at: 14,
          updated_at: 15,
        },
      ],
      videos: [{ id: "video-1", creator_x_user_id: source, updated_at: 20 }],
      video_chapters: [{ id: "chapter-1", x_user_id: source, updated_at: 21 }],
      video_members: [{ id: "member-1", x_user_id: source }],
      slots: [
        {
          id: "slot-1",
          x_user_id: source,
          reserved_x_id_snapshot: `@${source}`,
          updated_at: 22,
          version: 3,
        },
      ],
      slot_reservation_groups: [
        { id: "group-1", x_user_id: source, updated_at: 23, version: 4 },
      ],
      video_moderation_cases: [{ id: "case-1", related_x_user_id: source }],
      video_interactions: [
        { x_user_id: source, video_id: "video-1", interaction_type: "like", created_at: 30 },
        { x_user_id: target, video_id: "video-1", interaction_type: "like", created_at: 31 },
        { x_user_id: source, video_id: "video-2", interaction_type: "bookmark", created_at: 32 },
      ],
      event_staff: [
        staffRow("staff-source-owner", "event-shared", source, "owner"),
        staffRow("staff-target-manager", "event-shared", target, "manager", 12),
        staffRow("staff-source-custom", "event-source-only", source, "custom", 13),
      ],
      aliases: [
        { x_user_id: source, alias_x_id: "old-alias" },
        { x_user_id: source, alias_x_id: "colliding-alias" },
        { x_user_id: target, alias_x_id: "colliding-alias" },
      ],
    };
  }

  function makeDatabase() {
    const db = new DatabaseSync(":memory:");
    db.exec(`
      CREATE TABLE x_users (id TEXT, approval_status TEXT);
      CREATE TABLE "user" (id TEXT, active_x_user_id TEXT);
      CREATE TABLE x_user_account_links (
        x_user_id TEXT, auth_user_id TEXT, link_role TEXT,
        created_by_request_id TEXT, created_at INTEGER, updated_at INTEGER
      );
      CREATE TABLE videos (id TEXT, creator_x_user_id TEXT, updated_at INTEGER);
      CREATE TABLE video_chapters (id TEXT, x_user_id TEXT, updated_at INTEGER);
      CREATE TABLE video_members (id TEXT, x_user_id TEXT);
      CREATE TABLE slots (
        id TEXT, x_user_id TEXT, reserved_x_id_snapshot TEXT,
        updated_at INTEGER, version INTEGER
      );
      CREATE TABLE slot_reservation_groups (
        id TEXT, x_user_id TEXT, updated_at INTEGER, version INTEGER
      );
      CREATE TABLE video_moderation_cases (id TEXT, related_x_user_id TEXT);
      CREATE TABLE video_interactions (
        x_user_id TEXT, video_id TEXT, interaction_type TEXT, created_at INTEGER
      );
      CREATE TABLE event_staff (
        id TEXT, event_id TEXT, x_user_id TEXT, display_name TEXT,
        permission_preset TEXT, custom_permission_keys_json TEXT, is_public INTEGER,
        public_role_label TEXT, approved_by_auth_user_id TEXT, approved_at INTEGER,
        created_at INTEGER, updated_at INTEGER
      );
      CREATE TABLE x_user_aliases (x_user_id TEXT, alias_x_id TEXT);
    `);
    return db;
  }

  const TABLES = [
    ["x_users", "x_users"],
    ["user", "active_users"],
    ["x_user_account_links", "account_links"],
    ["videos", "videos"],
    ["video_chapters", "video_chapters"],
    ["video_members", "video_members"],
    ["slots", "slots"],
    ["slot_reservation_groups", "slot_reservation_groups"],
    ["video_moderation_cases", "video_moderation_cases"],
    ["video_interactions", "video_interactions"],
    ["event_staff", "event_staff"],
    ["x_user_aliases", "aliases"],
  ];

  function insertRows(db, table, rows) {
    for (const row of rows) {
      const columns = Object.keys(row);
      const quotedColumns = columns.map((column) => `"${column}"`).join(", ");
      const placeholders = columns.map(() => "?").join(", ");
      db.prepare(
        `INSERT INTO "${table}" (${quotedColumns}) VALUES (${placeholders})`,
      ).run(...columns.map((column) => row[column]));
    }
  }

  function insertState(db, state) {
    for (const [table, path] of TABLES) {
      insertRows(db, table, state[path]);
    }
  }

  function evaluate(db, condition) {
    const query = dialect.sqlToQuery(sql`SELECT ${condition} AS ok`);
    return {
      ok: Boolean(db.prepare(query.sql).get(...query.params).ok),
      query,
    };
  }

  test("merge state assertion compares every merge-owned row and keeps the snapshot as one bind", () => {
    const input = snapshot();
    const before = buildXIdMergeBeforeState(input);
    const after = buildXIdMergeAfterState(input, {
      sourceXUserId: source,
      targetXUserId: target,
      now,
    });
    const db = makeDatabase();
    insertState(db, before);

    const beforeResult = evaluate(
      db,
      xIdMergeStateMatchesSql(before, {
        sourceXUserId: source,
        targetXUserId: target,
        phase: "before",
      }),
    );
    assert.equal(beforeResult.ok, true);
    assert.ok(beforeResult.query.params.length <= 100);
    assert.equal(
      beforeResult.query.params.filter((value) => value === JSON.stringify(before)).length,
      1,
      "large restore state must be a single prepared JSON bind",
    );

    db.close();
    const afterDb = makeDatabase();
    insertState(afterDb, after);
    const afterCondition = xIdMergeStateMatchesSql(after, {
      sourceXUserId: source,
      targetXUserId: target,
      phase: "after",
    });
    assert.equal(evaluate(afterDb, afterCondition).ok, true);

    // A post-merge target-only link was not created by the merge. It is out
    // of the inverse scope and must neither block nor be deleted by a revert.
    insertRows(afterDb, "x_user_account_links", [{
      x_user_id: target,
      auth_user_id: "auth-added-after-merge",
      link_role: "manager",
      created_by_request_id: "later-request",
      created_at: 300,
      updated_at: 300,
    }]);
    assert.equal(evaluate(afterDb, afterCondition).ok, true);

    // A merge-owned target row changing after the merge is a conflict. The
    // revert precondition rejects before it can overwrite the role.
    afterDb.prepare(`
      UPDATE x_user_account_links SET link_role = 'manager'
      WHERE x_user_id = ? AND auth_user_id = 'auth-shared'
    `).run(target);
    assert.equal(evaluate(afterDb, afterCondition).ok, false);
    afterDb.close();
  });

  test("merge-owned event_staff custom permissions are protected by the same after-state CAS", () => {
    const input = snapshot();
    const after = buildXIdMergeAfterState(input, {
      sourceXUserId: source,
      targetXUserId: target,
      now,
    });
    const db = makeDatabase();
    insertState(db, after);
    const condition = xIdMergeStateMatchesSql(after, {
      sourceXUserId: source,
      targetXUserId: target,
      phase: "after",
    });
    assert.equal(evaluate(db, condition).ok, true);
    db.prepare(`
      UPDATE event_staff
      SET custom_permission_keys_json = '["events.write"]'
      WHERE id = 'staff-source-custom'
    `).run();
    assert.equal(evaluate(db, condition).ok, false);
    db.close();
  });
}
