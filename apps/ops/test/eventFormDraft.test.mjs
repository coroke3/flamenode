// MIG-0721: CURRENT draft parity and Ops native/SPA navigation guards.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import * as React from "react";
import { createRoot } from "react-dom/client";
import { createMemoryRouter, RouterProvider, Link } from "react-router-dom";
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

test("U01a preserves CURRENT draft implementation; T03 adapts navigation to the Ops router", () => {
  for (const name of ["useFormDraft"]) {
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
  let updateDirty;
  function Harness() {
    const [dirty, setDirty] = React.useState(true);
    updateDirty = setDirty;
    useUnsavedChangesGuard({ dirty });
    return null;
  }
  const router = createMemoryRouter([{ path: "*", element: React.createElement(Harness) }]);
  try {
    await act(async () => { root.render(React.createElement(RouterProvider, { router })); });
    const blocked = new dom.window.Event("beforeunload", { cancelable: true });
    dom.window.dispatchEvent(blocked);
    assert.equal(blocked.defaultPrevented, true);
    await act(async () => updateDirty(false));
    const allowed = new dom.window.Event("beforeunload", { cancelable: true });
    dom.window.dispatchEvent(allowed);
    assert.equal(allowed.defaultPrevented, false);
  } finally {
    await act(async () => { root.unmount(); });
    router.dispose();
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

// CURRENT #889 lifecycle regressions, using the Ops-compiled hook above.
const storageKey = buildFormDraftStorageKey({
  authUserId: "user-1", formId: "event-1", schemaVersion: "event-form-v1",
});
const metadata = { baseRevision: 42 };
const pristine = { title: "Published title" };
const staleValue = { title: "Prior revision draft" };
const staleJson = () => JSON.stringify({
  savedAt: Date.now(), metadata: { baseRevision: 41 }, value: staleValue,
}, null, 2);

async function withDraft(t, raw, run) {
  const dom = new JSDOM("<div id='root'></div>", { url: "https://flamenode.test/" });
  const { window } = dom;
  const { document, localStorage: storage } = window;
  if (raw !== null) storage.setItem(storageKey, raw);
  const globals = { window, document, IS_REACT_ACT_ENVIRONMENT: true };
  const previous = Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]);
  for (const [key, value] of Object.entries(globals)) {
    Object.defineProperty(globalThis, key, { configurable: true, value });
  }

  let nextTimer = 0;
  const timers = new Map();
  t.mock.method(window, "setTimeout", (callback, delay) => {
    const id = ++nextTimer;
    timers.set(id, { callback, delay });
    return id;
  });
  t.mock.method(window, "clearTimeout", (id) => { timers.delete(id); });

  const staleValues = [];
  const restoredValues = [];
  let updateValue;
  let result;
  const onStale = (value) => { staleValues.push(value); };
  const onRestore = (value) => {
    restoredValues.push(value);
    updateValue(value);
  };
  function Form() {
    const [value, setValue] = React.useState(pristine);
    updateValue = setValue;
    result = useFormDraft({ storageKey, metadata, value, onRestore, onStale });
    return null;
  }

  let root;
  try {
    const { createRoot } = await import("react-dom/client");
    root = createRoot(document.getElementById("root"));
    await React.act(async () => root.render(React.createElement(Form)));
    await run({
      storage,
      staleValues,
      restoredValues,
      result: () => result,
      edit: (value) => React.act(async () => updateValue(value)),
      read: () => storage.getItem(storageKey),
      pendingDelays: () => [...timers.values()].map(({ delay }) => delay),
      runTimers: () => React.act(async () => {
        for (const [id, { callback }] of [...timers]) {
          if (timers.delete(id)) callback();
        }
      }),
      dispatch: (event, visibility = "hidden") => React.act(async () => {
        if (event === "visibilitychange") {
          Object.defineProperty(document, "visibilityState", { configurable: true, value: visibility });
          document.dispatchEvent(new window.Event(event));
        } else {
          window.dispatchEvent(new window.Event(event));
        }
      }),
    });
  } finally {
    if (root) await React.act(async () => root.unmount());
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
    window.close();
  }
}

test("untouched stale drafts retain the original serialized value on automatic lifecycle saves", async (t) => {
  for (const event of ["pagehide", "visibilitychange"]) {
    await t.test(event, async (t) => {
      const raw = staleJson();
      await withDraft(t, raw, async (draft) => {
        assert.deepEqual(draft.staleValues, [staleValue]);
        assert.deepEqual(draft.restoredValues, []);
        assert.deepEqual(draft.pendingDelays(), []);
        await draft.dispatch(event);
        assert.equal(draft.read(), raw);
        assert.equal(draft.result().lastSavedAt, null);
      });
    });
  }
});

test("editing a stale form allows hidden visibility to save the edit before debounce", async (t) => {
  const raw = staleJson();
  await withDraft(t, raw, async (draft) => {
    const edited = { title: "New revision edit" };
    await draft.edit(edited);
    assert.deepEqual(draft.pendingDelays(), [500]);
    await draft.dispatch("visibilitychange", "visible");
    assert.equal(draft.read(), raw);
    await draft.dispatch("visibilitychange");
    assert.deepEqual(JSON.parse(draft.read()).value, edited);
    assert.deepEqual(JSON.parse(draft.read()).metadata, metadata);
    assert.deepEqual(draft.pendingDelays(), []);
  });
});

test("explicitly restoring a stale draft saves it with current metadata after debounce", async (t) => {
  const raw = staleJson();
  await withDraft(t, raw, async (draft) => {
    await React.act(async () => assert.equal(draft.result().restoreStaleDraft(), true));
    assert.deepEqual(draft.restoredValues, [staleValue]);
    assert.equal(draft.read(), raw);
    assert.deepEqual(draft.pendingDelays(), [500]);
    await draft.runTimers();
    assert.deepEqual(JSON.parse(draft.read()).value, staleValue);
    assert.deepEqual(JSON.parse(draft.read()).metadata, metadata);
  });
});

test("normal debounce, explicit flush and clear keep their existing behavior", async (t) => {
  await withDraft(t, null, async (draft) => {
    const edited = { title: "First edit" };
    await draft.edit(edited);
    assert.equal(draft.read(), null);
    assert.deepEqual(draft.pendingDelays(), [500]);
    await draft.runTimers();
    assert.deepEqual(JSON.parse(draft.read()).value, edited);

    const explicit = { title: "Immediate value" };
    await draft.edit({ title: "Pending render value" });
    await React.act(async () => assert.equal(draft.result().flushDraft(explicit), true));
    assert.deepEqual(JSON.parse(draft.read()).value, explicit);
    assert.deepEqual(draft.pendingDelays(), []);

    await draft.edit({ title: "Pending value before clear" });
    await React.act(async () => draft.result().clearDraft());
    await draft.runTimers();
    assert.equal(draft.read(), null);
    assert.equal(draft.result().lastSavedAt, null);
  });
});

test("storage failures remain visible without discarding the stored draft", async (t) => {
  const raw = staleJson();
  await withDraft(t, raw, async (draft) => {
    const prototype = Object.getPrototypeOf(draft.storage);
    t.mock.method(prototype, "setItem", () => { throw new Error("storage unavailable"); });
    t.mock.method(prototype, "removeItem", () => { throw new Error("storage unavailable"); });

    await draft.edit({ title: "Unsaved change" });
    await draft.dispatch("pagehide");
    assert.match(draft.result().saveError, /下書きの保存に失敗/);
    assert.equal(draft.read(), raw);
    await React.act(async () => draft.result().clearDraft());
    assert.match(draft.result().saveError, /下書きの削除に失敗/);
    assert.equal(draft.read(), raw);
  });
});


async function withNavigationGuard(run) {
  const dom = new JSDOM('<div id="root"></div>', { url: "https://flamenode.test/edit?template=a" });
  const globals = { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true };
  const previous = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, value });
  let blocker, setDirty;
  function Harness() {
    const [dirty, updateDirty] = React.useState(true);
    setDirty = updateDirty;
    blocker = useUnsavedChangesGuard({ dirty });
    return React.createElement(Link, { to: "/next" }, "次へ");
  }
  const router = createMemoryRouter([{ path: "*", element: React.createElement(Harness) }], {
    initialEntries: ["/before", "/edit?template=a", "/after"], initialIndex: 1,
  });
  const root = createRoot(dom.window.document.getElementById("root"));
  try {
    await act(async () => root.render(React.createElement(RouterProvider, { router })));
    await run({ dom, router, blocker: () => blocker, setDirty: value => act(async () => setDirty(value)) });
  } finally {
    await act(async () => root.unmount());
    router.dispose();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
    }
    dom.window.close();
  }
}

