import assert from "node:assert/strict";
import test from "node:test";
import { createOperationModeBannerApi } from "../.test-dist/apps/app/src/api/operationMode.js";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
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
  assert.deepEqual(await client(new Response(stream, { status: 200 })).api.getBanner(), expected);
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
  }, { highWaterMark: 0 }), { status: 200 });
  const pending = client(response).api.getBanner(controller.signal);
  await readingAgain;
  controller.abort();
  assert.equal(await pending, null);
  assert.equal(cancelled, true, "abort must cancel the still-open stream");
});
