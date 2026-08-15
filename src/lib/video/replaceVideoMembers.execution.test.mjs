import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { runTestWithTsx } from "../testing/runTestWithTsx.mjs";

if (runTestWithTsx(import.meta.url)) {
  const { drizzle } = await import("drizzle-orm/sqlite-proxy");
  const { SQLiteSyncDialect } = await import("drizzle-orm/sqlite-core");
  const { buildReplaceVideoMembersPlan } = await import("./replaceVideoMembers.ts");
  const { VIDEO_CHAPTER_JSON_MAX_BYTES } = await import("./replaceVideoMembers.ts");
  const { loadMemberSubmissionBaseline } = await import("./memberSubmissionBaseline.ts");
  const { inspectVideoAtomicWritePlanBudget } = await import("./atomicWritePlan.ts");
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
  const {
    buildStaticRebuildQueueBatch,
    MAX_STATIC_REBUILD_BATCH_TARGETS,
  } = await import("../staticRebuild/enqueue.ts");

  function createDatabase() {
    const sqlite = new DatabaseSync(":memory:");
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
        x_user_id TEXT NOT NULL,
        chapter_time REAL NOT NULL,
        chapter_label TEXT NOT NULL,
        note TEXT,
        visibility TEXT,
        show_on_player_bar INTEGER DEFAULT 0,
        order_index INTEGER DEFAULT 0,
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
        linked_user_id TEXT,
        verification_token TEXT,
        token_expires_at INTEGER,
        approval_status TEXT,
        approval_requested_at INTEGER
      );
    `);

    const insertMember = sqlite.prepare(
      `INSERT INTO video_members
       (id, video_id, x_user_id, name, role, comment, order_index,
        can_edit, is_public_member, edit_granted_by_auth_user_id,
        edit_granted_at, edit_updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const insertXUser = sqlite.prepare(
      `INSERT INTO x_users (id, x_name, approval_status) VALUES (?, ?, 'approved')`,
    );
    const insertChapter = sqlite.prepare(
      `INSERT INTO video_chapters
       (id, video_id, x_user_id, chapter_time, chapter_label, note,
        visibility, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'public', ?, ?)`,
    );
    for (let index = 0; index < 100; index += 1) {
      const memberId = `vm-${index}`;
      const xId = `x-${index}`;
      insertMember.run(memberId, "video-1", xId, `Member ${index}`, null, null, index, 0, 1, null, null, null);
      insertXUser.run(xId, `X ${index}`);
      for (let chapterIndex = 0; chapterIndex < 30; chapterIndex += 1) {
        insertChapter.run(
          `${memberId}:member:${chapterIndex}`,
          "video-1",
          xId,
          chapterIndex,
          `Chapter ${chapterIndex}`,
          null,
          100,
          100,
        );
      }
    }
    return sqlite;
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

  test("100人×管理チャプター30件でもquery bindは100未満のJSON1文になる", async () => {
    const sqlite = createDatabase();
    const calls = [];
    const db = makeDb(sqlite, calls);
    const members = Array.from({ length: 100 }, (_, index) => ({
      name: `Member ${index}`,
      x_user_id: `x-${index}`,
      role: "",
      comment: "",
      chapters: [],
    }));
    const chaptersByIndex = new Map(
      members.map((_, index) => [
        index,
        Array.from({ length: 30 }, (_, chapterIndex) => ({
          time_seconds: chapterIndex,
          label: `Changed ${index}-${chapterIndex}`,
          note: "x".repeat(1000),
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
    const baseline = await loadMemberSubmissionBaseline(db, "video-1");
    assert.equal(baseline.members.length, 100);
    assert.equal(
      [...baseline.chaptersByIndex.values()].reduce(
        (count, chapters) => count + chapters.length,
        0,
      ),
      3000,
    );

    const queries = plan.statements.map(queryOf).filter(Boolean);
    assert.ok(queries.length >= 2);
    for (const call of calls) {
      assert.ok(call.params.length <= 100, `preparation bind count ${call.params.length}`);
    }
    const carryCalls = calls.filter(
      (call) => call.query.includes("video_members") && call.query.includes("json_each"),
    );
    assert.equal(carryCalls.length, 1);
    assert.equal(carryCalls[0].params.length, 3);
    for (const query of queries) {
      assert.ok(query.params.length <= 100, `bind count ${query.params.length}`);
    }
    const chapterDeletes = queries.filter((query) => /DELETE FROM video_chapters/.test(query.sql));
    const chapterInserts = queries.filter((query) => /INSERT INTO video_chapters/.test(query.sql));
    assert.ok(chapterDeletes.length >= 1);
    assert.ok(chapterInserts.length > 1, "large chapter payload must be byte-chunked");
    let deletedRows = 0;
    for (const chapterDelete of chapterDeletes) {
      assert.match(chapterDelete.sql, /json_each/);
      assert.equal(chapterDelete.params.length, 2);
      assert.ok(new TextEncoder().encode(String(chapterDelete.params[1])).byteLength <= VIDEO_CHAPTER_JSON_MAX_BYTES);
      deletedRows += sqlite.prepare(chapterDelete.sql).run(...chapterDelete.params).changes;
    }
    let insertedRows = 0;
    for (const chapterInsert of chapterInserts) {
      assert.match(chapterInsert.sql, /FROM json_each/);
      assert.equal(chapterInsert.params.length, 1);
      assert.ok(new TextEncoder().encode(String(chapterInsert.params[0])).byteLength <= VIDEO_CHAPTER_JSON_MAX_BYTES);
      insertedRows += sqlite.prepare(chapterInsert.sql).run(...chapterInsert.params).changes;
    }
    assert.equal(deletedRows, 3000);
    assert.equal(insertedRows, 3000);
    assert.equal(
      sqlite.prepare("SELECT COUNT(*) AS count FROM video_chapters WHERE video_id = 'video-1'").get().count,
      3000,
    );

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
      ...[
        ["video", "video-1"],
        ["users_index", "global"],
        ["search_index", "global"],
        ["random_video_pool", "global"],
        ["top_recommended", "global"],
        ["top_latest", "global"],
        ["top_nostalgic", "global"],
        ["top_stats", "global"],
        ["recommend_core", "global"],
      ].map(([targetType, targetId]) => ({
        targetType,
        targetId,
        reason: "video_members_update",
      })),
    ];
    const queue = await buildStaticRebuildQueueBatch(db, queueTargets);
    assert.equal(queue.acceptedTargetCount, queueTargets.length);
    assert.ok(queue.acceptedTargetCount > 200);
    assert.ok(queue.acceptedTargetCount <= MAX_STATIC_REBUILD_BATCH_TARGETS);
    assert.equal(queue.statements.length, 5);
    const queuePayload = queue.statements
      .map(queryOf)
      .flatMap((query) => query.params)
      .map(String)
      .join("\n");
    for (const targetType of [
      "video",
      "users_index",
      "search_index",
      "random_video_pool",
      "top_recommended",
      "top_latest",
      "top_nostalgic",
      "top_stats",
      "recommend_core",
    ]) {
      assert.match(queuePayload, new RegExp(`\\\"target_type\\\":\\\"${targetType}\\\"`));
    }
    const budget = inspectVideoAtomicWritePlanBudget({
      ...plan,
      statements: [...plan.statements, ...queue.statements],
      expectedChanges: [...plan.expectedChanges, ...queue.expectedChanges],
    });
    assert.ok(budget.withinLimit, `query budget ${budget.totalQueryCount}/${budget.limit}`);
    assert.ok(budget.totalQueryCount <= 50);
    sqlite.close();
  });
}
