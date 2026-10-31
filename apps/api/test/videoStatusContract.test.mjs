import assert from "node:assert/strict";
import { test } from "node:test";
import {
  AdminVideoStatusBodySchema,
  ManageVideoStatusBodySchema,
  normalizeAdminVideoStatusBody,
  normalizeManageVideoStatusBody,
} from "../../../packages/contracts/src/videoStatus.ts";
import {
  validateAdminVideoStatusInput,
  validateManageVideoStatusInput,
} from "../../../packages/domain/src/video/visibility.ts";

const admin = (raw) => normalizeAdminVideoStatusBody(AdminVideoStatusBodySchema.parse(raw));
const manage = (raw) => normalizeManageVideoStatusBody(ManageVideoStatusBodySchema.parse(raw));

test("SA-001..003: preserve CURRENT FormData scalar coercion, trim, and absent inputs", () => {
  assert.deepEqual(admin({}), {
    videoId: "", status: "", reason: "", caseId: "",
    andNext: false, forceNotify: false, voidReasonCategory: "",
    adminEventFilter: undefined,
  });
  assert.deepEqual(admin({
    video_id: "  v-1  ", status: " public ", reason: " r ",
    case_id: " c ", and_next: "1", force_notify: "1",
    void_reason_category: " spam ", review_event_id: " event-1 ",
  }), {
    videoId: "v-1", status: "public", reason: "r", caseId: "c",
    andNext: true, forceNotify: true, voidReasonCategory: "spam",
    adminEventFilter: "event-1",
  });
  assert.equal(admin({ video_id: 123, status: true, reason: null }).videoId, "123");
  assert.equal(admin({ video_id: 123, status: true, reason: null }).status, "true");
});

test("SA-001..003: only exact string '1' means true after FormData-style conversion", () => {
  for (const flag of ["", "0", "true", true, false, " 2 ", null]) {
    assert.equal(admin({ and_next: flag, force_notify: flag }).andNext, false, String(flag));
    assert.equal(admin({ and_next: flag, force_notify: flag }).forceNotify, false, String(flag));
  }
  assert.equal(admin({ and_next: 1, force_notify: 1 }).andNext, true);
  assert.equal(admin({ and_next: 1, force_notify: 1 }).forceNotify, true);
  assert.equal(admin({ and_next: " 1 ", force_notify: " 1 " }).andNext, true);
});

test("SA-001..003: invalid review filter silently drops; no length truncation", () => {
  assert.equal(admin({ review_event_id: "x".repeat(128) }).adminEventFilter, "x".repeat(128));
  assert.equal(admin({ review_event_id: "x".repeat(129) }).adminEventFilter, undefined);
  assert.equal(admin({ review_event_id: "   " }).adminEventFilter, undefined);
});

test("SA-001..003: CURRENT admin status validator owns errors, voided requires reason", () => {
  for (const status of ["pending", "public", "private", "voided"]) {
    const input = admin({ video_id: "v", status, reason: "reason" });
    assert.deepEqual(validateAdminVideoStatusInput(input), { ok: true }, status);
  }
  const invalid = [
    [{ video_id: "", status: "public" }, "video_idが不正です。"],
    [{ video_id: "x".repeat(129), status: "public" }, "video_idが不正です。"],
    [{ video_id: "v", status: "unknown" }, "不正なステータスです。"],
    [{ video_id: "v", status: "voided" }, "voidedへの変更には理由が必要です。"],
  ];
  for (const [raw, message] of invalid) {
    assert.deepEqual(validateAdminVideoStatusInput(admin(raw)), { ok: false, message });
  }
});

test("SA-040..042: manage status has a separate scope and never accepts voided", () => {
  assert.deepEqual(manage({
    event_id: " event ", video_id: " video ", status: " public ",
    reason: " why ", and_next: "1",
  }), { eventId: "event", videoId: "video", status: "public", reason: "why", andNext: true });
  for (const status of ["pending", "public", "private"]) {
    assert.deepEqual(validateManageVideoStatusInput(manage({
      event_id: "e", video_id: "v", status,
    })), { ok: true });
  }
  assert.deepEqual(validateManageVideoStatusInput(manage({
    event_id: "e", video_id: "v", status: "voided",
  })), { ok: false, message: "このステータスへは変更できません。" });
  assert.deepEqual(validateManageVideoStatusInput(manage({
    event_id: "", video_id: "v", status: "public",
  })), { ok: false, message: "event_id と video_id が必要です。" });
});

test("Transport JSON rejects structured object/array values and never confuses role scopes", () => {
  assert.equal(AdminVideoStatusBodySchema.safeParse({ status: ["public"] }).success, false);
  assert.equal(ManageVideoStatusBodySchema.safeParse({ event_id: { id: "e" } }).success, false);
  // Admin-only force_notify, case_id and review fields are not managed-action inputs.
  assert.equal("forceNotify" in manage({ force_notify: "1" }), false);
  assert.equal("caseId" in manage({ case_id: "c" }), false);
  assert.equal("adminEventFilter" in manage({ review_event_id: "e" }), false);
});
