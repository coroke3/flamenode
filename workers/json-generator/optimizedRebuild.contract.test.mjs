import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const source = readFileSync(
  fileURLToPath(new URL("./optimizedRebuild.ts", import.meta.url)),
  "utf8",
);

test("ranking queueの滞留読取と完了更新をCloudflare向けにbounded/batch化する", () => {
  const captureStart = source.indexOf("async function capturePendingRankingRows(");
  const captureEnd = source.indexOf("\nasync function loadCompleteRankingSnapshot", captureStart);
  const capture = source.slice(captureStart, captureEnd);
  assert.match(capture, /LIMIT \?/);
  assert.match(capture, /\.bind\(\.\.\.RANKING_TARGETS, RANKING_PENDING_CAPTURE_LIMIT\)/);

  const doneStart = source.indexOf("async function markCoveredRankingRowsDone(");
  const doneEnd = source.indexOf("\nasync function rebuildRankingBundle", doneStart);
  const done = source.slice(doneStart, doneEnd);
  assert.match(done, /const statements: D1PreparedStatement\[\] = \[\]/);
  assert.match(done, /await env\.DB\.batch\(statements\)/);
});

test("dedupeされたR2 artifactでもstatic_artifacts鮮度を更新する", () => {
  const putTrackedStart = source.indexOf("async function putTrackedJson(");
  const putTrackedEnd = source.indexOf("\nfunction listPayloadFits", putTrackedStart);
  const body = source.slice(putTrackedStart, putTrackedEnd);
  const conditionalPut = body.indexOf("if (!identical)");
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
    /if \(!listPayloadFits\(recentPayload\) \|\| !listPayloadFits\(popularPayload\)\) \{\s*return null;\s*\}/,
  );
  assert.doesNotMatch(source, /function assertListSize/);
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
