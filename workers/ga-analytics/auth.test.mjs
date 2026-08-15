import assert from "node:assert/strict";
import { test } from "node:test";

import { ExternalRequestBudget } from "../shared/externalApi.ts";
import {
  GA4_ACCESS_TOKEN_KV_KEY,
  getGa4AccessToken,
} from "./auth.ts";

async function testPrivateKeyPem() {
  const generated = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );
  const der = await crypto.subtle.exportKey("pkcs8", generated.privateKey);
  const encoded = Buffer.from(der).toString("base64");
  return `-----BEGIN PRIVATE KEY-----\n${encoded}\n-----END PRIVATE KEY-----`;
}

test("GA4 access token はKV読取障害でもOAuth交換へ進む", async () => {
  const privateKey = await testPrivateKeyPem();
  let oauthCalls = 0;
  let putCalls = 0;
  const env = {
    KV: {
      async get(key) {
        assert.equal(key, GA4_ACCESS_TOKEN_KV_KEY);
        throw new Error("KV temporarily unavailable");
      },
      async put(key) {
        assert.equal(key, GA4_ACCESS_TOKEN_KV_KEY);
        putCalls += 1;
      },
    },
    GA4_SERVICE_ACCOUNT_EMAIL: "svc@example.com",
    GA4_SERVICE_ACCOUNT_PRIVATE_KEY: privateKey,
  };
  const token = await getGa4AccessToken(
    env,
    new ExternalRequestBudget(1),
    async (url, init) => {
      oauthCalls += 1;
      assert.equal(String(url), "https://oauth2.googleapis.com/token");
      assert.equal(init?.method, "POST");
      return new Response(
        JSON.stringify({ access_token: "fresh-token", expires_in: 3600 }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    },
  );
  assert.equal(token, "fresh-token");
  assert.equal(oauthCalls, 1);
  assert.equal(putCalls, 1);
});

test("GA4 access token はKV読取完了境界のabortを握り潰さない", async () => {
  const controller = new AbortController();
  const reason = new DOMException("cron deadline", "AbortError");
  const env = {
    KV: {
      async get() {
        controller.abort(reason);
        return JSON.stringify({
          access_token: "cached-token",
          expires_at: Math.floor(Date.now() / 1000) + 3600,
        });
      },
      async put() {},
    },
    GA4_SERVICE_ACCOUNT_EMAIL: "svc@example.com",
    GA4_SERVICE_ACCOUNT_PRIVATE_KEY: "unused",
  };
  await assert.rejects(
    () =>
      getGa4AccessToken(
        env,
        new ExternalRequestBudget(1),
        async () => {
          throw new Error("OAuth must not start after abort");
        },
        controller.signal,
      ),
    (error) => error === reason,
  );
});
