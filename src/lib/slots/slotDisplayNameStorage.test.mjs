import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  slotDisplayNameStorageKey, readPersistedSlotDisplayName, persistSlotDisplayName,
} from "./slotDisplayNameStorage.ts";

test("SEC-899: null-X viewers never read or write any persistent name", () => {
  const events = [];
  assert.equal(slotDisplayNameStorageKey(""), null);
  assert.equal(readPersistedSlotDisplayName("", key => { events.push("read " + key); return "prior-user"; }), "");
  persistSlotDisplayName("", "new-user", (key, value) => events.push(key + value));
  assert.deepEqual(events, []);
});

test("SEC-899: a real X ID of 'unassigned' never collides with null-X or legacy keys", () => {
  const key = slotDisplayNameStorageKey("unassigned");
  assert.equal(key, "fn:lastSlotDisplayName:v2:x:unassigned");
  assert.notEqual(key, "fn:lastSlotDisplayName:unassigned");
  assert.notEqual(key, "fn:lastSlotDisplayName");
  assert.notEqual(key, slotDisplayNameStorageKey(""));
});

test("SEC-899: scoped X preferences are isolated; do not migrate ambiguous legacy", () => {
  const storage = new Map([["fn:lastSlotDisplayName", "old-user"],
    ["fn:lastSlotDisplayName:unassigned", "old-unassigned"]]);
  const get = key => storage.get(key) ?? null;
  const put = (key, value) => storage.set(key, value);
  assert.equal(readPersistedSlotDisplayName("alpha", get), "");
  assert.equal(readPersistedSlotDisplayName("unassigned", get), "");
  persistSlotDisplayName("alpha", " Alice ", put);
  persistSlotDisplayName("beta", "Bob", put);
  assert.equal(readPersistedSlotDisplayName("alpha", get), "Alice");
  assert.equal(readPersistedSlotDisplayName("beta", get), "Bob");
  assert.equal(readPersistedSlotDisplayName("unassigned", get), "");
  assert.equal(storage.get("fn:lastSlotDisplayName"), "old-user");
});

test("SEC-899: denied storage and blank names safely fail closed", () => {
  const denied = () => { throw new Error("storage denied"); };
  assert.equal(readPersistedSlotDisplayName("alpha", denied), "");
  assert.doesNotThrow(() => persistSlotDisplayName("alpha", "Alice", denied));
  let writes = 0;
  persistSlotDisplayName("alpha", " ", () => writes++);
  assert.equal(writes, 0);
  assert.ok(slotDisplayNameStorageKey("a/b").endsWith("a%2Fb"));
});

test("SEC-899: CURRENT reservation path uses scoped read and guarded save only", () => {
  const current = readFileSync(fileURLToPath(new URL("../../components/event/SlotGrid.tsx", import.meta.url)), "utf8");
  assert.match(current, /readPersistedSlotDisplayName\(/);
  assert.match(current, /persistSlotDisplayName\(/);
  assert.doesNotMatch(current, /localStorage\.getItem\(LEGACY_SLOT_DISPLAY_NAME_KEY\)/);
  assert.doesNotMatch(current, /slotDisplayNameStorageKey\(viewerXId\)/);
});
