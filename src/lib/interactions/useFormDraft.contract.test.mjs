import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import * as React from "react";
import { JSDOM } from "jsdom";
import { buildFormDraftStorageKey, draftMetadataMatches, useFormDraft } from "./useFormDraft.ts";

const source = await readFile(new URL("./useFormDraft.ts", import.meta.url), "utf8");

test("draft metadata accepts the same editor context only", () => {
  const expected = {
    schemaVersion: "event-form-v2",
    authUserId: "user-1",
    mode: "edit",
    eventId: "event-1",
    baseRevision: 42,
  };
  assert.equal(draftMetadataMatches(expected, { ...expected }), true);
  assert.equal(
    draftMetadataMatches(expected, { ...expected, baseRevision: 43 }),
    false,
  );
  assert.equal(
    draftMetadataMatches(expected, { ...expected, authUserId: "user-2" }),
    false,
  );
  assert.equal(draftMetadataMatches(expected, null), false);
});

test("draft hook exposes bounded autosave controls and lifecycle flushes", () => {
  assert.match(source, /ttlMs\?: number/);
  assert.match(source, /debounceMs\?: number/);
  assert.match(source, /maxBytes\?: number/);
  assert.match(source, /shouldSave\?: boolean/);
  assert.match(source, /flushDraft: \(nextValue\?: T\) => boolean/);
  assert.match(source, /lastSavedAt: number \| null/);
  assert.match(source, /saveError: string \| null/);
  assert.match(source, /pagehide/);
  assert.match(source, /visibilitychange/);
});

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
