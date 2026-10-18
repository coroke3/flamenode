import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeXId,
  isCanonicalXId,
  parseCanonicalXId,
  parseXIdentityInput,
  normalizeXIdApprovalStatus,
  xIdApprovalRank,
  normalizeXIdEntries,
  sortXIdEntries,
  isUsableCanonicalXUserStatus,
  decideCanonicalXUserResolution,
  validateXIdentityRequestShape,
  toPublicXIdentityRequestDto,
  isRevertDeadlineOpen,
  buildXIdentityDecisionFields,
  validateActiveXSnapshot,
  ACTIVE_X_SNAPSHOT_MISMATCH_MESSAGE,
} from "../src/xid/index.ts";

describe("xid/format", () => {
  it("normalizes handles correctly", () => {
    assert.equal(normalizeXId("@User_1"), "user_1");
    assert.equal(normalizeXId("@@user_2"), "user_2");
    assert.equal(normalizeXId("  user_3  "), "user_3");
    assert.equal(normalizeXId(null), "");
  });

  it("checks canonical X handles", () => {
    assert.equal(isCanonicalXId("valid_handle"), true);
    assert.equal(isCanonicalXId("invalid handle!"), false);
    assert.equal(isCanonicalXId(""), false);
    assert.equal(isCanonicalXId("toolonghandletoolonghandle"), false);
  });

  it("parses UI inputs and URLs", () => {
    assert.equal(parseXIdentityInput("https://x.com/flamenode"), "flamenode");
    assert.equal(parseXIdentityInput("https://twitter.com/flamenode"), "flamenode");
    assert.equal(parseXIdentityInput("https://x.com/flamenode/"), "flamenode");
    assert.equal(parseXIdentityInput("https://x.com/flamenode?ref_src=twsrc"), "flamenode");
    assert.equal(parseXIdentityInput("https://x.com/flamenode#profile"), "flamenode");
    assert.equal(parseXIdentityInput("https://x.com/flamenode/status/12345"), null);
    assert.equal(parseXIdentityInput("https://evil.com/flamenode"), null);
    assert.equal(parseXIdentityInput("@@@@flamenode"), "flamenode");
    assert.equal(parseXIdentityInput("@FLAMENODE"), "flamenode");
    assert.equal(parseXIdentityInput(""), null);
    assert.equal(parseXIdentityInput("   "), null);
    assert.equal(parseXIdentityInput("user-with-hyphens"), null);
    assert.equal(parseCanonicalXId("https://x.com/valid_id"), "valid_id");
    assert.equal(parseCanonicalXId("invalid-id"), null);
    assert.equal(parseCanonicalXId(null), null);
    assert.equal(parseCanonicalXId(undefined), null);
  });
});

describe("xid/entries", () => {
  it("normalizes approval status and rank", () => {
    assert.equal(normalizeXIdApprovalStatus("approved"), "approved");
    assert.equal(normalizeXIdApprovalStatus("rejected"), "rejected");
    assert.equal(normalizeXIdApprovalStatus("other"), "pending");

    assert.equal(xIdApprovalRank("approved"), 0);
    assert.equal(xIdApprovalRank("pending"), 1);
    assert.equal(xIdApprovalRank("rejected"), 2);
  });

  it("normalizes and dedupes entries", () => {
    const entries = [
      { x_user_id: "@Alpha", x_name: "", icon_url: null, approval_status: "approved", is_active: false },
      { x_user_id: "alpha", x_name: "Duplicate", icon_url: null, approval_status: "approved", is_active: false },
      { x_user_id: "beta", x_name: "Beta Name", icon_url: null, approval_status: "pending", is_active: true },
    ];
    const normalized = normalizeXIdEntries(entries);
    assert.equal(normalized.length, 2);
    assert.equal(normalized[0].x_user_id, "alpha");
    assert.equal(normalized[0].x_name, "@alpha");
    assert.equal(normalized[1].x_user_id, "beta");
  });

  it("sorts entries with rank and active priority", () => {
    const entries = [
      { x_user_id: "c", x_name: "Charlie", icon_url: null, approval_status: "rejected", is_active: false },
      { x_user_id: "b", x_name: "Bravo", icon_url: null, approval_status: "approved", is_active: false },
      { x_user_id: "a", x_name: "Alpha", icon_url: null, approval_status: "pending", is_active: true },
    ];
    const sorted = sortXIdEntries(entries, { activeId: "a", activeFirst: true });
    assert.equal(sorted[0].x_user_id, "a");
    assert.equal(sorted[1].x_user_id, "b");
    assert.equal(sorted[2].x_user_id, "c");
  });
});

