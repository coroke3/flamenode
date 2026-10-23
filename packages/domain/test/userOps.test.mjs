// MIG-0306 U04: data/operations rules (SA-069, 074..080, 090..105).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isLatestTermsAlreadyAccepted,
  parseSetUserBannedInput,
  parseSetUserCanCreateEventsInput,
  parseSetUserNotificationsInput,
  parseSetUserRoleInput,
  userNotificationsAuditReason,
} from "@flamenode/domain/user";
import {
  parseStaticBackfillState,
  withStaticBackfillRun,
} from "@flamenode/domain/admin";
import {
  isRetryableXIdMutationError,
  processedXIdRequestMessage,
  reconcilePendingXIdRequest,
} from "@flamenode/domain/xid";
import { isTransientDbError } from "@flamenode/domain/db/transientError";

const actor = "auth-admin";

test("SA-077: an admin cannot drop their own admin role", () => {
  assert.deepEqual(parseSetUserRoleInput({ user_id: actor, role: "moderator" }, actor), {
    ok: false, message: "自分自身の管理者権限は解除できません。",
  });
  assert.deepEqual(parseSetUserRoleInput({ user_id: actor, role: "admin" }, actor), {
    ok: true, user_id: actor, role: "admin",
  });
  assert.equal(parseSetUserRoleInput({ user_id: "u", role: "staff" }, actor).ok, false);
});

test("T03 / SA-078: BAN needs a reason, no self-ban, unban is audited as BAN解除", () => {
  assert.deepEqual(parseSetUserBannedInput({ user_id: actor, is_banned: "1", reason: "spam" }, actor), {
    ok: false, message: "自分自身をBANにはできません。",
  });
  assert.deepEqual(parseSetUserBannedInput({ user_id: "u", is_banned: "1", reason: " " }, actor), {
    ok: false, message: "BANには理由が必要です。",
  });
  assert.deepEqual(parseSetUserBannedInput({ user_id: "u", is_banned: "1", reason: "spam" }, actor), {
    ok: true, user_id: "u", is_banned: 1, auditReason: "spam",
  });
  assert.deepEqual(parseSetUserBannedInput({ user_id: "u", is_banned: "0" }, actor), {
    ok: true, user_id: "u", is_banned: 0, auditReason: "BAN解除",
  });
  assert.equal(parseSetUserBannedInput({ user_id: "u", is_banned: "2", reason: "x" }, actor).ok, false);
});

test("SA-079/080 inputs and notification audit reason", () => {
  assert.deepEqual(parseSetUserNotificationsInput({ user_id: " u ", is_notification_enabled: "0" }), {
    ok: true, user_id: "u", is_notification_enabled: 0,
  });
  assert.deepEqual(parseSetUserCanCreateEventsInput({ user_id: "u", can_create_events: "1" }), {
    ok: true, user_id: "u", can_create_events: 1,
  });
  assert.equal(parseSetUserCanCreateEventsInput({ user_id: "", can_create_events: "1" }).ok, false);
  assert.equal(userNotificationsAuditReason(true, 3), "通知をOFFにし、未送信のpending通知3件をキャンセル");
  assert.equal(userNotificationsAuditReason(false, 0), "通知をONに変更");
});

test("SA-074..076: already accepted only for the same version with no pending re-accept", () => {
  const user = { accepted_terms_version_id: "tv1", is_tos_accepted: 1, terms_reaccept_required: 0 };
  assert.equal(isLatestTermsAlreadyAccepted(user, "tv1"), true);
  assert.equal(isLatestTermsAlreadyAccepted(user, "tv2"), false);
  assert.equal(isLatestTermsAlreadyAccepted({ ...user, terms_reaccept_required: 1 }, "tv1"), false);
  assert.equal(isLatestTermsAlreadyAccepted({ ...user, is_tos_accepted: null }, "tv1"), false);
});

test("SA-069: backfill state is normalized and runs are replaced immutably", () => {
  const state = parseStaticBackfillState({ schema_version: 1, runs: { video_v2: { status: "bogus", total: -3 } } });
  assert.equal(state.runs.video_v2.status, "idle");
  assert.equal(state.runs.video_v2.total, 0);
  const next = withStaticBackfillRun(state, "user_profile", { ...state.runs.user_profile, status: "running" }, 9);
  assert.equal(next.updated_at, 9);
  assert.equal(state.runs.user_profile.status, "idle");
});

test("SA-090..105: request retry classification and reconciliation", () => {
  assert.equal(isRetryableXIdMutationError(new Error("SQLITE_CONSTRAINT: UNIQUE")), true);
  assert.equal(isRetryableXIdMutationError({ message: "x", cause: { code: "SQLITE_BUSY" } }), true);
  assert.equal(isRetryableXIdMutationError(new Error("no such column")), false);
  assert.equal(isTransientDbError(new Error("D1_ERROR: internal error")), true);
  assert.deepEqual(reconcilePendingXIdRequest({ matchingPendingRequestId: "r1", pendingCount: 9 }), {
    outcome: "accepted", requestId: "r1",
  });
  assert.deepEqual(reconcilePendingXIdRequest({ matchingPendingRequestId: null, pendingCount: 5 }), { outcome: "limit" });
  assert.deepEqual(processedXIdRequestMessage("done", "approve"), { ok: true, message: "この申請はすでに承認済みです。" });
  assert.equal(processedXIdRequestMessage("approved", "reject").ok, false);
});
