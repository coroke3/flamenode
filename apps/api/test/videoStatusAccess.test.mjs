import assert from "node:assert/strict";
import test from "node:test";
import { drizzle } from "drizzle-orm/d1";
import { sql } from "drizzle-orm";
import * as schema from "@flamenode/db/schema";
import { createSqlite, insert } from "./support/personalHarness.mjs";
import { seed } from "./support/manageSeed.mjs";
import { createVideoStatusD1 } from "./support/videoStatusD1.mjs";
import { checkManageVideoStatusAccess, loadManageVideoStatusSnapshot, loadAdminVideoStatusSnapshot } from "../src/routes/videos/videoStatusAccess.ts";
import { MAX_MANAGE_STATUS_REBUILD_EVENTS, planAdminVideoStatusCommitAssertion, planManageVideoStatusCommitAssertion } from "@flamenode/server-core/video/manageStatusAccess";
import { loadTosState } from "../src/middleware/writeOrigin.ts";
import { evaluateCostGuardWithSettings } from "../src/middleware/costGuard.ts";
import { MAX_VIDEO_STATUS_REBUILD_EVENT_TARGETS } from "@flamenode/server-core/staticRebuild/hooks";
import { canEditEvent } from "@flamenode/server-core/auth/ownership";

// Drizzle D1 `batch()` requires a prepared statement with a D1 bindable
// `stmt`. A `db.run(sql`...`)` SQLWrapper alone is not a batch item:
// the production audit/mutate.ts asBatchRunnable adapter compiles it first.
// Keep this test seam equivalent so that it exercises the REAL transactional
// SQLite D1 batch, not a TypeError before the assertion can execute.
function preparedStatusTestBatchItem(db, sqlWrapper) {
  const compiled = db.dialect.sqlToQuery(sqlWrapper.getSQL());
  const stmt = db.$client.prepare(compiled.sql);
  return {
    _prepare: () => ({
      getQuery: () => compiled,
      stmt,
      mapResult: (result) => result,
    }),
  };
}


// Every legit status mutation requires a real, enabled system_settings row.
function enableStatusCostGuard(sqlite) {
  sqlite.exec(`INSERT INTO system_settings
    (id, operation_mode, disabled_features_json, cost_guard_exception_until, cost_guard_exception_features_json)
    VALUES ('default', 'normal', NULL, NULL, NULL)
    ON CONFLICT(id) DO UPDATE SET operation_mode='normal',
      disabled_features_json=NULL, cost_guard_exception_until=NULL,
      cost_guard_exception_features_json=NULL`);
}

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

test("MIG-0603: revoked X approval and custom grants never bypass joined event status permission", async () => {
  const sqlite = createSqlite();
  try {
    seed(sqlite);
    const d1 = createVideoStatusD1(sqlite);
    const db = drizzle(d1, { schema });
    const manager = { id: "u_mgr", role: "user" };
    const custom = { id: "u_custom", role: "user" };
    async function assertCurrentParity(user, expected, context) {
      const current = await canEditEvent(db, user, "evA", "video.status");
      assert.equal(current, expected, "CURRENT event authorization reference: " + context);
      const before = d1.stats.statements;
      const actual = await checkManageVideoStatusAccess(db, user, "evA", "v1");
      assert.deepEqual(actual, expected
        ? { ok: true }
        : { ok: false, message: "このイベントの作品審査権限がありません。" },
      "joined access must match CURRENT: " + context);
      assert.equal(d1.stats.statements - before, expected ? 2 : 1,
        "one approved-link/staff select plus exact video link only when permitted: " + context);
    }
    await assertCurrentParity(manager, true, "approved manager");
    sqlite.exec("UPDATE x_user_account_links SET link_role='manager' WHERE auth_user_id='u_mgr'");
    await assertCurrentParity(manager, true, "manager link role still qualifies without owner-only filter");
    sqlite.exec("UPDATE x_users SET approval_status='rejected' WHERE id='mgr_x'");
    await assertCurrentParity(manager, false, "rejected X approval revokes reviewer grant");
    sqlite.exec("UPDATE x_users SET approval_status='pending' WHERE id='mgr_x'");
    await assertCurrentParity(manager, false, "pending X approval revokes reviewer grant");
    sqlite.exec("UPDATE x_users SET approval_status='approved' WHERE id='mgr_x'");
    await assertCurrentParity(manager, true, "re-approved X restores reviewer grant");

    await assertCurrentParity(custom, false, "unrelated custom permission cannot change status");
    sqlite.exec(`UPDATE event_staff SET custom_permission_keys_json='["video.status"]'
      WHERE event_id='evA' AND x_user_id='custom_x'`);
    await assertCurrentParity(custom, true, "explicit custom video.status permission is accepted");
    sqlite.exec(`UPDATE event_staff SET custom_permission_keys_json='["videos.title"]'
      WHERE event_id='evA' AND x_user_id='custom_x'`);
    await assertCurrentParity(custom, false, "custom status permission removal denies");
    sqlite.exec("DROP TABLE video_events");
    // No permission => do not query an inaccessible target/link table.
    assert.deepEqual(
      await checkManageVideoStatusAccess(db, custom, "evA", "v1"),
      { ok: false, message: "このイベントの作品審査権限がありません。" },
      "revoked custom permissions deny before reading a missing video_events table",
    );
    assert.equal(d1.stats.writes, 0);
    assert.equal(d1.stats.batches, 0);
  } finally {
    sqlite.close();
  }
});

test("MIG-0603: joined event status privilege is bounded at 256 rows and fails closed on overflow", async () => {
  const sqlite = createSqlite();
  try {
    seed(sqlite);
    // The existing manager already has one approved X + evA staff grant.
    // Build 255 more approved links and staff grants, then cross the cap.
    const addStaff = (i) => {
      const xId = `cap_x_${i}`;
      insert(sqlite, "x_users", {
        id: xId, x_name: xId, approval_status: "approved",
      });
      insert(sqlite, "x_user_account_links", {
        x_user_id: xId, auth_user_id: "u_mgr", link_role: "manager",
      });
      insert(sqlite, "event_staff", {
        id: `cap_staff_${i}`, event_id: "evA", x_user_id: xId,
        display_name: xId, permission_preset: "public_staff",
      });
    };
    for (let i = 0; i < 255; i += 1) addStaff(i);
    const d1 = createVideoStatusD1(sqlite);
    const db = drizzle(d1, { schema });
    const manager = { id: "u_mgr", role: "user" };
    const before = d1.stats.statements;
    assert.deepEqual(await checkManageVideoStatusAccess(db, manager, "evA", "v1"), {
      ok: true,
    }, "the joined result is still authorized at the inclusive 256-row cap");
    assert.equal(d1.stats.statements - before, 2);

    addStaff(255);
    const overflowStart = d1.stats.statements;
    await assert.rejects(
      checkManageVideoStatusAccess(db, manager, "evA", "v1"),
      /manage_video_status_staff_read_limit_exceeded/,
      "never decide a status change from a truncated joined privilege snapshot",
    );
    assert.equal(d1.stats.statements - overflowStart, 1,
      "the overflow must abort before probing the target video-events association");
    assert.equal(d1.stats.batches, 0);
    assert.equal(d1.stats.writes, 0);
  } finally {
    sqlite.close();
  }
});

test("MIG-0603: an orphaned video_events link is not an authorized status target", async () => {
  const sqlite = createSqlite();
  try {
    seed(sqlite);
    // Repair/import jobs can temporarily leave a link without a target video
    // when FK enforcement is disabled. A linked row is not a real video.
    sqlite.exec("PRAGMA foreign_keys = OFF");
    sqlite.prepare("INSERT INTO video_events (event_id, video_id) VALUES (?, ?)")
      .run("evA", "video-orphan");
    assert.ok(sqlite.prepare(
      "SELECT 1 FROM video_events WHERE event_id = ? AND video_id = ?"
    ).get("evA", "video-orphan"), "characterize a real dangling event link");
    assert.equal(sqlite.prepare("SELECT id FROM videos WHERE id = ?")
      .get("video-orphan"), undefined);

    const d1 = createVideoStatusD1(sqlite);
    const db = drizzle(d1, { schema });
    for (const [name, role, expectedReads] of [
      ["admin", "admin", 1],
      ["mgr", "user", 2],
    ]) {
      const before = d1.stats.statements;
      assert.deepEqual(
        await checkManageVideoStatusAccess(
          db, { id: `u_${name}`, role }, "evA", "video-orphan",
        ),
        { ok: false, message: "このイベントに紐づく作品ではありません。" },
        `${name}: an orphan link must not authorize a write to a missing video`,
      );
      assert.equal(d1.stats.statements - before, expectedReads,
        "target existence is verified in the existing link read, with no extra D1 statement");
    }
    assert.deepEqual(await checkManageVideoStatusAccess(
      db, { id: "u_mgr", role: "user" }, "evA", "v1",
    ), { ok: true }, "valid links and existing targets remain authorized");
    assert.equal(d1.stats.batches, 0);
    assert.equal(d1.stats.writes, 0);
  } finally {
    sqlite.close();
  }
});

