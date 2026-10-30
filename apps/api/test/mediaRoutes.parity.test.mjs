// MIG-0646 RH-023/024/025: Hono integration on fake Cloudflare bindings.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { app } from "../src/app.ts";
import {
  clearPublicMediaAccessCacheForTest,
  PUBLIC_MEDIA_CACHE_CONTROL,
} from "../src/routes/media/publicMedia.ts";
import { createManageXIconUrl } from "../src/routes/media/manageXIcon.ts";

const SLOT = "slot_11111111-1111-4111-8111-111111111111";
const SIGNING_SECRET = "test-only-local-secret";
const bytes = new Uint8Array([1, 2, 3, 4]);
const validRow = {
  slot_status: "submitted",
  reserved_by_user_id: "u_owner",
  slot_x_user_id: "x_owner",
  slot_visibility_mode: "public_name",
  event_visibility_status: "public",
  creator_icon_url: "/api/media/video-icons/owner/icon.png",
};

function bindings({ allowed = 1, row = validRow, r2Fail = false, d1Fail = false, sessionUser = null, bucket = true } = {}) {
  const calls = { queries: [], objects: [], session: 0 };
  const env = {
    AUTH_SECRET: SIGNING_SECRET,
    DB: {
      prepare(sql) {
        calls.queries.push(sql);
        return {
          bind(...args) {
            return {
              async first() {
                if (d1Fail) throw Error("db down");
                if (sql.includes("FROM slots s")) return row;
                if (sql.includes('FROM "session" s')) {
                  calls.session++;
                  return sessionUser
                    ? {
                      session_expires: Date.now() + 100000,
                      user_id: sessionUser.id,
                      user_name: "user",
                      user_email: null,
                      user_image: null,
                      user_role: "user",
                      user_is_banned: sessionUser.banned ? 1 : 0,
                      user_active_x_user_id: sessionUser.xId,
                    }
                    : null;
                }
                return allowed ? { allowed: 1 } : null;
              },
            };
          },
        };
      },
    },
    ...(bucket ? { BUCKET: {
      async get(key) {
        calls.objects.push(key);
        if (r2Fail) throw Error("r2 down");
        return {
          size: bytes.byteLength,
          body: bytes,
          httpEtag: '"test-etag"',
          httpMetadata: { contentType: "image/png" },
        };
      },
    } } : {}),
  };
  return { env, calls };
}

const request = (path, env, headers = {}) =>
  app.request(`https://flamenode.net${path}`, { method: "GET", headers }, env);

test.beforeEach(() => clearPublicMediaAccessCacheForTest());

test("T01 public image: valid artifact, byte payload, type/TTL, 304 etag", async () => {
  const { env, calls } = bindings();
  const key = "/api/media/video-icons/owner/icon.png";
  const res = await request(key, env);
  assert.equal(res.status, 200);
  assert.deepEqual(new Uint8Array(await res.arrayBuffer()), bytes);
  assert.equal(res.headers.get("cache-control"), PUBLIC_MEDIA_CACHE_CONTROL);
  assert.equal(res.headers.get("content-type"), "image/png");
  assert.equal(res.headers.get("x-content-type-options"), "nosniff");
  assert.equal(calls.queries.length, 1);
  assert.deepEqual(calls.objects, ["video-icons/owner/icon.png"]);
  const conditional = await request(key, env, { "If-None-Match": '"test-etag"' });
  assert.equal(conditional.status, 304);
});

test("T01 invalid external/traversal key rejects before touching D1/R2", async () => {
  const { env, calls } = bindings();
  for (const path of [
    "/api/media/private/hidden.png",
    "/api/media/video-icons/%2e%2e/private.png",
    "/api/media/video-icons/evil%5csecret.png",
    "/api/media/video-icons/%00evil.png",
    "/api/media/video-icons/",
  ]) {
    const res = await request(path, env);
    assert.equal(res.status, 404, path);
  }
  assert.equal(calls.queries.length, 0);
  assert.equal(calls.objects.length, 0);
});

