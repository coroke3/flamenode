import assert from "node:assert/strict";
import { test } from "node:test";
import { parseVideoMemberInputs } from "./memberInputs.ts";

test("parseVideoMemberInputs rejects invalid JSON", () => {
  const result = parseVideoMemberInputs("{not json", true);
  assert.equal(result.ok, false);
});

test("parseVideoMemberInputs accepts valid members with chapters", () => {
  const json = JSON.stringify([
    {
      name: "Alice",
      x_user_id: "@alice",
      role: "Edit",
      comment: "",
      chapters: [{ time: "1:30", label: "Intro", note: "" }],
    },
  ]);
  const result = parseVideoMemberInputs(json, true);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.members.length, 1);
    assert.equal(result.members[0].x_user_id, "alice");
  }
});

test("parseVideoMemberInputs returns empty list when not collab", () => {
  const result = parseVideoMemberInputs("[]", false);
  assert.equal(result.ok, true);
  if (result.ok) assert.deepEqual(result.members, []);
});