test("MIG-0603: an orphan event link is not an authorized manage status target", async () => {
  const sqlite = createSqlite();
  try {
    seed(sqlite);
    // A legacy import/repair can leave both a staff grant and video_events
    // association pointing to an event removed while FKs were disabled.
    sqlite.exec("PRAGMA foreign_keys = OFF");
    const missingEventId = "ev-deleted";
    sqlite.prepare("INSERT INTO video_events (event_id, video_id) VALUES (?, ?)")
      .run(missingEventId, "v1");
    insert(sqlite, "event_staff", {
      id: "st-deleted-event", event_id: missingEventId, x_user_id: "mgr_x",
      display_name: "Orphan staff", permission_preset: "manager",
    });
    assert.equal(sqlite.prepare("SELECT id FROM events WHERE id=?")
      .get(missingEventId), undefined);
    assert.ok(sqlite.prepare(
      "SELECT 1 FROM video_events WHERE event_id=? AND video_id=?",
    ).get(missingEventId, "v1"), "an orphan event link really exists");

    const d1 = createVideoStatusD1(sqlite);
    const db = drizzle(d1, { schema });
    for (const [name, role, reads] of [
      ["admin", "admin", 1],
      ["mgr", "user", 2],
    ]) {
      const before = d1.stats.statements;
      assert.deepEqual(
        await checkManageVideoStatusAccess(
          db, { id: `u_${name}`, role }, missingEventId, "v1",
        ),
        { ok: false, message: "このイベントに紐づく作品ではありません。" },
        `${name}: missing event cannot be a valid target even with a dangling staff grant`,
      );
      assert.equal(d1.stats.statements - before, reads,
        "event existence is checked by an inner join in the existing association read");
    }
    assert.deepEqual(
      await checkManageVideoStatusAccess(db, { id: "u_mgr", role: "user" }, "evA", "v1"),
      { ok: true },
      "ordinary valid grants/association still authorize the unmounted preflight",
    );
    sqlite.exec("UPDATE event_staff SET permission_preset='public_staff' WHERE id='st-deleted-event'");
    const start = d1.stats.statements;
    assert.deepEqual(
      await checkManageVideoStatusAccess(db, { id: "u_mgr", role: "user" }, missingEventId, "v1"),
      { ok: false, message: "このイベントの作品審査権限がありません。" },
      "revoked staff grant is denied BEFORE probing the target",
    );
    assert.equal(d1.stats.statements - start, 1,
      "unprivileged callers must not learn the orphan link from a second read");
    assert.equal(d1.stats.batches, 0);
    assert.equal(d1.stats.writes, 0);
  } finally {
    sqlite.close();
  }
});

test("MIG-0603: opt-in snapshot preloads full video row within the existing bounded association read", async () => {
  const sqlite = createSqlite();
  try {
    seed(sqlite);
    const d1 = createVideoStatusD1(sqlite);
    const db = drizzle(d1, { schema });
    const manager = { id: "u_mgr", role: "user" };
    const admin = { id: "u_admin", role: "admin" };
    const outsider = { id: "u_plain", role: "user" };

    for (const [user, eventId, videoId, expectedReads] of [
      [manager, "evA", "v1", 2],
      [admin, "evA", "v1", 1],
    ]) {
      const before = d1.stats.statements;
      const value = await loadManageVideoStatusSnapshot(db, user, eventId, videoId);
      assert.equal(value.ok, true);
      assert.equal(d1.stats.statements - before, expectedReads,
        "full planner-ready video row must reuse the existing exact link D1 query");
      const raw = sqlite.prepare("SELECT * FROM videos WHERE id = ?").get(videoId);
      for (const key of ["id", "title", "visibility_status", "updated_at", "primary_event_id", "youtube_video_id"]) {
        assert.equal(value.video[key], raw[key], `canonical full video row: ${key}`);
      }
      assert.equal(Object.keys(value.video).length, Object.keys(raw).length,
        "snapshot is complete for full-row audit/CAS; not just a status projection");
    }
    const beforeDenied = d1.stats.statements;
    assert.deepEqual(
      await loadManageVideoStatusSnapshot(db, outsider, "evA", "v1"),
      { ok: false, message: "このイベントの作品審査権限がありません。" },
    );
    assert.equal(d1.stats.statements - beforeDenied, 1,
      "denied reviewer must not probe any foreign video data");
    assert.deepEqual(
      await loadManageVideoStatusSnapshot(db, manager, "evB", "v1"),
      { ok: false, message: "このイベントに紐づく作品ではありません。" },
      "approved evB staff cannot retrieve a video linked only to evA",
    );
    assert.deepEqual(
      await checkManageVideoStatusAccess(db, manager, "evA", "v1"),
      { ok: true },
      "legacy Hono boundary still returns no video body",
    );
    assert.equal(d1.stats.batches, 0);
    assert.equal(d1.stats.writes, 0);
  } finally {
    sqlite.close();
  }
});

test("MIG-0603: opt-in video status snapshot fails closed for revoked grants and oversized fan-out", async () => {
  const sqlite = createSqlite();
  try {
    seed(sqlite);
    const d1 = createVideoStatusD1(sqlite);
    const db = drizzle(d1, { schema });
    const manager = { id: "u_mgr", role: "user" };
    const denied = { ok: false, message: "このイベントの作品審査権限がありません。" };

    sqlite.exec("UPDATE x_users SET approval_status='rejected' WHERE id='mgr_x'");
    const rejectedStart = d1.stats.statements;
    assert.deepEqual(
      await loadManageVideoStatusSnapshot(db, manager, "evA", "v1"), denied,
      "revoked X approval must deny the full video snapshot",
    );
    assert.equal(d1.stats.statements - rejectedStart, 1,
      "rejected approval must not probe the event/video association");
    sqlite.exec("UPDATE x_users SET approval_status='approved' WHERE id='mgr_x'");
    sqlite.exec("UPDATE event_staff SET permission_preset='public_staff' WHERE event_id='evA' AND x_user_id='mgr_x'");
    const revokedStart = d1.stats.statements;
    assert.deepEqual(
      await loadManageVideoStatusSnapshot(db, manager, "evA", "v1"), denied,
      "revoked video.status permission must deny the full video snapshot",
    );
    assert.equal(d1.stats.statements - revokedStart, 1);
    sqlite.exec("UPDATE event_staff SET permission_preset='manager' WHERE event_id='evA' AND x_user_id='mgr_x'");

    // 256 joined staff rows are the inclusive cap. A 257th must never
    // authorize or return a truncated snapshot, even if the first row grants.
    const addStaff = (i) => {
      const xId = `snapshot_cap_${i}`;
      insert(sqlite, "x_users", { id: xId, x_name: xId, approval_status: "approved" });
      insert(sqlite, "x_user_account_links", {
        x_user_id: xId, auth_user_id: "u_mgr", link_role: "manager",
      });
      insert(sqlite, "event_staff", {
        id: `snapshot_staff_${i}`, event_id: "evA", x_user_id: xId,
        display_name: xId, permission_preset: "public_staff",
      });
    };
    for (let i = 0; i < 255; i++) addStaff(i);
    const capStart = d1.stats.statements;
    const allowed = await loadManageVideoStatusSnapshot(db, manager, "evA", "v1");
    assert.equal(allowed.ok, true, "256 joined rows allow a complete authorized video snapshot");
    assert.equal(allowed.video.id, "v1");
    assert.equal(d1.stats.statements - capStart, 2);
    addStaff(255);
    const overflowStart = d1.stats.statements;
    await assert.rejects(
      loadManageVideoStatusSnapshot(db, manager, "evA", "v1"),
      /manage_video_status_staff_read_limit_exceeded/,
    );
    assert.equal(d1.stats.statements - overflowStart, 1,
      "overflow aborts before any association/full-video read");
    assert.equal(d1.stats.batches, 0);
    assert.equal(d1.stats.writes, 0);
  } finally {
    sqlite.close();
  }
});

test("MIG-0603: same association SELECT includes bounded rebuild event targets", async () => {
  assert.equal(MAX_MANAGE_STATUS_REBUILD_EVENTS, MAX_VIDEO_STATUS_REBUILD_EVENT_TARGETS,
    "preload cap must match the CURRENT rebuild queue cap");
  const sqlite = createSqlite();
  try {
    seed(sqlite);
    const d1 = createVideoStatusD1(sqlite);
    const db = drizzle(d1, { schema });
    const manager = { id: "u_mgr", role: "user" };

    const before = d1.stats.statements;
    const baseline = await loadManageVideoStatusSnapshot(db, manager, "evA", "v1");
    assert.equal(baseline.ok, true);
    assert.deepEqual(baseline.rebuildEventIds, ["evA"]);
    assert.equal(d1.stats.statements - before, 2,
      "permission and exact association+rebuild projection use only two D1 statements");

    // Valid references other than the selected manage event must still be
    // included in the rebuild fan-out, like CURRENT's linkedEventIds loader.
    const extra = ["evB", "evC", "evD", "evNull", "evPoint", "evTie1", "evTie2"];
    for (const eventId of extra) {
      insert(sqlite, "video_events", { video_id: "v1", event_id: eventId });
    }
    const capStart = d1.stats.statements;
    const max = await loadManageVideoStatusSnapshot(db, manager, "evA", "v1");
    assert.equal(max.ok, true);
    assert.deepEqual(max.rebuildEventIds, ["evA", ...extra].sort(),
      "the complete eight target event IDs are preloaded in deterministic order");
    assert.equal(d1.stats.statements - capStart, 2);

    insert(sqlite, "video_events", { video_id: "v1", event_id: "evGen19" });
    const overflowStart = d1.stats.statements;
    assert.deepEqual(
      await loadManageVideoStatusSnapshot(db, manager, "evA", "v1"),
      { ok: false, message: "関連イベント数が処理上限を超えています。" },
      "a ninth link fails closed instead of dropping a queue rebuild target",
    );
    assert.equal(d1.stats.statements - overflowStart, 2,
      "overflow needs no extra D1 round trip");
    assert.equal(d1.stats.batches, 0);
    assert.equal(d1.stats.writes, 0);
  } finally {
    sqlite.close();
  }
});

