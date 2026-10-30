import test from "node:test";
import assert from "node:assert/strict";
import { parseVideoMemberInputs, normalizeMemberChapters, parseMemberChapterTime } from "@flamenode/domain/video";
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
