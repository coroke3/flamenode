import test from "node:test";
import assert from "node:assert/strict";
import {
  parseUnslottedEventIdFromForm,
  UnslottedEventSyncError,
  MAX_UNSLOTTED_EVENT_SELECTION_CHARS,
  validateUniqueUnslottedVideoScalarFields,
  validateFreeVideoMultipartPreflight,
} from "@flamenode/domain/video";
import {
  parseUnslottedEventIdFromForm as legacyParse,
  UnslottedEventSyncError as LegacyError,
} from "../../../src/lib/video/resolveUnslottedEventSyncTarget.ts";

const selection=(value)=> {
  const form=new FormData();
  if(value!==undefined)form.set("event_ids",value);
  return form;
};
const invalid=(form)=>{
  assert.throws(()=>parseUnslottedEventIdFromForm(form),(error)=>
    error instanceof UnslottedEventSyncError &&
    error.name==="UnslottedEventSyncError" &&
    error.code==="unslotted_event_selection_invalid");
};

test("MIG-0651: legacy and domain selection contracts are identical",()=>{
  assert.strictEqual(legacyParse,parseUnslottedEventIdFromForm);
  assert.strictEqual(LegacyError,UnslottedEventSyncError);
  const notAllowed=new UnslottedEventSyncError("unslotted_event_not_allowed");
  assert.equal(notAllowed.message,"unslotted_event_not_allowed");
  assert.equal(notAllowed.name,"UnslottedEventSyncError");
  assert.equal(notAllowed.code,"unslotted_event_not_allowed");
});
test("MIG-0651: selection retains CURRENT absent/empty/single event behavior",()=>{
  assert.equal(parseUnslottedEventIdFromForm(selection()),null);
  assert.equal(parseUnslottedEventIdFromForm(selection("")),null);
  assert.equal(parseUnslottedEventIdFromForm(selection("  ")),null);
  assert.equal(parseUnslottedEventIdFromForm(selection(" event-a ")), "event-a");
  assert.equal(parseUnslottedEventIdFromForm(selection("event-a,event-a")), "event-a");
  assert.equal(parseUnslottedEventIdFromForm(selection(", event-a , , event-a ,")), "event-a");
  assert.equal(parseUnslottedEventIdFromForm(selection("a".repeat(64))),"a".repeat(64));
});
test("MIG-0651: multiple unique IDs and oversized IDs stay fail-closed",()=>{
  invalid(selection("event-a,event-b"));
  invalid(selection("a".repeat(65)));
  invalid(selection("a".repeat(65)+",ok"));
  // CURRENT rejects the entire selection when any ID is oversized, even
  // if another valid ID follows; do not silently filter like list parsing.
  invalid(selection("ok,"+"a".repeat(65)));
  invalid(selection("event-a, event-b, event-a"));
});
test("MIG-0651: repeated multipart event_ids keys are rejected without ambiguous first-value selection", () => {
  for (const values of [
    ["event-a", "event-b"],
    ["event-a", "event-a"],
    ["", "event-a"],
    ["event-a", ""],
  ]) {
    const form = new FormData();
    for (const value of values) form.append("event_ids", value);
    invalid(form);
  }
  const form = new FormData();
  form.append("other_field", "event-b");
  form.append("event_ids", "event-a");
  form.append("other_field", "event-c");
  assert.equal(parseUnslottedEventIdFromForm(form), "event-a");
  form.append("event_ids", new Blob(["event-a"]), "event.txt");
  invalid(form);
});

test("MIG-0651: File input remains invalid instead of becoming an empty selection",()=>{
  const form=new FormData();
  form.set("event_ids",new Blob(["event-a"]), "selection.txt");
  invalid(form);
});

test("MIG-0651: long repeated event selections do not require large intermediate arrays",()=>{
  const repetitions = 30_000;
  const repeated = Array(repetitions).fill("event-a").join(",");
  assert.equal(parseUnslottedEventIdFromForm(selection(repeated)), "event-a");
  assert.equal(parseUnslottedEventIdFromForm(selection(",".repeat(100_000))), null);
  invalid(selection(repeated + ",event-b"));
  // Each ID remains subject to the 64 UTF-16-unit cap after trimming.
  invalid(selection("event-a," + "x".repeat(65)));
  assert.equal(parseUnslottedEventIdFromForm(selection(" ,  event-a , event-a,  ")), "event-a");
});


test("MIG-0651: bounded event selection input rejects CPU-amplifying comma runs", () => {
  // Preserve the existing 30,000 repeated valid tokens and 100,000 empty
  // tokens; only pathological oversize inputs are rejected before scanning.
  assert.equal(MAX_UNSLOTTED_EVENT_SELECTION_CHARS, 256 * 1024);
  assert.equal(parseUnslottedEventIdFromForm(
    selection(",".repeat(MAX_UNSLOTTED_EVENT_SELECTION_CHARS)),
  ), null);
  invalid(selection(",".repeat(MAX_UNSLOTTED_EVENT_SELECTION_CHARS + 1)));
  invalid(selection("event-a,".repeat(Math.ceil(
    (MAX_UNSLOTTED_EVENT_SELECTION_CHARS + 1) / 8,
  ))));
  assert.equal(parseUnslottedEventIdFromForm(selection(
    Array(30_000).fill("event-a").join(","),
  )), "event-a");
});


