// SEC-921: mounted React regression for CURRENT Next viewer overlay.
 // This uses the actual TSX component with only visual children and Next module imports mocked.
 // It does not replace a real browser Discord/BFCache acceptance run.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { test } from "node:test";
import ts from "typescript";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "https://flamenode.test/event/a/slots", pretendToBeVisual: true,
});
for (const key of ["window", "document", "navigator", "HTMLElement", "Node"]) {
  Object.defineProperty(globalThis, key, {
    configurable: true, value: key === "window" ? dom.window : dom.window[key],
  });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const React = await import("react");
const { createRoot } = await import("react-dom/client");
const ReactDOM = await import("react-dom");
const jsxRuntime = await import("react/jsx-runtime");

const source = await readFile(
  new URL("../../../app/(public)/event/[id]/slots/EventSlotsViewerPanel.tsx", import.meta.url),
  "utf8",
);
const compiled = ts.transpileModule(source, {
  fileName: "EventSlotsViewerPanel.tsx",
  compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
    jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
  },
});
assert.deepEqual(compiled.diagnostics ?? [], []);

const requests = [];
let mounted = 0;
let unmounted = 0;
function SlotGrid(props) {
  React.useEffect(() => {
    mounted++;
    return () => { unmounted++; };
  }, []);
  return React.createElement("output", { id: "grid" }, JSON.stringify({
    viewerXId: props.viewerXId,
    slots: props.slots.map(slot => ({
      id: slot.id, owned: slot.is_owned_by_viewer, name: slot.display_name,
    })),
  }));
}
const visual = () => null;
const mocks = {
  "react": React,
  "react-dom": ReactDOM,
  "react/jsx-runtime": jsxRuntime,
  "next/link": ({ children, href }) => React.createElement("a", { href }, children),
  "@/components/ui/Icon": { Icon: visual },
  "@/components/event/SlotGrid": { SlotGrid },
  "@/components/event/SlotStatusBoard": { SlotStatusBoard: visual },
  "@/lib/client/activeXSwitchEvents": { ACTIVE_X_CHANGED_EVENT: "fn:test-active-x-changed" },
  "@/lib/utils/format": { formatUnix: String },
  "./page.module.css": { notice: "notice", layout: "layout", main: "main", aside: "aside" },
};
const exported = { exports: {} };
vm.runInNewContext(compiled.outputText, {
  module: exported, exports: exported.exports,
  require(id) {
    if (!(id in mocks)) throw new Error("Unexpected component import: " + id);
    return mocks[id];
  },
  window: dom.window, console,
  fetch(url, init) {
    let resolve;
    const promise = new Promise(r => { resolve = r; });
    requests.push({ url, init, resolve });
    return promise;
  },
  setTimeout, clearTimeout, AbortController,
}, { filename: "EventSlotsViewerPanel.cjs" });
const { EventSlotsViewerPanel } = exported.exports;

const baseSlots = [{ id: "slot-1", status: "reserved", display_name: null }];
const props = eventId => ({
  eventId, eventTitle: eventId, baseSlots, accepting: true,
  eventStatus: "active", slotType: "count", maxSlotsPerVideo: 2,
  maxSlotReservationsPerXId: 2, slotIntervalSec: null,
  slotPartGapSec: 0, parts: [], entryEndTime: null,
});
const overlay = name => ({
  loggedIn: true, authUnavailable: false, isBanned: false,
  needsTermsAcceptance: false, canReserveSlot: true, canPost: true,
  operatorOverrideAllowed: false, viewerXId: null, viewerXIdNotice: null,
  slots: [{
    id: "slot-1", display_name: name, viewer_relation: "unassigned",
    is_owned_by_viewer: true,
  }],
});
const response = value => ({
  ok: true, json: async () => value,
});
const pageTransition = (type, persisted) => {
  const event = new dom.window.Event(type);
  Object.defineProperty(event, "persisted", { value: persisted });
  return event;
};
const read = container => JSON.parse(container.querySelector("#grid").textContent);
async function settle(fn) {
  await React.act(async () => {
    fn?.();
    await Promise.resolve();
    await Promise.resolve();
  });
}

function CommitBoundaryProbe({ onCommit }) {
  React.useLayoutEffect(() => {
    onCommit();
  }, [onCommit]);
  return null;
}
async function commitAtLayout(root, element) {
  await React.act(async () => {
    ReactDOM.flushSync(() => root.render(element));
    for (let i = 0; i < 6; i++) await Promise.resolve();
  });
}

