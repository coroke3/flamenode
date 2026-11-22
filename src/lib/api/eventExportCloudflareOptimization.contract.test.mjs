import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const route = await readFile(
  new URL("../../../app/api/event-endpoints/[id]/route.ts", import.meta.url),
  "utf8",
);
const wrangler = await readFile(
  new URL("../../../wrangler.toml", import.meta.url),
  "utf8",
);

test("event exportのCache API HITはmetadataを信用せずDTO検証を必ず実行する", () => {
  assert.match(route, /EVENT_EXPORT_CACHE_METADATA_MARKER/);
  assert.match(route, /readPublicJsonCache<unknown>\(cacheKey, \{ bypassIsolate: true \}\)/);
  assert.match(route, /coercePublicJsonCacheEnvelope\(/);
  assert.match(route, /requireStoredAt: true/);
  assert.match(route, /metadata:\s*cacheMetadataForFormat\(format\)/);

  // Serialized Cache API metadata is not an authenticated statement.
  // A forged matching marker must never bypass body parsing or the leak fence.
  assert.doesNotMatch(route, /if \(isTrustedCacheMetadata\(metadata, format\)\) return cached/);
  const guardIndex = route.indexOf("metadata != null && !isTrustedCacheMetadata(metadata, format)");
  const parseIndex = route.indexOf("const parsed = JSON.parse(cached)");
  const fenceIndex = route.indexOf("assertNoForbiddenKeys(parsed)", parseIndex);
  const returnIndex = route.indexOf("return cached;", parseIndex);
  assert.ok(guardIndex >= 0 && parseIndex > guardIndex,
    "untrusted metadata is checked before the cached body is parsed");
  assert.ok(fenceIndex > parseIndex && returnIndex > fenceIndex,
    "all cached bodies pass the forbidden-key check before delivery");
});

test("scheduled exportはCache API HITでもD1公開可否確認を先に維持する", () => {
  const authIndex = route.indexOf("prefetchedEvent = await loadEventExportEvent");
  const snapshotIndex = route.indexOf("snapshot = await loadEventExportSnapshot(");
  const serializationIndex = route.indexOf("body = JSON.stringify(payload)");
  const cacheIndex = route.indexOf("const response = await cachedResponse(body)");
  assert.ok(authIndex >= 0 && snapshotIndex > authIndex &&
    serializationIndex > snapshotIndex && cacheIndex > serializationIndex,
    "scheduled cache reuse must follow the fresh D1 relation snapshot and public DTO");
  // On a freshness mismatch the old origin Cache API body must be evicted
  // before a freshly-authorized response, not only overwritten opportunistically.
  const nullGuard = route.indexOf("if (cached === null) return null;");
  const mismatchGuard = route.indexOf("if (!eventExportBodyMatchesFresh(cached, freshBody, format))");
  const evictionIndex = route.indexOf("await deletePublicJsonCaches([payloadCacheKey])", mismatchGuard);
  const returnHitIndex = route.indexOf("return exportResponse(", mismatchGuard);
  assert.ok(nullGuard >= 0 && mismatchGuard > nullGuard &&
    evictionIndex > mismatchGuard && returnHitIndex > evictionIndex,
    "only a fresh D1-equivalent body can be returned as HIT; stale entries are deleted");
});

test("web WorkerはSmart Placementを有効化し静的assetはWorkerを迂回する", () => {
  assert.match(wrangler, /\[placement\]\s*\nmode\s*=\s*"smart"/);
  assert.match(
    wrangler,
    /\[assets\][\s\S]*run_worker_first\s*=\s*false/,
  );
});
