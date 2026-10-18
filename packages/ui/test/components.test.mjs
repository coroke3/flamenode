import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  Button,
  Badge,
  Dialog,
  openDialogBehavior,
  acquireBodyScrollLock,
  getBodyScrollLockCountForTest,
} from "../dist/index.js";

test("T01: Button disabled renders disabled attribute and prevents click", () => {
  let clicked = false;
  const html = renderToStaticMarkup(
    React.createElement(
      Button,
      {
        disabled: true,
        onClick: () => {
          clicked = true;
        },
      },
      "Submit",
    ),
  );

  assert.match(html, /<button[^>]*disabled/);
  assert.match(html, /type="button"/);
  assert.match(html, /data-variant="primary"/);
  assert.match(html, /fn-btn--primary/);
  assert.match(html, /Submit/);

  // The rendered onClick ignores clicks while disabled.
  const element = Button({ disabled: true, onClick: () => { clicked = true; } }, "Submit");
  let prevented = false;
  element.props.onClick({ preventDefault: () => { prevented = true; } });
  assert.equal(clicked, false);
  assert.equal(prevented, true);
});

test("T02: Button loading renders aria-busy='true' and disabled state", () => {
  const html = renderToStaticMarkup(
    React.createElement(
      Button,
      {
        loading: true,
        variant: "secondary",
        size: "sm",
      },
      "Saving...",
    ),
  );

  assert.match(html, /aria-busy="true"/);
  assert.match(html, /disabled/);
  assert.match(html, /fn-btn--secondary/);
  assert.match(html, /fn-btn--sm/);
  assert.match(html, /Saving\.\.\./);

  // A second press while loading does not reach onClick.
  let presses = 0;
  const element = Button({ loading: true, onClick: () => { presses += 1; } }, "Saving...");
  element.props.onClick({ preventDefault() {} });
  assert.equal(presses, 0);
});

test("Badge renders status classes and default labels like the mock", () => {
  const htmlPublic = renderToStaticMarkup(
    React.createElement(Badge, { status: "public" }),
  );
  assert.match(htmlPublic, /fn-status--public/);
  assert.match(htmlPublic, /PUBLIC/);

  const htmlLive = renderToStaticMarkup(
    React.createElement(Badge, { status: "live", label: "ON AIR" }),
  );
  assert.match(htmlLive, /fn-status--live/);
  assert.match(htmlLive, /ON AIR/);

  const htmlDraft = renderToStaticMarkup(
    React.createElement(Badge, { status: "draft" }),
  );
  assert.match(htmlDraft, /fn-status--draft/);
  assert.match(htmlDraft, /DRAFT/);
});

test("Dialog renders accessible modal markup when open and nothing when closed", () => {
  const closedHtml = renderToStaticMarkup(
    React.createElement(Dialog, {
      open: false,
      title: "Closed Modal",
    }),
  );
  assert.equal(closedHtml, "");

  const openHtml = renderToStaticMarkup(
    React.createElement(
      Dialog,
      {
        open: true,
        title: "Confirm Action",
        actions: React.createElement(Button, null, "OK"),
      },
      React.createElement("p", null, "Are you sure?"),
    ),
  );

  assert.match(openHtml, /role="dialog"/);
  assert.match(openHtml, /aria-modal="true"/);
  assert.match(openHtml, /fn-modal/);
  assert.match(openHtml, /fn-modal-backdrop/);
  assert.match(openHtml, /Confirm Action/);
  assert.match(openHtml, /Are you sure\?/);
  assert.match(openHtml, /fn-modal__actions/);
});

test("bodyScrollLock stacking returns to 0 when all released", () => {
  const scrollCalls = [];
  const body = {
    style: {
      position: "static",
      top: "0px",
      left: "0px",
      right: "0px",
      width: "100%",
      overflow: "auto",
      paddingRight: "0px",
    },
  };

  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, "document");

  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      scrollX: 0,
      scrollY: 100,
      innerWidth: 1024,
      getComputedStyle: () => ({ paddingRight: "0px" }),
      scrollTo: (opts) => scrollCalls.push(opts),
    },
  });

  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: { body, documentElement: { clientWidth: 1024 } },
  });

  try {
    assert.equal(getBodyScrollLockCountForTest(), 0);

    // Dialog 1 opens
    const release1 = acquireBodyScrollLock();
    assert.equal(getBodyScrollLockCountForTest(), 1);
    assert.equal(body.style.position, "fixed");
    assert.equal(body.style.top, "-100px");

    // Dialog 2 opens on top
    const release2 = acquireBodyScrollLock();
    assert.equal(getBodyScrollLockCountForTest(), 2);

    // Dialog 2 closes
    release2();
    assert.equal(getBodyScrollLockCountForTest(), 1);
    assert.equal(body.style.position, "fixed"); // Still locked

    // Dialog 1 closes
    release1();
    assert.equal(getBodyScrollLockCountForTest(), 0);
    assert.equal(body.style.position, "static"); // Restored
    assert.deepEqual(scrollCalls, [{ left: 0, top: 100, behavior: "instant" }]);
  } finally {
    if (originalWindow) {
      Object.defineProperty(globalThis, "window", originalWindow);
    } else {
      delete globalThis.window;
    }
    if (originalDocument) {
      Object.defineProperty(globalThis, "document", originalDocument);
    } else {
      delete globalThis.document;
    }
  }
});