test("T04 public ACL before R2 and failure -> 503 with retry header", async () => {
  const p = bindings({ allowed: 0 });
  assert.equal((await request("/api/media/video-icons/owner/icon.png", p.env)).status, 404);
  assert.equal(p.calls.objects.length, 0);
  clearPublicMediaAccessCacheForTest();
  const broken = bindings({ d1Fail: true });
  const denied = await request("/api/media/video-icons/owner/icon.png", broken.env);
  assert.equal(denied.status, 503);
  assert.equal(denied.headers.get("retry-after"), "30");
  assert.equal(denied.headers.get("cache-control"), "no-store");
  assert.equal(broken.calls.objects.length, 0);
  clearPublicMediaAccessCacheForTest();
  const r2 = bindings({ r2Fail: true });
  const error = await request("/api/media/video-icons/owner/icon.png", r2.env);
  assert.equal(error.status, 503);
  assert.equal(error.headers.get("retry-after"), "30");
});

test("T02 signed X icon: valid GET/304 and tampered/expired/missing secret -> 404, never R2", async () => {
  const valid = await createManageXIconUrl("xicons/u/icon.png", SIGNING_SECRET);
  assert.ok(valid);
  const ok = bindings();
  const res = await request(valid, ok.env);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "image/png");
  assert.match(res.headers.get("cache-control"), /^private, max-age=\d+, must-revalidate$/);
  assert.deepEqual(ok.calls.objects, ["xicons/u/icon.png"]);
  const notModified = await request(valid, ok.env, { "If-None-Match": '"test-etag"' });
  assert.equal(notModified.status, 304);

  const bad = bindings();
  const corrupted = new URL(valid, "https://flamenode.net");
  corrupted.searchParams.set("sig", "corrupted");
  assert.equal((await request(corrupted.pathname + corrupted.search, bad.env)).status, 404);
  assert.equal((await request("/api/media/manage-x-icon/xicons/u/icon.png", bad.env)).status, 404);
  const expired = new URL(valid, "https://flamenode.net");
  expired.searchParams.set("exp", "1");
  assert.equal((await request(expired.pathname + expired.search, bad.env)).status, 404);
  const withoutSecret = { ...bad.env, AUTH_SECRET: undefined };
  assert.equal((await request(valid, withoutSecret)).status, 404);
  assert.deepEqual(bad.calls.objects, []);
});

test("T03 public slot icon requires only one D1 probe, no session; private hides from guests", async () => {
  const pub = bindings({ row: { ...validRow, creator_icon_url: "https://images.example/p.png" } });
  const image = await request(`/api/media/slot-submission-icon/${SLOT}`, pub.env);
  assert.equal(image.status, 302);
  assert.equal(image.headers.get("location"), "https://images.example/p.png");
  assert.equal(pub.calls.queries.length, 1);
  assert.equal(pub.calls.session, 0);

  const privateIcon = bindings({ row: { ...validRow, slot_visibility_mode: "anonymous" } });
  const hidden = await request(`/api/media/slot-submission-icon/${SLOT}`, privateIcon.env);
  assert.equal(hidden.status, 404);
  assert.equal(hidden.headers.get("cache-control"), "no-store");
  assert.equal(privateIcon.calls.objects.length, 0);
});

test("T03 private slot icon owner session allowed, other/banned users denied and not cached", async () => {
  for (const [sessionUser, expected] of [
    [{ id: "u_owner", xId: "other-x", banned: false }, 200],
    [{ id: "u_other", xId: "other-x", banned: false }, 404],
    [{ id: "u_owner", xId: "x_owner", banned: true }, 404],
  ]) {
    const { env, calls } = bindings({
      row: { ...validRow, slot_visibility_mode: "anonymous" },
      sessionUser,
    });
    const response = await request(`/api/media/slot-submission-icon/${SLOT}`, env, {
      cookie: "__Secure-authjs.session-token=test-session",
    });
    assert.equal(response.status, expected);
    assert.equal(calls.queries.length, 2, "D1 slot probe then Auth.js session lookup");
    assert.equal(calls.session, 1);
    if (expected === 200) {
      assert.match(response.headers.get("cache-control"), /no-store/);
      assert.deepEqual(calls.objects, ["video-icons/owner/icon.png"]);
    } else {
      assert.equal(calls.objects.length, 0);
    }
  }
});

