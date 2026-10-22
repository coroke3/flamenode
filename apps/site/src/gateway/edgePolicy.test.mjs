import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { resolveCanonicalHostRedirect as current } from "../../../../src/lib/auth/canonicalHostRedirect.ts";
import gateway, { resetGatewayCaches } from "./index.ts";
import {
  OPERATION_MODE_KV_KEY,
  applyEdgePolicy,
  resetEdgePolicyCache,
  resolveCanonicalHostRedirect as ported,
} from "./edgePolicy.ts";

// MIG-0619 T01-T06. T01/T03 run CURRENT `resolveCanonicalHostRedirect` on the same table.
const ORIGIN = "https://flamenode.net";
const canonicalTable = [
  { configuredOrigin: ORIGIN, forwardedHost: "www.flamenode.net", host: "ignored.example.com", pathname: "/entry", search: "?from=www" },
  { configuredOrigin: ORIGIN, forwardedHost: null, host: "flamenode-web.workers.dev", pathname: "/api/auth/signin/discord", search: "" },
  { configuredOrigin: ORIGIN, forwardedHost: "www.flamenode.net, other.example", host: "x", pathname: "/", search: "?a=1&b=%E3%81%82" },
  { configuredOrigin: ORIGIN, forwardedHost: null, host: "flamenode.net", pathname: "/entry", search: "" },
  { configuredOrigin: ORIGIN, forwardedHost: null, host: "FlameNode.NET", pathname: "/entry", search: "" },
  { configuredOrigin: ORIGIN, forwardedHost: null, host: "flamenode.net:443", pathname: "/entry", search: "" },
  { configuredOrigin: ORIGIN, forwardedHost: null, host: "localhost:3000", pathname: "/entry", search: "" },
  { configuredOrigin: ORIGIN, forwardedHost: null, host: "127.0.0.1", pathname: "/entry", search: "" },
  { configuredOrigin: ORIGIN, forwardedHost: null, host: "[::1]", pathname: "/entry", search: "" },
  { configuredOrigin: ORIGIN, forwardedHost: null, host: null, pathname: "/entry", search: "" },
  { configuredOrigin: ORIGIN, forwardedHost: null, host: "bad host", pathname: "/entry", search: "" },
  { configuredOrigin: ORIGIN, forwardedHost: null, host: "www.flamenode.net", pathname: "/api/health", search: "" },
  { configuredOrigin: ORIGIN, forwardedHost: null, host: "www.flamenode.net", pathname: "/api/health/deep", search: "?x=1" },
  { configuredOrigin: ORIGIN, forwardedHost: null, host: "www.flamenode.net", pathname: "/api/healthz", search: "" },
  { configuredOrigin: "https://flamenode-web.example.workers.dev", forwardedHost: null, host: "flamenode.net", pathname: "/entry", search: "" },
  { configuredOrigin: "https://workers.dev", forwardedHost: null, host: "flamenode.net", pathname: "/entry", search: "" },
  { configuredOrigin: undefined, forwardedHost: null, host: "www.flamenode.net", pathname: "/entry", search: "" },
  { configuredOrigin: "", forwardedHost: null, host: "www.flamenode.net", pathname: "/entry", search: "" },
  { configuredOrigin: "not a url", forwardedHost: null, host: "www.flamenode.net", pathname: "/entry", search: "" },
  { configuredOrigin: "ftp://flamenode.net", forwardedHost: null, host: "www.flamenode.net", pathname: "/entry", search: "" },
  { configuredOrigin: "https://flamenode.net/path", forwardedHost: null, host: "www.flamenode.net", pathname: "/entry", search: "" },
  { configuredOrigin: "https://user:pw@flamenode.net", forwardedHost: null, host: "www.flamenode.net", pathname: "/entry", search: "" },
  { configuredOrigin: "http://localhost:3000", forwardedHost: null, host: "example.com", pathname: "/entry", search: "" },
  { configuredOrigin: "https://flamenode.net:8443", forwardedHost: null, host: "flamenode.net", pathname: "/entry", search: "" },
  { configuredOrigin: "https://flamenode.net/", forwardedHost: null, host: "www.flamenode.net", pathname: "entry", search: "?q=1" },
];

test("T01/T03 canonical host decisions equal CURRENT on the CURRENT table", () => {
  for (const input of canonicalTable) {
    assert.equal(ported(input), current(input), JSON.stringify(input));
  }
});

