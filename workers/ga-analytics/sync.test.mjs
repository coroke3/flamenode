import assert from "node:assert/strict";
import { test } from "node:test";
import {
  GA4_RECENT_LIST_KEY,
  GA4_TRENDING_OUTPUT_KEY,
  syncGa4Trending,
} from "./sync.ts";

function recentPayload() {
  return JSON.stringify({
    generated_at: 1_700_000_000,
    total: 1,
    items: [
      {
        id: "video-a",
        title: "A",
        youtube_video_id: "yt-a",
        display_name: "creator",
        scheduled_time: 1_700_000_000,
        status: "public",
      },
    ],
  });
}

test("syncGa4Trending skips when GA4_SYNC_ENABLED is not 1", async () => {
  let putCalls = 0;
  const env = {
    GA4_SYNC_ENABLED: "0",
    R2: {
      get() {
        throw new Error("unexpected R2 get");
      },
      put() {
        putCalls += 1;
        throw new Error("unexpected R2 put");
      },
    },
    KV: { get() { throw new Error("unexpected KV get"); } },
  };

  const result = await syncGa4Trending(env);
  assert.equal(result.skipped, 1);
  assert.equal(putCalls, 0);
});

test("syncGa4Trending fail-closed: does not put trending.json on GA failure", async () => {
  let putCalls = 0;
  const env = {
    GA4_SYNC_ENABLED: "1",
    GA4_PROPERTY_ID: "123",
    GA4_SERVICE_ACCOUNT_EMAIL: "svc@example.com",
    GA4_SERVICE_ACCOUNT_PRIVATE_KEY: "-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----",
    R2: {
      get(key) {
        assert.equal(key, GA4_RECENT_LIST_KEY);
        return {
          async text() {
            return recentPayload();
          },
        };
      },
      put(key) {
        putCalls += 1;
        assert.equal(key, GA4_TRENDING_OUTPUT_KEY);
      },
    },
    KV: {
      async get() {
        return null;
      },
    },
  };

  await assert.rejects(
    () => syncGa4Trending(env),
    /ga4_service_account_config_missing|ga4_oauth|ga4_report|invalid/i,
  );
  assert.equal(putCalls, 0);
});

test("syncGa4Trending puts empty items when GA returns no matching views", async () => {
  let putBody = "";
  const env = {
    GA4_SYNC_ENABLED: "1",
    GA4_PROPERTY_ID: "123",
    GA4_SERVICE_ACCOUNT_EMAIL: "svc@example.com",
    GA4_SERVICE_ACCOUNT_PRIVATE_KEY:
      "-----BEGIN PRIVATE KEY-----\\nMIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQC7VJTUt9Us8cKB\nwI/EUEP8zBksFHPNMyWUdXJLKf/PssAtb2xRHmpM2fo8pYE7L3R5Bo1w4Mkw0ujX\njbNkNN6Ts8WfMgW56DjmXOfVZ8GKZr6fkEXNAfqFKvXYnGWqPa5VbX5c25ll1G27\nh4wLswBP0A16aMpjG1CNdP/ZMEPuB5HzR/5N5Rtt0h9Nekxd4mjUy/2ABEj8M4O9\nX0m6vXh+2J0hmW6zupJRW5s87qXUoYONX3awfIy45C740C+V1pRyvyPtTCXbag9\nP4ZGd9xZng8PDvqcIGfudkGT2ioWEHTuH2N36KAQmQfi8tmTkEdOpaulgwsHovCN\nBZUs9ipQAgMBAAECggEBAKTmjaS6tkK8BlPXClTQ2vpz/N6uxDeS35mXpqasqskV\nlaAidgg/zKNuOmgW2gauvlKJVejU8JEK4RyFVE3wyGkcgtcRcJ/qMMNOIynlhFzS\nf1MZKSAzZTxaxHFrerY2Ra2FAo5A5PUDHYtKurOcmVHwVXwOV9D5K8AA5+4zxE7N\nzQLT2vnKojZlBA9VPeNSfR2wJi1B0TAZ4rIpuTe4OzlTdRovTbF5DZP0PBz+SSIG\nZ2ZhMj1oZFhkbSdXQVhVbTl2WVhNemtNVEV6TkMweE1UUXhMVEUzTURBdE9UUTFOQzA0\nTlRBMk1UWXhPVFk1T1RBZ0VBQW9HQkFOLWNwemJHTVhpNWhZbUpwYVdOa0lHOSs=\n-----END PRIVATE KEY-----",
    R2: {
      get(key) {
        assert.equal(key, GA4_RECENT_LIST_KEY);
        return {
          async text() {
            return recentPayload();
          },
        };
      },
      put(key, body, options) {
        assert.equal(key, GA4_TRENDING_OUTPUT_KEY);
        putBody = String(body);
        assert.equal(
          options?.httpMetadata?.contentType,
          "application/json; charset=utf-8",
        );
        assert.equal(
          options?.httpMetadata?.cacheControl,
          "public, max-age=300, stale-while-revalidate=3600",
        );
      },
    },
    KV: {
      async get() {
        return JSON.stringify({
          access_token: "cached-token",
          expires_at: Math.floor(Date.now() / 1000) + 3600,
        });
      },
    },
  };

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.includes("analyticsdata.googleapis.com")) {
      return new Response(
        JSON.stringify({
          dimensionHeaders: [
            { name: "dateRange" },
            { name: "customEvent:video_id" },
          ],
          metricHeaders: [{ name: "eventCount" }],
          rowCount: 0,
          rows: [],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    return originalFetch(input, init);
  };

  try {
    const result = await syncGa4Trending(env);
    assert.equal(result.processed, 0);
    assert.equal(result.failed, 0);
    const payload = JSON.parse(putBody);
    assert.equal(payload.schema_version, 1);
    assert.equal(payload.source, "ga4");
    assert.deepEqual(payload.ranking_rule, [
      "views_2d_desc",
      "views_5d_desc",
      "views_7d_desc",
      "views_30d_desc",
      "video_id_asc",
    ]);
    assert.ok(payload.windows?.views_2d?.start_date);
    assert.ok(payload.windows?.views_2d?.end_date);
    assert.ok(Number.isFinite(payload.generated_at));
    assert.ok(Array.isArray(payload.items));
    assert.equal(payload.items.length, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
