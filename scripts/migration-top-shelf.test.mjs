// MIG-0507 U09: top shelf Island. Part 1 is the CURRENT `topLoopShelf.contract.test.mjs` rules ported to the new
// source (3 copies, teleport thresholds, clone a11y, no hover pause, reduced motion ...). Part 2 runs the Island in
// jsdom with fake layout (jsdom has none): loop seam, auto-scroll, pauses, arrows, 2-row padding, static takeover.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { JSDOM } from "jsdom";

const island = await readFile(new URL("../apps/site/src/components/TopShelfIsland.ts", import.meta.url), "utf8");
const mount = await readFile(new URL("../apps/site/src/components/mountTopShelves.ts", import.meta.url), "utf8");
const screensCss = await readFile(new URL("../packages/ui/src/styles/screens.css", import.meta.url), "utf8");

test("contract: no flushSync / item rotation; three copies with data-loop-group and unique keys", () => {
  for (const banned of [/flushSync/, /setLoopItems/, /rotateForward/, /rotateBackward/, /normalizeLoopScroll/, /\binert\b/]) assert.doesNotMatch(island, banned);
  for (const g of ["0", "1", "2"]) assert.match(island, new RegExp(`"data-loop-group": "${g}"`));
  assert.match(island, /\$\{entry\.sourceKey\}@\$\{groupIndex\}-\$\{index\}/);
});

test("contract: cycle width, teleport thresholds, centred seed, scrollend, resize keeps the relative offset", () => {
  assert.match(island, /measureCycleWidth/);
  assert.match(island, /leftThreshold = cycleWidth \* 0\.5/);
  assert.match(island, /rightThreshold = cycleWidth \* 1\.5/);
  assert.match(island, /scrollLeft \+ cycleWidth/);
  assert.match(island, /scrollLeft - cycleWidth/);
  assert.match(island, /scroller\.scrollLeft = cycleWidth/);
  assert.match(island, /ResizeObserver/);
  assert.match(island, /scrollend/);
  assert.match(island, /relativeOffset \* nextCycleWidth/);
});

test("contract: clone groups are aria-hidden and their focusables leave the tab order", () => {
  assert.match(island, /"data-loop-group": "0", "aria-hidden": "true"/);
  assert.match(island, /"data-loop-group": "2", "aria-hidden": "true"/);
  assert.match(island, /neutralizeCloneFocusables/);
  assert.match(island, /data-loop-tabindex/);
});

test("contract: direction, pointer / wheel / reduced motion, and a mouse hover alone never pauses", () => {
  assert.match(island, /autoScrollDirection === "left" \? 1 : -1/);
  assert.match(island, /"data-auto-direction": autoScrollDirection/);
  assert.match(island, /autoScrollCarryRef/);
  for (const word of [/pointerActiveRef/, /pauseAfterInteraction/, /pauseOnWheel/, /prefers-reduced-motion: reduce/, /reducedMotion/, /IntersectionObserver/, /visibilitychange/, /inViewport/, /documentVisible/]) assert.match(island, word);
  const handlers = island.match(/const interactionHandlers = \{([\s\S]*?)\n  \};/)?.[1];
  assert.ok(handlers);
  assert.doesNotMatch(handlers, /onMouseEnter|onMouseLeave|onPointerEnter|hover/);
  assert.match(handlers, /onFocusCapture/);
  assert.match(handlers, /onPointerDown/);
});

test("contract: short lists, 2-row column padding, 700px source of truth, arrow labels", () => {
  assert.match(island, /sourceItems\.length < 2/);
  assert.match(island, /if \(needsLoop\) return;[\s\S]*?scroller\.scrollLeft = 0/);
  assert.match(island, /items\.length % rotateCount === 0/);
  assert.match(island, /@pad-/);
  assert.match(island, /MOBILE_SHELF_MAX_WIDTH_PX = 700/);
  assert.match(island, /useMobileStride: boolean/);
  assert.match(island, /mobileRows === 2 && isMobileViewport/);
  assert.match(island, /前へスクロール/);
  assert.match(island, /次へスクロール/);
});

