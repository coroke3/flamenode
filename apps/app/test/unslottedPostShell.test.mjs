// MIG-0714 U03a: unmounted Unslotted shell compatibility, not full VideoForm parity.
// React/jsdom is initialized in the same order as MIG-0713 VideoMembersField tests.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "https://flamenode.test/" });
for (const key of ["window", "document", "navigator", "HTMLElement", "Node", "HTMLInputElement", "HTMLSelectElement", "HTMLTextAreaElement", "FormData", "File", "Blob"]) {
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
const { VideoMembersField } = await import("../.test-dist/apps/app/src/components/forms/VideoMembersField.js");
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
    assert.equal(flushCount, 1, "no mounted child exists until an event is selected; do not replay the departed flush");

    await act(async () => selected(container, "none").click());
    assert.equal(flushCount, 2, "switching back flushes only the newly registered event child");
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

test("U03a ISSUE-703: submit success followed by immediate unmount cannot resurrect a cleared draft", async () => {
  dom.window.localStorage.clear();
  const keyFor = (authUserId, xid) => buildFormDraftStorageKey({
    authUserId, formId: `unslotted-shell:${xid}`, schemaVersion: "unslotted-shell-v1",
  });
  const key = keyFor("u1", "alice");
  const otherKey = keyFor("u2", "bob");
  const otherDraft = JSON.stringify({
    savedAt: Date.now(), value: { affiliation: "none", selectedEventId: "" },
  });
  dom.window.localStorage.setItem(otherKey, otherDraft);
  const container = dom.window.document.createElement("div");
  dom.window.document.body.append(container);
  const root = createRoot(container);
  let unmounted = false;
  let submitSuccess;
  try {
    await act(async () => root.render(React.createElement(UnslottedPostShell, props({
      renderVideoForm: args => {
        submitSuccess = args.onSubmitSuccess;
        return renderStub(args);
      },
    }))));
    await act(async () => selected(container, "event").click());
    await act(async () => setSelect(container.querySelector("#unslotted_event_choice"), "event-A"));
    await act(async () => dom.window.dispatchEvent(new dom.window.Event("pagehide")));
    assert.ok(dom.window.localStorage.getItem(key));
    assert.equal(typeof submitSuccess, "function");

    // Synchronous route change can unmount before React renders dirty=false.
    // The old cleanup must not flush the just-submitted draft a second time.
    await act(async () => {
      submitSuccess();
      root.unmount();
      unmounted = true;
    });
    assert.equal(dom.window.localStorage.getItem(key), null,
      "success must leave the source draft removed even on immediate unmount");
    assert.equal(dom.window.localStorage.getItem(otherKey), otherDraft,
      "success cannot affect another user's existing draft");
  } finally {
    if (!unmounted) await act(async () => root.unmount());
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
    assert.deepEqual(
      JSON.parse(dom.window.localStorage.getItem(oldKey)).value,
      JSON.parse(originalDraft).value,
      "switch preserves the original identity's draft payload despite a new savedAt",
    );
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

// ISSUE-703: identity-isolation must hold when only ONE identity dimension
// changes; switching both dimensions was verified by the earlier regressions.
test("U03a ISSUE-703: switching only Active X preserves independent drafts and restores on return", async () => {
  dom.window.localStorage.clear();
  const keyFor = xid => buildFormDraftStorageKey({
    authUserId: "u1", formId: `unslotted-shell:${xid}`, schemaVersion: "unslotted-shell-v1",
  });
  const aliceKey = keyFor("alice");
  const bobKey = keyFor("bob");
  const container = dom.window.document.createElement("div");
  dom.window.document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(React.createElement(UnslottedPostShell, props())));
    await act(async () => selected(container, "event").click());
    await act(async () => setSelect(container.querySelector("#unslotted_event_choice"), "event-A"));
    assert.equal(container.querySelector('input[name="event_ids"]')?.value, "event-A");

    // Change only the X identity, without flushing via pagehide or debounce.
    await act(async () => root.render(React.createElement(UnslottedPostShell, props({
      activeXId: "@BOB",
    }))));
    assert.deepEqual(JSON.parse(dom.window.localStorage.getItem(aliceKey)).value, {
      affiliation: "event", selectedEventId: "event-A",
    }, "ALICE's unsaved event is retained under ALICE");
    assert.equal(dom.window.localStorage.getItem(bobKey), null);
    assert.equal(selected(container, "event").checked, false);
    assert.equal(container.querySelector('input[name="event_ids"]'), null);

    await act(async () => selected(container, "none").click());
    await act(async () => root.render(React.createElement(UnslottedPostShell, props())));
    assert.deepEqual(JSON.parse(dom.window.localStorage.getItem(bobKey)).value, {
      affiliation: "none", selectedEventId: "",
    }, "BOB's distinct draft is flushed under BOB");
    assert.equal(selected(container, "event").checked, true);
    assert.equal(container.querySelector('input[name="event_ids"]')?.value, "event-A",
      "returning to ALICE restores only ALICE's saved selection");
  } finally {
    await act(async () => root.unmount());
    container.remove();
    dom.window.localStorage.clear();
  }
});

test("U03a ISSUE-703: colon-bearing auth ID and tagged X handle cannot share a React shell key", async () => {
  dom.window.localStorage.clear();
  const firstDraft = buildFormDraftStorageKey({
    authUserId: "u:xid", formId: "unslotted-shell:unassigned", schemaVersion: "unslotted-shell-v1",
  });
  const secondDraft = buildFormDraftStorageKey({
    authUserId: "u", formId: "unslotted-shell:xid:unassigned", schemaVersion: "unslotted-shell-v1",
  });
  assert.notEqual(firstDraft, secondDraft);
  const container = dom.window.document.createElement("div");
  dom.window.document.body.append(container);
  const root = createRoot(container);
  const render = (draftAuthUserId, activeXId) => React.createElement(UnslottedPostShell, props({
    draftAuthUserId, activeXId,
  }));
  try {
    // Under the previous colon-joined key BOTH states were
    // "unslotted-video:auth:u:xid:unassigned".
    await act(async () => root.render(render("u:xid", null)));
    await act(async () => selected(container, "event").click());
    await act(async () => setSelect(container.querySelector("#unslotted_event_choice"), "event-A"));
    assert.equal(container.querySelector('input[name="event_ids"]')?.value, "event-A");

    await act(async () => root.render(render("u", "@UNASSIGNED")));
    assert.equal(selected(container, "event").checked, false,
      "different user/X tuple must not inherit an event choice despite its old joined-key collision");
    assert.equal(container.querySelector('input[name="event_ids"]'), null);
    assert.deepEqual(JSON.parse(dom.window.localStorage.getItem(firstDraft)).value,
      { affiliation: "event", selectedEventId: "event-A" },
      "the departed draft was flushed only to its original identity");
    assert.equal(dom.window.localStorage.getItem(secondDraft), null);

    await act(async () => selected(container, "none").click());
    await act(async () => root.render(render("u:xid", null)));
    assert.deepEqual(JSON.parse(dom.window.localStorage.getItem(secondDraft)).value,
      { affiliation: "none", selectedEventId: "" },
      "the second user has its own saved choice");
    assert.equal(selected(container, "event").checked, true);
    assert.equal(container.querySelector('input[name="event_ids"]')?.value, "event-A");
  } finally {
    await act(async () => root.unmount());
    container.remove();
    dom.window.localStorage.clear();
  }
});

test("U03a ISSUE-703: guest shell cannot become authenticated user literally named anonymous", async () => {
  dom.window.localStorage.clear();
  const authKey = buildFormDraftStorageKey({
    authUserId: "anonymous", formId: "unslotted-shell:alice", schemaVersion: "unslotted-shell-v1",
  });
  const container = dom.window.document.createElement("div");
  dom.window.document.body.append(container);
  const root = createRoot(container);
  const render = draftAuthUserId => React.createElement(UnslottedPostShell, props({
    draftAuthUserId,
  }));
  try {
    await act(async () => root.render(render(undefined)));
    await act(async () => selected(container, "event").click());
    await act(async () => setSelect(container.querySelector("#unslotted_event_choice"), "event-A"));
    assert.equal(container.querySelector('input[name="event_ids"]')?.value, "event-A");
    assert.equal(dom.window.localStorage.getItem(authKey), null,
      "guest draft persistence must remain disabled");

    // The former React parent key aliased both states to "anonymous".
    // A real auth user with that literal ID must start with fresh choices.
    await act(async () => root.render(render("anonymous")));
    assert.equal(selected(container, "event").checked, false,
      "guest affiliation must not carry into the newly authenticated identity");
    assert.equal(selected(container, "none").checked, false);
    assert.equal(container.querySelector('input[name="event_ids"]'), null);
    assert.equal(dom.window.localStorage.getItem(authKey), null);

    await act(async () => selected(container, "none").click());
    await act(async () => dom.window.dispatchEvent(new dom.window.Event("pagehide")));
    assert.deepEqual(JSON.parse(dom.window.localStorage.getItem(authKey)).value,
      { affiliation: "none", selectedEventId: "" },
      "authenticated draft belongs to that literal user ID only");

    await act(async () => root.render(render(undefined)));
    assert.equal(selected(container, "none").checked, false,
      "the guest must not inherit the authenticated user's choice");
    assert.equal(container.querySelector('input[name="event_ids"]'), null);
    await act(async () => root.render(render("anonymous")));
    assert.equal(selected(container, "none").checked, true,
      "returning authenticated user restores its own draft");
  } finally {
    await act(async () => root.unmount());
    container.remove();
    dom.window.localStorage.clear();
  }
});

test("U03a ISSUE-703: valid @unassigned X handle cannot inherit absent-Active-X shell draft", async () => {
  dom.window.localStorage.clear();
  const keyFor = segment => buildFormDraftStorageKey({
    authUserId: "u1", formId: `unslotted-shell:${segment}`, schemaVersion: "unslotted-shell-v1",
  });
  const absentXKey = keyFor("unassigned"); // preserve CURRENT's empty-X draft key
  const literalXKey = keyFor("xid:unassigned"); // valid, nonempty @unassigned must differ
  assert.notEqual(absentXKey, literalXKey);
  const container = dom.window.document.createElement("div");
  dom.window.document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(React.createElement(UnslottedPostShell, props({ activeXId: null }))));
    await act(async () => selected(container, "event").click());
    await act(async () => setSelect(container.querySelector("#unslotted_event_choice"), "event-A"));
    assert.equal(container.querySelector('input[name="event_ids"]')?.value, "event-A");

    // This is a different, valid X handle, not the missing-X sentinel.
    await act(async () => root.render(React.createElement(UnslottedPostShell, props({ activeXId: "@UNASSIGNED" }))));
    assert.equal(selected(container, "event").checked, false,
      "the real @unassigned user must start with its own blank selection");
    assert.equal(container.querySelector('input[name="event_ids"]'), null);
    assert.deepEqual(JSON.parse(dom.window.localStorage.getItem(absentXKey)).value,
      { affiliation: "event", selectedEventId: "event-A" },
      "pending empty-X draft is flushed under the original legacy key");
    assert.equal(dom.window.localStorage.getItem(literalXKey), null,
      "the literal X handle must not adopt the absent-X draft");

    await act(async () => selected(container, "none").click());
    await act(async () => root.render(React.createElement(UnslottedPostShell, props({ activeXId: null }))));
    assert.deepEqual(JSON.parse(dom.window.localStorage.getItem(literalXKey)).value,
      { affiliation: "none", selectedEventId: "" },
      "real @unassigned draft persists only in its distinct namespace");
    assert.equal(selected(container, "event").checked, true);
    assert.equal(container.querySelector('input[name="event_ids"]')?.value, "event-A",
      "returning to missing Active X restores only its original draft");
  } finally {
    await act(async () => root.unmount());
    container.remove();
    dom.window.localStorage.clear();
  }
});

