import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { validateEventDateValues } from "./eventFormValidation.ts";

const eventFormSource = readFileSync(
  fileURLToPath(new URL("./eventForm.ts", import.meta.url)),
  "utf8",
);

function values(overrides = {}) {
  return {
    title: "Event",
    start_time: "2028-02-29T12:00",
    end_time: "2028-02-29T13:00",
    entry_start_time: "2028-02-28T12:00",
    entry_end_time: "2028-02-28T13:00",
    allow_user_video_event_links: "0",
    allow_unslotted_posts: "0",
    allow_user_video_edits: "0",
    ...overrides,
  };
}

test("event form rejects invalid and reversed event/entry datetimes", () => {
  assert.equal(
    validateEventDateValues(values({ start_time: "2028-02-30T12:00" })).ok,
    false,
  );
  assert.equal(
    validateEventDateValues(
      values({ start_time: "2028-02-29T13:00", end_time: "2028-02-29T12:00" }),
    ).ok,
    false,
  );
  assert.equal(
    validateEventDateValues(
      values({
        entry_start_time: "2028-02-28T13:00",
        entry_end_time: "2028-02-28T12:00",
      }),
    ).ok,
    false,
  );
});

test("event form rejects fractional binary flags", () => {
  // Keep this assertion independent of zod/Next path aliases for the plain
  // Node unit runner while pinning the actual schema's integer-only checks.
  for (const field of [
    "allow_user_video_event_links",
    "allow_unslotted_posts",
    "allow_user_video_edits",
  ]) {
    assert.match(
      eventFormSource,
      new RegExp(`${field}: z\\.coerce\\.number\\(\\)\\.int\\(\\)\\.min\\(0\\)\\.max\\(1\\)`),
    );
  }
});

test("event form keeps integer-only slot settings aligned with D1 columns", () => {
  // Both values are persisted into SQLite INTEGER columns and are used by
  // slot-count/time arithmetic.  Accepting a decimal here would either fail
  // at write time or create fractional slot boundaries downstream.
  assert.match(
    eventFormSource,
    /max_slots_per_video:\s*z\.coerce[\s\S]*?\.number\(\)[\s\S]*?\.int\(\)/,
  );
  assert.match(
    eventFormSource,
    /slot_part_gap_minutes:\s*z\.coerce[\s\S]*?\.number\(\)[\s\S]*?\.int\(\)/,
  );
});
