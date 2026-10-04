import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { runTestWithTsx } from "../testing/runTestWithTsx.mjs";

if (runTestWithTsx(import.meta.url)) {
  const { registerHooks } = await import("node:module");
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier === "server-only") {
        return { url: "data:text/javascript,export%20{}", shortCircuit: true };
      }
      return nextResolve(specifier, context);
    },
  });

  const { drizzle } = await import("drizzle-orm/sqlite-proxy");
  const {
    canEditVideo,
    canUseEventPrivilegeModeForVideo,
    resolveVideoEditAccessContext,
  } = await import("./ownership.ts");
  const { VIDEO_PERMISSION_ALIASES } = await import("./ownershipCore.ts");

  const SECTION_KEYS = Object.keys(VIDEO_PERMISSION_ALIASES);
  const user = { id: "auth-attacker", role: "user" };
  const approvedXUserIds = ["attacker_x"];
  const video = {
    id: "video-1",
    creator_x_user_id: "creator_x",
    primary_event_id: "event-1",
    submitted_by_user_id: "auth-creator",
    visibility_status: "public",
  };

  /** 発行した SQL を記録し、権限源ごとに読む行を確かめる。 */
  const queryLog = [];

  function makeDb(staffRows) {
    const sqlite = new DatabaseSync(":memory:");
    for (const name of readdirSync(new URL("../../../migrations", import.meta.url))
      .filter((entry) => entry.endsWith(".sql"))
      .sort()) {
      sqlite.exec(readFileSync(new URL(`../../../migrations/${name}`, import.meta.url), "utf8"));
    }
    sqlite.exec("PRAGMA foreign_keys = OFF");
    sqlite.prepare("INSERT INTO video_events (video_id, event_id) VALUES (?, ?)").run("video-1", "event-1");
    // access context を使わない経路は、承認済み X 名義をリンクから引く。
    sqlite.prepare("INSERT INTO x_users (id, x_name, approval_status) VALUES (?, ?, 'approved')").run("attacker_x", "attacker");
    sqlite.prepare("INSERT INTO x_user_account_links (x_user_id, auth_user_id) VALUES (?, ?)").run("attacker_x", user.id);
    staffRows.forEach((row, index) => {
      sqlite.prepare(`
        INSERT INTO event_staff (
          id, event_id, x_user_id, display_name, permission_preset,
          custom_permission_keys_json, is_public, public_role_label,
          approved_by_auth_user_id, approved_at, created_at, updated_at
        ) VALUES (?, ?, ?, 'staff', ?, ?, 0, NULL, NULL, NULL, 1, 1)
      `).run(`staff-${index}`, row.eventId, row.xUserId, row.preset, row.customJson ?? null);
    });
    return drizzle(async (sql, params, method) => {
      queryLog.push(sql);
      const statement = sqlite.prepare(sql);
      if (method === "run") {
        statement.run(...params);
        return { rows: [] };
      }
      const rows = statement.all(...params).map((row) => Object.values(row));
      return { rows: method === "get" ? rows[0] : rows };
    });
  }

  /** access context 経路と DB 経路を同じデータで評価する。 */
  async function evaluate(staffRows) {
    const db = makeDb(staffRows);
    const accessContext = await resolveVideoEditAccessContext({ db, user, video, approvedXUserIds });
    const result = {
      contextCanUseEvent: await canUseEventPrivilegeModeForVideo({ user, video, accessContext }),
      context: {},
      db: {},
    };
    for (const requiredKey of SECTION_KEYS) {
      result.context[requiredKey] = await canEditVideo({
        db, user, video, requiredKey, privilegeMode: "event", accessContext,
      });
      result.db[requiredKey] = await canEditVideo({
        db, user, video, requiredKey, privilegeMode: "event", approvedXUserIds,
      });
    }
    // DB 経路で event モードの section が 1 つでも編集できるか。
    result.dbCanUseEvent = SECTION_KEYS.some((requiredKey) => result.db[requiredKey]);
    return result;
  }

  test("event_staff 行の無い利用者は access context 経路でも event モードを使えない", async () => {
    for (const staffRows of [
      [],
      // 作品に紐づかないイベントの owner でも、この作品には使えない。
      [{ eventId: "event-2", xUserId: "attacker_x", preset: "owner" }],
      // 同じイベントでも別の X 名義の権限は使えない。
      [{ eventId: "event-1", xUserId: "someone_else", preset: "owner" }],
    ]) {
      const result = await evaluate(staffRows);
      assert.equal(result.contextCanUseEvent, false);
      assert.equal(result.dbCanUseEvent, false);
      for (const requiredKey of SECTION_KEYS) {
        assert.equal(result.context[requiredKey], false, requiredKey);
        assert.equal(result.db[requiredKey], false, requiredKey);
      }
    }
  });

  test("event モードの section 判定は access context 経路と DB 経路で一致する", async () => {
    const cases = [
      [{ eventId: "event-1", xUserId: "attacker_x", preset: "owner" }],
      [{ eventId: "event-1", xUserId: "attacker_x", preset: "content_editor" }],
      [{ eventId: "event-1", xUserId: "attacker_x", preset: "custom", customJson: '["video.members"]' }],
      [{ eventId: "event-1", xUserId: "attacker_x", preset: "custom", customJson: '["videos.title"]' }],
      [{ eventId: "event-1", xUserId: "attacker_x", preset: "custom", customJson: '["event.basic"]' }],
    ];
    for (const staffRows of cases) {
      const result = await evaluate(staffRows);
      assert.equal(result.contextCanUseEvent, result.dbCanUseEvent, JSON.stringify(staffRows));
      assert.deepEqual(result.context, result.db, JSON.stringify(staffRows));
    }
    const membersOnly = await evaluate(cases[2]);
    assert.equal(membersOnly.context["video.member_chapters"], true);
    assert.equal(membersOnly.context["video.chapter_admin"], false);
    assert.equal(membersOnly.context["video.basics"], false);
  });

  test("canEditVideo の DB 経路は権限源ごとに必要な行だけを読む", async () => {
    const db = makeDb([{ eventId: "event-1", xUserId: "attacker_x", preset: "owner" }]);
    const readsFor = async (args) => {
      queryLog.length = 0;
      const allowed = await canEditVideo({ db, video, requiredKey: "video.basics", ...args });
      return { allowed, sql: queryLog.join("\n") };
    };
    // admin はロールだけで決まり、行を読まない。
    const admin = await readsFor({ user: { id: user.id, role: "admin" }, privilegeMode: "admin" });
    assert.equal(admin.allowed, true);
    assert.equal(queryLog.length, 0);
    // event は event_staff だけで決まり、所有者 (video_members) や一般作品権限を読まない。
    const event = await readsFor({ user, privilegeMode: "event", approvedXUserIds });
    assert.equal(event.allowed, true);
    assert.match(event.sql, /"event_staff"/);
    assert.doesNotMatch(event.sql, /"video_members"|"events"|"system_settings"|"x_user_account_links"/);
    // normal の非所有者は一般作品権限を読まずに拒否する。
    const normal = await readsFor({ user, privilegeMode: "normal", approvedXUserIds });
    assert.equal(normal.allowed, false);
    assert.match(normal.sql, /"video_members"/);
    assert.doesNotMatch(normal.sql, /"event_staff"|"events"|"system_settings"|"x_user_account_links"/);
  });
}
