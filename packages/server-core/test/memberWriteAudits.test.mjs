import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { buildVideoMemberWriteAudits } from "../src/video/memberWriteAudits.ts";

const member = (id, extra = {}) => ({
  id, video_id:"v1", x_user_id:"alice", name:"Alice", role:null, comment:null,
  order_index:0, can_edit:0, is_public_member:1,
  edit_granted_by_auth_user_id:null, edit_granted_at:null, edit_updated_at:null, ...extra,
});
const chapter = (id, extra = {}) => ({
  id, video_id:"v1", x_user_id:"alice", chapter_time:62, chapter_label:"Intro",
  note:"memo", visibility:"public", created_at:100, updated_at:200, ...extra,
});
const snapshot = rows => ({ id:"v1", rows });
const fixture = (extra = {}) => ({
  videoId:"v1", actorUserId:"actor-admin", newXUsers:[], hiddenCarryRows:[],
  chaptersChanged:false, existingManagedChapters:[], nextManagedChapters:[],
  membersChanged:false, beforeSnapshot:snapshot([]), afterSnapshot:snapshot([]), ...extra,
});
test("MIG-0650 U03m unchanged state creates no audit entries", () => {
  assert.deepEqual(buildVideoMemberWriteAudits(fixture()), []);
});
test("MIG-0650 U03m exact four CURRENT strict audits with full payloads", () => {
  const old = member("old"), current = member("new", { can_edit:1 });
  const hidden = member("hidden", {is_public_member:0, can_edit:1});
  const pending = {id:"new_x", x_name:"New", approval_status:"pending"};
  const before = snapshot([old]), after = snapshot([current]);
  const result = buildVideoMemberWriteAudits(fixture({
    newXUsers:[pending], hiddenCarryRows:[hidden],
    chaptersChanged:true, existingManagedChapters:[chapter("old:member:0")],
    nextManagedChapters:[chapter("new:member:0", {note:null})],
    membersChanged:true, beforeSnapshot:before, afterSnapshot:after,
  }));
  assert.deepEqual(result.map(x => x.table_name), [
    "x_users_member_batch", "video_member_hidden_carry_cleanup",
    "video_chapters_member_set", "video_members_set",
  ]);
  assert.deepEqual(result.map(x=>x.operation), ["MERGE","DELETE","MERGE","MERGE"]);
  assert.ok(result.every(x=>x.strict===true&&x.actor_user_id==="actor-admin"));
  assert.deepEqual(result.map(x=>x.retention_class),
    ["long_audit","long_audit","long_audit","restorable"]);
  assert.deepEqual(result.map(x=>x.restore_strategy),
    ["none","none","none","custom_adapter"]);
  assert.equal(result[0].before, null);
  assert.deepEqual(result[0].after, {id:"v1", rows:[pending]});
  assert.deepEqual(result[1].before, {id:"v1", rows:[hidden]});
  assert.deepEqual(result[1].after, {id:"v1", rows:[]});
  assert.deepEqual(result[2].before, {
    id:"v1", row_count:1, member_count:1, min_time:62, max_time:62, note_count:1,
  });
  assert.deepEqual(result[2].after, {
    id:"v1", row_count:1, member_count:1, min_time:62, max_time:62, note_count:0,
  });
  assert.deepEqual(result[3].before, before);
  assert.deepEqual(result[3].after, after);
  assert.equal(result[3].context,"video-save:members");
  assert.equal(old.can_edit,0);
});
test("MIG-0650 U03m chapter-only, hidden-only, member-only audits are independent", () => {
  const ch=buildVideoMemberWriteAudits(fixture({
    chaptersChanged:true, existingManagedChapters:[chapter("old:member:0")],
    nextManagedChapters:[chapter("old:member:0",{note:null})],
  }));
  assert.deepEqual(ch.map(x=>x.table_name), ["video_chapters_member_set"]);
  assert.equal(ch[0].before.note_count,1);
  assert.equal(ch[0].after.note_count,0);
  const h=buildVideoMemberWriteAudits(fixture({hiddenCarryRows:[member("hidden")]}));
  assert.deepEqual(h.map(x=>x.table_name), ["video_member_hidden_carry_cleanup"]);
  const b=snapshot([member("old")]),a=snapshot([member("new")]);
  const m=buildVideoMemberWriteAudits(fixture({
    membersChanged:true, beforeSnapshot:b, afterSnapshot:a,
  }));
  assert.deepEqual(m.map(x=>x.table_name), ["video_members_set"]);
  assert.deepEqual(m[0].before,b);
  assert.deepEqual(m[0].after,a);
});
test("MIG-0650 U03m Next delegates to shared audits without separate D1 writes", async () => {
  const source=await readFile(new URL("../src/video/replaceVideoMembers.ts", import.meta.url),"utf8");
  const pkg=JSON.parse(await readFile(new URL("../package.json", import.meta.url),"utf8"));
  assert.equal(pkg.exports["./video/memberWriteAudits"],"./src/video/memberWriteAudits.ts");
  assert.ok(source.includes("plan.audits.push(...buildVideoMemberWriteAudits({"));
  assert.ok(source.includes("buildVideoMemberWriteMutationBatch(db, {"));
  assert.ok(!source.includes('table_name: "video_members_set"'));
  assert.ok(!source.includes('table_name: "video_chapters_member_set"'));
});
