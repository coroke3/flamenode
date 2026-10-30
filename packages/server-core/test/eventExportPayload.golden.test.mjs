import test from "node:test";
import assert from "node:assert/strict";
import {
  buildEventExportPayloadForFormat,
  buildEventExportPayload,
  buildLegacyEventExportPayload,
} from "@flamenode/server-core/eventExport/payload";
import { findForbiddenPublicKeys } from "@flamenode/server-core/publicData/publicDto";

const fixture = {
  event: {
    id: "event/export", title: "公開イベント", explanation: "説明", icon_url: null,
    img_url: null, accent_color: "#123abc", event_type: "event",
    start_time: 1700000000, end_time: 1700003600, entry_start_time: null,
    entry_end_time: null, updated_at: 1700000010, public_staff: [],
  },
  videos: [], limit: 500, truncated: false,
};
const NOW = 1700000200;

test("MIG-0632 U02: v5 payload golden (fixed clock, no hidden keys)", () => {
  const v5 = buildEventExportPayload(fixture, NOW, "scheduled");
  assert.equal(v5.schema_version, 5);
  assert.equal(v5.format, "flamenode-event-export");
  assert.equal(v5.generated_at, "2023-11-14T22:16:40.000Z");
  assert.equal(v5.generated_at_unix, NOW);
  assert.equal(v5.update_mode, "scheduled");
  assert.equal(v5.event.id, "event/export");
  assert.equal(v5.event.status, "public");
  assert.equal(v5.event.unix_time.start, 1700000000);
  assert.deepEqual(v5.videos, []);
  assert.deepEqual(findForbiddenPublicKeys(v5), []);
  assert.equal(
    JSON.stringify(buildEventExportPayloadForFormat(fixture, "v5", NOW, "scheduled")),
    JSON.stringify(v5), "dispatcher must preserve v5 byte output",
  );
});

test("MIG-0632 U02: legacy payload golden (array and dispatcher byte equality)", () => {
  const legacy = buildLegacyEventExportPayload(fixture);
  assert.deepEqual(legacy, []);
  assert.deepEqual(buildEventExportPayloadForFormat(fixture, "legacy", NOW, "scheduled"), legacy);
  assert.equal(JSON.stringify(legacy), "[]");
});
