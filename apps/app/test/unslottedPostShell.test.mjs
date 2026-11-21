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
    assert.equal(previousFlushes, 2, "historical affiliation/event transitions are not changed");
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
