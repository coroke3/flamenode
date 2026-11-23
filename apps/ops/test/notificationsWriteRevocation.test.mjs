import test from "node:test";
import assert from "node:assert/strict";
import * as React from "react";
import { JSDOM } from "jsdom";
import { MemoryRouter } from "react-router-dom";
import { createAdminNotificationsApi } from "../.test-dist/apps/ops/src/api/adminNotifications.js";
import { AdminNotifications } from "../.test-dist/apps/ops/src/routes/admin/AdminNotifications.js";

const response = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const privateRow = {
  id: "n1", type: "x_id_approved", status: "failed",
  payload_json: JSON.stringify({ content: "PRIVATE_NOTIFICATION_BODY" }),
  event_id: "ev-public", recipient_user_id: "u1", attempt_count: 4,
  next_attempt_at: null, created_at: 1700000000, last_error: "failed", dedupe_key: "key-1",
  recipient: { userId: "u1", discordId: "id-1", userName: "PRIVATE_RECIPIENT", notificationsEnabled: false },
};
const listing = {
  status: "all", category: "all", truncated: false, error: null, rows: [privateRow],
  counts: { pending: 0, processing: 0, failed: 1, deadLetter: 1, unhealthyLease: 0 },
};

async function mounted(run) {
  const dom = new JSDOM("<!doctype html><div id='root'></div>", {
    url: "https://flamenode.test/admin/notifications",
  });
  const keys = ["window", "document", "Node", "Element", "HTMLElement",
    "navigator", "FormData", "ResizeObserver"];
  const prior = new Map(keys.map(k => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
  const act = globalThis.IS_REACT_ACT_ENVIRONMENT;
  for (const key of keys) {
    Object.defineProperty(globalThis, key, {
      configurable: true, writable: true,
      value: key === "ResizeObserver" ? class { observe() {} unobserve() {} disconnect() {} } : dom.window[key],
    });
  }
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const { createRoot } = await import("react-dom/client");
  const root = createRoot(dom.window.document.getElementById("root"));
  try { await run(dom, root); }
  finally {
    await React.act(async () => root.unmount());
    for (const [k, d] of prior) {
      if (d) Object.defineProperty(globalThis, k, d);
      else delete globalThis[k];
    }
    globalThis.IS_REACT_ACT_ENVIRONMENT = act;
    dom.window.close();
  }
}
const button = (dom, value) => [...dom.window.document.querySelectorAll("button")]
  .find(el => el.textContent === value);
const shown = dom => dom.window.document.body.textContent.includes("PRIVATE_RECIPIENT");
const render = async (root, api, routes) => React.act(async () =>
  root.render(React.createElement(MemoryRouter, { initialEntries: ["/admin/notifications"] },
    React.createElement(AdminNotifications, { api, onNavigate: route => routes.push(route) }))));

test("SEC-816: four notification actions distinguish 403 identity loss from guard errors and 503", async () => {
  const calls = [];
  const api = createAdminNotificationsApi(async (path, init) => {
    calls.push({ path, init });
    return response(403, { ok: false, reason: "forbidden", message: "権限がありません" });
  });
  const rejected = [
    await api.retry("n1"), await api.cancel("n1", "audit"),
    await api.forceResend("n1"), await api.retryFailed(),
  ];
  for (const result of rejected) {
    assert.deepEqual(result, { ok: false, forbidden: true, message: "権限がありません" });
  }
  assert.deepEqual(calls.map(x => x.path), [
    "/api/admin/notifications/n1/retry", "/api/admin/notifications/n1/cancel",
    "/api/admin/notifications/n1/force-resend", "/api/admin/notifications/retry-failed",
  ]);
  for (const c of calls) {
    assert.equal(c.init.credentials, "same-origin");
    assert.equal(c.init.cache, "no-store");
  }
  for (const reason of ["maintenance_mode", "invalid_origin", "cost_guard_blocked"]) {
    const guarded = createAdminNotificationsApi(async () =>
      response(403, { ok: false, reason, message: reason }));
    assert.deepEqual(await guarded.retry("n1"), { ok: false, message: reason });
  }
  const nonRole = createAdminNotificationsApi(async () =>
    response(503, { ok: false, reason: "forbidden", message: "backend failed" }));
  const result = await nonRole.retry("n1");
  assert.equal(result.forbidden, undefined, "only an actual 403 confirms forbidden role");
  assert.equal(result.message, "backend failed");
  const anonymous = createAdminNotificationsApi(async () =>
    response(401, { ok: false, reason: "forbidden" }));
  assert.deepEqual(await anonymous.retry("n1"), {
    ok: false, message: "ログインしてください。", anonymous: true,
  });
});

test("SEC-816: resolved 403 denies and unmounts private notifications and all write actions", async () => {
  await mounted(async (dom, root) => {
    let writes = 0;
    const routes = [];
    const api = {
      ...createAdminNotificationsApi(async () => {
        writes++;
        return response(403, { ok: false, reason: "forbidden", message: "denied" });
      }),
      list: async () => ({ status: "ok", data: listing }),
    };
    await render(root, api, routes);
    assert.equal(shown(dom), true);
    const action = button(dom, "再試行");
    assert.ok(action, "real row action visible after initial GET");
    await React.act(async () => action.click());
    assert.deepEqual(routes, ["/dashboard"]);
    assert.equal(shown(dom), false);
    assert.equal(button(dom, "再試行"), undefined);
    assert.equal(button(dom, "強制再送"), undefined);
    assert.equal(button(dom, "キャンセル"), undefined);
    assert.equal(writes, 1);
    await React.act(async () => action.click());
    assert.equal(writes, 1);
    assert.deepEqual(routes, ["/dashboard"]);
  });
});

test("SEC-816: 401 navigates /entry; legitimate maintenance 403 leaves the UI available", async () => {
  for (const [code, body, expected] of [
    [401, { ok: false, reason: "forbidden" }, "/entry"],
    [403, { ok: false, reason: "maintenance_mode", message: "メンテナンス中です" }, null],
  ]) {
    await mounted(async (dom, root) => {
      const routes = [];
      const api = {
        ...createAdminNotificationsApi(async () => response(code, body)),
        list: async () => ({ status: "ok", data: listing }),
      };
      await render(root, api, routes);
      await React.act(async () => button(dom, "再試行").click());
      assert.deepEqual(routes, expected ? [expected] : []);
      assert.equal(shown(dom), expected === null);
      if (!expected) assert.match(dom.window.document.body.textContent, /メンテナンス中です/);
    });
  }
});

test("SEC-816: stalled 403 body removes payloads, rechecks access, and only fresh 200 restores", async () => {
  await mounted(async (dom, root) => {
    const routes = [];
    let release;
    let reads = 0;
    const latestRead = new Promise(resolve => { release = resolve; });
    const api = {
      ...createAdminNotificationsApi(async () => ({
        status: 403, ok: false, json: () => new Promise(() => {}),
      })),
      list: async () => {
        reads++;
        return reads === 1 ? { status: "ok", data: listing } : latestRead;
      },
    };
    await render(root, api, routes);
    assert.equal(shown(dom), true);
    await React.act(async () => {
      button(dom, "再試行").click();
      await new Promise(resolve => setTimeout(resolve, 320));
    });
    assert.equal(reads, 2, "unknown 403 must issue a new authoritative GET");
    assert.equal(shown(dom), false, "stalled body cannot leave payloads mounted");
    assert.equal(button(dom, "再試行"), undefined);
    assert.deepEqual(routes, []);
    await React.act(async () => release({ status: "ok", data: listing }));
    assert.equal(shown(dom), true, "only a fresh authenticated 200 re-enables payloads");
  });
});

test("SEC-816: stalled 403 revalidation forbidden never restores delayed private content", async () => {
  await mounted(async (dom, root) => {
    const routes = [];
    let reads = 0;
    const api = {
      ...createAdminNotificationsApi(async () => ({
        status: 403, ok: false, json: () => new Promise(() => {}),
      })),
      list: async () => {
        reads++;
        return reads === 1 ? { status: "ok", data: listing } : { status: "forbidden" };
      },
    };
    await render(root, api, routes);
    await React.act(async () => {
      button(dom, "再試行").click();
      await new Promise(resolve => setTimeout(resolve, 320));
    });
    assert.deepEqual(routes, ["/dashboard"]);
    assert.equal(shown(dom), false);
    assert.equal(button(dom, "強制再送"), undefined);
  });
});
