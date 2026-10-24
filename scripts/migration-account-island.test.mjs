// MIG-0507 U08: header account Island in jsdom against the RH-001 response shapes (MIG-0605 U01, CURRENT
// lib/account/summary.ts): logged out, loading, unavailable (503), banned/logged-out answer, presence-first
// loading, details only on menu open, management links only from the full summary, X ID states and switching.
import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { pretendToBeVisual: true, url: "https://flamenode.net/about" });
for (const key of ["window", "document", "navigator", "HTMLElement", "Node", "CustomEvent", "MouseEvent", "KeyboardEvent", "localStorage"]) {
  Object.defineProperty(globalThis, key, { configurable: true, value: key === "window" ? dom.window : dom.window[key] });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const React = (await import("react")).default;
const { createRoot } = await import("react-dom/client");
const { AccountSlot, MobileAccountSlot, entryHrefFor } = await import("../apps/site/src/components/AccountMenu.ts");
const { createAccountStore, resolveDisplayName } = await import("../apps/site/src/lib/accountSummary.ts");
const { ACTIVE_X_BEFORE_SWITCH_EVENT, ACTIVE_X_CHANGED_EVENT } = await import("../src/lib/client/activeXSwitchEvents.ts");
const { act } = React;
const h = React.createElement;

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const presenceIn = { view: "presence", loggedIn: true, displayName: "おたこ", icon: "https://img/a.png" };
const entry = (id, status, active = false, name = `@${id}`) => ({ x_user_id: id, x_name: name, icon_url: null, approval_status: status, is_active: active });
const summary = (over = {}) => ({
  loggedIn: true, displayName: "おたこ", icon: "https://img/a.png", role: "user", activeXId: "otako",
  xIds: [entry("otako", "approved", true, "おたこ"), entry("second", "approved", false, "セカンド")],
  canAccessAdmin: false, canAccessManage: false, ...over,
});

/** Routes by URL; records calls. A function value is evaluated per call. */
function fakeFetch(routes) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init });
    const route = routes[url];
    if (!route) throw new Error(`unexpected ${url}`);
    const value = typeof route === "function" ? route() : route;
    return value instanceof Error ? Promise.reject(value) : value;
  };
  fn.calls = calls;
  return fn;
}
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
async function mount(element) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => root.render(element));
  await flush();
  return { container, unmount: () => act(async () => root.unmount()) };
}
const click = (el) => act(async () => { el.dispatchEvent(new window.MouseEvent("click", { bubbles: true })); });
const text = (el) => el.textContent ?? "";
const button = (c, label) => [...c.querySelectorAll("button")].find((b) => text(b).includes(label) || b.getAttribute("aria-label")?.includes(label));
const links = (c) => [...c.querySelectorAll("a")].map((a) => [text(a), a.getAttribute("href")]);

async function setup(routes, props = {}) {
  const fetchImpl = fakeFetch(routes);
  const store = createAccountStore({ fetchImpl });
  const view = await mount(h(AccountSlot, { currentPath: "/about", store, ...props }));
  return { fetchImpl, store, ...view };
}

test("logged out: join link keeps the current path as ?next; loading shows a status placeholder first", async () => {
  assert.equal(entryHrefFor("/about"), "/entry?next=%2Fabout");
  assert.equal(entryHrefFor("/entry"), "/entry");
  assert.equal(entryHrefFor("//evil.example"), "/entry?next=%2F");
  let release;
  const gate = new Promise((r) => (release = r));
  const fetchImpl = async () => { await gate; return json({ view: "presence", loggedIn: false }); };
  const store = createAccountStore({ fetchImpl });
  const view = await mount(h(AccountSlot, { currentPath: "/about", store }));
  assert.ok(view.container.querySelector('[role="status"][aria-label="ログイン状態を確認中"]'));
  await act(async () => { release(); await new Promise((r) => setTimeout(r, 0)); });
  assert.deepEqual(links(view.container), [["参加する", "/entry?next=%2Fabout"]]);
  await view.unmount();
});

test("unavailable (503): retry control, no stale logged-in UI; retry succeeds", async () => {
  let n = 0;
  const { container, fetchImpl, unmount } = await setup({
    "/api/account/summary?view=presence": () => (n++ === 0 ? json({ view: "presence", loggedIn: false, unavailable: true }, 503) : json(presenceIn)),
  });
  const retry = button(container, "ログイン状態を再確認");
  assert.ok(retry);
  assert.equal(links(container).length, 0);
  await click(retry);
  await flush();
  assert.ok(links(container).some(([t]) => t === "投稿する"));
  assert.equal(fetchImpl.calls.length, 2);
  await unmount();
});