test("U03a ISSUE-703: switching only auth user restores destination draft without cross-user overwrite", async () => {
  dom.window.localStorage.clear();
  const keyFor = uid => buildFormDraftStorageKey({
    authUserId: uid, formId: "unslotted-shell:alice", schemaVersion: "unslotted-shell-v1",
  });
  const key1 = keyFor("u1");
  const key2 = keyFor("u2");
  const existing = JSON.stringify({
    savedAt: Date.now(), value: { affiliation: "none", selectedEventId: "" },
  });
  dom.window.localStorage.setItem(key2, existing);
  const container = dom.window.document.createElement("div");
  dom.window.document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(React.createElement(UnslottedPostShell, props())));
    await act(async () => selected(container, "event").click());
    await act(async () => setSelect(container.querySelector("#unslotted_event_choice"), "event-A"));

    // X ID remains ALICE. Only auth ownership changes.
    await act(async () => root.render(React.createElement(UnslottedPostShell, props({
      draftAuthUserId: "u2",
    }))));
    assert.deepEqual(JSON.parse(dom.window.localStorage.getItem(key1)).value, {
      affiliation: "event", selectedEventId: "event-A",
    });
    assert.equal(selected(container, "none").checked, true,
      "u2 restores its own saved affiliation, not u1's event");
    assert.equal(container.querySelector('input[name="event_ids"]')?.value, "");
    await act(async () => dom.window.dispatchEvent(new dom.window.Event("pagehide")));
    assert.equal(dom.window.localStorage.getItem(key2), existing,
      "a pristine restored destination remains byte-for-byte unchanged");

    await act(async () => root.render(React.createElement(UnslottedPostShell, props())));
    assert.equal(selected(container, "event").checked, true);
    assert.equal(container.querySelector('input[name="event_ids"]')?.value, "event-A",
      "returning to u1 restores u1's event and does not reuse u2's draft");
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

test("U03a ISSUE-703: late previous-identity flush registration cannot override the current child", async () => {
  dom.window.localStorage.clear();
  const container = dom.window.document.createElement("div");
  dom.window.document.body.append(container);
  const root = createRoot(container);
  let registerFromOldChild;
  let oldFlushCalls = 0;
  let currentFlushCalls = 0;
  const renderVideoForm = args => {
    const isOldIdentity = args.formKey === "unslotted-video:u1:alice";
    args.onDraftFlushReady(() => {
      if (isOldIdentity) oldFlushCalls += 1;
      else currentFlushCalls += 1;
      return true;
    });
    if (isOldIdentity) registerFromOldChild = args.onDraftFlushReady;
    return renderStub(args);
  };
  try {
    await act(async () => root.render(React.createElement(UnslottedPostShell, props({
      renderVideoForm,
    }))));
    await act(async () => selected(container, "none").click());
    assert.equal(typeof registerFromOldChild, "function");

    // Remount the outer shell by changing the identity, not the child alone.
    await act(async () => root.render(React.createElement(UnslottedPostShell, props({
      activeXId: "@BOB", draftAuthUserId: "u2", renderVideoForm,
    }))));
    assert.equal(selected(container, "none").checked, false);
    assert.equal(container.querySelector("form"), null);

    // A late async child callback still closes over the old shell. It must
    // not replace the new shell's registered flush function.
    registerFromOldChild(() => { oldFlushCalls += 100; return true; });
    await act(async () => selected(container, "none").click());
    await act(async () => selected(container, "event").click());
    assert.equal(oldFlushCalls, 0, "the unmounted child's flush must never run");
    assert.equal(currentFlushCalls, 1, "only the current identity's child is flushed");
  } finally {
    await act(async () => root.unmount());
    container.remove();
    dom.window.localStorage.clear();
  }
});

test("U03a ISSUE-703: late submit success cannot clear a new identity draft", async () => {
  dom.window.localStorage.clear();
  const keyFor = (authUserId, xid) => buildFormDraftStorageKey({
    authUserId, formId: `unslotted-shell:${xid}`, schemaVersion: "unslotted-shell-v1",
  });
  const aliceKey = keyFor("u1", "alice");
  const bobKey = keyFor("u2", "bob");
  const destinationDraft = JSON.stringify({
    savedAt: Date.now(),
    value: { affiliation: "none", selectedEventId: "" },
  });
  dom.window.localStorage.setItem(bobKey, destinationDraft);
  const container = dom.window.document.createElement("div");
  dom.window.document.body.append(container);
  const root = createRoot(container);
  let oldSubmitSuccess;
  let currentSubmitSuccess;
  const renderVideoForm = args => {
    if (args.formKey === "unslotted-video:u1:alice") oldSubmitSuccess = args.onSubmitSuccess;
    else if (args.formKey === "unslotted-video:u2:bob") currentSubmitSuccess = args.onSubmitSuccess;
    return renderStub(args);
  };
  try {
    await act(async () => root.render(React.createElement(UnslottedPostShell, props({
      renderVideoForm,
    }))));
    await act(async () => selected(container, "none").click());
    assert.equal(typeof oldSubmitSuccess, "function");

    // A network response may arrive after the first identity has unmounted.
    await act(async () => root.render(React.createElement(UnslottedPostShell, props({
      draftAuthUserId: "u2", activeXId: "@BOB", renderVideoForm,
    }))));
    assert.ok(dom.window.localStorage.getItem(aliceKey),
      "departing identity's dirty shell draft was flushed");
    assert.equal(dom.window.localStorage.getItem(bobKey), destinationDraft);
    assert.equal(selected(container, "none").checked, true,
      "new identity restored its own saved selection");
    assert.equal(typeof currentSubmitSuccess, "function");

    await act(async () => oldSubmitSuccess());
    assert.equal(dom.window.localStorage.getItem(aliceKey), null,
      "late success only clears the old identity's draft");
    assert.equal(dom.window.localStorage.getItem(bobKey), destinationDraft,
      "old success must not clear or replace the current identity's draft");
    assert.equal(selected(container, "none").checked, true);

    await act(async () => currentSubmitSuccess());
    assert.equal(dom.window.localStorage.getItem(bobKey), null,
      "current identity may still clear its own draft after successful submission");
  } finally {
    await act(async () => root.unmount());
    container.remove();
    dom.window.localStorage.clear();
  }
});

// A returned identity has a fresh committed shell even when its persistent
// draft key is identical. An old network completion cannot delete that key.
for (const [switchKind, destination] of [
  ["auth-user", { draftAuthUserId: "u2" }],
  ["active-x", { activeXId: "@BOB" }],
  ["route-remount", null],
]) {
  for (const draftState of ["restored", "pending", "saved"]) {
    test(`U03a ISSUE-703: returning ${switchKind} preserves ${draftState} draft on old success`, async () => {
      dom.window.localStorage.clear();
      const key = buildFormDraftStorageKey({
        authUserId: "u1", formId: "unslotted-shell:alice", schemaVersion: "unslotted-shell-v1",
      });
      const container = dom.window.document.createElement("div");
      dom.window.document.body.append(container);
      const root = createRoot(container);
      let latestSuccess;
      const renderVideoForm = args => {
        latestSuccess = args.onSubmitSuccess;
        return renderStub(args);
      };
      const render = identity => identity === null ? null :
        React.createElement(UnslottedPostShell, props({ ...identity, renderVideoForm }));
      try {
        await act(async () => root.render(render({})));
        await act(async () => selected(container, "none").click());
        const oldSuccess = latestSuccess;
        assert.equal(typeof oldSuccess, "function");

        await act(async () => root.render(render(destination)));
        assert.ok(dom.window.localStorage.getItem(key), "departed dirty A was flushed");
        await act(async () => root.render(render({})));
        assert.equal(selected(container, "none").checked, true, "return restores A");

        if (draftState !== "restored") {
          await act(async () => selected(container, "event").click());
          await act(async () => setSelect(container.querySelector("#unslotted_event_choice"), eventA.id));
        }
        if (draftState === "saved") {
          await act(async () => dom.window.dispatchEvent(new dom.window.Event("pagehide")));
        }
        await act(async () => {
          const before = dom.window.localStorage.getItem(key);
          assert.ok(before, "returning A owns a persistent draft");
          oldSuccess();
          assert.equal(dom.window.localStorage.getItem(key), before,
            "old success must not delete the returning shell's stored draft");
        });
        if (draftState !== "restored") {
          assert.equal(selected(container, "event").checked, true);
          await act(async () => dom.window.dispatchEvent(new dom.window.Event("pagehide")));
          assert.deepEqual(JSON.parse(dom.window.localStorage.getItem(key)).value,
            { affiliation: "event", selectedEventId: eventA.id },
            "new pending or saved event choice survives old success");
        }
        await act(async () => latestSuccess());
        assert.equal(dom.window.localStorage.getItem(key), null,
          "the latest shell can still clear its own draft on success");
      } finally {
        await act(async () => root.unmount());
        container.remove();
        dom.window.localStorage.clear();
      }
    });
  }
}

test("U03a ISSUE-703: updated eligible options cannot revert an in-progress affiliation choice", async () => {
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
  const render = eventOptions => React.createElement(UnslottedPostShell, props({
    eventOptions,
  }));
  try {
    await act(async () => root.render(render([eventA])));
    assert.equal(selected(container, "event").checked, true,
      "the initial saved draft is restored");
    assert.equal(container.querySelector('input[name="event_ids"]')?.value, "event-A");

    // Change affiliation without waiting for the debounce. The persisted
    // event-A draft is intentionally still present while the UI has new state.
    await act(async () => selected(container, "none").click());
    assert.equal(selected(container, "none").checked, true);
    assert.equal(container.querySelector('input[name="event_ids"]')?.value, "");

    // A public event-list refresh can provide a fresh array reference for the
    // SAME eligible IDs; it must not replay the older draft over dirty state.
    await act(async () => root.render(render([{ ...eventA }])));
    assert.equal(selected(container, "none").checked, true,
      "refreshed eligibility cannot undo an in-progress selection");
    assert.equal(selected(container, "event").checked, false);
    assert.equal(container.querySelector('input[name="event_ids"]')?.value, "");

    await act(async () => dom.window.dispatchEvent(new dom.window.Event("pagehide")));
    const after = JSON.parse(dom.window.localStorage.getItem(key));
    assert.deepEqual(after.value, { affiliation: "none", selectedEventId: "" },
      "the edited draft must flush the current choice, not the old saved event");
  } finally {
    await act(async () => root.unmount());
    container.remove();
    dom.window.localStorage.clear();
  }
});

test("U03a ISSUE-703: delayed eligible event restores only the matching saved event", async () => {
  dom.window.localStorage.clear();
  const key = buildFormDraftStorageKey({
    authUserId: "u1", formId: "unslotted-shell:alice", schemaVersion: "unslotted-shell-v1",
  });
  const original = JSON.stringify({
    savedAt: Date.now(), value: { affiliation: "event", selectedEventId: "event-A" },
  });
  dom.window.localStorage.setItem(key, original);
  const container = dom.window.document.createElement("div");
  dom.window.document.body.append(container);
  const root = createRoot(container);
  const render = eventOptions => React.createElement(UnslottedPostShell, props({ eventOptions }));
  try {
    await act(async () => root.render(render([])));
    assert.equal(selected(container, "event").checked, true);
    assert.equal(container.querySelector('input[name="event_ids"]'), null,
      "an unavailable event cannot reach the form");
    assert.ok(container.textContent.includes("保存済みイベントは現在の候補にありません"));

    await act(async () => root.render(render([{ ...eventA }])));
    assert.equal(selected(container, "event").checked, true);
    assert.equal(container.querySelector("#unslotted_event_choice")?.value, "event-A");
    assert.equal(container.querySelector('input[name="event_ids"]')?.value, "event-A",
      "only the exact saved event can become selected when eligible");
    assert.equal(dom.window.localStorage.getItem(key), original,
      "eligibility arrival alone must not overwrite the stored draft");
  } finally {
    await act(async () => root.unmount());
    container.remove();
    dom.window.localStorage.clear();
  }
});

test("U03a ISSUE-703: user dismissal blocks delayed saved event restoration", async () => {
  dom.window.localStorage.clear();
  const key = buildFormDraftStorageKey({
    authUserId: "u1", formId: "unslotted-shell:alice", schemaVersion: "unslotted-shell-v1",
  });
  dom.window.localStorage.setItem(key, JSON.stringify({
    savedAt: Date.now(), value: { affiliation: "event", selectedEventId: "event-A" },
  }));
  const container = dom.window.document.createElement("div");
  dom.window.document.body.append(container);
  const root = createRoot(container);
  const render = eventOptions => React.createElement(UnslottedPostShell, props({ eventOptions }));
  try {
    await act(async () => root.render(render([])));
    assert.equal(container.querySelector('input[name="event_ids"]'), null);
    await act(async () => selected(container, "none").click());
    assert.equal(selected(container, "none").checked, true);

    await act(async () => root.render(render([{ ...eventA }])));
    assert.equal(selected(container, "none").checked, true,
      "explicit user edit cannot be overridden by later eligibility");
    assert.equal(container.querySelector('input[name="event_ids"]')?.value, "");
    await act(async () => dom.window.dispatchEvent(new dom.window.Event("pagehide")));
    assert.deepEqual(JSON.parse(dom.window.localStorage.getItem(key)).value, {
      affiliation: "none", selectedEventId: "",
    });
  } finally {
    await act(async () => root.unmount());
    container.remove();
    dom.window.localStorage.clear();
  }
});

test("U03a ISSUE-703: late submit from a previous affiliation cannot erase a newer draft", async () => {
  dom.window.localStorage.clear();
  const key = buildFormDraftStorageKey({
    authUserId: "u1", formId: "unslotted-shell:alice", schemaVersion: "unslotted-shell-v1",
  });
  const container = dom.window.document.createElement("div");
  dom.window.document.body.append(container);
  const root = createRoot(container);
  const snapshots = [];
  const renderVideoForm = args => {
    snapshots.push({ onSubmitSuccess: args.onSubmitSuccess, events: args.initial.event_ids });
    return renderStub(args);
  };
  try {
    await act(async () => root.render(React.createElement(UnslottedPostShell, props({ renderVideoForm }))));
    await act(async () => selected(container, "none").click());
    assert.deepEqual(snapshots.at(-1)?.events, []);
    const oldSubmitSuccess = snapshots.at(-1).onSubmitSuccess;

    // The old form's in-flight request outlives a user's choice of an event.
    await act(async () => selected(container, "event").click());
    await act(async () => setSelect(container.querySelector("#unslotted_event_choice"), "event-A"));
    const currentSubmitSuccess = snapshots.at(-1).onSubmitSuccess;
    assert.deepEqual(snapshots.at(-1)?.events, ["event-A"]);
    assert.notEqual(oldSubmitSuccess, currentSubmitSuccess,
      "each changed affiliation must expose a generation-bound success callback");
    await act(async () => dom.window.dispatchEvent(new dom.window.Event("pagehide")));
    const freshDraft = dom.window.localStorage.getItem(key);
    assert.deepEqual(JSON.parse(freshDraft).value,
      { affiliation: "event", selectedEventId: "event-A" });

    await act(async () => oldSubmitSuccess());
    assert.equal(dom.window.localStorage.getItem(key), freshDraft,
      "old affiliation completion must not delete the newer saved choice");
    assert.equal(container.querySelector('input[name="event_ids"]')?.value, "event-A");
    await act(async () => currentSubmitSuccess());
    assert.equal(dom.window.localStorage.getItem(key), null,
      "the current form's success can still clear its own draft");
  } finally {
    await act(async () => root.unmount());
    container.remove();
    dom.window.localStorage.clear();
  }
});

test("U03a ISSUE-703: late same-selection submit cannot discard later form edits", async () => {
  dom.window.localStorage.clear();
  const key = buildFormDraftStorageKey({
    authUserId: "u1", formId: "unslotted-shell:alice", schemaVersion: "unslotted-shell-v1",
  });
  const container = dom.window.document.createElement("div");
  dom.window.document.body.append(container);
  const root = createRoot(container);
  const callbacks = [];
  const renderVideoForm = args => {
    callbacks.push(args.onSubmitSuccess);
    return React.createElement("form", { "data-form-key": args.formKey },
      React.createElement("select", { "data-testid": "edit-field", defaultValue: "before" },
        React.createElement("option", { value: "before" }, "Before"),
        React.createElement("option", { value: "after" }, "After")));
  };
  try {
    await act(async () => root.render(React.createElement(UnslottedPostShell, props({
      renderVideoForm,
    }))));
    await act(async () => selected(container, "none").click());
    const submitSuccessBeforeEdit = callbacks.at(-1);
    assert.equal(typeof submitSuccessBeforeEdit, "function");

    // A changed form field in the same affiliation/user must protect new work.
    const field = container.querySelector('select[data-testid="edit-field"]');
    assert.ok(field);
    await act(async () => setSelect(field, "after"));
    assert.equal(field.value, "after");
    const submitSuccessAfterEdit = callbacks.at(-1);
    assert.equal(typeof submitSuccessAfterEdit, "function");
    assert.notEqual(submitSuccessBeforeEdit, submitSuccessAfterEdit);

    await act(async () => dom.window.dispatchEvent(new dom.window.Event("pagehide")));
    const latestDraft = dom.window.localStorage.getItem(key);
    assert.ok(latestDraft, "dirty shell draft is still present after editing a child field");

    await act(async () => submitSuccessBeforeEdit());
    assert.equal(dom.window.localStorage.getItem(key), latestDraft,
      "an earlier pending submit cannot erase later edits in the same selection");
    assert.equal(field.value, "after");

    await act(async () => submitSuccessAfterEdit());
    assert.equal(dom.window.localStorage.getItem(key), null,
      "only completion for the latest edit generation can clear this shell draft");
  } finally {
    await act(async () => root.unmount());
    container.remove();
    dom.window.localStorage.clear();
  }
});

test("U03a ISSUE-703: two consecutive child form changes refresh the latest submit callback", async () => {
  dom.window.localStorage.clear();
  const key = buildFormDraftStorageKey({
    authUserId: "u1", formId: "unslotted-shell:alice", schemaVersion: "unslotted-shell-v1",
  });
  const container = dom.window.document.createElement("div");
  dom.window.document.body.append(container);
  const root = createRoot(container);
  const callbacks = [];
  const renderVideoForm = args => {
    callbacks.push(args.onSubmitSuccess);
    return React.createElement("form", { "data-form-key": args.formKey },
      React.createElement("select", { "data-testid": "two-edits", defaultValue: "first" },
        React.createElement("option", { value: "first" }, "First"),
        React.createElement("option", { value: "second" }, "Second")));
  };
  try {
    await act(async () => root.render(React.createElement(UnslottedPostShell, props({
      renderVideoForm,
    }))));
    await act(async () => selected(container, "none").click());
    const field = container.querySelector('select[data-testid="two-edits"]');
    assert.ok(field);
    await act(async () => setSelect(field, "second"));
    const firstEditCompletion = callbacks.at(-1);
    assert.equal(field.value, "second");

    // formDirty is already true, so setFormDirty(true) cannot force a
    // subsequent render. This second edit must refresh the bound callback.
    await act(async () => setSelect(field, "first"));
    const secondEditCompletion = callbacks.at(-1);
    assert.equal(field.value, "first");
    assert.notEqual(firstEditCompletion, secondEditCompletion,
      "every new edit generation must receive a different completion callback");

    await act(async () => dom.window.dispatchEvent(new dom.window.Event("pagehide")));
    const latestDraft = dom.window.localStorage.getItem(key);
    assert.ok(latestDraft);

    await act(async () => firstEditCompletion());
    assert.equal(dom.window.localStorage.getItem(key), latestDraft,
      "the previous form-edit generation must not clear newer work");
    await act(async () => secondEditCompletion());
    assert.equal(dom.window.localStorage.getItem(key), null,
      "the latest form-edit generation can clear its own saved draft");
  } finally {
    await act(async () => root.unmount());
    container.remove();
    dom.window.localStorage.clear();
  }
});

test("U03a ISSUE-703: removing a submitted event from eligible choices preserves its draft through a late success", async () => {
  dom.window.localStorage.clear();
  const key = buildFormDraftStorageKey({
    authUserId: "u1", formId: "unslotted-shell:alice", schemaVersion: "unslotted-shell-v1",
  });
  const container = dom.window.document.createElement("div");
  dom.window.document.body.append(container);
  const root = createRoot(container);
  const callbacks = [];
  const renderVideoForm = args => {
    callbacks.push(args.onSubmitSuccess);
    return renderStub(args);
  };
  try {
    await act(async () => root.render(React.createElement(UnslottedPostShell, props({ renderVideoForm }))));
    await act(async () => selected(container, "event").click());
    await act(async () => setSelect(container.querySelector("#unslotted_event_choice"), "event-A"));
    assert.equal(container.querySelector('input[name="event_ids"]')?.value, "event-A");
    const inFlightSuccess = callbacks.at(-1);
    assert.equal(typeof inFlightSuccess, "function");
    await act(async () => dom.window.dispatchEvent(new dom.window.Event("pagehide")));
    const retainedDraft = dom.window.localStorage.getItem(key);
    assert.deepEqual(JSON.parse(retainedDraft).value, {
      affiliation: "event", selectedEventId: "event-A",
    });

    // The event becomes unavailable after submission started. The currently
    // mounted form is withdrawn, but its earlier Promise can still resolve.
    await act(async () => root.render(React.createElement(UnslottedPostShell, props({
      renderVideoForm, eventOptions: [],
    }))));
    assert.equal(container.querySelector("form"), null);
    await act(async () => inFlightSuccess());
    assert.equal(dom.window.localStorage.getItem(key), retainedDraft,
      "late completion after eligibility withdrawal must not clear user work");

    // Returning eligibility must not resurrect that old completion grant.
    await act(async () => root.render(React.createElement(UnslottedPostShell, props({
      renderVideoForm, eventOptions: [eventA],
    }))));
    assert.equal(container.querySelector('input[name="event_ids"]')?.value, "event-A");
    const freshSuccess = callbacks.at(-1);
    await act(async () => inFlightSuccess());
    assert.equal(dom.window.localStorage.getItem(key), retainedDraft,
      "old completion remains invalid after the event becomes eligible again");
    await act(async () => freshSuccess());
    assert.equal(dom.window.localStorage.getItem(key), null,
      "only the latest eligible form may clear the current shell draft");
  } finally {
    await act(async () => root.unmount());
    container.remove();
    dom.window.localStorage.clear();
  }
});

test("U03a ISSUE-703: programmatic member edits invalidate an earlier in-flight success without native change", async () => {
  dom.window.localStorage.clear();
  const key = buildFormDraftStorageKey({
    authUserId: "u1", formId: "unslotted-shell:alice", schemaVersion: "unslotted-shell-v1",
  });
  const container = dom.window.document.createElement("div");
  dom.window.document.body.append(container);
  const root = createRoot(container);
  const callbacks = [];
  function MembersEditor({ args }) {
    const [count, setCount] = React.useState(0);
    return React.createElement("form", { "data-form-key": args.formKey },
      React.createElement("button", { type: "button", onClick: () => {
        setCount(current => current + 1);
        args.onFormStateChanged();
      } }, "add member"),
      React.createElement("output", { "data-testid": "members" }, String(count)));
  }
  const renderVideoForm = args => {
    callbacks.push(args.onSubmitSuccess);
    return React.createElement(MembersEditor, { args });
  };
  try {
    await act(async () => root.render(React.createElement(UnslottedPostShell, props({ renderVideoForm }))));
    await act(async () => selected(container, "none").click());
    const oldCompletion = callbacks.at(-1);
    assert.equal(typeof oldCompletion, "function");

    // This button only updates React state, not a native form input.
    await act(async () => container.querySelector("button").click());
    assert.equal(container.querySelector('output[data-testid="members"]')?.textContent, "1");
    const latestCompletion = callbacks.at(-1);
    assert.notEqual(oldCompletion, latestCompletion);

    await act(async () => dom.window.dispatchEvent(new dom.window.Event("pagehide")));
    const retained = dom.window.localStorage.getItem(key);
    assert.ok(retained, "programmatic-only edits still persist a shell draft");

    await act(async () => oldCompletion());
    assert.equal(dom.window.localStorage.getItem(key), retained,
      "old submit success cannot erase a later member edit");
    await act(async () => latestCompletion());
    assert.equal(dom.window.localStorage.getItem(key), null,
      "latest success can still clear the active identity's draft");
  } finally {
    await act(async () => root.unmount());
    container.remove();
    dom.window.localStorage.clear();
  }
});

test("U03a ISSUE-703: stale unmounted programmatic edit callbacks cannot taint a different affiliation", async () => {
  dom.window.localStorage.clear();
  const container = dom.window.document.createElement("div");
  dom.window.document.body.append(container);
  const root = createRoot(container);
  const callbacks = [];
  const renderVideoForm = args => {
    callbacks.push({ success: args.onSubmitSuccess, changed: args.onFormStateChanged });
    return renderStub(args);
  };
  try {
    await act(async () => root.render(React.createElement(UnslottedPostShell, props({ renderVideoForm }))));
    await act(async () => selected(container, "none").click());
    const oldChanged = callbacks.at(-1).changed;
    assert.equal(typeof oldChanged, "function");

    await act(async () => selected(container, "event").click());
    await act(async () => setSelect(container.querySelector("#unslotted_event_choice"), "event-A"));
    const currentSuccess = callbacks.at(-1).success;

    // An obsolete child's deferred state update must not mark the new
    // event-A form dirty or replace its submit-success generation.
    await act(async () => oldChanged());
    assert.strictEqual(callbacks.at(-1).success, currentSuccess,
      "obsolete form callbacks are rejected after an affiliation change");
    assert.equal(container.querySelector('input[name="event_ids"]')?.value, "event-A");
  } finally {
    await act(async () => root.unmount());
    container.remove();
    dom.window.localStorage.clear();
  }
});

test("U03a ISSUE-703: non-DOM change port stays stable across repeated member edits and rejects old event ownership", async () => {
  dom.window.localStorage.clear();
  const container = dom.window.document.createElement("div");
  dom.window.document.body.append(container);
  const root = createRoot(container);
  const callbacks = [];
  const renderVideoForm = args => {
    callbacks.push({ changed: args.onFormStateChanged, success: args.onSubmitSuccess });
    return renderStub(args);
  };
  try {
    await act(async () => root.render(React.createElement(UnslottedPostShell, props({ renderVideoForm }))));
    await act(async () => selected(container, "none").click());
    const firstChange = callbacks.at(-1).changed;
    const firstSuccess = callbacks.at(-1).success;
    await act(async () => firstChange());
    assert.strictEqual(callbacks.at(-1).changed, firstChange,
      "same-selection rerender must not replace an effect-dependent child callback");
    const secondSuccess = callbacks.at(-1).success;
    assert.notStrictEqual(secondSuccess, firstSuccess);

    await act(async () => firstChange());
    assert.strictEqual(callbacks.at(-1).changed, firstChange,
      "a second member update through the same callback remains accepted");
    assert.notStrictEqual(callbacks.at(-1).success, secondSuccess,
      "every subsequent member change invalidates older in-flight completion");

    await act(async () => selected(container, "event").click());
    await act(async () => setSelect(container.querySelector("#unslotted_event_choice"), "event-A"));
    const eventCallback = callbacks.at(-1).changed;
    const eventSuccess = callbacks.at(-1).success;
    await act(async () => firstChange());
    assert.strictEqual(callbacks.at(-1).success, eventSuccess,
      "a detached no-event child cannot report edits to the event-A form");
    await act(async () => eventCallback());
    assert.notStrictEqual(callbacks.at(-1).success, eventSuccess,
      "a live event-A child can report a programmatic update");
  } finally {
    await act(async () => root.unmount());
    container.remove();
    dom.window.localStorage.clear();
  }
});

test("U03a / MIG-0713 integration: actual member reorder has no native change event and preserves newer draft", async () => {
  dom.window.localStorage.clear();
  const key = buildFormDraftStorageKey({
    authUserId: "u1", formId: "unslotted-shell:alice", schemaVersion: "unslotted-shell-v1",
  });
  const members = [
    { name: "Alice", x_user_id: "alice", role: "映像", comment: "", chapters: [] },
    { name: "Bob", x_user_id: "bob", role: "作画", comment: "", chapters: [] },
  ];
  const ports = {
    searchXUsers: async () => ({ items: [], hasMore: false, nextOffset: null }),
    applyPermissionBatch: async () => ({ ok: false, message: "no permission" }),
  };
  const callbacks = [];
  // Keep the downstream member-field onChange stable exactly as CURRENT
  // VideoForm.handleMembersChange does, even as the outer shell rerenders.
  function MemberForm({ input }) {
    const handleMembersChange = React.useCallback(
      () => input.onFormStateChanged(), [input.onFormStateChanged],
    );
    return React.createElement("form", { "data-form-key": input.formKey },
      React.createElement(VideoMembersField, {
        ...ports, initialMembers: members, onChange: handleMembersChange,
      }));
  }
  const renderVideoForm = input => {
    callbacks.push(input.onSubmitSuccess);
    return React.createElement(MemberForm, { input });
  };
  const container = dom.window.document.createElement("div");
  dom.window.document.body.append(container);
  const root = createRoot(container);
  let nativeChanges = 0;
  container.addEventListener("change", () => { nativeChanges += 1; });
  try {
    await act(async () => root.render(React.createElement(UnslottedPostShell, props({ renderVideoForm }))));
    await act(async () => selected(container, "none").click());
    // The affiliation radio change is native. Count subsequent member-only events.
    const beforeMoveChangeCount = nativeChanges;
    const oldSuccess = callbacks.at(-1);
    const getMembers = () => JSON.parse(container.querySelector('input[name="members_json"]').value);
    assert.deepEqual(getMembers().map(member => member.x_user_id), ["alice", "bob"]);
    const move = container.querySelector('[aria-label="2人目を上へ移動"]');
    assert.ok(move, "actual migrated VideoMembersField exposes the reorder action");
    await act(async () => move.click());
    assert.equal(nativeChanges, beforeMoveChangeCount,
      "member reorder is a button-only state update, not a form change event");
    assert.deepEqual(getMembers().map(member => member.x_user_id), ["bob", "alice"],
      "actual member component must preserve the reordered form payload");
    const newSuccess = callbacks.at(-1);
    assert.notStrictEqual(newSuccess, oldSuccess,
      "the real member field must notify the shell and invalidate old submit success");

    await act(async () => dom.window.dispatchEvent(new dom.window.Event("pagehide")));
    const saved = dom.window.localStorage.getItem(key);
    assert.ok(saved, "a button-only member edit still keeps the draft available");
    await act(async () => oldSuccess());
    assert.equal(dom.window.localStorage.getItem(key), saved,
      "an in-flight old success cannot clear the new draft after member reorder");
    await act(async () => newSuccess());
    assert.equal(dom.window.localStorage.getItem(key), null,
      "a completion bound to the latest rendered member state can clear the draft");
  } finally {
    await act(async () => root.unmount());
    container.remove();
    dom.window.localStorage.clear();
  }
});

test("U03a ISSUE-703: an abandoned event-options transition cannot revoke the committed form", async () => {
  dom.window.localStorage.clear();
  const key = buildFormDraftStorageKey({
    authUserId: "u1", formId: "unslotted-shell:alice", schemaVersion: "unslotted-shell-v1",
  });
  const callbacks = [];
  const renderedOptions = [];
  const never = new Promise(() => {});
  const renderVideoForm = args => {
    callbacks.push(args.onSubmitSuccess);
    return renderStub(args);
  };
  function Suspender({ blocked }) {
    if (blocked) throw never;
    return null;
  }
  function Host({ choices, blocked = false }) {
    return React.createElement(React.Suspense,
      { fallback: React.createElement("div", { "data-testid": "suspended-update" }, "Loading") },
      React.createElement(UnslottedPostShell, props({
        eventOptions: choices,
        renderVideoForm,
      })),
      React.createElement(React.Fragment, null,
        React.createElement("output", { "data-testid": "render-observation" },
          String(renderedOptions.push(choices.length))),
        React.createElement(Suspender, { blocked })),
    );
  }
  const container = dom.window.document.createElement("div");
  dom.window.document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(React.createElement(Host, { choices: [eventA] })));
    await act(async () => selected(container, "event").click());
    await act(async () => setSelect(container.querySelector("#unslotted_event_choice"), "event-A"));
    const committedSuccess = callbacks.at(-1);
    await act(async () => dom.window.dispatchEvent(new dom.window.Event("pagehide")));
    assert.ok(dom.window.localStorage.getItem(key));
    const priorAttempts = renderedOptions.length;

    // Render the unavailable list in a transition, but suspend a sibling
    // before the new tree can commit. The old event-A form stays displayed.
    await act(async () => {
      React.startTransition(() => root.render(React.createElement(Host, {
        choices: [], blocked: true,
      })));
    });
    assert.ok(renderedOptions.length > priorAttempts,
      "the withheld options must actually have been rendered");
    assert.equal(renderedOptions.at(-1), 0);
    assert.equal(container.querySelector('input[name="event_ids"]')?.value, "event-A",
      "the transition has not committed; event-A remains the actual visible form");
    assert.equal(container.querySelector('[data-testid="suspended-update"]'), null);

    // A render-phase write to latestEventOptionsRef would incorrectly deny
    // this valid completion based on the abandoned, uncommitted [] options.
    await act(async () => committedSuccess());
    assert.equal(dom.window.localStorage.getItem(key), null,
      "committed eligibility, not speculative render input, controls draft cleanup");
  } finally {
    await act(async () => root.unmount());
    container.remove();
    dom.window.localStorage.clear();
  }
});

