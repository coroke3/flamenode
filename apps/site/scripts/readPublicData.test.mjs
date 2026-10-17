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
