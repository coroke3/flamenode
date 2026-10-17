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
  const cleanup = openDialogBehavior(fakeDialog, fakeOpener, () => () => {
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

test("T05: PublicHeader keeps every CURRENT public entry point", () => {
  const html = renderToStaticMarkup(
    React.createElement(PublicHeader, {
      currentPath: "/event/abc",
      themeToggle: React.createElement("button", { type: "button", id: "theme" }, "テーマ"),
      account: React.createElement("a", { href: "/entry", id: "login" }, "ログイン"),
    }),
  );
  // logo + the 3 nav items, nothing else as a link in the bar
  const hrefs = [...html.matchAll(/<a [^>]*href="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(hrefs, ["/", ...PUBLIC_NAV_ITEMS.map((item) => item.href), "/entry"]);
  for (const item of PUBLIC_NAV_ITEMS) assert.match(html, new RegExp(`>${item.label}</a>`));
  // CURRENT search: GET /list with field q
  const form = html.match(/<form [^>]*>/)?.[0] ?? "";
  for (const attr of ['action="/list"', 'method="get"', 'role="search"']) assert.ok(form.includes(attr), `${attr} in ${form}`);
  assert.match(html, /<input [^>]*type="search"[^>]*name="q"/);
  // theme and account slots are rendered, the header reads no auth state itself
  assert.match(html, /id="theme"/);
  assert.match(html, /id="login"/);
  // active state from isPublicNavItemActive, as aria-current only
  assert.match(html, /href="\/event"[^>]*aria-current="page"/);
  assert.doesNotMatch(html, /href="\/list"[^>]*aria-current/);
  // the mobile menu is closed until opened
  assert.doesNotMatch(html, /role="dialog"/);
  assert.match(html, /aria-expanded="false"[^>]*aria-controls="[^"]+-menu"/);
});

test("two headers on one page get different control ids", () => {
  const html = renderToStaticMarkup(
    React.createElement(React.Fragment, null, React.createElement(PublicHeader), React.createElement(PublicHeader)),
  );
  const ids = [...html.matchAll(/aria-controls="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(ids.length, 4);
  assert.equal(new Set(ids).size, 4);
});

test("PublicFooter keeps CURRENT links and year", () => {
  const html = renderToStaticMarkup(React.createElement(PublicFooter));
  const hrefs = [...html.matchAll(/<a [^>]*href="([^"]+)"/g)].map((m) => m[1]).sort();
  // CURRENT src/components/layout/PublicFooter.tsx: 10 links (two to /entry) + the logo
  assert.deepEqual(hrefs, ["/", "/about", "/dashboard", "/entry", "/entry", "/event", "/list", "/recommend", "/rules", "/rules#event-host", "/user"].sort());
  assert.match(html, new RegExp(`© ${new Date().getFullYear()} FlameNode`));
  assert.match(renderToStaticMarkup(React.createElement(PublicFooter, { year: 2030 })), /© 2030 FlameNode/);
});

test("every class the header and footer render has a rule in styles/layout.css", async () => {
  const fs = await import("node:fs");
  const css = fs.readFileSync(new URL("../src/styles/layout.css", import.meta.url), "utf8");
  const html =
    renderToStaticMarkup(React.createElement(PublicHeader, { themeToggle: "t", account: "a" })) +
    renderToStaticMarkup(React.createElement(PublicFooter));
  const classes = new Set([...html.matchAll(/class="([^"]+)"/g)].flatMap((m) => m[1].split(" ")));
  for (const name of ["hd-menu", "hm-main", "hm-me", "hd-menu-scrim", "open-search", "on"]) classes.add(name);
  for (const name of classes) assert.match(css, new RegExp(`\\.${name}(?![\\w-])`), `no rule for .${name}`);
});
