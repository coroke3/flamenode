import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  Pagination,
  pageNumbers,
  TableScroll,
  shouldBlockSearchKeySubmit,
  shouldBlockSearchFormSubmit,
  isGetSearchFormMethod,
  IME_COMPOSING_ATTR,
  navigateGetForm,
} from "../dist/index.js";

test("T03: Pagination preserves query parameters in buildHref across page links", () => {
  const buildHref = (page) => `/list?q=test&page=${page}`;

  const html = renderToStaticMarkup(
    React.createElement(Pagination, {
      currentPage: 2,
      totalPages: 5,
      total: 50,
      pageSize: 10,
      buildHref,
    }),
  );

  // Previous link points to page 1 preserving q=test
  assert.match(html, /href="\/list\?q=test&amp;page=1"/);

  // Next link points to page 3 preserving q=test
  assert.match(html, /href="\/list\?q=test&amp;page=3"/);

  // Current page 2 has aria-current="page"
  assert.match(html, /aria-current="page">2</);

  // Total count formatted correctly
  // CURRENT src/components/ui/Pagination.tsx text
  assert.match(html, /11〜20 \/ 全 50 件 \(2 \/ 5 ページ\)/);
});

test("Pagination returns null when totalPages <= 1", () => {
  const html = renderToStaticMarkup(
    React.createElement(Pagination, {
      currentPage: 1,
      totalPages: 1,
      total: 5,
      buildHref: (p) => `/?page=${p}`,
    }),
  );
  assert.equal(html, "");

  const htmlZero = renderToStaticMarkup(
    React.createElement(Pagination, {
      currentPage: 1,
      totalPages: 0,
      total: 0,
      buildHref: (p) => `/?page=${p}`,
    }),
  );
  assert.equal(htmlZero, "");

  const htmlNegative = renderToStaticMarkup(
    React.createElement(Pagination, {
      currentPage: 1,
      totalPages: -5,
      buildHref: (p) => `/?page=${p}`,
    }),
  );
  assert.equal(htmlNegative, "");
});

test("pageNumbers computes boundary ellipses and ranges accurately", () => {
  // First page of large set: [1, 2, 3, "…", 10]
  assert.deepEqual(pageNumbers(1, 10), [1, 2, 3, "…", 10]);

  // Last page of large set: [1, "…", 8, 9, 10]
  assert.deepEqual(pageNumbers(10, 10), [1, "…", 8, 9, 10]);

  // Middle page of large set: [1, "…", 3, 4, 5, 6, 7, "…", 10]
  assert.deepEqual(pageNumbers(5, 10), [1, "…", 3, 4, 5, 6, 7, "…", 10]);

  // Small set (5 pages): no ellipses
  assert.deepEqual(pageNumbers(3, 5), [1, 2, 3, 4, 5]);

  // 2 pages: [1, 2]
  assert.deepEqual(pageNumbers(1, 2), [1, 2]);
});

test("Pagination handles custom unitLabel and total without pageSize", () => {
  const html = renderToStaticMarkup(
    React.createElement(Pagination, {
      currentPage: 1,
      totalPages: 3,
      total: 30,
      unitLabel: "作品",
      buildHref: (p) => `/videos?page=${p}`,
      className: "custom-pagination",
    }),
  );
  assert.match(html, /custom-pagination/);
  assert.match(html, /全 30 作品 \(1 \/ 3 ページ\)/);
});


test("TableScroll renders accessible region container with tabIndex 0", () => {
  const html = renderToStaticMarkup(
    React.createElement(
      TableScroll,
      { ariaLabel: "作品ランキング表" },
      React.createElement("table", null, React.createElement("tbody", null, React.createElement("tr", null, React.createElement("td", null, "Item")))),
    ),
  );

  assert.match(html, /role="region"/);
  assert.match(html, /aria-label="作品ランキング表"/);
  assert.match(html, /tabindex="0"/);
  assert.match(html, /fn-table-scroll/);
});

test("T04: shouldBlockSearchKeySubmit blocks Enter submission during IME composition", () => {
  // Composing session active -> block
  assert.equal(
    shouldBlockSearchKeySubmit({
      key: "Enter",
      isCompositionSession: true,
    }),
    true,
  );

  // native isComposing true -> block
  assert.equal(
    shouldBlockSearchKeySubmit({
      key: "Enter",
      isComposing: true,
    }),
    true,
  );

  // Windows IME keyCode 229 -> block
  assert.equal(
    shouldBlockSearchKeySubmit({
      key: "Enter",
      keyCode: 229,
    }),
    true,
  );

  // Regular Enter when not composing -> allowed
  assert.equal(
    shouldBlockSearchKeySubmit({
      key: "Enter",
      isCompositionSession: false,
      isComposing: false,
      keyCode: 13,
    }),
    false,
  );

  // Other keys (e.g. "a", "Tab") -> not blocked by submit guard
  assert.equal(
    shouldBlockSearchKeySubmit({
      key: "Tab",
      isCompositionSession: true,
    }),
    false,
  );

  // Form submit blocked during composition session
  assert.equal(
    shouldBlockSearchFormSubmit({ isCompositionSession: true }),
    true,
  );
  assert.equal(
    shouldBlockSearchFormSubmit({ isCompositionSession: false }),
    false,
  );
  assert.equal(
    shouldBlockSearchFormSubmit({ isCompositionSession: false, isNativeGuardActive: true }),
    true,
  );
});


// AutoSubmitSelect / ImeSafeGetForm behaviour in a real DOM: forms.dom.test.mjs

test("ImeSafeGetForm only intercepts GET and leaves native POST submission intact", () => {
  assert.equal(isGetSearchFormMethod(null), true, "default method is GET");
  assert.equal(isGetSearchFormMethod("GET"), true);
  assert.equal(isGetSearchFormMethod(" get "), true);
  assert.equal(isGetSearchFormMethod("post"), false, "POST must not be routed through navigateGetForm");
  assert.equal(isGetSearchFormMethod("POST"), false);
  assert.equal(isGetSearchFormMethod("dialog"), false);
});

test("non-GET navigation preserves constraint validation and submit handlers", () => {
  let nativeSubmit = 0;
  let requestSubmit = 0;
  const form = {
    getAttribute: (key) => key === "method" ? "post" : null,
    requestSubmit: () => { requestSubmit++; },
    submit: () => { nativeSubmit++; },
  };
  navigateGetForm(form);
  assert.equal(requestSubmit, 1, "POST forms must use requestSubmit");
  assert.equal(nativeSubmit, 0, "never bypass validation with submit()");

  const originalEvent = Object.getOwnPropertyDescriptor(globalThis, "Event");
  let checked = 0;
  let dispatched = 0;
  let reported = 0;
  try {
    Object.defineProperty(globalThis, "Event", { configurable: true, value: class {
      constructor(type, options) { this.type = type; this.options = options; }
    }});
    form.requestSubmit = undefined;
    form.checkValidity = () => { checked++; return false; };
    form.reportValidity = () => { reported++; };
    form.dispatchEvent = () => { dispatched++; };
    navigateGetForm(form);
    assert.equal(checked, 1);
    assert.equal(reported, 1);
    assert.equal(dispatched, 0, "invalid forms must not send");

    form.checkValidity = () => true;
    navigateGetForm(form);
    assert.equal(dispatched, 1, "valid fallback must dispatch submit event");
    assert.equal(nativeSubmit, 0);
  } finally {
    if (originalEvent) Object.defineProperty(globalThis, "Event", originalEvent);
    else delete globalThis.Event;
  }
});
