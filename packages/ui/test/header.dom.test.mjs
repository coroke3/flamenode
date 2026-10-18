// PublicHeader in a real DOM (jsdom) rendered by react-dom/client (MIG-0203 T04).
import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "https://flamenode.test/list", pretendToBeVisual: true });
dom.window.scrollTo = () => {}; // jsdom does not implement scrolling
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
const { PublicHeader, getBodyScrollLockCountForTest } = await import("../dist/index.js");

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

test("the search button opens the search field and focuses it; Esc in the field closes it", async () => {
  const { root } = await mount();
  const button = document.querySelector(".hd-search-ic");
  await click(button);
  const header = document.querySelector("header");
  assert.match(header.className, /open-search/);
  const input = document.querySelector('input[name="q"]');
  assert.equal(document.activeElement, input);
  await act(() => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  assert.doesNotMatch(header.className, /open-search/);
  await act(() => root.unmount());
});
async function submit(form) {
  const event = new Event("submit", { bubbles: true, cancelable: true });
  await act(() => form.dispatchEvent(event));
  return event.defaultPrevented;
}
const compose = (el, type) => act(() => el.dispatchEvent(new CompositionEvent(type, { bubbles: true })));

test("IME: a submit during composition or in the same task as compositionend is blocked (CURRENT ImeSafeGetForm)", async () => {
  const { root } = await mount();
  await click(document.querySelector(".hd-search-ic"));
  const form = document.querySelector("form.hd-search");
  const input = form.querySelector('input[name="q"]');
  const header = document.querySelector("header");

  await compose(input, "compositionstart");
  assert.equal(await submit(form), true, "submit while composing is prevented");
  await compose(input, "compositionend");
  assert.equal(await submit(form), true, "submit in the same task as compositionend is prevented");
  assert.match(header.className, /open-search/, "the search stays open after a blocked submit");

  await new Promise((resolve) => setTimeout(resolve, 0));
  await submit(form);
  assert.equal(form.getAttribute("action"), "/list");
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
