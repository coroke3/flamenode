import test from "node:test";
import assert from "node:assert/strict";
import { sql } from "drizzle-orm";
import { SQLiteSyncDialect } from "drizzle-orm/sqlite-core";
import { events, videoEvents } from "@flamenode/db/schema";
import {
  buildUnslottedEventEligibilityAssertionPlan,
  buildUnslottedVideoEventPlan,
} from "@flamenode/server-core/video/unslottedEventPlans";
import {
  buildUnslottedEventEligibilityAssertionPlan as legacyAssertion,
  buildUnslottedVideoEventPlan as legacyVideoEvent,
} from "../../../src/lib/video/resolveUnslottedEventSyncTarget.ts";
import { unslottedEventEligibilityWhere } from "@flamenode/server-core/video/unslottedEventEligibility";

const dialect = new SQLiteSyncDialect();

test("MIG-0651: Next atomic plan exports exactly the server-core implementation", () => {
  assert.strictEqual(buildUnslottedEventEligibilityAssertionPlan, legacyAssertion);
  assert.strictEqual(buildUnslottedVideoEventPlan, legacyVideoEvent);
});

test("MIG-0651: null event selection adds no mutation, assertion or audit", () => {
  const noDb = { run: () => { throw new Error("run must not execute"); }, insert: () => { throw new Error("insert must not execute"); } };
  const first = buildUnslottedEventEligibilityAssertionPlan(noDb, null, 50);
  const second = buildUnslottedVideoEventPlan(noDb, { videoId: "v", eventId: null, actorUserId: "u" });
  for (const plan of [first, second]) {
    assert.deepEqual(plan, { statements: [], expectedChanges: [], audits: [] });
  }
  assert.notStrictEqual(first, second);
});

test("MIG-0651: eligibility assertion reuses same SQL predicate, bind parameters and fail-closed SQL", () => {
  let captures = [];
  const db = { run: (query) => { captures.push(query); return { token: "batch-assertion" }; } };
  const plan = buildUnslottedEventEligibilityAssertionPlan(db, "event' OR 1=1", 12345);
  assert.deepEqual(plan, { statements: [{ token: "batch-assertion" }], expectedChanges: [null], audits: [] });
  assert.equal(captures.length, 1);
  const expected = sql`
    SELECT CASE
      WHEN EXISTS (
        SELECT 1
        FROM ${events}
        WHERE ${events.id} = ${"event' OR 1=1"}
          AND ${unslottedEventEligibilityWhere(12345)}
      ) THEN 1
      ELSE json_extract('not-valid-json', '$')
    END
  `;
  const actual = dialect.sqlToQuery(captures[0]);
  const expectedQuery = dialect.sqlToQuery(expected);
  const normalizeWhitespace = (query) => query.replace(/\s+/g, " ").trim();
  assert.equal(normalizeWhitespace(actual.sql), normalizeWhitespace(expectedQuery.sql));
  assert.deepEqual(actual.params, expectedQuery.params);
  assert.equal(actual.params.includes("event' OR 1=1"), true);
  assert.equal(actual.sql.includes("OR 1=1"), false);
  assert.match(actual.sql, /json_extract\('not-valid-json'/);
});

test("MIG-0651: video-event linkage is one batch INSERT plus strict CREATE audit", () => {
  const row = { video_id: "a:b", event_id: "c/d" };
  const builder = { table: null, values: null };
  const db = { insert: (table) => {
    builder.table = table;
    return { values: (values) => {
      builder.values = values;
      return { batch: "insert" };
    } };
  } };
  const plan = buildUnslottedVideoEventPlan(db, {
    videoId: row.video_id,
    eventId: row.event_id,
    actorUserId: "user-1",
  });
  assert.strictEqual(builder.table, videoEvents);
  assert.deepEqual(builder.values, row);
  assert.deepEqual(plan.statements, [{ batch: "insert" }]);
  assert.deepEqual(plan.expectedChanges, [1]);
  assert.deepEqual(plan.audits, [{
    table_name: "video_events",
    target_id: "a%3Ab:c%2Fd",
    operation: "CREATE",
    before: null,
    after: row,
    actor_user_id: "user-1",
    context: "video-save:unslotted-event",
    retention_class: "normal",
    strict: true,
  }]);
  assert.notStrictEqual(plan.audits[0].after, builder.values);
});