test("mounted overlay: persisted pagehide synchronously retires the current private receipt", async () => {
  const container = dom.window.document.createElement("div");
  dom.window.document.body.appendChild(container);
  const root = createRoot(container);
  const start = requests.length;
  try {
    await settle(() => root.render(React.createElement(EventSlotsViewerPanel, props("a"))));
    await settle(() => requests[start].resolve(response(overlay("private A"))));
    assert.equal(read(container).slots[0].name, "private A");

    await settle(() => {
      dom.window.dispatchEvent(pageTransition("pagehide", false));
      assert.equal(read(container).slots[0].name, "private A",
        "a non-persisted pagehide is not a BFCache snapshot");
    });
    await settle(() => {
      dom.window.dispatchEvent(pageTransition("pagehide", true));
      assert.equal(read(container).slots[0].owned, false,
        "flushSync must retire private ownership before pagehide returns");
      assert.equal(read(container).slots[0].name, null);
    });
    assert.equal(requests.length, start + 1, "pagehide must not start a replacement GET");

    await settle(() => dom.window.dispatchEvent(pageTransition("pageshow", true)));
    assert.equal(requests.length, start + 2, "restoration starts one fresh GET");
    await settle(() => requests[start + 1].resolve(response(overlay("restored A"))));
    assert.equal(read(container).slots[0].name, "restored A");
  } finally {
    await settle(() => root.unmount());
    container.remove();
  }
});

test("mounted overlay: persisted pagehide fences a pending private GET before restoration", async () => {
  const container = dom.window.document.createElement("div");
  dom.window.document.body.appendChild(container);
  const root = createRoot(container);
  const start = requests.length;
  const assertEmpty = () => {
    assert.equal(read(container).slots[0].owned, false);
    assert.equal(read(container).slots[0].name, null);
  };
  try {
    await settle(() => root.render(React.createElement(EventSlotsViewerPanel, props("a"))));
    assert.equal(requests.length, start + 1);
    await settle(() => {
      dom.window.dispatchEvent(pageTransition("pagehide", true));
      assertEmpty();
    });
    await settle(() => requests[start].resolve(response(overlay("stale pre-freeze A"))));
    assertEmpty();

    await settle(() => dom.window.dispatchEvent(pageTransition("pageshow", true)));
    assert.equal(requests.length, start + 2);
    await settle(() => requests[start + 1].resolve(response(overlay("fresh restored A"))));
    assert.equal(read(container).slots[0].name, "fresh restored A");
  } finally {
    await settle(() => root.unmount());
    container.remove();
  }
});

test("mounted overlay: reused baseSlots event change retires delayed old GET and resets key-bound grid", async () => {
  const container = dom.window.document.createElement("div");
  dom.window.document.body.appendChild(container);
  const root = createRoot(container);
  const start = requests.length, mountStart = mounted, unmountStart = unmounted;
  try {
    await settle(() => root.render(React.createElement(EventSlotsViewerPanel, props("a"))));
    assert.equal(requests.length, start + 1);
    assert.match(requests[start + 0].url, /\/event(s)?\/a\/slots\/viewer-overlay$/);
    assert.equal(read(container).slots[0].owned, false);

    // Simulate client route transition while A's credentialed request remains in flight.
    await settle(() => root.render(React.createElement(EventSlotsViewerPanel, props("b"))));
    assert.equal(requests.length, start + 2);
    assert.equal(read(container).slots[0].owned, false);
    assert.equal(unmounted, unmountStart + 1, "old SlotGrid must unmount when event id changes");

    await settle(() => requests[start + 0].resolve(response(overlay("A private"))));
    assert.equal(read(container).slots[0].owned, false, "late event A overlay cannot publish into B");
    assert.equal(read(container).slots[0].name, null);

    await settle(() => requests[start + 1].resolve(response(overlay("B private"))));
    assert.equal(read(container).slots[0].owned, true);
    assert.equal(read(container).slots[0].name, "B private");

    // A BFCache-like persisted pageshow must retire B's private overlay before
    // a replacement request resolves, regardless of null Active X on both accounts.
    await settle(() => {
      const event = new dom.window.Event("pageshow");
      Object.defineProperty(event, "persisted", { value: true });
      dom.window.dispatchEvent(event);
    });
    assert.equal(requests.length, start + 3);
    assert.equal(read(container).slots[0].owned, false);
    assert.equal(read(container).slots[0].name, null);

    await settle(() => requests[start + 2].resolve(response(overlay("new B"))));
    assert.equal(read(container).slots[0].name, "new B");

    // Revisit A with the identical baseSlots object; never reuse B's overlay.
    await settle(() => root.render(React.createElement(EventSlotsViewerPanel, props("a"))));
    assert.equal(requests.length, start + 4);
    assert.equal(read(container).slots[0].owned, false);
    assert.equal(unmounted, unmountStart + 2);
    await settle(() => requests[start + 3].resolve(response(overlay("new A"))));
    assert.equal(read(container).slots[0].name, "new A");
    assert.equal(mounted, mountStart + 3);
  } finally {
    await settle(() => root.unmount());
    container.remove();
  }
});