test("MIG-0603: unmounted admin status preloads video and capped rebuild events in one D1 read", async () => {
  const sqlite = createSqlite();
  try {
    seed(sqlite);
    const d1 = createVideoStatusD1(sqlite);
    const db = drizzle(d1, { schema });
    const admin = { id: "u_admin", role: "admin" };

    const deniedStart = d1.stats.statements;
    assert.deepEqual(
      await loadAdminVideoStatusSnapshot(db, { id: "u_mgr", role: "user" }, "v1"),
      { ok: false, message: "管理者権限が必要です。" },
    );
    assert.equal(d1.stats.statements - deniedStart, 0,
      "a non-admin cannot probe video existence before the role guard");

    const baselineStart = d1.stats.statements;
    const baseline = await loadAdminVideoStatusSnapshot(db, admin, "v1");
    assert.equal(baseline.ok, true);
    assert.equal(baseline.video.id, "v1");
    assert.deepEqual(baseline.rebuildEventIds, ["evA"]);
    assert.equal(d1.stats.statements - baselineStart, 1,
      "admin preloads video + all linked event IDs in one D1 statement");

    const missingStart = d1.stats.statements;
    assert.deepEqual(
      await loadAdminVideoStatusSnapshot(db, admin, "deleted-video"),
      { ok: false, message: "対象作品が見つかりません。" },
    );
    assert.equal(d1.stats.statements - missingStart, 1);

    const extra = ["evB", "evC", "evD", "evNull", "evPoint", "evTie1", "evTie2"];
    for (const eventId of extra) {
      insert(sqlite, "video_events", { event_id: eventId, video_id: "v1" });
    }
    const cappedStart = d1.stats.statements;
    const capped = await loadAdminVideoStatusSnapshot(db, admin, "v1");
    assert.equal(capped.ok, true);
    assert.deepEqual(capped.rebuildEventIds, ["evA", ...extra].sort());
    assert.equal(d1.stats.statements - cappedStart, 1);

    sqlite.prepare("UPDATE videos SET primary_event_id=? WHERE id='v1'")
      .run("evGen19");
    const primaryOverflowStart = d1.stats.statements;
    assert.deepEqual(
      await loadAdminVideoStatusSnapshot(db, admin, "v1"),
      { ok: false, message: "関連イベント数が処理上限を超えています。" },
      "the extra primary_event_id outside linked events is an overflow, not silently dropped",
    );
    assert.equal(d1.stats.statements - primaryOverflowStart, 1);
    assert.equal(d1.stats.batches, 0);
    assert.equal(d1.stats.writes, 0);
  } finally {
    sqlite.close();
  }
});

test("MIG-0603: status snapshot rejects oversized primary event ID even when linked JSON is tiny", async () => {
  const sqlite = createSqlite();
  try {
    seed(sqlite);
    const d1 = createVideoStatusD1(sqlite);
    const db = drizzle(d1, { schema });
    // FK enforcement is deliberately off in the real import/recovery SQLite
    // fixture. The links remain valid but primary_event_id alone is oversized.
    sqlite.prepare("UPDATE videos SET primary_event_id=? WHERE id='v1'")
      .run("evt-" + "x".repeat(5000));
    const cases = [
      [{ id: "u_admin", role: "admin" }, 1, loadAdminVideoStatusSnapshot],
      [{ id: "u_mgr", role: "user" }, 2, (db, user) =>
        loadManageVideoStatusSnapshot(db, user, "evA", "v1")],
    ];
    for (const [user, expectedReads, load] of cases) {
      const before = d1.stats.statements;
      await assert.rejects(
        load(db, user, "v1"),
        /manage_status_rebuild_event_snapshot_invalid/,
        "oversized primary_event_id must fail closed before a status planner can enqueue its target",
      );
      assert.equal(d1.stats.statements - before, expectedReads,
        "rejecting a large primary ID needs no additional D1 read");
    }
    sqlite.prepare("UPDATE videos SET primary_event_id=NULL WHERE id='v1'").run();
    const recovered = await loadAdminVideoStatusSnapshot(db, { id: "u_admin", role: "admin" }, "v1");
    assert.equal(recovered.ok, true);
    assert.deepEqual(recovered.rebuildEventIds, ["evA"],
      "ordinary linked status snapshot remains available after data repair");
    assert.equal(d1.stats.writes, 0, "read-only Hono D1 adapter did not mutate records");
    assert.equal(d1.stats.batches, 0);
  } finally {
    sqlite.close();
  }
});

test("MIG-0603: combined primary and linked snapshot JSON must fit the atomic 4096-byte bound", async () => {
  const sqlite = createSqlite();
  try {
    seed(sqlite);
    sqlite.exec('UPDATE "user" SET is_tos_accepted=1');
    enableStatusCostGuard(sqlite);
    const d1 = createVideoStatusD1(sqlite);
    const db = drizzle(d1, { schema });
    const admin = { id: "u_admin", role: "admin" };
    const manager = { id: "u_mgr", role: "user" };
    const primary = "primary-" + "p".repeat(2290);
    const linked = "linked-" + "l".repeat(2290);
    // The linked JSON and primary ID are EACH within the 4096-byte input
    // bound, yet the canonical combined snapshot exceeds the SAME JSON bind
    // bound enforced at the commit-time atomic SQL assertion.
    assert.ok(Buffer.byteLength(JSON.stringify(["evA", linked]), "utf8") <= 4096);
    assert.ok(Buffer.byteLength(primary, "utf8") <= 4096);
    assert.ok(Buffer.byteLength(JSON.stringify([primary, "evA", linked]), "utf8") > 4096);
    sqlite.prepare("UPDATE videos SET primary_event_id=? WHERE id='v1'").run(primary);
    sqlite.prepare("INSERT INTO video_events (video_id,event_id) VALUES ('v1',?)").run(linked);
    for (const [tag, load, reads] of [
      ["admin", () => loadAdminVideoStatusSnapshot(db, admin, "v1"), 1],
      ["manager", () => loadManageVideoStatusSnapshot(db, manager, "evA", "v1"), 2],
    ]) {
      const start = d1.stats.statements;
      await assert.rejects(load(), /manage_status_rebuild_event_snapshot_invalid/,
        tag + ": never return ok:true when exact atomic rebuild JSON cannot be bound");
      assert.equal(d1.stats.statements - start, reads,
        tag + ": combined size failure must add no route-wide D1 query");
    }
    assert.equal(d1.stats.batches, 0, "invalid preloads never start a mutation batch");
    assert.equal(d1.stats.writes, 0, "invalid preloads are strictly read only");

    // Repair only the independent primary field: the original linked target
    // stays large but the combined frozen array is again within the cap.
    const repairedPrimary = "primary-" + "p".repeat(1100);
    sqlite.prepare("UPDATE videos SET primary_event_id=? WHERE id='v1'").run(repairedPrimary);
    const expected = [repairedPrimary, "evA", linked];
    assert.ok(Buffer.byteLength(JSON.stringify(expected), "utf8") <= 4096);
    const adminSnapshot = await loadAdminVideoStatusSnapshot(db, admin, "v1");
    const managerSnapshot = await loadManageVideoStatusSnapshot(db, manager, "evA", "v1");
    assert.deepEqual(adminSnapshot.rebuildEventIds, expected,
      "admin snapshot retains the complete, bounded rebuild set");
    assert.deepEqual(managerSnapshot.rebuildEventIds, expected,
      "manager snapshot retains the complete, bounded rebuild set");
    await db.batch([
      planAdminVideoStatusCommitAssertion(db, admin, "v1", "tok-admin", adminSnapshot.rebuildEventIds),
    ].map(stmt => preparedStatusTestBatchItem(db, stmt)));
    await db.batch([
      planManageVideoStatusCommitAssertion(db, manager, "evA", "v1", "tok-mgr",
        "manage_video_status", managerSnapshot.rebuildEventIds),
    ].map(stmt => preparedStatusTestBatchItem(db, stmt)));
    assert.ok(d1.stats.maxBinds <= 100, "the complete snapshot uses bounded bind count");
  } finally {
    sqlite.close();
  }
});


