import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { buildVideoMemberManagedChapterRows } from "../src/video/memberChapterRows.ts";
import { managedChapterRowsEqual } from "../src/video/memberChapterAudit.ts";

const member = (id, xUserId = null) => ({
  id, video_id: "video-1", x_user_id: xUserId, name: id,
  role: null, comment: null, order_index: 0, can_edit: 0,
  is_public_member: 1, edit_granted_by_auth_user_id: null,
  edit_granted_at: null, edit_updated_at: null,
});
const chapter = (id, changes = {}) => ({
  id, video_id: "video-1", x_user_id: "alice",
  chapter_time: 62, chapter_label: "First", note: "test",
  visibility: "public", created_at: 100, updated_at: 200, ...changes,
});
const item = (time_seconds, label, note) => ({ time_seconds, label, note, order_index: 0 });
const build = (args = {}) => buildVideoMemberManagedChapterRows({
  videoId: "video-1",
  existingManagedChapters: [],
  nextMembers: [],
  chaptersByIndex: new Map(),
  ...args,
});
const assertNow = (value, min, max) => {
  assert.ok(Number.isInteger(value));
  assert.ok(value >= min && value <= max, "expected timestamp inside call");
};

test("MIG-0650 U03d-2h: empty inputs and old chapters yield no new managed chapters", () => {
  assert.deepEqual(build(), []);
  assert.deepEqual(build({ existingManagedChapters: [chapter("old:legacy:0")] }), []);
  assert.deepEqual(build({ nextMembers: [member("one")] }), []);
});

test("MIG-0650 U03d-2h: exact chapter fields, per-member order, fallback null note and 1 timestamp", () => {
  const inputMap = new Map([
    [1, [item(61.5, "Mount 🗻", ""), item(90, "第二章", "Japanese 日本語")]],
    [0, [item(0, "Intro", "  ")]] ,
  ]);
  const min = Math.floor(Date.now() / 1000);
  const rows = build({
    nextMembers: [member("vm_a", "alice"), member("vm_b", "bob")],
    chaptersByIndex: inputMap,
  });
  const max = Math.floor(Date.now() / 1000);
  assert.deepEqual(rows.map(x => x.id), ["vm_a:member:0", "vm_b:member:0", "vm_b:member:1"]);
  assert.deepEqual(rows.map(x => x.x_user_id), ["alice", "bob", "bob"]);
  assert.deepEqual(rows.map(x => x.chapter_time), [0, 61.5, 90]);
  assert.deepEqual(rows.map(x => x.chapter_label), ["Intro", "Mount 🗻", "第二章"]);
  assert.deepEqual(rows.map(x => x.note), ["  ", null, "Japanese 日本語"]);
  assert.deepEqual(rows.map(x => x.visibility), ["public", "public", "public"]);
  assert.deepEqual(rows.map(x => x.video_id), ["video-1", "video-1", "video-1"]);
  assert.ok(rows.every(x => x.updated_at === rows[0].updated_at));
  assert.ok(rows.every(x => x.created_at === rows[0].updated_at));
  assertNow(rows[0].created_at, min, max);
  assert.deepEqual([...inputMap.keys()], [1, 0], "input Map must not be modified");
});

test("MIG-0650 U03d-2h: reuse original created_at exactly, including zero; always refresh updated_at", () => {
  const existing = [
    chapter("vm_a:member:0", { created_at: 0, updated_at: 12 }),
    chapter("vm_a:member:1", { created_at: 42, updated_at: 75 }),
    chapter("vm_other:member:0", { created_at: 70, updated_at: 80 }),
  ];
  const before = existing.map(x => ({ ...x }));
  const min = Math.floor(Date.now() / 1000);
  const rows = build({
    existingManagedChapters: existing,
    nextMembers: [member("vm_a", "alice")],
    chaptersByIndex: new Map([[0, [item(5, "Edited", ""), item(9, "New", "note")]]]),
  });
  const max = Math.floor(Date.now() / 1000);
  assert.deepEqual(rows.map(x => x.created_at), [0, 42]);
  assert.equal(rows[0].updated_at, rows[1].updated_at);
  assertNow(rows[0].updated_at, min, max);
  assert.deepEqual(existing, before);
});

test("MIG-0650 U03d-2h: same chapter content remains a no-op despite DB order/timestamp differences", () => {
  const baseline = [
    chapter("vm_a:member:1", { chapter_time: 9, chapter_label: "Second", note: null, created_at: 42, updated_at: 1 }),
    chapter("vm_a:member:0", { chapter_time: 5, chapter_label: "First", note: null, created_at: 0, updated_at: 10 }),
  ];
  const projected = build({
    existingManagedChapters: baseline,
    nextMembers: [member("vm_a", "alice")],
    chaptersByIndex: new Map([[0, [item(5, "First", ""), item(9, "Second", "")]]]),
  });
  assert.equal(managedChapterRowsEqual(baseline, projected), true);
  const change = projected.map(x => ({ ...x }));
  change[1].note = "changed";
  assert.equal(managedChapterRowsEqual(baseline, change), false);
});

test("MIG-0650 U03d-2h: chapter IDs come from projected member id, never client index or old id", () => {
  const existing = [chapter("vm_old:member:0", { created_at: 100 })];
  const rows = build({
    existingManagedChapters: existing,
    nextMembers: [member("vm_new", null)],
    chaptersByIndex: new Map([[0, [item(5, "Fresh", "")]]]),
  });
  assert.equal(rows[0].id, "vm_new:member:0");
  assert.equal(rows[0].x_user_id, null);
  assert.notEqual(rows[0].created_at, 100);
});

test("MIG-0650 U03d-2h: Next uses core projection and preserves SQL CAS/audit wiring", async () => {
  const legacy = await readFile(new URL("../../../src/lib/video/replaceVideoMembers.ts", import.meta.url), "utf8");
  const mutations = await readFile(new URL("../src/video/memberWriteMutationBatch.ts", import.meta.url), "utf8");
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(pkg.exports["./video/memberChapterRows"], "./src/video/memberChapterRows.ts");
  assert.match(legacy, /from "@flamenode\/server-core\/video\/memberChapterRows"/);
  assert.match(legacy, /buildVideoMemberManagedChapterRows\(\{/);
  assert.match(legacy, /managedChapterRowsEqual/);
  assert.match(legacy, /from "@flamenode\/server-core\/video\/memberWriteMutationBatch"/);
  assert.match(mutations, /buildVideoChapterBulkInsertSql/);
  assert.match(mutations, /buildVideoMemberSetGuardSql/);
  assert.match(legacy, /buildChapterAuditSummary/);
  assert.doesNotMatch(legacy, /const existingChapterById = new Map/);
  assert.doesNotMatch(legacy, /nextManagedChapters\.push/);
});
