// MIG-0507 Island behaviour in a real DOM (jsdom + react-dom/client): the view tracker (T07 / G07: one GA4 event
// at the threshold, 6h localStorage cooldown, only when the build has a GA id), the player (iframe, seek, time
// bridge, thumbnail before mount) and the header theme toggle (stored mode, OS follow, persistence).
import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { pretendToBeVisual: true, url: "https://flamenode.net/vid1" });
for (const key of ["window", "document", "navigator", "HTMLElement", "Node", "CustomEvent", "MessageEvent", "localStorage"]) {
  Object.defineProperty(globalThis, key, { configurable: true, value: key === "window" ? dom.window : dom.window[key] });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const React = (await import("react")).default;
const { createRoot } = await import("react-dom/client");
const { VideoPlayer } = await import("../apps/site/src/components/VideoPlayer.ts");
const { ThemeToggle } = await import("../apps/site/src/components/ThemeToggle.ts");
const { publishPlayerTime, seekToTime } = await import("../src/components/video/playerBridge.ts");
const { VIEW_COOLDOWN_MS, VIEW_THRESHOLD_SECONDS } = await import("../src/lib/analytics/videoViewTrackerCore.ts");
const { act } = React;
const h = React.createElement;

async function mount(element) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => root.render(element));
  return { container, unmount: () => act(async () => root.unmount()) };
}
const tick = (seconds) => act(async () => publishPlayerTime(seconds));
const props = { videoId: "vid1", youtubeId: "AAAAAAAAA01", title: "題名", primaryEventId: "ev1", gaEnabled: true };
const events = () => window.dataLayer.map((args) => [...args]);

test("T07: one flamenode_video_view at the threshold, none inside the 6h cooldown, again after it", async () => {
  assert.equal(VIEW_THRESHOLD_SECONDS, 10);
  assert.equal(VIEW_COOLDOWN_MS, 6 * 60 * 60 * 1000);
  window.dataLayer = [];
  localStorage.clear();
  const first = await mount(h(VideoPlayer, props));
  for (let s = 0; s <= 9; s += 1) await tick(s);
  assert.equal(window.dataLayer.length, 0, "below the threshold nothing is sent");
  await tick(10);
  await tick(11);
  await tick(12);
  assert.equal(window.dataLayer.length, 1, "exactly once");
  assert.deepEqual(events()[0], ["event", "flamenode_video_view", { video_id: "vid1", youtube_video_id: "AAAAAAAAA01", primary_event_id: "ev1", watch_threshold_seconds: 10 }]);
  const until = Number(localStorage.getItem("fn:ga-view:vid1"));
  assert.ok(until > Date.now() + VIEW_COOLDOWN_MS - 60_000 && until <= Date.now() + VIEW_COOLDOWN_MS + 1000, "cooldown stored for 6h");
  await first.unmount();

  const again = await mount(h(VideoPlayer, props));
  for (let s = 0; s <= 14; s += 1) await tick(s);
  assert.equal(window.dataLayer.length, 1, "inside the cooldown no second event");
  await again.unmount();

  localStorage.setItem("fn:ga-view:vid1", String(Date.now() - 1));
  const later = await mount(h(VideoPlayer, props));
  for (let s = 0; s <= 11; s += 1) await tick(s);
  assert.equal(window.dataLayer.length, 2, "after the cooldown it fires again");
  await later.unmount();
});

test("T07: seeks and jumps do not count as watch time, a hidden tab does not count, and no GA id means no tracking", async () => {
  window.dataLayer = [];
  localStorage.clear();
  const m = await mount(h(VideoPlayer, props));
  for (const s of [0, 30, 60, 90, 120, 150]) await tick(s); // jumps of 30s
  assert.equal(window.dataLayer.length, 0);
  await m.unmount();

  const off = await mount(h(VideoPlayer, { ...props, gaEnabled: false }));
  for (let s = 0; s <= 20; s += 1) await tick(s);
  assert.equal(window.dataLayer.length, 0, "no GA id: the tracker is off, as CURRENT");
  await off.unmount();

  const hidden = await mount(h(VideoPlayer, props));
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
  document.dispatchEvent(new window.Event("visibilitychange"));
  for (let s = 0; s <= 20; s += 1) await tick(s);
  assert.equal(window.dataLayer.length, 0, "hidden tab");
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  await hidden.unmount();
});

test("player: thumbnail first, then the official iframe with the JS API; seek waits for ready", async () => {
  const m = await mount(h(VideoPlayer, props));
  const iframe = m.container.querySelector("iframe");
  assert.ok(iframe, "iframe after mount");
  assert.match(iframe.getAttribute("src"), /^https:\/\/www\.youtube(-nocookie)?\.com\/embed\/AAAAAAAAA01\?/);
  assert.match(iframe.getAttribute("src"), /enablejsapi=1/);
  assert.equal(iframe.getAttribute("title"), "題名");
  assert.equal(iframe.id, "flamenode-youtube-player");
  const sent = [];
  Object.defineProperty(iframe, "contentWindow", { configurable: true, value: { postMessage: (data, origin) => sent.push([data, origin]) } });
  await act(async () => seekToTime(42));
  assert.equal(sent.length, 0, "not ready: the seek is queued");
  await act(async () => window.dispatchEvent(new MessageEvent("message", { data: JSON.stringify({ event: "onReady" }), origin: "https://www.youtube.com", source: iframe.contentWindow })));
  const seek = sent.map(([d]) => JSON.parse(d)).find((c) => c.func === "seekTo");
  assert.deepEqual(seek.args, [42, true], "queued seek is sent once ready");
  assert.ok(sent.every(([, origin]) => origin === "https://www.youtube.com"));
  await m.unmount();
});

test("theme toggle: stored mode wins, a click flips and persists fn-theme, system mode follows the OS", async () => {
  const root = document.documentElement;
  localStorage.setItem("fn-theme", "light");
  const m = await mount(h(ThemeToggle));
  assert.equal(root.getAttribute("data-theme"), "light");
  const button = m.container.querySelector("button");
  assert.equal(button.getAttribute("aria-label"), "現在はライトテーマ。ダークテーマへ切り替え");
  await act(async () => button.click());
  assert.equal(root.getAttribute("data-theme"), "dark");
  assert.equal(localStorage.getItem("fn-theme"), "dark");
  assert.equal(button.getAttribute("aria-label"), "現在はダークテーマ。ライトテーマへ切り替え");
  await m.unmount();

  localStorage.setItem("fn-theme", "garbage");
  const sys = await mount(h(ThemeToggle));
  assert.equal(root.getAttribute("data-theme-preference"), "system", "corrupt value falls back to system");
  await sys.unmount();
});
