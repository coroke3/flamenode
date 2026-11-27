// SEC-921: mount the real CURRENT SlotGrid and drive its actual action handlers.
// Next navigation/server actions and visual confirmation chrome are test doubles.
// The grouping, reservation limits and X-scoped name storage helpers are real.
// This tests the client lifecycle, not Discord login, actual browser BFCache,
// the D1 write path or a production deployment.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { test } from "node:test";
import ts from "typescript";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "https://flamenode.test/event/a/slots", pretendToBeVisual: true,
});
for (const key of ["window", "document", "navigator", "HTMLElement", "Node", "FormData"]) {
  Object.defineProperty(globalThis, key, {
    configurable: true, value: key === "window" ? dom.window : dom.window[key],
  });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const React = await import("react");
const { createRoot } = await import("react-dom/client");
const ReactDOM = await import("react-dom");
const jsxRuntime = await import("react/jsx-runtime");
const h = React.createElement;

const requests = [];
const refreshes = [];
const redirects = [];
const controlErrors = new WeakSet();
const controlRethrows = [];
const router = { refresh() { refreshes.push("refresh"); } };
const action = name => fd => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  requests.push({ name, fd, resolve, reject });
  return promise;
};
const visual = () => null;
const activeXChanged = "fn:test-active-x-changed";
const mocks = {
  react: React,
  "react-dom": ReactDOM,
  "react/jsx-runtime": jsxRuntime,
  "next/link": ({ children, ...props }) => h("a", props, children),
  "next/navigation": {
    unstable_rethrow(error) {
      if (controlErrors.has(error)) {
        controlRethrows.push(error);
        throw error;
      }
    },
    usePathname: () => "/event/a/slots", useRouter: () => router,
  },
  "@/components/ui/Icon": { Icon: visual },
  "@/components/ui/ConfirmDialog": {
    ConfirmDialog: ({ open, title, confirmLabel, onConfirm, onCancel }) =>
      open ? h("div", { role: "alertdialog" }, title,
        h("button", { type: "button", onClick: onConfirm }, confirmLabel),
        h("button", { type: "button", onClick: onCancel }, "cancel")) : null,
  },
  "@/components/ui/PublicReflectionDelayNotice": { PublicReflectionDelayNotice: visual },
  "@/lib/actions/slot": {
    reserveSlot: action("reserve"), releaseOwnSlot: action("release"),
    extendOwnSlotGroup: action("extend"), mergeOwnSlotGroups: action("merge"),
  },
  "@/lib/slots/contiguousAvailable": await import("./contiguousAvailable.ts"),
  "@/lib/slots/limits": await import("./limits.ts"),
  "@/lib/utils/format": await import("../utils/format.ts"),
  "@/lib/utils/cn": await import("../utils/cn.ts"),
  "@/lib/utils/slotGrouping": await import("../utils/slotGrouping.ts"),
  "@/lib/utils/slotGroupingCore": await import("../utils/slotGroupingCore.ts"),
  "@/lib/client/guardRedirect": { redirectForGuardReason(_router, reason) {
    redirects.push(reason);
    return true;
  } },
  "@/lib/utils/xid": await import("../utils/xid.ts"),
  "@/lib/client/activeXSwitchEvents": { ACTIVE_X_CHANGED_EVENT: activeXChanged },
  "@/lib/slots/slotDisplayNameStorage": await import("./slotDisplayNameStorage.ts"),
  "@/lib/ui/floatingMenuPosition": await import("../ui/floatingMenuPosition.ts"),
  "@/lib/slots/slotGuidance": await import("./slotGuidance.ts"),
  "@/lib/slots/slotReservationLimit": await import("./slotReservationLimit.ts"),
  "./SlotGrid.module.css": {},
};
const source = await readFile(new URL("../../components/event/SlotGrid.tsx", import.meta.url), "utf8");
// Expose the real private helper only in this isolated test module.
const compiled = ts.transpileModule(source + "\nexport { runSlotAction };\n", {
  fileName: "SlotGrid.tsx",
  compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
    jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
  },
  reportDiagnostics: true,
});
assert.deepEqual(compiled.diagnostics ?? [], []);
const exported = { exports: {} };
vm.runInNewContext(compiled.outputText, {
  module: exported, exports: exported.exports,
  require(id) {
    if (!Object.hasOwn(mocks, id)) throw new Error("Unexpected SlotGrid import: " + id);
    return mocks[id];
  },
  window: dom.window, document: dom.window.document,
  Node: dom.window.Node, CustomEvent: dom.window.CustomEvent,
  FormData, console, setInterval, clearInterval, setTimeout, clearTimeout,
}, { filename: "SlotGrid.cjs" });
const { SlotGrid, runSlotAction } = exported.exports;

