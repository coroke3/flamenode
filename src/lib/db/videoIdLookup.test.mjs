import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runTestWithTsx } from "../testing/runTestWithTsx.mjs";

if (runTestWithTsx(import.meta.url)) {
  const { DatabaseSync } = await import("node:sqlite");
  const { drizzle } = await import("drizzle-orm/sqlite-proxy");
  const {
    fetchVideoRowByIdOrYoutube,
    isConfirmedInternalVideoId,
    resolveVideoPrimaryKey,
  } = await import("./videoIdLookup.ts");

  function createHarness() {
    const sqlite = new DatabaseSync(":memory:");
    const baseline = readFileSync(
      new URL("../../../migrations/0000_flame_node_baseline.sql", import.meta.url),
      "utf8",
    );
    sqlite.exec(baseline);
    sqlite.exec("PRAGMA ignore_check_constraints = ON");
    sqlite.exec(`
      INSERT INTO "user" (id) VALUES ('submitter');
      INSERT INTO videos (
        id, submitted_by_user_id, creator_display_name, title,
        youtube_video_id, visibility_status
      ) VALUES
        ('video-public', 'submitter', 'Alice', 'Public video', 'dQw4w9WgXcQ', 'public'),
        ('video-private', 'submitter', 'Alice', 'Private video', 'aaaaaaaaaaa', 'private');
    `);

    const queries = [];
    const db = drizzle(async (sql, params, method) => {
      queries.push({ sql, params, method });
      const statement = sqlite.prepare(sql);
      statement.setReturnArrays(true);
      if (method === "run") {
        statement.run(...params);
        return { rows: [] };
      }
      if (method === "get") {
        const row = statement.get(...params);
        return { rows: row ? [row] : [] };
      }
      return { rows: statement.all(...params) };
    });

    return { db, sqlite, queries };
  }

  test("PK hit では youtube_video_id 検索を実行しない", async () => {
    const { db, queries, sqlite } = createHarness();
    const resolved = await resolveVideoPrimaryKey(db, "video-public");
    assert.equal(resolved, "video-public");
    assert.ok(
      queries.every((entry) => !String(entry.sql).includes("youtube_video_id")),
    );
    sqlite.close();
  });

  test("PK miss 時のみ youtube_video_id で解決する", async () => {
    const { db, queries, sqlite } = createHarness();
    const resolved = await resolveVideoPrimaryKey(db, "dQw4w9WgXcQ");
    assert.equal(resolved, "video-public");
    assert.equal(
      queries.filter((entry) => String(entry.sql).includes("youtube_video_id"))
        .length,
      1,
    );
    sqlite.close();
  });

  test("両方 miss では null を返す", async () => {
    const { db, sqlite } = createHarness();
    assert.equal(await resolveVideoPrimaryKey(db, "missing-video"), null);
    assert.equal(await fetchVideoRowByIdOrYoutube(db, "missing-video"), null);
    sqlite.close();
  });

  test("内部 ID 形式の miss では youtube 検索へ進まない", async () => {
    const { db, queries, sqlite } = createHarness();
    const internalId = "video_00000000-0000-4000-8000-000000000001";
    assert.equal(isConfirmedInternalVideoId(internalId), true);
    assert.equal(await resolveVideoPrimaryKey(db, internalId), null);
    assert.ok(
      queries.every((entry) => !String(entry.sql).includes("youtube_video_id")),
    );
    sqlite.close();
  });
}
