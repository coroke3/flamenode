import assert from "node:assert/strict";
import { test } from "node:test";
import { performance } from "node:perf_hooks";
import { buildRouteMap } from "../apps/site/src/lib/routeMap.ts";
import gateway, {
  createKvRevocationChecker,
} from "../apps/site/src/gateway/index.ts";
import {
  evaluateVisibility,
} from "../apps/site/src/gateway/visibility.ts";

function createSampleManifest() {
  return buildRouteMap(
    [
      { kind: "video", id: "video-public-1", aliases: ["video-alias-1"] },
      { kind: "video", id: "video-revoked-2" },
      { kind: "user", id: "creator-alpha", aliases: ["alpha-old"] },
      { kind: "event", id: "spring-fest-2026" },
      { kind: "redirect", fromPath: "/legacy/video/123", toPath: "/video-public-1", status: 307 },
    ],
    "gen-2026-10-17-001",
  );
}

test("R-GATEWAY 1: Public route resolution returns serve decision", async () => {
  const manifest = createSampleManifest();
  const decision = await evaluateVisibility("/video-public-1", manifest);

  assert.equal(decision.action, "serve");
  if (decision.action === "serve") {
    assert.equal(decision.kind, "video");
    assert.equal(decision.id, "video-public-1");
    assert.equal(decision.canonicalPath, "/video-public-1");
    assert.equal(decision.assetPath, "/video-public-1/index.html");
  }
});

test("R-GATEWAY 2: Alias route resolves to 308 permanent redirect", async () => {
  const manifest = createSampleManifest();
  const decision = await evaluateVisibility("/video-alias-1", manifest);

  assert.equal(decision.action, "redirect");
  if (decision.action === "redirect") {
    assert.equal(decision.targetPath, "/video-public-1");
    assert.equal(decision.status, 308);
    assert.equal(decision.reason, "alias");
  }
});

test("R-GATEWAY 3: Legacy route resolves to 307 temporary redirect", async () => {
  const manifest = createSampleManifest();
  const decision = await evaluateVisibility("/legacy/video/123", manifest);

  assert.equal(decision.action, "redirect");
  if (decision.action === "redirect") {
    assert.equal(decision.targetPath, "/video-public-1");
    assert.equal(decision.status, 307);
    assert.equal(decision.reason, "legacy");
  }
});

test("R-GATEWAY 4: Unknown route returns fail-closed 404 with noindex header", async () => {
  const manifest = createSampleManifest();
  const decision = await evaluateVisibility("/unknown-random-slug", manifest);

  assert.equal(decision.action, "deny");
  if (decision.action === "deny") {
    assert.equal(decision.status, 404);
    assert.equal(decision.reason, "not_found");
    assert.ok(decision.headers["X-Robots-Tag"].includes("noindex"));
  }
});

test("T01 & R-GATEWAY 5: Post-build revoked entity (public -> private) is denied 404", async () => {
  const manifest = createSampleManifest();
  // Simulate KV denial fence: "video-revoked-2" was public during build, but revoked post-build
  const isRevoked = (kind, id) => kind === "video" && id === "video-revoked-2";
  const decision = await evaluateVisibility("/video-revoked-2", manifest, isRevoked);

  assert.equal(decision.action, "deny");
  if (decision.action === "deny") {
    assert.equal(decision.status, 404);
    assert.equal(decision.reason, "revoked");
    assert.ok(decision.headers["X-Robots-Tag"].includes("noindex"));
    assert.ok(decision.headers["Cache-Control"].includes("no-store"));
  }
});

test("R-GATEWAY 6: Stale HTML remaining in storage is blocked when revoked", async () => {
  const manifest = createSampleManifest();
  const kvStore = new Map([["deny:video:video-revoked-2", "revoked_at_timestamp"]]);
  const mockKv = { get: async (k) => kvStore.get(k) ?? null };
  const revocationChecker = createKvRevocationChecker(mockKv);

  // Even if R2 or ASSETS has the old HTML, gateway must deny access
  const req = new Request("https://flamenode.net/video-revoked-2");
  const env = {
    ROUTE_MANIFEST: manifest,
    VISIBILITY_KV: mockKv,
    R2_STORAGE: {
      get: async () => ({
        body: new ReadableStream(),
        httpMetadata: { contentType: "text/html" },
      }),
    },
  };

  const response = await gateway.fetch(req, env);
  assert.equal(response.status, 404);
  assert.ok(response.headers.get("X-Robots-Tag")?.includes("noindex"));
});

