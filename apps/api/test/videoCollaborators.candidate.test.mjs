import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { createVideoCollaboratorRoutes } from "../src/routes/videos/collaborators.ts";

const videoId = "v1";
const route = "/v1/collaborators";
const jsonHeaders = { "content-type": "application/json" };
const canonicalBatch = {
  video_id: videoId,
  intents: [{ x_user_id: "@alice", display_name: "Alice", intent: "on" }],
};

function fixture({ guardState = true } = {}) {
  let guarded = 0;
  let wakeCalls = 0;
  let prematureReads = 0;
  const host = {
    writeGuard: async (c, next) => {
      guarded++;
      c.header("Cache-Control", "private, no-store");
      if (guardState) {
        c.set("user", { id: "actor", role: null });
        c.set("auditSettings", {});
        c.set("actorSnapshotJsonById", { actor: "{}" });
        c.set("db", new Proxy({}, {
          get() {
            prematureReads++;
            throw Error("unexpected D1 read");
          },
        }));
      }
      await next();
    },
    loadWakeHost: async () => {
      wakeCalls++;
      throw Error("Queue port must not be reached before a valid atomic write");
    },
  };
  const app = createVideoCollaboratorRoutes(host);
  async function request(method, path, body) {
    return app.request(path, {
      method,
      headers: jsonHeaders,
      body: typeof body === "string" ? body : JSON.stringify(body),
    }, { NEXT_PUBLIC_SITE_URL: "https://example.test" });
  }
  return {
    request,
    stats: () => ({ guarded, wakeCalls, prematureReads }),
  };
}

test("MIG-0650 candidate is explicitly unmounted in the active videos router", async () => {
  const source = await readFile(
    new URL("../src/routes/videos/index.ts", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(source, /collaborators\.ts/);
  assert.doesNotMatch(source, /createVideoCollaboratorRoutes/);
});

test("SA-082 invalid upsert is rejected before D1 or Queue wake", async () => {
  const f = fixture();
  const res = await f.request("POST", route, {
    video_id: videoId, x_user_id: "http://evil.invalid/",
    display_name: "Invalid", can_edit: "1",
  });
  assert.equal(res.status, 400);
  assert.equal(res.headers.get("cache-control"), "private, no-store");
  assert.equal((await res.json()).ok, false);
  assert.deepEqual(f.stats(), { guarded: 1, wakeCalls: 0, prematureReads: 0 });
});

test("SA-082 path and submitted video IDs must match", async () => {
  const f = fixture();
  const res = await f.request("POST", route, {
    video_id: "other-video", x_user_id: "@alice", display_name: "Alice",
  });
  assert.equal(res.status, 400);
  assert.match((await res.json()).message, /video_id/);
  assert.deepEqual(f.stats(), { guarded: 1, wakeCalls: 0, prematureReads: 0 });
});

test("SA-083 delete rejects oversized video ID before D1", async () => {
  const f = fixture();
  const res = await f.request("DELETE", "/" + "v".repeat(65) + "/collaborators", {
    x_user_id: "alice",
  });
  assert.equal(res.status, 400);
  assert.deepEqual(f.stats(), { guarded: 1, wakeCalls: 0, prematureReads: 0 });
});

test("SA-083 delete rejects missing or malformed X identities before D1", async () => {
  const f = fixture();
  for (const bad of [{}, { x_user_id: "../admin" }, { x_user_id: "a".repeat(33) }]) {
    const res = await f.request("DELETE", route, bad);
    assert.equal(res.status, 400);
    assert.match((await res.json()).message, /X ID/);
  }
  assert.deepEqual(f.stats(), { guarded: 3, wakeCalls: 0, prematureReads: 0 });
});

test("SA-084 rejects empty, 101-row and malformed batches before D1", async () => {
  const f = fixture();
  for (const intents of [
    [],
    Array.from({ length: 101 }, (_, i) => ({
      x_user_id: "user" + i, display_name: "User", intent: "on",
    })),
    [{ x_user_id: "admin/evil", display_name: "Admin", intent: "on" }],
  ]) {
    const res = await f.request("POST", route + "/batch", { video_id: videoId, intents });
    assert.equal(res.status, 400);
    assert.equal((await res.json()).ok, false);
  }
  assert.deepEqual(f.stats(), { guarded: 3, wakeCalls: 0, prematureReads: 0 });
});

test("SA-084 rejects mismatching video ID before authorization DB query", async () => {
  const f = fixture();
  const res = await f.request("POST", route + "/batch", {
    ...canonicalBatch, video_id: "other",
  });
  assert.equal(res.status, 400);
  assert.deepEqual(f.stats(), { guarded: 1, wakeCalls: 0, prematureReads: 0 });
});

test("all endpoints limit body bytes even without Content-Length honesty", async () => {
  const f = fixture();
  const huge = JSON.stringify({ video_id: videoId, extra: "x".repeat(66000) });
  for (const [method, path] of [
    ["POST", route], ["DELETE", route], ["POST", route + "/batch"],
  ]) {
    const res = await f.request(method, path, huge);
    assert.equal(res.status, 413);
    assert.match((await res.json()).message, /大きすぎ/);
  }
  assert.deepEqual(f.stats(), { guarded: 3, wakeCalls: 0, prematureReads: 0 });
});

test("valid batch with missing authenticated guard context fails closed", async () => {
  const f = fixture({ guardState: false });
  const res = await f.request("POST", route + "/batch", canonicalBatch);
  assert.equal(res.status, 503);
  assert.equal((await res.json()).ok, false);
  assert.deepEqual(f.stats(), { guarded: 1, wakeCalls: 0, prematureReads: 0 });
});
