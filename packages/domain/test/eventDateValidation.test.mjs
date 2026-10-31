import assert from "node:assert/strict";
import test from "node:test";
import {
  EVENT_DATE_FIELDS,
  validateEventDateValues,
} from "@flamenode/domain/event";
import {
  EVENT_DATE_FIELDS as legacyFields,
  validateEventDateValues as legacyValidate,
} from "../../../src/lib/event/eventFormValidation.ts";

test("MIG-0652: legacy Next import is an identity bridge to the domain implementation", () => {
  assert.equal(legacyValidate, validateEventDateValues);
  assert.equal(legacyFields, EVENT_DATE_FIELDS);
  assert.deepEqual(EVENT_DATE_FIELDS, [
    "start_time",
    "end_time",
    "entry_start_time",
    "entry_end_time",
  ]);
});

test("MIG-0652: JST event and entry windows preserve exact Unix seconds and field order", () => {
  const result = validateEventDateValues({
    start_time: "2026-10-17T09:00",
    end_time: "2026-10-17T10:00",
    entry_start_time: "2026-10-16T08:30",
    entry_end_time: "2026-10-16T09:45",
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual([...result.timestamps], [
    ["start_time", Date.UTC(2026, 9, 17, 0, 0) / 1000],
    ["end_time", Date.UTC(2026, 9, 17, 1, 0) / 1000],
    ["entry_start_time", Date.UTC(2026, 9, 15, 23, 30) / 1000],
    ["entry_end_time", Date.UTC(2026, 9, 16, 0, 45) / 1000],
  ]);
});

test("MIG-0652: optional windows and equal boundaries remain valid", () => {
  const absent = validateEventDateValues({});
  assert.equal(absent.ok, true);
  if (absent.ok) assert.deepEqual([...absent.timestamps.values()], [null, null, null, null]);
  const equal = validateEventDateValues({
    start_time: "2026-10-17T09:00",
    end_time: "2026-10-17T09:00",
  });
  assert.equal(equal.ok, true);
  const independent = validateEventDateValues({
    end_time: "2026-10-17T09:00",
    entry_start_time: "2026-10-18T09:00",
  });
  assert.equal(independent.ok, true);
});

test("MIG-0652: malformed JST values reject the exact affected field before writes", () => {
  for (const field of EVENT_DATE_FIELDS) {
    const result = validateEventDateValues({ [field]: "2026-02-30T09:00" });
    assert.deepEqual(result, { ok: false, field, message: `${field}: invalid datetime` });
  }
  assert.deepEqual(validateEventDateValues({
    start_time: "2026-10-17T10:00",
    end_time: "2026-10-17T09:59",
  }), { ok: false, field: "start_time", message: "start_time must not be later than end_time" });
  assert.deepEqual(validateEventDateValues({
    entry_start_time: "2026-10-17T10:00",
    entry_end_time: "2026-10-17T09:59",
  }), { ok: false, field: "entry_start_time", message: "entry_start_time must not be later than entry_end_time" });
});
