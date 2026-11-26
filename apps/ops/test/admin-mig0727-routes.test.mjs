import assert from "node:assert/strict";
import test from "node:test";
import * as React from "react";
import { createRoot } from "react-dom/client";
import { JSDOM } from "jsdom";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { OpsRoutes } from "../.test-dist/apps/ops/src/routes/router.js";
import { AdminApiEndpointsPage } from "../.test-dist/apps/ops/src/routes/admin/AdminApiEndpoints.js";
import { AnnouncementCreatePage, AnnouncementEditPage } from "../.test-dist/apps/ops/src/routes/admin/AnnouncementEditor.js";
import { AdminRuleEditPage } from "../.test-dist/apps/ops/src/routes/admin/TermsEditor.js";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "https://flamenode.test/admin",
});
for (const key of [
  "window", "document", "navigator", "Element", "HTMLElement",
  "HTMLInputElement", "HTMLSelectElement", "Node", "FormData", "Event", "MouseEvent",
]) {
  Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key] });
}
const raf = (cb) => setTimeout(cb, 0);
const caf = (id) => clearTimeout(id);
dom.window.requestAnimationFrame = raf;
dom.window.cancelAnimationFrame = caf;
globalThis.requestAnimationFrame = raf;
globalThis.cancelAnimationFrame = caf;
dom.window.matchMedia = () => ({
  matches: false,
  media: "",
  onchange: null,
  addEventListener() {},
  removeEventListener() {},
  addListener() {},
  removeListener() {},
  dispatchEvent() { return false; },
});
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const json = (status, body) => new Response(JSON.stringify(body), {
  status,
  headers: { "content-type": "application/json" },
});

async function mount(element) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await React.act(async () => root.render(element));
  return {
    container,
    async close() {
      await React.act(async () => root.unmount());
      container.remove();
    },
  };
}

function LocationProbe() {
  const loc = useLocation();
  return React.createElement("output", { "data-testid": "loc" }, loc.pathname + loc.search);
}

test("MIG-0727 U04: OpsRoutes mounts all 7 admin routes behind OpsGate and blocks non-admin", async () => {
  const routes = [
    "/admin/announcements",
    "/admin/announcements/new",
    "/admin/announcements/anc1/edit",
    "/admin/api-endpoints",
    "/admin/rules",
    "/admin/rules/new",
    "/admin/rules/tv1/edit",
  ];
  const assigned = [];
  const winProxy = new Proxy(dom.window, {
    get(target, prop) {
      if (prop === "location") {
        return { assign: (url) => assigned.push(url), href: target.location.href, origin: target.location.origin };
      }
      const val = Reflect.get(target, prop);
      return typeof val === "function" ? val.bind(target) : val;
    },
  });
  Object.defineProperty(globalThis, "window", { configurable: true, value: winProxy });
  try {
    for (const route of routes) {
      assigned.length = 0;
      const nonAdminApi = {
        getSummary: async () => ({
          status: "ok",
          summary: { loggedIn: true, role: "moderator", canAccessAdmin: false, canAccessManage: true },
        }),
        checkManageNavigation: async () => "allow",
      };
      const ui = await mount(
        React.createElement(MemoryRouter, { initialEntries: [route] },
          React.createElement(OpsRoutes, { api: nonAdminApi })),
      );
      try {
        assert.deepEqual(assigned, ["/dashboard"], `${route} must redirect non-admin`);
        assert.doesNotMatch(ui.container.textContent, /お知らせ管理|新規お知らせ|作品情報出力API|規約管理|新規利用規約バージョン/);
      } finally {
        await ui.close();
      }
    }
  } finally {
    Object.defineProperty(globalThis, "window", { configurable: true, value: dom.window });
  }
});

