import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createManageXIconUrl,
  extractManageXIconKey,
  normalizeManageXIconKey,
  resolveManageXIconUrl,
  serveManageXIcon,
  verifyManageXIconSignatureInput,
  MANAGE_X_ICON_TTL_SECONDS,
} from "./manageXIcon.ts";

const SECRET = "manage-icon-test-secret";

test("署名検証は不正な入力を例外にせず fail-closed する", async () => {
  assert.equal(
    await verifyManageXIconSignatureInput({
      key: "xicons/user/icon.webp",
      expiresAt: 100,
      signature: undefined,
      secret: SECRET,
      now: 0,
    }),
    false,
  );
  assert.equal(
    await verifyManageXIconSignatureInput({
      key: "xicons/user/icon.webp",
      expiresAt: 100,
      signature: "not-a-signature",
      secret: SECRET,
      now: -1,
    }),
    false,
  );
});

function parseSignedUrl(url) {
  const parsed = new URL(`https://example.test${url}`);
  return {
    key: parsed.pathname.replace("/api/media/manage-x-icon/", ""),
    params: parsed.searchParams,
  };
}

test("Manage X icon namespace は xicons / x-icons のみを許可する", () => {
  assert.equal(normalizeManageXIconKey("xicons/user/icon.webp"), "xicons/user/icon.webp");
  assert.equal(normalizeManageXIconKey("x-icons/user/icon.webp"), "x-icons/user/icon.webp");
  for (const key of [
    "video-icons/user/icon.webp",
    "event-icons/event/icon.webp",
    "event-banners/event/banner.webp",
    "xicons/staging/user.webp",
    "xicons/../secret.webp",
    "xicons/user\\icon.webp",
    "xicons/user/icon.webp?raw=1",
    "xicons/",
  ]) {
    assert.equal(normalizeManageXIconKey(key), null, key);
  }
});

test("icon URL helper は外部 HTTPSを維持し、承認済み内部URLだけ署名する", async () => {
  assert.equal(
    extractManageXIconKey("/api/media/xicons/user/icon.webp"),
    "xicons/user/icon.webp",
  );
  assert.equal(extractManageXIconKey("/api/media/video-icons/user/icon.webp"), null);
  assert.equal(
    await resolveManageXIconUrl({
      iconUrl: "https://images.example/icon.webp",
      approvalStatus: "pending",
      authSecret: undefined,
    }),
    "https://images.example/icon.webp",
  );
  assert.equal(
    await resolveManageXIconUrl({
      iconUrl: "/api/media/xicons/user/icon.webp",
      approvalStatus: "pending",
      authSecret: SECRET,
    }),
    null,
  );
  const signed = await resolveManageXIconUrl({
    iconUrl: "/api/media/xicons/user/icon.webp",
    approvalStatus: "approved",
    authSecret: SECRET,
    options: { now: 1_000 },
  });
  assert.ok(signed?.startsWith("/api/media/manage-x-icon/xicons/user/icon.webp?"));
  const { params } = parseSignedUrl(signed);
  assert.equal(Number(params.get("exp")), 1_260);
  const sameBucket = await createManageXIconUrl("xicons/user/icon.webp", SECRET, { now: 1_010 });
  assert.equal(parseSignedUrl(sameBucket).params.get("exp"), params.get("exp"));
  const nextBucket = await createManageXIconUrl("xicons/user/icon.webp", SECRET, { now: 1_060 });
  assert.notEqual(parseSignedUrl(nextBucket).params.get("exp"), params.get("exp"));
  assert.ok(Number(params.get("exp")) - 1_000 <= MANAGE_X_ICON_TTL_SECONDS);
  assert.ok(params.get("sig"));
});

function makeBucket(state, { contentType = "image/webp", size = 128 } = {}) {
  return {
    async get(key) {
      state.keys.push(key);
      return {
        size,
        body: new Uint8Array([1, 2, 3]),
        httpEtag: '"manage-etag"',
        httpMetadata: { contentType },
      };
    },
  };
}

test("署名不正・期限切れ・namespace不正はR2 GETせず404", async () => {
  const now = Math.floor(Date.now() / 1000);
  const signed = await createManageXIconUrl("xicons/user/icon.webp", SECRET, { now });
  assert.ok(signed);
  const parsed = parseSignedUrl(signed);
  const state = { keys: [] };
  const env = { AUTH_SECRET: SECRET, BUCKET: makeBucket(state) };

  const tampered = new URL(`https://example.test${signed}`);
  tampered.searchParams.set("sig", `${parsed.params.get("sig")}tampered`);
  const bad = await serveManageXIcon(
    env,
    parsed.key,
    new Request(tampered),
  );
  assert.equal(bad.status, 404);
  assert.deepEqual(state.keys, []);

  const expired = new URL(`https://example.test${signed}`);
  expired.searchParams.set("exp", String(now - 1));
  const old = await serveManageXIcon(
    env,
    parsed.key,
    new Request(expired),
  );
  assert.equal(old.status, 404);
  assert.deepEqual(state.keys, []);

  const wrongNamespace = await serveManageXIcon(
    env,
    "event-icons/event/icon.webp",
    new Request(`https://example.test${signed}`),
  );
  assert.equal(wrongNamespace.status, 404);
  assert.deepEqual(state.keys, []);
});

test("有効な署名はD1なしでR2を1回だけ読み、private cacheとETagを返す", async () => {
  const now = Math.floor(Date.now() / 1000);
  const signed = await createManageXIconUrl("xicons/user/icon.webp", SECRET, { now });
  assert.ok(signed);
  const parsed = parseSignedUrl(signed);
  const state = { keys: [] };
  const response = await serveManageXIcon(
    { AUTH_SECRET: SECRET, BUCKET: makeBucket(state) },
    parsed.key,
    new Request(`https://example.test${signed}`),
  );
  assert.equal(response.status, 200);
  assert.deepEqual(state.keys, ["xicons/user/icon.webp"]);
  assert.equal(response.headers.get("content-type"), "image/webp");
  assert.match(response.headers.get("cache-control") ?? "", /^private, max-age=/);
  assert.equal(response.headers.get("etag"), '"manage-etag"');
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
});

test("有効署名でもunsafe MIME/sizeは404", async () => {
  const now = Math.floor(Date.now() / 1000);
  const signed = await createManageXIconUrl("xicons/user/icon.webp", SECRET, { now });
  const parsed = parseSignedUrl(signed);
  for (const options of [
    { contentType: "image/svg+xml" },
    { size: 5 * 1024 * 1024 + 1 },
  ]) {
    const state = { keys: [] };
    const response = await serveManageXIcon(
      { AUTH_SECRET: SECRET, BUCKET: makeBucket(state, options) },
      parsed.key,
      new Request(`https://example.test${signed}`),
    );
    assert.equal(response.status, 404);
    assert.deepEqual(state.keys, [parsed.key]);
  }
});
