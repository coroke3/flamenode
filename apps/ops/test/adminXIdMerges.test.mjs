// MIG-0732 U02a: current Hono admin X ID merge reads and safe read-only presentation.
import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoot } from "react-dom/client";
import { JSDOM, VirtualConsole } from "jsdom";
import { createXIdMergesApi, xMergeReadPath } from "../.test-dist/apps/ops/src/api/xidMerges.js";
import { AdminXIdMerges, AdminXIdMergesContent } from "../.test-dist/apps/ops/src/routes/admin/AdminXIdMerges.js";
import { useApiResult } from "../.test-dist/apps/ops/src/routes/useApiResult.js";

const merge = {
  id: "mg1", request_type: "merge", status: "pending",
  source_x_user_id: "alice", target_x_user_id: "bob",
  parent_request_id: null, revert_deadline_at: null, updated_at: 1700000000,
  source_name: "Alice", target_name: "Bob", has_restore_snapshot: true,
  impact: [{ key: "videos", label: "作品投稿者", count: 2 }],
  preview: [{ id: "vid/1", title: "Demo", visibility_status: "public", primary_event_id: null,
    creator_change: 1, member_rows: 0, chapter_rows: 0, slot_rows: 0, interaction_rows: 0, moderation_rows: 0 }],
};
const revert = {
  id: "rv1", status: "pending", parent_request_id: "mg1",
  revert_deadline_at: 1600000000, has_restore_snapshot: true,
};
const requests = { view: "requests", selectedImpactId: "mg1", requests: [merge], reverts: [], now: 1700000000 };
const reverts = { view: "reverts", selectedImpactId: "", requests: [], reverts: [revert], now: 1700000000 };
const json = (status, data) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

test("U02a: authorized GET query, normalized view, no-store and strict expected view", async () => {
  const calls = [];
  const api = createXIdMergesApi(async (path, init) => {
    calls.push({ path, init });
    return json(200, path.includes("reverts") ? reverts : requests);
  });
  assert.equal((await api.get("requests", " mg1 ")).status, "ok");
  assert.equal((await api.get("reverts", "ignored")).status, "ok");
  assert.deepEqual(calls.map(x => x.path), [
    "/api/admin-read/x-id-merges?impact=mg1", "/api/admin-read/x-id-merges?view=reverts",
  ]);
  for (const call of calls) {
    assert.equal(call.init.method, "GET");
    assert.equal(call.init.credentials, "same-origin");
    assert.equal(call.init.cache, "no-store");
  }
  assert.equal(xMergeReadPath("requests", "a/b"), "/api/admin-read/x-id-merges?impact=a%2Fb");
});

test("U02a: reject malformed, mismatched, duplicate, excessive and inconsistent snapshots", async () => {
  const bad = [
    { ...requests, view: "reverts" },
    { ...requests, selectedImpactId: "other" },
    { ...requests, requests: [...requests.requests, { ...merge }] },
    { ...requests, requests: [{ ...merge, impact: [{ key: "v", label: "V", count: -1 }] }] },
    { ...requests, requests: [{ ...merge, preview: Array(52).fill(merge.preview[0]) }] },
    { ...requests, requests: [{ ...merge, has_restore_snapshot: "secret json" }] },
    { ...requests, requests: [{ ...merge, updated_at: Number.NaN }] },
    { ...requests, reverts: [revert] },
    { ...requests, requests: Array(51).fill(merge).map((r, i) => ({ ...r, id: "id" + i, impact: [], preview: [] })) },
  ];
  for (const value of bad) {
    const api = createXIdMergesApi(async () => json(200, value));
    assert.equal((await api.get("requests", "mg1")).status, "unavailable");
  }
  for (const status of [401, 403, 503]) {
    const api = createXIdMergesApi(async () => json(status, { redirect: "/dashboard" }));
    assert.notEqual((await api.get("requests", "mg1")).status, "ok");
  }
  // An unknown selected id is legitimate when its row has fallen out of the bounded list.
  const notFoundInList = { ...requests, requests: [{ ...merge, id: "other", impact: [], preview: [] }] };
  assert.equal((await createXIdMergesApi(async () => json(200, notFoundInList)).get("requests", "mg1")).status, "ok");
  const inconsistent = { ...requests, requests: [{ ...merge, id: "other" }] };
  assert.equal((await createXIdMergesApi(async () => json(200, inconsistent)).get("requests", "mg1")).status, "unavailable");
});

