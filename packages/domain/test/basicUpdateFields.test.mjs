import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { buildBasicEventUpdateFields } from "@flamenode/domain/event";

const data = (extra = {}) => ({
  title: " Autumn 2026 ", event_type: "collabo",
  explanation: "Explanation",
  youtube_description_template: "Current template",
  icon_url: "https://example.test/icon.png",
  img_url: "https://example.test/cover.png",
  accent_color: "#aabbcc",
  start_time: "2026-11-08T12:34",
  end_time: "2026-11-08T15:00:30",
  ...extra,
});
const build = (form, before = "Saved template", present = false) =>
  buildBasicEventUpdateFields({
    data: form, previousYoutubeDescriptionTemplate: before,
    hasYoutubeDescriptionTemplateField: present,
  });

test("MIG-0652 U01: basic update projection retains all CURRENT columns and preserves prior template if absent", () => {
  assert.deepEqual(build(data()), {
    title: " Autumn 2026 ",
    event_type: "collabo",
    explanation: "Explanation",
    youtube_description_template: "Saved template",
    icon_url: "https://example.test/icon.png",
    img_url: "https://example.test/cover.png",
    accent_color: "#aabbcc",
    start_time: Date.parse("2026-11-08T03:34:00Z") / 1000,
    end_time: Date.parse("2026-11-08T06:00:30Z") / 1000,
  });
});

test("MIG-0652 U01: explicitly provided description template replaces or clears saved template", () => {
  assert.equal(build(data(), "Old", true).youtube_description_template, "Current template");
  assert.equal(build(data({youtube_description_template: null}), "Old", true).youtube_description_template, null);
  assert.equal(build(data({youtube_description_template: undefined}), "Old", true).youtube_description_template, null);
  assert.equal(build(data({youtube_description_template: null}), "Old", false).youtube_description_template, "Old");
  assert.equal(build(data({youtube_description_template: "new"}), null, false).youtube_description_template, null);
});

test("MIG-0652 U01: optional basic properties map to null and malformed dates preserve CURRENT permissive fallback", () => {
  const result = build({
    title: "Title", event_type: "event", start_time: "2026-02-30T12:00",
    end_time: "1970-01-01T00:00Z",
  }, null, false);
  assert.deepEqual(result, {
    title: "Title", event_type: "event", explanation: null,
    youtube_description_template: null, icon_url: null,
    img_url: null, accent_color: null, start_time: null, end_time: null,
  });
});

test("MIG-0652 U01: empty and whitespace-only dates map to null but valid midnight uses JST", () => {
  const midnight = build(data({start_time:"2026-01-01T00:00", end_time:""}));
  assert.equal(midnight.start_time, Date.parse("2025-12-31T15:00:00Z") / 1000);
  assert.equal(midnight.end_time, null);
  assert.equal(build(data({start_time:" ",end_time:null})).start_time, null);
});

test("MIG-0652 U01: CURRENT eventPayload delegates only basic fields and retains section guard and audit metadata", async () => {
  const source = await readFile(new URL("../../../src/lib/event/eventPayload.ts", import.meta.url), "utf8");
  const core = await readFile(new URL("../src/event/basicUpdateFields.ts", import.meta.url), "utf8");
  assert.match(source, /if \(permissions\.basic\) \{\s*Object\.assign\(updatePayload, buildBasicEventUpdateFields\(\{/);
  assert.match(source, /hasYoutubeDescriptionTemplateField: formData\.has\("youtube_description_template"\)/);
  assert.match(source, /changedByPermission\.basic = EVENT_SECTION_PERMISSION_KEYS\.basic/);
  assert.match(source, /if \(permissions\.publish\)/);
  assert.match(source, /if \(permissions\.questions\)/);
  assert.match(source, /if \(permissions\.slots\)/);
  assert.doesNotMatch(core, /from ["']@\//, "domain must not import Next aliases");
  assert.doesNotMatch(core, /drizzle|D1Database|\bsqlite\b/);
});