test("SEC-921: retired control exceptions stop before unstable_rethrow, current control exceptions preserve identity", async () => {
  for (const kind of ["NEXT_REDIRECT", "NEXT_NOT_FOUND", "NEXT_FORBIDDEN", "NEXT_UNAUTHORIZED", "transport"]) {
    for (const retired of [false, true]) {
      const error = new Error(kind);
      if (kind !== "transport") controlErrors.add(error);
      const start = controlRethrows.length;
      let active = true, communicationErrors = 0, reject;
      const result = runSlotAction(
        () => new Promise((_resolve, no) => { reject = no; }),
        () => { communicationErrors++; },
        () => active,
      );
      if (retired) active = false;
      reject(error);
      if (!retired && kind !== "transport") {
        await assert.rejects(result, (received) => received === error);
        assert.equal(controlRethrows.length, start + 1);
      } else {
        assert.equal(await result, null);
        assert.equal(controlRethrows.length, start);
      }
      assert.equal(communicationErrors, !retired && kind === "transport" ? 1 : 0);
    }
  }
  assert.equal(await runSlotAction(async () => "current", () => assert.fail("unexpected error"), () => true), "current");
});

function slot(id, sort_order, owned = false) {
  return {
    id, sort_order, slot_label: id, start_time: null,
    status: owned ? "reserved" : "available",
    display_name: owned ? "previous viewer private name" : null,
    reserved_x_id: null, x_user_id: null, is_owned_by_viewer: owned, group_key: null,
  };
}
const slotsFor = name => name === "reserve" ? [slot("free", 1)]
  : name === "merge" ? [slot("left", 1, true), slot("gap", 2), slot("right", 3, true)]
  : [slot("left", 1, true), slot("free", 2)];
const freshSlots = () => [slot("next-free", 1)];
const props = (slots, viewerXId = null) => ({
  slots, viewerXId, isAuthenticated: true, canReserve: true, canTakeSlot: true,
  canPost: false, slotType: "count", maxSlotsPerVideo: 3,
});
async function settle(fn) {
  await React.act(async () => {
    fn?.();
    await Promise.resolve();
    await Promise.resolve();
  });
}
const byText = (root, text) => [...root.querySelectorAll("button")].find(el => el.textContent.trim() === text);
async function click(element, label) {
  assert.ok(element, "missing button: " + label);
  assert.equal(element.disabled, false, "disabled button: " + label);
  await settle(() => element.click());
}
function inputValue(input, value) {
  Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value").set.call(input, value);
  input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
}
async function startAction(container, name) {
  if (name === "reserve") {
    await click(container.querySelector('button[aria-label="free を確保"]'), "reserve");
    const input = container.querySelector("#reserve-display-name");
    assert.ok(input);
    assert.equal(input.value, "", "null X must not restore legacy storage");
    await settle(() => inputValue(input, "previous viewer private name"));
    const submit = container.querySelector('form[role="dialog"] button[type="submit"]');
    await click(submit, "submit reserve");
  } else if (name === "merge") {
    await click(container.querySelector('button[aria-label="gap を埋めて結合"]'), "merge");
    await click(byText(container, "結合する"), "confirm merge");
  } else {
    await click(container.querySelector("#slot-edit-left"), "edit");
    const menu = document.querySelector('[role="menu"]');
    assert.ok(menu, "portal menu");
    await click(byText(menu, name === "release" ? "解放" : "後を追加"), name);
    await click(byText(container, name === "release" ? "解放する" : "追加する"), "confirm " + name);
  }
}
function persistedPageShow() {
  const event = new dom.window.Event("pageshow");
  Object.defineProperty(event, "persisted", { value: true });
  window.dispatchEvent(event);
}
function persistedPageHide() {
  const event = new dom.window.Event("pagehide");
  Object.defineProperty(event, "persisted", { value: true });
  window.dispatchEvent(event);
}
function assertNoLocalActionUi(container) {
  assert.equal(container.querySelector('[role="dialog"], [role="alertdialog"]'), null);
  assert.equal(document.querySelector('[role="menu"]'), null);
  assert.equal(container.querySelector('[role="status"], [role="alert"]'), null);
}
function assertNoPrivateActionUi(container) {
  assertNoLocalActionUi(container);
  assert.doesNotMatch(container.textContent, /previous viewer private name/);
}