test("U02a: SSR tables show bounded impact preview but never expose restore JSON or enable mutations", () => {
  const html = renderToStaticMarkup(React.createElement(MemoryRouter, null,
    React.createElement(AdminXIdMergesContent, { data: requests })));
  assert.match(html, /X ID統合管理/);
  assert.match(html, /統合前の確認/);
  assert.match(html, /作品投稿者/);
  assert.match(html, /vid%2F1/);
  assert.match(html, />vid\/1<\/div>/);
  assert.match(html, /統合元: 無効化/);
  assert.match(html, /統合先: 継続利用/);
  assert.match(html, /管理API移行完了後に有効化/);
  assert.doesNotMatch(html, /name="confirm"/);
  assert.doesNotMatch(html, /restore_snapshot_json/);

  const back = renderToStaticMarkup(React.createElement(MemoryRouter, null,
    React.createElement(AdminXIdMergesContent, { data: reverts })));
  assert.match(back, /差し戻し申請/);
  assert.match(back, /期限切れ/);
  assert.match(back, /復元情報あり/);
  assert.doesNotMatch(back, /restore_snapshot_json/);
});

test("U02a: selected impact preserves CURRENT table detail, zero counts, work IDs and 50-row truncation", () => {
  const selected = {
    ...merge,
    impact: [
      { key: "videos.creator_x_user_id", label: "作品投稿者", count: 2 },
      { key: "event_staff.x_user_id", label: "イベントスタッフ", count: 0 },
      { key: "slots.x_user_id", label: "予約枠", count: 3 },
    ],
    preview: Array.from({ length: 51 }, (_, i) => ({
      ...merge.preview[0], id: "work-" + i, title: "Work title " + i,
    })),
  };
  const render = (row) => renderToStaticMarkup(React.createElement(MemoryRouter, null,
    React.createElement(AdminXIdMergesContent, { data: { ...requests, requests: [row] } })));
  const html = render(selected);
  assert.match(html, /<details><summary>5 行 \/ 作品投稿者: 2 \/ 予約枠: 3<\/summary>/);
  assert.match(html, /<code>videos\.creator_x_user_id<\/code>: 2/);
  assert.match(html, /<code>event_staff\.x_user_id<\/code>: 0/);
  assert.match(html, /<code>slots\.x_user_id<\/code>: 3/);
  assert.match(html, /作品一覧: 50\+件/);
  assert.match(html, /<a[^>]+href="\/admin\/videos\/work-49"[^>]*>Work title 49<\/a>/);
  assert.match(html, />work-49<\/div>/);
  assert.doesNotMatch(html, /work-50|Work title 50/);
  assert.match(html, /作品一覧は先頭50件まで表示しています/);
  assert.doesNotMatch(html, /name="confirm"|restore_snapshot_json/);
  const zero = render({ ...selected, impact: [{ key: "event_staff.x_user_id", label: "イベントスタッフ", count: 0 }], preview: [] });
  assert.match(zero, /<summary>0 行 \/ 影響行はありません。<\/summary>/);
  assert.match(zero, /<code>event_staff\.x_user_id<\/code>: 0/);
  assert.match(zero, /作品への直接参照はありません/);
});

