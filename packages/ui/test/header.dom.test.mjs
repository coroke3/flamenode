// PublicHeader in a real DOM (jsdom) rendered by react-dom/client (MIG-0203 T04).
// Element checks use assert.ok(a === b): a failing assert.equal on jsdom nodes stalls the test reporter.
import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "https://flamenode.test/list", pretendToBeVisual: true });
dom.window.scrollTo = () => {}; // jsdom does not implement scrolling
// jsdom has no layout, so offsetParent is always null; treat everything outside [hidden] as rendered.
Object.defineProperty(dom.window.HTMLElement.prototype, "offsetParent", {
  configurable: true,
  get() { return this.closest("[hidden]") ? null : this.parentElement; },
});
// jsdom has no matchMedia; this stub lets a test cross the 641px menu breakpoint.
const wideQuery = { matches: false, listeners: new Set() };
dom.window.matchMedia = () => ({
  get matches() { return wideQuery.matches; },
  addEventListener: (_type, fn) => wideQuery.listeners.add(fn),
  removeEventListener: (_type, fn) => wideQuery.listeners.delete(fn),
});
function setWide(matches) {
  wideQuery.matches = matches;
  for (const fn of [...wideQuery.listeners]) fn({ matches });
}
for (const key of ["window", "document", "navigator", "HTMLElement", "Node", "KeyboardEvent", "MouseEvent", "Event", "CompositionEvent", "FormData", "SubmitEvent"]) {
  Object.defineProperty(globalThis, key, { configurable: true, value: key === "window" ? dom.window : dom.window[key] });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const React = (await import("react")).default;
const { createRoot } = await import("react-dom/client");
const { act } = React;
const { PublicHeader, AdapterProvider, getBodyScrollLockCountForTest } = await import("../dist/index.js");

async function mount(props = {}) {
  document.body.innerHTML = "";
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(() => root.render(React.createElement(PublicHeader, { currentPath: "/list", ...props })));
  return { root, burger: () => document.querySelector(".hd-burger"), menu: () => document.querySelector('[role="dialog"]') };
}

const click = (el) => act(() => el.dispatchEvent(new MouseEvent("click", { bubbles: true })));
const key = (k, init = {}) =>
  act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, ...init })));
// Tab from the focused element; returns whether the header took over the move (defaultPrevented).
async function tab(init = {}) {
  const event = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true, ...init });
  await act(() => (document.activeElement ?? document.body).dispatchEvent(event));
  return event.defaultPrevented;
}
const pointerDown = (el) => act(() => el.dispatchEvent(new Event("pointerdown", { bubbles: true })));

test("T04: the mobile menu opens as a dialog, Esc closes it and focus returns to the menu button", async () => {
  const { root, burger, menu } = await mount();
  burger().focus();
  await click(burger());
  assert.ok(menu(), "dialog rendered");
  assert.equal(burger().getAttribute("aria-expanded"), "true");
  assert.equal(document.activeElement, menu());
  assert.equal(getBodyScrollLockCountForTest(), 1);
  assert.deepEqual([...menu().querySelectorAll("a")].map((a) => a.getAttribute("href")), ["/list", "/user", "/event"]);

  await key("Escape", { isComposing: true }); // IME conversion uses Esc
  assert.ok(menu(), "Esc during IME composition keeps the menu");

  await key("Escape");
  assert.equal(menu(), null);
  assert.equal(document.activeElement, burger());
  assert.equal(getBodyScrollLockCountForTest(), 0);
  await act(() => root.unmount());
});

test("the scrim and a menu link close the menu and release the scroll lock", async () => {
  const { root, burger, menu } = await mount();
  await click(burger());
  await click(document.querySelector(".hd-menu-scrim"));
  assert.equal(menu(), null);
  await click(burger());
  await click(menu().querySelector('a[href="/user"]'));
  assert.equal(menu(), null);
  assert.equal(getBodyScrollLockCountForTest(), 0);
  await act(() => root.unmount());
});

test("the search button opens the search field and focuses it; Esc in the field closes it and focus returns to the button (CURRENT)", async () => {
  const { root } = await mount();
  const button = document.querySelector(".hd-search-ic");
  await click(button);
  const header = document.querySelector("header");
  assert.match(header.className, /open-search/);
  const input = document.querySelector('input[name="q"]');
  assert.equal(document.activeElement, input);
  await act(() => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, isComposing: true })));
  assert.match(header.className, /open-search/, "Esc during IME composition keeps the search open");
  await act(() => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  assert.doesNotMatch(header.className, /open-search/);
  // The field is display:none once closed, so focus must not stay on (or drop from) it.
  assert.ok(document.activeElement === button, "focus returns to the search button");
  await act(() => root.unmount());
});