test("MIG-0603: commit-time status authorization assertion rolls back on revoked grant or link", async () => {
  const cases = [
    ["approved X revoked", (sqlite) =>
      sqlite.exec("UPDATE x_users SET approval_status='rejected' WHERE id='mgr_x'")],
    ["event staff preset revoked", (sqlite) =>
      sqlite.exec("UPDATE event_staff SET permission_preset='public_staff' WHERE event_id='evA' AND x_user_id='mgr_x'")],
    ["X account link deleted", (sqlite) =>
      sqlite.exec("DELETE FROM x_user_account_links WHERE auth_user_id='u_mgr'")],
    ["video-event association deleted", (sqlite) =>
      sqlite.exec("DELETE FROM video_events WHERE video_id='v1' AND event_id='evA'")],
    ["event deleted with orphan association", (sqlite) =>
      sqlite.exec("DELETE FROM events WHERE id='evA'")],
    ["custom grant revoked", (sqlite) =>
      sqlite.exec("UPDATE event_staff SET custom_permission_keys_json='[]' WHERE event_id='evA' AND x_user_id='custom_x'")],
    ["custom grant malformed", (sqlite) =>
      sqlite.exec("UPDATE event_staff SET custom_permission_keys_json='{broken' WHERE event_id='evA' AND x_user_id='custom_x'")],
    ["actor banned after preflight", (sqlite) =>
      sqlite.exec("UPDATE user SET is_banned=1 WHERE id='u_mgr'")],
    ["site-admin role revoked after preflight", (sqlite) =>
      sqlite.exec("UPDATE user SET role='user' WHERE id='u_admin'")],
    ["site-admin banned after preflight", (sqlite) =>
      sqlite.exec("UPDATE user SET is_banned=1 WHERE id='u_admin'")],
    ["actor TOS acceptance withdrawn after preflight", (sqlite) =>
      sqlite.exec("UPDATE user SET is_tos_accepted=0 WHERE id='u_mgr'")],
    ["site-admin TOS acceptance cleared after preflight", (sqlite) =>
      sqlite.exec("UPDATE user SET is_tos_accepted=NULL WHERE id='u_admin'")],
    ["session revoked after preflight", (sqlite) =>
      sqlite.exec("DELETE FROM session WHERE sessionToken='tok-mgr'")],
    ["session expired after preflight", (sqlite) =>
      sqlite.exec("UPDATE session SET expires=0 WHERE sessionToken='tok-mgr'")],
    ["session reassigned to another actor", (sqlite) =>
      sqlite.exec("UPDATE session SET userId='u_plain' WHERE sessionToken='tok-mgr'")],
    ["site-admin session revoked after preflight", (sqlite) =>
      sqlite.exec("DELETE FROM session WHERE sessionToken='tok-admin'")],
  ];
  for (const [description, revoke] of cases) {
    const sqlite = createSqlite();
    try {
      seed(sqlite);
      // The shared seed defaults to TOS=0; model a legitimate write preflight.
      sqlite.exec('UPDATE "user" SET is_tos_accepted=1');
      enableStatusCostGuard(sqlite);
      const d1 = createVideoStatusD1(sqlite);
      const db = drizzle(d1, { schema });
      const custom = description.startsWith("custom");
      const admin = description.startsWith("site-admin");
      const user = admin ? { id: "u_admin", role: "admin" } : custom
        ? { id: "u_custom", role: "user" }
        : { id: "u_mgr", role: "user" };
      if (custom) {
        sqlite.exec(`UPDATE event_staff
          SET custom_permission_keys_json='["video.status"]'
          WHERE event_id='evA' AND x_user_id='custom_x'`);
      }
      // Characterize the TOCTOU scenario: legitimate BEFORE preflight grants.
      const preliminary = await loadManageVideoStatusSnapshot(db, user, "evA", "v1");
      assert.equal(preliminary.ok, true, description + " preflight was legitimately allowed");

      // Interleaved SQL mutation by another caller, AFTER our preflight.
      revoke(sqlite);
      const guard = planManageVideoStatusCommitAssertion(
        db, user, "evA", "v1", `tok-${user.id.slice(2)}`, "manage_video_status", ["evA"],
      );
      const update = db.run(sql`UPDATE videos
        SET visibility_status = 'public' WHERE id = 'v1'`);
      const audit = db.run(sql`INSERT INTO audit_logs
        (id, table_name, target_id, operation, actor_user_id, created_at)
        VALUES ('commit-guard-audit', 'videos', 'v1', 'UPDATE', ${user.id}, 1000)`);
      const outbox = db.run(sql`INSERT INTO notification_outbox
        (id, type, payload_json, status, created_at)
        VALUES ('commit-guard-outbox', 'video_posted', '{}', 'pending', 1000)`);
      const start = d1.stats.statements;
      await assert.rejects(db.batch([guard, update, audit, outbox].map((stmt) => preparedStatusTestBatchItem(db, stmt))),
        /malformed JSON|not-valid-json/,
        description + " must abort the *whole* D1 batch before status/audit/outbox writes");
      assert.equal(d1.stats.statements - start, 1,
        description + " guard rejects in the first D1 batch statement");
      assert.equal(sqlite.prepare("SELECT visibility_status FROM videos WHERE id='v1'").get().visibility_status,
        "pending", description + " must not mutate video status");
      assert.equal(sqlite.prepare("SELECT count(*) AS n FROM audit_logs WHERE id='commit-guard-audit'").get().n, 0);
      assert.equal(sqlite.prepare("SELECT count(*) AS n FROM notification_outbox WHERE id='commit-guard-outbox'").get().n, 0);
    } finally {
      sqlite.close();
    }
  }
});

test("MIG-0603: commit-time status assertion accepts current canonical preset and custom grants", async () => {
  for (const [name, user, custom] of [
    ["manager", { id: "u_mgr", role: "user" }, false],
    ["reviewer", { id: "u_rev", role: "user" }, false],
    ["owner", { id: "u_owner", role: "user" }, false],
    ["custom", { id: "u_custom", role: "user" }, true],
    ["site admin", { id: "u_admin", role: "admin" }, false],
  ]) {
    const sqlite = createSqlite();
    try {
      seed(sqlite);
      sqlite.exec('UPDATE "user" SET is_tos_accepted=1');
      enableStatusCostGuard(sqlite);
      if (custom) sqlite.exec(`UPDATE event_staff SET custom_permission_keys_json='["video.status"]'
        WHERE event_id='evA' AND x_user_id='custom_x'`);
      const d1 = createVideoStatusD1(sqlite);
      const db = drizzle(d1, { schema });
      const prior = await loadManageVideoStatusSnapshot(db, user, "evA", "v1");
      assert.equal(prior.ok, true, name);
      const initial = d1.stats.statements;
      await db.batch([
        planManageVideoStatusCommitAssertion(db, user, "evA", "v1", `tok-${user.id.slice(2)}`, "manage_video_status", ["evA"]),
        db.run(sql`UPDATE videos SET visibility_status='public' WHERE id='v1'`),
      ].map((stmt) => preparedStatusTestBatchItem(db, stmt)));
      assert.equal(d1.stats.statements - initial, 2,
        name + ": assertion + update happen in one D1 batch with no additional preflight reads");
      assert.equal(d1.stats.batches, 1);
      assert.equal(sqlite.prepare("SELECT visibility_status FROM videos WHERE id='v1'").get().visibility_status,
        "public");
    } finally {
      sqlite.close();
    }
  }
});


test("MIG-0603: multibyte imported event IDs cannot bypass the 4096-byte rebuild snapshot bound", async () => {
  const sqlite = createSqlite();
  try {
    seed(sqlite);
    const d1 = createVideoStatusD1(sqlite);
    const db = drizzle(d1, { schema });
    const admin = { id: "u_admin", role: "admin" };
    const manager = { id: "u_mgr", role: "user" };
    const overlong = "雪".repeat(1500);
    assert.ok(overlong.length < 4096 && Buffer.byteLength(overlong, "utf8") > 4096,
      "UTF-16 character count alone misses this malformed imported ID");

    // An unrelated primary ID is not included in the linked-event JSON.
    sqlite.prepare("UPDATE videos SET primary_event_id=? WHERE id='v1'").run(overlong);
    const first = d1.stats.statements;
    await assert.rejects(loadAdminVideoStatusSnapshot(db, admin, "v1"),
      /manage_status_rebuild_event_snapshot_invalid/);
    assert.equal(d1.stats.statements - first, 1, "admin rejection uses only one read");
    sqlite.prepare("UPDATE videos SET primary_event_id=NULL WHERE id='v1'").run();

    // A long linked event ID is independently embedded in SQLite's JSON
    // aggregate. Keep the canonical selected evA link and deny oversize.
    sqlite.exec("PRAGMA foreign_keys=OFF");
    sqlite.prepare("INSERT INTO video_events (event_id, video_id) VALUES (?, ?)")
      .run(overlong, "v1");
    const second = d1.stats.statements;
    await assert.rejects(loadManageVideoStatusSnapshot(db, manager, "evA", "v1"),
      /manage_status_rebuild_event_snapshot_invalid/);
    assert.equal(d1.stats.statements - second, 2, "manager denial adds no preflight reads");
    assert.equal(d1.stats.batches, 0, "failed preloads never start an audited transaction");
    assert.equal(d1.stats.writes, 0, "preload itself performs no D1 writes");
  } finally {
    sqlite.close();
  }
});


test("MIG-0603: atomic status grant matches Hono latest-major reacceptance fail-closed", async () => {
  const sqlite = createSqlite();
  try {
    seed(sqlite);
    sqlite.exec('UPDATE "user" SET is_tos_accepted=1');
    enableStatusCostGuard(sqlite);
    const d1 = createVideoStatusD1(sqlite);
    const db = drizzle(d1, { schema });
    const manager = { id: "u_mgr", role: "user" };
    assert.equal((await loadManageVideoStatusSnapshot(db, manager, "evA", "v1")).ok, true,
      "legitimate granted preflight before any change to the published major rules");

    const published = (id, severity, at) => insert(sqlite, "terms_versions", {
      id, version_label: id, body_markdown: "terms " + id, status: "published",
      severity, published_at: at, created_by_user_id: "u_admin",
      created_at: at, updated_at: at,
    });
    let attempt = 0;
    async function check(shouldAllow, description) {
      const tos = await loadTosState(d1, manager.id);
      assert.ok(tos, "real shared Hono TOS-state read returned a user");
      assert.equal(tos.terms_reaccept_required, shouldAllow ? 0 : 1,
        description + ": reference Hono major-version consent policy");

      const suffix = ++attempt;
      const auditId = "atomic-terms-audit-" + suffix;
      const outboxId = "atomic-terms-outbox-" + suffix;
      const batch = [
        planManageVideoStatusCommitAssertion(db, manager, "evA", "v1", "tok-mgr", "manage_video_status", ["evA"]),
        db.run(sql`UPDATE videos SET visibility_status='public' WHERE id='v1'`),
        db.run(sql`INSERT INTO audit_logs
          (id, table_name, target_id, operation, actor_user_id, created_at)
          VALUES (${auditId}, 'videos', 'v1', 'UPDATE', 'u_mgr', 1000)`),
        db.run(sql`INSERT INTO notification_outbox
          (id, type, payload_json, status, created_at)
          VALUES (${outboxId}, 'video_posted', '{}', 'pending', 1000)`),
      ].map((stmt) => preparedStatusTestBatchItem(db, stmt));
      const start = d1.stats.statements;
      if (shouldAllow) {
        await db.batch(batch);
        assert.equal(d1.stats.statements - start, 4, description + ": one atomic assertion + three writes");
      } else {
        await assert.rejects(db.batch(batch), /malformed JSON|not-valid-json/,
          description + ": a late rule revocation must roll back the whole D1 batch");
        assert.equal(d1.stats.statements - start, 1, description + ": fail at first batch assertion");
      }
      assert.equal(sqlite.prepare("SELECT visibility_status FROM videos WHERE id='v1'").get().visibility_status,
        shouldAllow ? "public" : "pending", description + ": video status");
      assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE id=?").get(auditId).n,
        shouldAllow ? 1 : 0, description + ": no unaudited mutation");
      assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM notification_outbox WHERE id=?").get(outboxId).n,
        shouldAllow ? 1 : 0, description + ": no leaked notification");
      // Reset using the fixture's direct SQLite connection, not a candidate D1 API.
      sqlite.exec("UPDATE videos SET visibility_status='pending'");
    }

    await check(true, "no published major requires no reacceptance");
    // GitHub Actions #44648501552 proved Hono loadTosState REQUIRES consent
    // when published_at=0. CURRENT's termsReacceptRequiredCondition uses a
    // falsy check and differs; reject at commit to avoid bypassing Hono auth.
    published("major-epoch-zero", "major", 0);
    await check(false, "Hono requires reacceptance for non-NULL epoch-zero major publication");
    published("major-1", "major", 100);
    await check(false, "new major publication after previously granted preflight");
    sqlite.prepare("UPDATE user SET accepted_terms_version_id='major-1' WHERE id='u_mgr'").run();
    await check(true, "accepted-version mirror satisfies newest major");
    published("major-2", "major", 200);
    await check(false, "old accepted mirror cannot satisfy newly published major");
    insert(sqlite, "user_tos_consents", {
      id: "consent-major-1", user_id: "u_mgr",
      terms_version_id: "major-1", consented_at: 250, consent_context: "edit",
    });
    await check(false, "late consent timestamp does not upgrade an older terms version");
    insert(sqlite, "user_tos_consents", {
      id: "consent-major-2", user_id: "u_mgr",
      terms_version_id: "major-2", consented_at: 251, consent_context: "edit",
    });
    await check(true, "historical consent to the current major satisfies reacceptance");
    // With tied published_at, updated_at decides the latest once-published
    // major. Consent to an earlier equal-time ID is insufficient.
    published("major-2-reissued", "major", 200);
    sqlite.prepare("UPDATE terms_versions SET updated_at=205 WHERE id='major-2-reissued'").run();
    await check(false, "later updated major at same publish time requires its own consent");
    insert(sqlite, "user_tos_consents", {
      id: "consent-major-2-reissued", user_id: "u_mgr",
      terms_version_id: "major-2-reissued", consented_at: 252, consent_context: "edit",
    });
    await check(true, "consent to the newer equal-publication-time major is sufficient");
    // Published major remains authoritative even after archiving.
    sqlite.exec("UPDATE terms_versions SET status='archived' WHERE id='major-2-reissued'");
    await check(true, "archiving a once-published major does not change required consent");
    published("major-3", "major", 300);
    await check(false, "newer major revokes previous consent at commit");
    published("minor-4", "minor", 400);
    await check(false, "later minor publication alone cannot grant consent");
    sqlite.prepare("UPDATE user SET accepted_terms_version_id='minor-4' WHERE id='u_mgr'").run();
    await check(true, "explicit acceptance of a later-published minor also satisfies current major");
    sqlite.prepare("UPDATE user SET accepted_terms_version_id=NULL WHERE id='u_mgr'").run();
    await check(false, "removing later accepted mirror restores major reaccept requirement");

    assert.equal(d1.stats.maxBinds <= 100, true, "commit assertion keeps a bounded bind count");
  } finally {
    sqlite.close();
  }
});