const MIRROR_MAINTENANCE = JSON.stringify({ mode: "maintenance", updated_at: 1 });
const MIRROR_NORMAL = JSON.stringify({ mode: "normal", updated_at: 1 });

function kv(value, calls = []) {
  return {
    calls,
    get: async (key, options) => {
      calls.push({ key, options });
      if (value instanceof Error) throw value;
      return value;
    },
  };
}

function req(path, headers = {}, base = "https://flamenode.net") {
  return new Request(new URL(path, base), { headers });
}

test("T01/T02 gateway answers 308 with host, forwarded host, path and query kept; /api/health is exempt", async () => {
  const env = { NEXT_PUBLIC_SITE_URL: ORIGIN };
  const res = await gateway.fetch(req("/entry?from=www", { "x-forwarded-host": "www.flamenode.net" }, "https://www.flamenode.net"), env);
  assert.equal(res.status, 308);
  assert.equal(res.headers.get("location"), "https://flamenode.net/entry?from=www");
  const auth = await gateway.fetch(req("/api/auth/signin/discord", { host: "x.workers.dev" }, "https://x.workers.dev"), env);
  assert.equal(auth.status, 308);
  assert.equal(auth.headers.get("location"), "https://flamenode.net/api/auth/signin/discord");
  // AUTH_URL is the fallback, NEXT_PUBLIC_SITE_URL wins.
  const fallback = await gateway.fetch(req("/x", {}, "https://www.flamenode.net"), { AUTH_URL: ORIGIN });
  assert.equal(fallback.headers.get("location"), "https://flamenode.net/x");
  const health = await applyEdgePolicy(req("/api/health", {}, "https://www.flamenode.net"), env);
  assert.equal(health, null);
  // workers.dev as configured origin: no redirect.
  assert.equal(await applyEdgePolicy(req("/entry", {}, "https://flamenode.net"), { NEXT_PUBLIC_SITE_URL: "https://a.workers.dev" }), null);
});

const exemptPaths = ["/maintenance", "/maintenance/", "/admin", "/admin/events", "/api/auth", "/api/auth/callback/discord", "/api/health", "/api/health/deep"];
const redirectedPaths = ["/", "/video-1", "/user/alpha", "/event/e1", "/about", "/dashboard", "/entry", "/manage", "/api/videos", "/api/healthz", "/adminx", "/maintenance2", "/api/authx"];

test("T04 maintenance allowlist and redirect (mirror, env flag, normal)", async () => {
  const modes = [
    { name: "mirror maintenance", env: () => ({ KV: kv(MIRROR_MAINTENANCE) }), on: true },
    { name: "env flag", env: () => ({ MAINTENANCE_MODE: "1", KV: kv(MIRROR_NORMAL) }), on: true },
    { name: "normal", env: () => ({ KV: kv(MIRROR_NORMAL) }), on: false },
    { name: "env flag not 1", env: () => ({ MAINTENANCE_MODE: "true", KV: kv(MIRROR_NORMAL) }), on: false },
    { name: "no KV binding", env: () => ({}), on: false },
    { name: "invalid mirror", env: () => ({ KV: kv("{\"mode\":\"maintenance\"}") }), on: false },
    { name: "unknown mode", env: () => ({ KV: kv(JSON.stringify({ mode: "x", updated_at: 1 })) }), on: false },
  ];
  for (const mode of modes) {
    for (const path of [...exemptPaths, ...redirectedPaths]) {
      resetEdgePolicyCache();
      const res = await applyEdgePolicy(req(`${path}?q=1`), mode.env());
      const shouldRedirect = mode.on && redirectedPaths.includes(path);
      if (shouldRedirect) {
        assert.equal(res?.status, 307, `${mode.name} ${path}`);
        // CURRENT `new URL("/maintenance", url)`: query is dropped.
        assert.equal(res.headers.get("location"), "https://flamenode.net/maintenance", `${mode.name} ${path}`);
      } else {
        assert.equal(res, null, `${mode.name} ${path}`);
      }
    }
  }
});

test("T04 canonical host wins over maintenance and applies to exempt paths", async () => {
  const res = await applyEdgePolicy(req("/admin", {}, "https://www.flamenode.net"), {
    NEXT_PUBLIC_SITE_URL: ORIGIN,
    KV: kv(MIRROR_MAINTENANCE),
  });
  assert.equal(res.status, 308);
  assert.equal(res.headers.get("location"), "https://flamenode.net/admin");
});

