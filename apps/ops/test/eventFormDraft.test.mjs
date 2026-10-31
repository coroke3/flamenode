// MIG-0721 U01a: byte-for-byte CURRENT hook parity and draft/beforeunload guards.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import * as React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { JSDOM } from "jsdom";
import {
  buildFormDraftStorageKey,
  draftMetadataMatches,
  sanitizeDraftValue,
  useFormDraft,
} from "../.test-dist/apps/ops/src/lib/useFormDraft.js";
import { useUnsavedChangesGuard } from "../.test-dist/apps/ops/src/lib/useUnsavedChangesGuard.js";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("U01a preserves CURRENT implementation of both browser-only hooks", () => {
  for (const name of ["useFormDraft", "useUnsavedChangesGuard"]) {
    const currentPath = `src/lib/interactions/${name}.ts`;
    const current = read(`../../../${currentPath}`);
    const port = read(`../src/lib/${name}.ts`);
    assert.equal(port, `// Port of CURRENT ${currentPath} (MIG-0721). Same output.\n${current}`);
  }
});

test("U01a isolates draft keys and rejects secret/blob payloads", () => {
  assert.equal(buildFormDraftStorageKey({
    authUserId: "account-A", formId: "event-create", schemaVersion: "3",
  }), "fn:draft:account-A:event-create:3");
  assert.equal(draftMetadataMatches({ revision: 5, id: "evt" }, { revision: 5, id: "evt", other: true }), true);
  assert.equal(draftMetadataMatches({ revision: 5 }, { revision: 6 }), false);
  assert.equal(draftMetadataMatches({ revision: 5 }, null), false);
  assert.deepEqual(sanitizeDraftValue({ title: "公開", slots: [1, 2] }), { title: "公開", slots: [1, 2] });
  assert.equal(sanitizeDraftValue({ nested: { api_key: "secret" } }), null);
  assert.equal(sanitizeDraftValue({ file: new Blob(["private"]) }), null);
});

test("U01a unsaved-changes hook registers and removes a beforeunload guard", async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: "https://flamenode.test/" });
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  const previousAct = globalThis.IS_REACT_ACT_ENVIRONMENT;
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const root = createRoot(dom.window.document.getElementById("root"));
  function Harness({ dirty }) {
    useUnsavedChangesGuard({ dirty });
    return null;
  }
  try {
    await act(async () => { root.render(React.createElement(Harness, { dirty: true })); });
    const blocked = new dom.window.Event("beforeunload", { cancelable: true });
    dom.window.dispatchEvent(blocked);
    assert.equal(blocked.defaultPrevented, true);
    await act(async () => { root.render(React.createElement(Harness, { dirty: false })); });
    const allowed = new dom.window.Event("beforeunload", { cancelable: true });
    dom.window.dispatchEvent(allowed);
    assert.equal(allowed.defaultPrevented, false);
  } finally {
    await act(async () => { root.unmount(); });
    if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow;
    if (previousDocument === undefined) delete globalThis.document; else globalThis.document = previousDocument;
    if (previousAct === undefined) delete globalThis.IS_REACT_ACT_ENVIRONMENT;
    else globalThis.IS_REACT_ACT_ENVIRONMENT = previousAct;
    dom.window.close();
  }
});

test("U01a draft flush/clear uses per-account local storage and rejects unsafe writes", async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: "https://flamenode.test/" });
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  const previousAct = globalThis.IS_REACT_ACT_ENVIRONMENT;
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const root = createRoot(dom.window.document.getElementById("root"));
  let draft;
  function Harness() {
    draft = useFormDraft({ storageKey: "fn:draft:test:event:1", value: { title: "first" },
      shouldSave: false, debounceMs: 100000 });
    return null;
  }
  try {
    await act(async () => { root.render(React.createElement(Harness)); });
    assert.equal(dom.window.localStorage.length, 0);
    await act(async () => { assert.equal(draft.flushDraft({ title: "second" }), true); });
    assert.equal(JSON.parse(dom.window.localStorage.getItem("fn:draft:test:event:1")).value.title, "second");
    await act(async () => { assert.equal(draft.flushDraft({ password: "do-not-store" }), false); });
    assert.equal(JSON.parse(dom.window.localStorage.getItem("fn:draft:test:event:1")).value.title, "second");
    await act(async () => { draft.clearDraft(); });
    assert.equal(dom.window.localStorage.length, 0);
  } finally {
    await act(async () => { root.unmount(); });
    if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow;
    if (previousDocument === undefined) delete globalThis.document; else globalThis.document = previousDocument;
    if (previousAct === undefined) delete globalThis.IS_REACT_ACT_ENVIRONMENT;
    else globalThis.IS_REACT_ACT_ENVIRONMENT = previousAct;
    dom.window.close();
  }
});
