import test from "node:test";
import assert from "node:assert/strict";
import * as React from "react";
import { JSDOM } from "jsdom";
import { createRoot } from "react-dom/client";
import { createAdminCostGuardApi } from "../.test-dist/apps/ops/src/api/adminCostGuard.js";
import { AdminCostGuard } from "../.test-dist/apps/ops/src/routes/admin/AdminCostGuard.js";

const response = (status, data) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
const settings = {
  mode: "normal", isMaintenance: false, reason: "管理者による確認",
  updatedAt: 1, exceptionUntil: null, exceptionFeaturesJson: null,
  disabledFeaturesJson: null, truncated: false,
  history: [{ id: "audit-1", created_at: 1, actor_user_id: "PRIVATE_AUDIT_ACTOR",
    target_id: "default", before_json: '{"mode":"normal"}', after_json: '{"mode":"economy"}' }],
};

async function mounted(run) {
  const dom = new JSDOM("<!doctype html><div id='root'></div>", {
    url: "https://flamenode.test/admin/cost-guard",
  });
  const keys = ["window", "document", "Node", "Element", "HTMLElement", "navigator"];
  const prior = new Map(keys.map(k => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
  const previousAct = globalThis.IS_REACT_ACT_ENVIRONMENT;
  for (const key of keys) {
    Object.defineProperty(globalThis, key, {
      configurable: true, writable: true, value: dom.window[key],
    });
  }
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const root = createRoot(dom.window.document.getElementById("root"));
  try {
    await run(dom, root);
  } finally {
    await React.act(async () => root.unmount());
    for (const [key, descriptor] of prior) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
    globalThis.IS_REACT_ACT_ENVIRONMENT = previousAct;
    dom.window.close();
  }
}
const button = (dom, name) =>
  [...dom.window.document.querySelectorAll("button")].find(el => el.textContent === name);
const clickMode = async (dom) => {
  const el = button(dom, "モードを更新");
  assert.ok(el, "authorized Cost Guard mode action should be mounted");
  await React.act(async () => el.click());
};

test("SEC-814: only confirmed identity denials revoke; ordinary 403 guard messages retain parity", async () => {
  for (const reason of ["forbidden", "banned"]) {
    const api = createAdminCostGuardApi(async () =>
      response(403, { ok: false, reason, message: "管理権限がありません。" }));
    const result = await api.setMode("normal", "audit");
    assert.deepEqual(result, { ok: false, forbidden: true, message: "管理権限がありません。" });
  }
  for (const reason of ["maintenance_mode", "cost_guard_blocked", "invalid_origin", "tos_required"]) {
    const api = createAdminCostGuardApi(async () =>
      response(403, { ok: false, reason, message: reason }));
    assert.deepEqual(await api.setMode("normal", "audit"), { ok: false, message: reason });
  }
  const conflicted = createAdminCostGuardApi(async () => response(409, { ok: false, message: "設定が競合しています" }));
  assert.deepEqual(await conflicted.setMode("normal", "audit"), { ok: false, message: "設定が競合しています" });
  const anonymous = createAdminCostGuardApi(async () => response(401, { ok: false, reason: "forbidden" }));
  assert.deepEqual(await anonymous.setMode("normal", "audit"),
    { ok: false, anonymous: true, message: "ログインしてください。" }, "HTTP 401 takes priority over 403-shaped data");
});

test("SEC-814: POST 403 forbidden immediately hides private Cost Guard data and every action", async () => {
  await mounted(async (dom, root) => {
    let writes = 0;
    let reads = 0;
    const routes = [];
    const api = {
      ...createAdminCostGuardApi(async (path) => {
        assert.equal(path, "/api/admin/cost-guard/mode");
        writes++;
        return response(403, { ok: false, reason: "forbidden", message: "denied" });
      }),
      read: async () => { reads++; return { status: "ok", data: settings }; },
    };
    await React.act(async () => root.render(React.createElement(AdminCostGuard, {
      api, onNavigate: (path) => routes.push(path),
    })));
    assert.match(dom.window.document.body.textContent, /PRIVATE_AUDIT_ACTOR/);
    const staleButton = button(dom, "モードを更新");
    await clickMode(dom);
    assert.deepEqual(routes, ["/dashboard"]);
    assert.equal(writes, 1);
    assert.equal(reads, 1, "denied write must not refresh the private read");
    assert.doesNotMatch(dom.window.document.body.textContent, /PRIVATE_AUDIT_ACTOR|mode: normal|変更履歴/);
    for (const name of ["モードを更新", "ONにする", "15分有効化", "即時解除", "無効化設定を保存"]) {
      assert.equal(button(dom, name), undefined, name + " must be unmounted");
    }
    // A retained DOM reference must not start another privileged POST after unmount.
    await React.act(async () => staleButton.click());
    assert.equal(writes, 1);
    assert.deepEqual(routes, ["/dashboard"]);
  });
});

test("SEC-814: POST 401 clears the Cost Guard page and chooses fixed /entry", async () => {
  await mounted(async (dom, root) => {
    const routes = [];
    const api = {
      ...createAdminCostGuardApi(async () => response(401, { ok: false, reason: "forbidden" })),
      read: async () => ({ status: "ok", data: settings }),
    };
    await React.act(async () => root.render(React.createElement(AdminCostGuard, {
      api, onNavigate: (path) => routes.push(path),
    })));
    await clickMode(dom);
    assert.deepEqual(routes, ["/entry"], "the page must navigate once; individual forms must not navigate again");
    assert.doesNotMatch(dom.window.document.body.textContent, /PRIVATE_AUDIT_ACTOR|変更履歴/);
  });
});

test("SEC-814: maintenance_mode 403 stays an inline error; settings and controls remain visible", async () => {
  await mounted(async (dom, root) => {
    const routes = [];
    const api = {
      ...createAdminCostGuardApi(async () =>
        response(403, { ok: false, reason: "maintenance_mode", message: "メンテナンス中です。" })),
      read: async () => ({ status: "ok", data: settings }),
    };
    await React.act(async () => root.render(React.createElement(AdminCostGuard, {
      api, onNavigate: (path) => routes.push(path),
    })));
    await clickMode(dom);
    assert.deepEqual(routes, []);
    assert.ok(button(dom, "モードを更新"));
    assert.match(dom.window.document.body.textContent, /PRIVATE_AUDIT_ACTOR/);
    assert.match(dom.window.document.body.textContent, /メンテナンス中です。/);
  });
});

test("SEC-814: an already-started successful POST cannot republish after a second write revokes access", async () => {
  await mounted(async (dom, root) => {
    let resolveMode;
    let modeCalls = 0, overrideCalls = 0;
    const routes = [];
    const api = {
      ...createAdminCostGuardApi(async () => response(200, { ok: true })),
      read: async () => ({ status: "ok", data: settings }),
      setMode: async () => {
        modeCalls++;
        return new Promise(resolve => { resolveMode = resolve; });
      },
      clearOverride: async () => {
        overrideCalls++;
        return { ok: false, forbidden: true, message: "管理権限がありません。" };
      },
    };
    await React.act(async () => root.render(React.createElement(AdminCostGuard, {
      api, onNavigate: (path) => routes.push(path),
    })));
    const modeButton = button(dom, "モードを更新");
    // Begin a mutation, but hold its result while the sibling form denies access.
    await React.act(async () => modeButton.click());
    assert.equal(modeCalls, 1);
    // The clear button requires the same explicit audited confirmation as CURRENT.
    // A separate fake user intention can be modeled by the actual mounted form via its controls.
    const confirm = dom.window.document.querySelector('input[aria-label="確認文字列"]');
    const reason = dom.window.document.querySelector('input[aria-label="override理由"]');
    const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value").set;
    await React.act(async () => {
      setter.call(reason, "security review"); reason.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
      setter.call(confirm, "CLEAR"); confirm.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    });
    const clear = button(dom, "即時解除");
    assert.ok(clear);
    await React.act(async () => clear.click());
    assert.equal(overrideCalls, 1);
    assert.deepEqual(routes, ["/dashboard"]);
    await React.act(async () => resolveMode({ ok: true, message: "遅延成功" }));
    assert.equal(modeCalls, 1);
    assert.doesNotMatch(dom.window.document.body.textContent, /PRIVATE_AUDIT_ACTOR|遅延成功|変更履歴/);
    assert.deepEqual(routes, ["/dashboard"]);
  });
});