for (const name of ["reserve", "release", "extend", "merge"]) {
  for (const boundary of [
    "bfcache-null-X", "pagehide-null-X", "active-X", "event-unmount", "current-control",
    "control-bfcache", "control-event-unmount", "control-prop-only",
  ]) {
    test("SEC-921 mounted SlotGrid: " + name + " / " + boundary, async () => {
      const container = document.createElement("div");
      document.body.appendChild(container);
      const root = createRoot(container);
      const start = requests.length, refreshStart = refreshes.length, redirectStart = redirects.length;
      const controlStart = controlRethrows.length;
      const storage = dom.window.localStorage;
      storage.clear();
      storage.setItem("fn:lastSlotDisplayName", "legacy private");
      storage.setItem("fn:lastSlotDisplayName:unassigned", "legacy unassigned private");
      const storageBefore = [...Array(storage.length)].map((_, i) => [storage.key(i), storage.getItem(storage.key(i))]);
      let pending;
      try {
        await settle(() => root.render(h(SlotGrid, { key: "a", ...props(slotsFor(name)) })));
        await startAction(container, name);
        assert.equal(requests.length, start + 1, "actual handler must submit exactly once");
        pending = requests[start];
        assert.equal(pending.name, name);
        assert.equal(pending.fd.get(name === "merge" ? "gap_slot_id" : "slot_id"),
          name === "merge" ? "gap" : name === "reserve" ? "free" : "left");
        if (boundary === "current-control") {
          await settle(() => pending.resolve({ ok: true, slotId: "free", groupSize: 1 }));
          pending = null;
          assert.equal(refreshes.length, refreshStart + 1, "current result must not be suppressed");
          assert.ok(container.querySelector('[role="status"]'), "current success must display");
        } else {
          // Both Discord identities can have null viewer X IDs. The persisted
          // event plus replacement props model the client observation of that
          // transition, not the actual Auth.js or browser navigation itself.
          await settle(() => {
            if (boundary === "bfcache-null-X" || boundary === "control-bfcache") persistedPageShow();
            if (boundary === "pagehide-null-X") {
              persistedPageHide();
              // The isolated child still receives old slot props. The parent
              // owns overlay-derived row data; check child UI synchronously.
              assertNoLocalActionUi(container);
            }
            if (boundary === "active-X") window.dispatchEvent(new dom.window.Event(activeXChanged));
            root.render(h(SlotGrid, {
              key: boundary === "event-unmount" || boundary === "control-event-unmount" ? "b" : "a",
              ...props(freshSlots(), boundary === "active-X" || boundary === "control-prop-only" ? "new-x" : null),
            }));
            if (boundary === "pagehide-null-X") persistedPageShow();
          });
          assertNoPrivateActionUi(container);
          // Exercise success, guard rejection and transport rejection across
          // the three retirement mechanisms for every real action.
          await settle(() => {
            if (boundary === "bfcache-null-X") pending.resolve({ ok: true, slotId: "free", groupSize: 1 });
            else if (boundary === "active-X") pending.resolve({ ok: false, reason: "guard", message: "previous viewer private name" });
            else if (boundary.startsWith("control-")) {
              // Only the JS action rejection is modeled, not the Next transport.
              const control = new Error("NEXT_REDIRECT");
              controlErrors.add(control);
              pending.reject(control);
            } else pending.reject(new Error("previous viewer transport error"));
          });
          pending = null;
          assertNoPrivateActionUi(container);
          assert.equal(refreshes.length, refreshStart, "retired callback must not refresh successor");
          assert.equal(redirects.length, redirectStart, "retired callback must not navigate successor");
          assert.equal(controlRethrows.length, controlStart, "retired JS action rejection must not reach unstable_rethrow");
          await click(container.querySelector('button[aria-label="next-free を確保"]'), "new viewer reserve");
          assert.equal(container.querySelector("#reserve-display-name").value, "", "new viewer must not inherit name");
        }
        assert.deepEqual([...Array(storage.length)].map((_, i) => [storage.key(i), storage.getItem(storage.key(i))]), storageBefore,
          "null-X action must never persist the previous viewer name");
      } finally {
        await settle(() => root.unmount());
        if (pending) await settle(() => pending.resolve({ ok: false }));
        container.remove();
      }
    });
  }
}

