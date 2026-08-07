import assert from "node:assert/strict";
import { test } from "node:test";
import {
  canActAsSlotActor,
  resolveSlotGroupIdentity,
  resolveSlotViewerRelation,
} from "./slotIdentityCore.ts";

const AUTH = "auth-user-1";
const OTHER_AUTH = "auth-user-2";
const X_A = "creator_a";
const X_B = "creator_b";

test("resolveSlotViewerRelation: authUserId なしは none", () => {
  assert.equal(
    resolveSlotViewerRelation({
      reservedByUserId: AUTH,
      slotXUserId: X_A,
      authUserId: null,
      activeXId: X_A,
    }),
    "none",
  );
});

test("resolveSlotViewerRelation: reserved_by が auth と不一致は none", () => {
  assert.equal(
    resolveSlotViewerRelation({
      reservedByUserId: OTHER_AUTH,
      slotXUserId: X_A,
      authUserId: AUTH,
      activeXId: X_A,
    }),
    "none",
  );
});

test("resolveSlotViewerRelation: slotX と activeX が一致すると active", () => {
  assert.equal(
    resolveSlotViewerRelation({
      reservedByUserId: AUTH,
      slotXUserId: X_A,
      authUserId: AUTH,
      activeXId: X_A,
    }),
    "active",
  );
  assert.equal(
    resolveSlotViewerRelation({
      reservedByUserId: AUTH,
      slotXUserId: "@Creator_A",
      authUserId: AUTH,
      activeXId: "creator_a",
    }),
    "active",
  );
});

test("resolveSlotViewerRelation: slotX が null なら unassigned", () => {
  assert.equal(
    resolveSlotViewerRelation({
      reservedByUserId: AUTH,
      slotXUserId: null,
      authUserId: AUTH,
      activeXId: X_A,
    }),
    "unassigned",
  );
  assert.equal(
    resolveSlotViewerRelation({
      reservedByUserId: AUTH,
      slotXUserId: "",
      authUserId: AUTH,
      activeXId: X_A,
    }),
    "unassigned",
  );
});

test("resolveSlotViewerRelation: slotX が activeX と不一致なら account_other", () => {
  assert.equal(
    resolveSlotViewerRelation({
      reservedByUserId: AUTH,
      slotXUserId: X_A,
      authUserId: AUTH,
      activeXId: X_B,
    }),
    "account_other",
  );
});

test("resolveSlotViewerRelation: activeX なしで slotX ありは account_other", () => {
  assert.equal(
    resolveSlotViewerRelation({
      reservedByUserId: AUTH,
      slotXUserId: X_A,
      authUserId: AUTH,
      activeXId: null,
    }),
    "account_other",
  );
});

test("canActAsSlotActor: active と unassigned のみ true", () => {
  assert.equal(canActAsSlotActor("active"), true);
  assert.equal(canActAsSlotActor("unassigned"), true);
  assert.equal(canActAsSlotActor("account_other"), false);
  assert.equal(canActAsSlotActor("none"), false);
});

test("resolveSlotGroupIdentity: reserved_by 混在は mixed_auth_user", () => {
  assert.deepEqual(
    resolveSlotGroupIdentity({
      reservedByUserIds: [AUTH, OTHER_AUTH],
      slotXUserIds: [null, null],
      authUserId: AUTH,
      activeXId: X_A,
    }),
    { ok: false, reason: "mixed_auth_user" },
  );
  assert.deepEqual(
    resolveSlotGroupIdentity({
      reservedByUserIds: [AUTH, null],
      slotXUserIds: [null, null],
      authUserId: AUTH,
      activeXId: X_A,
    }),
    { ok: false, reason: "mixed_auth_user" },
  );
});

test("resolveSlotGroupIdentity: reserved_by が auth と不一致は mixed_auth_user", () => {
  assert.deepEqual(
    resolveSlotGroupIdentity({
      reservedByUserIds: [OTHER_AUTH],
      slotXUserIds: [null],
      authUserId: AUTH,
      activeXId: X_A,
    }),
    { ok: false, reason: "mixed_auth_user" },
  );
});

test("resolveSlotGroupIdentity: 非 null x が 2 種類以上は mixed_non_null_x", () => {
  assert.deepEqual(
    resolveSlotGroupIdentity({
      reservedByUserIds: [AUTH, AUTH],
      slotXUserIds: [X_A, X_B],
      authUserId: AUTH,
      activeXId: X_A,
    }),
    { ok: false, reason: "mixed_non_null_x" },
  );
});

test("resolveSlotGroupIdentity: 非 null 1 種・active 一致・null 行なし", () => {
  assert.deepEqual(
    resolveSlotGroupIdentity({
      reservedByUserIds: [AUTH, AUTH],
      slotXUserIds: [X_A, X_A],
      authUserId: AUTH,
      activeXId: X_A,
    }),
    { ok: true, targetXId: X_A, adoptNullRows: false },
  );
});

test("resolveSlotGroupIdentity: null+A 行・Active A は adopt", () => {
  assert.deepEqual(
    resolveSlotGroupIdentity({
      reservedByUserIds: [AUTH, AUTH],
      slotXUserIds: [null, X_A],
      authUserId: AUTH,
      activeXId: X_A,
    }),
    { ok: true, targetXId: X_A, adoptNullRows: true },
  );
});

test("resolveSlotGroupIdentity: 非 null 1 種・active 不一致は different_active_x", () => {
  assert.deepEqual(
    resolveSlotGroupIdentity({
      reservedByUserIds: [AUTH],
      slotXUserIds: [X_A],
      authUserId: AUTH,
      activeXId: X_B,
    }),
    { ok: false, reason: "different_active_x" },
  );
  assert.deepEqual(
    resolveSlotGroupIdentity({
      reservedByUserIds: [AUTH, AUTH],
      slotXUserIds: [X_A, X_A],
      authUserId: AUTH,
      activeXId: X_B,
    }),
    { ok: false, reason: "different_active_x" },
  );
});

test("resolveSlotGroupIdentity: 全部 A・Active null は different_active_x", () => {
  assert.deepEqual(
    resolveSlotGroupIdentity({
      reservedByUserIds: [AUTH, AUTH],
      slotXUserIds: [X_A, X_A],
      authUserId: AUTH,
      activeXId: null,
    }),
    { ok: false, reason: "different_active_x" },
  );
  assert.deepEqual(
    resolveSlotGroupIdentity({
      reservedByUserIds: [AUTH, AUTH],
      slotXUserIds: [null, X_A],
      authUserId: AUTH,
      activeXId: null,
    }),
    { ok: false, reason: "different_active_x" },
  );
});

test("resolveSlotGroupIdentity: 全部 null・active あり", () => {
  assert.deepEqual(
    resolveSlotGroupIdentity({
      reservedByUserIds: [AUTH, AUTH],
      slotXUserIds: [null, null],
      authUserId: AUTH,
      activeXId: X_A,
    }),
    { ok: true, targetXId: X_A, adoptNullRows: true },
  );
});

test("resolveSlotGroupIdentity: 全部 null・active なし", () => {
  assert.deepEqual(
    resolveSlotGroupIdentity({
      reservedByUserIds: [AUTH],
      slotXUserIds: [null],
      authUserId: AUTH,
      activeXId: null,
    }),
    { ok: true, targetXId: null, adoptNullRows: false },
  );
});
