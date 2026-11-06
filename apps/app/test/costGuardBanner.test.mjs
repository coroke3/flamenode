import assert from "node:assert/strict";
import test from "node:test";
import { createOperationModeBannerApi } from "../.test-dist/apps/app/src/api/operationMode.js";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { dom, flush } from "./helpers.mjs";
const { CostGuardBanner, CostGuardBannerView } =
  await import("../.test-dist/apps/app/src/routes/CostGuardBanner.js");

const respond = (status, body) =>
  new Response(body === undefined ? "{invalid" : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
function client(result) {
  const calls = [];
  const api = createOperationModeBannerApi(async (path, init) => {
    calls.push({ path, init });
    if (result instanceof Error) throw result;
    return result;
  });
  return { api, calls };
}

test("MIG-0718 U01 T01: supported non-normal modes retain their reason", async () => {
  for (const mode of ["economy", "read_only", "static_only", "maintenance"]) {
    const response = { mode, reason: "scheduled maintenance" };
    assert.deepEqual(await client(respond(200, response)).api.getBanner(), response);
    assert.deepEqual(await client(respond(200, { mode, reason: null })).api.getBanner(),
      { mode, reason: null });
  }
});

test("MIG-0718 U01 T01: uses public GET, same-origin credentials, no-store and forwards abort signal", async () => {
  const c = client(respond(200, { mode: "economy", reason: null }));
  const controller = new AbortController();
  assert.deepEqual(await c.api.getBanner(controller.signal), { mode: "economy", reason: null });
  assert.equal(c.calls.length, 1);
  assert.equal(c.calls[0].path, "/api/operation-mode/banner");
  assert.equal(c.calls[0].init.method, "GET");
  assert.equal(c.calls[0].init.credentials, "same-origin");
  assert.equal(c.calls[0].init.cache, "no-store");
  assert.deepEqual(c.calls[0].init.headers, { accept: "application/json" });
  assert.equal(c.calls[0].init.signal, controller.signal);
  assert.equal(c.calls[0].init.body, undefined);
});

test("MIG-0718 U01 T02: normal/unexpected mode/malformed JSON display no banner", async () => {
  for (const raw of [
    { mode: "normal", reason: null },
    { mode: "normal", reason: "operator note" },
    { mode: "unknown", reason: "note" },
    null, [], "", {}, { reason: null },
  ]) {
    assert.equal(await client(respond(200, raw)).api.getBanner(), null);
  }
});

test("MIG-0718 U01 T02: network errors, 401, 403, 404, 5xx, JSON failure hide banner", async () => {
  for (const result of [
    respond(401, { error: "unauthorized" }),
    respond(403, { error: "forbidden" }),
    respond(404, null),
    respond(503, { error: "unavailable" }),
    respond(200),
    new Error("network failure"),
  ]) assert.equal(await client(result).api.getBanner(), null);
});

test("MIG-0718 U01 T02: reject malformed or huge reason before rendering", async () => {
  for (const raw of [
    { mode: "economy" },
    { mode: "maintenance", reason: 123 },
    { mode: "economy", reason: "x".repeat(2049) },
  ]) assert.equal(await client(respond(200, raw)).api.getBanner(), null);
  assert.deepEqual(await client(respond(200, {
    mode: "maintenance", reason: "x".repeat(2048),
  })).api.getBanner(), { mode: "maintenance", reason: "x".repeat(2048) });
});

test("MIG-0718 U01 T02: non-JSON Content-Type never drives a banner", async () => {
  const payload = JSON.stringify({ mode: "maintenance", reason: "proxy text" });
  for (const contentType of ["text/plain", "text/html", "application/jsonp", "application/x-json"]) {
    let cancelled = false;
    const stream = new ReadableStream({
      start(controller) { controller.enqueue(new TextEncoder().encode(payload)); },
      cancel() { cancelled = true; },
    }, { highWaterMark: 0 });
    const response = new Response(stream, {
      status: 200,
      headers: { "content-type": contentType },
    });
    assert.equal(await client(response).api.getBanner(), null, contentType);
    assert.equal(cancelled, true, "rejected MIME body must be canceled");
  }
  const missingType = new Response(payload, { status: 200 });
  assert.equal(await client(missingType).api.getBanner(), null);
  const valid = new Response(payload, {
    status: 200, headers: { "content-type": "Application/JSON; charset=utf-8" },
  });
  assert.deepEqual(await client(valid).api.getBanner(), {
    mode: "maintenance", reason: "proxy text",
  });
});

test("MIG-0718 U01 T03: announced oversized body is rejected before reading", async () => {
  let started = 0;
  const stream = new ReadableStream({
    pull(controller) {
      started += 1;
      controller.enqueue(new TextEncoder().encode('{"mode":"economy","reason":null}'));
      controller.close();
    },
  });
  const response = new Response(stream, {
    status: 200,
    headers: { "Content-Length": String(128 * 1024) },
  });
  assert.equal(await client(response).api.getBanner(), null);
  // The browser may pre-pull; content-length rejection must not parse or show it.
  assert.ok(started <= 1);
});

test("MIG-0718 U01 T03: chunked response over 16KiB is not buffered or displayed", async () => {
  let cancelled = false;
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(9000).fill(65));
      controller.enqueue(new Uint8Array(9000).fill(65));
      // Do not close the stream: cancellation must stop an unfinished body.
    },
    cancel() { cancelled = true; },
  });
  assert.equal(await client(new Response(stream, { status: 200 })).api.getBanner(), null);
  assert.equal(cancelled, true, "unfinished response body must be cancelled");
});

