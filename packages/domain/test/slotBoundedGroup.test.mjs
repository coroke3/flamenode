import assert from "node:assert/strict";
import test from "node:test";
import { assertBoundedSlotGroupIntegrity as canonical } from "../src/slots/boundedGroup.ts";
import { assertBoundedSlotGroupIntegrity as legacy } from "../../../src/lib/slots/slotBoundedGroup.ts";

const row = (id, extra = {}) => ({
  id,
  event_id: "event-A",
  reserved_by_user_id: "auth-1",
  reserved_x_id_snapshot: "pending-X",
  status: "reserved",
  ...extra,
});
const errorCap = /連続枠が上限 20 件を超えています。運営へ連絡してください。/;
const errorMissing = /連続枠の完全な状態を確認できませんでした。/;
const errorMixed = /連続枠に別の利用者または状態が混在しています。/;

test("MIG-0657 U01f: CURRENT bridge resolves to canonical validator", () => {
  assert.strictEqual(legacy, canonical);
});

test("MIG-0657 U01f: valid two-row group succeeds without mutating frozen rows", () => {
  const anchor = Object.freeze(row("a"));
  const partner = Object.freeze(row("b"));
  const rows = Object.freeze([partner, anchor]);
  assert.doesNotThrow(() => canonical(rows, anchor, 20));
  assert.deepEqual(rows.map((x) => x.id), ["b", "a"], "unsorted rows are left for the CURRENT sorter");
});

test("MIG-0657 U01f: exactly 20 rows accepted, 21 rejected with CURRENT message", () => {
  const rows = Array.from({ length: 21 }, (_, i) => row(String(i)));
  assert.doesNotThrow(() => canonical(rows.slice(0, 20), rows[0], 20));
  assert.throws(() => canonical(rows, rows[0], 20), errorCap);
});

test("MIG-0657 U01f: empty group rejects missing anchor", () => {
  assert.throws(() => canonical([], row("anchor"), 20), errorMissing);
});

test("MIG-0657 U01f: group missing anchor ID rejects before write", () => {
  assert.throws(() => canonical([row("other")], row("anchor"), 20), errorMissing);
});

test("MIG-0657 U01f: cross-event member rejects with CURRENT error", () => {
  const anchor = row("a");
  assert.throws(() => canonical([anchor, row("b", { event_id: "event-B" })], anchor, 20), errorMixed);
});

test("MIG-0657 U01f: cross-auth-account member rejects with CURRENT error", () => {
  const anchor = row("a");
  assert.throws(() => canonical([anchor, row("b", { reserved_by_user_id: "auth-2" })], anchor, 20), errorMixed);
});

test("MIG-0657 U01f: differing X snapshot rejects, including null versus non-null", () => {
  const anchor = row("a", { reserved_x_id_snapshot: null });
  assert.throws(() => canonical([anchor, row("b")], anchor, 20), errorMixed);
});

test("MIG-0657 U01f: Discord-only snapshot and auth owner are valid when consistent", () => {
  const anchor = row("a", { reserved_x_id_snapshot: null });
  assert.doesNotThrow(() => canonical([anchor, row("b", { reserved_x_id_snapshot: null })], anchor, 20));
});

test("MIG-0657 U01f: status changes are intentionally checked by the downstream atomic guard", () => {
  const anchor = row("a");
  assert.doesNotThrow(() => canonical([anchor, row("b", { status: "submitted" })], anchor, 20));
});
