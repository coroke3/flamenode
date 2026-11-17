import assert from "node:assert/strict";
import test from "node:test";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "@flamenode/db/schema";
import { createSqlite } from "./support/personalHarness.mjs";
import { seed } from "./support/manageSeed.mjs";
import { createVideoStatusD1 } from "./support/videoStatusD1.mjs";
import { checkManageVideoStatusAccess } from "../src/routes/videos/videoStatusAccess.ts";

test("MIG-0603: unmounted manage status gate matches CURRENT event privilege and exact video link", async () => {
  const sqlite = createSqlite();
  try {
    seed(sqlite);
    const d1 = createVideoStatusD1(sqlite);
    const db = drizzle(d1, { schema });
    const allow = { ok: true };
    const denyPermission = { ok: false, message: "このイベントの作品審査権限がありません。" };
    const denyLink = { ok: false, message: "このイベントに紐づく作品ではありません。" };
    const cases = [
      // An admin skips event-staff privileges, but NOT the association check.
      ["admin", "evA", "v1", allow],
      ["admin", "evB", "v1", denyLink],
      ["admin", "evA", "missing-video", denyLink],
      // Owner/manager/reviewer presets allow exactly video.status, not ownership alone.
      ["owner", "evA", "v1", allow],
      ["mgr", "evA", "v1", allow],
      ["mgr", "evB", "v4", allow],
      ["rev", "evA", "v2", allow],
      // A valid grant for a different event cannot permit an unrelated video.
      ["mgr", "evB", "v1", denyLink],
      ["owner", "evB", "v4", denyPermission],
      ["outsider", "evA", "v1", denyPermission],
      ["outsider", "evC", "v1", denyLink],
      // Valid submission owner (u_plain) has no review privilege.
      ["plain", "evA", "v1", denyPermission],
      ["slot", "evB", "v4", denyPermission],
      ["pubstaff", "evA", "v1", denyPermission],
      // Pending X links cannot grant event privileges even for owner preset.
      ["pending", "evA", "v1", denyPermission],
    ];
    for (const [name, eventId, videoId, expected] of cases) {
      const user = { id: `u_${name}`, role: name === "admin" ? "admin" : "user" };
      const actual = await checkManageVideoStatusAccess(db, user, eventId, videoId);
      assert.deepEqual(actual, expected, `${name} / ${eventId} / ${videoId}`);
    }
    assert.equal(d1.stats.batches, 0, "authorization is read-only and cannot trigger an audited D1 batch");
    assert.equal(d1.stats.writes, 0, "permission/link reads never mutate D1");
  } finally {
    sqlite.close();
  }
});

test("MIG-0603: permission lookup failure rejects instead of granting manage status", async () => {
  const sqlite = createSqlite();
  try {
    seed(sqlite);
    const d1 = createVideoStatusD1(sqlite);
    const db = drizzle(d1, { schema });
    sqlite.exec("DROP TABLE event_staff");
    await assert.rejects(
      checkManageVideoStatusAccess(db, { id: "u_mgr", role: "user" }, "evA", "v1"),
      /event_staff|no such table/i,
      "a database failure cannot turn an incomplete privilege result into approval",
    );
    assert.equal(d1.stats.batches, 0);
    assert.equal(d1.stats.writes, 0);
  } finally {
    sqlite.close();
  }
});