test("MIG-0718 U01 T03: empty-chunk flooding is bounded and cancels the stream", async () => {
  let cancelled = false;
  const stream = new ReadableStream({
    start(controller) {
      for (let i = 0; i < 40; i += 1) controller.enqueue(new Uint8Array(0));
      // Never close: a byte-only limit would wait forever after consuming empties.
    },
    cancel() { cancelled = true; },
  });
  assert.equal(await client(new Response(stream, { status: 200 })).api.getBanner(), null);
  assert.equal(cancelled, true, "empty chunk flood must cancel unfinished response");
});

test("MIG-0718 U01 T03: small intermittent empty chunks preserve valid banner payload", async () => {
  const expected = { mode: "maintenance", reason: "正常" };
  const bytes = new TextEncoder().encode(JSON.stringify(expected));
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(0));
      controller.enqueue(bytes.slice(0, 8));
      controller.enqueue(new Uint8Array(0));
      controller.enqueue(bytes.slice(8));
      controller.close();
    },
  });
  assert.deepEqual(await client(new Response(stream, { status: 200, headers: { "content-type": "application/json" } })).api.getBanner(), expected);
});

test("MIG-0718 U01 T03: streamed multi-byte UTF-8 across chunks decodes safely", async () => {
  const expected = { mode: "economy", reason: "雪\u26c4" };
  const utf8 = new TextEncoder().encode(JSON.stringify(expected));
  const splitAt = utf8.findIndex((byte) => byte >= 0x80) + 1;
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(utf8.slice(0, splitAt));
      controller.enqueue(utf8.slice(splitAt));
      controller.close();
    },
  });
  assert.deepEqual(await client(new Response(stream, { status: 200, headers: { "content-type": "application/json" } })).api.getBanner(), expected);
});

test("MIG-0718 U01 T03: aborted request ignores a late successful response", async () => {
  const controller = new AbortController();
  const c = createOperationModeBannerApi(async () => {
    controller.abort();
    return respond(200, { mode: "maintenance", reason: "stale" });
  });
  assert.equal(await c.getBanner(controller.signal), null);
});


// MIG-0718 U02: component is deliberately NOT mounted in PersonalRoutes until
// MIG-0701's wrapper and the MIG-0661 response contract land (U03 merge gate).
async function renderBanner(api) {
  const container = dom.window.document.createElement("div");
  const root = createRoot(container);
  await act(async () => {
    root.render(React.createElement(CostGuardBanner, { api }));
  });
  await flush();
  return {
    root, container,
    render: async (newApi) => {
      await act(async () => root.render(React.createElement(CostGuardBanner, { api: newApi })));
      await flush();
    },
    unmount: async () => act(async () => root.unmount()),
  };
}

