import test from "node:test";
import assert from "node:assert/strict";
import { Hono } from "hono";
import { visibilityRepairAdminRoutes } from "../src/routes/admin/visibilityRepair.ts";
import { createAdminD1, seedBase } from "./helpers/sqliteD1.mjs";
import { PUBLIC_VISIBILITY_BLOCKED_ENTITIES_OBJECT_KEY } from "@flamenode/server-core/visibility/manifestCore";
import { AdminVisibilityRepairResultSchema } from "@flamenode/contracts/admin/staticRebuildOps";

const ADMIN = { id: "admin-1", role: "admin", is_banned: 0 };
function manifest(type = "video", id = "v1", token = "t1") {
  return {
    schema_version: 1, revision: 1, generated_at: 100,
    entities: [{ entity_type: type, entity_id: id, fence_token: token, blocked_at: 100, reason: null }],
  };
}

function fakeBucket(initial = manifest(), onPut = null) {
  let value = initial;
  let etag = initial ? "etag-1" : null;
  const stats = { gets: 0, puts: 0 };
  return {
    stats,
    value: () => value,
    set(value2, etag2) { value = value2; etag = etag2; },
    async get(key) {
      assert.equal(key, PUBLIC_VISIBILITY_BLOCKED_ENTITIES_OBJECT_KEY);
      stats.gets++;
      if (!value) return null;
      const text = JSON.stringify(value);
      return { etag, size: new TextEncoder().encode(text).byteLength, text: async () => text };
    },
    async put(key, data, options) {
      assert.equal(key, PUBLIC_VISIBILITY_BLOCKED_ENTITIES_OBJECT_KEY);
      stats.puts++;
      if (onPut?.(this)) return null;
      const requestedEtag = options?.onlyIf?.etagMatches;
      if (requestedEtag !== etag) return null;
      value = JSON.parse(data);
      etag = "etag-" + (stats.puts + 1);
      return { etag };
    },
  };
}

function setup({ initial, onPut, fence } = {}) {
  const d1 = createAdminD1();
  seedBase(d1.sqlite);
  d1.sqlite.exec(`
    CREATE TABLE public_visibility_fences (
      entity_type TEXT, entity_id TEXT, fence_token TEXT, state TEXT,
      PRIMARY KEY(entity_type, entity_id)
    );
  `);
  if (fence) d1.sqlite.prepare(
    "INSERT INTO public_visibility_fences (entity_type,entity_id,fence_token,state) VALUES (?,?,?,?)",
  ).run(fence.entity_type ?? "video", fence.entity_id ?? "v1", fence.fence_token ?? "t1", fence.state);
  const bucket = fakeBucket(initial === undefined ? manifest() : initial, onPut);
  const app = new Hono();
  app.use("*", async (c, next) => { c.set("user", ADMIN); await next(); });
  app.route("/api/admin/visibility-repair", visibilityRepairAdminRoutes);
  const request = (body = { entity_type: "video", entity_id: "v1", fence_token: "t1" }) =>
    app.request("/api/admin/visibility-repair", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }, { DB: d1.db, BUCKET: bucket });
  return { ...d1, bucket, request };
}

test("MIG-0643 U03: matching released D1 fence + matching R2 token -> CAS removal", async () => {
  const s = setup({ fence: { state: "released" } });
  const res = await s.request();
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { visibility_repair: "repaired" });
  assert.equal(s.bucket.value().entities.length, 0);
  assert.equal(s.bucket.value().revision, 2);
  assert.equal(s.bucket.stats.puts, 1);
  assert.equal(s.stats.reads, 2, "CostGuard and one D1 fence read");
  assert.equal(s.stats.batches, 0);
});

test("MIG-0643 U03: active or other-token D1 fence blocks before R2 read/write", async () => {
  for (const fence of [{ state: "blocked" }, { state: "release_pending" }, { state: "released", fence_token: "other" }]) {
    const s = setup({ fence });
    const res = await s.request();
    assert.deepEqual(await res.json(), { visibility_repair: "d1_fence_present" });
    assert.equal(s.bucket.stats.gets, 0);
    assert.equal(s.bucket.stats.puts, 0);
    assert.equal(s.stats.batches, 0);
  }
});

test("MIG-0643 U03: no D1 fence and missing R2 token returns no-op", async () => {
  const s = setup();
  const res = await s.request({ entity_type: "video", entity_id: "v1", fence_token: "wrong" });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { visibility_repair: "manifest_token_not_found" });
  assert.equal(s.bucket.stats.puts, 0);
});

test("MIG-0643 U03: CAS conflict with changed token never erases the new blocker", async () => {
  let first = true;
  const s = setup({ onPut(bucket) {
    if (!first) return false;
    first = false;
    bucket.set(manifest("video", "v1", "new-token"), "etag-2");
    return true;
  } });
  const res = await s.request();
  assert.equal(res.status, 500);
  assert.deepEqual(await res.json(), { visibility_repair: "failed" });
  assert.equal(s.bucket.value().entities[0].fence_token, "new-token");
  assert.equal(s.stats.batches, 0);
});

test("MIG-0643 U03: x_user IDs normalize @ and case before matching", async () => {
  const s = setup({ initial: manifest("x_user", "my_x", "token") });
  const res = await s.request({ entity_type: "x_user", entity_id: " @MY_X ", fence_token: "token" });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { visibility_repair: "repaired" });
  assert.equal(s.bucket.value().entities.length, 0);
});

test("MIG-0643 U03: invalid input and over-cap body never touch R2", async () => {
  const s = setup();
  for (const body of [
    { entity_type: "nope", entity_id: "v1", fence_token: "t1" },
    { entity_type: "video", entity_id: "", fence_token: "t1" },
    { entity_type: "video", entity_id: "v1", fence_token: "t".repeat(161) },
  ]) {
    const res = await s.request(body);
    assert.equal(res.status, 400);
    assert.equal((await res.json()).visibility_repair, "invalid_input");
  }
  const res = await s.request({ entity_type: "video", entity_id: "v1", fence_token: "t1", extra: "x".repeat(65536) });
  assert.equal(res.status, 413);
  assert.equal(s.bucket.stats.puts, 0);
  assert.equal(s.stats.batches, 0);
});

test("MIG-0643 U03: result contract includes CURRENT redirect query value", () => {
  assert.equal(AdminVisibilityRepairResultSchema.safeParse({ visibility_repair: "repaired" }).success, true);
  assert.equal(AdminVisibilityRepairResultSchema.safeParse({ visibility_repair: "not-possible" }).success, false);
});

test("MIG-0643 U03: successful CAS repair never logs the fence capability token", async () => {
  const token = "PRIVATE_VISIBILITY_FENCE_CAPABILITY_TOKEN";
  const s = setup({
    initial: manifest("video", "v1", token),
    fence: { state: "released", fence_token: token },
  });
  const captured = [];
  const previous = console.warn;
  console.warn = (...args) => captured.push(args.map(String).join(" "));
  let response;
  try {
    response = await s.request({ entity_type: "video", entity_id: "v1", fence_token: token });
  } finally {
    console.warn = previous;
  }
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { visibility_repair: "repaired" });
  assert.equal(s.bucket.value().entities.length, 0);
  assert.equal(captured.length, 1, "successful repair retains redacted operational telemetry");
  const log = captured.join("\n");
  assert.doesNotMatch(log, /PRIVATE_VISIBILITY_FENCE_CAPABILITY_TOKEN/);
  const record = JSON.parse(log);
  assert.equal(record.result, "released_dangling_manifest_entry");
  assert.equal(Object.hasOwn(record, "fence_token"), false);
});