test("T02: Corrupted or missing manifest results in fail-closed 503", async () => {
  const decision1 = await evaluateVisibility("/video-public-1", null);
  assert.equal(decision1.action, "unavailable");
  if (decision1.action === "unavailable") {
    assert.equal(decision1.status, 503);
    assert.equal(decision1.reason, "manifest_missing");
  }

  const decision2 = await evaluateVisibility("/video-public-1", { schemaVersion: 999 });
  assert.equal(decision2.action, "unavailable");
  if (decision2.action === "unavailable") {
    assert.equal(decision2.status, 503);
  }

  // Verify Worker response is 503
  const req = new Request("https://flamenode.net/video-public-1");
  const res = await gateway.fetch(req, { ROUTE_MANIFEST: "invalid-json" });
  assert.equal(res.status, 503);
});

test("T03: /api/auth/* bypasses the visibility gateway", async () => {
  const manifest = createSampleManifest();
  const decision1 = await evaluateVisibility("/api/auth/signin", manifest);
  assert.equal(decision1.action, "bypass");
  assert.equal(decision1.reason, "auth_protected");

  const decision2 = await evaluateVisibility("/api/auth/session", manifest);
  assert.equal(decision2.action, "bypass");

  const req = new Request("https://flamenode.net/api/auth/session");
  const res = await gateway.fetch(req, { ROUTE_MANIFEST: manifest });
  assert.equal(res.status, 404); // Not handled by public gateway
});

test("T04: Path traversal is denied with 404 and noindex", async () => {
  const manifest = createSampleManifest();
  const decision = await evaluateVisibility("/../../etc/passwd", manifest);
  assert.equal(decision.action, "deny");
  if (decision.action === "deny") {
    assert.equal(decision.status, 404);
    assert.equal(decision.reason, "traversal");
    assert.ok(decision.headers["X-Robots-Tag"].includes("noindex"));
  }
});

test("Gateway Worker fetch serves from ASSETS and falls back to R2", async () => {
  const manifest = createSampleManifest();
  const req = new Request("https://flamenode.net/video-public-1");

  // 1. Assets hit
  let assetFetched = false;
  const envAssets = {
    ROUTE_MANIFEST: manifest,
    ASSETS: {
      fetch: async (r) => {
        assetFetched = true;
        assert.ok(r.url.endsWith("/video-public-1/index.html"));
        return new Response("<html>Asset Content</html>", { status: 200 });
      },
    },
  };
  const resAssets = await gateway.fetch(req, envAssets);
  assert.equal(resAssets.status, 200);
  assert.equal(await resAssets.text(), "<html>Asset Content</html>");
  assert.ok(assetFetched);

  // 2. Assets 404 -> R2 hit
  let r2Fetched = false;
  const envR2 = {
    ROUTE_MANIFEST: manifest,
    ASSETS: {
      fetch: async () => new Response("Not Found", { status: 404 }),
    },
    R2_STORAGE: {
      get: async (key) => {
        r2Fetched = true;
        assert.equal(key, "video-public-1/index.html");
        return {
          body: new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode("<html>R2 Content</html>"));
              controller.close();
            },
          }),
          httpMetadata: { contentType: "text/html; charset=utf-8" },
        };
      },
    },
  };
  const resR2 = await gateway.fetch(req, envR2);
  assert.equal(resR2.status, 200);
  assert.equal(await resR2.text(), "<html>R2 Content</html>");
  assert.ok(r2Fetched);
});

test("T05: Gateway CPU budget complies with S1 (< 5ms max CPU budget)", async () => {
  const manifest = createSampleManifest();
  const kvStore = new Map();
  const mockKv = { get: async (k) => kvStore.get(k) ?? null };
  const req = new Request("https://flamenode.net/video-public-1");
  const env = {
    ROUTE_MANIFEST: manifest,
    VISIBILITY_KV: mockKv,
    ASSETS: {
      fetch: async () => new Response("OK", { status: 200 }),
    },
  };

  const latencies = [];
  const iterations = 1000;

  // Warmup
  for (let i = 0; i < 50; i++) {
    await gateway.fetch(req, env);
  }

  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    await gateway.fetch(req, env);
    const duration = performance.now() - start;
    latencies.push(duration);
  }

  latencies.sort((a, b) => a - b);
  const p50 = latencies[Math.floor(iterations * 0.5)];
  const p95 = latencies[Math.floor(iterations * 0.95)];
  const p99 = latencies[Math.floor(iterations * 0.99)];
  const max = latencies[latencies.length - 1];

  console.log(`[CPU Benchmark] p50: ${p50.toFixed(4)}ms, p95: ${p95.toFixed(4)}ms, p99: ${p99.toFixed(4)}ms, max: ${max.toFixed(4)}ms`);

  assert.ok(p99 < 5.0, `p99 latency (${p99}ms) must be under S1 budget (< 5ms)`);
  assert.ok(max < 15.0, `max latency (${max}ms) must not show abnormal spikes`);
});