test("MIG-0603: atomic CostGuard checks match Hono across mode, list and exception changes", async () => {
  const sqlite = createSqlite();
  try {
    seed(sqlite);
    sqlite.exec('UPDATE "user" SET is_tos_accepted=1');
    enableStatusCostGuard(sqlite);
    const d1 = createVideoStatusD1(sqlite);
    const db = drizzle(d1, { schema });
    const manager = { id: "u_mgr", role: "user" };
    const admin = { id: "u_admin", role: "admin" };
    assert.equal((await loadManageVideoStatusSnapshot(db, manager, "evA", "v1")).ok, true);
    const scenarios = [
      ["normal", null, null, null, true, true, "baseline normal"],
      ["economy", null, null, null, true, true, "economy"],
      ["read_only", null, null, null, false, false, "read only"],
      ["maintenance", null, null, null, false, false, "maintenance"],
      ["normal", '["manage_video_status"]', null, null, false, true, "disable manage only"],
      ["normal", '["admin_video_status"]', null, null, true, false, "disable admin only"],
      ["normal", '{bad', null, null, false, false, "bad disabled JSON"],
      ["normal", '["manage_video_status",5]', null, null, false, false, "nonstring disabled entry"],
      ["normal", '"manage_video_status"', null, null, false, false, "scalar disabled JSON"],
      ["normal", '["unknown_feature"]', null, null, false, false, "unknown disabled key"],
      ["normal", null, '{broken', 3600, false, false, "bad exception JSON"],
      ["normal", null, '["unknown_feature"]', 3600, false, false, "unknown exception key"],
      ["normal", null, '[5]', 3600, false, false, "nonstring exception"],
      // A manage-only disable does not block admin: the enabled exception is
      // a no-op for admin, which is still allowed by the normal policy.
      ["normal", '["manage_video_status"]', '["manage_video_status"]', 3600, true, true, "manage active exception leaves admin enabled"],
      ["normal", '["admin_video_status"]', '["manage_video_status"]', 3600, true, false, "manage exception cannot bypass separate admin disable"],
      ["normal", '{bad', '["manage_video_status"]', 3600, true, false, "valid manage exception overrides invalid disabled list only for its feature"],
      ["normal", '["manage_video_status"]', '["manage_video_status"]', -1, false, true, "expired manage exception still blocks only manage"],
      ["normal", JSON.stringify(Array(101).fill("manage_video_status")), null, null, false, false, "disabled feature list over 100 entries"],
      ["normal", null, JSON.stringify(Array(101).fill("manage_video_status")), 3600, false, false, "exception feature list over 100 entries"],
      ["maintenance", null, '["admin_video_status"]', 3600, false, true, "admin active exception overrides mode"],
      ["maintenance", null, '["manage_video_status"]', -1, false, false, "expired exception"],
      ["normal", null, '[]', 3600, true, true, "empty exception"],
    ];
    const now = Math.floor(Date.now()/1000);
    let idx = 0;
    for (const [mode, disabled, exceptions, delta, manageAllowed, adminAllowed, title] of scenarios) {
      const until = delta === null ? null : now + delta;
      sqlite.prepare(`UPDATE system_settings SET operation_mode=?,disabled_features_json=?,
        cost_guard_exception_features_json=?,cost_guard_exception_until=? WHERE id='default'`)
        .run(mode, disabled, exceptions, until);
      for (const [key,user,token,expected] of [
        ["manage_video_status", manager, "tok-mgr", manageAllowed],
        ["admin_video_status", admin, "tok-admin", adminAllowed],
      ]) {
        const reference = await evaluateCostGuardWithSettings(d1, key, now);
        assert.equal(reference.denied === null, expected,
          title + " " + key + ": actual shared Hono CostGuard");
        const auditId = "costguard-atomic-" + (++idx);
        const statements = [
          key === "admin_video_status"
            ? planAdminVideoStatusCommitAssertion(db,user,"v1",token,["evA"])
            : planManageVideoStatusCommitAssertion(db,user,"evA","v1",token,key,["evA"]),
          db.run(sql`UPDATE videos SET visibility_status='public' WHERE id='v1'`),
          db.run(sql`INSERT INTO audit_logs
            (id,table_name,target_id,operation,actor_user_id,created_at)
            VALUES (${auditId},'videos','v1','UPDATE',${user.id},1000)`),
        ].map(item=>preparedStatusTestBatchItem(db,item));
        const start = d1.stats.statements;
        if(expected) {
          await db.batch(statements);
          assert.equal(d1.stats.statements-start,3,title+": one atomic batch");
        } else {
          await assert.rejects(db.batch(statements),/malformed JSON|not-valid-json/,
            title+": first assertion must deny");
          assert.equal(d1.stats.statements-start,1,title+": abort before write");
        }
        assert.equal(sqlite.prepare("SELECT visibility_status FROM videos WHERE id='v1'").get().visibility_status,
          expected ? "public" : "pending", title+": status");
        assert.equal(sqlite.prepare("SELECT count(*) AS n FROM audit_logs WHERE id=?").get(auditId).n,
          expected ? 1 : 0,title+": audit");
        sqlite.exec("UPDATE videos SET visibility_status='pending'");
      }
    }
    assert.ok(d1.stats.maxBinds <= 100, "bind count remains bounded");
  } finally { sqlite.close(); }
});


test("MIG-0603: reviewer cannot borrow admin-only CostGuard feature to bypass disabled manage", async () => {
  const sqlite = createSqlite();
  try {
    seed(sqlite);
    sqlite.exec('UPDATE "user" SET is_tos_accepted=1');
    enableStatusCostGuard(sqlite);
    sqlite.prepare("UPDATE system_settings SET disabled_features_json=? WHERE id='default'")
      .run('["manage_video_status"]');
    const d1 = createVideoStatusD1(sqlite);
    const db = drizzle(d1, { schema });
    const manager = { id: "u_mgr", role: "user" };
    assert.equal((await loadManageVideoStatusSnapshot(db, manager, "evA", "v1")).ok, true);
    assert.equal((await evaluateCostGuardWithSettings(d1, "manage_video_status")).denied, "cost_guard_blocked");
    assert.equal((await evaluateCostGuardWithSettings(d1, "admin_video_status")).denied, null);
    const start = d1.stats.statements;
    await assert.rejects(db.batch([
      planManageVideoStatusCommitAssertion(db, manager, "evA", "v1", "tok-mgr", "admin_video_status", ["evA"]),
      db.run(sql`UPDATE videos SET visibility_status='public' WHERE id='v1'`),
      db.run(sql`INSERT INTO audit_logs
        (id,table_name,target_id,operation,actor_user_id,created_at)
        VALUES ('feature-confusion-audit','videos','v1','UPDATE','u_mgr',1000)`),
      db.run(sql`INSERT INTO notification_outbox
        (id,type,payload_json,status,created_at)
        VALUES ('feature-confusion-outbox','video_posted','{}','pending',1000)`),
    ].map(item => preparedStatusTestBatchItem(db, item))), /malformed JSON|not-valid-json/);
    assert.equal(d1.stats.statements-start, 1, "first batch assertion fails closed");
    assert.equal(sqlite.prepare("SELECT visibility_status FROM videos WHERE id='v1'").get().visibility_status,
      "pending");
    assert.equal(sqlite.prepare("SELECT count(*) n FROM audit_logs WHERE id='feature-confusion-audit'").get().n, 0);
    assert.equal(sqlite.prepare("SELECT count(*) n FROM notification_outbox WHERE id='feature-confusion-outbox'").get().n, 0);

    const admin = { id: "u_admin", role: "admin" };
    await db.batch([
      // The admin status route is global: eventId must be null and the
      // dedicated wrapper enforces that server-owned scope.
      planAdminVideoStatusCommitAssertion(db, admin, "v1", "tok-admin", ["evA"]),
      db.run(sql`UPDATE videos SET visibility_status='public' WHERE id='v1'`),
    ].map(item => preparedStatusTestBatchItem(db, item)));
    assert.equal(sqlite.prepare("SELECT visibility_status FROM videos WHERE id='v1'").get().visibility_status,
      "public", "the rightful global admin route remains allowed");
  } finally { sqlite.close(); }
});


