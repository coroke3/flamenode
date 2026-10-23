// MIG-0618: the pure X ID merge helpers run without any host. The SQL/audit/queue behaviour of the
// whole flow is pinned by src/lib/xid/xidMergeGolden.execution.test.mjs.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  X_ID_MERGE_REVERT_WINDOW_SECONDS,
  assertMergeRequest,
  parseSnapshot,
} from "../src/xid/mergeCore.ts";

const request = (overrides = {}) => ({
  request_type: "merge",
  status: "approved",
  source_x_user_id: " @Old_ID ",
  target_x_user_id: "new_id",
  ...overrides,
});

test("assertMergeRequest canonicalises presentation differences", () => {
  assert.deepEqual(assertMergeRequest(request()), { source: "old_id", target: "new_id" });
  assert.equal(X_ID_MERGE_REVERT_WINDOW_SECONDS, 604800);
});

test("assertMergeRequest rejects non-approved, missing and self merges", () => {
  assert.throws(() => assertMergeRequest(request({ status: "pending" })), /承認済み/);
  assert.throws(() => assertMergeRequest(request({ source_x_user_id: null })), /ありません/);
  assert.throws(() => assertMergeRequest(request({ target_x_user_id: "  " })), /正規化できません/);
  assert.throws(() => assertMergeRequest(request({ target_x_user_id: "OLD_id" })), /同一/);
});

test("parseSnapshot validates version/shape and defaults optional relations", () => {
  assert.throws(() => parseSnapshot("{"), /JSON/);
  assert.throws(() => parseSnapshot(JSON.stringify({ version: 1 })), /不正/);
  const parsed = parseSnapshot(
    JSON.stringify({
      version: 2,
      source_x_user_id: "a",
      target_x_user_id: "b",
      source_x_user: { id: "a" },
      target_x_user: { id: "b" },
      active_users: [],
      account_links: [],
      videos: [],
      video_chapters: [],
      video_members: [],
      slots: [],
      video_interactions: [],
      event_staff: [],
      aliases: [],
    }),
  );
  assert.deepEqual(parsed.video_event_links, []);
  assert.deepEqual(parsed.slot_reservation_groups, []);
  assert.deepEqual(parsed.video_moderation_cases, []);
});
