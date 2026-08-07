import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  resolveReservationXIdentityFromPending,
  SLOT_RESERVATION_X_REQUEST_TYPES,
} from "./reservationIdentityCore.ts";

const [source, coreSource] = await Promise.all([
  readFile(new URL("./reservationIdentity.ts", import.meta.url), "utf8"),
  readFile(new URL("./reservationIdentityCore.ts", import.meta.url), "utf8"),
]);

test("SLOT_RESERVATION_X_REQUEST_TYPES は枠確保対象申請だけを含む", () => {
  assert.deepEqual(SLOT_RESERVATION_X_REQUEST_TYPES, [
    "new_link",
    "existing_link",
    "alias",
  ]);
  assert.doesNotMatch(coreSource, /"merge"/);
  assert.doesNotMatch(coreSource, /"revert_merge"/);
});

test("resolveReservationXIdentity: approved active は canonical も設定", () => {
  const result = resolveReservationXIdentityFromPending({
    activeXId: "creator_a",
    approvedXIds: ["creator_a"],
    pendingRequestedXIds: [],
  });
  assert.deepEqual(result, {
    snapshotXId: "creator_a",
    canonicalXUserId: "creator_a",
  });
});

test("resolveReservationXIdentity: 未承認 active は pending 1件を優先", () => {
  const result = resolveReservationXIdentityFromPending({
    activeXId: "rejected_a",
    approvedXIds: [],
    pendingRequestedXIds: ["pending_b"],
  });
  assert.deepEqual(result, {
    snapshotXId: "pending_b",
    canonicalXUserId: null,
  });
});

test("resolveReservationXIdentity: 未承認 active が pending 中ならその名義を使う", () => {
  const result = resolveReservationXIdentityFromPending({
    activeXId: "pending_a",
    approvedXIds: [],
    pendingRequestedXIds: ["pending_a"],
  });
  assert.deepEqual(result, {
    snapshotXId: "pending_a",
    canonicalXUserId: null,
  });
});

test("resolveReservationXIdentity: 却下のみの active は Discord-only", () => {
  const result = resolveReservationXIdentityFromPending({
    activeXId: "rejected_a",
    approvedXIds: [],
    pendingRequestedXIds: [],
  });
  assert.deepEqual(result, {
    snapshotXId: null,
    canonicalXUserId: null,
  });
});

test("resolveReservationXIdentity: active なし + pending 1件", () => {
  const result = resolveReservationXIdentityFromPending({
    activeXId: null,
    approvedXIds: [],
    pendingRequestedXIds: ["alpha"],
  });
  assert.deepEqual(result, {
    snapshotXId: "alpha",
    canonicalXUserId: null,
  });
});

test("resolveReservationXIdentity: 複数 distinct pending は null を返す", () => {
  const result = resolveReservationXIdentityFromPending({
    activeXId: null,
    approvedXIds: [],
    pendingRequestedXIds: ["alpha", "beta"],
  });
  assert.deepEqual(result, {
    snapshotXId: null,
    canonicalXUserId: null,
  });
});

test("resolveReservationXIdentity: X 身元なしは null を返す", () => {
  const result = resolveReservationXIdentityFromPending({
    activeXId: null,
    approvedXIds: [],
    pendingRequestedXIds: [],
  });
  assert.deepEqual(result, {
    snapshotXId: null,
    canonicalXUserId: null,
  });
});

test("reservationIdentity は未承認 Active でも pending を読む", () => {
  assert.match(source, /pendingSlotReservationXRequestWhere/);
  assert.match(source, /resolveReservationXIdentityFromPending/);
  assert.match(source, /activeApproved/);
  assert.doesNotMatch(source, /const pendingRows = !guard\.activeXId/);
});
