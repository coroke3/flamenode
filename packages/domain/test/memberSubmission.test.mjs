import test from "node:test";
import assert from "node:assert/strict";
import { validateVideoMemberSubmission } from "@flamenode/domain/video";
import { validateVideoMemberSubmission as legacyValidate } from "../../../src/lib/video/submissionValidation.ts";

function form(json) {
  const f = new FormData();
  if (json !== undefined) f.set("members_json", json);
  return f;
}
test("MIG-0651: CURRENT/target share exact member-submission validation", () => {
  assert.strictEqual(validateVideoMemberSubmission, legacyValidate);
});
test("MIG-0651: no cooperation does not parse malicious member JSON", () => {
  const value = validateVideoMemberSubmission(form("{broken"), false);
  assert.deepEqual(value, {ok:true, value:{members:[],chaptersByIndex:new Map()}});
  assert.equal(validateVideoMemberSubmission(form("{broken"), true).ok,false);
});
test("MIG-0651: member chapters stay indexed with fallback role and zero member chapter maps", () => {
  const members = [
    { name:"Alice",x_user_id:"@Alice",role:"Editor",chapters:[{time:"1:01",label:"",note:" notes "}] },
    { name:"Bob",x_user_id:"",chapters:[] },
  ];
  const res = validateVideoMemberSubmission(form(JSON.stringify(members)),true);
  assert.equal(res.ok,true);
  if(!res.ok)return;
  assert.deepEqual(res.value.members.map(x=>x.x_user_id),["alice",""]);
  assert.deepEqual([...res.value.chaptersByIndex.entries()],[
    [0,[{time_seconds:61,label:"Editor",note:"notes",order_index:0}]],
    [1,[]],
  ]);
});
test("MIG-0651: invalid chapters and duplicate X IDs fail before D1 work", () => {
  const badTime = validateVideoMemberSubmission(form(JSON.stringify([{name:"Bad",x_user_id:"x",chapters:[{time:"1:99"}]}])),true);
  assert.equal(badTime.ok,false);
  assert.match(badTime.message,/時刻/);
  const duplicate = validateVideoMemberSubmission(form(JSON.stringify([{name:"a",x_user_id:"@A"},{name:"b",x_user_id:"a"}])),true);
  assert.equal(duplicate.ok,false);
  assert.match(duplicate.message,/同じ X ID/);
});
