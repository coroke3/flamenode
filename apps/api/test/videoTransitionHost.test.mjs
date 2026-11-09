import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createVideoVisibilityTransitionHost } from "../src/visibility/videoTransitionHost.ts";
import {
  buildVideoApprovedNotification,
  buildVideoVisibilityChangedNotification,
} from "../../../src/lib/notifications/templates/video.ts";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

function exportedString(source, name) {
  const match = source.match(new RegExp(`export const ${name}\\s*=\\s*["']([^"']+)["']`));
  assert.ok(match, `missing CURRENT constant: ${name}`);
  return match[1];
}

test("D-13-42: copied visibility object keys stay aligned with CURRENT generators", () => {
  const copied = read("../src/visibility/publicCacheKeys.ts");
  const random = read("../../../src/lib/publicData/randomVideoPoolCore.ts");
  const youtube = read("../../../src/lib/publicData/staticYoutubeRelatedBlocklistCore.ts");
  const top = read("../../../src/lib/publicData/staticTopSectionsCore.ts");
  const users = read("../../../src/lib/publicData/staticUserProfileCore.ts");
  const event = read("../../../packages/server-core/src/publicData/eventDetailCore.ts");

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
  assert.match(event, /return `events\/\$\{eventId\}\/release\.v1\.json`/);
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

test("video status notification templates use the Worker-provided site origin", () => {
  const env = { NEXT_PUBLIC_SITE_URL: "https://api-origin.example" };
  const approved = buildVideoApprovedNotification({
    videoId: "v-1",
    videoTitle: "Test",
    eventId: "e-1",
  }, env);
  const changed = buildVideoVisibilityChangedNotification({
    videoId: "v-2",
    videoTitle: "Test",
  }, env);
  assert.equal(approved.url, "https://api-origin.example/v-1");
  assert.match(approved.content, /https:\/\/api-origin\.example\/event\/e-1/);
  assert.equal(changed.url, "https://api-origin.example/v-2");
  assert.match(changed.content, /https:\/\/api-origin\.example\/dashboard\/edit\/v-2/);
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