test("UX-GLOBAL-015: a pointerdown outside the search field and its button closes the search (CURRENT)", async () => {
  const { root } = await mount();
  const button = document.querySelector(".hd-search-ic");
  const header = document.querySelector("header");
  await click(button);
  await pointerDown(document.querySelector('input[name="q"]'));
  assert.match(header.className, /open-search/, "inside the field keeps it open");
  await pointerDown(button);
  assert.match(header.className, /open-search/, "the button handles its own toggle");
  await pointerDown(document.body);
  assert.doesNotMatch(header.className, /open-search/);
  await act(() => root.unmount());
});

test("UX-GLOBAL-016: Tab and Shift+Tab cycle inside the aria-modal mobile menu (CURRENT; Shift+Tab from the menu itself also stays inside)", async () => {
  const mobileAccount = React.createElement("button", { type: "button", className: "acc" }, "ログイン");
  const { root, burger, menu } = await mount({ mobileAccount });
  await click(burger());
  assert.ok(document.activeElement === menu(), "the menu has focus");
  const links = [...menu().querySelectorAll("a")];
  const last = menu().querySelector("button.acc");

  assert.equal(await tab({ shiftKey: true }), true, "Shift+Tab from the menu itself stays inside");
  assert.ok(document.activeElement === last, "focus moved to the last item");
  assert.equal(await tab(), true, "Tab from the last item wraps");
  assert.ok(document.activeElement === links[0], "focus moved to the first item");
  assert.equal(await tab({ shiftKey: true }), true, "Shift+Tab from the first item wraps");
  assert.ok(document.activeElement === last, "focus wrapped to the last item");
  links[1].focus();
  assert.equal(await tab(), false, "Tab between items is the browser's own move");
  assert.ok(menu(), "Tab never closes the menu");
  await act(() => root.unmount());
});

test("UX-GLOBAL-015: a pointerdown outside the mobile menu and its button closes it (CURRENT)", async () => {
  const { root, burger, menu } = await mount();
  await click(burger());
  await pointerDown(menu().querySelector("a"));
  assert.ok(menu(), "inside the menu keeps it open");
  await pointerDown(burger());
  assert.ok(menu(), "the menu button handles its own toggle");
  const scrim = document.querySelector(".hd-menu-scrim");
  await pointerDown(scrim);
  assert.ok(menu(), "the scrim closes on its click, so the tap does not reach the page under it");
  await click(scrim);
  assert.ok(menu() === null, "a scrim click closes the menu");
  await click(burger());
  await pointerDown(document.querySelector(".hd-logo"));
  assert.ok(menu() === null, "outside closes the menu");
  assert.equal(getBodyScrollLockCountForTest(), 0);
  await act(() => root.unmount());
});

async function submit(form) {
  const event = new Event("submit", { bubbles: true, cancelable: true });
  await act(() => form.dispatchEvent(event));
  return event.defaultPrevented;
}
const compose = (el, type) => act(() => el.dispatchEvent(new CompositionEvent(type, { bubbles: true })));

test("IME: the header search goes through ImeSafeGetForm, so the IME confirm Enter does not search (CURRENT)", async () => {
  document.body.innerHTML = "";
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const pushed = [];
  const navigator = { push: (href) => pushed.push(href), replace() {}, back() {} };
  await act(() =>
    root.render(React.createElement(AdapterProvider, { navigator }, React.createElement(PublicHeader, { currentPath: "/list" }))),
  );
  await click(document.querySelector(".hd-search-ic"));
  const form = document.querySelector("form.hd-search");
  const input = form.querySelector('input[name="q"]');
  const header = document.querySelector("header");
  input.value = "猫";

  await compose(input, "compositionstart");
  assert.equal(await submit(form), true, "no native submit while composing");
  await act(() => {
    // compositionend and the submit of the confirming Enter arrive in one task
    input.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  assert.deepEqual(pushed, [], "neither submit searches");
  assert.match(header.className, /open-search/, "the search stays open after a blocked submit");

  await new Promise((resolve) => setTimeout(resolve, 0));
  await submit(form);
  assert.deepEqual(pushed, ["/list?q=%E7%8C%AB"], "a later Enter searches GET /list?q=");
  assert.doesNotMatch(header.className, /open-search/);
  await act(() => root.unmount());
});

test("crossing to 641px or wider closes the open menu and releases the scroll lock", async () => {
  const { root, burger, menu } = await mount();
  await click(burger());
  assert.equal(getBodyScrollLockCountForTest(), 1);
  await act(() => setWide(true));
  assert.equal(menu(), null);
  assert.equal(getBodyScrollLockCountForTest(), 0);
  assert.equal(wideQuery.listeners.size, 0, "the media listener is removed with the menu");

  await click(burger()); // already wide: the menu closes at once instead of locking the page
  assert.equal(menu(), null);
  assert.equal(getBodyScrollLockCountForTest(), 0);
  setWide(false);
  await act(() => root.unmount());
});
