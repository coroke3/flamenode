import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeTopRecommendedSection,
  normalizeTopLatestSection,
  normalizeTopNostalgicSection,
  normalizeTopEventsSection,
  normalizeTopAnnouncementsSection,
  normalizeTopStatsSection,
} from "./staticTopSectionsCore.ts";

const now = Math.floor(Date.now() / 1000);
const video = { id: "v1", title: "Video", display_name: "Creator" };
const sections = [
  ["recommended", normalizeTopRecommendedSection, { items: [video] }],
  ["latest", normalizeTopLatestSection, { items: [video] }],
  [
    "nostalgic",
    normalizeTopNostalgicSection,
    { pool: [video], display: [video], shuffled_at: now - 30, selection_day: "2026-11-23" },
  ],
  ["events", normalizeTopEventsSection, { active_events: [], latest_events: [] }],
  ["announcements", normalizeTopAnnouncementsSection, { items: [] }],
  [
    "stats",
    normalizeTopStatsSection,
    { stats: { public_videos: 1, active_events: 0, public_events: 1, creators: 2 } },
  ],
];

const payload = (extra, generated_at = now - 30) => ({
  schema_version: 1,
  generated_at,
  ...extra,
});

test("all six top section readers preserve numeric writer output", () => {
  for (const [name, normalize, fields] of sections) {
    const result = normalize(payload(fields));
    assert.ok(result, name);
    assert.equal(result.generatedAt, now - 30, name);
  }
});

test("all top section readers reject coerced schema versions", () => {
  for (const [name, normalize, fields] of sections) {
    for (const schema_version of ["1", true, [1], null, 0, 2]) {
      assert.equal(
        normalize({ ...payload(fields), schema_version }),
        null,
        `${name}: schema_version=${JSON.stringify(schema_version)}`,
      );
    }
  }
});

test("all top section readers reject noncanonical generated_at", () => {
  for (const [name, normalize, fields] of sections) {
    for (const generated_at of [
      String(now - 30), true, [now - 30], null, false, 0, -1, 1.5,
      Number.NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1,
    ]) {
      assert.equal(
        normalize(payload(fields, generated_at)),
        null,
        `${name}: generated_at=${String(generated_at)}`,
      );
    }
  }
});

test("all top sections reject implausible future generations but allow small clock drift", () => {
  for (const [name, normalize, fields] of sections) {
    assert.equal(normalize(payload(fields, now + 180))?.generatedAt, now + 180, name);
    assert.equal(normalize(payload(fields, now + 900)), null, name);
  }
});

test("top section normalization keeps list, event, stats and nostalgic structure", () => {
  const recommended = normalizeTopRecommendedSection(payload({ items: [video] }));
  const nostalgic = normalizeTopNostalgicSection(payload({
    pool: [video],
    display: [video],
    shuffled_at: now - 30,
    selection_day: "2026-11-23",
  }));
  const events = normalizeTopEventsSection(payload({
    active_events: [{ id: "e1", title: "Public", visibility_status: "public", start_time: now - 60, end_time: now + 60 }],
    latest_events: [],
  }));
  const stats = normalizeTopStatsSection(payload({
    stats: { public_videos: 1, active_events: 1, public_events: 1, creators: 2 },
  }));
  assert.deepEqual(recommended?.items.map((row) => row.id), ["v1"]);
  assert.deepEqual(nostalgic?.pool.map((row) => row.id), ["v1"]);
  assert.deepEqual(nostalgic?.display.map((row) => row.id), ["v1"]);
  assert.equal(nostalgic?.selectionDay, "2026-11-23");
  assert.deepEqual(events?.activeEvents.map((row) => row.id), ["e1"]);
  assert.deepEqual(stats?.stats, {
    public_videos: 1, active_events: 1, public_events: 1, creators: 2,
  });
});
