import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  Button,
  Badge,
  Status,
  Dialog,
  Modal,
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

test("Badge and Status render correct status classes and default labels", () => {
  const htmlPublic = renderToStaticMarkup(
    React.createElement(Badge, { status: "public" }),
  );
  assert.match(htmlPublic, /fn-status--public/);
  assert.match(htmlPublic, /PUBLIC/);

  const htmlLive = renderToStaticMarkup(
    React.createElement(Status, { status: "live", label: "ON AIR" }),
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
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: {
      body,
      documentElement: { clientWidth: 1024 },
      activeElement: opener,
      addEventListener: (type, fn) => type === "keydown" && listeners.add(fn),
      removeEventListener: (type, fn) => type === "keydown" && listeners.delete(fn),
    },
  });
  const pressEscape = () => {
    for (const fn of [...listeners]) fn({ key: "Escape", preventDefault() {} });
  };
  try {
    run({ focused, pressEscape, listeners });
  } finally {
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
    else delete globalThis.window;
    if (originalDocument) Object.defineProperty(globalThis, "document", originalDocument);
    else delete globalThis.document;
  }
}

test("T03: Dialog Esc closes and focus returns to the opener", () => {
  withFakeDom(({ focused, pressEscape, listeners }) => {
    let closed = 0;
    const dialog = { focus: () => focused.push("dialog") };
    const cleanup = openDialogBehavior(dialog, () => () => { closed += 1; });
    assert.deepEqual(focused, ["dialog"]);

    pressEscape();
    assert.equal(closed, 1);

    cleanup(); // what React runs when open becomes false
    assert.deepEqual(focused, ["dialog", "opener"]);
    assert.equal(listeners.size, 0);
    assert.equal(getBodyScrollLockCountForTest(), 0);
  });
});

test("T03: contained Dialog ignores Esc", () => {
  withFakeDom(({ pressEscape }) => {
    const cleanup = openDialogBehavior(null, () => undefined);
    assert.doesNotThrow(pressEscape);
    cleanup();
  });
});

test("T04: two stacked Dialogs release the scroll lock to 0", () => {
  withFakeDom(() => {
    const closeFirst = openDialogBehavior(null, () => undefined);
    const closeSecond = openDialogBehavior(null, () => undefined);
    assert.equal(getBodyScrollLockCountForTest(), 2);
    closeSecond();
    assert.equal(getBodyScrollLockCountForTest(), 1);
    closeFirst();
    assert.equal(getBodyScrollLockCountForTest(), 0);
  });
});