test("MIG-0651 U02: scalar multipart preflight is last/first-wins ambiguity safe", () => {
  const keys = [
    "active_x_snapshot", "scheduled_time", "youtube_url", "display_name",
    "creator_x_user_id", "icon_mode", "icon_url", "icon_file",
    "profile_text", "youtube_channel_url", "other_social_links",
    "title", "music", "music_reference_url", "credit", "intro_comment",
    "highlights", "production_story", "used_software", "closing_comment",
    "is_collab", "part",
  ];
  for (const key of keys) {
    const value = new FormData();
    value.append(key, "first");
    value.append("unrelated_dynamic_question", "answer");
    value.append(key, "second");
    assert.deepEqual(validateUniqueUnslottedVideoScalarFields(value), {
      ok: false, message: "投稿フォームの入力が不正です。",
    }, key);
  }
});


test("MIG-0651 U02: normal scalars, dynamic question repeats and specialized validators coexist", () => {
  const form = new FormData();
  const keys = [
    "active_x_snapshot", "scheduled_time", "youtube_url", "display_name",
    "creator_x_user_id", "icon_mode", "icon_url", "icon_file", "title",
    "is_collab", "part",
  ];
  keys.forEach((key) => form.set(key, key === "icon_file" ? new Blob(["image"]) : "ok"));
  form.append("custom_question:q1", "first answer");
  form.append("custom_question:q1", "second answer");
  form.append("event_ids", "event-a");
  form.append("members_json", "[]");
  assert.deepEqual(validateUniqueUnslottedVideoScalarFields(form), { ok: true });
  assert.equal(parseUnslottedEventIdFromForm(form), "event-a");

  // Only event_ids/members_json's existing dedicated validators own their
  // repeated-key errors (and user-facing messages), not this candidate.
  form.append("event_ids", "event-b");
  assert.deepEqual(validateUniqueUnslottedVideoScalarFields(form), { ok: true });
  invalid(form);

  const ambiguous = new FormData();
  ambiguous.append("icon_mode", "none");
  ambiguous.append("icon_mode", "upload");
  assert.equal(ambiguous.get("icon_mode"), "none");
  assert.equal(Object.fromEntries(ambiguous).icon_mode, "upload");
  assert.equal(validateUniqueUnslottedVideoScalarFields(ambiguous).ok, false);

  const files = new FormData();
  files.append("icon_file", new Blob(["first"]), "a.png");
  files.append("icon_file", new Blob(["second"]), "b.png");
  assert.equal(validateUniqueUnslottedVideoScalarFields(files).ok, false);
});


test("MIG-0651 U02: pure free-video preflight returns selected event and canonical collab chapters", () => {
  const absent = validateFreeVideoMultipartPreflight(new FormData(), false);
  assert.deepEqual(absent, { ok: true, value: {
    requestedEventId: null,
    memberSubmission: { members: [], chaptersByIndex: new Map() },
  } });

  const form = selection("event-a");
  form.set("active_x_snapshot", "@alice");
  form.set("title", "video");
  form.set("members_json", JSON.stringify([{ name: " Alice ", x_user_id: "@Alice",
    role: "editor", chapters: [{ time: "1:05", label: "", note: " fine " }],
  }]));
  form.append("custom_question:q1", "first");
  form.append("custom_question:q1", "second");
  const parsed = validateFreeVideoMultipartPreflight(form, true);
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.value.requestedEventId, "event-a");
  assert.deepEqual(parsed.value.memberSubmission.members.map((m) => m.x_user_id), ["alice"]);
  assert.deepEqual([...parsed.value.memberSubmission.chaptersByIndex.values()], [[{
    time_seconds: 65, label: "editor", note: "fine", order_index: 0,
  }]]);
});

test("MIG-0651 U02: preflight denies duplicate scalars before event/member parsing and never mutates FormData", () => {
  const form = selection("event-a,event-b");
  form.set("members_json", "{invalid");
  form.append("icon_mode", "none");
  form.append("icon_mode", "upload");
  const before = [...form];
  assert.deepEqual(validateFreeVideoMultipartPreflight(form, true), {
    ok: false, message: "投稿フォームの入力が不正です。",
  });
  assert.deepEqual([...form], before);

  form.delete("icon_mode");
  assert.deepEqual(validateFreeVideoMultipartPreflight(form, true), {
    ok: false, message: "枠なし投稿で所属できるイベントは1件までです。",
  }, "CURRENT checks event selection before members");
  form.set("event_ids", "event-a");
  assert.deepEqual(validateFreeVideoMultipartPreflight(form, true), {
    ok: false, message: "合作メンバーの JSON が不正です。",
  });
  assert.deepEqual(validateFreeVideoMultipartPreflight(form, false), {
    ok: true, value: {
      requestedEventId: "event-a",
      memberSubmission: { members: [], chaptersByIndex: new Map() },
    },
  }, "non-collab ignores members_json exactly as CURRENT");
});

test("MIG-0651 U02: repeated specialized multipart member/event keys retain their own rejection", () => {
  const duplicateMembers = selection("event-a");
  duplicateMembers.append("members_json", "[]");
  duplicateMembers.append("members_json", "[]");
  assert.deepEqual(validateFreeVideoMultipartPreflight(duplicateMembers, true), {
    ok: false, message: "合作メンバーの入力が不正です。",
  });
  const duplicateEvents = selection("event-a");
  duplicateEvents.append("event_ids", "event-a");
  assert.deepEqual(validateFreeVideoMultipartPreflight(duplicateEvents, true), {
    ok: false, message: "枠なし投稿で所属できるイベントは1件までです。",
  });
  const file = new FormData();
  file.set("event_ids", new Blob(["event-a"]), "event.txt");
  assert.deepEqual(validateFreeVideoMultipartPreflight(file, false), {
    ok: false, message: "枠なし投稿で所属できるイベントは1件までです。",
  });
});