test("T04 invalid slot and storage outage, no storage on malformed id", async () => {
  const { env, calls } = bindings();
  const bad = await request("/api/media/slot-submission-icon/bad", env);
  assert.equal(bad.status, 404);
  assert.equal(calls.queries.length, 0);
  const storage = bindings({ d1Fail: true });
  const denied = await request(`/api/media/slot-submission-icon/${SLOT}`, storage.env);
  assert.equal(denied.status, 503);
  assert.equal(denied.headers.get("retry-after"), "30");
  const missing = await request(`/api/media/slot-submission-icon/${SLOT}`, { DB: env.DB });
  assert.equal(missing.status, 503);
});

test("T04: throwing Cloudflare binding getters fail closed without leaking provider errors", async () => {
  const sentinel = "PRIVATE_MEDIA_GETTER_SENTINEL";
  for (const key of ["DB", "BUCKET"]) {
    const { env, calls } = bindings();
    Object.defineProperty(env, key, {
      configurable: true,
      get() { throw new Error(sentinel); },
    });
    for (const path of [
      "/api/media/video-icons/owner/icon.png",
      `/api/media/slot-submission-icon/${SLOT}`,
    ]) {
      clearPublicMediaAccessCacheForTest();
      const response = await request(path, env);
      assert.equal(response.status, 503, key + " " + path);
      assert.equal(response.headers.get("cache-control"), "no-store");
      assert.equal(response.headers.get("retry-after"), "30");
      assert.doesNotMatch(await response.text(), /PRIVATE_MEDIA_GETTER_SENTINEL/);
    }
    assert.equal(calls.queries.length, 0);
    assert.equal(calls.objects.length, 0);
  }
  for (const key of ["BUCKET", "AUTH_SECRET"]) {
    const { env, calls } = bindings();
    Object.defineProperty(env, key, {
      configurable: true,
      get() { throw new Error(sentinel); },
    });
    const response = await request("/api/media/manage-x-icon/xicons/u/icon.png", env);
    assert.equal(response.status, 404, key);
    assert.doesNotMatch(await response.text(), /PRIVATE_MEDIA_GETTER_SENTINEL/);
    assert.deepEqual(calls.objects, []);
    assert.deepEqual(calls.queries, []);
  }
});

test("T04: public Cache API HIT does not touch a throwing DB or BUCKET getter", async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "caches");
  const { env, calls } = bindings();
  const sentinel = "CACHE_HIT_MUST_NOT_READ_BINDINGS";
  for (const key of ["DB", "BUCKET"]) {
    Object.defineProperty(env, key, {
      configurable: true,
      get() { throw new Error(sentinel); },
    });
  }
  Object.defineProperty(globalThis, "caches", {
    configurable: true,
    value: {
      default: {
        async match() {
          return new Response(new Uint8Array(bytes), {
            headers: { "content-type": "image/png", "etag": '"cached"' },
          });
        },
      },
    },
  });
  try {
    const response = await request("/api/media/video-icons/owner/icon.png", env);
    assert.equal(response.status, 200);
    assert.deepEqual(new Uint8Array(await response.arrayBuffer()), bytes);
    assert.equal(calls.queries.length, 0);
    assert.equal(calls.objects.length, 0);
  } finally {
    if (original) Object.defineProperty(globalThis, "caches", original);
    else delete globalThis.caches;
  }
});

test("GET-only and CURRENT signature 404 contract despite task card T02 saying 403", async () => {
  const { env } = bindings();
  const res = await app.request("https://flamenode.net/api/media/video-icons/owner/icon.png", { method: "POST" }, env);
  assert.equal(res.status, 404);
  const nextRoute = readFileSync(new URL("../../../app/api/media/manage-x-icon/[...key]/route.ts", import.meta.url), "utf8");
  const currentSource = readFileSync(new URL("../../../src/lib/media/manageXIcon.ts", import.meta.url), "utf8");
  assert.match(nextRoute, /serveManageXIcon/);
  assert.match(currentSource, /if \(!validSignature\)\s*\{\s*return new Response\("Not found", \{ status: 404 \}\)/);
});
