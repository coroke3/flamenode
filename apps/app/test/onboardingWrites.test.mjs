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