test("U03a ISSUE-703: a delayed previous-affiliation flush registration cannot overwrite the live event form", async () => {
  dom.window.localStorage.clear();
  const container = dom.window.document.createElement("div");
  dom.window.document.body.append(container);
  const root = createRoot(container);
  const registrations = [];
  const eventB = { ...eventA, id: "event-B", title: "Event B" };
  const renderVideoForm = args => {
    registrations.push({
      eventIds: args.initial.event_ids,
      register: args.onDraftFlushReady,
      changed: args.onFormStateChanged,
    });
    return renderStub(args);
  };
  let previousFlushes = 0;
  let currentFlushes = 0;
  let staleFlushes = 0;
  try {
    await act(async () => root.render(React.createElement(UnslottedPostShell, props({
      eventOptions: [eventA, eventB], renderVideoForm,
    }))));
    await act(async () => selected(container, "none").click());
    const previousRegistration = registrations.at(-1).register;
    previousRegistration(() => { previousFlushes += 1; return true; });

    await act(async () => selected(container, "event").click());
    await act(async () => setSelect(container.querySelector("#unslotted_event_choice"), "event-A"));
    assert.deepEqual(registrations.at(-1).eventIds, ["event-A"]);
    const currentRegistration = registrations.at(-1).register;
    assert.notStrictEqual(currentRegistration, previousRegistration,
      "new affiliation/event needs a different registration ownership token");
    currentRegistration(() => { currentFlushes += 1; return true; });

    // A detached form's delayed effect runs after the new child has registered.
    // Previously the stable parent registration accepted this stale callback.
    previousRegistration(() => { staleFlushes += 1; return true; });
    const liveChanged = registrations.at(-1).changed;
    await act(async () => liveChanged());
    assert.strictEqual(registrations.at(-1).register, currentRegistration,
      "normal live member edits keep the registration port stable");
    await act(async () => setSelect(container.querySelector("#unslotted_event_choice"), "event-B"));
    assert.equal(currentFlushes, 1, "the live event-A form is flushed exactly once");
    assert.equal(staleFlushes, 0, "a detached no-event form must never replace the live flush");
    assert.equal(previousFlushes, 1, "the departed no-event flusher is consumed once and never replayed");
    assert.equal(container.querySelector('input[name="event_ids"]').value, "event-B");
  } finally {
    await act(async () => root.unmount());
    container.remove();
    dom.window.localStorage.clear();
  }
});

