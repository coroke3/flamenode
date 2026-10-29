import assert from "node:assert/strict";
import { test } from "node:test";
import { app } from "../src/app.ts";
import { clearPublicApiRateLimitForTests } from "@flamenode/server-core/publicData/publicApi";
import { PUBLIC_VISIBILITY_BLOCKED_ENTITIES_OBJECT_KEY } from "@flamenode/server-core/visibility/manifestCore";

const endpoint = "https://flamenode.example/api/public/events/PVSF2026Sp/staff";
const manifest = (entities = []) => ({
  schema_version: 1, revision: 1, generated_at: 1700000000, entities,
});
const artifact = (extra = {}) => ({
  generated_at: 1700000000,
  event: { id: "PVSF2026Sp", title: "PVSF2026", visibility_status: "public" },
  public_staff: [{
    display_name: "Organizer", public_role_label: "主催",
    x_user_id: "Organizer_1", x_name: "Organizer", icon_url: "/icon.jpg",
    has_public_profile: true, permission_preset: "owner", internal_note: "secret",
  }],
  ...extra,
});
function bucketFixture({
  before = manifest(), after = before, body = artifact(),
  missing = false, eventTooLarge = false, failManifest = false,
} = {}) {
  const calls = [];
  let reads = 0;
  let cancelled = 0;
  return {
    calls,
    get cancelled() { return cancelled; },
    async get(key) {
      calls.push(key);
      if (key === PUBLIC_VISIBILITY_BLOCKED_ENTITIES_OBJECT_KEY) {
        if (failManifest) throw new Error("provider secret from R2");
        reads += 1;
        const value = reads === 1 ? before : after;
        if (value === null) return null;
        const serial = JSON.stringify(value);
        return { size: serial.length, etag: reads === 1 ? "before" : (after === before ? "before" : "after"), text: async () => serial };
      }
      if (key === "events/PVSF2026Sp/base.v1.json") {
        if (missing) return null;
        return {
          size: eventTooLarge ? 2 * 1024 * 1024 + 1 : JSON.stringify(body).length,
          json: async () => body,
          body: { cancel: async () => { cancelled++; } },
        };
      }
      throw new Error("unexpected key: " + key);
    },
  };
}
async function request(bucket, init = {}, url = endpoint) {
  return app.request(url, init, { BUCKET: bucket });
}
function fenced(entityType, entityId) {
  return { entity_type: entityType, entity_id: entityId, fence_token: "f1", blocked_at: 1700000000 };
}

test("MIG-0647 T01 OPTIONS CORS allowlist only allows If-None-Match and GET/HEAD", async () => {
  clearPublicApiRateLimitForTests();
  for (const origin of ["https://pvsf.jp", "https://www.pvsf.jp"]) {
    const res = await request(null, {
      method: "OPTIONS",
      headers: {
        Origin: origin,
        "Access-Control-Request-Method": "GET",
        "Access-Control-Request-Headers": "If-None-Match",
      },
    });
    assert.equal(res.status, 204);
    assert.equal(res.headers.get("Access-Control-Allow-Origin"), origin);
    assert.equal(res.headers.get("Access-Control-Allow-Methods"), "GET, HEAD, OPTIONS");
    assert.equal(res.headers.get("Access-Control-Allow-Headers"), "If-None-Match");
    assert.equal(res.headers.get("Access-Control-Expose-Headers"), "ETag, Retry-After");
    assert.match(res.headers.get("Vary") ?? "", /Access-Control-Request-Headers/);
    assert.equal(res.headers.get("Cloudflare-CDN-Cache-Control"), "no-store");
  }
  for (const headers of [
    { Origin: "https://attacker.example" },
    { Origin: "https://pvsf.jp", "Access-Control-Request-Method": "POST" },
    { Origin: "https://pvsf.jp", "Access-Control-Request-Headers": "Authorization" },
    {},
  ]) {
    const res = await request(null, { method: "OPTIONS", headers });
    assert.equal(res.status, 403);
    assert.equal(res.headers.get("Cache-Control"), "no-store");
  }
});

