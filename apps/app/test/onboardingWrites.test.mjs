// MIG-0710 U01: shared write transport and silent re-fetch contract (D-16-2/3).
import assert from "node:assert/strict";
import { test } from "node:test";
import * as React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { dom, flush } from "./helpers.mjs";

const { send } = await import("../.test-dist/apps/app/src/api/write.js");
const { useApiResult } = await import("../.test-dist/apps/app/src/routes/guard.js");

const asJson = (value, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });

test("D-16-2: JSON write sends same-origin no-store headers and preserves ok:false even on 409", async () => {
  let seen;
  const fetchFn = async (input, init) => {
    seen = { input, init };
    return asJson({ ok: false, message: "競合しています。" }, 409);
  };
  const result = await send(fetchFn, "PATCH", "/api/personal/onboarding/terms", { sample: 1 });
  assert.deepEqual(result, { status: "ok", data: { ok: false, message: "競合しています。" } });
  assert.equal(seen.input, "/api/personal/onboarding/terms");
  assert.equal(seen.init.method, "PATCH");
  assert.equal(seen.init.credentials, "same-origin");
  assert.equal(seen.init.cache, "no-store");
  assert.equal(seen.init.headers.accept, "application/json");
  assert.equal(seen.init.headers["content-type"], "application/json");
  assert.equal(seen.init.body, '{"sample":1}');
});

test("D-16-2: multipart write leaves content-type to the browser and sends original FormData", async () => {
  const form = new FormData();
  form.append("icon_file", new Blob(["abc"]), "icon.png");
  let init;
  const result = await send(async (_url, options) => {
    init = options;
    return asJson({ ok: true });
  }, "POST", "/api/xid/icon/upload", form);
  assert.deepEqual(result, { status: "ok", data: { ok: true } });
  assert.equal(init.body, form);
  assert.equal(Object.hasOwn(init.headers, "content-type"), false);
});

test("D-16-2: an unstructured 401 is anonymous; network/invalid payload is unavailable", async () => {
  assert.deepEqual(await send(async () => new Response("no", { status: 401 }), "POST", "/write"), { status: "anonymous" });
  assert.deepEqual(await send(async () => asJson({ message: "no" }, 401), "POST", "/write"), { status: "anonymous" });
  assert.deepEqual(await send(async () => asJson({ ok: "false" }, 503), "POST", "/write"), { status: "unavailable" });
  assert.deepEqual(await send(async () => { throw Error("network down"); }, "POST", "/write"), { status: "unavailable" });
});

test("D-16-3: refreshKey reload is silent and preserves the prior value on errors", async () => {
  const container = dom.window.document.createElement("div");
  const root = createRoot(container);
  let count = 0;
  let resolveSecond;
  const api = {
    getDashboard: () => {
      count += 1;
      if (count === 1) return Promise.resolve({ status: "ok", data: { value: "old" } });
      if (count === 2) return new Promise((resolve) => { resolveSecond = resolve; });
      return Promise.resolve({ status: "ok", data: { value: "new" } });
    },
  };
  const Demo = ({ refreshKey }) => {
    const state = useApiResult(api, "dashboard", (client) => client.getDashboard(), refreshKey);
    return React.createElement("p", null, state.status === "ok" ? state.data.value : state.status);
  };
  try {
    await act(async () => root.render(React.createElement(Demo, { refreshKey: 0 })));
    await flush();
    assert.equal(container.textContent, "old");
    await act(async () => root.render(React.createElement(Demo, { refreshKey: 1 })));
    assert.equal(container.textContent, "old");
    await act(async () => resolveSecond({ status: "unavailable" }));
    await flush();
    assert.equal(container.textContent, "old");
    await act(async () => root.render(React.createElement(Demo, { refreshKey: 2 })));
    await flush();
    assert.equal(container.textContent, "new");
    assert.equal(count, 3);
  } finally {
    await act(async () => root.unmount());
  }
});

const { createTermsApi } = await import("../.test-dist/apps/app/src/api/terms.js");
const { OnboardingTermsForm } = await import("../.test-dist/apps/app/src/routes/onboardingTermsForm.js");

function renderTerms(api, onAccepted = () => {}) {
  const container = dom.window.document.createElement("div");
  const root = createRoot(container);
  const form = React.createElement(OnboardingTermsForm, {
    versionLabel: "v-test",
    termsBody: React.createElement("p", null, "test terms body"),
    api,
    onAccepted,
  });
  const render = () => act(async () => { root.render(form); });
  return {
    container,
    render,
    submit: () => act(async () => {
      container.querySelector("form").dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
    }),
    agree: () => act(async () => { container.querySelector('input[type="checkbox"]').click(); }),
    unmount: () => act(async () => { root.unmount(); }),
  };
}

test("MIG-0710 U02: terms client POSTs an empty JSON body to provisional endpoint", async () => {
  let request;
  const api = createTermsApi(async (input, init) => {
    request = { input, init };
    return asJson({ ok: true });
  });
  assert.deepEqual(await api.accept(), { status: "ok", data: { ok: true } });
  assert.equal(request.input, "/api/personal/onboarding/terms");
  assert.equal(request.init.method, "POST");
  assert.equal(request.init.body, "{}");
  assert.equal(request.init.credentials, "same-origin");
});

test("MIG-0710 U02: unchecked form refuses writes with CURRENT error", async () => {
  let calls = 0;
  const t = renderTerms({ accept: async () => { calls += 1; return { status: "ok", data: { ok: true } }; } });
  try {
    await t.render();
    assert.equal(t.container.querySelector('button[type="submit"]').disabled, true);
    await t.submit();
    assert.equal(calls, 0);
    assert.match(t.container.querySelector('[role="alert"]').textContent, /チェックボックスをオンにしてください/);
  } finally {
    await t.unmount();
  }
});

test("MIG-0710 U02: double submit is one write; success reports CURRENT text and refresh callback", async () => {
  let calls = 0;
  let finish;
  let accepted = 0;
  const t = renderTerms({
    accept: () => {
      calls += 1;
      return new Promise((resolve) => { finish = resolve; });
    },
  }, () => { accepted += 1; });
  try {
    await t.render();
    await t.agree();
    assert.equal(t.container.querySelector('button[type="submit"]').disabled, false);
    await act(async () => {
      const form = t.container.querySelector("form");
      form.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
      form.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
    });
    assert.equal(calls, 1);
    assert.equal(t.container.querySelector('button[type="submit"]').disabled, true);
    await act(async () => { finish({ status: "ok", data: { ok: true } }); });
    assert.equal(accepted, 1);
    assert.match(t.container.textContent, /利用規約への同意が完了しました/);
  } finally {
    await t.unmount();
  }
});

test("MIG-0710 U02: structured failure exposes server message; network failure uses CURRENT fallback", async () => {
  for (const [accept,pattern] of [
    [async () => ({ status: "ok", data: { ok: false, message: "利用規約の再確認が必要です。" } }), /利用規約の再確認が必要です/],
    [async () => ({ status: "unavailable" }), /同意の保存に失敗しました。時間をおいて再試行してください/],
    [async () => { throw Error("internal backend info"); }, /同意の保存に失敗しました。時間をおいて再試行してください/],
  ]) {
    const t = renderTerms({ accept });
    try {
      await t.render();
      await t.agree();
      await t.submit();
      assert.match(t.container.querySelector('[role="alert"]').textContent, pattern);
      assert.doesNotMatch(t.container.textContent, /internal backend info/);
      assert.equal(t.container.querySelector('input[type="checkbox"]').checked, true);
    } finally {
      await t.unmount();
    }
  }
});
