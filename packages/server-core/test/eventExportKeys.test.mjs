import assert from "node:assert/strict";
import { test } from "node:test";
import {
  EVENT_EXPORT_REFRESH_MINUTES,
  eventExportPayloadCacheKey,
  isEventExportRefreshMinutes,
} from "@flamenode/server-core/publicCache/eventExportKeys";

test("MIG-0632 U02a: CURRENT version 9 cache identity stays byte-for-byte stable", () => {
  assert.equal(eventExportPayloadCacheKey("event-001", "v5", 15), "public-event-export:9:event-001:v5:15");
  assert.equal(eventExportPayloadCacheKey("event-001", "legacy", 1440), "public-event-export:9:event-001:legacy:1440");
  assert.equal(
    eventExportPayloadCacheKey("a/b 東京", "legacy", 360),
    "public-event-export:9:a%2Fb%20%E6%9D%B1%E4%BA%AC:legacy:360",
  );
  assert.equal(eventExportPayloadCacheKey("", "v5", 60), "public-event-export:9::v5:60");
});

test("MIG-0632 U02a: exact CURRENT refresh allowlist and format isolation", () => {
  assert.deepEqual(EVENT_EXPORT_REFRESH_MINUTES, [15, 60, 360, 1440]);
  for (const minutes of EVENT_EXPORT_REFRESH_MINUTES) assert.equal(isEventExportRefreshMinutes(minutes), true);
  for (const minutes of [-1, 0, 7, 30, 61, 1441, 15.5, Number.NaN, Infinity]) {
    assert.equal(isEventExportRefreshMinutes(minutes), false, String(minutes));
  }
  const keys = new Set();
  for (const format of ["v5", "legacy"]) {
    for (const minutes of EVENT_EXPORT_REFRESH_MINUTES) {
      keys.add(eventExportPayloadCacheKey("event-001", format, minutes));
    }
  }
  assert.equal(keys.size, 8, "each event has exactly 2 formats x 4 scheduled windows");
});

test("MIG-0632 U02a: event IDs are encoded before joining cache components", () => {
  const encoded = ["with:colon", "with/slash", "a b", "a%b", "日本語", "a?b#c"].map((id) =>
    eventExportPayloadCacheKey(id, "v5", 60),
  );
  assert.equal(new Set(encoded).size, encoded.length);
  assert.ok(encoded.every((key) => key.startsWith("public-event-export:9:")));
  assert.equal(encoded[0], "public-event-export:9:with%3Acolon:v5:60");
});
