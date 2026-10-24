// MIG-0617 L3: `preloaded` (settings / actorSnapshotJsonById) on the core audit preparation.
// Without it the core reads exactly as before; with it the entries are byte-identical and the
// matching reads are skipped. Runs on the real schema (all migrations on node:sqlite).
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "@flamenode/db/schema";
import { mutateWithAudit } from "@flamenode/server-core/audit/mutate";
import { actorSnapshotFromRow, prepareAuditLogEntries } from "@flamenode/server-core/audit/logger";
import { mapAuditSettings } from "@flamenode/server-core/audit/settings";
import { sql } from "@flamenode/server-core/sql";

const MIGRATIONS = new URL("../../../migrations/", import.meta.url);

function world() {
  const sqlite = new DatabaseSync(":memory:", { enableForeignKeyConstraints: false });
  for (const file of fs.readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort()) {
    sqlite.exec(fs.readFileSync(new URL(file, MIGRATIONS), "utf8"));
  }
  sqlite.exec("PRAGMA foreign_keys = OFF");
  sqlite.exec(`INSERT INTO "x_users" (id, x_name, icon_url, approval_status) VALUES ('x1', 'XN', 'https://i/x.png', 'approved')`);
  sqlite.exec(`INSERT INTO "user" (id, name, discord_id, role, is_banned, is_tos_accepted, active_x_user_id, image) VALUES ('admin-1', 'Admin', 'd-1', 'admin', 0, 1, 'x1', 'https://i/u.png')`);
  sqlite.exec("UPDATE system_settings SET audit_normal_retention_days = 45, audit_max_payload_bytes = 90000 WHERE id = 'default'");
  const stats = { reads: [], batches: 0 };
  const run = (text, params) => sqlite.prepare(text).all(...params).map((row) => ({ ...row }));
  const statement = (text, params) => ({
    __sql: text,
    __params: params,
    bind: (...values) => statement(text, values),
    async all() {
      stats.reads.push(text);
      return { results: run(text, params) };
    },
    async run() {
      return { results: run(text, params), success: true, meta: { changes: 0 } };
    },
    async raw() {
      stats.reads.push(text);
      const prepared = sqlite.prepare(text);
      prepared.setReturnArrays(true);
      try {
        return prepared.all(...params).map((row) => [...row]);
      } finally {
        prepared.setReturnArrays(false);
      }
    },
  });
  const d1 = {
    prepare: (text) => statement(text, []),
    async batch(statements) {
      stats.batches += 1;
      sqlite.exec("BEGIN");
      try {
        const results = statements.map((s) => ({ results: run(s.__sql, s.__params) }));
        sqlite.exec("COMMIT");
        return results;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    },
  };
  return { sqlite, stats, db: drizzle(d1, { schema }) };
}

function freeze() {
  let n = 0;
  const originalNow = Date.now;
  const originalUuid = globalThis.crypto.randomUUID;
  Date.now = () => 1_800_000_000_000;
  globalThis.crypto.randomUUID = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
  return () => {
    Date.now = originalNow;
    globalThis.crypto.randomUUID = originalUuid;
  };
}

const AUDIT = {
  table_name: "announcements",
  target_id: "a1",
  operation: "CREATE",
  before: null,
  after: { id: "a1", title: "日本語" },
  actor_user_id: "admin-1",
  retention_class: "normal",
  strict: true,
};

async function prepare(preloadedFrom) {
  const w = world();
  const restore = freeze();
  try {
    let preloaded;
    if (preloadedFrom) {
      const settingsRow = w.sqlite.prepare("SELECT * FROM system_settings WHERE id = 'default'").get();
      const actorRow = w.sqlite.prepare(`SELECT u.discord_id AS discord_id, u.name AS discord_name, u.active_x_user_id AS active_x_user_id,
        u.image AS user_image, x.x_name AS x_name, x.icon_url AS x_icon_url FROM "user" u LEFT JOIN x_users x ON x.id = u.active_x_user_id WHERE u.id = 'admin-1'`).get();
      preloaded = {};
      if (preloadedFrom !== "actor") preloaded.settings = mapAuditSettings(settingsRow);
      if (preloadedFrom !== "settings") preloaded.actorSnapshotJsonById = { "admin-1": JSON.stringify(actorSnapshotFromRow(actorRow)) };
    }
    const entries = await prepareAuditLogEntries(w.db, [AUDIT], preloaded);
    return { entries: JSON.stringify(entries), reads: w.stats.reads.length };
  } finally {
    restore();
  }
}

test("without preloaded the core reads settings and the actor (unchanged behaviour)", async () => {
  const self = await prepare(null);
  assert.equal(self.reads, 2);
  const [entry] = JSON.parse(self.entries);
  assert.equal(entry.expires_at - entry.created_at, 45 * 86400);
  assert.deepEqual(JSON.parse(entry.actor_snapshot_json), {
    discord_id: "d-1", discord_name: "Admin", x_user_id: "x1", x_name: "XN", icon_url: "https://i/x.png",
  });
});

test("preloaded settings + actor: entries are byte-identical and both reads are skipped", async () => {
  const self = await prepare(null);
  const both = await prepare("both");
  assert.equal(both.reads, 0);
  assert.equal(both.entries, self.entries);
});

test("preloaded settings only / actor only: only the other read remains, bytes unchanged", async () => {
  const self = await prepare(null);
  const settingsOnly = await prepare("settings");
  const actorOnly = await prepare("actor");
  assert.equal(settingsOnly.reads, 1);
  assert.equal(actorOnly.reads, 1);
  assert.equal(settingsOnly.entries, self.entries);
  assert.equal(actorOnly.entries, self.entries);
});

test("actorSnapshotFromRow: missing user is the empty snapshot, image fallback order is x icon then user image", () => {
  assert.deepEqual(actorSnapshotFromRow(null), { discord_id: null, discord_name: null, x_user_id: null, x_name: null, icon_url: null });
  assert.equal(actorSnapshotFromRow({ discord_id: null, discord_name: null, active_x_user_id: null, user_image: "u", x_name: null, x_icon_url: "" }).icon_url, "u");
  assert.equal(actorSnapshotFromRow({ discord_id: null, discord_name: null, active_x_user_id: null, user_image: "u", x_name: null, x_icon_url: "x" }).icon_url, "x");
});

test("mutateWithAudit forwards preloaded: one batch, no settings or actor read, same audit row", async () => {
  const run = async (withPreloaded) => {
    const w = world();
    const restore = freeze();
    try {
      w.sqlite.exec("CREATE TABLE t (id TEXT PRIMARY KEY)");
      const preloaded = withPreloaded
        ? {
            settings: mapAuditSettings(w.sqlite.prepare("SELECT * FROM system_settings WHERE id = 'default'").get()),
            actorSnapshotJsonById: { "admin-1": JSON.stringify(actorSnapshotFromRow(null)) },
          }
        : undefined;
      const before = w.stats.reads.length;
      await mutateWithAudit(w.db, {
        mutationStatements: [sql`INSERT INTO t (id) VALUES (${"a1"})`],
        expectedMutationChanges: 1,
        audits: [{ table_name: "announcements", target_id: "a1", operation: "CREATE", before: null, after: { id: "a1" }, actor_user_id: "admin-1" }],
        preloaded,
      });
      return { reads: w.stats.reads.length - before, batches: w.stats.batches, row: w.sqlite.prepare("SELECT * FROM audit_logs").get() };
    } finally {
      restore();
    }
  };
  const self = await run(false);
  const pre = await run(true);
  assert.equal(self.reads, 2);
  assert.equal(pre.reads, 0);
  assert.equal(pre.batches, 1);
  // the preloaded actor here is the empty snapshot, so only actor_snapshot_json may differ
  assert.deepEqual({ ...pre.row, actor_snapshot_json: null }, { ...self.row, actor_snapshot_json: null });
  assert.deepEqual(JSON.parse(pre.row.actor_snapshot_json), actorSnapshotFromRow(null));
});
