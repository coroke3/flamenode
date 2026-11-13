import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { buildPartsJson, buildSlotsEventUpdateFields } from "@flamenode/domain/event";

const build = (overrides = {}) => buildSlotsEventUpdateFields({
  max_slots_per_video: 3,
  max_slot_reservation_groups_per_xid: 2,
  slot_interval_minutes: 15,
  slot_part_gap_minutes: 10,
  slot_type: "time",
  slot_visibility_mode: "public_name",
  parts_text: "Opening\nFinale",
  ...overrides,
});

test("MIG-0652 U01 slots: all CURRENT field names and values are projected", () => {
  assert.deepEqual(build(), {
    max_slots_per_video: 3,
    max_slot_reservation_groups_per_xid: 2,
    slot_interval_minutes: 15,
    slot_part_gap_minutes: 10,
    slot_type: "time",
    slot_visibility_mode: "public_name",
    parts_json: JSON.stringify(["Opening", "Finale"]),
  });
});

test("MIG-0652 U01 slots: missing, null and explicit interval values preserve CURRENT nullish behavior", () => {
  for (const raw of [undefined, null]) {
    assert.equal(build({ slot_interval_minutes: raw }).slot_interval_minutes, null);
  }
  assert.equal(build({ slot_interval_minutes: 1440 }).slot_interval_minutes, 1440);
  assert.equal(build({ slot_interval_minutes: 1 }).slot_interval_minutes, 1);
});

test("MIG-0652 U01 slots: absent, empty and blank parts are represented as null", () => {
  for (const raw of [null, undefined, "", "   ", "\n\n \r\n"]) {
    assert.equal(build({ parts_text: raw }).parts_json, null);
  }
});

test("MIG-0652 U01 slots: canonical parts normalization trims, deduplicates and truncates", () => {
  const forty = "a".repeat(40);
  const input = "  Morning \r\n Morning\n" + forty + "1\n" + forty + "2\n Afternoon ";
  const row = build({ parts_text: input });
  assert.equal(row.parts_json, buildPartsJson(input), "must reuse canonical normalization");
  assert.deepEqual(JSON.parse(row.parts_json), ["Morning", forty, "Afternoon"]);
});

test("MIG-0652 U01 slots: parts cap 20 is unchanged and selection order stays stable", () => {
  const labels = Array.from({ length: 25 }, (_, i) => "Session" + (i + 1));
  const json = build({ parts_text: labels.join("\n") }).parts_json;
  assert.deepEqual(JSON.parse(json), labels.slice(0, 20));
});

test("MIG-0652 U01 slots: slot variant and numeric flags remain scalar and unchanged", () => {
  const result = build({
    max_slots_per_video: 1,
    max_slot_reservation_groups_per_xid: 0,
    slot_part_gap_minutes: 1440,
    slot_type: "count",
    slot_visibility_mode: "hidden",
  });
  assert.equal(result.max_slots_per_video, 1);
  assert.equal(result.max_slot_reservation_groups_per_xid, 0);
  assert.equal(result.slot_part_gap_minutes, 1440);
  assert.equal(result.slot_type, "count");
  assert.equal(result.slot_visibility_mode, "hidden");
  assert.equal(typeof result.max_slots_per_video, "number");
  assert.equal(build({ slot_visibility_mode: "anonymous" }).slot_visibility_mode, "anonymous");
});

test("MIG-0652 U01 slots: CURRENT guards sections while domain has no Next/DB imports", async () => {
  const current = await readFile(new URL("../../../src/lib/event/eventPayload.ts", import.meta.url), "utf8");
  const core = await readFile(new URL("../src/event/slotsUpdateFields.ts", import.meta.url), "utf8");
  assert.match(current, /if \(permissions\.slots\) \{\s*Object\.assign\(updatePayload, buildSlotsEventUpdateFields\(data\)\)/);
  assert.match(current, /changedByPermission\.slots = EVENT_SECTION_PERMISSION_KEYS\.slots/);
  for (const section of ["basic", "publish", "questions"]) {
    assert.match(current, new RegExp("if \\(permissions\\." + section + "\\)"));
  }
  assert.match(core, /import \{ buildPartsJson \} from "\.\/parts\.ts";/);
  assert.doesNotMatch(current, /buildPartsJson\(data\.parts_text\)/);
  assert.doesNotMatch(core, /from ["']@\//);
  assert.doesNotMatch(core, /drizzle|D1Database|\bsqlite\b/);
});
