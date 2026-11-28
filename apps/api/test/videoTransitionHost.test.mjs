import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createVideoVisibilityTransitionHost } from "../src/visibility/videoTransitionHost.ts";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

function exportedString(source, name) {
  const match = source.match(new RegExp(`export const ${name}\\s*=\\s*["']([^"']+)["']`));
  assert.ok(match, `missing CURRENT constant: ${name}`);
  return match[1];
}

test("D-13-42: copied visibility object keys stay aligned with CURRENT generators", () => {
  const copied = read("../src/visibility/publicCacheKeys.ts");
  const random = read("../../../packages/server-core/src/publicData/randomVideoPoolCore.ts");
  const youtube = read("../../../packages/server-core/src/publicData/staticYoutubeRelatedBlocklistCore.ts");
  const top = read("../../../src/lib/publicData/staticTopSectionsCore.ts");
  const users = read("../../../src/lib/publicData/staticUserProfileCore.ts");
  const event = read("../../../packages/server-core/src/publicData/eventDetailCore.ts");
  const release = read("../../../packages/server-core/src/publicData/eventReleaseCore.ts");

  for (const [name, source] of [
    ["RANDOM_VIDEO_POOL_OBJECT_KEY", random],
    ["YOUTUBE_RELATED_BLOCKLIST_OBJECT_KEY", youtube],
    ["TOP_RECOMMENDED_OBJECT_KEY", top],
    ["TOP_LATEST_OBJECT_KEY", top],
    ["TOP_NOSTALGIC_OBJECT_KEY", top],
    ["TOP_STATS_OBJECT_KEY", top],
  ]) {
    assert.ok(copied.includes(exportedString(source, name)), name);
  }
  assert.match(users, /export const STATIC_USER_MAX_PAGES = 5/);
  assert.match(copied, /VIDEO_VISIBILITY_USER_MAX_PAGES = 5/);
  assert.match(event, /return `events\/\$\{eventId\}\.json`/);
  assert.match(event, /return `events\/\$\{eventId\}\/base\.v1\.json`/);
  assert.match(event, /return `events\/\$\{eventId\}\/slots\.v1\.json`/);
  assert.match(release, /return `events\/\$\{eventId\}\/release\.v1\.json`/);
});

test("visibility host is fail-closed for missing manifest bucket in enforce mode", async () => {
  const host = createVideoVisibilityTransitionHost({
    env: { PUBLIC_VISIBILITY_GUARD_MODE: "enforce" },
  });
  await assert.rejects(host.manifest.read(), /public_visibility_manifest_bucket_missing/);
});

test("visibility host preserves observe-mode empty-manifest behavior without a bucket", async () => {
  const host = createVideoVisibilityTransitionHost({
    env: { PUBLIC_VISIBILITY_GUARD_MODE: "observe" },
  });
  const result = await host.manifest.read();
  assert.equal(result.etag, null);
  assert.equal(result.manifest.schema_version, 1);
  assert.deepEqual(result.manifest.entities, []);
});

test("visibility host invalidates public and event-export caches through the injected edge cache", async () => {
  const deleted = [];
  const dropped = [];
  const host = createVideoVisibilityTransitionHost(
    { env: { NEXT_PUBLIC_SITE_URL: "https://flamenode.example" } },
    {
      edgeCache: { delete: async (url) => { deleted.push(url); return true; } },
      dropIsolateEntry: (key) => dropped.push(key),
    },
  );
  await host.deletePublicJsonCaches(["videos/v-1.json"]);
  assert.deepEqual(dropped, ["videos/v-1.json"]);
  assert.equal(deleted.length, 1);
  assert.equal(deleted[0], "https://flamenode.internal/public-json/videos%2Fv-1.json");

  deleted.length = 0;
  await host.invalidateEventExportCaches(["event-1", "event-1"]);
  assert.equal(deleted.length, 8);
  assert.equal(new Set(deleted).size, 8);
});

test("D-13-41: Hono host deliberately does not wake notification queues", async () => {
  const host = createVideoVisibilityTransitionHost({ env: {} });
  assert.equal(await host.wakeNotificationQueueAfterCommit("admin_video_status"), undefined);
});

test("video status notification templates pass the Worker-provided site origin to every URL builder", () => {
  const source = read("../../../src/lib/notifications/templates/video.ts");
  assert.match(source, /buildVideoApprovedNotification\([\s\S]*?\}, env\?: NotificationUrlEnv\)/);
  assert.match(source, /buildVideoVisibilityChangedNotification\([\s\S]*?\}, env\?: NotificationUrlEnv\)/);
  assert.match(source, /appUrl\(videoPublicPath\(args\.videoId, args\.youtubeVideoId\), env\)/);
  assert.match(source, /linkLine\([^;]+, env\)/);
  assert.match(source, /appUrl\(videoPublicPath\(args\.videoId, args\.youtubeVideoId\), env\)/);
});

