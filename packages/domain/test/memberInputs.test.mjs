import test from "node:test";
import assert from "node:assert/strict";
import { parseVideoMemberInputs, normalizeMemberChapters, parseMemberChapterTime, MAX_MEMBERS_JSON_BYTES } from "@flamenode/domain/video";
import {
  parseVideoMemberInputs as legacyParse,
  normalizeMemberChapters as legacyNormalize,
} from "../../../src/lib/video/memberInputs.ts";
import { parseMemberChapterTime as legacyTime } from "../../../src/lib/video/memberInput.ts";

test("MIG-0651: CURRENT member parser, chapter normalizer and time parser are canonical domain exports", () => {
  assert.strictEqual(parseVideoMemberInputs, legacyParse);
  assert.strictEqual(normalizeMemberChapters, legacyNormalize);
  assert.strictEqual(parseMemberChapterTime, legacyTime);
});
test("MIG-0651: non-collab ignores malicious member payload; collab empty and invalid JSON", () => {
  assert.deepEqual(parseVideoMemberInputs("{invalid", false), { ok: true, members: [] });
  assert.deepEqual(parseVideoMemberInputs(null, true), { ok: true, members: [] });
  assert.deepEqual(parseVideoMemberInputs(" ", true), { ok: true, members: [] });
  assert.deepEqual(parseVideoMemberInputs("not-json", true), { ok: false, message: "合作メンバーの JSON が不正です。" });
});
test("MIG-0651: File-valued members_json is not an optional blank on collaboration", () => {
  const file = new File([JSON.stringify([{ name: "Alice", x_user_id: "@alice" }])], "members.json", {
    type: "application/json",
  });
  assert.deepEqual(parseVideoMemberInputs(file, true), {
    ok: false, message: "合作メンバーの入力が不正です。",
  });
  assert.deepEqual(parseVideoMemberInputs(file, false), {
    ok: true, members: [],
  }, "non-collab continues ignoring member metadata");
  assert.deepEqual(parseVideoMemberInputs(null, true), { ok: true, members: [] });
});

test("MIG-0651: member identities are canonical, duplicate X IDs rejected, and 100 is limit", () => {
  const one = parseVideoMemberInputs(JSON.stringify([
    { name: " Alice ", x_user_id: "@Alice", role: "editor", comment: "Hello", chapters: [{ time: "1:05", label: "", note: "" }] },
    { name: "", x_user_id: "", role: "", comment: "" },
    { name: "", x_user_id: "@Bob" },
  ]), true);
  assert.equal(one.ok, true);
  if(one.ok) {
    assert.deepEqual(one.members.map(x => x.x_user_id), ["alice", "bob"]);
    assert.deepEqual(one.members.map(x => x.name), ["Alice", "@bob"]);
  }
  const duplicate = parseVideoMemberInputs(JSON.stringify([
    { name: "a", x_user_id: "@Alice" }, { name: "b", x_user_id: "alice" }
  ]), true);
  assert.equal(duplicate.ok, false);
  assert.match(duplicate.message, /同じ X ID/);
  const invalid = parseVideoMemberInputs(JSON.stringify([{ name: "bad", x_user_id: "invalid-name" }]), true);
  assert.equal(invalid.ok, false);
  assert.match(invalid.message, /X ID が不正/);
  assert.equal(parseVideoMemberInputs(JSON.stringify(Array.from({length:100},(_,i)=>({name:"Person "+i,x_user_id:""}))), true).ok, true);
  assert.equal(parseVideoMemberInputs(JSON.stringify(Array.from({length:101},(_,i)=>({name:"Person "+i,x_user_id:""}))), true).ok, false);
});
test("MIG-0651: nonempty but empty-after-normalization member X handles fail closed", () => {
  for (const invalidHandle of ["@", "@@@", " @ ", "@!", "@-"]) {
    const result = parseVideoMemberInputs(JSON.stringify([
      { name: "Not a blank X field", x_user_id: invalidHandle },
    ]), true);
    assert.equal(result.ok, false, JSON.stringify(invalidHandle));
    assert.match(result.message, /X ID が不正/, JSON.stringify(invalidHandle));
  }
  const optionalBlank = parseVideoMemberInputs(JSON.stringify([
    { name: "Name only", x_user_id: " " },
  ]), true);
  assert.equal(optionalBlank.ok, true, "an intentionally empty X handle remains optional");
  if (optionalBlank.ok) {
    assert.equal(optionalBlank.members[0].x_user_id, "");
  }
  const atHandle = parseVideoMemberInputs(JSON.stringify([
    { name: "Valid", x_user_id: "@Valid_X" },
  ]), true);
  assert.equal(atHandle.ok, true);
  if (atHandle.ok) assert.equal(atHandle.members[0].x_user_id, "valid_x");
});

