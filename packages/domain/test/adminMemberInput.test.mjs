import assert from "node:assert/strict";
import { test } from "node:test";
import { readAdminVideoCollabFlag } from "../src/video/adminMemberInput.ts";

test("SA-085 FormData collaboration flag preserves CURRENT checkbox semantics", () => {
  const cases = [
    [[], false],
    [["on"], true],
    [["true"], true],
    [["off"], false],
    [["false"], false],
    [["1"], false],
    [["TRUE"], false],
    [["", "on"], true],
    [["off", "true"], true],
    [["off", "false"], false],
  ];
  for (const [values, expected] of cases) {
    const fd = new FormData();
    for (const value of values) fd.append("is_collab", value);
    fd.append("video_id", "v1");
    assert.equal(readAdminVideoCollabFlag(fd), expected, JSON.stringify(values));
  }
});

test("SA-085 unrelated FormData entries cannot enable the collaboration flag", () => {
  const fd = new FormData();
  fd.append("other", "on");
  fd.append("is_collab_extra", "true");
  assert.equal(readAdminVideoCollabFlag(fd), false);
});