test("MIG-0727 U04: OpsRoutes renders each of the 7 routes when admin gate allows", async () => {
  const expectedByPath = [
    ["/admin/announcements", /お知らせ管理/],
    ["/admin/announcements/new", /新規お知らせ/],
    ["/admin/announcements/anc1/edit", /お知らせを取得できませんでした|読み込み中/],
    ["/admin/api-endpoints", /作品情報出力API|API設定を取得できませんでした|読み込み中/],
    ["/admin/rules", /規約管理|規約を取得できませんでした|読み込み中/],
    ["/admin/rules/new", /新規利用規約バージョン/],
    ["/admin/rules/tv1/edit", /規約を取得できませんでした|読み込み中/],
  ];
  const adminApi = {
    getSummary: async () => ({
      status: "ok",
      summary: { loggedIn: true, role: "admin", canAccessAdmin: true, canAccessManage: true },
    }),
    checkManageNavigation: async () => "allow",
  };
  const origFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).includes("/api/admin-read/cost-guard-banner")) {
      return json(200, { mode: "normal", reason: null });
    }
    if (String(url).startsWith("/api/admin-read/announcements?")) {
      return json(200, { audience: "any", status: "any", items: [] });
    }
    if (String(url).startsWith("/api/admin-read/rules?")) {
      return json(200, {
        status: "any", items: [], currentPublished: null,
        reacceptRequiredCount: 0, reacceptCountIsLowerBound: false,
      });
    }
    if (String(url) === "/api/admin-read/api-endpoints") {
      return json(200, { rows: [], eventOptions: [] });
    }
    return json(500, {});
  };
  try {
    for (const [path, pattern] of expectedByPath) {
      const ui = await mount(
        React.createElement(MemoryRouter, { initialEntries: [path] },
          React.createElement(OpsRoutes, { api: adminApi })),
      );
      await React.act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 15));
      });
      try {
        assert.doesNotMatch(ui.container.textContent, /移行準備中/, `${path} must not hit UnmigratedView`);
        assert.match(ui.container.textContent, pattern, `${path} must render MIG-0727 screen`);
      } finally {
        await ui.close();
      }
    }
  } finally {
    globalThis.fetch = origFetch;
  }
});

