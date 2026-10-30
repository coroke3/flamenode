import test from "node:test";
import assert from "node:assert/strict";
import { parseEventIdsFromForm, parseEventPartsJson } from "@flamenode/domain/video";
import {
  parseEventIdsFromForm as legacyParseIds,
  parseEventPartsJson as legacyParseParts,
} from "../../../src/lib/video/parseEventIds.ts";

test("MIG-0651 U01: old Next and new Hono imports reference the same domain parsers", () => {
  assert.strictEqual(legacyParseIds, parseEventIdsFromForm);
  assert.strictEqual(legacyParseParts, parseEventPartsJson);
});

test("MIG-0651 U01: event IDs preserve trimming, first-seen order and uniqueness", () => {
  const form = new FormData();
  form.set("event_ids", "  event-b,event-a,event-b, , event-c  ");
  assert.deepEqual(parseEventIdsFromForm(form), ["event-b", "event-a", "event-c"]);
});

test("MIG-0651 U01: absent, non-string and too-long event IDs preserve rejection", () => {
  const empty = new FormData();
  assert.deepEqual(parseEventIdsFromForm(empty), []);
  empty.set("event_ids", "a".repeat(65) + ",ok");
  assert.deepEqual(parseEventIdsFromForm(empty), ["ok"]);
  empty.set("event_ids", new Blob(["file"]), "events.txt");
  assert.deepEqual(parseEventIdsFromForm(empty), []);
});

test("MIG-0651 U01: parts JSON keeps only nonempty trimmed string entries", () => {
  assert.deepEqual(parseEventPartsJson('[" A ", "", null, 2, "B"]'), ["A", "B"]);
  assert.deepEqual(parseEventPartsJson("not-json"), []);
  assert.deepEqual(parseEventPartsJson('{"value":["A"]}'), []);
  assert.deepEqual(parseEventPartsJson(null), []);
});