describe("xid/resolution", () => {
  it("validates usable canonical status", () => {
    assert.equal(isUsableCanonicalXUserStatus("approved"), true);
    assert.equal(isUsableCanonicalXUserStatus("pending"), true);
    assert.equal(isUsableCanonicalXUserStatus("imported"), true);
    assert.equal(isUsableCanonicalXUserStatus("rejected"), false);
  });

  it("resolves canonical and aliases with fail-closed policy", () => {
    const resEmpty = decideCanonicalXUserResolution({
      candidate: "",
      aliases: [],
      directRows: [],
    });
    assert.equal(resEmpty.reason, "empty");

    const resCanon = decideCanonicalXUserResolution({
      candidate: "Alice",
      aliases: [],
      directRows: [{ id: "alice", approval_status: "approved" }],
    });
    assert.equal(resCanon.value, "alice");
    assert.equal(resCanon.reason, "resolved_canonical");

    const resAlias = decideCanonicalXUserResolution({
      candidate: "OldAlice",
      aliases: [{ alias_x_id: "oldalice", target_x_user_id: "newalice", target_approval_status: "approved" }],
      directRows: [],
    });
    assert.equal(resAlias.value, "newalice");
    assert.equal(resAlias.reason, "resolved_alias");

    // Null safety & sparse arrays
    assert.deepEqual(decideCanonicalXUserResolution(undefined), { value: null, reason: "empty" });
    assert.deepEqual(decideCanonicalXUserResolution({}), { value: null, reason: "empty" });
    assert.deepEqual(
      decideCanonicalXUserResolution({
        candidate: "sparse",
        aliases: [null, undefined],
        directRows: [null, undefined, { id: "sparse", approval_status: "approved" }],
      }),
      { value: "sparse", reason: "resolved_canonical" },
    );
  });
});

describe("xid/requests", () => {
  it("validates request shape", () => {
    assert.equal(
      validateXIdentityRequestShape({ requestType: "new_link", requestedXId: null }),
      "new_link には requested_x_id が必要です。",
    );
    assert.equal(
      validateXIdentityRequestShape({ requestType: "new_link", requestedXId: "valid_id" }),
      null,
    );
    assert.equal(
      validateXIdentityRequestShape({ requestType: "merge", sourceXUserId: "foo", targetXUserId: "@foo" }),
      "merge の source と target は別の X ID にしてください。",
    );
  });

  it("projects public DTO", () => {
    const record = {
      id: "req_1",
      request_type: "new_link",
      requested_by_auth_user_id: "user_secret_123",
      requested_x_id: "handle",
      source_x_user_id: null,
      target_x_user_id: null,
      parent_request_id: null,
      restore_snapshot_json: '{"private":"data"}',
      revert_deadline_at: 1234567890,
      status: "pending",
      requested_at: 1000,
      updated_at: 2000,
    };
    const dto = toPublicXIdentityRequestDto(record);
    assert.equal(dto.id, "req_1");
    assert.equal(dto.request_type, "new_link");
    assert.equal("requested_by_auth_user_id" in dto, false);
    assert.equal("restore_snapshot_json" in dto, false);
  });

  it("checks revert deadline and builds decision fields", () => {
    assert.equal(isRevertDeadlineOpen(2000, 1000), true);
    assert.equal(isRevertDeadlineOpen(1000, 2000), false);

    const decision = buildXIdentityDecisionFields({
      decidedByAuthUserId: "admin_1",
      decisionReason: "approved by admin",
      decidedAt: 12345,
    });
    assert.equal(decision.decided_by_auth_user_id, "admin_1");
    assert.equal(decision.decision_reason, "approved by admin");
    assert.equal(decision.decided_at, 12345);
  });
});

describe("xid/activeXSnapshot", () => {
  it("validates submitted active X snapshot matches current", () => {
    assert.deepEqual(
      validateActiveXSnapshot({ submittedSnapshot: "@handle", currentActiveXId: "handle" }),
      { ok: true },
    );
    assert.deepEqual(
      validateActiveXSnapshot({ submittedSnapshot: "@different", currentActiveXId: "handle" }),
      { ok: false, message: ACTIVE_X_SNAPSHOT_MISMATCH_MESSAGE },
    );
  });
});