test("MIG-0718 U02 T01: all four CURRENT tone labels, descriptions, inline colors and ARIA", async () => {
  const cases = [
    ["economy", "省コストモード", "サイトは省コストモードで稼働中です。一部の重い処理が抑制されています。", "accent-warning"],
    ["read_only", "読み取り専用モード", "サイトは読み取り専用モードです。投稿・編集・確保は一時停止しています。", "accent-warning"],
    ["static_only", "静的JSONモード", "サイトは静的JSONのみで表示しています。動的更新は一時停止しています。", "accent-warning"],
    ["maintenance", "メンテナンス中", "サイトはメンテナンス中です。一部機能が利用できません。", "accent-danger"],
  ];
  for (const [mode, label, description, accent] of cases) {
    const m = await renderBanner({ getBanner: async () => ({ mode, reason: "reason-123" }) });
    const root = m.container.querySelector('[role="status"]');
    assert.ok(root, mode);
    assert.equal(root.getAttribute("aria-live"), "polite");
    assert.equal(root.getAttribute("class"), "cgb-banner");
    assert.ok(root.getAttribute("style").includes(accent), mode);
    assert.equal(root.querySelector(".fn-public-container.cgb-inner strong").textContent, label + ":");
    assert.equal(root.querySelector("span").textContent, description);
    assert.equal(root.querySelector(".cgb-reason").textContent, "(理由: reason-123)");
    await m.unmount();
  }
});

test("MIG-0718 U02 T01: optional reason is omitted; normal/unavailable never renders", async () => {
  const m = await renderBanner({ getBanner: async () => ({ mode: "economy", reason: null }) });
  assert.equal(m.container.querySelectorAll(".cgb-reason").length, 0);
  await m.render({ getBanner: async () => null });
  assert.equal(m.container.innerHTML, "");
  await m.render({ getBanner: async () => { throw new Error("offline"); } });
  assert.equal(m.container.innerHTML, "");
  await m.unmount();
  const none = await renderBanner({ getBanner: async () => null });
  assert.equal(none.container.innerHTML, "");
  await none.unmount();
});

test("MIG-0718 U02 T02: late async response from previous API never overwrites new mode", async () => {
  let resolveOld;
  let firstSignal;
  const oldApi = {
    getBanner: (signal) => {
      firstSignal = signal;
      return new Promise((resolve) => { resolveOld = resolve; });
    },
  };
  const m = await renderBanner(oldApi);
  assert.equal(m.container.innerHTML, "");
  await m.render({ getBanner: async () => ({ mode: "read_only", reason: "current" }) });
  assert.equal(firstSignal.aborted, true);
  assert.match(m.container.textContent, /読み取り専用モード/);
  await act(async () => resolveOld({ mode: "maintenance", reason: "stale" }));
  await flush();
  assert.match(m.container.textContent, /読み取り専用モード/);
  assert.doesNotMatch(m.container.textContent, /メンテナンス中|stale/);
  await m.unmount();
});

test("MIG-0718 U02: unmount before the queued microtask never invokes banner API", async () => {
  const container = dom.window.document.createElement("div");
  const root = createRoot(container);
  let called = 0;
  const api = {
    getBanner() {
      called++;
      throw new Error("stale fetch must not be started");
    },
  };
  // Synchronous act flushes mount/effect, but the Promise.resolve().then()
  // callback remains queued until after cleanup has aborted the signal.
  act(() => root.render(React.createElement(CostGuardBanner, { api })));
  act(() => root.unmount());
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(called, 0, "unmount must prevent a subsequently queued API call");
});

test("MIG-0718 U02 T02: abort on unmount; no non-normal response after cleanup", async () => {
  let resolvePending, signal;
  const api = { getBanner: (s) => {
    signal = s;
    return new Promise((resolve) => { resolvePending = resolve; });
  } };
  const m = await renderBanner(api);
  assert.equal(m.container.innerHTML, "");
  await m.unmount();
  assert.equal(signal.aborted, true);
  await act(async () => resolvePending({ mode: "maintenance", reason: "stale" }));
  assert.equal(m.container.innerHTML, "");
});