test("MIG-0651: unnamed row with nonblank malformed X ID must not disappear silently", () => {
  for (const invalid of ["@", "@@@", "@!", " @ ", "@-", "#"]) {
    const result = parseVideoMemberInputs(JSON.stringify([
      { name: "", x_user_id: invalid },
    ]), true);
    assert.equal(result.ok, false, JSON.stringify(invalid));
    assert.match(result.message, /X ID が不正/, JSON.stringify(invalid));
  }
  const blank = parseVideoMemberInputs(JSON.stringify([
    { name: "", x_user_id: "" },
    { name: " ", x_user_id: " " },
  ]), true);
  assert.deepEqual(blank, { ok: true, members: [] }, "truly blank member rows are ignored");
  const withId = parseVideoMemberInputs(JSON.stringify([
    { name: "", x_user_id: "@valid_x" },
  ]), true);
  assert.equal(withId.ok, true);
  if (withId.ok) assert.deepEqual(withId.members.map(x => [x.name, x.x_user_id]), [["@valid_x", "valid_x"]]);
});

test("MIG-0651: chapter times preserve strict mm:ss format and fallback label", () => {
  assert.equal(parseMemberChapterTime("1:05"), 65);
  assert.equal(parseMemberChapterTime("1000:59"), 60059);
  for(const s of ["", "1", "1:60", "1:999", "1:05:00", "-1:05", "10000:01"]) assert.equal(parseMemberChapterTime(s), null);
  const member = {name:"Alice",x_user_id:"alice",role:"Reviewer",comment:"",chapters:[
    {time:"1:05",label:"",note:" a "},{time:"2:00",label:"Intro",note:""}
  ]};
  assert.deepEqual(normalizeMemberChapters(member,0),{ok:true,chapters:[
    {time_seconds:65,label:"Reviewer",note:"a",order_index:0},
    {time_seconds:120,label:"Intro",note:"",order_index:1},
  ]});
  const bad = normalizeMemberChapters({...member,chapters:[{time:"1:75",label:"",note:""}]},0);
  assert.equal(bad.ok,false);
  assert.match(bad.message,/時刻/);
});

test("MIG-0651: over-limit member arrays fail before deep per-member validation", () => {
  const massive = Array.from({ length: 10_000 }, () => ({
    name: "member", x_user_id: "", chapters: [{ time: "invalid", label: "", note: "" }],
  }));
  assert.deepEqual(parseVideoMemberInputs(JSON.stringify(massive), true), {
    ok: false, message: "合作メンバーは最大100人です。",
  }, "invalid nested member fields must not require 10,000 Zod traversals");
  assert.deepEqual(parseVideoMemberInputs(JSON.stringify(massive), false), {
    ok: true, members: [],
  }, "non-collab input is intentionally ignored");
  const atLimit = Array.from({ length: 100 }, (_, i) => ({
    name: "Person " + i, x_user_id: "",
  }));
  assert.equal(parseVideoMemberInputs(JSON.stringify(atLimit), true).ok, true,
    "the existing 100-member boundary remains accepted");
});


test("MIG-0651: 8 MiB shared member JSON byte cap rejects early, including multibyte UTF-8", () => {
  const tooManyAscii = "x".repeat(MAX_MEMBERS_JSON_BYTES + 1);
  const tooManyUtf8 = "あ".repeat(Math.floor(MAX_MEMBERS_JSON_BYTES / 3) + 1);
  const expected = { ok: false, message: "合作メンバーの入力が大きすぎます。" };
  assert.deepEqual(parseVideoMemberInputs(tooManyAscii, true), expected);
  assert.deepEqual(parseVideoMemberInputs(tooManyUtf8, true), expected,
    "UTF-16 length is below the cap but UTF-8 exceeds it");
  assert.deepEqual(parseVideoMemberInputs(tooManyAscii, false), { ok: true, members: [] },
    "non-collaboration continues to ignore members_json");
  assert.deepEqual(parseVideoMemberInputs("[]", true), { ok: true, members: [] });
});
