import test from "node:test";
import assert from "node:assert/strict";
import * as React from "react";
import { createRoot } from "react-dom/client";
import { JSDOM } from "jsdom";
import { useUnsavedChangesGuard } from "../.test-dist/apps/ops/src/lib/useUnsavedChangesGuard.js";
import {
  buildFormDraftStorageKey, draftMetadataMatches, sanitizeDraftValue, useFormDraft,
} from "../.test-dist/apps/ops/src/lib/useFormDraft.js";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "https://flamenode.test/manage/events/event-1/edit",
});
for (const key of ["window", "document", "navigator", "HTMLElement", "Node", "File", "Blob"]) {
  Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key] });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

async function mount(Component, props) {
  const node = document.createElement("div");
  document.body.append(node);
  const root = createRoot(node);
  await React.act(async () => { root.render(React.createElement(Component, props)); });
  return {
    render: async (next) => React.act(async () => { root.render(React.createElement(Component, next)); }),
    cleanup: async () => React.act(async () => { root.unmount(); node.remove(); }),
  };
}

test("MIG-0721 U01a: beforeunload is installed only while dirty and removed on cleanup", async () => {
  function Probe({ dirty }) { useUnsavedChangesGuard({ dirty }); return null; }
  const view = await mount(Probe, { dirty: false });
  try {
    const event = () => new window.Event("beforeunload", { cancelable: true });
    const before = event(); window.dispatchEvent(before);
    assert.equal(before.defaultPrevented, false);
    await view.render({ dirty: true });
    const blocked = event(); window.dispatchEvent(blocked);
    assert.equal(blocked.defaultPrevented, true);
    await view.render({ dirty: false });
    const after = event(); window.dispatchEvent(after);
    assert.equal(after.defaultPrevented, false);
    await view.render({ dirty: true });
  } finally { await view.cleanup(); }
  const afterUnmount = new window.Event("beforeunload", { cancelable: true });
  window.dispatchEvent(afterUnmount);
  assert.equal(afterUnmount.defaultPrevented, false);
});

test("MIG-0721 U01a: draft keys, metadata and sensitive-value filters match CURRENT", () => {
  assert.equal(buildFormDraftStorageKey({
    authUserId: "user-1", formId: "event-edit-1", schemaVersion: "event-form-v3",
  }), "fn:draft:user-1:event-edit-1:event-form-v3");
  assert.equal(draftMetadataMatches({ mode: "edit", revision: 3 },
    { mode: "edit", revision: 3, extra: true }), true);
  assert.equal(draftMetadataMatches({ mode: "edit" }, { mode: "create" }), false);
  assert.equal(draftMetadataMatches({ mode: "edit" }, null), false);
  assert.deepEqual(sanitizeDraftValue({ title: "test", nested: [{ choice: "A" }] }),
    { title: "test", nested: [{ choice: "A" }] });
  for (const value of [{ password: "x" }, { nested: [{ api_key: "x" }] },
    { upload: new window.File(["x"], "x.txt") }, { tokens: ["x"] }]) {
    assert.equal(sanitizeDraftValue(value), null);
  }
});

test("MIG-0721 U01a: flushDraft persists metadata, clearDraft removes it, disabled never saves", async () => {
  const key = "fn:draft:mig-0721:u01a:flush";
  const metadata = { mode: "edit", eventId: "event-1", baseRevision: "rev-1" };
  let current;
  function Probe({ value, enabled = true }) {
    current = useFormDraft({ storageKey: key, value, enabled, shouldSave: false, metadata });
    return null;
  }
  window.localStorage.removeItem(key);
  const view = await mount(Probe, { value: { title: "new title" } });
  try {
    await React.act(async () => { assert.equal(current.flushDraft(), true); });
    const saved = JSON.parse(window.localStorage.getItem(key));
    assert.deepEqual(saved.metadata, metadata);
    assert.deepEqual(saved.value, { title: "new title" });
    assert.equal(Number.isFinite(saved.savedAt), true);
    await React.act(async () => { current.clearDraft(); });
    assert.equal(window.localStorage.getItem(key), null);
    await view.render({ value: { title: "disabled" }, enabled: false });
    await React.act(async () => { assert.equal(current.flushDraft(), false); });
    assert.equal(window.localStorage.getItem(key), null);
  } finally {
    await view.cleanup();
    window.localStorage.removeItem(key);
  }
});

test("MIG-0721 U01a: only matching, unexpired drafts restore automatically", async () => {
  const key = "fn:draft:mig-0721:u01a:restore";
  const metadata = { schemaVersion: "event-form-v3", eventId: "event-1" };
  const restored = [], stale = [];
  const value = { title: "old draft" };
  function Probe() {
    useFormDraft({ storageKey: key, value: {}, metadata, shouldSave: false,
      onRestore: (next) => restored.push(next), onStale: (next) => stale.push(next) });
    return null;
  }
  const stored = (meta, savedAt = Date.now()) =>
    window.localStorage.setItem(key, JSON.stringify({ savedAt, metadata: meta, value }));
  try {
    stored(metadata);
    let view = await mount(Probe);
    assert.deepEqual(restored, [value]);
    assert.deepEqual(stale, []);
    await view.cleanup();

    stored({ ...metadata, eventId: "different-event" });
    view = await mount(Probe);
    assert.equal(restored.length, 1);
    assert.deepEqual(stale, [value]);
    await view.cleanup();

    stored(metadata, Date.now() - 25 * 60 * 60 * 1000);
    view = await mount(Probe);
    assert.equal(restored.length, 1);
    assert.equal(window.localStorage.getItem(key), null);
    await view.cleanup();
  } finally { window.localStorage.removeItem(key); }
});