test("U03a ISSUE-703: one-shot flush registration during rapid event selections", async () => {
  dom.window.localStorage.clear();
  const container = dom.window.document.createElement("div");
  dom.window.document.body.append(container);
  const root = createRoot(container);
  const eventB = { ...eventA, id: "event-B", title: "Event B" };
  const eventC = { ...eventA, id: "event-C", title: "Event C" };
  const snapshots = [];
  const renderVideoForm = args => {
    snapshots.push(args);
    return renderStub(args);
  };
  let oldFormFlushes = 0;
  let newFormFlushes = 0;
  try {
    await act(async () => root.render(React.createElement(UnslottedPostShell, props({
      eventOptions: [eventA, eventB, eventC], renderVideoForm,
    }))));
    await act(async () => selected(container, "event").click());
    await act(async () => setSelect(container.querySelector("#unslotted_event_choice"), "event-A"));
    const oldForm = snapshots.at(-1);
    assert.deepEqual(oldForm.initial.event_ids, ["event-A"]);
    oldForm.onDraftFlushReady(() => { oldFormFlushes += 1; return true; });

    await act(async () => setSelect(container.querySelector("#unslotted_event_choice"), "event-B"));
    assert.equal(oldFormFlushes, 1, "event-A is flushed on departure");
    // Simulate an async/slow event-B child that has not registered its flusher
    // yet: a second choice must not invoke event-A's stale callback again.
    assert.deepEqual(snapshots.at(-1).initial.event_ids, ["event-B"]);
    await act(async () => setSelect(container.querySelector("#unslotted_event_choice"), "event-C"));
    assert.equal(oldFormFlushes, 1, "the departed event-A flusher is consumed exactly once");
    assert.deepEqual(snapshots.at(-1).initial.event_ids, ["event-C"]);

    const current = snapshots.at(-1);
    current.onDraftFlushReady(() => { newFormFlushes += 1; return true; });
    await act(async () => setSelect(container.querySelector("#unslotted_event_choice"), "event-B"));
    assert.equal(newFormFlushes, 1, "the newly registered event-C flusher still operates");
    assert.equal(oldFormFlushes, 1, "event-A cannot be flushed by the later transition");
    assert.equal(container.querySelector('input[name="event_ids"]')?.value, "event-B");
  } finally {
    await act(async () => root.unmount());
    container.remove();
    dom.window.localStorage.clear();
  }
});


