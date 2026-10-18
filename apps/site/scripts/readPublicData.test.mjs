import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import {
  buildEventsIndexData,
  EVENTS_INDEX_MAX_ROWS,
  EVENT_GROUP_MAX_ROWS,
  EVENT_GROUP_EVENT_MAX_PER_GROUP,
  deterministicStringify,
} from "./readPublicData.ts";

function createMockD1(db) {
  return {
    prepare(sql) {
      // Convert SQLite parameter markers if needed, or execute directly
      return {
        bind(...args) {
          return {
            async all() {
              const stmt = db.prepare(sql);
              const results = stmt.all(...args);
              return { results };
            },
          };
        },
        async all() {
          const stmt = db.prepare(sql);
          const results = stmt.all();
          return { results };
        },
      };
    },
  };
}

function initTestSchema(db) {
  db.exec(`
    CREATE TABLE events (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      explanation TEXT,
      icon_url TEXT,
      img_url TEXT,
      accent_color TEXT,
      event_type TEXT NOT NULL DEFAULT 'normal',
      slot_type TEXT NOT NULL DEFAULT 'free',
      slot_visibility_mode TEXT NOT NULL DEFAULT 'public',
      max_slots_per_video INTEGER NOT NULL DEFAULT 5,
      start_time INTEGER,
      end_time INTEGER,
      entry_start_time INTEGER,
      entry_end_time INTEGER,
      visibility_status TEXT NOT NULL DEFAULT 'public',
      created_at INTEGER NOT NULL DEFAULT 1700000000
    );

    CREATE TABLE event_groups (
      id TEXT PRIMARY KEY,
      slug TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      group_type TEXT NOT NULL DEFAULT 'general',
      icon_url TEXT,
      accent_color TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      visibility_status TEXT NOT NULL DEFAULT 'public'
    );

    CREATE TABLE event_group_events (
      event_group_id TEXT NOT NULL,
      event_id TEXT NOT NULL,
      PRIMARY KEY (event_group_id, event_id)
    );

    CREATE TABLE event_staff (
      id TEXT PRIMARY KEY,
      event_id TEXT NOT NULL,
      display_name TEXT NOT NULL,
      is_public INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL DEFAULT 1700000000
    );
  `);
}