// Pending-response tests above close the release/extend/merge confirmation
// before the retirement event, since the action has already been submitted.
// These cases keep the actual private UI OPEN, with no server action at all,
// and prove that even an unchanged null-X prop is not enough to retain it.
for (const name of ["reserve", "release", "extend", "merge", "menu"]) {
  for (const boundary of ["bfcache-null-X", "pagehide-null-X", "active-event-null-X", "event-unmount"]) {
    test("SEC-921 mounted SlotGrid: unsubmitted private UI " + name + " / " + boundary, async () => {
      const container = document.createElement("div");
      document.body.appendChild(container);
      const root = createRoot(container);
      const requestStart = requests.length;
      const refreshStart = refreshes.length;
      const redirectStart = redirects.length;
      const initialSlots = slotsFor(name);
      const openUi = () => name === "menu"
        ? document.querySelector('[role="menu"]')
        : container.querySelector('[role="dialog"], [role="alertdialog"]');
      const storage = dom.window.localStorage;
      storage.clear();
      storage.setItem("fn:lastSlotDisplayName:unassigned", "legacy private");
      try {
        await settle(() => root.render(h(SlotGrid, { key: "a", ...props(initialSlots) })));
        if (name === "reserve") {
          await click(container.querySelector('button[aria-label="free を確保"]'), "reserve draft");
          const input = container.querySelector("#reserve-display-name");
          assert.ok(input);
          assert.equal(input.value, "");
          await settle(() => inputValue(input, "previous viewer private name"));
          assert.equal(input.value, "previous viewer private name");
        } else if (name === "merge") {
          await click(container.querySelector('button[aria-label="gap を埋めて結合"]'), "merge draft");
          assert.equal(openUi().querySelector("input").value, "previous viewer private name");
        } else {
          await click(container.querySelector("#slot-edit-left"), "edit");
          const menu = document.querySelector('[role="menu"]');
          assert.ok(menu);
          if (name !== "menu") {
            await click(byText(menu, name === "release" ? "解放" : "後を追加"), "open " + name);
          }
        }
        assert.ok(openUi(), "precondition: actual UI open before authority retirement");
        assert.equal(requests.length, requestStart, "the dialog is not submitted");

        await settle(() => window.dispatchEvent(new dom.window.Event("pageshow")));
        assert.ok(openUi(), "ordinary pageshow is not a restoration and must not close the UI");
        await settle(() => {
          const event = new dom.window.Event("pagehide");
          Object.defineProperty(event, "persisted", { value: false });
          window.dispatchEvent(event);
        });
        assert.ok(openUi(), "a non-persisted pagehide must not alter a normal navigation");
        if (name === "reserve") {
          assert.equal(container.querySelector("#reserve-display-name").value, "previous viewer private name");
        }

        // For events, keep the SAME props/slot object and null X. The
        // listener itself must clear the old dialog/menu, before a new
        // overlay arrives, not rely on the effect for viewerXId or slots.
        await settle(() => {
          if (boundary === "bfcache-null-X") persistedPageShow();
          else if (boundary === "pagehide-null-X") {
            persistedPageHide();
            assert.equal(openUi(), null, "persisted pagehide must synchronously remove the open private UI");
          }
          else if (boundary === "active-event-null-X") window.dispatchEvent(new dom.window.Event(activeXChanged));
          else root.render(h(SlotGrid, { key: "b", ...props(freshSlots()) }));
        });
        assert.equal(openUi(), null, "old unsubmitted UI must be retired");
        assert.equal(document.querySelector('[role="menu"]'), null);
        assert.equal(container.querySelector('[role="dialog"], [role="alertdialog"]'), null);
        assert.equal(requests.length, requestStart, "retirement must not submit an old action");

        await settle(() => {
          root.render(h(SlotGrid, {
            key: boundary === "event-unmount" ? "b" : "a", ...props(freshSlots()),
          }));
          if (boundary === "pagehide-null-X") persistedPageShow();
        });
        assertNoPrivateActionUi(container);
        await click(container.querySelector('button[aria-label="next-free を確保"]'), "new null-X viewer reserve");
        assert.equal(container.querySelector("#reserve-display-name").value, "", "no inherited draft");
        assert.equal(requests.length, requestStart);
        assert.equal(refreshes.length, refreshStart);
        assert.equal(redirects.length, redirectStart);
        assert.equal(storage.length, 1);
        assert.equal(storage.getItem("fn:lastSlotDisplayName:unassigned"), "legacy private");
      } finally {
        await settle(() => root.unmount());
        storage.clear();
        container.remove();
      }
    });
  }
}