// Exercise the owner-history bound through actual committed React mounts and
// browser-local storage. Other identities are pristine and must not create drafts.
for (const interveningOwners of [63, 64]) {
  test("U03a ISSUE-703: departed draft owner after " + interveningOwners + " distinct committed owners", async () => {
    dom.window.localStorage.clear();
    const user = "owner-bound-" + interveningOwners;
    const key = buildFormDraftStorageKey({
      authUserId: user, formId: "unslotted-shell:alice", schemaVersion: "unslotted-shell-v1",
    });
    const container = dom.window.document.createElement("div");
    dom.window.document.body.append(container);
    const root = createRoot(container);
    let latestSuccess;
    const renderVideoForm = args => {
      latestSuccess = args.onSubmitSuccess;
      return renderStub(args);
    };
    const render = authUserId => React.createElement(UnslottedPostShell,
      props({ draftAuthUserId: authUserId, renderVideoForm }));
    try {
      await act(async () => root.render(render(user)));
      await act(async () => selected(container, "none").click());
      const departedSuccess = latestSuccess;
      assert.equal(typeof departedSuccess, "function");

      for (let i = 0; i < interveningOwners; i++) {
        await act(async () => root.render(render(user + "-other-" + i)));
        assert.equal(container.querySelector("form"), null, "pristine identity has no child");
      }
      const before = dom.window.localStorage.getItem(key);
      assert.ok(before, "dirty departed shell flushed its draft");
      assert.deepEqual(JSON.parse(before).value, { affiliation: "none", selectedEventId: "" });
      assert.equal(dom.window.localStorage.length, 1, "pristine identities wrote no drafts");

      await act(async () => departedSuccess());
      if (interveningOwners === 63) {
        assert.equal(dom.window.localStorage.getItem(key), null,
          "the oldest retained owner may still clear its own draft");
      } else {
        assert.equal(dom.window.localStorage.getItem(key), before,
          "evicted ownership must preserve the draft rather than delete it");
        await act(async () => root.render(render(user)));
        assert.equal(selected(container, "none").checked, true, "returning identity restores its draft");
        const returnedSuccess = latestSuccess;
        assert.notEqual(returnedSuccess, departedSuccess);
        await act(async () => departedSuccess());
        assert.equal(dom.window.localStorage.getItem(key), before,
          "the old owner remains fenced after its key is registered again");
        await act(async () => returnedSuccess());
        assert.equal(dom.window.localStorage.getItem(key), null,
          "the new committed owner may clear its own draft");
      }
    } finally {
      await act(async () => root.unmount());
      container.remove();
      dom.window.localStorage.clear();
    }
  });
}

