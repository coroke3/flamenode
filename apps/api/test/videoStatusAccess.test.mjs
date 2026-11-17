import assert from "node:assert/strict";
import test from "node:test";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "@flamenode/db/schema";
import { createSqlite } from "./support/personalHarness.mjs";
import { seed } from "./support/manageSeed.mjs";
import { createVideoStatusD1 } from "./support/videoStatusD1.mjs";
import { checkManageVideoStatusAccess } from "../src/routes/videos/videoStatusAccess.ts";
import { canEditEvent } from "@flamenode/server-core/auth/ownership";

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

test("MIG-0603: video-event association lookup failure rejects for admin and reviewer", async () => {
  for (const name of ["admin", "mgr"]) {
    const sqlite = createSqlite();
    try {
      seed(sqlite);
      // An authorized reviewer and a site admin must both re-check the exact
      // event-video link. No role can turn an unavailable link read into allow.
      sqlite.exec("DROP TABLE video_events");
      const d1 = createVideoStatusD1(sqlite);
      const db = drizzle(d1, { schema });
      await assert.rejects(
        checkManageVideoStatusAccess(
          db,
          { id: `u_${name}`, role: name === "admin" ? "admin" : "user" },
          "evA", "v1",
        ),
        /video_events|no such table/i,
        `${name}: cannot grant a status change when the event association is unavailable`,
      );
      assert.equal(d1.stats.batches, 0, "no D1 batch after link-read failure");
      assert.equal(d1.stats.writes, 0, "no D1 writes after link-read failure");
    } finally {
      sqlite.close();
    }
  }
});

test("MIG-0603: approved-X and staff joined authorization preserves CURRENT deny-before-link ordering", async () => {
  const sqlite = createSqlite();
  try {
    seed(sqlite);
    const d1 = createVideoStatusD1(sqlite);
    const db = drizzle(d1, { schema });
    for (const name of ["admin", "owner", "mgr", "rev", "slot", "pending", "plain", "outsider", "two"]) {
      const user = { id: `u_${name}`, role: name === "admin" ? "admin" : "user" };
      for (const eventId of ["evA", "evB", "evC"]) {
        for (const videoId of ["v1", "v4", "not-a-video"]) {
          // Independent CURRENT reference: keep the canonical permission
          // resolver and exact link query separate for the test oracle.
          const hasPermission = user.role === "admin" ||
            await canEditEvent(db, user, eventId, "video.status");
          const exists = hasPermission && Boolean(sqlite.prepare(
            "SELECT 1 FROM video_events WHERE event_id = ? AND video_id = ? LIMIT 1",
          ).get(eventId, videoId));
          const expected = !hasPermission
            ? { ok: false, message: "このイベントの作品審査権限がありません。" }
            : exists
              ? { ok: true }
              : { ok: false, message: "このイベントに紐づく作品ではありません。" };
          const start = d1.stats.statements;
          const actual = await checkManageVideoStatusAccess(db, user, eventId, videoId);
          assert.deepEqual(actual, expected, `${name}/${eventId}/${videoId}`);
          const reads = d1.stats.statements - start;
          assert.equal(reads, hasPermission ? (name === "admin" ? 1 : 2) : 1,
            "one joined privilege read; exact link read only AFTER successful privilege");
        }
      }
    }
    assert.equal(d1.stats.batches, 0);
    assert.equal(d1.stats.writes, 0);
  } finally {
    sqlite.close();
  }
});

test("MIG-0603: joined approved-X lookup preserves CURRENT whitespace trimming and cannot leak link failures", async () => {
  const sqlite = createSqlite();
  try {
    seed(sqlite);
    // CURRENT approvedXIdsWhere trims IDs returned from the approved X link
    // read. The joined version must match staff's unpadded X ID, too.
    sqlite.exec("UPDATE x_user_account_links SET x_user_id=' mgr_x ' WHERE x_user_id='mgr_x'");
    sqlite.exec("UPDATE x_users SET id=' mgr_x ' WHERE id='mgr_x'");
    const d1 = createVideoStatusD1(sqlite);
    const db = drizzle(d1, { schema });
    const manager = { id: "u_mgr", role: "user" };
    assert.equal(await canEditEvent(db, manager, "evA", "video.status"), true,
      "canonical CURRENT resolver still grants linked, approved padded X");
    const start = d1.stats.statements;
    assert.deepEqual(await checkManageVideoStatusAccess(db, manager, "evA", "v1"), { ok: true });
    assert.equal(d1.stats.statements - start, 2, "joined permission + exact link only");
    sqlite.exec("DROP TABLE video_events");
    const unauth = { id: "u_plain", role: "user" };
    assert.deepEqual(await checkManageVideoStatusAccess(db, unauth, "evA", "v1"), {
      ok: false, message: "このイベントの作品審査権限がありません。",
    }, "an unauthorized caller must be denied before querying the missing link table");
    assert.equal(d1.stats.batches, 0);
    assert.equal(d1.stats.writes, 0);
  } finally {
    sqlite.close();
  }
});

