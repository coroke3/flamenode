import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  Link,
  AdapterProvider,
  PUBLIC_NAV_ITEMS,
  isPublicNavItemActive,
  PublicHeader,
  PublicFooter,
  openDialogBehavior,
  getBodyScrollLockCountForTest,
} from "../dist/index.js";

test("T01: Link without Provider renders plain <a> tag", () => {
  const html = renderToStaticMarkup(
    React.createElement(Link, { href: "/event", className: "nav-link" }, "イベント"),
  );
  assert.equal(html, '<a href="/event" class="nav-link">イベント</a>');
});

test("T02: Separate AdapterProviders isolate custom Link implementations without bleeding", () => {
  const CustomLinkA = ({ href, children, ...props }) =>
    React.createElement("a", { href: `/prefixA${href}`, "data-custom": "A", ...props }, children);

  const CustomLinkB = ({ href, children, ...props }) =>
    React.createElement("a", { href: `/prefixB${href}`, "data-custom": "B", ...props }, children);

  const htmlA = renderToStaticMarkup(
    React.createElement(
      AdapterProvider,
      { link: CustomLinkA },
      React.createElement(Link, { href: "/test" }, "TestA"),
    ),
  );

  const htmlB = renderToStaticMarkup(
    React.createElement(
      AdapterProvider,
      { link: CustomLinkB },
      React.createElement(Link, { href: "/test" }, "TestB"),
    ),
  );

  const htmlDefault = renderToStaticMarkup(
    React.createElement(Link, { href: "/test" }, "Default"),
  );

  assert.match(htmlA, /href="\/prefixA\/test"/);
  assert.match(htmlA, /data-custom="A"/);

  assert.match(htmlB, /href="\/prefixB\/test"/);
  assert.match(htmlB, /data-custom="B"/);

  assert.match(htmlDefault, /href="\/test"/);
  assert.doesNotMatch(htmlDefault, /data-custom/);
});

test("T03: isPublicNavItemActive accurately identifies root and subpath matches", () => {
  // Exact match
  assert.equal(isPublicNavItemActive("/event", "/event"), true);
  assert.equal(isPublicNavItemActive("/list", "/list"), true);
  assert.equal(isPublicNavItemActive("/user", "/user"), true);

  // Subpath match
  assert.equal(isPublicNavItemActive("/event/abc", "/event"), true);
  assert.equal(isPublicNavItemActive("/list/123", "/list"), true);
  assert.equal(isPublicNavItemActive("/user/otako", "/user"), true);

  // Non-matching paths
  assert.equal(isPublicNavItemActive("/events", "/event"), false);
  assert.equal(isPublicNavItemActive("/user-settings", "/user"), false);
  assert.equal(isPublicNavItemActive("/other", "/list"), false);
  assert.equal(isPublicNavItemActive(null, "/event"), false);
  assert.equal(isPublicNavItemActive("", "/event"), false);
});

test("T04: openDialogBehavior simulates Esc key dismiss and restores focus to opener", () => {
  let focusedElement = null;
  let scrollLockCount = 0;
  const listeners = [];

  const fakeOpener = {
    focus() {
      focusedElement = "opener";
    },
  };

  const fakeDialog = {
    focus() {
      focusedElement = "dialog";
    },
  };

  const originalDocument = globalThis.document;
  globalThis.document = {
    activeElement: fakeOpener,
    addEventListener(event, handler) {
      listeners.push({ event, handler });
    },
    removeEventListener(event, handler) {
      const idx = listeners.findIndex((l) => l.event === event && l.handler === handler);
      if (idx !== -1) listeners.splice(idx, 1);
    },
  };

  let escaped = false;
  const cleanup = openDialogBehavior(fakeDialog, () => () => {
    escaped = true;
  });

  try {
    assert.equal(focusedElement, "dialog", "Dialog receives initial focus");

    // Trigger Escape key
    const keyHandler = listeners.find((l) => l.event === "keydown")?.handler;
    assert.ok(keyHandler, "keydown listener registered");

    let defaultPrevented = false;
    keyHandler({
      key: "Escape",
      preventDefault() {
        defaultPrevented = true;
      },
    });

    assert.equal(escaped, true, "Escape triggers onEscape callback");
    assert.equal(defaultPrevented, true, "Escape key default prevented");

    // Clean up releases lock and restores opener focus
    cleanup();
    assert.equal(focusedElement, "opener", "Opener receives restored focus on close");
  } finally {
    globalThis.document = originalDocument;
  }
});

test("T05: PublicHeader renders all canonical PUBLIC_NAV_ITEMS entries", () => {
  const html = renderToStaticMarkup(
    React.createElement(PublicHeader, { currentPath: "/event" }),
  );

  // Verify all 3 navigation items are present
  for (const item of PUBLIC_NAV_ITEMS) {
    assert.match(html, new RegExp(`href="${item.href}"`));
    assert.match(html, new RegExp(item.label));
  }

  // Verify active state for /event
  assert.match(html, /href="\/event"[^>]*class="[^"]*is-active[^"]*"/);
  assert.match(html, /href="\/event"[^>]*aria-current="page"/);

  // Non-active links do not have is-active or aria-current
  assert.doesNotMatch(html, /href="\/list"[^>]*is-active/);
  assert.doesNotMatch(html, /href="\/list"[^>]*aria-current="page"/);
});

test("PublicFooter renders all required public navigation targets", () => {
  const html = renderToStaticMarkup(React.createElement(PublicFooter));

  const expectedLinks = [
    "/list",
    "/recommend",
    "/user",
    "/event",
    "/entry",
    "/dashboard",
    "/rules#event-host",
    "/about",
    "/rules",
  ];

  for (const link of expectedLinks) {
    assert.match(html, new RegExp(`href="${link.replace("#", "\\#")}"`));
  }
});