// B04 uses the actual full form, actual member editor and shell, with only the
// external submit port deferred. Browser evidence separately exercises multipart HTTP.
const { VideoForm } = await import("../.test-dist/apps/app/src/components/forms/VideoForm.js");
const { UnslottedPostForm } = await import("../.test-dist/apps/app/src/components/forms/UnslottedPostForm.js");
const { MemoryRouter, useLocation } = await import("react-router-dom");
dom.window.requestAnimationFrame = callback => dom.window.setTimeout(callback, 0);
dom.window.cancelAnimationFrame = id => dom.window.clearTimeout(id);
dom.window.HTMLElement.prototype.scrollIntoView = () => {};
const fullInitial = {
  title: "Before", display_name: "Alice", creator_x_user_id: "alice", youtube_url: "https://youtu.be/dQw4w9WgXcQ",
  intro_comment: "Introduction", other_social_links: '[{"type":"X","url":"https://x.com/alice"}]', updated_at: 42,
  is_collab: true, members: [
    { name: "Alice", x_user_id: "alice", role: "映像", comment: "", chapters: [] },
    { name: "Bob", x_user_id: "bob", role: "作画", comment: "", chapters: [] },
  ], event_ids: [],
};
const fullKeys = (x = "alice", mode = "free") => [
  `fn:draft:u1:${mode === "edit" ? "video-edit:v1:normal" : `video-free:${x}`}:video-form-v1`,
  `fn:draft:u1:unslotted-shell:${x}:unslotted-shell-v1`,
];
const formButton = (container, label) => [...container.querySelectorAll("button")].find(node => node.textContent.trim() === label);
const inputValue = (node, value) => {
  Object.getOwnPropertyDescriptor(node.tagName === "TEXTAREA" ? dom.window.HTMLTextAreaElement.prototype : dom.window.HTMLInputElement.prototype, "value").set.call(node, value);
  node.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
};
async function withFullForm(options, check) {
  dom.window.localStorage.clear();
  const container = dom.window.document.createElement("div"); dom.window.document.body.append(container);
  const root = createRoot(container), requests = [], removed = [];
  const originalRemove = dom.window.Storage.prototype.removeItem;
  dom.window.Storage.prototype.removeItem = function (key) { removed.push(key); return originalRemove.call(this, key); };
  let refreshes = 0, notifications = 0, successes = 0;
  let config = { initial: structuredClone(fullInitial), mode: "free", activeXId: "alice", draftAuthUserId: "u1", videoId: "v1",
    eventOptions: [], disabledSections: [], disabledFields: [], xIdOptions: [],
    submit: (mode, data) => new Promise((resolve, reject) => requests.push({ mode, data, resolve, reject })),
    searchXUsers: async () => ({ items: [], hasMore: false }), applyPermissionBatch: async () => ({ ok: false }),
    onRefresh: () => refreshes++, onFormStateChanged: () => notifications++, onSubmitSuccess: () => successes++, ...options };
  function Location() { return React.createElement("output", { "data-location": true }, useLocation().pathname + useLocation().search); }
  const render = async (patch = {}, transition = false) => {
    config = { ...config, ...patch };
    const update = () => root.render(React.createElement(MemoryRouter, null,
      React.createElement(config.Component ?? (config.shell ? UnslottedPostForm : VideoForm), config), React.createElement(Location)));
    await act(async () => { if (transition) React.startTransition(update); else update(); });
  };
  const h = { container, requests, removed, root, render, config: () => config,
    counters: () => ({ refreshes, notifications, successes }),
    data: () => new dom.window.FormData(container.querySelector("form")),
    change: (selector, value) => act(async () => inputValue(container.querySelector(selector), value)),
    click: selector => act(async () => container.querySelector(selector).click()),
    button: label => act(async () => { const button = formButton(container, label); assert.ok(button, label); button.click(); }),
    pagehide: () => act(async () => dom.window.dispatchEvent(new dom.window.Event("pagehide"))),
    wait: (ms = 550) => act(async () => new Promise(resolve => setTimeout(resolve, ms))),
    submit: () => act(async () => container.querySelector("form").dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }))),
    confirm: async () => {
      for (let i = 0; i < 3; i++) await h.submit();
      assert.equal(requests.length, 0, "implicit Enter only advances the hidden-but-mounted wizard");
      await h.submit(); assert.equal(requests.length, 0, "confirmation still requires its explicit button");
      await h.button("提出する");
    },
  };
  try { await render(); await check(h); }
  finally {
    await act(async () => { root.unmount(); for (const request of requests) request.resolve({ ok: false }); });
    dom.window.Storage.prototype.removeItem = originalRemove; container.remove(); dom.window.localStorage.clear();
  }
}

