import assert from "node:assert/strict";
import test from "node:test";
import * as React from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import {
  AdminRuleCreatePage,
  AdminRuleEditPage,
  termsWriteRevocationDestination,
} from "../.test-dist/apps/ops/src/routes/admin/TermsEditor.js";

const detail = {
  id: "tv1", version_label: "2026-11", body_markdown: "# PRIVATE_TERMS_CANARY",
  severity: "major", status: "draft",
};
const reply = (status, payload) => new Response(JSON.stringify(payload), {
  status, headers: { "content-type": "application/json" },
});

async function withTermsPage(fetchFn, page, exercise) {
  const { JSDOM, VirtualConsole } = await import("jsdom");
  const { createRoot } = await import("react-dom/client");
  const dom = new JSDOM("<div id='root'></div>", {
    url: "https://flamenode.test/admin/rules/tv1/edit",
    virtualConsole: new VirtualConsole(),
  });
  const saved = new Map();
  for (const [name, value] of [
    ["window", dom.window],
    ["document", dom.window.document],
    ["navigator", dom.window.navigator],
    ["FormData", dom.window.FormData],
    ["IS_REACT_ACT_ENVIRONMENT", true],
  ]) {
    saved.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  }
  const container = dom.window.document.querySelector("#root");
  const root = createRoot(container);
  const route = page === "edit" ? "/admin/rules/:id/edit" : "/admin/rules/new";
  const initial = page === "edit" ? "/admin/rules/tv1/edit" : "/admin/rules/new";
  const view = page === "edit"
    ? React.createElement(AdminRuleEditPage, { fetchFn })
    : React.createElement(AdminRuleCreatePage, {
      fetchFn, initial: { version_label: "2026-11", body_markdown: "# CREATE_CANARY", severity: "major" },
    });
  try {
    await React.act(async () => {
      root.render(React.createElement(MemoryRouter, { initialEntries: [initial] },
        React.createElement(Routes, null, React.createElement(Route, { path: route, element: view }))));
    });
    await exercise(container, dom.window);
  } finally {
    await React.act(async () => root.unmount());
    for (const [name, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
    dom.window.close();
  }
}

test("SEC-terms: write-revocation redirects are fixed same-origin paths", () => {
  assert.equal(termsWriteRevocationDestination("anonymous"), "/entry");
  assert.equal(termsWriteRevocationDestination("forbidden"), "/dashboard");
});

test("SEC-terms: editing a draft redacts private terms and all write controls on 401/403", async () => {
  for (const [status, reason] of [[401, "unauthenticated"], [403, "forbidden"], [403, "banned"]]) {
    let writes = 0;
    await withTermsPage(async (path, init) => {
      if (init?.method === "GET") {
        assert.equal(path, "/api/admin-read/rules/tv1");
        return reply(200, { item: detail });
      }
      writes += 1;
      assert.equal(init.method, "PATCH");
      assert.equal(path, "/api/admin/terms/tv1");
      return reply(status, { ok: false, reason, message: "denied", redirect: "https://evil.example" });
    }, "edit", async (container, win) => {
      assert.equal(container.querySelector('textarea[name="body_markdown"]')?.value,
        "# PRIVATE_TERMS_CANARY");
      const form = container.querySelector('form[aria-label="規約の編集"]');
      assert.ok(form);
      await React.act(async () => {
        form.dispatchEvent(new win.Event("submit", { bubbles: true, cancelable: true }));
      });
      assert.equal(writes, 1);
      assert.match(container.textContent, /規約編集へのアクセスが終了しました/);
      assert.equal(container.querySelector("textarea"), null);
      assert.equal(container.querySelector('form[aria-label="規約の編集"]'), null);
      assert.equal(container.querySelectorAll("button").length, 0);
      assert.doesNotMatch(container.textContent, /PRIVATE_TERMS_CANARY/);
    });
  }
});

test("SEC-terms: create draft controls also unmount after denied POST", async () => {
  let writes = 0;
  await withTermsPage(async (_path, init) => {
    assert.equal(init.method, "POST");
    writes += 1;
    return reply(403, { ok: false, reason: "forbidden", message: "forbidden" });
  }, "create", async (container, win) => {
    const form = container.querySelector('form[aria-label="規約の新規作成"]');
    assert.ok(form);
    await React.act(async () => {
      form.dispatchEvent(new win.Event("submit", { bubbles: true, cancelable: true }));
    });
    assert.equal(writes, 1);
    assert.match(container.textContent, /規約編集へのアクセスが終了しました/);
    assert.equal(container.querySelectorAll("form, textarea, button").length, 0);
  });
});

test("SEC-terms: ordinary 503 write failure preserves draft for retry", async () => {
  await withTermsPage(async (_path, init) =>
    init?.method === "GET"
      ? reply(200, { item: detail })
      : reply(503, { ok: false, reason: "forbidden", message: "temporary unavailable" }),
  "edit", async (container, win) => {
    const form = container.querySelector('form[aria-label="規約の編集"]');
    assert.ok(form);
    await React.act(async () => {
      form.dispatchEvent(new win.Event("submit", { bubbles: true, cancelable: true }));
    });
    assert.ok(container.querySelector('form[aria-label="規約の編集"]'));
    assert.equal(container.querySelector('textarea[name="body_markdown"]')?.value,
      "# PRIVATE_TERMS_CANARY");
    assert.doesNotMatch(container.textContent, /規約編集へのアクセスが終了しました/);
  });
});

test("SEC-terms: invalid-origin 403 preserves edit form and reports inline failure", async () => {
  await withTermsPage(async (_path, init) =>
    init?.method === "GET" ? reply(200, { item: detail }) :
      reply(403, { ok: false, reason: "invalid_origin", message: "inline denial" }),
  "edit", async (container, win) => {
    const form = container.querySelector('form[aria-label="規約の編集"]');
    await React.act(async () => form.dispatchEvent(new win.Event("submit", { bubbles: true, cancelable: true })));
    assert.equal(container.querySelector('textarea[name="body_markdown"]')?.value, "# PRIVATE_TERMS_CANARY");
    assert.match(container.textContent, /inline denial/);
    assert.equal(container.querySelector('button[type="submit"]').disabled, false);
  });
});

test("SEC-terms: unknown 403 quarantines both edit and create forms", async () => {
  for (const page of ["edit", "create"]) {
    await withTermsPage(async (_path, init) =>
      init?.method === "GET" ? reply(200, { item: detail }) : reply(403, { ok: false, reason: "unknown" }),
    page, async (container, win) => {
      const form = container.querySelector("form");
      await React.act(async () => form.dispatchEvent(new win.Event("submit", { bubbles: true, cancelable: true })));
      assert.match(container.textContent, /管理権限を確認できません/);
      assert.equal(container.querySelectorAll("form, textarea, input, button").length, 0);
      assert.doesNotMatch(container.textContent, /PRIVATE_TERMS_CANARY|CREATE_CANARY/);
      assert.equal(container.querySelector("a").getAttribute("href"), "/admin/rules");
    });
  }
});
