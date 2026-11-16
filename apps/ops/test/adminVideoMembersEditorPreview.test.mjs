// MIG-0730 U02d: shared field + Ops form composition remains UNMOUNTED and fail-closed.
import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFile } from "node:fs/promises";
import { AdminVideoMembersEditorPreview } from "../.test-dist/apps/ops/src/routes/admin/AdminVideoMembersEditorPreview.js";

const member = (i, extra = {}) => ({
  name: `Member ${i}`, x_user_id: `member_${i}`, role: "映像",
  comment: "担当", order_index: i, can_edit: 0, is_public_member: 1,
  chapters: [{ time: "1:23", label: "Scene", note: "note" }], ...extra,
});
const snapshot = (id = "v1", members = [member(0)]) => ({
  video: { id, title: "Video", youtube_video_id: null, collaboration_type: "collab" },
  initialMembers: members,
});
const html = props => renderToStaticMarkup(React.createElement(AdminVideoMembersEditorPreview, props));
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