test("T03 dirty Link, PUSH, REPLACE, POP and template transitions can be cancelled or confirmed", async t => {
  const cases = [
    { name: "Link", go: ({ dom }) => dom.window.document.querySelector("a").dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true, cancelable: true, button: 0 })), path: "/next", action: "PUSH" },
    { name: "PUSH", go: ({ router }) => router.navigate("/next"), path: "/next", action: "PUSH" },
    { name: "REPLACE", go: ({ router }) => router.navigate("/next", { replace: true }), path: "/next", action: "REPLACE" },
    { name: "back", go: ({ router }) => router.navigate(-1), path: "/before", action: "POP" },
    { name: "forward", go: ({ router }) => router.navigate(1), path: "/after", action: "POP" },
    { name: "template", go: ({ router }) => router.navigate("/edit?template=b"), path: "/edit", search: "?template=b", action: "PUSH" },
  ];
  for (const item of cases) await t.test(item.name, async () => withNavigationGuard(async view => {
    await act(async () => item.go(view));
    assert.equal(view.blocker().state, "blocked");
    assert.equal(view.router.state.location.pathname + view.router.state.location.search, "/edit?template=a");
    await act(async () => view.blocker().reset());
    assert.equal(view.blocker().state, "unblocked");
    assert.equal(view.router.state.location.pathname + view.router.state.location.search, "/edit?template=a");
    await act(async () => item.go(view));
    assert.equal(view.blocker().state, "blocked");
    await act(async () => view.blocker().proceed());
    assert.equal(view.router.state.location.pathname, item.path);
    assert.equal(view.router.state.location.search, item.search ?? "");
    assert.equal(view.router.state.historyAction, item.action);
  }));
});

test("T03 hash-only navigation keeps dirty protection, while clean transitions do not block", async () => {
  await withNavigationGuard(async ({ router, blocker, setDirty, dom }) => {
    await act(async () => router.navigate("/edit?template=a#section-basic"));
    assert.equal(blocker().state, "unblocked");
    assert.equal(router.state.location.hash, "#section-basic");
    const event = new dom.window.Event("beforeunload", { cancelable: true });
    dom.window.dispatchEvent(event);
    assert.equal(event.defaultPrevented, true);
    await act(async () => router.navigate("/next"));
    assert.equal(blocker().state, "blocked");
    await setDirty(false);
    assert.equal(blocker().state, "unblocked", "cleaning cancels the previous pending intent");
    assert.equal(router.state.location.pathname, "/edit");
    await act(async () => router.navigate("/next"));
    assert.equal(router.state.location.pathname, "/next");
    const clean = new dom.window.Event("beforeunload", { cancelable: true });
    dom.window.dispatchEvent(clean);
    assert.equal(clean.defaultPrevented, false);
  });
});
