import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  Pagination,
  TableScroll,
  shouldBlockSearchKeySubmit,
  shouldBlockSearchFormSubmit,
  isGetSearchFormMethod,
  IME_COMPOSING_ATTR,
  AutoSubmitSelect,
  navigateGetForm,
  AutoSubmitCheckbox,
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
  assert.match(html, /11–20 \/ 全50件/);
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


test("U03: AutoSubmitSelect preserves GET values and ignores IME composing forms", () => {
  const assigned = [];
  const prevWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const prevFormData = Object.getOwnPropertyDescriptor(globalThis, "FormData");
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { location: { origin: "https://example.test", pathname: "/list", search: "", hash: "", assign: (url) => assigned.push(url) } },
  });
  Object.defineProperty(globalThis, "FormData", {
    configurable: true,
    value: class {
      constructor() {}
      *entries() {
        yield ["q", "a b"];
        yield ["sort", "popular"];
      }
    },
  });
  const form = {
    getAttribute: (key) => key === "action" ? "/list" : key === "method" ? "get" : null,
    hasAttribute: () => false,
  };
  try {
    let changes = 0;
    const select = AutoSubmitSelect({ onChange: () => { changes += 1; }, children: "options" });
    select.props.onChange({ currentTarget: { form }, defaultPrevented: false });
    assert.equal(changes, 1);
    assert.deepEqual(assigned, ["/list?q=a+b&sort=popular"]);

    form.hasAttribute = (key) => key === "data-fn-ime-composing";
    select.props.onChange({ currentTarget: { form }, defaultPrevented: false });
    assert.equal(changes, 2);
    assert.equal(assigned.length, 1, "IME conversion must not auto-submit");

    const checkbox = AutoSubmitCheckbox({});
    checkbox.props.onChange({ currentTarget: { form }, defaultPrevented: false });
    assert.equal(assigned.length, 1);
  } finally {
    if (prevWindow) Object.defineProperty(globalThis, "window", prevWindow);
    else delete globalThis.window;
    if (prevFormData) Object.defineProperty(globalThis, "FormData", prevFormData);
    else delete globalThis.FormData;
  }
});


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
