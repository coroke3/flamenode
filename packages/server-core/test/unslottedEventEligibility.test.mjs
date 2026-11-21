import test from "node:test";
import assert from "node:assert/strict";
import { and, eq, isNotNull, lte, or } from "drizzle-orm";
import { SQLiteSyncDialect } from "drizzle-orm/sqlite-core";
import { events } from "@flamenode/db/schema";
import { UnslottedEventSyncError } from "@flamenode/domain/video";
import {
  unslottedEventEligibilityWhere,
  resolveUnslottedEventIdForNewVideo,
} from "@flamenode/server-core/video/unslottedEventEligibility";
import {
  unslottedEventEligibilityWhere as legacyWhere,
  resolveUnslottedEventIdForNewVideo as legacyResolve,
} from "../../../src/lib/video/resolveUnslottedEventSyncTarget.ts";

const dialect = new SQLiteSyncDialect();

test("MIG-0651: Next bridge and Hono core use exactly the same eligibility functions", () => {
  assert.strictEqual(legacyWhere, unslottedEventEligibilityWhere);
  assert.strictEqual(legacyResolve, resolveUnslottedEventIdForNewVideo);
});

test("MIG-0651: eligibility retains public status and explicit allow or ended-time condition", () => {
  for (const now of [0, 1735689600, 2147483647]) {
    const expected = and(
      eq(events.visibility_status, "public"),
      or(
        eq(events.allow_unslotted_posts, 1),
        and(isNotNull(events.end_time), lte(events.end_time, now)),
      ),
    );
    assert.deepEqual(dialect.sqlToQuery(unslottedEventEligibilityWhere(now)), dialect.sqlToQuery(expected));
  }
});

test("MIG-0651: no selected event avoids a D1 read", async () => {
  const db = { select: () => { throw new Error("unexpected D1 read"); } };
  assert.equal(await resolveUnslottedEventIdForNewVideo(db, null), null);
  assert.equal(await resolveUnslottedEventIdForNewVideo(db, ""), null);
});

test("MIG-0651: eligible event uses exactly one limited, parameterized D1 read", async () => {
  let selectCalls = 0;
  let fromCalls = 0;
  let queriedWhere;
  let queriedLimit;
  const db = {
    select: (columns) => {
      selectCalls += 1;
      assert.strictEqual(columns.id, events.id);
      return { from: (table) => {
        fromCalls += 1;
        assert.strictEqual(table, events);
        return { where: (predicate) => {
          queriedWhere = predicate;
          return { limit: async (n) => {
            queriedLimit = n;
            return [{ id: "event-1" }];
          } };
        } };
      } };
    },
  };
  assert.equal(await resolveUnslottedEventIdForNewVideo(db, "event-1", 101), "event-1");
  assert.equal(selectCalls, 1);
  assert.equal(fromCalls, 1);
  assert.equal(queriedLimit, 1);
  const actual = dialect.sqlToQuery(queriedWhere);
  const expected = dialect.sqlToQuery(and(eq(events.id, "event-1"), unslottedEventEligibilityWhere(101)));
  assert.deepEqual(actual, expected);
  assert.equal(actual.params.includes("event-1"), true);
  assert.equal(actual.params.includes("public"), true);
});

test("MIG-0651: rejected event returns the exact existing denial code", async () => {
  const db = { select: () => ({ from: () => ({ where: () => ({ limit: async () => [] }) }) }) };
  await assert.rejects(
    resolveUnslottedEventIdForNewVideo(db, "private-event", 101),
    (error) => error instanceof UnslottedEventSyncError &&
      error.code === "unslotted_event_not_allowed" &&
      error.message === "unslotted_event_not_allowed",
  );
});
