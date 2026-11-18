// MIG-0730 U02d: shared field + Ops form composition remains UNMOUNTED and fail-closed.
import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { readFile } from "node:fs/promises";
import { AdminVideoMembersEditorPreview, bindPreviewPermissionInput, bindPreviewSaveFormData } from "../.test-dist/apps/ops/src/routes/admin/AdminVideoMembersEditorPreview.js";

const member = (i, extra = {}) => ({
  name: `Member ${i}`, x_user_id: `member_${i}`, role: "映像",
  comment: "担当", order_index: i, can_edit: 0, is_public_member: 1,
  chapters: [{ time: "1:23", label: "Scene", note: "note" }], ...extra,
});
const snapshot = (id = "v1", members = [member(0)]) => ({
  video: { id, title: "Video", youtube_video_id: null, collaboration_type: "collab" },
  initialMembers: members,
});
// The unmounted preview will run inside the Ops React Router when activated.
// Keep SSR parity checks in the same routing context as its OpsLink footer.
const html = props => renderToStaticMarkup(React.createElement(MemoryRouter, null,
  React.createElement(AdminVideoMembersEditorPreview, props)));
const dataProps = { videoId: "v1", data: snapshot() };
const searchXUsers = async () => ({ items: [], hasMore: false });
const applyPermissionBatch = async () => ({ ok: true });
const save = async () => ({ ok: true });

test("MIG-0730 U02d: shared Personal member form renders real public rows without enabling writes or network", () => {
  const markup = html(dataProps);
  assert.match(markup, /参加者設定/);
  assert.match(markup, /Member 0/);
  assert.match(markup, /1:23/);
  assert.match(markup, /name="members_json"/);
  assert.match(markup, /保存機能は移行中/);
  assert.doesNotMatch(markup, /参加者設定を保存/);
});

test("MIG-0730 U02d: no combination of missing search, permission or save adapters can publish", () => {
  const props = { ...dataProps, searchXUsers, applyPermissionBatch, save };
  for (const missing of ["searchXUsers", "applyPermissionBatch", "save"]) {
    const incomplete = { ...props, [missing]: undefined };
    const markup = html(incomplete);
    assert.match(markup, /保存機能は移行中/, missing);
    assert.doesNotMatch(markup, /参加者設定を保存/, missing);
  }
  const active = html(props);
  assert.match(active, /参加者設定を保存/);
  assert.doesNotMatch(active, /保存機能は移行中/);
});

test("MIG-0730 U02d: wrong video, hidden member and 101 participants reveal no private data", () => {
  const invalid = [
    { videoId: "v2", data: snapshot("v1", [member(0, { name: "SECRET" })]) },
    { videoId: "v1", data: snapshot("v1", [member(0, { name: "SECRET", is_public_member: 0 })]) },
    { videoId: "v1", data: snapshot("v1", Array.from({ length: 101 }, (_, i) => member(i, { comment: "SECRET" }))) },
    { videoId: "v1", data: { video: snapshot().video, initialMembers: null } },
  ];
  for (const props of invalid) {
    const markup = html({ ...props, searchXUsers, applyPermissionBatch, save });
    assert.match(markup, /参加者データを表示できません/);
    assert.doesNotMatch(markup, /SECRET|name="members_json"|参加者設定を保存/);
  }
});

test("MIG-0730 U02cl: forged getters and revoked DTOs cannot crash unmounted editor or grant writes", () => {
  const top = { video: snapshot().video,
    get initialMembers() { throw Error("PRIVATE_INITIAL_MEMBERS"); } };
  const nested = snapshot("v1", [member(0)]);
  Object.defineProperty(nested.initialMembers[0], "name", {
    enumerable: true,
    get() { throw Error("PRIVATE_NESTED_MEMBER"); },
  });
  const revoked = Proxy.revocable(snapshot(), {});
  revoked.revoke();
  for (const data of [top, nested, revoked.proxy]) {
    const markup = html({ videoId: "v1", data, searchXUsers, applyPermissionBatch, save });
    assert.match(markup, /参加者データを表示できません/, "must render safe fallback");
    assert.doesNotMatch(markup, /PRIVATE_|members_json|参加者設定を保存|公開ページ/,
      "no private data, write capability, or authorized links on malformed snapshots");
  }
});