test("MIG-0732 U02a: explicit authorization loss clears mounted X merge data on refresh and navigation", async () => {
  const privateLabel = "PRIVATE_MERGE_PREVIEW";
  const privateSnapshot = {
    ...requests,
    requests: [{
      ...merge, source_name: privateLabel,
      preview: [{ ...merge.preview[0], title: privateLabel + "_VIDEO" }],
    }],
  };
  // JSDOM does not implement full-document location.assign; the route still
  // receives the real forbidden response. Test data disappearance, not a
  // successful browser redirect.
  const virtualConsole = new VirtualConsole();
  const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", {
    url: "https://flamenode.test/admin/x-id-merges?impact=mg1", virtualConsole,
  });
  // TableScroll uses the native browser ResizeObserver. JSDOM has no layout
  // engine, so provide the observer lifecycle without faking any layout result.
  const observedTables = new Set();
  class TestResizeObserver {
    elements = new Set();
    observe(element) { this.elements.add(element); observedTables.add(element); }
    unobserve(element) { this.elements.delete(element); observedTables.delete(element); }
    disconnect() { for (const element of this.elements) observedTables.delete(element); this.elements.clear(); }
  }
  const globals = {
    window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement, Element: dom.window.Element, Node: dom.window.Node,
    ResizeObserver: TestResizeObserver,
    IS_REACT_ACT_ENVIRONMENT: true, fetch: globalThis.fetch,
  };
  const original = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  // React.act can report an AggregateError with an empty top-level message.
  // Keep underlying failures visible in Node's CI TAP output.
  async function actWithDiagnostics(callback) {
    try { await React.act(callback); }
    catch (error) {
      if (error instanceof AggregateError) {
        throw new Error(error.errors.map(item => item?.stack ?? String(item)).join("\n"), { cause: error });
      }
      throw error;
    }
  }
  let root;
  try {
    for (const [key, value] of Object.entries(globals)) {
      Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    }
    const target = document.getElementById("root");
    root = createRoot(target);
    let response;
    const refreshCalls = [];
    const api = createXIdMergesApi(async (path, init) => {
      refreshCalls.push({ path, method: init.method, cache: init.cache });
      return response();
    });
    const read = signal => api.get("requests", "mg1", signal);
    // The production read-only screen does not expose a successful-state
    // refresh control. Exercise its actual loader and hook through an
    // isolated mounted harness rather than adding a production trigger.
    function RefreshHarness({ refreshKey }) {
      const result = useApiResult(read, xMergeReadPath("requests", "mg1"), refreshKey);
      return result.status === "ok"
        ? React.createElement(AdminXIdMergesContent, { data: result.data })
        : React.createElement("p", { role: "status" }, result.status);
    }
    for (const [code, expected] of [[401, "anonymous"], [403, "forbidden"], [404, "notFound"]]) {
      const render = async refreshKey => {
        await actWithDiagnostics(async () => {
          root.render(React.createElement(MemoryRouter, { key: code },
            React.createElement(RefreshHarness, { refreshKey })));
        });
      };
      response = () => json(200, privateSnapshot);
      await render(0);
      assert.match(target.textContent, /PRIVATE_MERGE_PREVIEW_VIDEO/);
      assert.ok(observedTables.size > 0, "mounted merge tables register scroll observers");
      response = () => json(503, {});
      await render(1);
      // Existing shared hook policy retains same-key data on transient 503.
      // This observation is not acceptance of that policy for this screen.
      assert.match(target.textContent, /PRIVATE_MERGE_PREVIEW_VIDEO/);
      response = () => code === 403 ? new Response("invalid-json", { status: 403 }) : json(code, {});
      await render(2);
      assert.equal(target.textContent, expected);
      assert.doesNotMatch(target.textContent, /PRIVATE_MERGE_PREVIEW|vid\/1|@alice/);
    }
    assert.equal(refreshCalls.length, 9);
    assert.ok(refreshCalls.every(call => call.path === "/api/admin-read/x-id-merges?impact=mg1"
      && call.method === "GET" && call.cache === "no-store"));

    // Mount the actual route and follow its actual view link. A new query
    // key must hide the old authorized snapshot before the new GET settles.
    const routeCalls = [];
    let resolveDenied;
    globalThis.fetch = (path, init) => {
      routeCalls.push({ path, method: init.method, signal: init.signal });
      return routeCalls.length === 1
        ? Promise.resolve(json(200, privateSnapshot))
        : new Promise(resolve => { resolveDenied = resolve; });
    };
    await actWithDiagnostics(async () => {
      root.render(React.createElement(MemoryRouter, {
        key: "actual-route", initialEntries: ["/admin/x-id-merges?impact=mg1"],
      }, React.createElement(AdminXIdMerges)));
    });
    assert.match(target.textContent, /PRIVATE_MERGE_PREVIEW_VIDEO/);
    const link = target.querySelector('a[href="/admin/x-id-merges?view=reverts"]');
    assert.ok(link);
    await actWithDiagnostics(async () => {
      link.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
    });
    assert.equal(routeCalls.length, 2);
    assert.equal(routeCalls[0].signal.aborted, true);
    assert.deepEqual(routeCalls.map(({ path, method }) => [path, method]), [
      ["/api/admin-read/x-id-merges?impact=mg1", "GET"],
      ["/api/admin-read/x-id-merges?view=reverts", "GET"],
    ]);
    assert.doesNotMatch(target.textContent, /PRIVATE_MERGE_PREVIEW|vid\/1|@alice/);
    assert.match(target.textContent, /読み込み中/);
    assert.equal(typeof resolveDenied, "function");
    await actWithDiagnostics(async () => {
      resolveDenied(new Response("invalid-json", { status: 403 }));
    });
    assert.doesNotMatch(target.textContent, /PRIVATE_MERGE_PREVIEW|vid\/1|@alice/);
    assert.equal(target.querySelector("table"), null);
    assert.match(target.textContent, /読み込み中/);
  } finally {
    try {
      if (root) await actWithDiagnostics(async () => { root.unmount(); });
      assert.equal(observedTables.size, 0, "unmount disconnects all table observers");
    } finally {
      dom.window.close();
      for (const [key, descriptor] of original) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else delete globalThis[key];
      }
    }
  }
});
