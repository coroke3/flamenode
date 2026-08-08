import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const source = readFileSync(
  fileURLToPath(new URL("./optimizedRebuild.ts", import.meta.url)),
  "utf8",
);

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
    /if \(targetType === "event_base"\) \{\s*await syncEventPlaylistArtifact\(env, targetId, signal\);\s*\}/,
  );
});
