// MIG-0515 SA-098: Astro public header's Active X HTTP client + guards.
import assert from "node:assert/strict";
import { test } from "node:test";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "https://flamenode.net/list?sort=new",
});
Object.defineProperty(globalThis, "window", { configurable: true, value: dom.window });
Object.defineProperty(globalThis, "document", { configurable: true, value: dom.window.document });

const React = (await import("react")).default;
const { renderToStaticMarkup } = await import("react-dom/server");
const { switchActiveX } = await import("../apps/site/src/lib/activeX.ts");
const { getGuardRedirectPath, shouldShowGuardErrorOnly } = await import("../apps/site/src/lib/guardRedirect.ts");
const { SiteHeader } = await import("../apps/site/src/components/SiteHeader.ts");

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}
function fakeFetch(response) {
  const calls = [];
  const fetcher = async (url, init) => {
    calls.push({ url, init });
    if (response instanceof Error) throw response;
    return response;
  };
  fetcher.calls = calls;
  return fetcher;
}

test("T01: switch success uses D-16-1 JSON key, same-origin credentials and no-store", async () => {
  const fetcher = fakeFetch(json({ ok: true, message: "アクティブ X ID を切り替えました。" }));
  const result = await switchActiveX("second", fetcher, () => assert.fail("no redirect"));
  assert.deepEqual(result, { ok: true, message: "アクティブ X ID を切り替えました。" });
  assert.equal(fetcher.calls.length, 1);
  const { url, init } = fetcher.calls[0];
  assert.equal(url, "/api/xid/active");
  assert.equal(init.method, "POST");
  assert.equal(init.credentials, "same-origin");
  assert.equal(init.cache, "no-store");
  assert.equal(init.headers.Accept, "application/json");
  assert.equal(init.headers["Content-Type"], "application/json");
  assert.deepEqual(JSON.parse(init.body), { x_user_id: "second" });
});

test("T02: failure preserves CURRENT message, including already-active error from API", async () => {
  const special = "すでにこの X ID がアクティブです。";
  const fetcher = fakeFetch(json({ ok: false, message: special }, 409));
  const result = await switchActiveX("second", fetcher, () => assert.fail("no redirect"));
  assert.deepEqual(result, { ok: false, message: special });
  const forbidden = await switchActiveX("second", fakeFetch(json({ ok: false, message: "承認済みの X ID だけをアクティブにできます。" }, 403)), () => assert.fail("no redirect"));
  assert.equal(forbidden.ok, false);
  assert.match(forbidden.message, /承認済み/);
});

test("T02: authentication and onboarding guards use sanitized same-origin next URL", async () => {
  const destinations = [];
  const navigate = (path) => destinations.push(path);
  const login = await switchActiveX("second", fakeFetch(new Response("unauthorized", { status: 401 })), navigate);
  assert.equal(login.ok, false);
  assert.equal(login.reason, "unauthenticated");
  assert.deepEqual(destinations, ["/entry?next=%2Flist%3Fsort%3Dnew"]);

  const terms = await switchActiveX("second", fakeFetch(json({ ok: false, reason: "tos_required", message: "同意が必要です" }, 403)), navigate);
  assert.equal(terms.message, "同意が必要です");
  assert.deepEqual(destinations, [
    "/entry?next=%2Flist%3Fsort%3Dnew",
    "/onboarding?next=%2Flist%3Fsort%3Dnew",
  ]);
  assert.equal(getGuardRedirectPath("unauthenticated", "//evil.example/phish"), "/entry?next=%2F");
  assert.equal(shouldShowGuardErrorOnly("banned"), true);
  assert.equal(shouldShowGuardErrorOnly("db_unavailable"), true);
  assert.equal(shouldShowGuardErrorOnly("invalid_origin"), false);
});

test("T02: network errors, non-JSON and invalid responses cannot be mistaken for success", async () => {
  for (const response of [
    new Error("offline"),
    new Response("<html>not json</html>", { status: 502 }),
    json({ ok: "true" }),
    json({ ok: true }, 500),
  ]) {
    const result = await switchActiveX("second", fakeFetch(response), () => assert.fail("no redirect"));
    assert.equal(result.ok, false);
    assert.equal(result.message, "X ID の切り替えに失敗しました。");
  }
});

test("T03: SSR retains header structure without a no-JS Active X switch button", () => {
  const html = renderToStaticMarkup(React.createElement(SiteHeader, { currentPath: "/list" }));
  assert.match(html, /header|hd-/);
  assert.doesNotMatch(html, /別の X ID に切り替え/);
  assert.doesNotMatch(html, /x_user_id/);
});
