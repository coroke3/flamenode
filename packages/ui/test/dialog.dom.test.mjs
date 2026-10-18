// Dialog in a real DOM (jsdom) rendered by react-dom/client.
import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { pretendToBeVisual: true });
dom.window.scrollTo = () => {}; // jsdom does not implement scrolling
for (const key of ["window", "document", "navigator", "HTMLElement", "Node", "KeyboardEvent"]) {
  Object.defineProperty(globalThis, key, { configurable: true, value: key === "window" ? dom.window : dom.window[key] });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const React = (await import("react")).default;
const { createRoot } = await import("react-dom/client");
const { act } = React;
const ui = await import("../dist/index.js");
const bridge = await import("../../../src/components/layout/bodyScrollLock.ts");
const { Dialog } = ui;
const h = React.createElement;

function setup() {
  document.body.innerHTML = "";
  const opener = document.createElement("button");
  opener.textContent = "open";
  document.body.append(opener);
  const container = document.createElement("div");
  document.body.append(container);
  opener.focus();
  const root = createRoot(container);
  return { opener, root, render: (el) => act(() => root.render(el)) };
}

const pressEscape = () =>
  act(() => {
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  });

test("DOM: open moves focus into the dialog; close and unmount return focus and release the lock", async () => {
  const { opener, root, render } = setup();
  await render(h(Dialog, { open: false, title: "t" }));
  assert.equal(document.activeElement, opener);

  await render(h(Dialog, { open: true, title: "t" }));
  assert.equal(document.activeElement.getAttribute("role"), "dialog");
  assert.equal(ui.getBodyScrollLockCountForTest(), 1);
  assert.equal(document.body.style.position, "fixed");

  await render(h(Dialog, { open: false, title: "t" }));
  assert.equal(document.activeElement, opener);
  assert.equal(ui.getBodyScrollLockCountForTest(), 0);
  assert.equal(document.body.style.position, "");

  await render(h(Dialog, { open: true, title: "t" }));
  await act(() => root.unmount());
  assert.equal(document.activeElement, opener);
  assert.equal(ui.getBodyScrollLockCountForTest(), 0);
});

for (const strict of [false, true]) {
  test(`DOM${strict ? " StrictMode" : ""}: an autoFocus child keeps focus; Esc closes and focus returns to the opener`, async () => {
    const { opener, root, render } = setup();
    let open = true;
    const view = () => {
      const dialog = h(
        Dialog,
        { open, title: "t", onClose: () => { open = false; } },
        h("input", { autoFocus: true, "data-testid": "field" }),
      );
      return strict ? h(React.StrictMode, null, dialog) : dialog;
    };
    await render(view());
    assert.equal(document.activeElement.dataset.testid, "field");
    assert.equal(ui.getBodyScrollLockCountForTest(), 1);

    await pressEscape();
    assert.equal(open, false);
    await render(view());
    assert.equal(document.activeElement, opener);
    assert.equal(ui.getBodyScrollLockCountForTest(), 0);
    await act(() => root.unmount());
  });
}

test("DOM StrictMode: nested dialogs; one Esc closes only the inner one and focus returns inside the outer", async () => {
  const { opener, root, render } = setup();
  const state = { outer: true, inner: false };
  const closed = [];
  const view = () =>
    h(
      React.StrictMode,
      null,
      h(
        Dialog,
        { open: state.outer, title: "outer", onClose: () => { closed.push("outer"); state.outer = false; } },
        h("button", { "data-testid": "inner-opener" }, "more"),
        h(Dialog, { open: state.inner, title: "inner", onClose: () => { closed.push("inner"); state.inner = false; } }),
      ),
    );
  await render(view());
  const innerOpener = document.querySelector("[data-testid=inner-opener]");
  innerOpener.focus();
  state.inner = true;
  await render(view());
  assert.equal(ui.getBodyScrollLockCountForTest(), 2);

  await pressEscape();
  assert.deepEqual(closed, ["inner"]);
  await render(view());
  assert.equal(document.activeElement, innerOpener);
  assert.equal(ui.getBodyScrollLockCountForTest(), 1);

  await pressEscape();
  assert.deepEqual(closed, ["inner", "outer"]);
  await render(view());
  assert.equal(document.activeElement, opener);
  assert.equal(ui.getBodyScrollLockCountForTest(), 0);
  await act(() => root.unmount());
});

test("CURRENT bridge and @flamenode/ui dist share one scroll lock", () => {
  document.body.innerHTML = "";
  document.body.style.position = "static";
  const releaseCurrent = bridge.acquireBodyScrollLock(); // CURRENT drawer via the bridge
  const releaseUi = ui.acquireBodyScrollLock(); // new UI Dialog
  assert.equal(bridge.getBodyScrollLockCountForTest(), 2);
  assert.equal(ui.getBodyScrollLockCountForTest(), 2);

  releaseCurrent();
  assert.equal(document.body.style.position, "fixed");
  releaseCurrent(); // a second release is a no-op
  assert.equal(ui.getBodyScrollLockCountForTest(), 1);

  releaseUi();
  assert.equal(bridge.getBodyScrollLockCountForTest(), 0);
  assert.equal(document.body.style.position, "static");
});
