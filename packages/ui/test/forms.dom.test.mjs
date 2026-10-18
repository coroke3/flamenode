// ImeSafeGetForm / AutoSubmitSelect in a real DOM (jsdom) rendered by react-dom/client (MIG-0204 T04, U03).
import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "https://flamenode.test/list", pretendToBeVisual: true });
for (const key of ["window", "document", "navigator", "HTMLElement", "Node", "KeyboardEvent", "Event", "CompositionEvent", "FormData", "SubmitEvent"]) {
  Object.defineProperty(globalThis, key, { configurable: true, value: key === "window" ? dom.window : dom.window[key] });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const React = (await import("react")).default;
const { createRoot } = await import("react-dom/client");
const { act } = React;
const { ImeSafeGetForm, AutoSubmitSelect, AdapterProvider } = await import("../dist/index.js");
const h = React.createElement;
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

async function mount(children, formProps = {}) {
  document.body.innerHTML = "";
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const pushed = [];
  const navigated = [];
  const navigator = { push: (href) => pushed.push(href), replace() {}, back() {} };
  await act(() =>
    root.render(
      h(AdapterProvider, { navigator },
        h(ImeSafeGetForm, { action: "/list", onNavigated: () => navigated.push(true), ...formProps }, children)),
    ),
  );
  return { root, pushed, navigated, form: document.querySelector("form") };
}

const fire = (target, event) => act(() => target.dispatchEvent(event));
const enter = (init = {}) => new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true, ...init });
const submit = () => new Event("submit", { bubbles: true, cancelable: true });

test("T04: Enter during IME composition and the submit right after it do not search", async () => {
  const { root, pushed, form } = await mount(h("input", { name: "q", defaultValue: "かな" }));
  const input = form.querySelector("input");
  await fire(input, new CompositionEvent("compositionstart", { bubbles: true }));
  assert.ok(form.hasAttribute("data-fn-ime-composing"));
  await fire(input, enter({ isComposing: true }));
  await fire(form, submit()); // implicit submit some browsers send with the confirming Enter
  await fire(input, new CompositionEvent("compositionend", { bubbles: true }));
  await fire(form, submit()); // same tick as compositionend
  assert.deepEqual(pushed, []);

  await act(tick);
  assert.equal(form.hasAttribute("data-fn-ime-composing"), false);
  await fire(input, enter());
  assert.deepEqual(pushed, ["/list?q=%E3%81%8B%E3%81%AA"]);
  await act(() => root.unmount());
});

test("T04: an IME Enter without compositionstart (keyCode 229) is blocked too", async () => {
  const { root, pushed, form } = await mount(h("input", { name: "q", defaultValue: "x" }));
  const input = form.querySelector("input");
  await fire(input, enter({ keyCode: 229 }));
  await fire(form, submit());
  assert.deepEqual(pushed, []);
  await act(tick);
  await fire(form, submit()); // the search button after the IME closed
  assert.deepEqual(pushed, ["/list?q=x"]);
  await act(() => root.unmount());
});

test("Enter, Shift+Enter and the submit button search in the same tab and call onNavigated", async () => {
  const { root, pushed, navigated, form } = await mount([
    h("input", { key: "q", name: "q", defaultValue: "a b" }),
    h("input", { key: "s", type: "hidden", name: "sort", value: "new" }),
  ]);
  const input = form.querySelector('input[name="q"]');
  const key = enter();
  await fire(input, key);
  assert.equal(key.defaultPrevented, true);
  await fire(input, enter({ shiftKey: true }));
  const s = submit();
  await fire(form, s);
  assert.equal(s.defaultPrevented, true, "no native navigation on top of the client one");
  assert.deepEqual(pushed, ["/list?q=a+b&sort=new", "/list?q=a+b&sort=new", "/list?q=a+b&sort=new"]);
  assert.equal(navigated.length, 3);
  await act(() => root.unmount());
});

test("a POST form keeps the browser's own submit, still without IME implicit submits", async () => {
  const { root, pushed, form } = await mount(h("input", { name: "q", defaultValue: "x" }), { method: "post" });
  const s = submit();
  await fire(form, s);
  assert.equal(s.defaultPrevented, false);
  const blocked = submit();
  await act(() => {
    form.querySelector("input").dispatchEvent(enter({ isComposing: true }));
    form.dispatchEvent(blocked);
  });
  assert.equal(blocked.defaultPrevented, true);
  assert.deepEqual(pushed, []);
  await act(() => root.unmount());
});

test("U03: AutoSubmitSelect navigates with the form's values, but not while the form is composing", async () => {
  const { root, pushed, form } = await mount([
    h("input", { key: "q", name: "q", defaultValue: "k" }),
    h(AutoSubmitSelect, { key: "s", name: "sort", defaultValue: "new" },
      h("option", { value: "new" }, "新着"), h("option", { value: "popular" }, "人気")),
  ]);
  const select = form.querySelector("select");
  select.value = "popular";
  await fire(select, new Event("change", { bubbles: true }));
  assert.deepEqual(pushed, ["/list?q=k&sort=popular"]);

  form.setAttribute("data-fn-ime-composing", "");
  select.value = "new";
  await fire(select, new Event("change", { bubbles: true }));
  assert.deepEqual(pushed, ["/list?q=k&sort=popular"], "IME conversion must not auto-submit");
  await act(() => root.unmount());
});
