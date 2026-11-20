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

test("U03a: valid saved event restores the exact event instead of a default or stale selection", async () => {
  dom.window.localStorage.clear();
  const key = buildFormDraftStorageKey({
    authUserId: "u1", formId: "unslotted-shell:alice", schemaVersion: "unslotted-shell-v1",
  });
  dom.window.localStorage.setItem(key, JSON.stringify({
    savedAt: Date.now(),
    value: { affiliation: "event", selectedEventId: "event-A" },
  }));
  const container = dom.window.document.createElement("div");
  dom.window.document.body.append(container);
  const root = createRoot(container);
  const snapshots = [];
  try {
    await act(async () => root.render(React.createElement(UnslottedPostShell, props({
      renderVideoForm: args => { snapshots.push(args); return renderStub(args); },
    }))));
    assert.equal(container.querySelector("#unslotted_event_choice")?.value, "event-A");
    assert.deepEqual(snapshots.at(-1)?.initial.event_ids, ["event-A"]);
    assert.deepEqual(snapshots.at(-1)?.eventOptions, [eventA]);
    assert.equal(selected(container, "event").checked, true);
  } finally {
    await act(async () => root.unmount());
    container.remove();
    dom.window.localStorage.clear();
  }
});

test("U03a: expired drafts are removed and a different auth user draft stays isolated", async () => {
  dom.window.localStorage.clear();
  const keyFor = authUserId => buildFormDraftStorageKey({
    authUserId, formId: "unslotted-shell:alice", schemaVersion: "unslotted-shell-v1",
  });
  dom.window.localStorage.setItem(keyFor("u1"), JSON.stringify({
    savedAt: Date.now() - (8 * 24 * 60 * 60 * 1000),
    value: { affiliation: "event", selectedEventId: "event-A" },
  }));
  const otherDraft = JSON.stringify({
    savedAt: Date.now(),
    value: { affiliation: "event", selectedEventId: "event-A" },
  });
  dom.window.localStorage.setItem(keyFor("u2"), otherDraft);
  const container = dom.window.document.createElement("div");
  dom.window.document.body.append(container);
  const root = createRoot(container);
  let childCalls = 0;
  try {
    await act(async () => root.render(React.createElement(UnslottedPostShell, props({
      draftAuthUserId: "u1",
      renderVideoForm: args => { childCalls += 1; return renderStub(args); },
    }))));
    assert.equal(childCalls, 0, "expired or other-user draft must not mount a video form");
    assert.ok(container.textContent.includes("掲載方法を選択してください。"));
    assert.equal(dom.window.localStorage.getItem(keyFor("u1")), null, "expired draft removed");
    assert.equal(dom.window.localStorage.getItem(keyFor("u2")), otherDraft, "other user's draft untouched");
  } finally {
    await act(async () => root.unmount());
    container.remove();
    dom.window.localStorage.clear();
  }
});

test("U03a: a selected event removed from the eligible candidates cannot stay in the submitted form", async () => {
  dom.window.localStorage.clear();
  const container = dom.window.document.createElement("div");
  dom.window.document.body.append(container);
  const root = createRoot(container);
  let submissions = 0;
  const renderVideoForm = args => {
    submissions += 1;
    return renderStub(args);
  };
  try {
    await act(async () => root.render(React.createElement(UnslottedPostShell, props({ renderVideoForm }))));
    await act(async () => selected(container, "event").click());
    await act(async () => setSelect(container.querySelector("#unslotted_event_choice"), "event-A"));
    assert.equal(container.querySelector('input[name="event_ids"]')?.value, "event-A");
    assert.ok(submissions > 0, "eligible event shows video form");

    await act(async () => root.render(React.createElement(UnslottedPostShell, props({
      eventOptions: [],
      renderVideoForm,
    }))));
    assert.equal(container.querySelector('input[name="event_ids"]'), null,
      "previously selected but no longer eligible event must not reach the form");
    assert.ok(container.textContent.includes("所属イベントを選択してください。"));
    assert.equal(selected(container, "event").disabled, true);
  } finally {
    await act(async () => root.unmount());
    container.remove();
    dom.window.localStorage.clear();
  }
});

