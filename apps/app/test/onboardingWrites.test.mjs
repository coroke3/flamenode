// MIG-0710 U01: shared write transport and silent re-fetch contract (D-16-2/3).
import assert from "node:assert/strict";
import { test } from "node:test";
import * as React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { dom, flush, fakeApi, onboarding, onboardingState, ok } from "./helpers.mjs";
import { MemoryRouter } from "react-router-dom";

const { send } = await import("../.test-dist/apps/app/src/api/write.js");
const { useApiResult, useSession } = await import("../.test-dist/apps/app/src/routes/guard.js");

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

test("D-16-2: bodyless writes omit both JSON body and Content-Type", async () => {
  let options;
  const result = await send(async (_path, init) => {
    options = init;
    return asJson({ ok: true });
  }, "POST", "/api/xid/requests/r1/cancel");
  assert.deepEqual(result, { status: "ok", data: { ok: true } });
  assert.equal(options.method, "POST");
  assert.equal(Object.hasOwn(options, "body"), false);
  assert.equal(Object.hasOwn(options.headers, "content-type"), false);
  assert.equal(options.headers.accept, "application/json");
  assert.equal(options.credentials, "same-origin");
  assert.equal(options.cache, "no-store");
});

test("D-16-2: an unstructured 401 is anonymous; network/invalid payload is unavailable", async () => {
  assert.deepEqual(await send(async () => new Response("no", { status: 401 }), "POST", "/write"), { status: "anonymous" });
  assert.deepEqual(await send(async () => asJson({ message: "no" }, 401), "POST", "/write"), { status: "anonymous" });
  assert.deepEqual(await send(async () => asJson({ ok: "false" }, 503), "POST", "/write"), { status: "unavailable" });
  assert.deepEqual(await send(async () => { throw Error("network down"); }, "POST", "/write"), { status: "unavailable" });
});

