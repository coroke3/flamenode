import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { parseAdminVideoMembersHttpInput } from "../src/video/adminMemberHttpInput.ts";
import { readAdminVideoCollabFlag } from "../src/video/adminMemberInput.ts";
import { validateVideoMemberSubmission } from "../src/video/adminMemberSubmission.ts";

const makeMember = (id) => ({
  name: "Member " + id,
  x_user_id: "member_" + id,
  role: "",
  comment: "",
  chapters: [{ time: "1:02", label: "Intro", note: "" }],
});

function getBody(overrides = {}) {
  return {
    is_collab: "on",
    members_json: JSON.stringify([makeMember(0)]),
    ...overrides,
  };
}

test("MIG-0650 U03d-1: JSON keys become exactly the existing SA-085 FormData fields", () => {
  const input = getBody();
  const parsed = parseAdminVideoMembersHttpInput("video_1", input);
  assert.equal(parsed.ok, true);
  assert.deepEqual([...parsed.formData.keys()], ["video_id", "is_collab", "members_json"]);
  assert.equal(parsed.formData.get("video_id"), "video_1");
  assert.equal(parsed.formData.get("members_json"), input.members_json);
  assert.equal(readAdminVideoCollabFlag(parsed.formData), true);
  const downstream = validateVideoMemberSubmission(parsed.formData, true);
  assert.equal(downstream.ok, true);
  assert.equal(downstream.value.members[0].x_user_id, "member_0");
  assert.equal(downstream.value.chaptersByIndex.get(0)[0].time_seconds, 62);
});

test("MIG-0650 U03d-1: preserve CURRENT checkbox literal and repeated-value behavior", () => {
  const inputs = [
    [undefined, false],
    ["", false],
    ["off", false],
    ["false", false],
    ["on", true],
    ["true", true],
    [["off", "on"], true],
    [["false", "true"], true],
    [["off", "false"], false],
  ];
  for (const [checkbox, expected] of inputs) {
    const payload = checkbox === undefined ? {} : { is_collab: checkbox };
    const parsed = parseAdminVideoMembersHttpInput("v1", payload);
    assert.equal(parsed.ok, true);
    assert.equal(readAdminVideoCollabFlag(parsed.formData), expected);
    const validated = validateVideoMemberSubmission(parsed.formData, expected);
    assert.deepEqual(validated, {
      ok: true, value: { members: [], chaptersByIndex: new Map() },
    });
  }
});

test("MIG-0650 U03d-1: 100 accepted, 101 rejected by unchanged CURRENT validator", () => {
  for (const [count, permitted] of [[100, true], [101, false]]) {
    const parsed = parseAdminVideoMembersHttpInput("v1", {
      is_collab: "true",
      members_json: JSON.stringify(Array.from({ length: count }, (_, i) => makeMember(i))),
    });
    assert.equal(parsed.ok, true);
    const validated = validateVideoMemberSubmission(parsed.formData, readAdminVideoCollabFlag(parsed.formData));
    assert.equal(validated.ok, permitted);
    if (permitted) assert.equal(validated.value.members.length, 100);
    else assert.match(validated.message, /100/);
  }
});

test("MIG-0650 U03d-1: malformed path, body ID override and hidden keys fail closed", () => {
  const bad = [
    ["", {}],
    [" bad", {}],
    ["bad ", {}],
    [".", {}],
    ["..", {}],
    ["../other", {}],
    ["video/child", {}],
    ["a\0b", {}],
    ["v".repeat(65), {}],
    ["\uD800", {}],
    ["v1", null],
    ["v1", []],
    ["v1", "hi"],
    ["v1", { video_id: "v1" }],
    ["v1", { video_id: "other" }],
    ["v1", { can_edit: true }],
    ["v1", { is_collab: true }],
    ["v1", { is_collab: [true] }],
    ["v1", { is_collab: Array.from({ length: 17 }, () => "off") }],
    ["v1", { members_json: [] }],
    ["v1", { members_json: null }],
  ];
  for (const [path, body] of bad) {
    const parsed = parseAdminVideoMembersHttpInput(path, body);
    assert.equal(parsed.ok, false, "failed to reject path/body");
  }
});

test("MIG-0650 U03d-1: malformed members JSON is passed to the same validator, not silently discarded", () => {
  const parsed = parseAdminVideoMembersHttpInput("v1", { is_collab: "on", members_json: "{" });
  assert.equal(parsed.ok, true);
  const validated = validateVideoMemberSubmission(parsed.formData, true);
  assert.deepEqual(validated, { ok: false, message: "合作メンバーの JSON が不正です。" });
});

test("MIG-0650 U03d-1: new input adapter stays unmounted and never accesses D1", async () => {
  const router = await readFile(new URL("../../../apps/api/src/routes/videos/index.ts", import.meta.url), "utf8");
  const adapter = await readFile(new URL("../src/video/adminMemberHttpInput.ts", import.meta.url), "utf8");
  assert.doesNotMatch(router, /adminMemberHttpInput|createAdminVideoMembersRoutes/);
  assert.doesNotMatch(adapter, /@\/|from "next|from "hono|from "drizzle|\.batch\(|\.prepare\(/);
});