test("network failure and a non-ok status are unavailable too; request is no-store with the same-origin cookie", async () => {
  const { container, fetchImpl, unmount } = await setup({ "/api/account/summary?view=presence": () => new Error("offline") });
  assert.ok(button(container, "ログイン状態を再確認"));
  assert.equal(fetchImpl.calls[0].init.cache, "no-store");
  assert.equal(fetchImpl.calls[0].init.credentials, "same-origin");
  await unmount();
  const b = await setup({ "/api/account/summary?view=presence": () => json({}, 500) });
  assert.ok(button(b.container, "ログイン状態を再確認"));
  await b.unmount();
});

test("logged in: presence only until the menu opens; presence never shows management links", async () => {
  let release;
  const gate = new Promise((r) => (release = r));
  const { container, fetchImpl, unmount } = await setup({
    "/api/account/summary?view=presence": () => json(presenceIn),
    "/api/account/summary": async () => { await gate; return json(summary({ canAccessAdmin: true, canAccessManage: true })); },
  });
  assert.equal(fetchImpl.calls.length, 1, "details are not fetched before a menu is opened");
  assert.ok(links(container).some(([t, href]) => t === "投稿する" && href === "/entry"));
  const trigger = button(container, "アカウントメニューを開く");
  assert.equal(trigger.getAttribute("aria-expanded"), "false");
  await click(trigger);
  assert.equal(trigger.getAttribute("aria-expanded"), "true");
  assert.ok(text(container).includes("アカウント情報を確認中"));
  assert.ok(!links(container).some(([t]) => t === "運営" || t === "管理"), "management hidden while details load");
  await act(async () => { release(); await new Promise((r) => setTimeout(r, 0)); });
  assert.equal(fetchImpl.calls.length, 2);
  const hrefs = links(container).map(([, href]) => href);
  for (const href of ["/dashboard", "/dashboard/library", "/dashboard/settings", "/entry", "/manage", "/admin", "/user/otako"]) assert.ok(hrefs.includes(href), href);
  assert.ok(button(container, "ログアウト"));
  await unmount();
});

test("management links: manage-only and plain users", async () => {
  const manage = await setup({ "/api/account/summary?view=presence": json(presenceIn), "/api/account/summary": json(summary({ canAccessManage: true })) });
  await click(button(manage.container, "アカウントメニューを開く"));
  await flush();
  const hrefs = links(manage.container).map(([, href]) => href);
  assert.ok(hrefs.includes("/manage") && !hrefs.includes("/admin"));
  await manage.unmount();
  const plain = await setup({ "/api/account/summary?view=presence": json(presenceIn), "/api/account/summary": json(summary()) });
  await click(button(plain.container, "アカウントメニューを開く"));
  await flush();
  const plainHrefs = links(plain.container).map(([, href]) => href);
  assert.ok(!plainHrefs.includes("/manage") && !plainHrefs.includes("/admin"));
  await plain.unmount();
});

test("details unavailable shows the retry and recovers; a logged-out details answer drops the user", async () => {
  let n = 0;
  const a = await setup({
    "/api/account/summary?view=presence": json(presenceIn),
    "/api/account/summary": () => (n++ === 0 ? json({ loggedIn: false, unavailable: true }, 503) : json(summary())),
  });
  await click(button(a.container, "アカウントメニューを開く"));
  await flush();
  assert.ok(text(a.container).includes("アカウント情報を取得できません"));
  await click(button(a.container, "再試行"));
  await flush();
  assert.ok(!text(a.container).includes("アカウント情報を取得できません"));
  assert.ok(text(a.container).includes("別の X ID に切り替え"));
  await a.unmount();
  const b = await setup({ "/api/account/summary?view=presence": json(presenceIn), "/api/account/summary": json({ loggedIn: false }) });
  await click(button(b.container, "アカウントメニューを開く"));
  await flush();
  assert.deepEqual(links(b.container), [["参加する", "/entry?next=%2Fabout"]]);
  await b.unmount();
});