test("MIG-0718 U02: prefixed CSS is byte-for-byte the CURRENT module rule set", () => {
  const source = readFileSync(
    new URL("../../../src/components/layout/CostGuardBanner.module.css", import.meta.url),
    "utf8",
  );
  const target = readFileSync(
    new URL("../src/styles/cost-guard-banner.css", import.meta.url),
    "utf8",
  );
  const converted = source
    .replace(/\.banner(?=\s*\{)/g, ".cgb-banner")
    .replace(/\.inner(?=\s*\{)/g, ".cgb-inner")
    .replace(/\.reason(?=\s*\{)/g, ".cgb-reason");
  assert.equal(target, converted, "source CSS module drift or modified declarations");
});

test("MIG-0718 U01 T04: oversized Content-Length cancels unread response", async () => {
  let cancelled = false;
  const response = new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('{"mode":"maintenance","reason":null}'));
      // Keep stream open so discarding a rejected body is observable.
    },
    cancel() { cancelled = true; },
  }), { status: 200, headers: { "Content-Length": "70000" } });
  assert.equal(await client(response).api.getBanner(), null);
  assert.equal(cancelled, true, "header rejection must cancel unread network body");
});

test("MIG-0718 U01 T04: non-200 response cancels unread network body", async () => {
  let cancelled = false;
  const response = new Response(new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array([123])); },
    cancel() { cancelled = true; },
  }), { status: 503 });
  assert.equal(await client(response).api.getBanner(), null);
  assert.equal(cancelled, true);
});

test("MIG-0718 U01 T04: mid-stream AbortSignal releases a hanging reader.read", { timeout: 5000 }, async () => {
  const controller = new AbortController();
  let cancelled = false;
  let markReadPending;
  const readingAgain = new Promise((resolve) => { markReadPending = resolve; });
  const response = new Response(new ReadableStream({
    start(stream) {
      stream.enqueue(new TextEncoder().encode('{"mode":"economy","reason":"'));
      // Do not enqueue more bytes or close: a subsequent read would hang.
    },
    pull() { markReadPending(); },
    cancel() { cancelled = true; },
  }, { highWaterMark: 0 }), { status: 200, headers: { "content-type": "application/json" } });
  const pending = client(response).api.getBanner(controller.signal);
  await readingAgain;
  controller.abort();
  assert.equal(await pending, null);
  assert.equal(cancelled, true, "abort must cancel the still-open stream");
});

// A custom stream's cancellation hook is not guaranteed to resolve. UI reads
// must finish when cancellation has been initiated, not when the hook settles.
async function settlesWithoutAwaitingCancel(promise) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("banner request stalled on cancel()")), 1000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

test("MIG-0718 U01 T05: an unread error body cannot stall on a hanging cancel()", { timeout: 5000 }, async () => {
  let cancelled = false;
  const response = new Response(new ReadableStream({
    start(stream) { stream.enqueue(new Uint8Array([123])); },
    cancel() {
      cancelled = true;
      return new Promise(() => {}); // Simulate a non-cooperative custom stream.
    },
  }), { status: 503 });
  assert.equal(await settlesWithoutAwaitingCancel(client(response).api.getBanner()), null);
  assert.equal(cancelled, true, "the unread body still must be told to cancel");
});

test("MIG-0718 U01 T05: abort does not await a hanging stream cancel()", { timeout: 5000 }, async () => {
  const abort = new AbortController();
  let cancelled = false;
  let markWaiting;
  const waiting = new Promise((resolve) => { markWaiting = resolve; });
  const response = new Response(new ReadableStream({
    start(stream) {
      stream.enqueue(new TextEncoder().encode('{"mode":"maintenance","reason":"'));
    },
    pull() { markWaiting(); },
    cancel() {
      cancelled = true;
      return new Promise(() => {}); // A stalled underlying cancellation hook.
    },
  }, { highWaterMark: 0 }), { status: 200, headers: { "content-type": "application/json" } });
  const pending = client(response).api.getBanner(abort.signal);
  await waiting;
  abort.abort();
  assert.equal(await settlesWithoutAwaitingCancel(pending), null);
  assert.equal(cancelled, true);
});