test("mounted overlay: loaded A cannot reappear on A→B→A while B is still pending", async () => {
  const container = dom.window.document.createElement("div");
  dom.window.document.body.appendChild(container);
  const root = createRoot(container);
  const start = requests.length;
  const assertEmpty = () => {
    assert.equal(read(container).slots[0].owned, false);
    assert.equal(read(container).slots[0].name, null);
  };
  try {
    await settle(() => root.render(React.createElement(EventSlotsViewerPanel, props("a"))));
    await settle(() => requests[start].resolve(response(overlay("previous A private"))));
    assert.equal(read(container).slots[0].name, "previous A private");

    await settle(() => root.render(React.createElement(EventSlotsViewerPanel, props("b"))));
    assertEmpty();
    await settle(() => root.render(React.createElement(EventSlotsViewerPanel, props("a"))));
    assert.equal(requests.length, start + 3);
    assertEmpty();

    // A response for B is allowed to complete even if the mock fetch ignored abort.
    await settle(() => requests[start + 1].resolve(response(overlay("late B private"))));
    assertEmpty();
    await settle(() => requests[start + 2].resolve(response(overlay("current A"))));
    assert.equal(read(container).slots[0].name, "current A");

    // An ordinary non-persisted pageshow must not force another request.
    await settle(() => dom.window.dispatchEvent(new dom.window.Event("pageshow")));
    assert.equal(requests.length, start + 3);
    assert.equal(read(container).slots[0].name, "current A");

    // Active X invalidation followed by persisted restoration retires both the
    // loaded receipt and the replacement request that has not settled yet.
    await settle(() => dom.window.dispatchEvent(new dom.window.Event("fn:test-active-x-changed")));
    assertEmpty();
    assert.equal(requests.length, start + 4);
    await settle(() => {
      const event = new dom.window.Event("pageshow");
      Object.defineProperty(event, "persisted", { value: true });
      dom.window.dispatchEvent(event);
    });
    assertEmpty();
    assert.equal(requests.length, start + 5);
    await settle(() => requests[start + 3].resolve(response(overlay("retired Active X response"))));
    assertEmpty();
    await settle(() => requests[start + 4].resolve(response(overlay("restored current viewer"))));
    assert.equal(read(container).slots[0].name, "restored current viewer");
    assert.equal(read(container).slots[0].owned, true);
  } finally {
    await settle(() => root.unmount());
    container.remove();
  }
});

test("mounted overlay: stale GETs resolved during successor layout commits stay hidden across A→B→A", async () => {
  const container = dom.window.document.createElement("div");
  dom.window.document.body.appendChild(container);
  const root = createRoot(container);
  const start = requests.length;
  const noCommit = () => {};
  const assertEmpty = () => {
    assert.equal(read(container).slots[0].owned, false);
    assert.equal(read(container).slots[0].name, null);
  };
  try {
    await settle(() => root.render(React.createElement(React.Fragment, null,
      React.createElement(EventSlotsViewerPanel, props("a")),
      React.createElement(CommitBoundaryProbe, { onCommit: noCommit }),
    )));
    assert.equal(requests.length, start + 1);

    // Resolve A from a layout effect in the successor B commit. The old
    // passive fetch cleanup has not run yet, so scope identity must fail closed.
    await commitAtLayout(root, React.createElement(React.Fragment, null,
      React.createElement(EventSlotsViewerPanel, props("b")),
      React.createElement(CommitBoundaryProbe, {
        onCommit: () => requests[start].resolve(response(overlay("late A private"))),
      }),
    ));
    assertEmpty();
    assert.equal(requests.length, start + 2, "B fetch starts after the commit-boundary probe");

    // Resolve B during the next A commit. Reusing baseSlots must not revive
    // either the previous A receipt or the late B response.
    await commitAtLayout(root, React.createElement(React.Fragment, null,
      React.createElement(EventSlotsViewerPanel, props("a")),
      React.createElement(CommitBoundaryProbe, {
        onCommit: () => requests[start + 1].resolve(response(overlay("late B private"))),
      }),
    ));
    assertEmpty();
    assert.equal(requests.length, start + 3, "the new A fetch starts after B is retired");

    await settle(() => requests[start + 2].resolve(response(overlay("current A"))));
    assert.equal(read(container).slots[0].name, "current A");
    assert.equal(read(container).slots[0].owned, true);
  } finally {
    await settle(() => root.unmount());
    container.remove();
  }
});