test("MIG-0647 T02 public artifact returns allowlist staff, headers and same-origin no-store CDN", async () => {
  const b = bucketFixture();
  const res = await request(b, { headers: { Origin: "https://pvsf.jp" } });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("Access-Control-Allow-Origin"), "https://pvsf.jp");
  assert.equal(res.headers.get("Cache-Control"), "public, max-age=0, must-revalidate");
  assert.equal(res.headers.get("Cloudflare-CDN-Cache-Control"), "no-store");
  assert.equal(res.headers.get("X-Content-Type-Options"), "nosniff");
  assert.ok(res.headers.get("ETag"));
  assert.deepEqual(await res.json(), {
    schema_version: 1, event_id: "PVSF2026Sp", generated_at: 1700000000,
    staff: [{
      display_name: "Organizer", role_label: "主催", x_id: "organizer_1",
      x_name: "Organizer", icon_url: "/icon.jpg", has_public_profile: true,
    }],
  });
  assert.deepEqual(b.calls, [
    PUBLIC_VISIBILITY_BLOCKED_ENTITIES_OBJECT_KEY,
    "events/PVSF2026Sp/base.v1.json",
    PUBLIC_VISIBILITY_BLOCKED_ENTITIES_OBJECT_KEY,
  ]);
  const conditional = await request(bucketFixture(), { headers: { "If-None-Match": res.headers.get("ETag") } });
  // CURRENT publicJsonResponse returns 304 for a matching ETag (spec's T03 prose is outdated).
  assert.equal(conditional.status, 304);
});

test("MIG-0647 T02 unavailable/private/missing inputs fail closed with no secret leakage", async () => {
  const cases = [
    { b: bucketFixture({ missing: true }), status: 503, code: "public_data_unavailable" },
    { b: bucketFixture({ body: artifact({ event: { id: "PVSF2026Sp", title: "Hidden", visibility_status: "private" } }) }), status: 503, code: "public_data_unavailable" },
    { b: bucketFixture({ before: null }), status: 503, code: "public_visibility_manifest_unavailable" },
    { b: bucketFixture({ failManifest: true }), status: 503, code: "public_visibility_manifest_unavailable" },
    { b: bucketFixture({ eventTooLarge: true }), status: 503, code: "public_data_unavailable" },
    { b: bucketFixture({ before: manifest([fenced("event", "PVSF2026Sp")]) }), status: 404, code: "not_found" },
  ];
  for (const { b, status, code } of cases) {
    const res = await request(b);
    assert.equal(res.status, status);
    assert.deepEqual(await res.json(), { error: code });
    assert.equal(res.headers.get("Cloudflare-CDN-Cache-Control"), "no-store");
  }
  const cap = bucketFixture({ eventTooLarge: true });
  await request(cap);
  assert.equal(cap.cancelled, 1);
  const invalid = await request(null, {}, "https://flamenode.example/api/public/events/%2F/staff");
  assert.equal(invalid.status, 404);
  const noBinding = await request(null);
  assert.equal(noBinding.status, 503);
  assert.deepEqual(await noBinding.json(), { error: "runtime_r2_binding_unavailable" });
});

test("MIG-0647 T02 blocked staff X identities are filtered before public projection", async () => {
  const b = bucketFixture({ before: manifest([fenced("x_user", "organizer_1")]) });
  const res = await request(b);
  assert.equal(res.status, 200);
  assert.deepEqual((await res.json()).staff, []);
});

test("MIG-0647 T03 manifest changed or blocked between reads never returns stale staff or 304", async () => {
  const changed = bucketFixture({ before: manifest(), after: manifest([fenced("x_user", "organizer_1")]) });
  const res = await request(changed, { headers: { "If-None-Match": "*" } });
  assert.equal(res.status, 503);
  assert.deepEqual(await res.json(), { error: "public_visibility_manifest_changed" });
  const blocked = bucketFixture({ before: manifest(), after: manifest([fenced("event", "PVSF2026Sp")]) });
  const denied = await request(blocked);
  assert.equal(denied.status, 404);
  assert.deepEqual(await denied.json(), { error: "not_found" });
});
