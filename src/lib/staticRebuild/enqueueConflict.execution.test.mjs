import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runTestWithTsx } from "../testing/runTestWithTsx.mjs";

if (runTestWithTsx(import.meta.url)) {
  const { DatabaseSync } = await import("node:sqlite");
  const { drizzle } = await import("drizzle-orm/sqlite-proxy");
  const { staticRebuildQueue } = await import("../db/schema.ts");

  test("partial uniqueの同時enqueueはDrizzleのDO NOTHINGで無害化できる", () => {
    const sqlite = new DatabaseSync(":memory:");
    const baseline = readFileSync(
      new URL("../../../migrations/0000_flame_node_baseline.sql", import.meta.url),
      "utf8",
    );
    sqlite.exec(baseline);

    const db = drizzle(async () => ({ rows: [] }));
    const buildInsert = (id) =>
      db
        .insert(staticRebuildQueue)
        .values({
          id,
          target_type: "video",
          target_id: "video-public",
          reason: "public_video_detail_miss",
          priority: "normal",
          status: "pending",
          created_at: 1,
          updated_at: 1,
        })
        .onConflictDoNothing()
        .toSQL();

    const first = buildInsert("queue-1");
    const second = buildInsert("queue-2");
    assert.equal(sqlite.prepare(first.sql).run(...first.params).changes, 1);
    assert.equal(sqlite.prepare(second.sql).run(...second.params).changes, 0);
    assert.equal(
      sqlite
        .prepare("SELECT COUNT(*) AS count FROM static_rebuild_queue")
        .get().count,
      1,
    );
    sqlite.close();
  });
}
