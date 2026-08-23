import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { runTestWithTsx } from "../testing/runTestWithTsx.mjs";

if (runTestWithTsx(import.meta.url)) {
  const { registerHooks } = await import("node:module");
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier === "server-only") {
        return {
          url: "data:text/javascript,export%20{}",
          shortCircuit: true,
        };
      }
      return nextResolve(specifier, context);
    },
  });

  const { drizzle } = await import("drizzle-orm/sqlite-proxy");
  const { SQLiteSyncDialect } = await import("drizzle-orm/sqlite-core");
  const {
    buildReplaceVideoMembersPlan,
    VIDEO_CHAPTER_JSON_MAX_BYTES,
  } = await import("./replaceVideoMembers.ts");
  const { inspectVideoAtomicWritePlanBudget } = await import("./atomicWritePlan.ts");
  const {
    buildStaticRebuildQueueBatch,
    MAX_STATIC_REBUILD_BATCH_TARGETS,
  } = await import("../staticRebuild/enqueue.ts");

  function createSchema(sqlite) {
    sqlite.exec(`
      CREATE TABLE video_members (
        id TEXT PRIMARY KEY,
        video_id TEXT NOT NULL,
        x_user_id TEXT,
        name TEXT NOT NULL,
        role TEXT,
        comment TEXT,
        order_index INTEGER NOT NULL,
        can_edit INTEGER NOT NULL DEFAULT 0,
        is_public_member INTEGER NOT NULL DEFAULT 1,
        edit_granted_by_auth_user_id TEXT,
        edit_granted_at INTEGER,
        edit_updated_at INTEGER
      );
      CREATE TABLE video_chapters (
        id TEXT PRIMARY KEY,
        video_id TEXT NOT NULL,
        x_user_id TEXT,
        chapter_time REAL NOT NULL,
        chapter_label TEXT NOT NULL,
        note TEXT,
        visibility TEXT NOT NULL DEFAULT 'public',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE x_users (
        id TEXT PRIMARY KEY,
        x_name TEXT NOT NULL,
        icon_url TEXT,
        profile_text TEXT,
        portfolio_contact TEXT,
        youtube_channel_url TEXT,
        other_social_links TEXT,
        creative_start_date INTEGER,
        approval_status TEXT
      );
      CREATE TABLE x_user_aliases (
        x_user_id TEXT NOT NULL,
        alias_x_id TEXT NOT NULL,
        PRIMARY KEY (x_user_id, alias_x_id)
      );
      CREATE TABLE static_rebuild_queue (
        id TEXT PRIMARY KEY,
        target_type TEXT NOT NULL,
        target_id TEXT NOT NULL,
        reason TEXT,
        priority TEXT NOT NULL DEFAULT 'normal',
        status TEXT NOT NULL DEFAULT 'pending',
        attempt_count INTEGER NOT NULL DEFAULT 0,
        requested_by_user_id TEXT,
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
        processing_started_at INTEGER,
        lease_token TEXT,
        lease_expires_at INTEGER,
        processed_at INTEGER,
        next_retry_at INTEGER,
        error TEXT
      );
      CREATE UNIQUE INDEX static_rebuild_queue_target_pending_uniq
        ON static_rebuild_queue(target_type, target_id)
        WHERE status IN ('pending', 'processing');
    `);
  }

  function seedHundred(sqlite) {
    const insertMember = sqlite.prepare(
      `INSERT INTO video_members
       (id, video_id, x_user_id, name, role, comment, order_index,
        can_edit, is_public_member, edit_granted_by_auth_user_id,
        edit_granted_at, edit_updated_at)
       VALUES (?, 'video-1', ?, ?, NULL, NULL, ?, 0, 1, NULL, NULL, NULL)`,
    );
    const insertXUser = sqlite.prepare(
      `INSERT INTO x_users (id, x_name, approval_status) VALUES (?, ?, 'approved')`,
    );
    const insertChapter = sqlite.prepare(
      `INSERT INTO video_chapters
       (id, video_id, x_user_id, chapter_time, chapter_label, note,
        visibility, created_at, updated_at)
       VALUES (?, 'video-1', ?, ?, ?, NULL, 'public', 100, 100)`,
    );
    for (let index = 0; index < 100; index += 1) {
      const memberId = `old-vm-${index}`;
      const xId = `old_x_${index}`;
      insertMember.run(memberId, xId, `Old ${index}`, index);
      insertXUser.run(xId, `Old X ${index}`);
      for (let chapterIndex = 0; chapterIndex < 30; chapterIndex += 1) {
        insertChapter.run(
          `${memberId}:member:${chapterIndex}`,
          xId,
          chapterIndex,
          `Old ${chapterIndex}`,
        );
      }
    }
  }

  function makeDb(sqlite, calls = []) {
    return drizzle(async (query, params, method) => {
      calls.push({ query, params, method });
      const statement = sqlite.prepare(query);
      if (method === "run") {
        statement.run(...params);
        return { rows: [] };
      }
      if (method === "get") {
        const row = statement.get(...params);
        return { rows: row ? Object.values(row) : undefined };
      }
      return { rows: statement.all(...params).map((row) => Object.values(row)) };
    });
  }

  function queryOf(statement) {
    if (typeof statement.getSQL !== "function") return null;
    return new SQLiteSyncDialect().sqlToQuery(statement.getSQL());
  }

  function executePlanStatement(sqlite, statement) {
    const query = queryOf(statement);
    assert.ok(query);
    const prepared = sqlite.prepare(query.sql);
    if (/^\s*SELECT\b/i.test(query.sql)) {
      prepared.get(...query.params);
    } else {
      prepared.run(...query.params);
    }
  }

  test("100人全入替×30章×日本語note1000文字でもD1 Free互換budgetとbind上限を守る", async () => {
    const sqlite = new DatabaseSync(":memory:");
    createSchema(sqlite);
    seedHundred(sqlite);
    const calls = [];
    const db = makeDb(sqlite, calls);

    const members = Array.from({ length: 100 }, (_, index) => ({
      name: `新メンバー ${index}`,
      x_user_id: `new_x_${index}`,
      role: "映像",
      comment: "日本語コメント",
      chapters: [],
    }));
    const chaptersByIndex = new Map(
      members.map((_, index) => [
        index,
        Array.from({ length: 30 }, (_, chapterIndex) => ({
          time_seconds: chapterIndex,
          label: `チャプター ${index}-${chapterIndex}`,
          note: "あ".repeat(1000),
          order_index: chapterIndex,
        })),
      ]),
    );

    const plan = await buildReplaceVideoMembersPlan(db, {
      videoId: "video-1",
      members,
      chaptersByIndex,
      actorUserId: "operator-1",
    });

    const queueTargets = [
      ...Array.from({ length: 100 }, (_, index) => ({
        targetType: "user",
        targetId: `old-user-${index}`,
        reason: "video_members_update",
      })),
      ...Array.from({ length: 100 }, (_, index) => ({
        targetType: "user",
        targetId: `new-user-${index}`,
        reason: "video_members_update",
      })),
      { targetType: "video", targetId: "video-1", reason: "video_members_update" },
      { targetType: "users_index", targetId: "global", reason: "video_members_update" },
      { targetType: "member_suggestions", targetId: "global", reason: "video_members_update" },
    ];
    const queue = await buildStaticRebuildQueueBatch(db, queueTargets);
    assert.equal(queue.acceptedTargetCount, queueTargets.length);
    assert.ok(queue.acceptedTargetCount > 200);
    assert.ok(queue.acceptedTargetCount <= MAX_STATIC_REBUILD_BATCH_TARGETS);

    const combined = {
      ...plan,
      statements: [...plan.statements, ...queue.statements],
      expectedChanges: [...plan.expectedChanges, ...queue.expectedChanges],
    };
    const budget = inspectVideoAtomicWritePlanBudget(combined);
    assert.ok(budget.withinLimit, `query budget ${budget.totalQueryCount}/${budget.limit}`);
    assert.ok(budget.totalQueryCount <= 50);

    const queries = combined.statements.map(queryOf).filter(Boolean);
    let maxBindPayloadBytes = 0;
    let maxSqlBytes = 0;
    for (const query of queries) {
      maxSqlBytes = Math.max(
        maxSqlBytes,
        new TextEncoder().encode(query.sql).byteLength,
      );
      assert.ok(query.params.length <= 100, `bind count ${query.params.length}`);
      assert.ok(new TextEncoder().encode(query.sql).byteLength < 100_000);
      for (const param of query.params) {
        if (typeof param !== "string") continue;
        const bytes = new TextEncoder().encode(param).byteLength;
        maxBindPayloadBytes = Math.max(maxBindPayloadBytes, bytes);
        assert.ok(bytes < 2_000_000, `bind payload ${bytes}`);
      }
    }
    assert.ok(maxBindPayloadBytes > 100_000, "stress fixture must exercise a payload larger than SQL text limit");
    assert.ok(maxBindPayloadBytes <= VIDEO_CHAPTER_JSON_MAX_BYTES);
    assert.ok(maxSqlBytes < 100_000);
    for (const call of calls) {
      assert.ok(call.params.length <= 100, `preparation bind count ${call.params.length}`);
    }

    sqlite.close();
  });

  test("新規公開メンバーと同じX IDのhidden editorは権限を引継いで1公開行へ統合する", async () => {
    const sqlite = new DatabaseSync(":memory:");
    createSchema(sqlite);
    sqlite.prepare(
      `INSERT INTO x_users (id, x_name, approval_status) VALUES ('x_1', 'X1', 'approved')`,
    ).run();
    sqlite.prepare(
      `INSERT INTO video_members
       (id, video_id, x_user_id, name, role, comment, order_index,
        can_edit, is_public_member, edit_granted_by_auth_user_id,
        edit_granted_at, edit_updated_at)
       VALUES ('hidden-1', 'video-1', 'x_1', 'X1', NULL, NULL, 9999,
        1, 0, 'grant-user', 100, 101)`,
    ).run();

    const db = makeDb(sqlite);
    const plan = await buildReplaceVideoMembersPlan(db, {
      videoId: "video-1",
      members: [
        {
          name: "X1 public",
          x_user_id: "x_1",
          role: "映像",
          comment: "",
          chapters: [],
        },
      ],
      chaptersByIndex: new Map([[0, []]]),
      actorUserId: "operator-1",
    });

    assert.ok(
      plan.audits.some((audit) => audit.table_name === "video_member_hidden_carry_cleanup"),
    );
    for (const statement of plan.statements) {
      executePlanStatement(sqlite, statement);
    }

    const rows = sqlite
      .prepare(
        `SELECT id, x_user_id, can_edit, is_public_member,
                edit_granted_by_auth_user_id, edit_granted_at, edit_updated_at
         FROM video_members WHERE video_id = 'video-1' AND x_user_id = 'x_1'`,
      )
      .all();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].is_public_member, 1);
    assert.equal(rows[0].can_edit, 1);
    assert.equal(rows[0].edit_granted_by_auth_user_id, "grant-user");
    assert.equal(rows[0].edit_granted_at, 100);
    assert.equal(rows[0].edit_updated_at, 101);

    sqlite.close();
  });

  test("旧aliasで保存しても現行X IDへ寄せてhidden権限を公開行へ統合する", async () => {
    const sqlite = new DatabaseSync(":memory:");
    createSchema(sqlite);
    sqlite.prepare(
      `INSERT INTO x_users (id, x_name, approval_status) VALUES ('current_x', 'Current', 'approved')`,
    ).run();
    sqlite.prepare(
      `INSERT INTO x_user_aliases (x_user_id, alias_x_id) VALUES ('current_x', 'old_x')`,
    ).run();
    sqlite.prepare(
      `INSERT INTO video_members
       (id, video_id, x_user_id, name, role, comment, order_index,
        can_edit, is_public_member, edit_granted_by_auth_user_id,
        edit_granted_at, edit_updated_at)
       VALUES ('hidden-alias', 'video-1', 'current_x', 'Current', NULL, NULL, 9999,
        1, 0, 'grant-user', 100, 101)`,
    ).run();

    const db = makeDb(sqlite);
    const plan = await buildReplaceVideoMembersPlan(db, {
      videoId: "video-1",
      members: [
        {
          name: "Current public",
          x_user_id: "old_x",
          role: "映像",
          comment: "",
          chapters: [],
        },
      ],
      chaptersByIndex: new Map([[0, []]]),
      actorUserId: "operator-1",
    });
    for (const statement of plan.statements) executePlanStatement(sqlite, statement);

    const rows = sqlite
      .prepare(`SELECT x_user_id, can_edit, is_public_member FROM video_members WHERE video_id = 'video-1'`)
      .all();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].x_user_id, "current_x");
    assert.equal(rows[0].can_edit, 1);
    assert.equal(rows[0].is_public_member, 1);
    sqlite.close();
  });
}
