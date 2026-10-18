// PublicHeader in a real DOM (jsdom) rendered by react-dom/client (MIG-0203 T04).
import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { pretendToBeVisual: true });
dom.window.scrollTo = () => {}; // jsdom does not implement scrolling
for (const key of ["window", "document", "navigator", "HTMLElement", "Node", "KeyboardEvent", "MouseEvent"]) {
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