test("MIG-0730 U02d: exactly 100 public participants remain renderable and never bypass save gate", () => {
  const many = snapshot("v1", Array.from({ length: 100 }, (_, i) => member(i)));
  const markup = html({ videoId: "v1", data: many });
  assert.match(markup, /Member 99/);
  assert.match(markup, /保存機能は移行中/);
  assert.doesNotMatch(markup, /参加者設定を保存/);
});

test("MIG-0730 U02d: not route-mounted, no HTTP code or direct Personal imports", async () => {
  const [router, file] = await Promise.all([
    readFile(new URL("../src/routes/router.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/routes/admin/AdminVideoMembersEditorPreview.tsx", import.meta.url), "utf8"),
  ]);
  assert.doesNotMatch(router, /AdminVideoMembersEditorPreview/);
  assert.doesNotMatch(file, /\bfetch\s*\(/);
  assert.doesNotMatch(file, /from "\.\.\/\.\.\/\.\.\/\.\.\/app\//);
  assert.match(file, /from "@flamenode\/ui"/);
});

test("MIG-0730 U02d: oversized payload is rejected before accessing any member getter", () => {
  let accessed = 0;
  const oversized = Array.from({ length: 101 }, (_, i) => member(i));
  Object.defineProperty(oversized, 0, {
    enumerable: true,
    configurable: true,
    get() {
      accessed++;
      throw new Error("oversized member content must never be traversed");
    },
  });
  const markup = html({
    videoId: "v1", data: snapshot("v1", oversized),
    searchXUsers, applyPermissionBatch, save,
  });
  assert.equal(accessed, 0, "bounds check must precede schema traversal");
  assert.match(markup, /参加者データを表示できません/);
  assert.doesNotMatch(markup, /name="members_json"|参加者設定を保存/);
});


test("MIG-0730 U02o: malformed route fails closed before accessing private preview rows", () => {
  const ids = ["", ".", "..", "v/child", "v\\child", " leading", "trailing ", "v\0bad", "\uD800", "v".repeat(65)];
  for (const videoId of ids) {
    let touched = 0;
    const injected = {
      get initialMembers() {
        touched++;
        throw Error("invalid video route must never read a private DTO");
      },
    };
    const markup = html({ videoId, data: injected, searchXUsers, applyPermissionBatch, save });
    assert.equal(touched, 0, "malformed path must be denied before accessing members");
    assert.match(markup, /参加者データを表示できません/);
    assert.doesNotMatch(markup, /members_json|参加者設定を保存/);
  }
});

test("MIG-0730 U02cu: permission preview binds target and every privilege field only once", () => {
  const reads = { videoId: 0, mode: 0, notify: 0, intents: 0, xid: 0, name: 0, intent: 0 };
  const row = {};
  Object.defineProperties(row, {
    x_user_id: { get() { reads.xid++; return reads.xid === 1 ? "@ALICE" : "@OTHER"; } },
    display_name: { get() { reads.name++; return reads.name === 1 ? " Alice " : "PRIVATE_SECOND"; } },
    intent: { get() { reads.intent++; return reads.intent === 1 ? "on" : "off"; } },
  });
  const input = {};
  Object.defineProperties(input, {
    videoId: { get() { reads.videoId++; return reads.videoId === 1 ? "v1" : "other"; } },
    edit_privilege_mode: { get() { reads.mode++; return reads.mode === 1 ? "admin" : "event"; } },
    notify: { get() { reads.notify++; return reads.notify === 1 ? true : false; } },
    intents: { get() { reads.intents++; return reads.intents === 1 ? [row] : []; } },
  });
  const bound = bindPreviewPermissionInput(input, "v1");
  assert.deepEqual(bound, {
    videoId: "v1", edit_privilege_mode: "admin", notify: true,
    intents: [{ x_user_id: "alice", display_name: "Alice", intent: "on" }],
  });
  assert.deepEqual(reads, {
    videoId: 1, mode: 1, notify: 1, intents: 1, xid: 1, name: 1, intent: 1,
  }, "preview input getters are not reread by the downstream port");
  assert.deepEqual(Object.getOwnPropertyDescriptors(bound).videoId.value, "v1");
});

test("MIG-0730 U02cu: preview refuses cross-video, malformed and iterable-forged permissions", () => {
  const canonical = {
    videoId: "v1", notify: true,
    intents: [{ x_user_id: "@ALICE", display_name: " Alice ", intent: "on" }],
  };
  assert.equal(bindPreviewPermissionInput({ ...canonical, videoId: "other" }, "v1"), null);
  assert.equal(bindPreviewPermissionInput({ ...canonical, notify: false }, "v1"), null);
  assert.equal(bindPreviewPermissionInput({ ...canonical, edit_privilege_mode: "root" }, "v1"), null);
  assert.equal(bindPreviewPermissionInput({ ...canonical, intents: Array.from({ length: 101 }, () => canonical.intents[0]) }, "v1"), null);
  assert.equal(bindPreviewPermissionInput({ ...canonical, intents: [
    canonical.intents[0], { x_user_id: "alice", display_name: "Dup", intent: "off" },
  ] }, "v1"), null);
  const revoked = Proxy.revocable(canonical, {});
  revoked.revoke();
  assert.equal(bindPreviewPermissionInput(revoked.proxy, "v1"), null);
  const malformed = { ...canonical };
  Object.defineProperty(malformed, "videoId", { get() { throw Error("PRIVATE_VIDEO_ID"); } });
  assert.equal(bindPreviewPermissionInput(malformed, "v1"), null);

  const rows = [{ x_user_id: "alice_2", display_name: "Name", intent: "off" }];
  rows[Symbol.iterator] = function* () {
    yield { x_user_id: "hijacked", display_name: "PRIVATE", intent: "on" };
    throw Error("PRIVATE_ITERATOR");
  };
  assert.deepEqual(bindPreviewPermissionInput({ ...canonical, intents: rows }, "v1"), {
    videoId: "v1", notify: true,
    intents: [{ x_user_id: "alice_2", display_name: "Name", intent: "off" }],
  }, "only indexed rows can enter the forwarded privilege payload");
});
 
test("MIG-0730 U02cv: SA-085 validation must forward a fresh immutable-by-caller FormData snapshot", () => {
  const original = new FormData();
  original.append("video_id", "v1");
  original.append("is_collab", "false");
  original.append("is_collab", "true");
  original.append("members_json", '[{"name":"ALICE"}]');
  const nativeForEach = original.forEach.bind(original);
  original.forEach = (cb, thisArg) => {
    nativeForEach(cb, thisArg);
    // Mutate original after the getAll() reads but before the save() call.
    original.set("video_id", "OTHER_VIDEO");
    original.set("members_json", '[{"name":"PRIVATE_CHANGED"}]');
    original.append("can_edit", "true");
  };
  const bound = bindPreviewSaveFormData(original, "v1");
  assert.ok(bound instanceof FormData);
  assert.notStrictEqual(bound, original);
  assert.deepEqual([...bound.entries()], [
    ["video_id", "v1"], ["is_collab", "false"], ["is_collab", "true"],
    ["members_json", '[{"name":"ALICE"}]'],
  ], "the downstream port receives only the validated canonical values");
  original.set("video_id", "EVEN_LATER");
  assert.equal(bound.get("video_id"), "v1");
  assert.equal(bound.has("can_edit"), false);
});

test("MIG-0730 U02cv: canonical OFF stays valid and forged fields fail closed", () => {
  const build = (id, flags, members, extra = null) => {
    const form = new FormData();
    form.append("video_id", id);
    for (const flag of flags) form.append("is_collab", flag);
    form.append("members_json", members);
    if (extra) form.append(extra, "true");
    return form;
  };
  const off = bindPreviewSaveFormData(build("v1", ["false"], "[]"), "v1");
  assert.ok(off instanceof FormData);
  assert.deepEqual([...off.entries()], [
    ["video_id", "v1"], ["is_collab", "false"], ["members_json", "[]"],
  ]);
  for (const bad of [
    build("other", ["false"], "[]"),
    build("v1", ["false"], "[]", "can_edit"),
    build("v1", ["false"], '[{"name":"FORGED_OFF"}]'),
    build("v1", ["true"], "[]"),
    build("v1", ["false","true","true"], "[]"),
  ]) {
    assert.equal(bindPreviewSaveFormData(bad, "v1"), null);
  }
});

test("MIG-0730 U02cz: unmounted editor uses only the bounded participant snapshot", () => {
  const first = [member(0)];
  const oversized = Array.from({ length: 101 }, (_, i) => member(i, { name: "PRIVATE_ROW" }));
  let traversed = 0;
  Object.defineProperty(oversized, 0, {
    get() { traversed++; throw Error("PRIVATE_ROW_ACCESS"); },
  });
  const data = snapshot("v1", first);
  let reads = 0;
  Object.defineProperty(data, "initialMembers", {
    get() { reads++; return reads === 1 ? first : oversized; },
  });
  const markup = html({ videoId: "v1", data });
  assert.match(markup, /Member 0/);
  assert.doesNotMatch(markup, /PRIVATE_ROW/);
  assert.equal(reads, 1);
  assert.equal(traversed, 0);
});

test("MIG-0730 U02da: truthy non-function write/search ports cannot enable the unmounted editor", () => {
  const valid = { ...dataProps, searchXUsers, applyPermissionBatch, save };
  const active = html(valid);
  assert.match(active, /参加者設定を保存/, "three callable ports still enable the form");
  for (const key of ["save", "searchXUsers", "applyPermissionBatch"]) {
    for (const invalid of [{ configured: true }, "configured", true]) {
      const markup = html({ ...valid, [key]: invalid });
      assert.match(markup, /保存機能は移行中/, key + " non-callable port");
      assert.doesNotMatch(markup, /参加者設定を保存/, key + " must not enable writes");
      assert.match(markup, /Member 0/, "public read-only rows remain renderable");
    }
  }
});

test("MIG-0730 U02db: preview save boundary excludes collaborator privileges and oversized member rows", () => {
  const build = (memberJson, on = true) => {
    const form = new FormData();
    form.append("video_id", "v1");
    form.append("is_collab", "false");
    if (on) form.append("is_collab", "true");
    form.append("members_json", memberJson);
    return form;
  };
  const invalid = [
    '[{"name":"Secret","can_edit":1}]',
    '[{"name":"Secret","can_edit":false}]',
    '[{"name":"Hidden","is_public_member":0}]',
    '[{"name":"Hidden","is_public_member":null}]',
    '[null]',
    '["not a member"]',
    '[[]]',
    '{"members":[]}',
    'not JSON',
    JSON.stringify(Array.from({ length: 101 }, (_, i) => ({ name: "Member " + i }))),
  ];
  for (const memberJson of invalid) {
    assert.equal(bindPreviewSaveFormData(build(memberJson), "v1"), null,
      "no privileged or malformed members_json may reach an injected SA-085 port");
  }
  const accepted = JSON.stringify(Array.from({ length: 100 }, (_, i) => ({
    name: "Member " + i, is_public_member: 1,
  })));
  assert.equal(bindPreviewSaveFormData(build(accepted), "v1")?.get("members_json"), accepted,
    "the CURRENT legal 100-public-member limit remains accepted");
  assert.ok(bindPreviewSaveFormData(build("[]", false), "v1") instanceof FormData,
    "canonical collaboration-OFF remains accepted");
});

test("MIG-0730 U02dc: invalid preview video ID rejects before reading private FormData", () => {
  const unsafe = ["", ".", "..", " leading", "trailing ", "v/child",
    "v\\child", "v\nchild", "v\0child", "\uD800", "x".repeat(65), null, 3];
  for (const videoId of unsafe) {
    let reads = 0;
    const injected = {
      getAll() { reads++; throw Error("PRIVATE_MEMBER_FORM"); },
      forEach() { reads++; throw Error("PRIVATE_FIELD_NAMES"); },
    };
    assert.equal(bindPreviewSaveFormData(injected, videoId), null,
      "invalid video IDs must never reach an injected member binding");
    assert.equal(reads, 0, "must not access private form data for " + String(videoId));
  }
  const validId = "v".repeat(64);
  const form = new FormData();
  form.append("video_id", validId);
  form.append("is_collab", "false");
  form.append("members_json", "[]");
  assert.equal(bindPreviewSaveFormData(form, validId)?.get("video_id"), validId);
});
