import test from "node:test";
import assert from "node:assert/strict";
import { inArray } from "drizzle-orm";
import { SQLiteSyncDialect } from "drizzle-orm/sqlite-core";
import { events } from "@flamenode/db/schema";
import {
  loadUnionRequiredVideoFields,
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