test("U03a: child form remounts on Active X or auth user change but not ordinary rerender", async () => {
  dom.window.localStorage.clear();
  const container = dom.window.document.createElement("div");
  dom.window.document.body.append(container);
  const root = createRoot(container);
  let mounts = 0;
  let unmounts = 0;
  function StatefulForm() {
    const [count, setCount] = React.useState(0);
    React.useEffect(() => {
      mounts += 1;
      return () => { unmounts += 1; };
    }, []);
    return React.createElement("form", null,
      React.createElement("button", { type: "button", onClick: () => setCount(n => n + 1) }, String(count)));
  }
  const renderVideoForm = () => React.createElement(StatefulForm);
  const render = (extra = {}) =>
    React.createElement(UnslottedPostShell, props({ renderVideoForm, ...extra }));
  try {
    await act(async () => root.render(render()));
    await act(async () => selected(container, "none").click());
    assert.equal(container.querySelector("form button")?.textContent, "0");
    assert.deepEqual([mounts, unmounts], [1, 0]);

    await act(async () => container.querySelector("form button").click());
    assert.equal(container.querySelector("form button")?.textContent, "1");
    await act(async () => root.render(render({ initial: { ...initial, title: "new prop" } })));
    assert.equal(container.querySelector("form button")?.textContent, "1",
      "same formKey preserves in-progress local form state");
    assert.deepEqual([mounts, unmounts], [1, 0]);

    await act(async () => root.render(render({ activeXId: "@BOB" })));
    assert.equal(container.querySelector("form button"), null,
      "new Active X starts with no affiliation or inherited child form");
    assert.equal(selected(container, "none").checked, false);
    assert.deepEqual([mounts, unmounts], [1, 1]);
    await act(async () => selected(container, "none").click());
    assert.equal(container.querySelector("form button")?.textContent, "0",
      "new Active X receives a fresh child");
    assert.deepEqual([mounts, unmounts], [2, 1]);

    await act(async () => root.render(render({ activeXId: "@BOB", draftAuthUserId: "u2" })));
    assert.equal(container.querySelector("form button"), null,
      "new auth user must not inherit parent affiliation or child form");
    assert.equal(selected(container, "none").checked, false);
    assert.deepEqual([mounts, unmounts], [2, 2]);
    await act(async () => selected(container, "none").click());
    assert.equal(container.querySelector("form button")?.textContent, "0");
    assert.deepEqual([mounts, unmounts], [3, 2]);
  } finally {
    await act(async () => root.unmount());
    assert.equal(mounts, unmounts, "all child mounts are cleaned up");
    container.remove();
    dom.window.localStorage.clear();
  }
});

test("U03a: successful form submission clears only the active identity's shell draft", async () => {
  dom.window.localStorage.clear();
  const keyFor = (authUserId, xid) => buildFormDraftStorageKey({
    authUserId, formId: `unslotted-shell:${xid}`, schemaVersion: "unslotted-shell-v1",
  });
  const currentKey = keyFor("u1", "alice");
  const otherKey = keyFor("u2", "bob");
  const savedValue = value => JSON.stringify({ savedAt: Date.now(), value });
  dom.window.localStorage.setItem(currentKey, savedValue({
    affiliation: "event", selectedEventId: "event-A",
  }));
  const otherDraft = savedValue({ affiliation: "none", selectedEventId: "" });
  dom.window.localStorage.setItem(otherKey, otherDraft);
  const container = dom.window.document.createElement("div");
  dom.window.document.body.append(container);
  const root = createRoot(container);
  let success;
  try {
    await act(async () => root.render(React.createElement(UnslottedPostShell, props({
      renderVideoForm: args => {
        success = args.onSubmitSuccess;
        return renderStub(args);
      },
    }))));
    assert.equal(container.querySelector('input[name="event_ids"]')?.value, "event-A");
    assert.equal(typeof success, "function");
    assert.ok(dom.window.localStorage.getItem(currentKey), "draft exists before submit success");

    await act(async () => success());
    assert.equal(dom.window.localStorage.getItem(currentKey), null, "submitted draft is cleared");
    assert.equal(dom.window.localStorage.getItem(otherKey), otherDraft,
      "a different identity's draft must remain unchanged");
  } finally {
    await act(async () => root.unmount());
    container.remove();
    dom.window.localStorage.clear();
  }
});