test("Escape and an outside mousedown close the menu", async () => {
  const v = await setup({ "/api/account/summary?view=presence": json(presenceIn), "/api/account/summary": json(summary()) });
  const trigger = button(v.container, "アカウントメニューを開く");
  await click(trigger);
  assert.ok(v.container.querySelector('[role="menu"]'));
  await act(async () => { window.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape" })); });
  assert.equal(v.container.querySelector('[role="menu"]'), null);
  await click(trigger);
  await act(async () => { document.body.dispatchEvent(new window.MouseEvent("mousedown", { bubbles: true })); });
  assert.equal(v.container.querySelector('[role="menu"]'), null);
  await v.unmount();
});

test("X ID states: pending / rejected active, no X ID, only pending, nothing selected", async () => {
  const states = [
    [[entry("p", "pending", true)], "承認待ち"],
    [[entry("r", "rejected", true)], "却下済み"],
    [[], "X ID未連携"],
    [[entry("p", "pending")], "X ID連携申請中"],
    [[entry("x", "rejected")], "承認済みX IDなし"],
    [[entry("a", "approved"), entry("b", "approved")], "Active X ID未選択"],
  ];
  for (const [xIds, expected] of states) {
    const v = await setup({ "/api/account/summary?view=presence": json(presenceIn), "/api/account/summary": json(summary({ xIds, activeXId: null })) });
    await click(button(v.container, "アカウントメニューを開く"));
    await flush();
    assert.ok(text(v.container).includes(expected), expected);
    await v.unmount();
  }
});

test("display name: the X name, but the account name for @handle-only names and degraded summaries", () => {
  assert.equal(resolveDisplayName("おたこ", entry("otako", "approved", true, "おたこX"), false), "おたこX");
  assert.equal(resolveDisplayName("おたこ", entry("otako", "approved", true, "@Otako"), false), "おたこ");
  assert.equal(resolveDisplayName("おたこ", entry("otako", "approved", true, "おたこX"), true), "おたこ");
  assert.equal(resolveDisplayName("  ", null, false), "guest");
});

test("switching: choices are disabled without a switch action; with one it follows the CURRENT event contract", async () => {
  const routes = { "/api/account/summary?view=presence": () => json(presenceIn), "/api/account/summary": () => json(summary()) };
  const off = await setup(routes);
  await click(button(off.container, "アカウントメニューを開く"));
  await flush();
  const choice = button(off.container, "セカンド");
  assert.ok(choice && choice.disabled);
  await off.unmount();

  const switched = [];
  const events = [];
  const onBefore = (e) => events.push(["before", e.detail]);
  const onChanged = (e) => events.push(["changed", e.detail]);
  window.addEventListener(ACTIVE_X_BEFORE_SWITCH_EVENT, onBefore);
  window.addEventListener(ACTIVE_X_CHANGED_EVENT, onChanged);
  const on = await setup(routes, { switchActiveX: async (id) => { switched.push(id); return { ok: true }; } });
  await click(button(on.container, "アカウントメニューを開く"));
  await flush();
  await click(button(on.container, "セカンド"));
  await flush();
  assert.deepEqual(switched, ["second"]);
  assert.deepEqual(events, [["before", { fromXId: "otako", toXId: "second" }], ["changed", { fromXId: "otako", toXId: "second" }]]);
  assert.equal(on.container.querySelector('[role="menu"]'), null, "menu closes after a switch");
  assert.equal(on.fetchImpl.calls.filter((c) => c.url === "/api/account/summary").length, 2, "details are fetched again after the change");
  await on.unmount();

  const failing = await setup(routes, { switchActiveX: async () => ({ ok: false, message: "失敗しました" }) });
  await click(button(failing.container, "アカウントメニューを開く"));
  await flush();
  await click(button(failing.container, "セカンド"));
  await flush();
  assert.ok(text(failing.container).includes("失敗しました"));
  assert.ok(failing.container.querySelector('[role="menu"]'), "stays open on failure");
  await failing.unmount();

  window.addEventListener(ACTIVE_X_BEFORE_SWITCH_EVENT, (e) => e.preventDefault(), { once: true });
  const cancelled = [];
  const prevented = await setup(routes, { switchActiveX: async (id) => { cancelled.push(id); return { ok: true }; } });
  await click(button(prevented.container, "アカウントメニューを開く"));
  await flush();
  await click(button(prevented.container, "セカンド"));
  await flush();
  assert.deepEqual(cancelled, [], "a cancelled before-event stops the switch");
  await prevented.unmount();
  window.removeEventListener(ACTIVE_X_BEFORE_SWITCH_EVENT, onBefore);
  window.removeEventListener(ACTIVE_X_CHANGED_EVENT, onChanged);
});

test("mobile slot: logged out CTA, loading details status, management links from the full summary only", async () => {
  const out = createAccountStore({ fetchImpl: fakeFetch({ "/api/account/summary?view=presence": json({ view: "presence", loggedIn: false }) }) });
  const a = await mount(h(MobileAccountSlot, { currentPath: "/list", store: out }));
  assert.deepEqual(links(a.container), [["参加する", "/entry?next=%2Flist"]]);
  await a.unmount();

  const fetchImpl = fakeFetch({ "/api/account/summary?view=presence": json(presenceIn), "/api/account/summary": json(summary({ canAccessAdmin: true, canAccessManage: true })) });
  const store = createAccountStore({ fetchImpl });
  const b = await mount(h(MobileAccountSlot, { store }));
  await flush();
  const hrefs = links(b.container).map(([, href]) => href);
  for (const href of ["/entry", "/dashboard", "/dashboard/library", "/dashboard/settings", "/manage", "/admin"]) assert.ok(hrefs.includes(href), href);
  assert.ok(text(b.container).includes("@otako"));
  assert.ok(button(b.container, "ログアウト"));
  await b.unmount();
});