test("MIG-0603: atomic grant fails closed when joined approved staff exceeds 256 after preload", async () => {
  const sqlite = createSqlite();
  try {
    seed(sqlite);
    sqlite.exec('UPDATE "user" SET is_tos_accepted=1');
    enableStatusCostGuard(sqlite);
    const d1 = createVideoStatusD1(sqlite);
    const db = drizzle(d1, { schema });
    const manager = { id: "u_mgr", role: "user" };
    function addStaff(i) {
      const xId = "commit_cap_x_" + i;
      insert(sqlite, "x_users", { id: xId, x_name: xId, approval_status: "approved" });
      insert(sqlite, "x_user_account_links", {
        x_user_id: xId, auth_user_id: "u_mgr", link_role: "manager",
      });
      insert(sqlite, "event_staff", {
        id: "commit_cap_staff_" + i, event_id: "evA", x_user_id: xId,
        display_name: xId, permission_preset: "public_staff",
      });
    }
    // The manager's canonical granting staff row plus 255 additional
    // approved-but-unprivileged rows is the *inclusive* valid preflight limit.
    for (let i = 0; i < 255; i++) addStaff(i);
    const snapshot = await loadManageVideoStatusSnapshot(db, manager, "evA", "v1");
    assert.equal(snapshot.ok, true, "256-row preload must accept the legitimate manager");
    const baselineStart = d1.stats.statements;
    await db.batch([
      planManageVideoStatusCommitAssertion(db, manager, "evA", "v1", "tok-mgr", "manage_video_status", ["evA"]),
      db.run(sql`UPDATE videos SET visibility_status='public' WHERE id='v1'`),
    ].map(item => preparedStatusTestBatchItem(db, item)));
    assert.equal(d1.stats.statements - baselineStart, 2, "cap check is inside the batch, not a new pre-read");
    assert.equal(sqlite.prepare("SELECT visibility_status FROM videos WHERE id='v1'").get().visibility_status,
      "public", "exactly 256 approved staff rows still allow the update");
    sqlite.exec("UPDATE videos SET visibility_status='pending'");

    // Another writer links the 257th approved staff row AFTER the successful
    // preload; the stale preflight grant must no longer authorize a mutation.
    addStaff(255);
    const deniedStart = d1.stats.statements;
    await assert.rejects(db.batch([
      planManageVideoStatusCommitAssertion(db, manager, "evA", "v1", "tok-mgr", "manage_video_status", ["evA"]),
      db.run(sql`UPDATE videos SET visibility_status='public' WHERE id='v1'`),
      db.run(sql`INSERT INTO audit_logs
        (id,table_name,target_id,operation,actor_user_id,created_at)
        VALUES ('staff-cap-audit','videos','v1','UPDATE','u_mgr',1000)`),
      db.run(sql`INSERT INTO notification_outbox
        (id,type,payload_json,status,created_at)
        VALUES ('staff-cap-outbox','video_posted','{}','pending',1000)`),
    ].map(item => preparedStatusTestBatchItem(db, item))), /malformed JSON|not-valid-json/,
    "257 joined staff rows must abort even while the original manager grant still exists");
    assert.equal(d1.stats.statements - deniedStart, 1,
      "staff fan-out overflow must reject in first atomic D1 batch statement");
    assert.equal(sqlite.prepare("SELECT visibility_status FROM videos WHERE id='v1'").get().visibility_status,
      "pending");
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE id='staff-cap-audit'").get().n, 0);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM notification_outbox WHERE id='staff-cap-outbox'").get().n, 0);
    assert.ok(d1.stats.maxBinds <= 100, "bounded nested count must not create unbounded bind lists");
  } finally {
    sqlite.close();
  }
});


test("MIG-0603: admin-only status guard handles unlinked video without event ID", async () => {
  const sqlite = createSqlite();
  try {
    seed(sqlite);
    sqlite.exec('UPDATE "user" SET is_tos_accepted=1');
    enableStatusCostGuard(sqlite);
    sqlite.exec("DELETE FROM video_events WHERE video_id='v1'");
    const d1 = createVideoStatusD1(sqlite);
    const db = drizzle(d1, { schema });
    const admin = { id: "u_admin", role: "admin" };
    const manager = { id: "u_mgr", role: "user" };
    const preload = await loadAdminVideoStatusSnapshot(db, admin, "v1");
    assert.equal(preload.ok, true);
    assert.deepEqual(preload.rebuildEventIds, []);

    const denied = [
      ["admin-manage-unlinked", planManageVideoStatusCommitAssertion(db, admin, "evA", "v1", "tok-admin", "manage_video_status", [])],
      ["admin-manage-null-event", planManageVideoStatusCommitAssertion(db, admin, null, "v1", "tok-admin", "manage_video_status", [])],
      ["nonadmin-admin-key", planAdminVideoStatusCommitAssertion(db, manager, "v1", "tok-mgr", [])],
      ["admin-video-missing", planAdminVideoStatusCommitAssertion(db, admin, "missing", "tok-admin", [])],
    ];
    for (const [description, guard] of denied) {
      const start = d1.stats.statements;
      await assert.rejects(db.batch([
        guard,
        db.run(sql`UPDATE videos SET visibility_status='public' WHERE id='v1'`),
        db.run(sql`INSERT INTO audit_logs
          (id,table_name,target_id,operation,actor_user_id,created_at)
          VALUES ('unlinked-deny-audit','videos','v1','UPDATE','u_admin',1000)`),
        db.run(sql`INSERT INTO notification_outbox
          (id,type,payload_json,status,created_at)
          VALUES ('unlinked-deny-outbox','video_posted','{}','pending',1000)`),
      ].map(item=>preparedStatusTestBatchItem(db,item))),
      /malformed JSON|not-valid-json/, description);
      assert.equal(d1.stats.statements-start, 1, description + ": first atomic guard fails");
      assert.equal(sqlite.prepare("SELECT visibility_status FROM videos WHERE id='v1'").get().visibility_status, "pending");
      assert.equal(sqlite.prepare("SELECT count(*) n FROM audit_logs WHERE id='unlinked-deny-audit'").get().n, 0);
      assert.equal(sqlite.prepare("SELECT count(*) n FROM notification_outbox WHERE id='unlinked-deny-outbox'").get().n, 0);
    }
    const start = d1.stats.statements;
    await db.batch([
      planAdminVideoStatusCommitAssertion(db, admin, "v1", "tok-admin", []),
      db.run(sql`UPDATE videos SET visibility_status='public' WHERE id='v1'`),
      db.run(sql`INSERT INTO audit_logs
        (id,table_name,target_id,operation,actor_user_id,created_at)
        VALUES ('unlinked-allow-audit','videos','v1','UPDATE','u_admin',1000)`),
      db.run(sql`INSERT INTO notification_outbox
        (id,type,payload_json,status,created_at)
        VALUES ('unlinked-allow-outbox','video_posted','{}','pending',1000)`),
    ].map(item=>preparedStatusTestBatchItem(db,item)));
    assert.equal(d1.stats.statements-start,4, "same atomic batch, no extra D1 pre-read");
    assert.equal(sqlite.prepare("SELECT visibility_status FROM videos WHERE id='v1'").get().visibility_status, "public");
    assert.equal(sqlite.prepare("SELECT count(*) n FROM audit_logs WHERE id='unlinked-allow-audit'").get().n, 1);
    assert.equal(sqlite.prepare("SELECT count(*) n FROM notification_outbox WHERE id='unlinked-allow-outbox'").get().n, 1);
    assert.ok(d1.stats.maxBinds <= 100);
  } finally { sqlite.close(); }
});


