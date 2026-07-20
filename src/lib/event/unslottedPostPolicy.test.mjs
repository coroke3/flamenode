import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isUnslottedPostAllowed,
  unslottedPostPolicyLabel,
} from "./unslottedPostPolicy.ts";

const NOW = 2_000_000_000;

const event = (overrides = {}) => ({
  allow_unslotted_posts: 0,
  end_time: NOW - 1,
  visibility_status: "public",
  ...overrides,
});

test("公開イベントは終了後に自動で枠なし投稿を許可する", () => {
  assert.equal(isUnslottedPostAllowed(event(), NOW), true);
});

test("終了前は個別許可がなければ拒否する", () => {
  assert.equal(
    isUnslottedPostAllowed(event({ end_time: NOW + 1 }), NOW),
    false,
  );
});

test("個別許可された公開イベントは終了前でも許可する", () => {
  assert.equal(
    isUnslottedPostAllowed(
      event({ allow_unslotted_posts: 1, end_time: NOW + 3600 }),
      NOW,
    ),
    true,
  );
});

test("privateイベントは拒否する", () => {
  assert.equal(
    isUnslottedPostAllowed(
      event({ allow_unslotted_posts: 1, visibility_status: "private" }),
      NOW,
    ),
    false,
  );
});

test("旧draftとarchivedは読み替えず拒否する", () => {
  assert.equal(
    isUnslottedPostAllowed(event({ visibility_status: "draft" }), NOW),
    false,
  );
  assert.equal(
    isUnslottedPostAllowed(event({ visibility_status: "archived" }), NOW),
    false,
  );
});

test("終了日時がないイベントは自動許可しない", () => {
  assert.equal(isUnslottedPostAllowed(event({ end_time: null }), NOW), false);
});

test("設定ラベルは正本の0/1だけを扱う", () => {
  assert.equal(
    unslottedPostPolicyLabel(0),
    "自動（終了前は不許可・終了後は許可）",
  );
  assert.equal(unslottedPostPolicyLabel(1), "開催前・開催中も許可");
});