describe("readPublicData", () => {
  it("preserves deeply nested event fields while sorting keys deterministically", () => {
    const payload = {
      generated_at: 123,
      items: [{ id: "ev-01", title: "Festival", public_operator_names: ["A", "B"] }],
      group_sections: [{ id: "group-01", name: "Group", events: [{ id: "ev-01", title: "Festival" }] }],
    };
    const reordered = {
      items: [{ title: "Festival", public_operator_names: ["A", "B"], id: "ev-01" }],
      group_sections: [{ events: [{ title: "Festival", id: "ev-01" }], name: "Group", id: "group-01" }],
      generated_at: 123,
    };

    const serialized = deterministicStringify(payload);
    assert.deepStrictEqual(JSON.parse(serialized), payload, "nested fields must not be discarded");
    assert.strictEqual(serialized, deterministicStringify(reordered), "key insertion order must not change output");
    assert.deepStrictEqual(JSON.parse(serialized).items[0].public_operator_names, ["A", "B"]);
  });

  it("preserves array ordering, nulls and escaped Unicode text", () => {
    const source = { rows: [{ z: null, a: "日本語\\n改行" }, { z: 1, a: "two" }] };
    const encoded = deterministicStringify(source);
    assert.deepStrictEqual(JSON.parse(encoded), source);
  });
  it("T01: produces valid events/index.json output matching CURRENT structure", async () => {
    const rawDb = new DatabaseSync(":memory:");
    initTestSchema(rawDb);

    rawDb.exec(`
      INSERT INTO events (id, title, explanation, start_time, end_time, visibility_status)
      VALUES ('ev-01', 'Festival 2026', 'Annual fest', 1710000000, 1710086400, 'public');

      INSERT INTO event_groups (id, slug, name, sort_order, visibility_status)
      VALUES ('grp-01', 'fest-series', 'Fest Series', 1, 'public');

      INSERT INTO event_group_events (event_group_id, event_id)
      VALUES ('grp-01', 'ev-01');

      INSERT INTO event_staff (id, event_id, display_name, is_public)
      VALUES ('st-01', 'ev-01', 'Organizer Alice', 1);
    `);

    const d1 = createMockD1(rawDb);
    const data = await buildEventsIndexData(d1, { generatedAt: 1715000000 });

    assert.strictEqual(data.generated_at, 1715000000);
    assert.strictEqual(data.items.length, 1);
    assert.strictEqual(data.items[0].id, "ev-01");
    assert.strictEqual(data.items[0].title, "Festival 2026");
    assert.deepStrictEqual(data.items[0].public_operator_names, ["Organizer Alice"]);

    assert.strictEqual(data.group_sections.length, 1);
    assert.strictEqual(data.group_sections[0].id, "grp-01");
    assert.strictEqual(data.group_sections[0].slug, "fest-series");
    assert.strictEqual(data.group_sections[0].events.length, 1);
    assert.strictEqual(data.group_sections[0].events[0].id, "ev-01");
  });

  it("T02: filters out private, deleted, and non-period point events", async () => {
    const rawDb = new DatabaseSync(":memory:");
    initTestSchema(rawDb);

    rawDb.exec(`
      -- Public valid event (both start and end set)
      INSERT INTO events (id, title, start_time, end_time, visibility_status)
      VALUES ('ev-valid-1', 'Valid 1', 1710000000, 1710086400, 'public');

      -- Public valid event (both start and end null)
      INSERT INTO events (id, title, start_time, end_time, visibility_status)
      VALUES ('ev-valid-2', 'Valid 2', NULL, NULL, 'public');

      -- Private event (should be excluded)
      INSERT INTO events (id, title, start_time, end_time, visibility_status)
      VALUES ('ev-private', 'Private Event', 1710000000, 1710086400, 'private');

      -- Point event: start_time set, end_time null (should be excluded)
      INSERT INTO events (id, title, start_time, end_time, visibility_status)
      VALUES ('ev-point-1', 'Point Event 1', 1710000000, NULL, 'public');

      -- Point event: start_time null, end_time set (should be excluded)
      INSERT INTO events (id, title, start_time, end_time, visibility_status)
      VALUES ('ev-point-2', 'Point Event 2', NULL, 1710086400, 'public');
    `);

    const d1 = createMockD1(rawDb);
    const data = await buildEventsIndexData(d1, { generatedAt: 1715000000 });

    const ids = data.items.map((i) => i.id);
    assert.ok(ids.includes("ev-valid-1"));
    assert.ok(ids.includes("ev-valid-2"));
    assert.ok(!ids.includes("ev-private"));
    assert.ok(!ids.includes("ev-point-1"));
    assert.ok(!ids.includes("ev-point-2"));
  });

  it("T03: rejects invalid row limits before any D1 query", async () => {
    let queryCount = 0;
    const db = {
      prepare() {
        queryCount += 1;
        throw new Error("D1 must not be accessed for invalid limits");
      },
    };

    for (const rowLimit of [-1, 0, 1.5, NaN, Infinity, EVENTS_INDEX_MAX_ROWS + 1]) {
      await assert.rejects(
        buildEventsIndexData(db, { rowLimit }),
        /Invalid events index rowLimit: expected integer/,
        `rowLimit=${String(rowLimit)} must be rejected`,
      );
    }
    assert.strictEqual(queryCount, 0, "invalid inputs must perform zero D1 reads");
  });

  it("T03: fails build when row count exceeds MAX limit", async () => {
    const rawDb = new DatabaseSync(":memory:");
    initTestSchema(rawDb);

    // Insert 3 public events
    for (let i = 1; i <= 3; i++) {
      rawDb.exec(`
        INSERT INTO events (id, title, start_time, end_time, visibility_status)
        VALUES ('ev-${i}', 'Event ${i}', 1710000000, 1710086400, 'public');
      `);
    }

    const d1 = createMockD1(rawDb);

    // Limit set to 2 -> should throw
    await assert.rejects(
      async () => {
        await buildEventsIndexData(d1, { rowLimit: 2 });
      },
      /Events index row count exceeds limit: 3 > 2/
    );

    // Limit set to 3 -> should succeed
    const okData = await buildEventsIndexData(d1, { rowLimit: 3 });
    assert.strictEqual(okData.items.length, 3);
  });

  it("T01 parity: index ordering agrees with CURRENT SQL when event start times tie", async () => {
    const rawDb = new DatabaseSync(":memory:");
    initTestSchema(rawDb);
    try {
      rawDb.exec(`
        INSERT INTO events (id, title, start_time, end_time, created_at, visibility_status)
        VALUES ('ev-latest', 'Latest', 200, 210, 1, 'public'),
               ('ev-b', 'Earlier created', 100, 110, 1, 'public'),
               ('ev-a', 'Later created', 100, 110, 999, 'public');
      `);
      // This is the literal CURRENT rebuildEventsIndex list query ordering.
      const currentOrder = rawDb.prepare(`
        SELECT id FROM events
        WHERE visibility_status = 'public'
          AND ((start_time IS NULL AND end_time IS NULL)
               OR (start_time IS NOT NULL AND end_time IS NOT NULL))
        ORDER BY start_time DESC
        LIMIT ?
      `).all(EVENTS_INDEX_MAX_ROWS).map((row) => row.id);
      const migrated = await buildEventsIndexData(createMockD1(rawDb), {
        generatedAt: 1715000000,
      });
      assert.deepStrictEqual(
        migrated.items.map((row) => row.id),
        currentOrder,
        "the migrated index must preserve CURRENT's tie ordering rather than introducing created_at sorting",
      );
    } finally {
      rawDb.close();
    }
  });

  it("T01 parity: group numbers use CURRENT's integer flooring semantics", async () => {
    const rawDb = new DatabaseSync(":memory:");
    initTestSchema(rawDb);
    try {
      rawDb.exec(`
        INSERT INTO events (id, title, start_time, end_time, visibility_status)
        VALUES ('e-fraction', 'Fractional start', 100.9, 110.9, 'public');
        INSERT INTO event_groups (id, slug, name, sort_order, visibility_status)
        VALUES ('g-fraction', 'fraction', 'Fraction', 1.8, 'public');
        INSERT INTO event_group_events (event_group_id, event_id)
        VALUES ('g-fraction', 'e-fraction');
      `);
      const output = await buildEventsIndexData(createMockD1(rawDb), { generatedAt: 123 });
      assert.strictEqual(output.group_sections[0].sort_order, 1);
      assert.strictEqual(output.group_sections[0].latest_event_start_time, 100);
    } finally {
      rawDb.close();
    }
  });

  it("T04: produces deterministic byte output across multiple runs", async () => {
    const rawDb = new DatabaseSync(":memory:");
    initTestSchema(rawDb);

    rawDb.exec(`
      INSERT INTO events (id, title, start_time, end_time, visibility_status)
      VALUES ('ev-b', 'Event B', 1710000000, 1710086400, 'public'),
             ('ev-a', 'Event A', 1710000000, 1710086400, 'public');

      INSERT INTO event_groups (id, slug, name, sort_order, visibility_status)
      VALUES ('grp-2', 'slug-2', 'Group 2', 2, 'public'),
             ('grp-1', 'slug-1', 'Group 1', 1, 'public');
    `);

    const d1 = createMockD1(rawDb);

    const run1 = await buildEventsIndexData(d1, { generatedAt: 1715000000 });
    const run2 = await buildEventsIndexData(d1, { generatedAt: 1715000000 });

    const str1 = JSON.stringify(run1);
    const str2 = JSON.stringify(run2);

    assert.strictEqual(str1, str2);
    assert.strictEqual(Buffer.byteLength(str1), Buffer.byteLength(str2));
  });
});