// ISSUE-703 negative regression for the candidate shell-only identity boundary.
// This is NOT evidence of parity in the mounted Next route or Lead approval.
test("U03a ISSUE-703: switching auth user and Active X never copies a prior event draft", async () => {
  dom.window.localStorage.clear();
  const keyFor = (authUserId, xid) => buildFormDraftStorageKey({
    authUserId, formId: `unslotted-shell:${xid}`, schemaVersion: "unslotted-shell-v1",
  });
  const oldKey = keyFor("u1", "alice");
  const newKey = keyFor("u2", "bob");
  const container = dom.window.document.createElement("div");
  dom.window.document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(React.createElement(UnslottedPostShell, props())));
    await act(async () => selected(container, "event").click());
    await act(async () => setSelect(container.querySelector("#unslotted_event_choice"), "event-A"));
    assert.equal(container.querySelector('input[name="event_ids"]')?.value, "event-A");
    await act(async () => dom.window.dispatchEvent(new dom.window.Event("pagehide")));
    const originalDraft = dom.window.localStorage.getItem(oldKey);
    assert.ok(originalDraft, "old user's draft is preserved for return navigation");
    assert.equal(dom.window.localStorage.getItem(newKey), null);

    // The outer React element remains the same component: the shell owns an
    // identity-keyed boundary internally, not just the injected VideoForm.
    await act(async () => root.render(React.createElement(UnslottedPostShell, props({
      draftAuthUserId: "u2", activeXId: "@BOB",
    }))));
    assert.equal(container.querySelector('input[name="event_ids"]'), null,
      "new user/X ID cannot submit the previous account's event");
    assert.equal(selected(container, "event").checked, false);
    assert.equal(selected(container, "none").checked, false);
    assert.ok(container.textContent.includes("掲載方法を選択してください"));

    await act(async () => dom.window.dispatchEvent(new dom.window.Event("pagehide")));
    assert.equal(dom.window.localStorage.getItem(newKey), null,
      "pagehide cannot write previous identity's state to the new draft key");
    assert.equal(dom.window.localStorage.getItem(oldKey), originalDraft,
      "switch does not erase or modify the original identity's draft");
  } finally {
    await act(async () => root.unmount());
    container.remove();
    dom.window.localStorage.clear();
  }
});

test("U03a ISSUE-703: pending source draft is flushed to its old key before identity remount", async () => {
  dom.window.localStorage.clear();
  const keyFor = (authUserId, xid) => buildFormDraftStorageKey({
    authUserId, formId: `unslotted-shell:${xid}`, schemaVersion: "unslotted-shell-v1",
  });
  const oldKey = keyFor("u1", "alice");
  const newKey = keyFor("u2", "bob");
  const container = dom.window.document.createElement("div");
  dom.window.document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(React.createElement(UnslottedPostShell, props())));
    await act(async () => selected(container, "event").click());
    await act(async () => setSelect(container.querySelector("#unslotted_event_choice"), "event-A"));

    // Do not dispatch pagehide or await the normal 500ms debounce.
    // The identity-keyed shell unmount must preserve this unsaved selection
    // under the DEPARTING identity, never the incoming draft namespace.
    await act(async () => root.render(React.createElement(UnslottedPostShell, props({
      draftAuthUserId: "u2", activeXId: "@BOB",
    }))));
    const original = dom.window.localStorage.getItem(oldKey);
    assert.ok(original, "pending source draft survives an immediate identity change");
    assert.deepEqual(JSON.parse(original).value, {
      affiliation: "event", selectedEventId: "event-A",
    });
    assert.equal(dom.window.localStorage.getItem(newKey), null,
      "new user/X ID receives no copy of the source draft");
    assert.equal(container.querySelector('input[name="event_ids"]'), null);

    await act(async () => dom.window.dispatchEvent(new dom.window.Event("pagehide")));
    assert.equal(dom.window.localStorage.getItem(newKey), null);
    assert.equal(dom.window.localStorage.getItem(oldKey), original);
  } finally {
    await act(async () => root.unmount());
    container.remove();
    dom.window.localStorage.clear();
  }
});

test("U03a ISSUE-703: existing destination draft restores only to its own identity", async () => {
  dom.window.localStorage.clear();
  const keyFor = (authUserId, xid) => buildFormDraftStorageKey({
    authUserId, formId: `unslotted-shell:${xid}`, schemaVersion: "unslotted-shell-v1",
  });
  const oldKey = keyFor("u1", "alice");
  const destinationKey = keyFor("u2", "bob");
  const existingDraft = JSON.stringify({
    savedAt: Date.now(), value: { affiliation: "none", selectedEventId: "" },
  });
  dom.window.localStorage.setItem(destinationKey, existingDraft);
  const container = dom.window.document.createElement("div");
  dom.window.document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(React.createElement(UnslottedPostShell, props())));
    await act(async () => selected(container, "event").click());
    await act(async () => setSelect(container.querySelector("#unslotted_event_choice"), "event-A"));
    assert.equal(container.querySelector('input[name="event_ids"]')?.value, "event-A");

    await act(async () => root.render(React.createElement(UnslottedPostShell, props({
      draftAuthUserId: "u2", activeXId: "@BOB",
    }))));
    assert.equal(selected(container, "none").checked, true,
      "the destination user's own saved affiliation is restored");
    assert.equal(container.querySelector('input[name="event_ids"]')?.value, "");
    await act(async () => dom.window.dispatchEvent(new dom.window.Event("pagehide")));
    assert.equal(dom.window.localStorage.getItem(destinationKey), existingDraft,
      "preexisting destination draft is not overwritten during transition");
    assert.notEqual(oldKey, destinationKey);
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