test("Badge falls back like the mock: empty label and unknown status", () => {
  assert.match(renderToStaticMarkup(React.createElement(Badge, { status: "public", label: "" })), /PUBLIC/);
  const unknown = renderToStaticMarkup(React.createElement(Badge, { status: "nope" }));
  assert.match(unknown, /fn-status--draft/);
  assert.match(unknown, /DRAFT/);
});

function withFakeDom(run) {
  const listeners = new Set();
  const focused = [];
  const opener = { name: "opener", focus: () => focused.push("opener") };
  const body = { style: { position: "", top: "", left: "", right: "", width: "", overflow: "", paddingRight: "" } };
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      scrollX: 0,
      scrollY: 0,
      innerWidth: 1024,
      getComputedStyle: () => ({ paddingRight: "0px" }),
      scrollTo: () => {},
    },
  });
  const doc = {
    body,
    documentElement: { clientWidth: 1024 },
    activeElement: opener,
    addEventListener: (type, fn) => type === "keydown" && listeners.add(fn),
    removeEventListener: (type, fn) => type === "keydown" && listeners.delete(fn),
  };
  Object.defineProperty(globalThis, "document", { configurable: true, value: doc });
  const pressEscape = (extra = {}) => {
    for (const fn of [...listeners]) fn({ key: "Escape", preventDefault() {}, ...extra });
  };
  try {
    run({ focused, opener, doc, pressEscape, listeners });
  } finally {
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
    else delete globalThis.window;
    if (originalDocument) Object.defineProperty(globalThis, "document", originalDocument);
    else delete globalThis.document;
  }
}

const fakeDialog = (focused, name = "dialog", inside = []) => ({
  focus: () => focused.push(name),
  contains: (node) => inside.includes(node),
});

test("T03: Dialog Esc closes and focus returns to the opener", () => {
  withFakeDom(({ focused, opener, pressEscape, listeners }) => {
    let closed = 0;
    const cleanup = openDialogBehavior(fakeDialog(focused), opener, () => () => { closed += 1; });
    assert.deepEqual(focused, ["dialog"]);

    pressEscape();
    assert.equal(closed, 1);

    cleanup(); // what React runs when open becomes false
    assert.deepEqual(focused, ["dialog", "opener"]);
    assert.equal(listeners.size, 0);
    assert.equal(getBodyScrollLockCountForTest(), 0);
  });
});

test("T03: an autoFocus child keeps focus, and closing returns to the recorded opener", () => {
  withFakeDom(({ focused, opener, doc }) => {
    const input = { name: "input", focus: () => focused.push("input") };
    doc.activeElement = input; // autoFocus ran before the effect
    const cleanup = openDialogBehavior(fakeDialog(focused, "dialog", [input]), opener, () => undefined);
    assert.deepEqual(focused, []); // dialog did not steal focus from the input
    cleanup();
    assert.deepEqual(focused, ["opener"]);
  });
});

test("T03: contained Dialog and IME conversion ignore Esc", () => {
  withFakeDom(({ focused, opener, pressEscape }) => {
    const contained = openDialogBehavior(fakeDialog(focused), opener, () => undefined);
    assert.doesNotThrow(() => pressEscape());
    contained();

    let closed = 0;
    const cleanup = openDialogBehavior(fakeDialog(focused), opener, () => () => { closed += 1; });
    pressEscape({ isComposing: true });
    assert.equal(closed, 0);
    cleanup();
  });
});

test("T04: one Esc closes only the innermost of two stacked Dialogs; locks return to 0", () => {
  withFakeDom(({ focused, opener, pressEscape }) => {
    const closed = [];
    const closeOuter = openDialogBehavior(fakeDialog(focused, "outer"), opener, () => () => closed.push("outer"));
    const closeInner = openDialogBehavior(fakeDialog(focused, "inner"), opener, () => () => closed.push("inner"));
    assert.equal(getBodyScrollLockCountForTest(), 2);

    pressEscape();
    assert.deepEqual(closed, ["inner"]);
    closeInner();
    assert.equal(getBodyScrollLockCountForTest(), 1);

    pressEscape();
    assert.deepEqual(closed, ["inner", "outer"]);
    closeOuter();
    assert.equal(getBodyScrollLockCountForTest(), 0);
  });
});
