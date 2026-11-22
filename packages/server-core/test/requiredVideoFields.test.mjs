import test from "node:test";
import assert from "node:assert/strict";
import { and, eq, inArray } from "drizzle-orm";
import { SQLiteSyncDialect } from "drizzle-orm/sqlite-core";
import { events } from "@flamenode/db/schema";
import { UnslottedEventSyncError } from "@flamenode/domain/video";
import { unslottedEventEligibilityWhere } from "@flamenode/server-core/video/unslottedEventEligibility";
import {
  loadUnionRequiredVideoFields,
  loadEligibleUnslottedVideoRequiredFields,
} from "@flamenode/server-core/video/requiredVideoFields";
import {
  loadUnionRequiredVideoFields as legacyLoad,
} from "../../../src/lib/video/requiredVideoFields.ts";

const dialect = new SQLiteSyncDialect();

test("MIG-0651 U02: Next and Hono reuse the same required-video-field loader", () => {
  assert.strictEqual(legacyLoad, loadUnionRequiredVideoFields);
});

test("MIG-0651 U02: empty/blank event selection performs no D1 query", async () => {
  const db = { select: () => { throw new Error("unexpected D1 read"); } };
  assert.deepEqual(await loadUnionRequiredVideoFields(db, []), []);
  assert.deepEqual(await loadUnionRequiredVideoFields(db, ["", ""]), []);
});

test("MIG-0651 U02: one D1 read unions known fields; duplicates and unknown fields are ignored", async () => {
  let readCount = 0;
  let selectColumns = null;
  let fromTable = null;
  let wherePredicate = null;
  const rows = [
    { required_video_fields_json: '["music", "profile_text", "music", "unknown"]' },
    { required_video_fields_json: '["credit", "music"]' },
    { required_video_fields_json: null },
  ];
  const db = {
    select: (columns) => {
      readCount += 1;
      selectColumns = columns;
      return { from: (table) => {
        fromTable = table;
        return { where: async (predicate) => {
          wherePredicate = predicate;
          return rows;
        } };
      } };
    },
  };
  const fields = await loadUnionRequiredVideoFields(db, ["ev-a", "", "ev-b", "ev-a"]);
  assert.deepEqual(fields, ["profile_text", "music", "credit"]);
  assert.equal(readCount, 1);
  assert.strictEqual(selectColumns.required_video_fields_json, events.required_video_fields_json);
  assert.strictEqual(fromTable, events);
  const actual = dialect.sqlToQuery(wherePredicate);
  const expected = dialect.sqlToQuery(inArray(events.id, ["ev-a", "ev-b"]));
  assert.deepEqual(actual, expected);
  assert.deepEqual(actual.params, ["ev-a", "ev-b"]);
});

test("MIG-0651 U02: malformed JSON is ignored without hiding D1 failures", async () => {
  const db = { select: () => ({ from: () => ({ where: async () => [
    { required_video_fields_json: "{not json" },
    { required_video_fields_json: '["closing_comment"]' },
  ] }) }) };
  assert.deepEqual(await loadUnionRequiredVideoFields(db, ["ev"]), ["closing_comment"]);
  const err = new Error("D1 unavailable");
  const failDb = { select: () => { throw err; } };
  await assert.rejects(loadUnionRequiredVideoFields(failDb, ["ev"]), e => e === err);
});

test("MIG-0651 S3: selected event eligibility and required fields use one bounded D1 query", async () => {
  let reads = 0;
  let predicate;
  let columns;
  const db = {
    select(selected) {
      columns = selected;
      reads++;
      return {
        from(table) {
          assert.strictEqual(table, events);
          return {
            where(where) {
              predicate = where;
              return {
                limit: async (n) => {
                  assert.equal(n, 1);
                  return [{
                    id: "ev-pub",
                    required_video_fields_json: '["music","credit","music","unknown"]',
                    youtube_duplicate: 1,
                  }];
                },
              };
            },
          };
        },
      };
    },
  };
  assert.deepEqual(
    await loadEligibleUnslottedVideoRequiredFields(db, "ev-pub", 1_700_000_000, "dQw4w9WgXcQ"),
    { eventId: "ev-pub", requiredFields: ["music", "credit"], requiredFieldsSnapshot: '["music","credit","music","unknown"]', youtubeDuplicate: true },
  );
  assert.equal(reads, 1);
  assert.strictEqual(columns.id, events.id);
  assert.strictEqual(columns.required_video_fields_json, events.required_video_fields_json);
  const duplicateProjection = dialect.sqlToQuery(columns.youtube_duplicate);
  assert.match(duplicateProjection.sql, /EXISTS/i);
  assert.match(duplicateProjection.sql, /youtube_video_id/);
  assert.match(duplicateProjection.sql, /visibility_status/);
  assert.ok(duplicateProjection.params.includes("dQw4w9WgXcQ"));
  assert.ok(duplicateProjection.params.includes("voided"));
  assert.deepEqual(dialect.sqlToQuery(predicate),
    dialect.sqlToQuery(and(eq(events.id, "ev-pub"), unslottedEventEligibilityWhere(1_700_000_000))));
});

test("MIG-0651 S3: absent or ineligible event preserves no-read and denial behavior", async () => {
  let reads = 0;
  const db = {
    select() {
      reads++;
      return { from: () => ({ where: () => ({ limit: async () => [] }) }) };
    },
  };
  assert.deepEqual(await loadEligibleUnslottedVideoRequiredFields(db, null, 100, "dQw4w9WgXcQ"),
    { eventId: null, requiredFields: [], requiredFieldsSnapshot: null, youtubeDuplicate: null });
  assert.equal(reads, 0);
  await assert.rejects(
    loadEligibleUnslottedVideoRequiredFields(db, "ev-private", 100, "dQw4w9WgXcQ"),
    (error) => error instanceof UnslottedEventSyncError &&
      error.code === "unslotted_event_not_allowed",
  );
  assert.equal(reads, 1);
});