test("MIG-0603: ninth rebuild event added after valid preload aborts the atomic status write", async () => {
  const sqlite = createSqlite();
  try {
    seed(sqlite);
    sqlite.exec('UPDATE "user" SET is_tos_accepted=1');
    enableStatusCostGuard(sqlite);
    const d1 = createVideoStatusD1(sqlite);
    const db = drizzle(d1, { schema });
    const admin = { id: "u_admin", role: "admin" };
    const manager = { id: "u_mgr", role: "user" };
    const extraEvents = ["evB", "evC", "evD", "evNull", "evPoint", "evTie1", "evTie2"];
    for (const eventId of extraEvents) {
      insert(sqlite, "video_events", { video_id: "v1", event_id: eventId });
    }
    assert.equal((await loadManageVideoStatusSnapshot(db, manager, "evA", "v1")).ok, true,
      "inclusive eight-event manage preflight must be allowed");
    assert.equal((await loadAdminVideoStatusSnapshot(db, admin, "v1")).ok, true,
      "inclusive eight-event admin preflight must be allowed");

    async function attempt(user, feature, expectAllow, tag) {
      const guard = feature === "admin_video_status"
        ? planAdminVideoStatusCommitAssertion(db, user, "v1", "tok-admin", ["evA", ...extraEvents])
        : planManageVideoStatusCommitAssertion(db, user, "evA", "v1", "tok-mgr", "manage_video_status", ["evA", ...extraEvents]);
      const statusBefore = d1.stats.statements;
      const batch = [
        guard,
        db.run(sql`UPDATE videos SET visibility_status='public' WHERE id='v1'`),
        db.run(sql`INSERT INTO audit_logs
          (id,table_name,target_id,operation,actor_user_id,created_at)
          VALUES (${"event-cap-audit-"+tag},'videos','v1','UPDATE',${user.id},1000)`),
        db.run(sql`INSERT INTO notification_outbox
          (id,type,payload_json,status,created_at)
          VALUES (${"event-cap-outbox-"+tag},'video_posted','{}','pending',1000)`),
      ].map(item=>preparedStatusTestBatchItem(db,item));
      if(expectAllow) await db.batch(batch);
      else await assert.rejects(db.batch(batch), /malformed JSON|not-valid-json/,
        tag+": unexpected extra rebuild target must fail closed");
      assert.equal(d1.stats.statements-statusBefore, expectAllow?4:1,
        tag+": all decisions inside first atomic D1 batch; no fourth pre-read");
      assert.equal(sqlite.prepare("SELECT visibility_status FROM videos WHERE id='v1'").get().visibility_status,
        expectAllow ? "public":"pending");
      assert.equal(sqlite.prepare("SELECT count(*) n FROM audit_logs WHERE id=?").get("event-cap-audit-"+tag).n,
        expectAllow?1:0);
      assert.equal(sqlite.prepare("SELECT count(*) n FROM notification_outbox WHERE id=?").get("event-cap-outbox-"+tag).n,
        expectAllow?1:0);
      sqlite.exec("UPDATE videos SET visibility_status='pending'");
    }

    // An identical primary event does not increase the distinct fan-out.
    sqlite.prepare("UPDATE videos SET primary_event_id='evA' WHERE id='v1'").run();
    await attempt(manager,"manage_video_status",true,"manager-eight-with-duplicate-primary");
    await attempt(admin,"admin_video_status",true,"admin-eight-with-duplicate-primary");

    // CURRENT mergeVideoRebuildEventIds discards empty-string IDs. Imported
    // legacy data may have empty primary_event_id and a dangling empty link;
    // these are not ninth rebuild targets and must not cause a false deny.
    // The canonical preloader may see nine linked rows, but its deduped,
    // nonempty queue target set still has exactly eight valid event IDs.
    sqlite.exec("UPDATE videos SET primary_event_id='' WHERE id='v1'");
    insert(sqlite, "video_events", { video_id: "v1", event_id: "" });
    const emptyManager = await loadManageVideoStatusSnapshot(db, manager, "evA", "v1");
    const emptyAdmin = await loadAdminVideoStatusSnapshot(db, admin, "v1");
    assert.equal(emptyManager.ok, true);
    assert.equal(emptyAdmin.ok, true);
    assert.deepEqual([...emptyManager.rebuildEventIds].sort(),
      ["evA", ...extraEvents].sort(), "CURRENT drops imported empty linked/primary IDs");
    assert.deepEqual(emptyAdmin.rebuildEventIds, emptyManager.rebuildEventIds);
    await attempt(manager,"manage_video_status",true,"manager-eight-with-empty-import");
    await attempt(admin,"admin_video_status",true,"admin-eight-with-empty-import");
    sqlite.exec("DELETE FROM video_events WHERE video_id='v1' AND event_id=''");
    sqlite.exec("UPDATE videos SET primary_event_id='evA' WHERE id='v1'");

    // An importer/other writer adds ninth distinct link after accepted preflight.
    insert(sqlite, "video_events", { video_id: "v1", event_id: "evGen19" });

    // The empty imported link sorts before every real ID. If it consumes
    // the limited nine-row projection, the ninth REAL event is omitted and
    // the snapshot incorrectly reports only eight affected rebuild targets.
    // Reject this already-invalid preflight, not only the later batch.
    insert(sqlite, "video_events", { video_id: "v1", event_id: "" });
    const ninthWithEmptyManager = await loadManageVideoStatusSnapshot(db, manager, "evA", "v1");
    const ninthWithEmptyAdmin = await loadAdminVideoStatusSnapshot(db, admin, "v1");
    assert.deepEqual(ninthWithEmptyManager,
      { ok: false, message: "関連イベント数が処理上限を超えています。" },
      "empty imported event cannot hide the ninth real linked event from manager preflight");
    assert.deepEqual(ninthWithEmptyAdmin, ninthWithEmptyManager,
      "site-admin preflight must reject the same true nine-target overflow");
    sqlite.exec("DELETE FROM video_events WHERE video_id='v1' AND event_id=''");

    await attempt(manager,"manage_video_status",false,"manager-late-ninth-link");
    await attempt(admin,"admin_video_status",false,"admin-late-ninth-link");

    // Legacy imports with disabled foreign keys can contain unbounded dangling
    // event links. Even when the eighth/ninth IDs do not match the snapshot,
    // each branch must still reject in the FIRST atomic statement and leave
    // status/audit/outbox untouched rather than scanning every imported ID.
    sqlite.exec("PRAGMA foreign_keys=OFF");
    const manyLinks = sqlite.prepare("INSERT INTO video_events (event_id, video_id) VALUES (?, ?)");
    for (let i = 0; i < 64; i++) manyLinks.run("orphaned-overflow-" + i, "v1");
    await attempt(manager,"manage_video_status",false,"manager-import-overflow");
    await attempt(admin,"admin_video_status",false,"admin-import-overflow");
    sqlite.exec("DELETE FROM video_events WHERE event_id LIKE 'orphaned-overflow-%'");
    sqlite.exec("PRAGMA foreign_keys=ON");

    // Remove the ninth link; a changed primary event alone can also create
    // an unseen ninth target, even though link count stays at eight.
    sqlite.exec("DELETE FROM video_events WHERE video_id='v1' AND event_id='evGen19'");
    sqlite.prepare("UPDATE videos SET primary_event_id='evGen19' WHERE id='v1'").run();
    await attempt(manager,"manage_video_status",false,"manager-late-ninth-primary");
    await attempt(admin,"admin_video_status",false,"admin-late-ninth-primary");
    assert.ok(d1.stats.maxBinds <= 100, "rebuild fan-out count keeps D1 binds bounded");
  } finally { sqlite.close(); }
});


test("MIG-0603: equal-cardinality rebuild event replacement after preload is rejected atomically", async () => {
  const sqlite = createSqlite();
  try {
    seed(sqlite);
    sqlite.exec('UPDATE "user" SET is_tos_accepted=1');
    enableStatusCostGuard(sqlite);
    insert(sqlite, "video_events", { video_id: "v1", event_id: "evB" });
    const d1 = createVideoStatusD1(sqlite);
    const db = drizzle(d1, { schema });
    const manager = { id: "u_mgr", role: "user" };
    const admin = { id: "u_admin", role: "admin" };
    const manageSnapshot = await loadManageVideoStatusSnapshot(db, manager, "evA", "v1");
    const adminSnapshot = await loadAdminVideoStatusSnapshot(db, admin, "v1");
    assert.equal(manageSnapshot.ok, true);
    assert.equal(adminSnapshot.ok, true);
    assert.deepEqual(manageSnapshot.rebuildEventIds, ["evA", "evB"]);
    assert.deepEqual(adminSnapshot.rebuildEventIds, manageSnapshot.rebuildEventIds);

    // This swap preserves TWO rebuild IDs and retains the granted evA link.
    // The previous <=8 assertion would have let an outdated queue proceed.
    sqlite.exec("DELETE FROM video_events WHERE video_id='v1' AND event_id='evB'");
    insert(sqlite, "video_events", { video_id: "v1", event_id: "evC" });
    assert.equal((await loadManageVideoStatusSnapshot(db, manager, "evA", "v1")).ok, true,
      "preflight remains permission-valid; only the rebuild set was replaced");
    async function attempt(actor, key, allow, tag) {
      const expected = ["evA", "evB"];
      const guard = key === "admin_video_status"
        ? planAdminVideoStatusCommitAssertion(db, actor, "v1", "tok-admin", expected)
        : planManageVideoStatusCommitAssertion(db, actor, "evA", "v1", "tok-mgr",
          "manage_video_status", expected);
      const auditId = "snapshot-swap-audit-" + tag;
      const outboxId = "snapshot-swap-outbox-" + tag;
      const before = d1.stats.statements;
      const batch = [
        guard,
        db.run(sql`UPDATE videos SET visibility_status='public' WHERE id='v1'`),
        db.run(sql`INSERT INTO audit_logs
          (id,table_name,target_id,operation,actor_user_id,created_at)
          VALUES (${auditId},'videos','v1','UPDATE',${actor.id},1000)`),
        db.run(sql`INSERT INTO notification_outbox
          (id,type,payload_json,status,created_at)
          VALUES (${outboxId},'video_posted','{}','pending',1000)`),
      ].map(stmt=>preparedStatusTestBatchItem(db,stmt));
      if (allow) await db.batch(batch);
      else await assert.rejects(db.batch(batch), /malformed JSON|not-valid-json/,
        tag+": must not commit an obsolete 2-ID rebuild snapshot");
      assert.equal(d1.stats.statements-before,allow?4:1,
        tag+": decision is inside first atomic batch statement");
      assert.equal(sqlite.prepare("SELECT visibility_status FROM videos WHERE id='v1'").get().visibility_status,
        allow?"public":"pending");
      assert.equal(sqlite.prepare("SELECT count(*) n FROM audit_logs WHERE id=?").get(auditId).n,allow?1:0);
      assert.equal(sqlite.prepare("SELECT count(*) n FROM notification_outbox WHERE id=?").get(outboxId).n,allow?1:0);
      sqlite.exec("UPDATE videos SET visibility_status='pending'");
    }
    await attempt(manager,"manage_video_status",false,"manager-swap");
    await attempt(admin,"admin_video_status",false,"admin-swap");

    // The stale queue would also be incomplete when the other writer simply
    // removes an association: permission to manage evA remains intact, but
    // the preloaded evB rebuild must no longer be considered current.
    sqlite.exec("DELETE FROM video_events WHERE video_id='v1' AND event_id='evC'");
    assert.equal((await loadManageVideoStatusSnapshot(db, manager, "evA", "v1")).ok, true,
      "the manager still has the exact evA grant after the unrelated link removal");
    await attempt(manager,"manage_video_status",false,"manager-link-removed");
    await attempt(admin,"admin_video_status",false,"admin-link-removed");

    insert(sqlite, "video_events", { video_id: "v1", event_id: "evB" });
    await attempt(manager,"manage_video_status",true,"manager-restored");
    await attempt(admin,"admin_video_status",true,"admin-restored");

    // Primary-event replacement is a separate race from link replacement.
    // The manager retains the exact evA grant and the combined target set
    // remains at TWO distinct IDs: evA + evB (preload) -> evA + evC (commit).
    // An unchanged cardinality must not authorize a stale rebuild plan.
    sqlite.exec("DELETE FROM video_events WHERE video_id='v1' AND event_id='evB'");
    sqlite.exec("UPDATE videos SET primary_event_id='evB' WHERE id='v1'");
    const primarySnapshot = await loadManageVideoStatusSnapshot(db, manager, "evA", "v1");
    const adminPrimarySnapshot = await loadAdminVideoStatusSnapshot(db, admin, "v1");
    assert.equal(primarySnapshot.ok, true);
    assert.equal(adminPrimarySnapshot.ok, true);
    assert.deepEqual([...primarySnapshot.rebuildEventIds].sort(), ["evA", "evB"]);
    assert.deepEqual([...adminPrimarySnapshot.rebuildEventIds].sort(), ["evA", "evB"]);
    sqlite.exec("UPDATE videos SET primary_event_id='evC' WHERE id='v1'");
    assert.equal((await loadManageVideoStatusSnapshot(db, manager, "evA", "v1")).ok, true,
      "the manager is still authorized; only the primary rebuild target changed");
    await attempt(manager,"manage_video_status",false,"manager-primary-swap");
    await attempt(admin,"admin_video_status",false,"admin-primary-swap");
    sqlite.exec("UPDATE videos SET primary_event_id='evB' WHERE id='v1'");
    await attempt(manager,"manage_video_status",true,"manager-primary-restored");
    await attempt(admin,"admin_video_status",true,"admin-primary-restored");

    assert.ok(d1.stats.maxBinds <= 100,"exact snapshot set check must use bounded JSON binds");
  } finally { sqlite.close(); }
});


