// MIG-0713 U02: the field port may render/edit entirely in-browser, without direct fetch/Server Actions.
import assert from "node:assert/strict";
import test from "node:test";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { readFile } from "node:fs/promises";
import { dom } from "./helpers.mjs";
const { VideoMembersField } = await import("../.test-dist/apps/app/src/components/forms/VideoMembersField.js");

const noopAdapters = {
  searchXUsers: async () => ({ items: [], hasMore: false, nextOffset: null }),
  applyPermissionBatch: async () => ({ ok: false, message: "not authorized" }),
};
const alice = { name: "Alice", x_user_id: "alice", role: "映像", comment: "", chapters: [] };

test("MIG-0713 U02: empty field is network-free and serializes no blank member into members_json", () => {
  const markup = renderToStaticMarkup(React.createElement(VideoMembersField, { ...noopAdapters }));
  assert.match(markup, /name="members_json"/);
  assert.match(markup, /value="\[\]"/);
  assert.match(markup, /メンバー編集の表示モード/);
  assert.match(markup, /vmembers-root/);
  assert.match(markup, /候補から|活動名/);
});

test("MIG-0713 U02: initial rows preserve the CURRENT form data and option display", () => {
  const markup = renderToStaticMarkup(React.createElement(VideoMembersField, {
    ...noopAdapters,
    initialMembers: [alice],
    collabPermsHref: "/dashboard/edit/vid1/permissions",
  }));
  assert.match(markup, /Alice/);
  assert.match(markup, /alice/);
  assert.match(markup, /編集できる人を設定/);
  assert.match(markup, /dashboard\/edit\/vid1\/permissions/);
  assert.match(markup, /name="members_json"/);
});

test("MIG-0713 U02: table/card switching preserves serialized hidden rows", async () => {
  const container = dom.window.document.createElement("div");
  const root = createRoot(container);
  const props = { ...noopAdapters, initialMembers: [alice] };
  try {
    await act(async () => root.render(React.createElement(VideoMembersField, props)));
    const original = container.querySelector('input[name="members_json"]').value;
    assert.match(original, /Alice/);
    const tableButton = [...container.querySelectorAll("button")].find(x => x.textContent.trim() === "表");
    assert.ok(tableButton);
    await act(async () => tableButton.click());
    assert.equal(tableButton.getAttribute("aria-pressed"), "true");
    assert.equal(container.querySelector('input[name="members_json"]').value, original);
    const cardButton = [...container.querySelectorAll("button")].find(x => x.textContent.trim() === "カード");
    await act(async () => cardButton.click());
    assert.equal(container.querySelector('input[name="members_json"]').value, original);
  } finally { await act(async () => root.unmount()); }
});

test("MIG-0713 U02: component has injected search/permission adapters, never directly fetches or invokes a Server Action", async () => {
  const source = await readFile(new URL("../src/components/forms/VideoMembersField.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, /\bfetch\s*\(/);
  assert.doesNotMatch(source, /\bapplyVideoCollaboratorPermissionsBatch\s*\(/);
  assert.match(source, /await searchXUsers\(/);
  assert.match(source, /await applyPermissionBatch\(/);
  assert.match(source, /MAX_COLLABORATOR_PERMISSION_BATCH/);
  assert.doesNotMatch(source, /from\s+["'](?:@\/|next\/)/);
});
