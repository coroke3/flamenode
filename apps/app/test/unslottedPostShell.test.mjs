// MIG-0714 U03a: unmounted Unslotted shell compatibility, not full VideoForm parity.
// React/jsdom is initialized in the same order as MIG-0713 VideoMembersField tests.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "https://flamenode.test/" });
for (const key of ["window", "document", "navigator", "HTMLElement", "Node"]) {
  Object.defineProperty(globalThis, key, {
    configurable: true,
    value: key === "window" ? dom.window : dom.window[key],
  });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const React = await import("react");
const { act } = React;
const { createRoot } = await import("react-dom/client");
const { renderToStaticMarkup } = await import("react-dom/server");
const { UnslottedPostShell } = await import("../.test-dist/apps/app/src/components/forms/UnslottedPostShell.js");
const { buildFormDraftStorageKey } = await import("../.test-dist/apps/app/src/lib/useFormDraft.js");

const eventA = { id: "event-A", title: "Event A", status_label: "受付中", custom_questions: [] };
const initial = { title: "Existing title", event_ids: ["old"], part: "first", music: "original" };

function renderStub(input) {
  return React.createElement("form", { "data-form-key": input.formKey },
    React.createElement("input", { type: "hidden", name: "event_ids", value: input.initial.event_ids.join("\n"), readOnly: true }));
}
function props(more = {}) {
  return {
    initial,
    eventOptions: [eventA],
    activeXId: "@ALICE",
    draftAuthUserId: "u1",
    renderVideoForm: renderStub,
    ...more,
  };
}
function selected(container, value) {
  const radios = [...container.querySelectorAll('input[name="unslotted_affiliation_choice"]')];
  assert.equal(radios.length, 2, "preserve two affiliation choices");
  return value === "none" ? radios[0] : radios[1];
}
function setSelect(select, value) {
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(select), "value")?.set;
  assert.ok(setter);
  setter.call(select, value);
  select.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
}

test("U03a: no affiliation starts unmounted, and event choice is disabled when no events", () => {
  const markup = renderToStaticMarkup(React.createElement(UnslottedPostShell, props({ eventOptions: [] })));
  assert.match(markup, /この作品をイベントに所属させますか/);
  assert.match(markup, /イベントに所属しない/);
  assert.match(markup, /イベントに所属する/);
  assert.match(markup, /掲載方法を選択してください/);
  assert.match(markup, /disabled=""/, "event affiliation is unavailable without choices");
  assert.doesNotMatch(markup, /data-form-key=/);
});

test("U03a: existing form metadata remains, while affiliation and event IDs override CURRENT fields", async () => {
  dom.window.localStorage.clear();
  const container = dom.window.document.createElement("div");
  dom.window.document.body.append(container);
  const root = createRoot(container);
  const snapshots = [];
  let flushCount = 0;
  const renderVideoForm = (args) => {
    snapshots.push(args);
    args.onDraftFlushReady(() => { flushCount += 1; return true; });
    return renderStub(args);
  };
  try {
    await act(async () => root.render(React.createElement(UnslottedPostShell, props({ renderVideoForm }))));
    assert.equal(snapshots.length, 0, "no child before choosing affiliation");

    await act(async () => selected(container, "none").click());
    let args = snapshots.at(-1);
    assert.ok(args);
    assert.equal(args.mode, "free");
    assert.equal(args.canEditEvents, false);
    assert.equal(args.activeXSnapshot, "@ALICE");
    assert.equal(args.formKey, "unslotted-video:u1:alice");
    assert.deepEqual(args.initial, { ...initial, event_ids: [], part: null });
    assert.deepEqual(args.eventOptions, []);
    assert.equal(container.querySelector('input[name="event_ids"]').value, "");

    await act(async () => selected(container, "event").click());
    assert.equal(flushCount, 1, "changing affiliation flushes the last child draft");
    assert.ok(container.textContent.includes("所属イベント"));
    assert.equal(container.querySelector('input[name="event_ids"]'), null);

    const dropdown = container.querySelector("#unslotted_event_choice");
    assert.ok(dropdown);
    await act(async () => setSelect(dropdown, "event-A"));
    args = snapshots.at(-1);
    assert.deepEqual(args.initial, { ...initial, event_ids: ["event-A"], part: null });
    assert.deepEqual(args.eventOptions, [eventA]);
    assert.equal(container.querySelector('input[name="event_ids"]').value, "event-A");
    assert.equal(flushCount, 2, "selecting an event flushes the last available form draft");

    await act(async () => selected(container, "none").click());
    assert.equal(flushCount, 3, "switching back flushes the most recent child");
    args = snapshots.at(-1);
    assert.deepEqual(args.initial.event_ids, []);
    assert.deepEqual(args.eventOptions, []);
  } finally {
    await act(async () => root.unmount());
    container.remove();
    dom.window.localStorage.clear();
  }
});

test("U03a: stale event draft restores selection safely without inventing an unavailable event", async () => {
  dom.window.localStorage.clear();
  const key = buildFormDraftStorageKey({
    authUserId: "u1",
    formId: "unslotted-shell:alice",
    schemaVersion: "unslotted-shell-v1",
  });
  dom.window.localStorage.setItem(key, JSON.stringify({
    savedAt: Date.now(),
    value: { affiliation: "event", selectedEventId: "event-deleted" },
  }));
  const container = dom.window.document.createElement("div");
  dom.window.document.body.append(container);
  const root = createRoot(container);
  let childCalls = 0;
  try {
    await act(async () => root.render(React.createElement(UnslottedPostShell, props({
      renderVideoForm: (args) => { childCalls++; return renderStub(args); },
    }))));
    assert.ok(container.textContent.includes("保存済みイベントは現在の候補にありません。"));
    assert.ok(container.textContent.includes("作品情報の下書きは保持されています。"));
    assert.equal(container.querySelector("#unslotted_event_choice")?.value, "");
    assert.equal(childCalls, 0, "missing event must not silently submit to a different event");
    assert.ok(dom.window.localStorage.getItem(key), "draft is not cleared on mismatch");
  } finally {
    await act(async () => root.unmount());
    container.remove();
    dom.window.localStorage.clear();
  }
});

test("U03a: shell is network and Next-free; CURRENT affiliation/draft contract is preserved", () => {
  const ported = readFileSync(new URL("../src/components/forms/UnslottedPostShell.tsx", import.meta.url), "utf8");
  const legacy = readFileSync(new URL("../../../src/components/forms/UnslottedPostForm.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(ported, /from\s+["'](?:next\/|@\/)/);
  assert.doesNotMatch(ported, /\bfetch\s*\(|applyVideoCollaboratorPermissionsBatch|createFreeVideo|submitSlotVideo/);
  assert.match(ported, /unslotted-shell-v1/);
  assert.match(ported, /unslotted-shell:\$\{activeXKey\}/);
  for (const phrase of [
    "この作品をイベントに所属させますか？",
    "枠なし投稿では、イベントに所属しない通常作品か",
    "保存済みイベントは現在の候補にありません。",
    "イベントを選択してください",
  ]) {
    assert.ok(legacy.includes(phrase), "CURRENT must contain the baseline phrase");
    assert.ok(ported.includes(phrase), "ported shell must retain CURRENT wording");
  }
});