test("B04 #703: real native/member edits preserve both drafts continuously after old success; current success stays clear", async () => {
  await withFullForm({ shell: true }, async h => {
    await act(async () => selected(h.container, "none").click());
    await h.change("#title", "Submitted title"); await h.pagehide(); await h.confirm();
    assert.equal(h.requests.length, 1); assert.equal(h.requests[0].mode, "free");
    assert.deepEqual(JSON.parse(h.requests[0].data.get("members_json")).map(x => x.x_user_id), ["alice", "bob"]);
    await h.click('[aria-label="2人目を上へ移動"]');
    await h.click('[aria-label="2人目を削除"]'); await h.button("行を追加");
    await act(async () => inputValue(h.container.querySelectorAll('input[placeholder="表示名"]')[1], "Cara"));
    await h.change("#title", "New title"); await h.change("#intro_comment", "New introduction"); await h.pagehide();
    const keys = fullKeys(); for (const key of keys) assert.ok(dom.window.localStorage.getItem(key));
    h.removed.length = 0;
    await act(async () => h.requests[0].resolve({ ok: true, videoId: "saved" }));
    assert.deepEqual(h.removed, [], "no remove/recreate gap is allowed for either newer draft");
    await h.wait(); assert.deepEqual(h.removed, []);
    const saved = JSON.parse(dom.window.localStorage.getItem(keys[0])).value;
    assert.equal(saved.fields.title, "New title"); assert.equal(saved.fields.intro_comment, "New introduction");
    assert.deepEqual(saved.members.map(x => x.name), ["Bob", "Cara"]);
    assert.ok(dom.window.localStorage.getItem(keys[1]));
    await h.button("提出する"); assert.equal(h.requests.length, 2);
    assert.equal(h.requests[1].data.get("title"), "New title");
    await act(async () => h.requests[1].resolve({ ok: true }));
    await h.pagehide(); await h.wait();
    for (const key of keys) assert.equal(dom.window.localStorage.getItem(key), null, "current success must stay cleared after lifecycle/debounce");
    assert.deepEqual(h.removed.sort(), keys.sort());
  });
});

test("B04: equivalent fresh props do not replay older drafts or turn passive initial echoes into edits", async () => {
  await withFullForm({ mode: "edit" }, async h => {
    await h.change("#title", "Stored title"); await h.pagehide();
    await h.change("#title", "Unsaved latest"); await h.click('[aria-label="2人目を上へ移動"]');
    const count = h.counters().notifications;
    const fresh = () => ({ initial: structuredClone(fullInitial), eventOptions: [], disabledSections: [], disabledFields: [], xIdOptions: [] });
    await h.render(fresh()); assert.equal(h.data().get("title"), "Unsaved latest");
    assert.deepEqual(JSON.parse(h.data().get("members_json")).map(x => x.x_user_id), ["bob", "alice"]);
    assert.equal(h.counters().notifications, count);
    await act(async () => { for (let i = 0; i < 2; i++) h.container.querySelector("form").dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true })); });
    assert.equal(h.requests.length, 1, "same-turn submits are rejected before pending can commit");
    let replacementCalls = 0;
    await h.render({ ...fresh(), onSubmitSuccess: () => replacementCalls++ });
    assert.equal(h.counters().notifications, count, "nonempty social links and members must not emit passive edits");
    await act(async () => h.requests[0].resolve({ ok: true })); await h.pagehide(); await h.wait();
    assert.equal(h.counters().successes, 1, "use the request-start callback, not a later ref");
    assert.equal(replacementCalls, 0); assert.equal(h.counters().refreshes, 1);
    assert.equal(dom.window.localStorage.getItem(fullKeys("alice", "edit")[0]), null);
  });
});

for (const change of ["permission", "selection", "withdrawal", "identity", "returning identity"]) {
  test(`B04: pending response cannot clear newer ${change} ownership/authority`, async () => {
    const shell = change === "selection" || change === "withdrawal";
    await withFullForm({ shell, eventOptions: shell ? [eventA] : [] }, async h => {
      if (shell) {
        await act(async () => selected(h.container, change === "withdrawal" ? "event" : "none").click());
        if (change === "withdrawal") await act(async () => setSelect(h.container.querySelector("#unslotted_event_choice"), eventA.id));
      }
      await h.change("#title", "Draft before response"); await h.confirm();
      if (change === "permission") await h.render({ disabledFields: ["video.title"] });
      if (change === "selection") {
        await act(async () => selected(h.container, "event").click());
        await act(async () => setSelect(h.container.querySelector("#unslotted_event_choice"), eventA.id));
      }
      if (change === "withdrawal") await h.render({ eventOptions: [] });
      if (change.includes("identity")) {
        await h.render({ activeXId: "bob" });
        await h.change("#title", "Bob current draft"); await h.pagehide();
        if (change === "returning identity") { await h.render({ activeXId: "alice" }); await h.change("#title", "Returned Alice"); await h.pagehide(); }
      }
      await h.pagehide(); h.removed.length = 0;
      const keys = Object.keys(dom.window.localStorage);
      await act(async () => h.requests[0].resolve({ ok: true })); await h.wait();
      assert.deepEqual(h.removed, [], "an old response must never temporarily remove a retained draft");
      for (const key of keys) assert.ok(dom.window.localStorage.getItem(key));
      assert.equal(h.counters().refreshes, 0);
    });
  });
}

test("B04: optional slot validates nonempty URL, optional edit delegates it; failures retain text and current guard redirects", async () => {
  for (const [mode, url, sends] of [["slot", "", true], ["slot", "invalid", false], ["free", "invalid", false], ["edit", "invalid", true]]) {
    await withFullForm({ mode, slotId: "s1", initial: { ...fullInitial, youtube_url: mode === "edit" ? "" : url } }, async h => {
      if (mode === "edit") await h.change("#youtube_url", url);
      await h.change("#title", "Keep on failure");
      if (mode === "edit") await h.submit();
      else { for (let i = 0; i < 3; i++) await h.submit(); if (sends) await h.button("提出する"); }
      assert.equal(h.requests.length, sends ? 1 : 0, `${mode}/${url}`);
      if (!sends) { assert.match(h.container.textContent, /YouTube/); return; }
      assert.equal(h.requests[0].mode, mode === "edit" ? "update" : "slot");
      assert.equal(h.requests[0].data.get("youtube_url"), url);
      await act(async () => h.requests[0].resolve({ ok: false, reason: "duplicate_youtube_id", message: "Already registered" }));
      assert.match(h.container.textContent, /Already registered/); assert.equal(h.counters().refreshes, 0);
      assert.ok(Object.values(dom.window.localStorage).some(raw => raw.includes("Keep on failure")));
      if (mode === "edit") {
        await h.submit(); const log = console.error; console.error = () => {};
        try { await act(async () => h.requests[1].reject(new Error("transport down"))); } finally { console.error = log; }
        assert.match(h.container.textContent, /予期しないエラー/);
        await h.submit(); await act(async () => h.requests[2].resolve({ ok: false, reason: "tos_required" }));
        assert.equal(h.container.querySelector("[data-location]").textContent, "/onboarding?next=%2F");
      }
    });
  }
});