test("MIG-0718 U02 T05: unexpected mode never crashes the Personal SPA banner", () => {
  for (const mode of ["bogus", "normal", "toString", "__proto__", null, 12]) {
    const html = renderToStaticMarkup(React.createElement(CostGuardBannerView, {
      snapshot: { mode, reason: "should not appear" },
    }));
    assert.equal(html, "", "unexpected mode " + String(mode));
  }
});

test("MIG-0718 U02 T05: malformed or oversized reason never crashes React render", () => {
  for (const reason of [{ nested: "bad" }, ["bad"], 42, "x".repeat(2049)]) {
    const html = renderToStaticMarkup(React.createElement(CostGuardBannerView, {
      snapshot: { mode: "economy", reason },
    }));
    assert.match(html, /省コストモード/);
    assert.doesNotMatch(html, /\(理由:/);
  }
  const html = renderToStaticMarkup(React.createElement(CostGuardBannerView, {
    snapshot: { mode: "economy", reason: "valid" },
  }));
  assert.match(html, /\(理由: valid\)/);
});

test("MIG-0718 U03: merged Personal wrapper mounts banner before main and never blocks its routes", async () => {
  const { PersonalRoutes } = await import("../.test-dist/apps/app/src/routes/router.js");
  const { MemoryRouter } = await import("react-router-dom");
  const container = dom.window.document.createElement("div");
  const root = createRoot(container);
  const seen = [];
  const bannerApi = { getBanner: async (signal) => {
    seen.push(signal);
    return { mode: "maintenance", reason: "運用上の確認" };
  } };
  try {
    // Use an unmatched Personal route so only the shared wrapper is exercised.
    await act(async () => root.render(React.createElement(
      MemoryRouter, { initialEntries: ["/__banner_probe__"] },
      React.createElement(PersonalRoutes, { api: {}, bannerApi }),
    )));
    await flush();
    const shell = container.querySelector('[data-fn-surface="personal"]');
    assert.ok(shell, "the merged Personal shell is preserved");
    const [banner, main] = [...shell.children];
    assert.equal(banner.getAttribute("role"), "status");
    assert.equal(banner.getAttribute("aria-live"), "polite");
    assert.equal(banner.querySelector("strong").textContent, "メンテナンス中:");
    assert.equal(banner.querySelector(".cgb-reason").textContent, "(理由: 運用上の確認)");
    assert.equal(main.tagName, "MAIN");
    assert.equal(seen.length, 1, "one banner fetch per mounted wrapper");
    assert.equal(seen[0].aborted, false);
  } finally {
    await act(async () => root.unmount());
  }
  assert.equal(seen[0].aborted, true, "unmount must cancel the banner reader");
});

test("MIG-0718 U03: banner CSS loads and regenerates from CURRENT module", () => {
  const main = readFileSync(new URL("../src/main.tsx", import.meta.url), "utf8");
  const generator = readFileSync(new URL("../scripts/portCssModule.mjs", import.meta.url), "utf8");
  assert.match(main, /import "\.\/styles\/cost-guard-banner\.css";/,
    "missing banner stylesheet must not silently remove the notice");
  assert.match(generator, /\["cgb", "src\/components\/layout\/CostGuardBanner\.module\.css", "apps\/app\/src\/styles\/cost-guard-banner\.css"\]/,
    "CSS regeneration must retain the banner styles");
});

test("MIG-0718 U03: client uses merged CostGuardBannerResponseSchema, not a provisional DTO", async () => {
  const source = readFileSync(new URL("../src/api/operationMode.ts", import.meta.url), "utf8");
  assert.match(source, /CostGuardBannerResponseSchema\.safeParse\(raw\)/);
  assert.doesNotMatch(source, /NON_NORMAL_MODES|MAX_REASON_CHARS/);
  assert.deepEqual(await client(respond(200, { mode: "maintenance", reason: "共有契約" })).api.getBanner(),
    { mode: "maintenance", reason: "共有契約" });
  assert.equal(await client(respond(200, { mode: "normal", reason: null })).api.getBanner(), null);
});