// Mount the actual parent and child together. Verify overlay-derived rows,
// child action UI and completions at the same synchronous pagehide boundary.
const panelSource = await readFile(
  new URL("../../../app/(public)/event/[id]/slots/EventSlotsViewerPanel.tsx", import.meta.url), "utf8",
);
const panelCompiled = ts.transpileModule(panelSource, {
  fileName: "EventSlotsViewerPanel.tsx",
  compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
    jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
  },
  reportDiagnostics: true,
});
assert.deepEqual(panelCompiled.diagnostics ?? [], []);
const overlayRequests = [];
const panelExport = { exports: {} };
const panelMocks = {
  ...mocks,
  "@/components/event/SlotGrid": { SlotGrid },
  "@/components/event/SlotStatusBoard": { SlotStatusBoard: visual },
  "./page.module.css": {},
};
vm.runInNewContext(panelCompiled.outputText, {
  module: panelExport, exports: panelExport.exports,
  require(id) {
    if (!Object.hasOwn(panelMocks, id)) throw new Error("Unexpected panel import: " + id);
    return panelMocks[id];
  },
  window: dom.window, document: dom.window.document, console, AbortController,
  fetch(url, init) {
    let resolve;
    const promise = new Promise(yes => { resolve = yes; });
    overlayRequests.push({ url, init, resolve });
    return promise;
  },
}, { filename: "EventSlotsViewerPanel.cjs" });
const { EventSlotsViewerPanel } = panelExport.exports;
const overlayResponse = slots => ({
  ok: true, json: async () => ({
    loggedIn: true, authUnavailable: false, isBanned: false,
    needsTermsAcceptance: false, canReserveSlot: true, canPost: false,
    operatorOverrideAllowed: false, viewerXId: null, viewerXIdNotice: null, slots,
  }),
});
for (const name of ["reserve", "release", "extend", "merge"]) {
  test("SEC-921 mounted real panel + grid: " + name + " / synchronous BFCache privacy boundary", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const start = requests.length, getStart = overlayRequests.length;
    const refreshStart = refreshes.length, redirectStart = redirects.length;
    const privateSlots = slotsFor(name);
    const baseSlots = privateSlots.map(s => ({
      ...s, display_name: null, is_owned_by_viewer: false, viewer_relation: "none",
    }));
    const patches = privateSlots.filter(s => s.is_owned_by_viewer).map(s => ({
      id: s.id, display_name: s.display_name, is_owned_by_viewer: true,
      viewer_relation: "unassigned", group_key: null,
    }));
    let pending;
    try {
      await settle(() => root.render(h(EventSlotsViewerPanel, {
        eventId: "a", eventTitle: "a", baseSlots, accepting: true,
        eventStatus: "active", slotType: "count", maxSlotsPerVideo: 3,
        maxSlotReservationsPerXId: 3, slotIntervalSec: null, slotPartGapSec: 0,
        parts: [], entryEndTime: null,
      })));
      assert.equal(overlayRequests.length, getStart + 1);
      await settle(() => overlayRequests[getStart].resolve(overlayResponse(patches)));
      if (patches.length) assert.match(container.textContent, /previous viewer private name/);
      await startAction(container, name);
      assert.equal(requests.length, start + 1);
      pending = requests[start];
      assert.equal(pending.name, name);
      await settle(() => {
        persistedPageHide();
        assertNoPrivateActionUi(container);
        assert.equal(container.querySelector("#slot-edit-left"), null,
          "real parent must retire private row ownership before pagehide returns");
      });
      assert.equal(overlayRequests.length, getStart + 1, "pagehide must not refetch");
      await settle(() => pending.resolve({ ok: true, slotId: "free", groupSize: 1 }));
      pending = null;
      assertNoPrivateActionUi(container);
      assert.equal(refreshes.length, refreshStart);
      assert.equal(redirects.length, redirectStart);
      await settle(persistedPageShow);
      assert.equal(overlayRequests.length, getStart + 2);
      assertNoPrivateActionUi(container);
      await settle(() => overlayRequests[getStart + 1].resolve(overlayResponse([])));
      assertNoPrivateActionUi(container);
      assert.equal(container.querySelector("#slot-edit-left"), null);
      assert.equal(refreshes.length, refreshStart);
      assert.equal(redirects.length, redirectStart);
    } finally {
      await settle(() => root.unmount());
      if (pending) await settle(() => pending.resolve({ ok: false }));
      container.remove();
    }
  });
}