async function fileQueueController() {
  const moduleUrl = new URL("../.test-dist/apps/app/src/components/forms/VideoForm.js", import.meta.url);
  let source = readFileSync(moduleUrl, "utf8").replace(/from "([^"]+)"/g, (_, path) => `from ${JSON.stringify(path.startsWith(".") ? new URL(path, moduleUrl).href : import.meta.resolve(path))}`);
  // Exercise the real controller and sections. Observe the existing crop-output
  // callback only; deferred file-store I/O replaces IndexedDB scheduling here.
  // The probe suppresses crop UI replay of that confirmed File; real crop,
  // native file input and IndexedDB are separate Chromium acceptance evidence.
  source = source.replace(/import \{ VideoFormSubmitterSection \} from ([^;]+);/, `import { VideoFormSubmitterSection as ActualSubmitterSection } from $1;
function VideoFormSubmitterSection(props) { globalThis.__videoFileProbe.section = props; return React.createElement(ActualSubmitterSection, { ...props, restoredUploadFile: null }); }`);
  source = source.replace(/import \{[^\n]+\} from "[^\n]+\/draftFileStore.js";/,
    `const DRAFT_FILE_TTL_MS = 604800000;
const cleanupExpiredDraftFiles = async () => 0;
const loadDraftFile = key => globalThis.__videoFileProbe.load(key);
const saveDraftFile = (key, file) => globalThis.__videoFileProbe.save(key, file);
const deleteDraftFile = key => globalThis.__videoFileProbe.delete(key);`);
  return (await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`)).VideoForm;
}

test("B04: icon I/O orders same-key owners, drains accepted cleanup, and retains a queued upload across unrelated edits/failure", async () => {
  const Component = await fileQueueController();
  for (const scenario of ["success-remount", "success-unmount", "text-edit", "failed-tail", "metadata-refresh", "restore-waits", "queued-upload-remount", "cancel-remount", "invalidated-success-delete"]) {
    const files = new Map(), operations = []; let release, delayed = true, loads = 0;
    globalThis.__videoFileProbe = {
      load: async key => { loads++; return scenario === "cancel-remount" ? files.get(key) ?? null : null; },
      save: async (key, file) => {
        operations.push(`start:${file.name}`);
        if (delayed) { delayed = false; await new Promise((resolve, reject) => { release = failure => failure ? reject(new Error("blocked transaction failed")) : resolve(); }); }
        files.set(key, file); operations.push(`saved:${file.name}`); return true;
      },
      delete: async key => { operations.push("delete"); files.delete(key); return true; },
    };
    try {
      await withFullForm({ Component, mode: "edit" }, async h => {
        const key = fullKeys("alice", "edit")[0] + ":icon";
        await act(async () => globalThis.__videoFileProbe.section.handleUploadFileChange(new dom.window.File(["old"], "old.png")));
        assert.equal(operations[0], "start:old.png");
        if (scenario === "invalidated-success-delete") {
          await act(async () => globalThis.__videoFileProbe.section.handleUploadFileChange(new dom.window.File(["new"], "new.png")));
          await h.submit(); await act(async () => h.requests[0].resolve({ ok: true }));
          await h.change("#title", "Edit after accepted success");
        }
        if (scenario.startsWith("success")) {
          if (scenario === "success-unmount") await h.render({ onSubmitSuccess: () => h.root.render(null) });
          await h.change("#title", "Submitted with icon"); await h.submit();
          await h.render({ onSubmitSuccess: () => assert.fail("must use request-start callback") });
          // Replacement callbacks cannot change this accepted request. In the
          // unmount case, the captured callback departs before the queue drains.
          await act(async () => h.requests[0].resolve({ ok: true }));
          await act(async () => h.root.render(null));
          if (scenario === "success-remount") await h.render({ onSubmitSuccess: () => {}, initial: { ...fullInitial, title: "New owner" } });
        }
        if (["restore-waits", "queued-upload-remount", "cancel-remount"].includes(scenario)) {
          if (scenario === "cancel-remount") await act(async () => globalThis.__videoFileProbe.section.handleUploadFileChange(null));
          if (scenario === "queued-upload-remount") await act(async () => globalThis.__videoFileProbe.section.handleUploadFileChange(new dom.window.File(["new"], "new.png")));
          await h.pagehide(); await act(async () => h.root.render(null));
          await h.render(); assert.equal(loads, 0, "restoration waits behind the unavoidable earlier write");
        } else if (scenario !== "success-unmount" && scenario !== "invalidated-success-delete") {
          await act(async () => globalThis.__videoFileProbe.section.handleUploadFileChange(new dom.window.File(["new"], "new.png")));
          await h.change("#title", "Edit after icon selection");
          if (scenario === "metadata-refresh") await h.render({ initial: { ...fullInitial, updated_at: 43 } });
        }
        assert.deepEqual(operations, ["start:old.png"], "no newer mutation may overtake active same-key I/O");
        await act(async () => release(scenario === "failed-tail"));
        if (scenario === "success-unmount") {
          assert.equal(files.has(key), false); assert.equal(operations.at(-1), "delete", "accepted cleanup drains after departure with no successor");
        } else if (scenario === "cancel-remount") {
          assert.equal(globalThis.__videoFileProbe.section.restoredUploadFile, null, "a canceled old image must not return after same-key remount");
          assert.equal(files.has(key), false, "the latest admitted cancellation drains before successor restoration");
        } else if (scenario === "restore-waits") {
          assert.equal(loads, 1); assert.equal(files.get(key).name, "old.png");
        } else {
          assert.equal(files.get(key).name, "new.png", scenario); assert.equal(operations.at(-1), "saved:new.png");
          const deletion = operations.indexOf("delete");
          assert.ok(deletion < operations.indexOf("start:new.png"), "an admitted earlier delete can only precede the successor save, never erase it afterward");
          if (scenario === "invalidated-success-delete") assert.equal(deletion, -1, "later text invalidates accepted cleanup without discarding the earlier queued upload");
        }
      });
    } finally { release?.(); delete globalThis.__videoFileProbe; }
  }
});

test("B04: accepted edit success synchronously unmounts without refresh or draft resurrection", async () => {
  await withFullForm({ mode: "edit" }, async h => {
    await h.render({ onSubmitSuccess: () => { h.root.render(null); } });
    await h.change("#title", "Saved edit"); await h.submit();
    await act(async () => h.requests[0].resolve({ ok: true }));
    await h.pagehide(); await h.wait();
    assert.equal(h.container.querySelector("form"), null);
    assert.equal(h.counters().refreshes, 0, "refresh belongs to the still-mounted editor only");
    assert.equal(dom.window.localStorage.getItem(fullKeys("alice", "edit")[0]), null);
  });
});

test("B04: actual first channel apply and profile reapply invalidate pending success without initial echo notifications", async () => {
  for (const operation of ["channel", "profile"]) {
    await withFullForm({ mode: "edit", defaultProfile: { display_name: "Default name", youtube_channel_url: "https://www.youtube.com/@default" } }, async h => {
      assert.equal(h.counters().notifications, 0);
      await h.change("#title", "Pending title"); await h.submit();
      if (operation === "profile") await h.button("現在の既定プロフィールを再適用");
      else {
        await act(async () => formButton(h.container.querySelector(".ychan-root"), "設定").click());
        await h.change(".ychan-root input:not([type=hidden])", "https://www.youtube.com/@newchannel");
        await h.button("適用");
      }
      assert.ok(h.counters().notifications > 0);
      await h.pagehide(); h.removed.length = 0;
      await act(async () => h.requests[0].resolve({ ok: true }));
      assert.deepEqual(h.removed, []); assert.equal(h.counters().refreshes, 0);
      assert.equal(h.data().get("youtube_channel_url"), operation === "profile" ? "https://www.youtube.com/@default" : "https://www.youtube.com/@newchannel");
    });
  }
});

test("B04: exact free-key exception preserves nullish/fallback/slot/edit rules and never adopts ambiguous legacy text", async () => {
  for (const [activeXId, creator, mode, privilege, formId] of [
    [undefined, "", "free", undefined, "video-free:unassigned"], [null, "fallback", "free", undefined, "video-free:fallback"],
    ["", "fallback", "free", undefined, "video-free:unassigned"], [null, "unassigned", "free", undefined, "video-free:unassigned"],
    ["unassigned", "", "free", undefined, "video-free:xid:unassigned"], ["@UNASSIGNED", "", "free", undefined, "video-free:xid:unassigned"],
    ["@ALICE", "", "free", undefined, "video-free:alice"], ["unassigned", "", "slot", undefined, "video-slot:s1"],
    ["unassigned", "", "edit", "admin", "video-edit:v1:admin"],
  ]) await withFullForm({ activeXId, mode, slotId: "s1", editPrivilegeMode: privilege, initial: { ...fullInitial, creator_x_user_id: creator } }, async h => {
    await h.change("#title", "Exact key draft"); await h.pagehide();
    assert.ok(dom.window.localStorage.getItem(`fn:draft:u1:${formId}:video-form-v1`), `${mode}/${String(activeXId)}/${creator}`);
  });
  await withFullForm({ activeXId: null, initial: { ...fullInitial, creator_x_user_id: "" } }, async h => {
    await h.change("#title", "Ambiguous old draft"); await h.pagehide();
    const legacyKey = fullKeys("unassigned")[0];
    await act(async () => h.root.render(null)); h.removed.length = 0;
    const legacy = dom.window.localStorage.getItem(legacyKey);
    await h.render({ activeXId: "@UNASSIGNED" }); await h.wait();
    assert.equal(h.data().get("title"), fullInitial.title, "do not adopt old missing-X text for a real literal handle");
    assert.equal(dom.window.localStorage.getItem(legacyKey), legacy); assert.deepEqual(h.removed, []);
    await h.change("#title", "Literal handle draft"); await h.pagehide();
    assert.ok(dom.window.localStorage.getItem(fullKeys("xid:unassigned")[0]));
    assert.equal(dom.window.localStorage.getItem(legacyKey), legacy);
  });
});

test("B04: full native/controlled restore respects current locks and preserves the live chapter baseline", async () => {
  const initial = { ...fullInitial, profile_text: "DB profile", members: fullInitial.members.map((member, i) => ({ ...member, chapters: [{ time: `${i + 1}:00`, label: member.role, note: "DB" }] })) };
  await withFullForm({ mode: "edit", initial }, async h => {
    await h.change("#title", "Draft title"); await h.change("#profile_text", "Draft profile"); await h.change("#intro_comment", "Draft introduction");
    await h.click('[aria-label="2人目を上へ移動"]'); await h.pagehide();
    await act(async () => h.root.render(null));
    await h.render({ disabledFields: ["video.title", "submitter.profile_text", "chapters"] });
    assert.equal(h.data().get("title"), "Before"); assert.equal(h.data().get("profile_text"), "DB profile");
    assert.equal(h.data().get("intro_comment"), "Draft introduction");
    const members = JSON.parse(h.data().get("members_json"));
    assert.deepEqual(members.map(x => x.x_user_id), ["bob", "alice"]);
    assert.deepEqual(members.map(x => x.chapters[0].time), ["1:00", "2:00"], "CURRENT locked chapters retain the current positional baseline");
    assert.equal(h.container.querySelector("#title").readOnly, true);
  });
});

test("B04: an abandoned authority render cannot revoke the committed full-form request", async () => {
  const never = new Promise(() => {});
  function Suspender({ blocked }) { if (blocked) throw never; return null; }
  function ConcurrentHost(props) {
    return React.createElement(React.Suspense, { fallback: React.createElement("p", null, "Uncommitted") },
      React.createElement(VideoForm, props), React.createElement(Suspender, { blocked: props.blocked }));
  }
  await withFullForm({ Component: ConcurrentHost, mode: "edit" }, async h => {
    await h.change("#title", "Committed draft"); await h.submit();
    await h.render({ blocked: true, disabledFields: ["video.title"] }, true);
    assert.equal(h.container.querySelector("#title").readOnly, false, "the previous authoritative tree remains visible");
    await act(async () => h.requests[0].resolve({ ok: true }));
    assert.equal(h.counters().successes, 1); assert.equal(h.counters().refreshes, 1);
    assert.equal(dom.window.localStorage.getItem(fullKeys("alice", "edit")[0]), null);
  });
});