test("maintenance mirror: one KV read per isolate window, with edge cacheTtl; exempt paths read nothing", async () => {
  resetEdgePolicyCache();
  const store = kv(MIRROR_MAINTENANCE);
  await applyEdgePolicy(req("/a"), { KV: store }, 1000);
  await applyEdgePolicy(req("/b"), { KV: store }, 1004);
  assert.equal(store.calls.length, 1);
  assert.deepEqual(store.calls[0], { key: OPERATION_MODE_KV_KEY, options: { cacheTtl: 30 } });
  await applyEdgePolicy(req("/c"), { KV: store }, 6000);
  assert.equal(store.calls.length, 2);
  resetEdgePolicyCache();
  const idle = kv(MIRROR_MAINTENANCE);
  await applyEdgePolicy(req("/admin"), { KV: idle });
  await applyEdgePolicy(req("/api/health"), { KV: idle });
  assert.equal(idle.calls.length, 0);
});

test("T06 KV failure is fail-open and cached briefly, as CURRENT", async () => {
  resetEdgePolicyCache();
  const store = kv(new Error("kv down"));
  assert.equal(await applyEdgePolicy(req("/a"), { KV: store }, 1000), null);
  assert.equal(await applyEdgePolicy(req("/b"), { KV: store }, 1001), null);
  assert.equal(store.calls.length, 1);
});

test("T05 /maintenance is served by the gateway from Static Assets, also while maintenance is on", async () => {
  resetEdgePolicyCache();
  resetGatewayCaches();
  const seen = [];
  const env = {
    KV: kv(MIRROR_MAINTENANCE),
    ASSETS: {
      fetch: async (r) => {
        seen.push(new URL(r.url).pathname);
        return new Response("<html>maintenance</html>", { status: 200 });
      },
    },
  };
  for (const path of ["/maintenance", "/maintenance/"]) {
    const res = await gateway.fetch(req(path), env);
    assert.equal(res.status, 200);
    assert.equal(await res.text(), "<html>maintenance</html>");
  }
  assert.deepEqual(seen, ["/maintenance/", "/maintenance/"]);
  // Everything else is redirected before any asset or shard read.
  seen.length = 0;
  const other = await gateway.fetch(req("/dashboard"), env);
  assert.equal(other.status, 307);
  assert.equal(other.headers.get("location"), "https://flamenode.net/maintenance");
  assert.deepEqual(seen, []);
  // /admin and /api/auth stay reachable (auth forwards to AUTH_ORIGIN, never a fake 404).
  const auth = await gateway.fetch(req("/api/auth/session"), { ...env, AUTH_ORIGIN: { fetch: async () => new Response("auth", { status: 200 }) } });
  assert.equal(await auth.text(), "auth");
});

test("CURRENT middleware keeps the same allowlist and order the gateway ports", async () => {
  const middleware = await readFile(new URL("../../../../middleware.ts", import.meta.url), "utf8");
  for (const prefix of ["/maintenance", "/admin", "/api/auth", "/api/health"]) {
    assert.ok(middleware.includes(`matchesPathSegmentPrefix(url.pathname, "${prefix}")`), prefix);
  }
  assert.match(middleware, /NextResponse\.redirect\(canonicalRedirect, 308\)/);
  assert.match(middleware, /NextResponse\.redirect\(new URL\("\/maintenance", url\)\)/);
  assert.ok(middleware.indexOf("resolveCanonicalHostRedirect(") < middleware.indexOf("resolveMiddlewareMaintenance()"));
});

test("the maintenance page texts are CURRENT's", async () => {
  const [view, page] = await Promise.all([
    readFile(new URL("../../../../packages/ui/src/screens/MaintenanceView.tsx", import.meta.url), "utf8"),
    readFile(new URL("../../../../app/(public)/maintenance/page.tsx", import.meta.url), "utf8"),
  ]);
  for (const text of ["メンテナンス中", "FlameNode は現在メンテナンスを実施しています。", "ご迷惑をおかけしますが、しばらくお待ちください。", "Cloudflare コストガード機能により、書き込み操作が一時的に停止される場合があります。", "閲覧のみは静的 JSON で継続提供します。", "トップへ戻る"]) {
    assert.ok(page.includes(text), `CURRENT: ${text}`);
    assert.ok(view.includes(text), `view: ${text}`);
  }
});