test("MIG-0727 T03: AdminApiEndpointsPage navigates to ?notice= on success and ?error= on failure with banner", async () => {
  const payload = {
    rows: [{
      id: "ev1", event_id: "ev1", event_title: "公開イベント1",
      public_api_enabled: 1, updated_at: 1760000000, created_at: 1760000000,
      event_visibility_status: "public",
    }],
    eventOptions: [
      { id: "ev1", title: "公開イベント1", enabled: 1 },
      { id: "ev2", title: "公開イベント2", enabled: 0 },
    ],
  };
  const fetchFn = async (path, init) => {
    if (path === "/api/admin-read/api-endpoints") return json(200, payload);
    if (path === "/api/admin/api-endpoints" && init?.method === "POST") {
      return json(200, { ok: true, id: "ev2", message: "公開APIを有効化しました。" });
    }
    if (path === "/api/admin/api-endpoints/ev1" && init?.method === "PATCH") {
      return json(500, { ok: false, message: "更新が競合したか監査記録に失敗しました。" });
    }
    return json(404, {});
  };
  const ui = await mount(
    React.createElement(MemoryRouter, { initialEntries: ["/admin/api-endpoints"] },
      React.createElement(Routes, null,
        React.createElement(Route, {
          path: "/admin/api-endpoints",
          element: React.createElement(React.Fragment, null,
            React.createElement(LocationProbe),
            React.createElement(AdminApiEndpointsPage, { fetchFn }),
          ),
        }),
      )),
  );
  try {
    const select = ui.container.querySelector('select[name="event_id"]');
    await React.act(async () => {
      const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLSelectElement.prototype, "value").set;
      setter.call(select, "ev2");
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await React.act(async () => {
      ui.container.querySelector("form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    assert.match(ui.container.querySelector('[data-testid="loc"]').textContent, /^\/admin\/api-endpoints\?notice=/);
    assert.match(ui.container.querySelector('[role="status"]').textContent, /公開APIを有効化しました/);

    const disableBtn = [...ui.container.querySelectorAll("button")].find(b => b.textContent === "無効化");
    await React.act(async () => disableBtn.click());
    assert.match(ui.container.querySelector('[data-testid="loc"]').textContent, /^\/admin\/api-endpoints\?error=/);
    assert.match(ui.container.querySelector('[role="alert"]').textContent, /更新が競合したか監査記録に失敗しました/);
  } finally {
    await ui.close();
  }
});

test("MIG-0727 T01/T04 & D-17-2: create announcement navigates to edit; 404 renders NotFoundView; published rule stays readOnly and keeps notice", async () => {
  const createFetch = async (path, init) => {
    if (path === "/api/admin/announcements" && init?.method === "POST") {
      return json(200, { ok: true, id: "anc_99" });
    }
    return json(404, {});
  };
  const uiCreate = await mount(
    React.createElement(MemoryRouter, { initialEntries: ["/admin/announcements/new"] },
      React.createElement(Routes, null,
        React.createElement(Route, {
          path: "/admin/announcements/new",
          element: React.createElement(AnnouncementCreatePage, { fetchFn: createFetch }),
        }),
        React.createElement(Route, {
          path: "/admin/announcements/:id/edit",
          element: React.createElement(LocationProbe),
        }),
      )),
  );
  try {
    uiCreate.container.querySelector('input[name="title"]').value = "新タイトル";
    uiCreate.container.querySelector('textarea[name="body"]').value = "新本文";
    await React.act(async () => {
      uiCreate.container.querySelector("form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    assert.equal(uiCreate.container.querySelector('[data-testid="loc"]').textContent, "/admin/announcements/anc_99/edit");
  } finally {
    await uiCreate.close();
  }

  const ui404 = await mount(
    React.createElement(MemoryRouter, { initialEntries: ["/admin/announcements/missing/edit"] },
      React.createElement(Routes, null,
        React.createElement(Route, {
          path: "/admin/announcements/:id/edit",
          element: React.createElement(AnnouncementEditPage, { fetchFn: async () => json(404, {}) }),
        }),
      )),
  );
  try {
    assert.match(ui404.container.textContent, /ページが見つかりません/);
  } finally {
    await ui404.close();
  }

  let ruleStatus = "draft";
  const ruleFetch = async (path, init) => {
    if (path === "/api/admin-read/rules/tv1") {
      return json(200, {
        item: {
          id: "tv1", version_label: "v2026-11", body_markdown: "# 本文",
          severity: "major", status: ruleStatus,
        },
      });
    }
    if (path === "/api/admin/rules/tv1/publish" || path === "/api/admin/terms/tv1/publish") {
      assert.equal(init?.method, "POST");
      ruleStatus = "published";
      return json(200, { ok: true, id: "tv1", pendingPublicReflection: true });
    }
    return json(404, {});
  };
  const uiRule = await mount(
    React.createElement(MemoryRouter, { initialEntries: ["/admin/rules/tv1/edit"] },
      React.createElement(Routes, null,
        React.createElement(Route, {
          path: "/admin/rules/:id/edit",
          element: React.createElement(AdminRuleEditPage, { fetchFn: ruleFetch }),
        }),
      )),
  );
  try {
    const pubBtn = [...uiRule.container.querySelectorAll("button")].find(b => b.textContent === "公開");
    await React.act(async () => pubBtn.click());
    await React.act(async () => uiRule.container.querySelector(".confirm-footer button:last-child").click());
    assert.match(uiRule.container.querySelector('[role="status"]').textContent, /公開しました。 公開側への反映待ちです。/);
    assert.equal(uiRule.container.querySelector('input[name="version_label"]').readOnly, true);
    assert.equal(uiRule.container.querySelector('textarea[name="body_markdown"]').readOnly, true);
  } finally {
    await uiRule.close();
  }
});
