import test from "node:test";
import assert from "node:assert/strict";
import {
  EventStaffPresetSchema,
  EventStaffUpsertBodySchema,
  EventStaffCsvBodySchema,
  EventStaffDeleteBodySchema,
  EventOwnerTransferBodySchema,
  EventStaffWriteResultSchema,
} from "@flamenode/contracts";
import { EVENT_STAFF_PRESETS } from "@flamenode/domain/auth/permissions/presets";
import { parseCanonicalXId } from "@flamenode/domain/xid";

// MIG-0654 U01: characterize the CURRENT wire boundary without mounting writes.
// D1 owner protection, authorization, audit and queue parity require U02..U04.
const upsert = (overrides = {}) => ({
  display_name: "  Editor  ",
  x_user_id: "@Test_User",
  reason: "  staffing update  ",
  ...overrides,
});
const csvRow = (lineNumber = 1, overrides = {}) => ({
  lineNumber,
  display_name: "Editor",
  x_user_id: "test_user",
  permission_preset: "public_staff",
  permission_keys: [],
  is_public_staff: "1",
  public_role_label: "",
  ...overrides,
});

test("SA-031 preset enum matches domain without a contracts→domain cycle", () => {
  assert.deepEqual(EventStaffPresetSchema.options, [...EVENT_STAFF_PRESETS]);
});

test("SA-031 accepts CURRENT-friendly X handles and applies CURRENT field defaults", () => {
  const result = EventStaffUpsertBodySchema.parse(upsert());
  assert.equal(result.display_name, "Editor");
  assert.equal(result.reason, "staffing update");
  assert.equal(result.permission_preset, "public_staff");
  assert.equal(result.is_public, 0);
  assert.equal(parseCanonicalXId(result.x_user_id), "test_user");
  assert.equal(EventStaffUpsertBodySchema.parse(upsert({
    x_user_id: "https://x.com/Test_User", is_public: "1",
  })).is_public, 1);
  assert.equal(parseCanonicalXId("https://x.com/Test_User"), "test_user");
});

test("SA-031 rejects bad public flags, oversized labels/reason, and missing required fields", () => {
  assert.equal(EventStaffUpsertBodySchema.safeParse(upsert({ is_public: "2" })).success, false);
  assert.equal(EventStaffUpsertBodySchema.safeParse(upsert({ is_public: "-1" })).success, false);
  assert.equal(EventStaffUpsertBodySchema.safeParse(upsert({ is_public: "0.5" })).success, false);
  assert.equal(EventStaffUpsertBodySchema.safeParse(upsert({ display_name: "x".repeat(81) })).success, false);
  assert.equal(EventStaffUpsertBodySchema.safeParse(upsert({ public_role_label: "x".repeat(41) })).success, false);
  assert.equal(EventStaffUpsertBodySchema.safeParse(upsert({ reason: "x".repeat(501) })).success, false);
  assert.equal(EventStaffUpsertBodySchema.safeParse(upsert({ reason: "   " })).success, false);
  assert.equal(EventStaffUpsertBodySchema.safeParse({ reason: "valid" }).success, false);
});

test("SA-032 accepts 1..100 rows and rejects oversized or malformed CSV batches", () => {
  const valid = { reason: "Import", rows: Array.from({ length: 100 }, (_, i) => csvRow(i + 1)) };
  assert.equal(EventStaffCsvBodySchema.safeParse(valid).success, true);
  assert.equal(EventStaffCsvBodySchema.safeParse({ ...valid, rows: [] }).success, false);
  assert.equal(EventStaffCsvBodySchema.safeParse({ ...valid, rows: [...valid.rows, csvRow(101)] }).success, false);
  assert.equal(EventStaffCsvBodySchema.safeParse({ reason: "x", rows: [csvRow(0)] }).success, false);
  assert.equal(EventStaffCsvBodySchema.safeParse({ reason: "x", rows: [csvRow(1, { permission_keys: ["x".repeat(101)] })] }).success, false);
  assert.equal(EventStaffCsvBodySchema.safeParse({ reason: "x", rows: [csvRow(1, { is_public_staff: "true" })] }).success, false);
  // CURRENT first parses "owner" as a preset, then rejects owner changes in
  // the privileged CSV handler; the DTO must not silently change that order.
  assert.equal(EventStaffCsvBodySchema.safeParse({ reason: "x", rows: [csvRow(1, { permission_preset: "owner" })] }).success, true);
});

test("SA-033/034 preserve reason and confirmation wire fields", () => {
  assert.equal(EventStaffDeleteBodySchema.safeParse({ reason: "remove", confirm_text: null }).success, true);
  assert.equal(EventStaffDeleteBodySchema.safeParse({ reason: "" }).success, false);
  assert.equal(EventOwnerTransferBodySchema.safeParse({
    from_staff_id: "es1", to_staff_id: "es2", reason: "handoff",
    confirm_text: "TRANSFER ev-1", self_confirm_text: null,
  }).success, true);
  assert.equal(EventOwnerTransferBodySchema.safeParse({
    from_staff_id: "es1", to_staff_id: "es2", reason: "handoff",
  }).success, false);
});

test("SA-031..034 result keeps CURRENT pending-public-reflection and error shape", () => {
  assert.equal(EventStaffWriteResultSchema.safeParse({
    ok: true, pendingPublicReflection: true,
  }).success, true);
  assert.equal(EventStaffWriteResultSchema.safeParse({
    ok: false, message: "代表者を移譲できません。",
  }).success, true);
  assert.equal(EventStaffWriteResultSchema.safeParse({
    ok: false, pendingPublicReflection: true,
  }).success, false);
});