test("D-16-2: HTTP failures cannot be promoted to success by a misleading JSON envelope", async () => {
  for (const status of [400, 403, 409, 500, 503]) {
    assert.deepEqual(
      await send(async () => asJson({ ok: true, message: "spoofed" }, status), "POST", "/write", {}),
      { status: "unavailable" },
      `HTTP ${status} with ok:true must fail closed`,
    );
  }
  assert.deepEqual(
    await send(async () => asJson({ ok: true }, 401), "POST", "/write", {}),
    { status: "anonymous" },
    "HTTP 401 always requires renewed authentication",
  );
  assert.deepEqual(
    await send(async () => asJson({ ok: false, message: "競合" }, 409), "POST", "/write", {}),
    { status: "ok", data: { ok: false, message: "競合" } },
    "explicit API denials remain available to display their message",
  );
  assert.deepEqual(
    await send(async () => asJson([{ ok: true }]), "POST", "/write", {}),
    { status: "unavailable" },
    "arrays are not valid mutation result DTOs",
  );
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
const { Onboarding } = await import("../.test-dist/apps/app/src/routes/onboarding.js");

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

test("MIG-0641: terms and completion DTO validation rejects malformed envelopes", async () => {
  for (const value of [
    { ok: false }, // the confirmed denial contract requires a message
    { ok: "true" },
    { ok: true, alreadyAccepted: "yes" },
    [ { ok: true } ],
  ]) {
    const api = createTermsApi(async () => asJson(value));
    assert.deepEqual(await api.accept(), { status: "unavailable" }, JSON.stringify(value));
  }
  const denied = createTermsApi(async () => asJson({ ok: false, message: "再同意が必要です" }, 409));
  assert.deepEqual(await denied.accept(), {
    status: "ok", data: { ok: false, message: "再同意が必要です" },
  });
  const accepted = createTermsApi(async () => asJson({ ok: true, alreadyAccepted: true }));
  assert.deepEqual(await accepted.accept(), { status: "ok", data: { ok: true, alreadyAccepted: true } });
  const malformedCompletion = createTermsApi(async () => asJson({ ok: true, message: 123 }));
  assert.deepEqual(await malformedCompletion.complete(), { status: "unavailable" });
  const completed = createTermsApi(async () => asJson({ ok: true }));
  assert.deepEqual(await completed.complete(), { status: "ok", data: { ok: true } });
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

test("MIG-0710 U03: completion marker POST sends empty body and same-origin/no-store settings", async () => {
  let request;
  const terms = createTermsApi(async (input, init) => {
    request = { input, init };
    return asJson({ ok: true });
  });
  assert.deepEqual(await terms.complete(), { status: "ok", data: { ok: true } });
  assert.equal(request.input, "/api/personal/onboarding/complete");
  assert.equal(request.init.method, "POST");
  assert.equal(request.init.body, "{}");
  assert.equal(request.init.credentials, "same-origin");
  assert.equal(request.init.cache, "no-store");
});

async function mountOnboardingWithTerms(readApi, termsApi) {
  const container = dom.window.document.createElement("div");
  const root = createRoot(container);
  await act(async () => root.render(
    React.createElement(MemoryRouter, { initialEntries: ["/onboarding"] },
      React.createElement(Onboarding, { api: readApi, termsApi }),
    ),
  ));
  await flush();
  return { container, unmount: () => act(async () => root.unmount()) };
}

test("MIG-0710 U03: complete is sent once only after successful read, even after terms refresh", async () => {
  let reads = 0;
  let completions = 0;
  const readApi = fakeApi({
    getOnboarding: () => {
      reads += 1;
      return ok(onboarding({ state: onboardingState({ needsTermsAcceptance: reads === 1 }) }));
    },
  });
  const termsApi = {
    accept: async () => ({ status: "ok", data: { ok: true } }),
    complete: async () => {
      completions += 1;
      throw new Error("synthetic private completion error");
    },
  };
  const m = await mountOnboardingWithTerms(readApi, termsApi);
  try {
    assert.equal(reads, 1);
    assert.equal(completions, 1);
    await act(async () => m.container.querySelector('input[type="checkbox"]').click());
    await act(async () => {
      m.container.querySelector("form").dispatchEvent(
        new dom.window.Event("submit", { bubbles: true, cancelable: true }),
      );
    });
    await flush();
    assert.equal(reads, 2);
    assert.equal(completions, 1, "refreshKey must never issue a second complete POST");
    assert.doesNotMatch(m.container.textContent, /synthetic private completion error/);
    assert.match(m.container.textContent, /FlameNode を利用する準備/);
  } finally {
    await m.unmount();
  }
});

test("MIG-0710 U03: read 401/403/unavailable prevents all completion writes", async () => {
  for (const status of ["anonymous", "banned", "unavailable"]) {
    let completions = 0;
    const termsApi = {
      accept: async () => ({ status: "ok", data: { ok: true } }),
      complete: async () => { completions += 1; return { status: "ok", data: { ok: true } }; },
    };
    const m = await mountOnboardingWithTerms(fakeApi({ getOnboarding: { status } }), termsApi);
    try {
      assert.equal(completions, 0, status);
    } finally {
      await m.unmount();
    }
  }
});


test("D-16-3: changing API identity hides prior private data and applies anonymous/banned/unavailable", async () => {
  for (const nextStatus of ["anonymous", "banned", "unavailable"]) {
    const container = dom.window.document.createElement("div");
    const root = createRoot(container);
    let resolveNext;
    const firstApi = {
      getDashboard: async () => ({ status: "ok", data: { value: "private data from previous API" } }),
    };
    const nextApi = {
      getDashboard: () => new Promise((resolve) => { resolveNext = resolve; }),
    };
    const Demo = ({ api }) => {
      const state = useApiResult(api, "dashboard", (client) => client.getDashboard());
      return React.createElement(
        "p",
        null,
        state.status === "ok" ? state.data.value : state.status,
      );
    };
    try {
      await act(async () => root.render(React.createElement(Demo, { api: firstApi })));
      await flush();
      assert.equal(container.textContent, "private data from previous API");

      // The previous identity is hidden on the render that receives the new API,
      // before the replacement request resolves or its effect can paint old data.
      await act(async () => root.render(React.createElement(Demo, { api: nextApi })));
      assert.equal(container.textContent, "loading");
      assert.doesNotMatch(container.textContent, /private data from previous API/);

      await act(async () => resolveNext({ status: nextStatus }));
      await flush();
      assert.equal(container.textContent, nextStatus);
      assert.doesNotMatch(container.textContent, /private data from previous API/);
    } finally {
      await act(async () => root.unmount());
    }
  }
});


test("D-16-3: StrictMode effect replay still applies the initial anonymous result", async () => {
  const container = dom.window.document.createElement("div");
  const root = createRoot(container);
  const api = {
    getDashboard: async () => ({ status: "anonymous" }),
  };
  const Demo = () => {
    const state = useApiResult(api, "dashboard", (client) => client.getDashboard());
    return React.createElement("p", null, state.status);
  };
  try {
    await act(async () => root.render(
      React.createElement(React.StrictMode, null, React.createElement(Demo)),
    ));
    await flush();
    assert.equal(container.textContent, "anonymous");
    assert.notEqual(container.textContent, "loading");
  } finally {
    await act(async () => root.unmount());
  }
});


test("D-16-4: changing Personal API identity hides the previous session user synchronously", async () => {
  for (const nextStatus of ["anonymous", "banned", "unavailable"]) {
    const container = dom.window.document.createElement("div");
    const root = createRoot(container);
    let resolveNext;
    const firstApi = {
      getSession: async () => ({ status: "ok", user: { id: "previous-private-user" } }),
    };
    const nextApi = {
      getSession: () => new Promise((resolve) => { resolveNext = resolve; }),
    };
    const Demo = ({ api }) => {
      const state = useSession(api);
      return React.createElement(
        "p",
        null,
        state.status === "ok" ? state.user.id : state.status,
      );
    };
    try {
      await act(async () => root.render(React.createElement(Demo, { api: firstApi })));
      await flush();
      assert.equal(container.textContent, "previous-private-user");

      await act(async () => root.render(React.createElement(Demo, { api: nextApi })));
      assert.equal(container.textContent, "loading");
      assert.doesNotMatch(container.textContent, /previous-private-user/);

      await act(async () => resolveNext({ status: nextStatus }));
      await flush();
      assert.equal(container.textContent, nextStatus);
      assert.doesNotMatch(container.textContent, /previous-private-user/);
    } finally {
      await act(async () => root.unmount());
    }
  }
});

test("D-16-5: stale session completion from a replaced API cannot restore the previous user", async () => {
  const container = dom.window.document.createElement("div");
  const root = createRoot(container);
  let resolveOld;
  let resolveCurrent;
  const oldApi = {
    getSession: () => new Promise((resolve) => { resolveOld = resolve; }),
  };
  const currentApi = {
    getSession: () => new Promise((resolve) => { resolveCurrent = resolve; }),
  };
  const Demo = ({ api }) => {
    const state = useSession(api);
    return React.createElement("p", null, state.status === "ok" ? state.user.id : state.status);
  };
  try {
    await act(async () => root.render(React.createElement(Demo, { api: oldApi })));
    assert.equal(container.textContent, "loading");
    await act(async () => root.render(React.createElement(Demo, { api: currentApi })));
    assert.equal(container.textContent, "loading");

    await act(async () => resolveOld({ status: "ok", user: { id: "stale-private-user" } }));
    await flush();
    assert.equal(container.textContent, "loading");
    assert.doesNotMatch(container.textContent, /stale-private-user/);

    await act(async () => resolveCurrent({ status: "anonymous" }));
    await flush();
    assert.equal(container.textContent, "anonymous");
    assert.doesNotMatch(container.textContent, /stale-private-user/);
  } finally {
    await act(async () => root.unmount());
  }
});