test("MIG-0603: malformed frozen rebuild IDs cannot authorize an atomic status batch", async () => {
  const sqlite = createSqlite();
  try {
    seed(sqlite);
    sqlite.exec('UPDATE "user" SET is_tos_accepted=1');
    enableStatusCostGuard(sqlite);
    const d1 = createVideoStatusD1(sqlite);
    const db = drizzle(d1, { schema });
    const manager = { id: "u_mgr", role: "user" };
    const admin = { id: "u_admin", role: "admin" };
    assert.deepEqual((await loadManageVideoStatusSnapshot(db, manager, "evA", "v1")).rebuildEventIds, ["evA"]);
    assert.deepEqual((await loadAdminVideoStatusSnapshot(db, admin, "v1")).rebuildEventIds, ["evA"]);

    const incorrect = [
      ["missing", []],
      ["duplicate", ["evA", "evA"]],
      ["unexpected", ["evA", "evB"]],
      ["empty-id", ["evA", ""]],
      ["nine-ids", ["evA", "evB", "evC", "evD", "evE", "evF", "evG", "evH", "evI"]],
      // Under the 4096 UTF-16 code-unit cap but over 4096 UTF-8 bytes.
      ["oversized-utf8", ["evA", "漢".repeat(1800)]],
    ];
    for (const [actor, feature, token] of [
      [manager, "manage_video_status", "tok-mgr"],
      [admin, "admin_video_status", "tok-admin"],
    ]) {
      for (const [caseName, expected] of incorrect) {
        const tag = actor.id + "-" + caseName;
        const guard = feature === "admin_video_status"
          ? planAdminVideoStatusCommitAssertion(db, actor, "v1", token, expected)
          : planManageVideoStatusCommitAssertion(
              db, actor, "evA", "v1", token, feature, expected);
        const start = d1.stats.statements;
        await assert.rejects(db.batch([
          guard,
          db.run(sql`UPDATE videos SET visibility_status='public' WHERE id='v1'`),
          db.run(sql`INSERT INTO audit_logs
            (id,table_name,target_id,operation,actor_user_id,created_at)
            VALUES (${"invalid-snapshot-audit-" + tag},'videos','v1','UPDATE',${actor.id},1000)`),
          db.run(sql`INSERT INTO notification_outbox
            (id,type,payload_json,status,created_at)
            VALUES (${"invalid-snapshot-outbox-" + tag},'video_posted','{}','pending',1000)`),
        ].map(stmt => preparedStatusTestBatchItem(db, stmt))), /malformed JSON|not-valid-json/,
        tag + ": malformed/stale expected set must fail closed");
        assert.equal(d1.stats.statements - start, 1, tag + ": reject at first batch statement");
        assert.equal(sqlite.prepare("SELECT visibility_status FROM videos WHERE id='v1'").get().visibility_status,
          "pending", tag + ": video unchanged");
        assert.equal(sqlite.prepare("SELECT count(*) n FROM audit_logs WHERE id=?")
          .get("invalid-snapshot-audit-" + tag).n, 0, tag + ": audit unchanged");
        assert.equal(sqlite.prepare("SELECT count(*) n FROM notification_outbox WHERE id=?")
          .get("invalid-snapshot-outbox-" + tag).n, 0, tag + ": outbox unchanged");
      }
    }
    // A genuinely preloaded, unmodified snapshot still authorizes the same
    // first-assertion batch: deny tests must not be blanket-false positives.
    const start = d1.stats.statements;
    await db.batch([
      planManageVideoStatusCommitAssertion(db, manager, "evA", "v1", "tok-mgr",
        "manage_video_status", ["evA"]),
      db.run(sql`UPDATE videos SET visibility_status='public' WHERE id='v1'`),
    ].map(stmt => preparedStatusTestBatchItem(db, stmt)));
    assert.equal(d1.stats.statements - start, 2, "valid frozen IDs use the same atomic batch");
    assert.equal(sqlite.prepare("SELECT visibility_status FROM videos WHERE id='v1'").get().visibility_status,
      "public", "valid manager snapshot remains permitted");
    assert.ok(d1.stats.maxBinds <= 100, "untrusted/malformed snapshot inputs cannot exceed D1 binds");
  } finally {
    sqlite.close();
  }
});


test("MIG-0603: mismatched admin/global and manage/event scopes fail closed in first batch", async () => {
  const sqlite = createSqlite();
  try {
    seed(sqlite);
    sqlite.exec('UPDATE "user" SET is_tos_accepted=1');
    enableStatusCostGuard(sqlite);
    const d1 = createVideoStatusD1(sqlite);
    const db = drizzle(d1, { schema });
    const admin = { id: "u_admin", role: "admin" };
    assert.deepEqual((await loadAdminVideoStatusSnapshot(db, admin, "v1")).rebuildEventIds, ["evA"]);
    assert.deepEqual((await loadManageVideoStatusSnapshot(db, admin, "evA", "v1")).rebuildEventIds, ["evA"]);

    const mismatched = [
      ["admin-feature-with-event", "evA", "admin_video_status"],
      ["manage-feature-without-event", null, "manage_video_status"],
    ];
    for (const [tag, eventId, feature] of mismatched) {
      // Both carry a valid session, live admin identity, valid video and a
      // correct rebuild snapshot; only the server-selected route scope is wrong.
      const guard = planManageVideoStatusCommitAssertion(
        db, admin, eventId, "v1", "tok-admin", feature, ["evA"]);
      const start = d1.stats.statements;
      await assert.rejects(db.batch([
        guard,
        db.run(sql`UPDATE videos SET visibility_status='public' WHERE id='v1'`),
        db.run(sql`INSERT INTO audit_logs
          (id,table_name,target_id,operation,actor_user_id,created_at)
          VALUES (${"scope-mismatch-audit-" + tag},'videos','v1','UPDATE','u_admin',1000)`),
        db.run(sql`INSERT INTO notification_outbox
          (id,type,payload_json,status,created_at)
          VALUES (${"scope-mismatch-outbox-" + tag},'video_posted','{}','pending',1000)`),
      ].map(stmt => preparedStatusTestBatchItem(db, stmt))), /malformed JSON|not-valid-json/,
      tag + ": a mismatched trusted route scope must fail closed");
      assert.equal(d1.stats.statements - start, 1, tag + ": deny in first atomic assertion");
      assert.equal(sqlite.prepare("SELECT visibility_status FROM videos WHERE id='v1'").get().visibility_status,
        "pending");
      assert.equal(sqlite.prepare("SELECT count(*) n FROM audit_logs WHERE id=?")
        .get("scope-mismatch-audit-" + tag).n, 0);
      assert.equal(sqlite.prepare("SELECT count(*) n FROM notification_outbox WHERE id=?")
        .get("scope-mismatch-outbox-" + tag).n, 0);
    }
    for (const [tag, guard] of [
      ["admin-global", planAdminVideoStatusCommitAssertion(db, admin, "v1", "tok-admin", ["evA"])],
      ["admin-manage", planManageVideoStatusCommitAssertion(db, admin, "evA", "v1",
        "tok-admin", "manage_video_status", ["evA"])],
    ]) {
      sqlite.exec("UPDATE videos SET visibility_status='pending' WHERE id='v1'");
      const start = d1.stats.statements;
      await db.batch([guard, db.run(sql`UPDATE videos SET visibility_status='public' WHERE id='v1'`)]
        .map(stmt => preparedStatusTestBatchItem(db, stmt)));
      assert.equal(d1.stats.statements - start, 2, tag + ": correct route scope remains authorized");
      assert.equal(sqlite.prepare("SELECT visibility_status FROM videos WHERE id='v1'").get().visibility_status,
        "public");
    }
    assert.ok(d1.stats.maxBinds <= 100, "route-scope check uses bounded D1 parameters");
  } finally {
    sqlite.close();
  }
});
