// MIG-0608 follow-up fixes in apps/api (MIG-0602 U02): C-1 tri-state session
// resolution (CURRENT CurrentUserUnavailableError -> 503) and C-2 private,
// no-store on authenticated / deny responses.
import test from "node:test";
import assert from "node:assert/strict";
import { Hono } from "hono";
import { sessionMiddleware, requireAuth } from "../src/auth/session.ts";
import { app } from "../src/app.ts";

const COOKIE = "authjs.session-token=tok_secret_value";
const failingDb = {
  prepare() {
    return {
      bind() {
        return {
          first: async () => {
            throw new Error("D1 down for tok_secret_value");
          },
        };
      },
    };
  },
};

function makeApp(env) {
  const hono = new Hono();
  hono.use("/me", sessionMiddleware());
  hono.use("/me", requireAuth());
  hono.get("/me", (c) => c.json({ ok: true }));
  return { hono, env };
}

test("C-1: D1 failure with a session token -> 503 database_unavailable (not 401)", async () => {
  const logged = [];
  const original = console.error;
  console.error = (...args) => logged.push(args.join(" "));
  try {
    const { hono, env } = makeApp({ DB: failingDb });
    const res = await hono.request("http://localhost/me", { headers: { cookie: COOKIE } }, env);
    assert.equal(res.status, 503);
    assert.deepEqual(await res.json(), { error: "database_unavailable" });
    assert.equal(res.headers.get("cache-control"), "private, no-store");
    assert.ok(logged.join(" ").includes("D1_LOOKUP_FAILED"));
    assert.ok(!logged.join(" ").includes("tok_secret_value"));
  } finally {
    console.error = original;
  }
});

test("C-1: missing DB binding with a session token -> 503 database_unavailable", async () => {
  const original = console.error;
  console.error = () => {};
  try {
    const { hono, env } = makeApp({});
    const res = await hono.request("http://localhost/me", { headers: { cookie: COOKIE } }, env);
    assert.equal(res.status, 503);
    assert.deepEqual(await res.json(), { error: "database_unavailable" });
  } finally {
    console.error = original;
  }
});

test("C-1: no token -> 401 Unauthorized (still no-store on the deny)", async () => {
  const { hono, env } = makeApp({ DB: failingDb });
  const res = await hono.request("http://localhost/me", {}, env);
  assert.equal(res.status, 401);
  assert.equal(res.headers.get("cache-control"), "private, no-store");
});

test("C-1: writeGuard maps an unavailable session to 503 database_unavailable after origin check", async () => {
  const env = { DB: failingDb, NEXT_PUBLIC_SITE_URL: "https://app.flamenode.example" };
  const original = console.error;
  console.error = () => {};
  try {
    const bad = await app.request("/api/admin/announcements", {
      method: "POST",
      headers: { Origin: "https://evil.example", cookie: COOKIE },
    }, env);
    assert.equal(bad.status, 403);
    const res = await app.request("/api/admin/announcements", {
      method: "POST",
      headers: { Origin: "https://app.flamenode.example", cookie: COOKIE, "content-type": "application/json" },
      body: "{}",
    }, env);
    assert.equal(res.status, 503);
    assert.deepEqual(await res.json(), { ok: false, reason: "database_unavailable" });
    assert.equal(res.headers.get("cache-control"), "private, no-store");
  } finally {
    console.error = original;
  }
});

test("C-2: write deny responses are private, no-store", async () => {
  const env = { DB: failingDb, NEXT_PUBLIC_SITE_URL: "https://app.flamenode.example" };
  for (const headers of [{}, { Origin: "https://evil.example" }, { Origin: "https://app.flamenode.example" }]) {
    const res = await app.request("/api/admin/announcements", { method: "POST", headers, body: "{}" }, env);
    assert.ok([401, 403, 503].includes(res.status));
    assert.equal(res.headers.get("cache-control"), "private, no-store", JSON.stringify(headers));
  }
});

test("C-2: public routes keep their existing cache headers (no session middleware)", async () => {
  const res = await app.request("/api/health", {}, { BUILD_COMMIT_SHA: "a".repeat(40) });
  assert.notEqual(res.headers.get("cache-control"), "private, no-store");
});
