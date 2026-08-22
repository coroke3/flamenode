import { test } from "node:test";
import assert from "node:assert/strict";
import { draftMetadataMatches } from "./useFormDraft.ts";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("./useFormDraft.ts", import.meta.url), "utf8");

test("draft metadata accepts the same editor context only", () => {
  const expected = {
    schemaVersion: "event-form-v2",
    authUserId: "user-1",
    mode: "edit",
    eventId: "event-1",
    baseRevision: 42,
  };
  assert.equal(draftMetadataMatches(expected, { ...expected }), true);
  assert.equal(
    draftMetadataMatches(expected, { ...expected, baseRevision: 43 }),
    false,
  );
  assert.equal(
    draftMetadataMatches(expected, { ...expected, authUserId: "user-2" }),
    false,
  );
  assert.equal(draftMetadataMatches(expected, null), false);
});

test("draft hook exposes bounded autosave controls and lifecycle flushes", () => {
  assert.match(source, /ttlMs\?: number/);
  assert.match(source, /debounceMs\?: number/);
  assert.match(source, /maxBytes\?: number/);
  assert.match(source, /shouldSave\?: boolean/);
  assert.match(source, /flushDraft: \(nextValue\?: T\) => boolean/);
  assert.match(source, /lastSavedAt: number \| null/);
  assert.match(source, /saveError: string \| null/);
  assert.match(source, /pagehide/);
  assert.match(source, /visibilitychange/);
});