// ---------------------------------------------------------------------------
// T01 against the real CURRENT producer. The fixture is the real D1 schema
// (every file in migrations/ applied in order), and CURRENT is
// workers/json-generator/rebuild.ts `rebuildTarget(env, "events_index")` itself,
// so a drift in either SQL or DTO shaping fails here.
// ---------------------------------------------------------------------------
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import * as CURRENT from "../../../workers/json-generator/rebuild.ts";
import * as MIGRATED from "./readPublicData.ts";

const MIGRATIONS_DIR = fileURLToPath(new URL("../../../migrations/", import.meta.url));

function realSchemaDb() {
  const sqlite = new DatabaseSync(":memory:");
  for (const file of fs.readdirSync(MIGRATIONS_DIR).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort()) {
    sqlite.exec(fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf8"));
  }
  return sqlite;
}

/** D1 surface used by CURRENT rebuild.ts (all / first / run / batch). */
function sqliteD1(sqlite, log = []) {
  const statement = (sql, args = []) => ({
    bind: (...next) => statement(sql, next),
    async all() {
      log.push(sql);
      return { results: sqlite.prepare(sql).all(...args), meta: {} };
    },
    async first(column) {
      log.push(sql);
      const row = sqlite.prepare(sql).get(...args) ?? null;
      return row && column ? row[column] : row;
    },
    async run() {
      log.push(sql);
      const info = sqlite.prepare(sql).run(...args);
      return { meta: { changes: Number(info.changes) } };
    },
  });
  return {
    prepare: (sql) => statement(sql),
    async batch(list) {
      const out = [];
      for (const item of list) out.push(await item.run());
      return out;
    },
  };
}

async function currentEventsIndex(sqlite) {
  const puts = [];
  const env = {
    DB: sqliteD1(sqlite),
    R2: {
      head: async () => null,
      get: async () => null,
      put: async (key, body) => { puts.push({ key, body: JSON.parse(String(body)) }); },
      delete: async () => {},
    },
    KV: { get: async () => null, put: async () => {} },
  };
  await CURRENT.rebuildTarget(env, "events_index", "global");
  const written = puts.filter((p) => p.key === "events/index.json");
  assert.equal(written.length, 1, "CURRENT must write events/index.json exactly once");
  return written[0].body;
}

function withoutGeneratedAt(payload) {
  const { generated_at: _ignored, ...rest } = payload;
  return deterministicStringify(rest);
}

function seedXUsers(sqlite, ids) {
  const insert = sqlite.prepare("INSERT OR IGNORE INTO x_users (id, x_name) VALUES (?, ?)");
  for (const id of ids) insert.run(id, id);
}

function seedParityFixture(sqlite) {
  seedXUsers(sqlite, [...Array.from({ length: 25 }, (_, i) => `u${i}`), "ub1", "ub2", "ub3", "uc1"]);
  const event = sqlite.prepare(
    `INSERT INTO events (id, title, explanation, icon_url, img_url, accent_color, event_type,
       slot_type, slot_visibility_mode, max_slots_per_video, start_time, end_time,
       entry_start_time, entry_end_time, visibility_status, created_at)
     VALUES (?, ?, ?, ?, NULL, ?, 'event', 'time', 'public_name', 3, ?, ?, ?, NULL, ?, ?)`,
  );
  // Ties on start_time, NULL periods, point events, private rows (the real schema
  // only allows private / public, see the events visibility trigger).
  for (let i = 0; i < 60; i += 1) {
    const start = 1_700_000_000 + Math.floor(i / 3) * 3600; // 3-way ties
    event.run(`ev-${String(i).padStart(3, "0")}`, `Event ${i} 日本語`, i % 4 ? `Ex ${i}` : null,
      i % 5 ? null : `https://img.example/${i}.png`, i % 2 ? "#ff0000" : null,
      start, start + 7200, start - 86400, i % 7 === 0 ? "private" : "public", 1_690_000_000 + ((i * 37) % 60));
  }
  event.run("ev-null-period", "No period", null, null, null, null, null, null, "public", 1);
  event.run("ev-point-start", "Point", null, null, null, 1_700_100_000, null, null, "public", 2);
  event.run("ev-point-end", "Point", null, null, null, null, 1_700_100_000, null, "public", 3);
  event.run("ev-private", "Private", null, null, null, 1_700_200_000, 1_700_300_000, null, "private", 5);

  const staff = sqlite.prepare(
    `INSERT INTO event_staff (id, event_id, x_user_id, display_name, is_public, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  // 25 public staff on one event (cap 20), duplicate names, whitespace, private staff.
  for (let i = 0; i < 25; i += 1) staff.run(`st-a-${i}`, "ev-001", `u${i}`, `Staff ${i % 15}`, 1, 100 + (24 - i));
  staff.run("st-b-1", "ev-002", "ub1", "  Spaced  ", 1, 10);
  staff.run("st-b-2", "ev-002", "ub2", "Hidden", 0, 11);
  staff.run("st-b-3", "ev-002", "ub3", "   ", 1, 12);
  staff.run("st-c-1", "ev-private", "uc1", "Private staff", 1, 13);

  const group = sqlite.prepare(
    `INSERT INTO event_groups (id, slug, name, description, group_type, icon_url, accent_color,
       sort_order, visibility_status)
     VALUES (?, ?, ?, ?, 'series', ?, ?, ?, ?)`,
  );
  group.run("g-b", "b", "Beta", null, null, null, 2, "public");
  group.run("g-a", "a", "Alpha", "desc", "https://img.example/g.png", "#00ff00", 2, "public");
  group.run("g-frac", "frac", "Fraction", null, null, null, 1.7, "public");
  group.run("g-private", "p", "Private group", null, null, null, 0, "private");
  group.run("g-empty", "e", "Empty", null, null, null, 9, "public");

  const link = sqlite.prepare("INSERT INTO event_group_events (event_group_id, event_id) VALUES (?, ?)");
  for (let i = 0; i < 30; i += 1) link.run("g-a", `ev-${String(i).padStart(3, "0")}`); // > 20 per group
  for (const id of ["ev-001", "ev-002", "ev-point-start", "ev-private", "ev-null-period"]) link.run("g-b", id);
  link.run("g-frac", "ev-010");
  link.run("g-private", "ev-001");
}

describe("readPublicData parity with CURRENT rebuild.ts", () => {
  it("T01: MAX_ constants are CURRENT's constants", () => {
    for (const name of [
      "EVENTS_INDEX_MAX_ROWS",
      "EVENT_GROUP_MAX_ROWS",
      "EVENT_GROUP_EVENT_MAX_PER_GROUP",
      "EVENT_GROUP_EVENT_MAX_ROWS",
      "PUBLIC_STAFF_MAX_PER_EVENT",
      "PUBLIC_STAFF_EVENT_ID_CHUNK_SIZE",
    ]) {
      assert.equal(MIGRATED[name], CURRENT[name], `${name} must match CURRENT`);
    }
  });

  it("T01/T02: same real-schema fixture -> byte-identical key-sorted JSON (minus generated_at)", async () => {
    const sqlite = realSchemaDb();
    try {
      seedParityFixture(sqlite);
      const current = await currentEventsIndex(sqlite);
      const migrated = await buildEventsIndexData(sqliteD1(sqlite), { generatedAt: 1 });
      assert.equal(withoutGeneratedAt(migrated), withoutGeneratedAt(current));
      // The fixture really exercises the edges it claims to.
      const ids = migrated.items.map((row) => row.id);
      assert.ok(ids.includes("ev-null-period"));
      for (const hidden of ["ev-point-start", "ev-point-end", "ev-private", "ev-000"]) {
        assert.ok(!ids.includes(hidden), `${hidden} must not be published`);
      }
      const ev001 = migrated.items.find((row) => row.id === "ev-001");
      // Top 20 by created_at hold 5 repeated names: 15 distinct, as CURRENT.
      assert.equal(ev001.public_operator_names.length, 15);
      const alpha = migrated.group_sections.find((g) => g.id === "g-a");
      assert.equal(alpha.events.length, MIGRATED.EVENT_GROUP_EVENT_MAX_PER_GROUP);
      assert.ok(!migrated.group_sections.some((g) => g.id === "g-private"));
    } finally {
      sqlite.close();
    }
  });

  it("T01: parity holds at exactly EVENTS_INDEX_MAX_ROWS public events (> 2 staff chunks)", async () => {
    const sqlite = realSchemaDb();
    try {
      const insert = sqlite.prepare(
        `INSERT INTO events (id, title, start_time, end_time, visibility_status, created_at)
         VALUES (?, ?, ?, ?, 'public', ?)`,
      );
      for (let i = 0; i < EVENTS_INDEX_MAX_ROWS; i += 1) {
        insert.run(`max-${i}`, `Max ${i}`, 1_700_000_000 + i, 1_700_000_100 + i, i);
      }
      const staff = sqlite.prepare(
        `INSERT INTO event_staff (id, event_id, x_user_id, display_name, is_public, created_at)
         VALUES (?, ?, 'u', ?, 1, 1)`,
      );
      seedXUsers(sqlite, ["u"]);
      for (let i = 0; i < EVENTS_INDEX_MAX_ROWS; i += 1) staff.run(`s-${i}`, `max-${i}`, `S${i}`);
      const current = await currentEventsIndex(sqlite);
      const migrated = await buildEventsIndexData(sqliteD1(sqlite), { generatedAt: 1 });
      assert.equal(migrated.items.length, EVENTS_INDEX_MAX_ROWS);
      assert.equal(withoutGeneratedAt(migrated), withoutGeneratedAt(current));
      // T03: one more public event fails the build instead of silently dropping it.
      insert.run("max-over", "Over", 1, 2, 0);
      await assert.rejects(buildEventsIndexData(sqliteD1(sqlite)), /exceeds limit: 201 > 200/);
    } finally {
      sqlite.close();
    }
  });

  it("every D1 statement is bounded (LIMIT or a fixed-size IN / window cap)", async () => {
    const sqlite = realSchemaDb();
    try {
      seedParityFixture(sqlite);
      const log = [];
      await buildEventsIndexData(sqliteD1(sqlite, log), { generatedAt: 1 });
      const chunks = (n) => Math.ceil(n / MIGRATED.PUBLIC_STAFF_EVENT_ID_CHUNK_SIZE);
      const maxStatements = 4 + chunks(EVENTS_INDEX_MAX_ROWS) + chunks(MIGRATED.EVENT_GROUP_EVENT_MAX_ROWS);
      assert.equal(maxStatements, 19);
      assert.ok(log.length > 0 && log.length <= maxStatements, `statement count ${log.length}`);
      for (const sql of log) {
        assert.ok(/COUNT\(\*\)|LIMIT \?|staff_rank <= \?/.test(sql), `unbounded statement: ${sql}`);
      }
    } finally {
      sqlite.close();
    }
  });

  it("CLI: local SQLite snapshot -> deterministic events index file (T04)", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "read-public-data-"));
    try {
      const file = path.join(dir, "snapshot.sqlite");
      const sqlite = realSchemaDb();
      seedParityFixture(sqlite);
      sqlite.exec(`VACUUM INTO '${file.replaceAll("'", "''")}'`);
      sqlite.close();
      const script = fileURLToPath(new URL("./readPublicData.ts", import.meta.url));
      const run = (out) => execFileSync(process.execPath, [
        "--experimental-strip-types", "--no-warnings", script,
        "--sqlite", file, "--out", out, "--generated-at", "1715000000",
      ], { stdio: "pipe" });
      run(path.join(dir, "a.json"));
      run(path.join(dir, "b.json"));
      const a = fs.readFileSync(path.join(dir, "a.json"));
      assert.ok(a.equals(fs.readFileSync(path.join(dir, "b.json"))), "two builds must be byte-identical");
      const parsed = JSON.parse(a.toString("utf8"));
      assert.equal(parsed.generated_at, 1715000000);
      assert.ok(parsed.items.length > 0 && parsed.group_sections.length > 0);
      assert.throws(() => execFileSync(process.execPath, [
        "--experimental-strip-types", "--no-warnings", script, "--sqlite", path.join(dir, "missing.sqlite"), "--out", path.join(dir, "c.json"),
      ], { stdio: "pipe" }), /SQLite snapshot not found|Command failed/);
      assert.ok(!fs.existsSync(path.join(dir, "c.json")));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
