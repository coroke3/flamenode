// MIG-0712 U02: visual permission components use pure formatting but never grant auth.
import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
const { PermissionBadge, PermissionGroupBadge } = await import("../.test-dist/apps/app/src/components/permission/PermissionBadge.js");
const { FieldLockNote } = await import("../.test-dist/apps/app/src/components/permission/FieldLockNote.js");
const { PermissionFieldLabel } = await import("../.test-dist/apps/app/src/components/permission/PermissionFieldLabel.js");
const view = await import("../.test-dist/apps/app/src/lib/videoEditPermissionView.js");

const p = (over = {}) => ({ editable: true, source: "owner_general", reason: "allowed", label: "作品タイトル", ...over });
const html = (Comp, props) => renderToStaticMarkup(React.createElement(Comp, props));

test("MIG-0712 U02: permission badge styles and kind use the CURRENT reason enum", () => {
  const inputs = [
    ["allowed", "編集可能", "perm-badge-editable"],
    ["owner_policy_denied", "所有者権限では編集不可", "perm-badge-ownerDenied"],
    ["event_permission_denied", "運営権限が必要", "perm-badge-event"],
    ["admin_only", "管理者限定", "perm-badge-admin"],
    ["not_owner", "編集不可", "perm-badge-locked"],
    ["collaborator_not_granted", "編集不可", "perm-badge-locked"],
  ];
  for (const [reason, text, className] of inputs) {
    const actual = html(PermissionBadge, { permission: p({ editable: reason === "allowed", source: "none", reason }) });
    assert.match(actual, new RegExp(text), reason);
    assert.ok(actual.includes(className), reason);
    assert.match(actual, /aria-label="編集状態:/);
  }
  assert.match(html(PermissionBadge, { permission: p({ source: "admin" }) }), /perm-badge-privilegedEditable/);
});

test("MIG-0712 U02: group badge keeps mixed and locked states distinct", () => {
  assert.equal(view.resolveVideoPermissionGroupState([p()]), "editable");
  assert.equal(view.resolveVideoPermissionGroupState([p(), p({ editable: false, reason: "not_owner" })]), "mixed");
  assert.equal(view.resolveVideoPermissionGroupState([]), "locked");
  const mixed = html(PermissionGroupBadge, { permissions: [p(), p({ editable: false, reason: "not_owner" })] });
  assert.match(mixed, /一部のみ編集可能/);
  assert.match(mixed, /perm-badge-mixed/);
});

test("MIG-0712 U02: locked note has correct source reason and escalation hint, editable note is hidden", () => {
  assert.equal(html(FieldLockNote, { permission: p(), id: "lock-note" }), "");
  const permission = p({ editable: false, source: "none", reason: "owner_policy_denied" });
  const output = html(FieldLockNote, { permission, id: "lock-note", unlockHint: "admin" });
  assert.match(output, /perm-lock-note/);
  assert.match(output, /この項目は、現在の一般作品権限では編集できません/);
  assert.match(output, /管理者権限で編集/);
  assert.match(output, /id="lock-note"/);
  const event = html(FieldLockNote, { permission: p({ editable: false, reason: "event_permission_denied", label: "編集権限" }), unlockHint: "event" });
  assert.match(event, /イベント運営権限で編集/);
  assert.match(event, /必要な権限: 編集権限/);
});

test("MIG-0712 U02: field labels retain associated htmlFor, required marker and badge visibility", () => {
  const base = html(PermissionFieldLabel, { label: "タイトル", htmlFor: "video-title", permission: p(), required: true });
  assert.match(base, /for="video-title"/);
  assert.match(base, /perm-label-required/);
  assert.doesNotMatch(base, /編集状態:/);
  const locked = html(PermissionFieldLabel, { label: "タイトル", permission: p({ editable: false, reason: "admin_only", source: "none" }) });
  assert.match(locked, /管理者限定/);
  assert.match(locked, /perm-label-badge/);
});
