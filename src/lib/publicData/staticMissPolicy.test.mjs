import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runTestWithTsx } from "../testing/runTestWithTsx.mjs";

if (runTestWithTsx(import.meta.url)) {
  const { DatabaseSync } = await import("node:sqlite");
  const { drizzle } = await import("drizzle-orm/sqlite-proxy");
  const { publicStaticTargetExists } = await import("./publicStaticTargetProbe.ts");

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
      INSERT INTO events (id, title, visibility_status) VALUES
        ('event-public', 'Public event', 'public'),
        ('event-private', 'Private event', 'private');
      INSERT INTO x_users (id, x_name, approval_status) VALUES
        ('alice', 'Alice', 'approved'),
        ('pending-user', 'Pending', 'pending'),
        ('imported-user', 'Imported', 'imported'),
        ('rejected-user', 'Rejected', 'rejected');
      INSERT INTO videos (
        id, submitted_by_user_id, creator_display_name, title,
        youtube_video_id, visibility_status
      ) VALUES
        ('video-public', 'submitter', 'Alice', 'Public video', 'dQw4w9WgXcQ', 'public'),
        ('video-private', 'submitter', 'Alice', 'Private video', 'aaaaaaaaaaa', 'private');
    `);

    let queryCount = 0;
    const db = drizzle(async (sql, params, method) => {
      queryCount += 1;
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

    return {
      db,
      sqlite,
      getQueryCount: () => queryCount,
    };
  }

  test("固定global artifactはDB照会なしで再生成対象にできる", async () => {
    const harness = createHarness();
    assert.equal(
      await publicStaticTargetExists(harness.db, "top", "global"),
      true,
    );
    assert.equal(harness.getQueryCount(), 0);
    harness.sqlite.close();
  });

  test("公開eventだけがpublic miss enqueue対象になる", async () => {
    const harness = createHarness();
    assert.equal(
      await publicStaticTargetExists(harness.db, "event", "event-public"),
      true,
    );
    assert.equal(
      await publicStaticTargetExists(harness.db, "event", "event-private"),
      false,
    );
    assert.equal(
      await publicStaticTargetExists(harness.db, "event", "missing-event"),
      false,
    );
    harness.sqlite.close();
  });

  test("公開videoは内部IDとYouTube IDの両方で照合する", async () => {
    const harness = createHarness();
    assert.equal(
      await publicStaticTargetExists(harness.db, "video", "video-public"),
      true,
    );
    assert.equal(
      await publicStaticTargetExists(harness.db, "video", "dQw4w9WgXcQ"),
      true,
    );
    assert.equal(
      await publicStaticTargetExists(harness.db, "video", "video-private"),
      false,
    );
    assert.equal(
      await publicStaticTargetExists(harness.db, "video", "missing-video"),
      false,
    );
    harness.sqlite.close();
  });

  test("X IDは大小混在でも lower 照合し公開一覧対象の承認状態だけを許可する", async () => {
    const harness = createHarness();
    harness.sqlite.exec(`
      INSERT INTO x_users (id, x_name, approval_status)
      VALUES ('MixedCase', 'Mixed', 'approved');
    `);
    assert.equal(
      await publicStaticTargetExists(harness.db, "user", "ALICE"),
      true,
    );
    assert.equal(
      await publicStaticTargetExists(harness.db, "user", "mixedcase"),
      true,
    );
    assert.equal(
      await publicStaticTargetExists(harness.db, "user", "pending-user"),
      true,
    );
    assert.equal(
      await publicStaticTargetExists(harness.db, "user", "imported-user"),
      true,
    );
    assert.equal(
      await publicStaticTargetExists(harness.db, "user", "rejected-user"),
      false,
    );
    assert.equal(
      await publicStaticTargetExists(harness.db, "user", "missing-user"),
      false,
    );
    harness.sqlite.close();
  });

  test("空IDと過長IDはDB照会前に拒否する", async () => {
    const harness = createHarness();
    assert.equal(
      await publicStaticTargetExists(harness.db, "video", "   "),
      false,
    );
    assert.equal(
      await publicStaticTargetExists(harness.db, "event", "x".repeat(129)),
      false,
    );
    assert.equal(harness.getQueryCount(), 0);
    harness.sqlite.close();
  });
}
