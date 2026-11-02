import assert from "node:assert/strict";
import { test } from "node:test";
import { cookie, createD1, createSqlite, insert, runUnderRootTsx } from "./support/personalHarness.mjs";
import { NOW, seed } from "./support/manageSeed.mjs";

// Validate the real Hono endpoint, auth/session gate and current SQLite migrations.
// Important: the 101st staff row is deliberately absent from the visible list.
if (runUnderRootTsx(import.meta.url)) {
  const { app } = await import("../src/app.ts");

  function fixture() {
    const sqlite = createSqlite();
    seed(sqlite);
    return sqlite;
  }

  async function getStaff(sqlite, eventId) {
    const d1 = createD1(sqlite);
    const response = await app.request(
      "/api/manage/events/" + encodeURIComponent(eventId) + "/staff",
      { method: "GET", headers: cookie("tok-admin") },
      { DB: d1, AUTH_SECRET: "test-secret" },
    );
    const body = await response.json();
    assert.equal(response.status, 200, JSON.stringify(body));
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.equal(d1.stats.writes, 0, "GET must not write");
    assert.ok(d1.stats.statements <= 2, "admin GET: session + one page query");
    assert.ok(d1.stats.maxBinds <= 100, "D1 bound-parameter budget");
    assert.ok(JSON.stringify(body).length <= 64 * 1024, "response bytes remain bounded");
    return body;
  }

  test("all staff summary counts are exact when the visible list is truncated to 100", async () => {
    const sqlite = fixture();
    // Move every original evA staff row beyond the 100-row UI page by
    // inserting 101 alphabetically earlier rows. No extra X records needed.
    for (let i = 0; i < 101; i++) {
      insert(sqlite, "event_staff", {
        id: "extra-" + i,
        event_id: "evA",
        x_user_id: "unlinked-" + i,
        display_name: "A " + String(i).padStart(3, "0"),
        permission_preset: "public_staff",
        custom_permission_keys_json: null,
        is_public: 0,
        created_at: NOW,
        updated_at: NOW,
      });
    }
    insert(sqlite, "x_users", { id: "last-approved", x_name: "Last", approval_status: "approved" });
    insert(sqlite, "event_staff", {
      id: "last-owner", event_id: "evA", x_user_id: "last-approved",
      display_name: "Zzz owner after the cap",
      permission_preset: "owner", custom_permission_keys_json: null,
      is_public: 1, created_at: NOW, updated_at: NOW,
    });
    const actual = await getStaff(sqlite, "evA");
    assert.equal(actual.members.length, 100);
    assert.equal(actual.membersTruncated, true);
    assert.ok(!actual.members.some(row => row.id === "last-owner"));
    const expected = sqlite.prepare(
      `SELECT
        SUM(CASE WHEN staff.permission_preset = 'owner' THEN 1 ELSE 0 END) AS ownerCount,
        SUM(CASE WHEN staff.is_public = 1 THEN 1 ELSE 0 END) AS publicCount,
        SUM(CASE WHEN x.approval_status = 'approved' THEN 1 ELSE 0 END) AS approvedCount
       FROM event_staff staff LEFT JOIN x_users x ON x.id = staff.x_user_id
       WHERE staff.event_id = ?`,
    ).get("evA");
    assert.deepEqual(
      [actual.ownerCount, actual.publicCount, actual.approvedCount],
      [expected.ownerCount, expected.publicCount, expected.approvedCount],
    );
    assert.ok(actual.ownerCount > actual.members.filter(row => row.permission_preset === "owner").length);
    assert.ok(actual.publicCount > actual.members.filter(row => row.is_public === 1).length);
  });

  test("untruncated and empty events retain their CURRENT all-member counts", async () => {
    const sqlite = fixture();
    for (const eventId of ["evA", "evNull"]) {
      const actual = await getStaff(sqlite, eventId);
      assert.equal(actual.membersTruncated, false);
      assert.equal(actual.ownerCount, actual.members.filter(row => row.permission_preset === "owner").length);
      assert.equal(actual.publicCount, actual.members.filter(row => row.is_public === 1).length);
      // The API never returns the underlying approval_status, so check this
      // counter against the exact CURRENT join instead of sample client data.
      const approved = sqlite.prepare(
        "SELECT count(*) AS n FROM event_staff s INNER JOIN x_users x ON x.id = s.x_user_id WHERE s.event_id = ? AND x.approval_status = 'approved'",
      ).get(eventId).n;
      assert.equal(actual.approvedCount, approved);
    }
  });
}
