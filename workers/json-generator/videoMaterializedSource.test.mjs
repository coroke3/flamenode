import assert from "node:assert/strict";
import { test } from "node:test";
import {
  mutateVideoMaterializedSource,
  loadVideoMaterializedSource,
  VIDEO_MATERIALIZED_SOURCE_MAX_MANIFEST_BYTES,
} from "./videoMaterializedSource.ts";

function mockBucket() {
  const objects = new Map();
  let etagSequence = 0;
  let failManifestWrites = false;
  const toObject = (key) => {
    const stored = objects.get(key);
    if (!stored) return null;
    return {
      key,
      etag: stored.etag,
      size: new TextEncoder().encode(stored.body).byteLength,
      customMetadata: stored.customMetadata,
      body: { async cancel() {} },
      async json() {
        return JSON.parse(stored.body);
      },
      async text() {
        return stored.body;
      },
    };
  };
  const bucket = {
    async get(key) {
      return toObject(key);
    },
    async head(key) {
      const object = toObject(key);
      return object
        ? { etag: object.etag, customMetadata: object.customMetadata }
        : null;
    },
    async put(key, value, options = {}) {
      const current = objects.get(key);
      if (failManifestWrites && key.endsWith("/manifest.json")) return null;
      const condition = options.onlyIf;
      if (
        condition instanceof Headers &&
        condition.get("if-none-match") === "*" &&
        current
      ) return null;
      if (condition?.etagMatches && condition.etagMatches !== current?.etag) {
        return null;
      }
      const body = typeof value === "string" ? value : await new Response(value).text();
      const stored = {
        body,
        etag: `etag-${++etagSequence}`,
        customMetadata: options.customMetadata ?? {},
      };
      objects.set(key, stored);
      return { etag: stored.etag };
    },
    async delete(keyOrKeys) {
      for (const key of Array.isArray(keyOrKeys) ? keyOrKeys : [keyOrKeys]) {
        objects.delete(key);
      }
    },
  };
  return {
    bucket,
    objects,
    setFailManifestWrites(value) {
      failManifestWrites = value;
    },
  };
}

function row(id, title = id) {
  return {
    id,
    title,
    youtube_video_id: null,
    display_name: "creator",
    creator_display_name: "creator",
    creator_x_user_id: null,
    icon_url: null,
    creator_icon_url: null,
    primary_event_id: null,
    primary_event_title: null,
    scheduled_time: null,
    status: "public",
    part: null,
    score: 0,
    score_updated_at: 10,
    updated_at: 10,
    youtube_privacy_status: null,
    youtube_availability_status: null,
  };
}

async function assertCorruptManifestIsRepaired(body) {
  const { bucket } = mockBucket();
  const env = { R2: bucket };
  await bucket.put(
    "internal/materialized/video-cards/v1/manifest.json",
    body,
  );

  const repaired = await mutateVideoMaterializedSource(
    env,
    async (rows) => ({ rows, scoreWatermark: 10, sourceUpdatedAt: 10 }),
    { bootstrap: async () => [row("v1")] },
  );

  assert.ok(repaired);
  const loaded = await loadVideoMaterializedSource(env);
  assert.equal(loaded.source.generation, repaired.source.generation);
  assert.equal(loaded.source.rows[0].id, "v1");
}

test("video source writes immutable data before committing its CAS manifest", async () => {
  const { bucket, objects } = mockBucket();
  const env = { R2: bucket };
  const result = await mutateVideoMaterializedSource(
    env,
    async (rows) => ({ rows, scoreWatermark: 10, sourceUpdatedAt: 10 }),
    { bootstrap: async () => [row("v1")] },
  );
  assert.ok(result);
  const manifestKeys = [...objects.keys()].filter((key) => key.endsWith("manifest.json"));
  const sourceKeys = [...objects.keys()].filter((key) => key.includes("/g/"));
  assert.equal(manifestKeys.length, 1);
  assert.equal(sourceKeys.length, 1);
  assert.equal(JSON.parse(objects.get(manifestKeys[0]).body).generation, result.source.generation);
  assert.equal((await loadVideoMaterializedSource(env)).source.rows[0].id, "v1");
});

test("concurrent video source patches retry CAS and preserve both updates", async () => {
  const { bucket } = mockBucket();
  const env = { R2: bucket };
  const initial = await mutateVideoMaterializedSource(
    env,
    async (rows) => ({ rows, scoreWatermark: 10, sourceUpdatedAt: 10 }),
    { bootstrap: async () => [row("v1"), row("v2")] },
  );
  assert.ok(initial);

  let waiting = 0;
  let release;
  const barrier = new Promise((resolve) => { release = resolve; });
  async function patch(id, title) {
    return mutateVideoMaterializedSource(
      env,
      async (rows, current) => {
        if (current?.generation === initial.source.generation) {
          waiting += 1;
          if (waiting === 2) release();
          await barrier;
        }
        return {
          rows: rows.map((item) => item.id === id ? { ...item, title } : item),
          sourceUpdatedAt: Math.max(...rows.map((item) => item.updated_at)),
        };
      },
      { bootstrap: async () => [row("v1"), row("v2")] },
    );
  }

  await Promise.all([patch("v1", "first update"), patch("v2", "second update")]);
  const current = await loadVideoMaterializedSource(env);
  const byId = new Map(current.source.rows.map((item) => [item.id, item.title]));
  assert.equal(byId.get("v1"), "first update");
  assert.equal(byId.get("v2"), "second update");
});

test("manifest CAS failure keeps the prior generation authoritative", async () => {
  const fixture = mockBucket();
  const env = { R2: fixture.bucket };
  const initial = await mutateVideoMaterializedSource(
    env,
    async (rows) => ({ rows, scoreWatermark: 10, sourceUpdatedAt: 10 }),
    { bootstrap: async () => [row("v1")] },
  );
  assert.ok(initial);

  fixture.setFailManifestWrites(true);
  await assert.rejects(
    mutateVideoMaterializedSource(
      env,
      async (rows) => ({
        rows: rows.map((item) => ({ ...item, title: "uncommitted" })),
      }),
      { bootstrap: async () => [row("v1")] },
    ),
    /video_materialized_source_manifest_cas_conflict/,
  );

  const committed = await loadVideoMaterializedSource(env);
  assert.equal(committed.source.generation, initial.source.generation);
  assert.equal(committed.source.rows[0].title, "v1");
});

test("a malformed manifest is repaired with its observed etag after bootstrap", async () => {
  await assertCorruptManifestIsRepaired("{not-json");
});

test("an oversized manifest is repaired with its observed etag after bootstrap", async () => {
  await assertCorruptManifestIsRepaired(
    "x".repeat(VIDEO_MATERIALIZED_SOURCE_MAX_MANIFEST_BYTES + 1),
  );
});
