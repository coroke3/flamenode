import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import {
  enqueueSlotDeadlineReminders,
  REMINDER_GROUPS_SQL,
  REMINDER_INSERT_SQL,
} from "./reminders.ts";

const SITE = "https://flamenode.example";

function createSqlite() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`
    CREATE TABLE "user" (id TEXT PRIMARY KEY, is_notification_enabled INTEGER);
    CREATE TABLE events (
      id TEXT PRIMARY KEY, title TEXT, visibility_status TEXT,
      entry_start_time INTEGER, entry_end_time INTEGER
    );
    CREATE TABLE slots (
      id TEXT PRIMARY KEY, event_id TEXT, status TEXT, video_id TEXT,
      reserved_by_user_id TEXT
    );
    CREATE TABLE notification_outbox (
      id TEXT PRIMARY KEY NOT NULL,
      recipient_user_id TEXT,
      type TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      status TEXT DEFAULT 'pending'
        CHECK (status IN ('pending', 'processing', 'sent', 'failed', 'cancelled', 'dead_letter')),
      attempt_count INTEGER DEFAULT 0,
      processing_started_at INTEGER,
      lease_token TEXT,
      lease_expires_at INTEGER,
      next_attempt_at INTEGER,
      last_error TEXT,
      processed_at INTEGER,
      event_id TEXT,
      dedupe_key TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      FOREIGN KEY (recipient_user_id) REFERENCES "user"(id) ON DELETE RESTRICT
    );
    CREATE INDEX notification_outbox_dedupe_idx ON notification_outbox(dedupe_key);
    CREATE INDEX notification_outbox_status_dedupe_idx ON notification_outbox(status, dedupe_key);
    CREATE UNIQUE INDEX notification_outbox_active_dedupe_uniq
      ON notification_outbox(dedupe_key)
      WHERE dedupe_key IS NOT NULL AND status IN ('pending', 'processing', 'sent');
  `);
  return sqlite;
}

/** Minimal D1 shim: batch runs atomically like D1. */
function d1(sqlite, { beforeBatch } = {}) {
  const prepare = (sql) => {
    let values = [];
    const statement = {
      bind(...next) {
        values = next;
        return statement;
      },
      async all() {
        return { results: sqlite.prepare(sql).all(...values) };
      },
      runSync() {
        const info = sqlite.prepare(sql).run(...values);
        return { meta: { changes: Number(info.changes) } };
      },
      async run() {
        return statement.runSync();
      },
    };
    return statement;
  };
  return {
    prepare,
    async batch(statements) {
      beforeBatch?.();
      sqlite.exec("BEGIN");
      try {
        const results = statements.map((statement) => statement.runSync());
        sqlite.exec("COMMIT");
        return results;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    },
  };
}

function seedGroups(sqlite, count, deadline) {
  const user = sqlite.prepare(`INSERT INTO "user" VALUES (?, 1)`);
  const event = sqlite.prepare(`INSERT INTO events VALUES (?, ?, 'public', NULL, ?)`);
  const slot = sqlite.prepare(`INSERT INTO slots VALUES (?, ?, 'reserved', NULL, ?)`);
  event.run("event-1", "締切イベント", deadline);
  for (let i = 0; i < count; i += 1) {
    const userId = `user-${String(i).padStart(3, "0")}`;
    user.run(userId);
    slot.run(`slot-${i}`, "event-1", userId);
  }
}

function outboxCount(sqlite, status = null) {
  return Number(
    sqlite
      .prepare(
        `SELECT COUNT(*) AS n FROM notification_outbox ${status ? "WHERE status = ?" : ""}`,
      )
      .get(...(status ? [status] : [])).n,
  );
}

test("既にenqueue済みのgroupがLIMITを占有せず、51件目以降も次回runで通知される", async () => {
  const sqlite = createSqlite();
  seedGroups(sqlite, 60, Math.floor(Date.now() / 1000) + 3600);
  const env = { DB: d1(sqlite), NEXT_PUBLIC_SITE_URL: SITE };

  assert.equal(await enqueueSlotDeadlineReminders(env), 50);
  // 旧実装は同じ先頭50 groupを再選択し、UNIQUE違反だけで0件になっていた。
  assert.equal(await enqueueSlotDeadlineReminders(env), 10);
  assert.equal(await enqueueSlotDeadlineReminders(env), 0);
  assert.equal(outboxCount(sqlite), 60);
  sqlite.close();
});

test("sent/processingは除外し、failed/dead_letterはunique indexと同じく再enqueueできる", async () => {
  const sqlite = createSqlite();
  seedGroups(sqlite, 4, Math.floor(Date.now() / 1000) + 3600);
  const insert = sqlite.prepare(
    `INSERT INTO notification_outbox (id, recipient_user_id, type, payload_json, status, dedupe_key)
     VALUES (?, ?, 'slot_deadline_reminder', '{}', ?, ?)`,
  );
  const statuses = ["sent", "processing", "failed", "dead_letter"];
  statuses.forEach((status, i) => {
    const userId = `user-00${i}`;
    insert.run(`old-${i}`, userId, status, `slot_deadline_reminder:event-1:${userId}:24h`);
  });
  const env = { DB: d1(sqlite), NEXT_PUBLIC_SITE_URL: SITE };

  assert.equal(await enqueueSlotDeadlineReminders(env), 2);
  const pending = sqlite
    .prepare(`SELECT recipient_user_id FROM notification_outbox WHERE status = 'pending' ORDER BY 1`)
    .all()
    .map((row) => row.recipient_user_id);
  assert.deepEqual(pending, ["user-002", "user-003"]);
  sqlite.close();
});

test("select後に並行runが同じgroupをenqueueしてもbatch全体は失敗せず重複しない", async () => {
  const sqlite = createSqlite();
  seedGroups(sqlite, 3, Math.floor(Date.now() / 1000) + 3600);
  const env = {
    DB: d1(sqlite, {
      beforeBatch() {
        sqlite
          .prepare(
            `INSERT INTO notification_outbox (id, recipient_user_id, type, payload_json, status, dedupe_key)
             VALUES ('race', 'user-001', 'slot_deadline_reminder', '{}', 'pending',
                     'slot_deadline_reminder:event-1:user-001:24h')`,
          )
          .run();
      },
    }),
    NEXT_PUBLIC_SITE_URL: SITE,
  };

  assert.equal(await enqueueSlotDeadlineReminders(env), 2);
  assert.equal(outboxCount(sqlite, "pending"), 3);
  sqlite.close();
});

test("NOT EXISTSはdedupe_key indexでSEARCHされ、insertはpartial unique indexでconflictを吸収する", () => {
  const sqlite = createSqlite();
  const plan = sqlite
    .prepare(`EXPLAIN QUERY PLAN ${REMINDER_GROUPS_SQL}`)
    .all(0, 1, 50)
    .map((row) => row.detail)
    .join("\n");
  assert.match(plan, /SEARCH o USING (?:COVERING )?INDEX notification_outbox_\w*dedupe\w*/);
  assert.doesNotMatch(plan, /SCAN o\b/);

  sqlite.exec(`INSERT INTO "user" VALUES ('u', 1)`);
  const run = (id) =>
    Number(
      sqlite.prepare(REMINDER_INSERT_SQL).run(id, "u", "{}", "event-1", "k", 0).changes,
    );
  assert.equal(run("a"), 1);
  assert.equal(run("b"), 0);
  sqlite.close();
});
