import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

test("static_rebuild_queue active lookup は partial unique index を使う", () => {
  const sqlite = new DatabaseSync(":memory:");
  const baseline = readFileSync(
    new URL("../../../migrations/0000_flame_node_baseline.sql", import.meta.url),
    "utf8",
  );
  sqlite.exec(baseline);
  sqlite.exec(`
    INSERT INTO static_rebuild_queue (
      id, target_type, target_id, reason, priority, status,
      attempt_count, created_at, updated_at
    ) VALUES (
      'queue-1', 'video', 'video-public', 'test', 'normal', 'pending',
      0, 1, 1
    );
  `);

  const plan = sqlite
    .prepare(
      `EXPLAIN QUERY PLAN
       SELECT id, status, priority, updated_at, lease_token, requested_by_user_id, target_type, target_id
       FROM static_rebuild_queue
       WHERE target_type = ? AND target_id = ? AND status IN ('pending', 'processing')`,
    )
    .all("video", "video-public");

  const detail = plan.map((row) => String(row.detail ?? row[3] ?? "")).join("\n");
  assert.match(
    detail,
    /static_rebuild_queue_target_pending_uniq|USING INDEX/,
    `unexpected plan:\n${detail}`,
  );

  sqlite.close();
});
