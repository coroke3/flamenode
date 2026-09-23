import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const source = readFileSync(
  fileURLToPath(new URL("./optimizedRebuild.ts", import.meta.url)),
  "utf8",
);

test("ranking queueの滞留読取と完了更新をCloudflare向けにbounded/batch化する", () => {
  const captureStart = source.indexOf("async function capturePendingVideoProjectionRows(");
  const captureEnd = source.indexOf("\nasync function loadCompleteRankingSnapshot", captureStart);
  const capture = source.slice(captureStart, captureEnd);
  assert.match(capture, /LIMIT \?/);
  assert.match(capture, /\.bind\(\.\.\.VIDEO_SOURCE_PROJECTION_TARGETS, RANKING_PENDING_CAPTURE_LIMIT\)/);
  assert.match(capture, /VIDEO_SOURCE_PROJECTION_TARGETS/);

  const doneStart = source.indexOf("async function markCoveredRankingRowsDone(");
  const doneEnd = source.indexOf("\nasync function rebuildRankingBundle", doneStart);
  const done = source.slice(doneStart, doneEnd);
  assert.match(done, /WITH covered_rows AS \([\s\S]*FROM json_each\(\?\)/);
  assert.match(done, /covered_rows\.updated_at = static_rebuild_queue\.updated_at/);
  assert.match(done, /covered_rows\.target_type = static_rebuild_queue\.target_type/);
  assert.match(done, /\.run\(\)/);
  assert.doesNotMatch(done, /env\.DB\.batch/);
});

test("video projection のpending CASは更新世代だけをJSON1単一UPDATEで完了する", () => {
  const doneStart = source.indexOf("async function markCoveredRankingRowsDone(");
  const doneEnd = source.indexOf("\nasync function rebuildRankingBundle", doneStart);
  const done = source.slice(doneStart, doneEnd);
  const sql = done.match(/env\.DB\.prepare\(\s*`([\s\S]*?)`\s*,?\s*\)/)?.[1];
  assert.ok(sql);

  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE static_rebuild_queue (
      id TEXT PRIMARY KEY,
      target_type TEXT NOT NULL,
      status TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      processed_at INTEGER,
      attempt_count INTEGER NOT NULL,
      error TEXT,
      processing_started_at INTEGER,
      lease_token TEXT,
      lease_expires_at INTEGER,
      next_retry_at INTEGER
    );
    INSERT INTO static_rebuild_queue (id, target_type, status, updated_at, attempt_count)
    VALUES
      ('same-generation', 'search_index', 'pending', 10, 2),
      ('re-enqueued', 'random_video_pool', 'pending', 12, 2),
      ('currently-processing', 'list_recent', 'processing', 10, 2);
  `);
  db.prepare(sql).run(JSON.stringify([
    { id: "same-generation", target_type: "search_index", updated_at: 10 },
    { id: "re-enqueued", target_type: "random_video_pool", updated_at: 11 },
    { id: "currently-processing", target_type: "list_recent", updated_at: 10 },
  ]), 200, 200);

  const rows = db.prepare(
    "SELECT id, status, updated_at, processed_at FROM static_rebuild_queue ORDER BY id",
  ).all().map((row) => ({ ...row }));
  assert.deepEqual(rows, [
    { id: "currently-processing", status: "processing", updated_at: 10, processed_at: null },
    { id: "re-enqueued", status: "pending", updated_at: 12, processed_at: null },
    { id: "same-generation", status: "done", updated_at: 200, processed_at: 200 },
  ]);
  db.close();
});

test("dedupeされたR2 artifactでもstatic_artifacts鮮度を更新する", () => {
  const putTrackedStart = source.indexOf("async function putTrackedJson(");
  const putTrackedEnd = source.indexOf("\nfunction listPayloadFits", putTrackedStart);
  const body = source.slice(putTrackedStart, putTrackedEnd);
  const conditionalPut = body.indexOf("if (!identical?.skipPut)");
  const trackingWrite = body.indexOf("await recordArtifact(");

  assert.ok(putTrackedStart >= 0);
  assert.ok(conditionalPut >= 0);
  assert.ok(
    trackingWrite > conditionalPut,
    "artifact tracking must run after the optional R2 PUT instead of returning on dedupe",
  );
  assert.equal(
    /if \(await resolveIdenticalJsonArtifactPut[\s\S]*?\)\) return/.test(body),
    false,
  );
});

test("8MB超過listはbundle全体をthrowせず既存target実装へfallbackする", () => {
  assert.match(
    source,
    /if \(!listPayloadFits\(recentPayload\) \|\| !listPayloadFits\(popularPayload\)\) \{[\s\S]*?return null;\s*\}/,
  );
  assert.doesNotMatch(source, /function assertListSize/);
});

test("ranking/search/randomは共有R2 materialized sourceを使いqueue source timestampをartifactへ記録する", () => {
  assert.match(source, /VIDEO_MATERIALIZED_SOURCE_MAX_ROWS/);
  assert.match(source, /async function syncVideoMaterializedSource/);
  assert.match(source, /status IN \('pending', 'processing'\)/);
  assert.match(source, /await syncVideoMaterializedSource\(env, \[\], signal\)/);
  assert.match(source, /await patchVideoMaterializedSource\(env, targetId, signal\)/);
  assert.match(source, /rebuildRankingBundle\([\s\S]*?targetType,[\s\S]*?sourceUpdatedAt/);
  assert.match(source, /"search_index" \|\| targetType === "random_video_pool"/);
  assert.match(source, /VIDEO_SOURCE_PROJECTION_TARGETS = \[[\s\S]*?"search_index",\s*"random_video_pool"/);
  assert.match(source, /rebuildTarget\([\s\S]*?targetType,[\s\S]*?"global",[\s\S]*?signal/);
  const bundleStart = source.indexOf("async function rebuildRankingBundle(");
  const bundleEnd = source.indexOf("\nasync function markEventPlaylistDeleted", bundleStart);
  const bundle = source.slice(bundleStart, bundleEnd);
  assert.equal((bundle.match(/signal,\n\s+sourceUpdatedAt,/g) ?? []).length, 5);
});

test("event_base成功後に厳密playlist projectionも同期する", () => {
  assert.match(
    source,
    /if \(targetType === "event_base"\) \{[\s\S]*await syncEventPlaylistArtifact\(env, targetId, signal\);[\s\S]*enqueuePerTargetComposerFollowUp\(\s*env,\s*"event_base",\s*targetId,\s*\)/,
  );
});

test("event playlistはevent_baseと同じ公開集合を安定した上映順で投影する", () => {
  const start = source.indexOf("async function syncEventPlaylistArtifact(");
  const end = source.indexOf("\nexport async function optimizedRebuildTarget", start);
  const playlist = source.slice(start, end);

  assert.match(playlist, /WHERE \$\{COUNTABLE_PUBLIC_VIDEO_SQL\}/);
  assert.match(
    playlist,
    /FROM video_events AS event_video_links[\s\S]*event_video_links\.event_id = \?/,
  );
  assert.match(playlist, /OR v\.primary_event_id = \?/);
  assert.match(
    playlist,
    /ORDER BY v\.scheduled_time IS NULL ASC, v\.scheduled_time ASC, v\.id ASC/,
  );
  assert.match(
    playlist,
    /\.bind\(eventId, eventId, EVENT_PLAYLIST_MAX_ITEMS \+ 1\)/,
  );
  assert.doesNotMatch(playlist, /INNER JOIN video_events/);
});
