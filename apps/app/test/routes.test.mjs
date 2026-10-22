// MIG-0701: Personal read routes, session gate states, redirects, next sanitization.
import assert from "node:assert/strict";
import test from "node:test";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "https://flamenode.test/" });
for (const key of ["window", "document", "navigator", "HTMLElement", "Node"]) {
  Object.defineProperty(globalThis, key, { configurable: true, value: key === "window" ? dom.window : dom.window[key] });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const { GateView } = await import("../.test-dist/routes/guard.js");
const { PersonalRoutes, PERSONAL_READ_PATHS } = await import("../.test-dist/routes/router.js");
const { unwiredPersonalApi } = await import("../.test-dist/api/session.js");
const next = await import("../.test-dist/routes/next.js");

const user = (over = {}) => ({ id: "u1", name: "n", role: "user", is_banned: 0, active_x_user_id: null, ...over });
const html = (state, nextPath = "/dashboard") =>
  renderToStaticMarkup(React.createElement(GateView, { state, next: nextPath, children: () => "PAGE" }));

test("route table covers the 5 MIG-0701 paths", () => {
  assert.deepEqual([...PERSONAL_READ_PATHS], [
    "/dashboard", "/dashboard/library", "/dashboard/settings", "/dashboard/youtube-playlists", "/onboarding",
  ]);
});

test("gate: loading / unavailable / anonymous / banned / ok (CURRENT texts)", () => {
  assert.match(html({ status: "loading" }), /読み込み中/);
  assert.doesNotMatch(html({ status: "loading" }), /PAGE/);
  assert.match(html({ status: "unavailable" }), /画面の表示中に問題が発生しました/);
  assert.doesNotMatch(html({ status: "unavailable" }), /ログインが必要です/);
  const anon = html({ status: "anonymous" }, "/dashboard/library");
  assert.match(anon, /ログインが必要です/);
  assert.match(anon, /この画面はログイン後にご利用いただけます。/);
  assert.match(anon, /href="\/entry\?next=%2Fdashboard%2Flibrary"/);
  assert.match(anon, /Discord でログイン/);
  const banned = html({ status: "ok", user: user({ is_banned: 1 }) });
  assert.match(banned, /利用が停止されています/);
  assert.match(banned, /fn-guard-card--danger/);
  assert.doesNotMatch(banned, /PAGE/);
  assert.equal(html({ status: "ok", user: user() }), "PAGE");
});

test("X link states 0X / 1X / multiX reach the page body with the session's active X untouched", () => {
  for (const active of [null, "x1"]) {
    let seen;
    renderToStaticMarkup(React.createElement(GateView, {
      state: { status: "ok", user: user({ active_x_user_id: active }) },
      next: "/dashboard",
      children: (u) => { seen = u.active_x_user_id; return null; },
    }));
    assert.equal(seen, active);
  }
});

test("next sanitization matches CURRENT", () => {
  assert.equal(next.sanitizeNextPath("//evil.com"), "/dashboard");
  assert.equal(next.sanitizeNextPath("https://evil.com"), "/dashboard");
  assert.equal(next.sanitizeNextPath("/a\\b"), "/dashboard");
  assert.equal(next.sanitizeNextPath("/entry/slotted?slot=abc"), "/entry/slotted?slot=abc");
  assert.equal(next.sanitizeOnboardingNext("/onboarding?x=1"), "/dashboard");
  assert.equal(next.sanitizeOnboardingNext("/rules"), "/dashboard");
  assert.equal(next.sanitizeOnboardingNext("/api/auth/signin"), "/dashboard");
  assert.equal(next.onboardingHref("/dashboard/library"), "/onboarding?next=%2Fdashboard%2Flibrary");
  assert.equal(next.entryLoginHref("//x"), "/entry?next=%2Fdashboard");
});

test("youtube-playlists compat target: admin -> admin SPA, others -> /dashboard", () => {
  assert.equal(next.youtubePlaylistsTarget("admin"), "/admin/youtube-sync/playlists");
  assert.equal(next.youtubePlaylistsTarget("user"), "/dashboard");
  assert.equal(next.youtubePlaylistsTarget("moderator"), "/dashboard");
});

async function mount(path, api) {
  const container = dom.window.document.createElement("div");
  const root = createRoot(container);
  await act(async () => {
    root.render(React.createElement(MemoryRouter, { initialEntries: [path] }, React.createElement(PersonalRoutes, { api })));
  });
  await act(async () => { await Promise.resolve(); });
  return { container, root };
}
const apiOf = (result) => ({ getSession: async () => result });

test("direct deep links render the guard per session (reload = fresh mount)", async () => {
  for (const path of PERSONAL_READ_PATHS) {
    const anon = await mount(path, apiOf({ status: "anonymous" }));
    assert.match(anon.container.textContent, /ログインが必要です/, path);
    const expectedNext = path === "/onboarding" ? next.onboardingHref("/dashboard") : path;
    assert.ok(anon.container.innerHTML.includes(next.entryLoginHref(expectedNext)), path);
    const banned = await mount(path, apiOf({ status: "ok", user: user({ is_banned: 1 }) }));
    assert.match(banned.container.textContent, /利用が停止されています/, path);
    await act(async () => { anon.root.unmount(); banned.root.unmount(); });
  }
});

test("session read failure shows unavailable, never logout (unwired default included)", async () => {
  for (const api of [unwiredPersonalApi, { getSession: async () => { throw new Error("boom"); } }]) {
    const m = await mount("/dashboard", api);
    assert.match(m.container.textContent, /画面の表示中に問題が発生しました/);
    assert.doesNotMatch(m.container.textContent, /ログインが必要です/);
    await act(async () => m.root.unmount());
  }
});

test("youtube-playlists redirects a non-admin to /dashboard inside the SPA", async () => {
  const m = await mount("/dashboard/youtube-playlists", apiOf({ status: "ok", user: user() }));
  await act(async () => { await Promise.resolve(); });
  assert.match(m.container.textContent, /ダッシュボード/);
  await act(async () => m.root.unmount());
});

test("settings guard next mirrors CURRENT (?next sanitize, self-reference ignored)", async () => {
  const cases = [
    ["/dashboard/settings", "/dashboard/settings"],
    ["/dashboard/settings?next=%2F%2Fevil", "/dashboard"],
    ["/dashboard/settings?next=https%3A%2F%2Fevil.com", "/dashboard"],
    ["/dashboard/settings?next=%2Fdashboard%2Fsettings", "/dashboard/settings"],
    ["/dashboard/settings?next=%2Fentry%2Fslotted%3Fslot%3Dabc", "/entry/slotted?slot=abc"],
    ["/dashboard/settings?next=%20%20", "/dashboard/settings"],
  ];
  for (const [url, gateNext] of cases) {
    const m = await mount(url, apiOf({ status: "anonymous" }));
    assert.ok(m.container.innerHTML.includes(next.entryLoginHref(gateNext)), url);
    await act(async () => m.root.unmount());
  }
});

test("error boundary matches CURRENT (auth)/error.tsx and reset re-renders", async () => {
  const { RouteErrorBoundary } = await import("../.test-dist/routes/router.js");
  let fail = true;
  const Boom = () => { if (fail) throw Object.assign(new Error("x"), { digest: "abcdef0123456789" }); return "OK"; };
  const origError = console.error;
  console.error = () => {};
  const container = dom.window.document.createElement("div");
  const root = createRoot(container);
  await act(async () => root.render(React.createElement(RouteErrorBoundary, null, React.createElement(Boom))));
  console.error = origError;
  const text = container.textContent;
  for (const s of ["画面の表示中に問題が発生しました", "再送しても安全な操作もあります。まず再読み込みしてください。", "trace: abcdef012345", "再読み込み", "ログイン画面", "オンボーディング"]) {
    assert.ok(text.includes(s), s);
  }
  fail = false;
  await act(async () => container.querySelector("button").click());
  assert.equal(container.textContent, "OK");
  await act(async () => root.unmount());
});

test("onboarding guard next is the sanitized self href", async () => {
  const m = await mount("/onboarding?next=%2Fdashboard%2Flibrary", apiOf({ status: "anonymous" }));
  assert.ok(m.container.innerHTML.includes("/entry?next=%2Fonboarding%3Fnext%3D%252Fdashboard%252Flibrary"));
  await act(async () => m.root.unmount());
});
