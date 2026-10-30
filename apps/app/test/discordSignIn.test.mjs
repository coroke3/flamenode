// MIG-0711 U02: same-origin Auth.js Discord sign-in, no Server Actions.
import assert from "node:assert/strict";
import test from "node:test";
import { dom } from "./helpers.mjs";

const { startDiscordSignIn, discordAuthNavigation } =
  await import("../.test-dist/apps/app/src/routes/entry/discordSignIn.js");
const { entryLoginRedirectTo } =
  await import("../.test-dist/apps/app/src/routes/next.js");

async function withAuthMocks(run, response = { ok: true, json: async () => ({ csrfToken: "csrf-demo" }) }) {
  const priorFetch = globalThis.fetch;
  const priorSubmit = dom.window.HTMLFormElement.prototype.submit;
  const priorAssign = discordAuthNavigation.assign;
  const calls = [];
  const submissions = [];
  const redirects = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    if (response instanceof Error) throw response;
    return response;
  };
  dom.window.HTMLFormElement.prototype.submit = function () {
    submissions.push({
      method: this.method,
      action: this.action,
      fields: Object.fromEntries([...this.querySelectorAll("input")].map(input => [input.name, input.value])),
    });
  };
  discordAuthNavigation.assign = (url) => redirects.push(url);
  try {
    await run({ calls, submissions, redirects });
  } finally {
    globalThis.fetch = priorFetch;
    dom.window.HTMLFormElement.prototype.submit = priorSubmit;
    discordAuthNavigation.assign = priorAssign;
    for (const node of dom.window.document.querySelectorAll('form[action$="/api/auth/signin/discord"]')) node.remove();
  }
}

test("T02: CSRF GET leads to POST form with csrfToken and CURRENT callbackUrl", async () => {
  await withAuthMocks(async ({ calls, submissions, redirects }) => {
    await startDiscordSignIn("/entry/slotted?slot=slot-1");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "/api/auth/csrf");
    assert.equal(calls[0].init.method, "GET");
    assert.equal(calls[0].init.credentials, "same-origin");
    assert.equal(calls[0].init.cache, "no-store");
    assert.equal(calls[0].init.body, undefined);
    assert.deepEqual(submissions, [{
      method: "post",
      action: "https://flamenode.test/api/auth/signin/discord",
      fields: {
        csrfToken: "csrf-demo",
        callbackUrl: "/auth/complete?next=%2Fentry%2Fslotted%3Fslot%3Dslot-1",
      },
    }]);
    assert.deepEqual(redirects, []);
  });
});

test("T03: absolute/protocol-relative/escape/callback URLs cannot become OAuth return URLs", async () => {
  for (const [input, expected] of [
    ["https://evil.example/path", "/auth/complete?next=%2Fentry"],
    ["//evil.example/path", "/auth/complete?next=%2Fentry"],
    ["/\\evil.example", "/auth/complete?next=%2Fentry"],
    ["/auth/complete?next=/admin", "/auth/complete?next=%2Fdashboard"],
    ["/api/auth/signout", "/auth/complete?next=%2Fdashboard"],
    ["/entry/unslotted?event=x", "/auth/complete?next=%2Fentry%2Funslotted%3Fevent%3Dx"],
  ]) {
    assert.equal(entryLoginRedirectTo(input), expected, input);
    await withAuthMocks(async ({ submissions }) => {
      await startDiscordSignIn(input);
      assert.equal(submissions[0].fields.callbackUrl, expected, input);
    });
  }
});

test("T04: rejected, malformed or unavailable CSRF always navigates to the temporary auth failure page", async () => {
  const bad = [
    new Error("offline"),
    { ok: false, json: async () => ({ csrfToken: "csrf-demo" }) },
    { ok: true, json: async () => ({}) },
    { ok: true, json: async () => ({ csrfToken: "" }) },
    { ok: true, json: async () => ({ csrfToken: 1 }) },
    { ok: true, json: async () => { throw new Error("bad JSON"); } },
  ];
  for (const response of bad) {
    await withAuthMocks(async ({ submissions, redirects }) => {
      await startDiscordSignIn("/dashboard");
      assert.deepEqual(submissions, []);
      assert.deepEqual(redirects, ["/entry?error=auth_temporarily_unavailable"]);
    }, response);
  }
});