test("contract: CSS keeps the full-bleed rail, 2-row grid at <=700px, arrows from 701px and a focus ring", () => {
  assert.match(screensCss, /\.tls\{margin-inline:calc\(50% - 50vw\)/);
  assert.match(screensCss, /data-mobile-rows="2"\] \.tls-group\{grid-template-rows:repeat\(2,/);
  assert.match(screensCss, /@media \(min-width:701px\)\{\.tls-arrow\{display:inline-flex\}\}/);
  assert.match(screensCss, /\.tls-arrow:focus-visible\{outline:2px solid/);
  assert.match(screensCss, /@media \(max-width:700px\)/);
  assert.match(mount, /trending: "left"[\s\S]*recommend: "right"[\s\S]*latest: "left"[\s\S]*nostalgic: "right"/);
});

// ---- jsdom ----
const dom = new JSDOM("<!doctype html><html><body></body></html>", { pretendToBeVisual: true, url: "https://flamenode.net/" });
for (const key of ["window", "document", "navigator", "HTMLElement", "Element", "Node", "Event", "MouseEvent", "FocusEvent", "KeyboardEvent", "WheelEvent"]) {
  Object.defineProperty(globalThis, key, { configurable: true, value: key === "window" ? dom.window : dom.window[key] });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const w = dom.window;

const CARD = 250;
const VIEW = 1000;
const state = { mobile: false, reduced: false, observers: [] };
const scrollStore = new WeakMap();
Object.defineProperty(w.Element.prototype, "scrollLeft", {
  configurable: true,
  get() { return scrollStore.get(this) ?? 0; },
  set(value) { scrollStore.set(this, Math.round(value)); },
});
const isGroup = (el) => el.classList?.contains("tls-group");
Object.defineProperty(w.HTMLElement.prototype, "clientWidth", { configurable: true, get() { return this.classList.contains("tls-scroller") ? VIEW : 0; } });
Object.defineProperty(w.HTMLElement.prototype, "scrollWidth", {
  configurable: true,
  get() {
    if (isGroup(this)) return this.children.length * CARD;
    if (this.classList.contains("tls-scroller")) return [...this.children].reduce((sum, g) => sum + g.children.length * CARD, 0);
    return 0;
  },
});
Object.defineProperty(w.HTMLElement.prototype, "offsetWidth", { configurable: true, get() { return this.classList.contains("tls-i") ? CARD : 0; } });
w.HTMLElement.prototype.getBoundingClientRect = function () {
  const width = isGroup(this) ? this.children.length * CARD : 0;
  return { width, height: 0, top: 0, left: 0, right: width, bottom: 0, x: 0, y: 0, toJSON() {} };
};
w.matchMedia = (query) => ({
  media: query,
  get matches() { return query.includes("reduced-motion") ? state.reduced : query.includes("max-width: 700px") ? state.mobile : false; },
  addEventListener() {},
  removeEventListener() {},
});
class FakeIntersectionObserver {
  constructor(callback) { this.callback = callback; this.targets = new Set(); state.observers.push(this); }
  observe(target) { this.targets.add(target); }
  unobserve(target) { this.targets.delete(target); }
  disconnect() { this.targets.clear(); }
  fire(isIntersecting) { this.callback([...this.targets].map((target) => ({ target, isIntersecting }))); }
}
globalThis.IntersectionObserver = w.IntersectionObserver = FakeIntersectionObserver;
globalThis.ResizeObserver = w.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
// One clock for performance.now() (Node) and the rAF timestamps, so the auto-scroll delta is real.
w.requestAnimationFrame = (cb) => setTimeout(() => cb(performance.now()), 16);
w.cancelAnimationFrame = (id) => clearTimeout(id);
Object.defineProperty(globalThis, "getComputedStyle", { configurable: true, value: w.getComputedStyle.bind(w) });

const React = (await import("react")).default;
const { createRoot } = await import("react-dom/client");
const { TopShelfIsland } = await import("../apps/site/src/components/TopShelfIsland.ts");
const { mountTopShelves, readShelfCards } = await import("../apps/site/src/components/mountTopShelves.ts");
const { act } = React;
const h = React.createElement;

const cards = (n) => Array.from({ length: n }, (_, i) => ({ key: `c${i}`, html: `<a href="/v${i}">作品${i}</a>` }));
const sleep = (ms) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
async function mountIsland(props) {
  state.observers.length = 0;
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => root.render(h(TopShelfIsland, { ariaLabel: "新着", ...props })));
  await sleep(0);
  const scroller = container.querySelector(".tls-scroller");
  // A browser fires `scroll` when the centred start assigns scrollLeft; jsdom does not.
  if (scroller) await act(async () => { scroller.dispatchEvent(new w.Event("scroll")); });
  const visible = async (on = true) => { await act(async () => { for (const o of state.observers) o.fire(on); }); };
  return { container, scroller, visible, unmount: () => act(async () => root.unmount()) };
}
const groups = (c) => [...c.querySelectorAll(".tls-group")];
const reset = () => { state.mobile = false; state.reduced = false; };

test("short list fits: one group, no arrows, no clones, scroll stays at 0", async () => {
  reset();
  const v = await mountIsland({ items: cards(3) });
  assert.equal(groups(v.container).length, 1);
  assert.equal(v.container.querySelectorAll(".tls-arrow").length, 0);
  assert.equal(v.scroller.getAttribute("role"), "region");
  assert.equal(v.scroller.getAttribute("aria-label"), "新着");
  assert.equal(v.scroller.scrollLeft, 0);
  await v.unmount();
  const single = await mountIsland({ items: cards(1) });
  assert.equal(single.container.querySelectorAll(".tls-arrow").length, 0);
  await single.unmount();
  const none = await mountIsland({ items: [] });
  assert.equal(none.container.textContent, "");
  await none.unmount();
});

test("overflowing list: three copies, centred start, clone a11y, arrows, onReady once", async () => {
  reset();
  let ready = 0;
  const v = await mountIsland({ items: cards(8), onReady: () => ready++ });
  const [g0, g1, g2] = groups(v.container);
  assert.equal(groups(v.container).length, 3);
  assert.equal(g0.getAttribute("aria-hidden"), "true");
  assert.equal(g2.getAttribute("aria-hidden"), "true");
  assert.equal(g1.getAttribute("aria-hidden"), null);
  assert.equal(g1.children.length, 8);
  for (const clone of [g0, g2]) for (const a of clone.querySelectorAll("a")) {
    assert.equal(a.getAttribute("tabindex"), "-1");
    assert.equal(a.getAttribute("data-loop-tabindex"), "");
  }
  assert.equal(g1.querySelector("a").getAttribute("tabindex"), null, "the real group stays focusable");
  assert.equal(v.scroller.scrollLeft, 8 * CARD, "starts on the middle copy (cycle = group width)");
  assert.deepEqual([...v.container.querySelectorAll(".tls-arrow")].map((b) => b.getAttribute("aria-label")), ["前へスクロール", "次へスクロール"]);
  assert.ok([...v.container.querySelectorAll(".tls-arrow")].every((b) => !b.disabled));
  assert.equal(ready, 1);
  await v.unmount();
});

test("teleport: leaving the middle third jumps one cycle, in both directions", async () => {
  reset();
  const v = await mountIsland({ items: cards(8) });
  const cycle = 8 * CARD;
  v.scroller.scrollLeft = 100;
  await act(async () => { v.scroller.dispatchEvent(new w.Event("scroll")); });
  await sleep(40);
  assert.equal(v.scroller.scrollLeft, 100 + cycle);
  v.scroller.scrollLeft = cycle * 1.5 + 50;
  await act(async () => { v.scroller.dispatchEvent(new w.Event("scrollend")); });
  assert.equal(v.scroller.scrollLeft, cycle * 0.5 + 50);
  await v.unmount();
});

test("auto-scroll: only while visible; left grows scrollLeft, right shrinks it; carries the fraction", async () => {
  reset();
  const left = await mountIsland({ items: cards(8), autoScrollDirection: "left" });
  await sleep(150);
  assert.equal(left.scroller.scrollLeft, 8 * CARD, "off-screen shelf does not move");
  await left.visible(true);
  await sleep(700);
  const moved = left.scroller.scrollLeft - 8 * CARD;
  assert.ok(moved >= 5 && moved <= 30, `moved ${moved}px at 26px/s`);
  await left.visible(false);
  const stopped = left.scroller.scrollLeft;
  await sleep(200);
  assert.equal(left.scroller.scrollLeft, stopped, "stops when it leaves the viewport");
  await left.unmount();

  const right = await mountIsland({ items: cards(8), autoScrollDirection: "right" });
  await right.visible(true);
  await sleep(700);
  assert.ok(right.scroller.scrollLeft < 8 * CARD);
  await right.unmount();

  const off = await mountIsland({ items: cards(8), autoScrollSpeed: 0 });
  await off.visible(true);
  await sleep(300);
  assert.equal(off.scroller.scrollLeft, 8 * CARD, "speed 0 never auto-scrolls");
  await off.unmount();
});

test("auto-scroll stops for reduced motion and a hidden tab", async () => {
  reset();
  state.reduced = true;
  const a = await mountIsland({ items: cards(8) });
  await a.visible(true);
  await sleep(300);
  assert.equal(a.scroller.scrollLeft, 8 * CARD);
  await a.unmount();
  reset();
  const b = await mountIsland({ items: cards(8) });
  await b.visible(true);
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
  await act(async () => { document.dispatchEvent(new w.Event("visibilitychange")); });
  const at = b.scroller.scrollLeft;
  await sleep(250);
  assert.equal(b.scroller.scrollLeft, at);
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
  await act(async () => { document.dispatchEvent(new w.Event("visibilitychange")); });
  await sleep(300);
  assert.ok(b.scroller.scrollLeft > at, "resumes when the tab is visible again");
  await b.unmount();
});

test("pauses: focus, pointer down; hover alone does not; wheel and keys pause for the configured time", async () => {
  reset();
  const v = await mountIsland({ items: cards(8), pauseAfterInteractionMs: 300 });
  await v.visible(true);
  const link = v.scroller.querySelector('[data-loop-group="1"] a');
  const stays = async (label) => { const at = v.scroller.scrollLeft; await sleep(250); assert.equal(v.scroller.scrollLeft, at, label); };
  const moves = async (label) => { const at = v.scroller.scrollLeft; await sleep(700); assert.ok(v.scroller.scrollLeft > at, label); };

  await act(async () => { link.dispatchEvent(new w.Event("pointerenter", { bubbles: true })); link.dispatchEvent(new w.MouseEvent("mouseover", { bubbles: true })); });
  await moves("hover alone keeps scrolling (CURRENT contract)");

  await act(async () => { link.dispatchEvent(new w.FocusEvent("focusin", { bubbles: true })); });
  await stays("focus pauses");
  await act(async () => { link.dispatchEvent(new w.FocusEvent("focusout", { bubbles: true, relatedTarget: null })); });
  await moves("blur outside resumes");

  await act(async () => { link.dispatchEvent(new w.Event("pointerdown", { bubbles: true })); });
  await stays("pointer down pauses");
  await act(async () => { link.dispatchEvent(new w.Event("pointerup", { bubbles: true })); });
  await stays("pointer up keeps the pause for the interaction delay");
  await sleep(400);
  await moves("then resumes");

  await act(async () => { v.scroller.dispatchEvent(new w.WheelEvent("wheel", { bubbles: true })); });
  await stays("wheel pauses");
  await sleep(400);
  await act(async () => { v.scroller.dispatchEvent(new w.KeyboardEvent("keydown", { bubbles: true, key: "ArrowRight" })); });
  await stays("arrow key pauses");
  await sleep(400);
  await act(async () => { v.scroller.dispatchEvent(new w.KeyboardEvent("keydown", { bubbles: true, key: "a" })); });
  await moves("other keys do not pause");
  await v.unmount();

  const noWheel = await mountIsland({ items: cards(8), pauseOnWheel: false, pauseAfterInteractionMs: 5000 });
  await noWheel.visible(true);
  await act(async () => { noWheel.scroller.dispatchEvent(new w.WheelEvent("wheel", { bubbles: true })); });
  const at = noWheel.scroller.scrollLeft;
  await sleep(700);
  assert.ok(noWheel.scroller.scrollLeft > at, "pauseOnWheel=false");
  await noWheel.unmount();
});

test("arrows move 1.5 cards with the eased scroll, instantly for reduced motion, and pause auto-scroll", async () => {
  reset();
  const v = await mountIsland({ items: cards(8), autoScrollSpeed: 0 });
  const [prev, next] = v.container.querySelectorAll(".tls-arrow");
  const start = v.scroller.scrollLeft;
  await act(async () => { next.dispatchEvent(new w.MouseEvent("click", { bubbles: true })); });
  await sleep(450);
  assert.equal(v.scroller.scrollLeft, start + CARD * 1.5);
  await act(async () => { prev.dispatchEvent(new w.MouseEvent("click", { bubbles: true })); });
  await sleep(450);
  assert.equal(v.scroller.scrollLeft, start);
  await v.unmount();

  state.reduced = true;
  const r = await mountIsland({ items: cards(8), autoScrollSpeed: 0 });
  const rNext = r.container.querySelectorAll(".tls-arrow")[1];
  await act(async () => { rNext.dispatchEvent(new w.MouseEvent("click", { bubbles: true })); });
  assert.equal(r.scroller.scrollLeft, 8 * CARD + CARD * 1.5, "no animation under reduced motion");
  await r.unmount();
  reset();
});

test("<=700px with two rows: an odd list is padded to a full column and arrows step one card", async () => {
  reset();
  state.mobile = true;
  const v = await mountIsland({ items: cards(9), autoScrollSpeed: 0 });
  const g1 = v.container.querySelector('[data-loop-group="1"]');
  assert.equal(g1.children.length, 10);
  const pad = g1.lastElementChild;
  assert.ok(pad.classList.contains("tls-pad"));
  assert.equal(pad.getAttribute("aria-hidden"), "true");
  assert.equal(v.scroller.getAttribute("data-mobile-rows"), "2");
  const start = v.scroller.scrollLeft;
  await act(async () => { v.container.querySelectorAll(".tls-arrow")[1].dispatchEvent(new w.MouseEvent("click", { bubbles: true })); });
  await sleep(450);
  assert.equal(v.scroller.scrollLeft, start + CARD, "mobile stride is one card");
  await v.unmount();

  state.mobile = false;
  const desktop = await mountIsland({ items: cards(9), autoScrollSpeed: 0 });
  assert.equal(desktop.container.querySelector('[data-loop-group="1"]').children.length, 9, "no pad cells on desktop");
  await desktop.unmount();
});

test("static takeover: the native shelf is removed only after the Island rendered; empty shelves stay", async () => {
  reset();
  document.body.innerHTML = `<section>
    <div class="tp-shelf" data-shelf="latest" role="region" aria-label="新着" tabindex="0"><ol class="tp-shelf-track">${Array.from({ length: 8 }, (_, i) => `<li class="tp-shelf-i"><span class="tp-shelf-rank">${i + 1}</span><a href="/v${i}">作品${i}</a></li>`).join("")}</ol></div>
    <div class="tp-shelf" data-shelf="recommend" role="region" aria-label="空"><ol class="tp-shelf-track"></ol></div>
  </section>`;
  const shelf = document.querySelector('[data-shelf="latest"]');
  const cardsRead = readShelfCards(shelf);
  assert.equal(cardsRead.length, 8);
  assert.match(cardsRead[0].html, /tp-shelf-rank.*作品0/);
  state.observers.length = 0;
  mountTopShelves();
  assert.ok(document.querySelector('[data-shelf="latest"]'), "static shelf is kept until the shelf is near the viewport");
  assert.equal(document.querySelector(".tls"), null);
  await act(async () => { for (const o of state.observers) o.fire(true); });
  await sleep(20);
  assert.equal(document.querySelector('[data-shelf="latest"]'), null, "static shelf removed after render");
  const tls = document.querySelector(".tls-scroller");
  assert.equal(tls.getAttribute("aria-label"), "新着");
  assert.equal(tls.getAttribute("data-auto-direction"), "left");
  assert.equal(tls.querySelectorAll('[data-loop-group="1"] .tls-i').length, 8);
  assert.match(tls.querySelector('[data-loop-group="1"] .tls-i').innerHTML, /<span class="tp-shelf-rank">1<\/span><a href="\/v0">作品0<\/a>/);
  assert.ok(document.querySelector('[data-shelf="recommend"]'), "a shelf without cards is left alone");
  document.body.innerHTML = "";
});
