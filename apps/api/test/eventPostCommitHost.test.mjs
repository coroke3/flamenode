import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  createEventPostCommitCacheHost,
  eventArchivePublicJsonKeys,
  eventExportPayloadCacheKeys,
} from "../src/visibility/eventPostCommitHost.ts";
import { publicJsonCacheUrl } from "@flamenode/server-core/publicCache/delete";

const EVENT_ID = "pvsf_test";

function fakeCache({ fail = false } = {}) {
  const visited = [];
  const dropped = [];
  const host = {
    dropIsolateEntry: (key) => dropped.push(key),
    readEdgeCache: () => ({
      delete: async (url) => {
        visited.push(url);
        if (fail) throw new Error("provider failure with secrets");
        return true;
      },
    }),
  };
  return { host, visited, dropped };
}

test("MIG-0652 U02 cache T01: archive's nine exact CURRENT public-JSON keys and order", () => {
  assert.deepEqual(eventArchivePublicJsonKeys(EVENT_ID), [
    "events/pvsf_test.json",
    "events/pvsf_test/base.v1.json",
    "events/pvsf_test/slots.v1.json",
    "events/pvsf_test/release.v1.json",
    "events/index.json",
    "list/recent.json",
    "list/popular.json",
    "top/sections/events.v1.json",
    "top.json",
  ]);
});

test("MIG-0652 U02 cache T02: export-key format and refresh selection exactly match CURRENT", () => {
  assert.deepEqual(eventExportPayloadCacheKeys(EVENT_ID), [
    "public-event-export:9:pvsf_test:v5:15",
    "public-event-export:9:pvsf_test:v5:60",
    "public-event-export:9:pvsf_test:v5:360",
    "public-event-export:9:pvsf_test:v5:1440",
    "public-event-export:9:pvsf_test:legacy:15",
    "public-event-export:9:pvsf_test:legacy:60",
    "public-event-export:9:pvsf_test:legacy:360",
    "public-event-export:9:pvsf_test:legacy:1440",
  ]);
  const encoded = eventExportPayloadCacheKeys("one / 名");
  assert.ok(encoded.every((key) => key.includes(encodeURIComponent("one / 名"))));
});

test("MIG-0652 U02 cache T03: archive deletes all 17 cache keys through the shared core", async () => {
  const fixture = fakeCache();
  await createEventPostCommitCacheHost(fixture.host).archive(EVENT_ID);
  const keys = [...eventArchivePublicJsonKeys(EVENT_ID), ...eventExportPayloadCacheKeys(EVENT_ID)];
  assert.equal(keys.length, 17);
  assert.deepEqual(fixture.dropped, keys);
  assert.deepEqual(fixture.visited, keys.map(publicJsonCacheUrl));
  assert.equal(new Set(fixture.visited).size, 17);
});

test("MIG-0652 U02 cache T04: export-only invalidation never evicts event or global list entries", async () => {
  const fixture = fakeCache();
  await createEventPostCommitCacheHost(fixture.host).invalidateExport(EVENT_ID);
  assert.deepEqual(fixture.visited, eventExportPayloadCacheKeys(EVENT_ID).map(publicJsonCacheUrl));
  assert.equal(fixture.visited.length, 8);
});

test("MIG-0652 U02 cache T05: native Cache API failure is best-effort and attempts every key", async () => {
  const fixture = fakeCache({ fail: true });
  await createEventPostCommitCacheHost(fixture.host).archive(EVENT_ID);
  assert.equal(fixture.visited.length, 17);
  assert.equal(fixture.dropped.length, 17);
});

test("MIG-0652 U02 cache T06: source assertions guard the CURRENT nine keys and export windows", async () => {
  const currentArchive = await readFile(
    new URL("../../../src/lib/actions/event-admin.ts", import.meta.url), "utf8",
  );
  const currentExport = await readFile(
    new URL("../../../src/lib/api/eventExportCache.ts", import.meta.url), "utf8",
  );
  for (const symbol of [
    "eventComposedObjectKey(eventId)",
    "eventBaseObjectKey(eventId)",
    "eventSlotsObjectKey(eventId)",
    "eventReleaseObjectKey(eventId)",
    '"events/index.json"',
    '"list/recent.json"',
    '"list/popular.json"',
    '"top/sections/events.v1.json"',
    '"top.json"',
  ]) {
    assert.ok(currentArchive.includes(symbol), symbol);
  }
  assert.ok(currentExport.includes('["v5", "legacy"]'));
  assert.ok(currentExport.includes("EVENT_EXPORT_REFRESH_MINUTES.map"));
});