test("visibility manifest host uses R2 ETag preconditions for writes", async () => {
  const stored = JSON.stringify({
    schema_version: 1,
    revision: 0,
    generated_at: 1,
    entities: [],
  });
  const puts = [];
  const bucket = {
    get: async () => ({
      text: async () => stored,
      etag: "etag-current",
      size: new TextEncoder().encode(stored).byteLength,
    }),
    put: async (key, value, options) => {
      puts.push({ key, value, options });
      return { etag: "etag-next" };
    },
  };
  const host = createVideoVisibilityTransitionHost({
    env: { BUCKET: bucket, PUBLIC_VISIBILITY_GUARD_MODE: "enforce" },
  });
  const current = await host.manifest.read();
  await host.manifest.write({
    ...current.manifest,
    revision: 1,
    generated_at: 2,
  }, { ifMatchEtag: current.etag });
  assert.equal(puts.length, 1);
  assert.equal(puts[0].key, "visibility/blocked-entities.v1.json");
  assert.deepEqual(puts[0].options.onlyIf, { etagMatches: "etag-current" });
});

test("explicit undefined CAS option retains create-if-absent; omitted option remains unconditional", async () => {
  const puts = [];
  const bucket = {
    put: async (key, value, options) => {
      assert.equal(key, "visibility/blocked-entities.v1.json");
      puts.push(options);
      return { etag: "new-etag" };
    },
  };
  const host = createVideoVisibilityTransitionHost({
    env: { BUCKET: bucket, PUBLIC_VISIBILITY_GUARD_MODE: "enforce" },
  });
  const manifest = {
    schema_version: 1, revision: 1, generated_at: 1, entities: [],
  };

  await host.manifest.write(manifest);
  assert.equal(puts[0].onlyIf, undefined, "omitted property uses unconditional PUT");

  await host.manifest.write(manifest, { ifMatchEtag: undefined });
  assert.ok(puts[1].onlyIf instanceof Headers);
  assert.equal(puts[1].onlyIf.get("If-None-Match"), "*",
    "explicit undefined must reject overwriting an existing manifest");

  await host.manifest.write(manifest, { ifMatchEtag: null });
  assert.equal(puts[2].onlyIf.get("If-None-Match"), "*",
    "explicit null is the same create-if-absent precondition");

  await host.manifest.write(manifest, { ifMatchEtag: "etag-current" });
  assert.deepEqual(puts[3].onlyIf, { etagMatches: "etag-current" });
  for (const options of puts) {
    assert.equal(options.httpMetadata.cacheControl, "no-store");
  }
  assert.equal(puts.length, 4);
});

test("explicit undefined create-if-absent retries must preserve pre-existing foreign token", async () => {
  const foreign = {
    entity_type: "video", entity_id: "v-existing",
    fence_token: "vf-foreign", blocked_at: 100, reason: "already_private",
  };
  const newBlock = {
    entity_type: "video", entity_id: "v-new",
    fence_token: "vf-new", blocked_at: 101, reason: "new_private",
  };
  let stored = {
    schema_version: 1, revision: 4, generated_at: 100, entities: [foreign],
  };
  let etag = "etag-foreign";
  const puts = [];
  const bucket = {
    get: async (key) => {
      assert.equal(key, "visibility/blocked-entities.v1.json");
      const value = JSON.stringify(stored);
      return { text: async () => value, size: Buffer.byteLength(value), etag };
    },
    put: async (key, value, options) => {
      assert.equal(key, "visibility/blocked-entities.v1.json");
      puts.push(options);
      // Model real R2: precondition violation resolves to null (no mutation).
      if (options.onlyIf instanceof Headers) {
        assert.equal(options.onlyIf.get("If-None-Match"), "*");
        return null; // R2 manifest already exists.
      }
      if (options.onlyIf?.etagMatches !== etag) return null;
      stored = JSON.parse(value);
      etag = "etag-merged";
      return { etag };
    },
  };
  const host = createVideoVisibilityTransitionHost({
    env: { BUCKET: bucket, PUBLIC_VISIBILITY_GUARD_MODE: "enforce" },
  });
  // The stale candidate has a conflicting token and an unrelated new block.
  // CAS retry may add the latter, but cannot replace the existing owner.
  const candidate = {
    schema_version: 1, revision: 1, generated_at: 101,
    entities: [{ ...foreign, fence_token: "vf-stale" }, newBlock],
  };
  await host.manifest.write(candidate, { ifMatchEtag: undefined });
  assert.equal(puts.length, 2, "failed first PUT must retry conditionally");
  assert.equal(puts[1].onlyIf.etagMatches, "etag-foreign");
  assert.equal(stored.entities.find((e) => e.entity_id === "v-existing")?.fence_token, "vf-foreign");
  assert.deepEqual(stored.entities.find((e) => e.entity_id === "v-new"), newBlock);
  assert.equal(stored.entities.length, 2, "no duplicate blocks or lost foreign entity");
  assert.ok(puts.every((option) => option.onlyIf && option.httpMetadata.cacheControl === "no-store"),
    "there must never be an unconditional overwrite");
});
